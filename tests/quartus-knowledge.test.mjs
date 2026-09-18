import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

import {
  QUARTUS_PROCESSES,
  isQuartus,
  loadQuartusKnowledge,
  retrieveQuartusKnowledge
} from '../src/analyzer/lib/quartus-knowledge.mjs';

test('loadQuartusKnowledge 校验非 Quartus UI Map', async () => {
  const root = await createFixture({
    application: {name: 'Not Quartus', version: '26.1.1', edition: 'Pro', language: 'en-US'}
  });
  try {
    await assert.rejects(() => loadQuartusKnowledge(root), /不是 Quartus/);
  } finally {
    await cleanup(root);
  }
});

test('loadQuartusKnowledge 拒绝非法文档来源域', async () => {
  const root = await createFixture({
    nodes: [{locatorId: 'quartus.root', parentId: null, canonicalName: 'Root', visibleLabel: 'Quartus',
      aliases: ['root'], role: 'application', purpose: 'work', stage: 'idle',
      verification: 'official_documentation_only', behaviorVerification: 'not_executed',
      labelFidelity: 'documented', sourceRefs: ['s1'], evidenceRefs: []}],
    sources: [{id: 's1', url: 'https://example.invalid/anything', title: 'Fake', readStatus: 'read', accessedOn: '2026-01-01T00:00:00Z', usage: 'docs', version: 'x'}]
  });
  try {
    await assert.rejects(() => loadQuartusKnowledge(root), /官方域/);
  } finally {
    await cleanup(root);
  }
});

test('官方来源验证拒绝伪造后缀域与非 HTTPS', async () => {
  for(const url of ['https://evildocs.altera.com/manual', 'http://docs.altera.com/manual', 'https://intel.com.example.org/manual']) {
    const root=await createFixture();
    try {
      const file=path.join(root,'workspace/ui-map.json');
      const map=JSON.parse(await fs.readFile(file,'utf8'));
      for(const n of map.nodes){n.verification='official_documentation_only';n.behaviorVerification='not_executed';n.evidenceRefs=[];}
      await writeJson(file,map);
      await writeJson(path.join(root,'sources.json'),{sources:[{id:'s1',url,title:'Claimed official',version:'26.1',readStatus:'read',accessedOn:'2026-09-07'}]});
      await assert.rejects(()=>loadQuartusKnowledge(root),/官方域/);
    } finally {await cleanup(root);}
  }
});

test('检索不会重复候选，且序列化上下文有上限', async () => {
  const root=await createFixture();
  try {
    const k=await loadQuartusKnowledge(root);
    const r=retrieveQuartusKnowledge(k,[{target:{name:'Child File'}}],{application:'quartus'},10);
    assert.equal(new Set(r.entries.map(e=>e.locatorId)).size,r.entries.length);
    assert.ok(r.sourceDetails.every(s=>s.version));
    assert.ok(r.evidenceDetails.every(e=>e.sha256));
    k.entries.find(e=>e.canonicalName==='Child').purpose='x'.repeat(90000);
    const bounded=retrieveQuartusKnowledge(k,[{target:{name:'Child'}}],{application:'quartus'},10);
    assert.ok(Buffer.byteLength(JSON.stringify(bounded))<=65536);
    assert.equal(bounded.retrieval.truncation.dropped,true);
  } finally {await cleanup(root);}
});

test('loadQuartusKnowledge 要求 live_visual_observed 有证据引用', async () => {
  const root = await createFixture({
    nodes: [{locatorId: 'quartus.root', parentId: null, canonicalName: 'Root', visibleLabel: 'Quartus',
      aliases: ['root'], role: 'application', purpose: 'work', stage: 'idle',
      verification: 'live_visual_observed', behaviorVerification: 'navigation_observed',
      labelFidelity: 'observed', sourceRefs: ['s1'], evidenceRefs: []}]
  });
  try {
    await assert.rejects(() => loadQuartusKnowledge(root), /live_visual 节点必须有 evidenceRefs/);
  } finally {
    await cleanup(root);
  }
});

test('loadQuartusKnowledge 拒绝静态坐标字段泄漏', async () => {
  const root = await createFixture({
    nodes: [{locatorId: 'quartus.root', parentId: null, canonicalName: 'Root', visibleLabel: 'Quartus',
      aliases: ['root'], role: 'application', purpose: 'work', stage: 'idle', verification: 'live_visual_observed',
      behaviorVerification: 'visual_observed', labelFidelity: 'observed', sourceRefs: ['s1'], evidenceRefs: ['e1'], bounds: [0, 0, 1, 1]}]
  });
  try {
    await assert.rejects(() => loadQuartusKnowledge(root), /静态语义表泄露运行时键/);
  } finally {
    await cleanup(root);
  }
});

test('loadQuartusKnowledge 处理层级关系且检索返回父链', async () => {
  const root = await createFixture();
  try {
    const knowledge = await loadQuartusKnowledge(root);
    const actions = [{window: {processName: 'quartus'}, target: {name: 'Child'}}];
    const result = retrieveQuartusKnowledge(knowledge, actions, null, 16);
    const ids = result.entries.map((entry) => entry.locatorId);
    assert.ok(ids.includes('quartus.root.parent'));
    assert.ok(ids.includes('quartus.root.parent.child'));
    assert.equal(result.retrieval.ambiguity, 0);
  } finally {
    await cleanup(root);
  }
});

test('loadQuartusKnowledge 校验 section.id 唯一性和单应用根', async () => {
  const root = await createFixture({includeTwoSection: true});
  try {
    const indexPath = path.join(root, 'ui-index.json');
    const index = JSON.parse(await fs.readFile(indexPath, 'utf8'));
    index.sections.push({id: 'workspace', map: index.sections[0].map, rootLocatorId: index.sections[0].rootLocatorId});
    await writeJson(indexPath, index);
    await assert.rejects(() => loadQuartusKnowledge(root), /重复 section id|必须有且仅有一个无父节点根节点/);
  } finally {
    await cleanup(root);
  }
});

test('检索支持歧义和回退/未命中显式说明', async () => {
  const root = await createFixture({
    nodes: [
      {locatorId: 'quartus.root', parentId: null, canonicalName: 'Root', visibleLabel: 'Quartus',
        aliases: ['Quartus', 'root'], role: 'application', purpose: 'work', stage: 'idle',
        verification: 'live_visual_observed', behaviorVerification: 'navigation_observed', labelFidelity: 'observed',
        sourceRefs: ['s1'], evidenceRefs: ['e1']},
      {locatorId: 'quartus.section.menu.one', parentId: 'quartus.root', canonicalName: 'Common', visibleLabel: 'Common',
        aliases: ['setup'], role: 'menu', purpose: 'work', stage: 'idle',
        verification: 'live_visual_observed', behaviorVerification: 'navigation_observed', labelFidelity: 'observed',
        sourceRefs: ['s1'], evidenceRefs: ['e1']},
    {locatorId: 'quartus.section.menu.two', parentId: 'quartus.root', canonicalName: 'Common Item', visibleLabel: 'Common',
        aliases: ['setup'], role: 'menu', purpose: 'work', stage: 'idle',
        verification: 'live_visual_observed', behaviorVerification: 'navigation_observed', labelFidelity: 'observed',
        sourceRefs: ['s1'], evidenceRefs: ['e1']}
    ]
  });
  try {
    const knowledge = await loadQuartusKnowledge(root);
    const ambiguous = retrieveQuartusKnowledge(knowledge, [{window: {processName: 'quartus'}, target: {name: 'setup'}}], null, 6);
    assert.equal(ambiguous.retrieval.ambiguity, 1);
    assert.equal(ambiguous.entries.length <= 6, true);

    const noMatch = retrieveQuartusKnowledge(knowledge, [{window: {processName: 'quartus'}, target: {name: 'noSuchThingXYZ'}}], null, 6);
    assert.equal(noMatch.retrieval.matched, false);
    assert.equal(noMatch.retrieval.fallbackUsed, true);
    assert.ok(noMatch.retrieval.warning);
  } finally {
    await cleanup(root);
  }
});

test('检索默认 actions [] 不报错，并支持远端 application 上下文', async () => {
  const root = await createFixture({
    nodes: [{locatorId: 'quartus.root', parentId: null, canonicalName: 'Root', visibleLabel: 'Quartus',
      aliases: ['root'], role: 'application', purpose: 'work', stage: 'idle',
      verification: 'live_visual_observed', behaviorVerification: 'navigation_observed', labelFidelity: 'observed',
      sourceRefs: ['s1'], evidenceRefs: ['e1']}]
  });
  try {
    const knowledge = await loadQuartusKnowledge(root);
    const result = retrieveQuartusKnowledge(knowledge, undefined, {application: 'quartus'}, 4);
    assert.equal(result.retrieval.applicable, true);
    assert.equal(result.retrieval.sectionContext, null);
    assert.equal(result.entries.length > 0, true);
  } finally {
    await cleanup(root);
  }
});

test('检索不接受未识别 section 作为 Quartus 会话', async () => {
  const root = await createFixture();
  try {
    const knowledge = await loadQuartusKnowledge(root);
    const result = retrieveQuartusKnowledge(knowledge, [{window: {processName: 'quartus'}},
      {target: {name: 'Quartus'}}], {section: 'bad-section'}, 4);
    assert.equal(result.retrieval.applicable, false);
    assert.equal(result.retrieval.ambiguityReasons.includes('未知 section 上下文'), true);
  } finally {
    await cleanup(root);
  }
});

test('检索保留深度叶节点且预算裁剪不吞掉叶节点', async () => {
  const nodes = [
    {locatorId: 'quartus.root', parentId: null, canonicalName: 'Root', visibleLabel: 'Root',
      aliases: ['root'], role: 'application', purpose: 'work', stage: 'idle',
      verification: 'live_visual_observed', behaviorVerification: 'navigation_observed',
      labelFidelity: 'observed', sourceRefs: ['s1'], evidenceRefs: ['e1']},
    {locatorId: 'quartus.a', parentId: 'quartus.root', canonicalName: 'A', visibleLabel: 'A',
      aliases: ['level a'], role: 'menu', purpose: 'work', stage: 'idle',
      verification: 'live_visual_observed', behaviorVerification: 'navigation_observed',
      labelFidelity: 'observed', sourceRefs: ['s1'], evidenceRefs: ['e1']},
    {locatorId: 'quartus.b', parentId: 'quartus.a', canonicalName: 'B', visibleLabel: 'B',
      aliases: ['level b'], role: 'menu', purpose: 'work', stage: 'idle',
      verification: 'live_visual_observed', behaviorVerification: 'navigation_observed',
      labelFidelity: 'observed', sourceRefs: ['s1'], evidenceRefs: ['e1']},
    {locatorId: 'quartus.c', parentId: 'quartus.b', canonicalName: 'C', visibleLabel: 'C',
      aliases: ['deep leaf target'], role: 'menu', purpose: 'work', stage: 'idle',
      verification: 'live_visual_observed', behaviorVerification: 'navigation_observed',
      labelFidelity: 'observed', sourceRefs: ['s1'], evidenceRefs: ['e1']}
  ];
  const root = await createFixture({nodes, withLiveObservation: true});
  try {
    const knowledge = await loadQuartusKnowledge(root);
    const result = retrieveQuartusKnowledge(knowledge, [{target: {name: 'deep leaf target'}}], {application:'quartus'}, 2);
    assert.equal(result.retrieval.matched, true);
    assert.equal(result.entries[0].locatorId, 'quartus.c');
    assert.equal(result.entries.some((entry) => entry.locatorId === 'quartus.b'), true);
    assert.equal(result.entries.length, 2);
    assert.ok(result.entries[0].ancestorIds.includes('quartus.root'));
    assert.equal(result.retrieval.truncation.dropped, true);
  } finally {
    await cleanup(root);
  }
});

test('检索支持中文别名和层级 budget 限制', async () => {
  const root = await createFixture({
    nodes: [
      {locatorId: 'quartus.root', parentId: null, canonicalName: 'Root', visibleLabel: 'Quartus',
        aliases: ['root'], role: 'application', purpose: 'work', stage: 'idle',
        verification: 'live_visual_observed', behaviorVerification: 'navigation_observed', labelFidelity: 'observed',
        sourceRefs: ['s1'], evidenceRefs: ['e1']},
      {locatorId: 'quartus.c1', parentId: 'quartus.root', canonicalName: '一级', visibleLabel: '一级',
        aliases: ['设置'], role: 'menu', purpose: 'work', stage: 'idle', verification: 'live_visual_observed',
        behaviorVerification: 'navigation_observed', labelFidelity: 'observed', sourceRefs: ['s1'], evidenceRefs: ['e1']},
      {locatorId: 'quartus.c2', parentId: 'quartus.c1', canonicalName: '二级', visibleLabel: '二级',
        aliases: ['配置'], role: 'menu', purpose: 'work', stage: 'idle', verification: 'live_visual_observed',
        behaviorVerification: 'navigation_observed', labelFidelity: 'observed', sourceRefs: ['s1'], evidenceRefs: ['e1']},
      {locatorId: 'quartus.c3', parentId: 'quartus.c2', canonicalName: '三级', visibleLabel: '三级',
        aliases: ['高级'], role: 'menu', purpose: 'work', stage: 'idle', verification: 'live_visual_observed',
        behaviorVerification: 'navigation_observed', labelFidelity: 'observed', sourceRefs: ['s1'], evidenceRefs: ['e1']},
      {locatorId: 'quartus.c4', parentId: 'quartus.c3', canonicalName: '四级', visibleLabel: '四级',
        aliases: ['最终'], role: 'menu', purpose: 'work', stage: 'done', verification: 'live_visual_observed',
        behaviorVerification: 'navigation_observed', labelFidelity: 'observed', sourceRefs: ['s1'], evidenceRefs: ['e1']},
      {locatorId: 'quartus.c5', parentId: 'quartus.c4', canonicalName: '五级', visibleLabel: '五级',
        aliases: ['结束'], role: 'menu', purpose: 'work', stage: 'done', verification: 'live_visual_observed',
        behaviorVerification: 'navigation_observed', labelFidelity: 'observed', sourceRefs: ['s1'], evidenceRefs: ['e1']}
    ]
  });
  try {
    const knowledge = await loadQuartusKnowledge(root);
    const chinese = retrieveQuartusKnowledge(knowledge, [{window: {processName: 'quartus'}, target: {name: '设置'}}], null, 4);
    assert.equal(chinese.retrieval.matched, true);
    assert.equal(chinese.retrieval.hierarchyBudgetUsed <= 4, true);
    assert.ok(chinese.entries.map((entry) => entry.locatorId).includes('quartus.c1'));
  } finally {
    await cleanup(root);
  }
});

test('检索保留文档来源节点状态且不升级为 live 节点', async () => {
  const root = await createFixture({
    nodes: [
      {locatorId: 'quartus.root', parentId: null, canonicalName: 'Root', visibleLabel: 'Quartus',
        aliases: ['root'], role: 'application', purpose: 'work', stage: 'idle',
        verification: 'official_documentation_only', behaviorVerification: 'not_executed',
        labelFidelity: 'documented', sourceRefs: ['s1'], evidenceRefs: []},
      {locatorId: 'quartus.only-doc', parentId: 'quartus.root', canonicalName: 'DocOnly', visibleLabel: 'DocOnly',
        aliases: ['doc'], role: 'menu', purpose: 'reference', stage: 'analysis',
        verification: 'official_documentation_only', behaviorVerification: 'not_executed',
        labelFidelity: 'documented', sourceRefs: ['s1'], evidenceRefs: []}
    ]
  });
  try {
    const knowledge = await loadQuartusKnowledge(root);
    const result = retrieveQuartusKnowledge(knowledge, [{window: {processName: 'quartus'}, target: {name: 'doc'}}], null, 16);
    assert.ok(result.entries.every((entry) => entry.verification === 'official_documentation_only'));
    assert.equal(result.entries[0].evidenceRefs.length, 0);
  } finally {
    await cleanup(root);
  }
});

const REAL_MAPPED_ROOT = path.join(process.cwd(), 'ui-maps', 'quartus', '26.1.1-pro', 'en-US');
test('实战检测真实 merged map（可用时）', { skip: !fsSync.existsSync(REAL_MAPPED_ROOT) }, async () => {
  if (!fsSync.existsSync(REAL_MAPPED_ROOT)) return;
  const knowledge = await loadQuartusKnowledge(REAL_MAPPED_ROOT);
  const text = knowledge.entries.map((entry) => `${entry.canonicalName} ${entry.visibleLabel} ${(entry.aliases ?? []).join(' ')}`.toLowerCase()).join('\n');
  assert.ok(text.includes('new project'), '缺少 new project 相关条目');
  assert.ok(text.includes('pin planner'), '缺少 Pin Planner 相关条目');
  assert.ok(text.includes('platform designer'), '缺少 Platform Designer 相关条目');
  assert.ok(text.includes('clock') && text.includes('reset'), '缺少 clock/reset 相关条目');
  const result = retrieveQuartusKnowledge(knowledge, [{target: {name: 'Pin Planner'}}], {application:'quartus'}, 24);
  assert.equal(result.retrieval.applicable, true);
  assert.equal(result.retrieval.matched, true);
  for(const [query,expected]of [['新建工程 顶层实体','top_level_entity'],['引脚分配 Pin Planner','pin-planner'],['Platform Designer 时钟 复位','reset-domains']]) {
    const retrieved=retrieveQuartusKnowledge(knowledge,[{text:query}],{application:'quartus'},24);
    assert.ok(retrieved.entries.some(e=>e.parameterRole===expected||e.locatorId.includes(expected)),`query failed: ${query}`);
    assert.equal(new Set(retrieved.entries.map(e=>e.locatorId)).size,retrieved.entries.length);
    assert.ok(Buffer.byteLength(JSON.stringify(retrieved))<=65536);
  }
});

test('进程过滤应拒绝非 Quartus', () => {
  for (const processName of ['mstsc', 'explorer', 'chrome', 'quartus.exe']) {
    const win = {processName};
    if (processName === 'quartus.exe') {
      assert.equal(isQuartus(win), true);
      continue;
    }
    assert.equal(isQuartus(win), false);
  }
  assert.deepEqual([...QUARTUS_PROCESSES], ['quartus']);
});

test('CLI --evidence 可检测截图 hash 不一致', async () => {
  const node = process.argv[0];
  const root = await createFixture({
    withLiveObservation: true,
    includeTwoSection: false,
    evidenceIntegrity: 'write'
  });
  try {
    const reportPath = path.join(root, 'verification-report.json');
    const cmd = node;
    const base = spawnSync(cmd, [path.join(process.cwd(), 'scripts/test-quartus-ui-map.mjs'), '--root', root, '--evidence'], {
      encoding: 'utf8'
    });
    assert.equal(base.status, 0, base.stderr);
    const evidenceFile = path.join(root, 'evidence', 'quartus.png');
    await fs.writeFile(evidenceFile, 'corrupt');
    const broken = spawnSync(cmd, [path.join(process.cwd(), 'scripts/test-quartus-ui-map.mjs'), '--root', root, '--evidence'], {
      encoding: 'utf8'
    });
    assert.notEqual(broken.status, 0);
    if (fsSync.existsSync(reportPath)) await fs.unlink(reportPath);
  } finally {
    await cleanup(root);
  }
});

async function createFixture(options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'quartus-knowledge-'));
  const defaultNodes = [
    {locatorId: 'quartus.root', parentId: null, canonicalName: 'Quartus', visibleLabel: 'Quartus Prime', aliases: ['quartus'],
      role: 'application', purpose: 'work', stage: 'idle', verification: 'live_visual_observed',
      behaviorVerification: 'navigation_observed', labelFidelity: 'observed', sourceRefs: ['s1'], evidenceRefs: ['e1']},
    {locatorId: 'quartus.root.parent', parentId: 'quartus.root', canonicalName: 'File', visibleLabel: 'File',
      aliases: ['file'], role: 'menu', purpose: 'navigate', stage: 'idle', verification: 'live_visual_observed',
      behaviorVerification: 'navigation_observed', labelFidelity: 'observed', sourceRefs: ['s1'], evidenceRefs: ['e1']},
    {locatorId: 'quartus.root.parent.child', parentId: 'quartus.root.parent', canonicalName: 'Child', visibleLabel: 'Child',
      aliases: ['child'], role: 'menu_item', purpose: 'run', stage: 'idle', verification: 'live_visual_observed',
      behaviorVerification: 'navigation_observed', labelFidelity: 'observed', sourceRefs: ['s1'], evidenceRefs: ['e1']}
  ];
  const mapNodes = (options.nodes ?? defaultNodes).map((node) => ({
    nativeIdentifier: null,
    ...node,
    sourceRefs: node.sourceRefs ?? ['s1'],
    evidenceRefs: node.evidenceRefs ?? ['e1']
  }));

  const uiSections = options.includeTwoSection ? [
    {id: 'workspace', map: 'workspace/ui-map.json', rootLocatorId: 'quartus.root'},
    {id: 'tools', map: 'tools/ui-map.json', rootLocatorId: 'quartus.tools'}
  ] : [
    {id: 'workspace', map: 'workspace/ui-map.json', rootLocatorId: 'quartus.root'}
  ];

  const liveEvidence = options.withLiveObservation ? {
    evidence: [{
      id: 'e1',
      file: 'evidence/quartus.png',
      width: 2,
      height: 2,
      mimeType: 'image/png',
      sha256: '0',
      recordedAt: '2026-01-01T00:00:00.000Z'
    }],
    observations: [],
    evidenceRootRelativeToWorkspace: '.',
    scanPasses: [],
    interactionSummary: {}
  } : {evidence: [{id:'e1',file:'evidence/quartus.png',width:2,height:2,mimeType:'image/png',sha256:'0',recordedAt:'2026-01-01T00:00:00.000Z'}]};

  if (!options.withLiveObservation) {
    liveEvidence.evidenceRootRelativeToWorkspace = '.';
  }

  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000002000000020802000000000000000000000000000000ae426082', 'hex');
  const evidencePath = path.join(root, 'evidence');
  await fs.mkdir(evidencePath, {recursive: true});
  await fs.writeFile(path.join(evidencePath, 'quartus.png'), png);
  const hash = createHash('sha256').update(png).digest('hex');
  if (liveEvidence.evidence?.[0]) liveEvidence.evidence[0].sha256 = hash;
  if (options.evidenceIntegrity === 'write' || options.withLiveObservation) {
    liveEvidence.evidence[0].mimeType = 'image/png';
    liveEvidence.evidence[0].width = 2;
    liveEvidence.evidence[0].height = 2;
  }

  const uiMap = {
    schemaVersion: '1.0',
    mapType: 'semantic_ui_section',
    mapId: 'quartus.root',
    nodes: mapNodes
  };
  const uiRoot = path.join(root, 'workspace');
  await fs.mkdir(uiRoot, {recursive: true});
  await writeJson(path.join(uiRoot, 'ui-map.json'), uiMap);

  const index = {
    schemaVersion: '1.0',
    mapId: 'quartus-root',
    sources: 'sources.json',
    liveObservation: 'live-observation.json',
    application: options.application ?? {
      name: 'Quartus Prime',
      version: '26.1.1',
      edition: 'Pro',
      language: 'en-US'
    },
    sections: uiSections,
    verificationReport: 'verification-report.json',
    counts: {
      sectionFiles: uiSections.length,
      totalSemanticNodes: mapNodes.length,
      evidenceImages: liveEvidence.evidence.length,
      officialSources: 1,
      liveVisualNodes: 0,
      unknownIdentityNodes: 0,
      documentedOnlyNodes: 0
    }
  };
  await writeJson(path.join(root, 'ui-index.json'), index);
  const sources = options.sources ?? [{id: 's1', url: 'https://www.intel.com/quartus',
    title: 'Quartus docs', readStatus: 'read', accessedOn: '2026-01-01T00:00:00Z', usage: 'docs',
    version: options.sourceVersion ?? '26.1.1'}];
  await writeJson(path.join(root, 'sources.json'), {sources});
  await writeJson(path.join(root, 'live-observation.json'), liveEvidence);

  if (options.includeTwoSection) {
    const toolsNodes = [
      {locatorId: 'quartus.tools', parentId: null, canonicalName: 'Tools', visibleLabel: 'Tools',
        aliases: ['tools'], role: 'panel', purpose: 'work', stage: 'idle',
        verification: 'live_visual_observed', behaviorVerification: 'navigation_observed', labelFidelity: 'observed',
        sourceRefs: ['s1'], evidenceRefs: ['e1'], parentId: 'quartus.root', nativeIdentifier:null}
    ];
    const toolsPath = path.join(root, 'tools');
    await fs.mkdir(toolsPath, {recursive: true});
    await writeJson(path.join(toolsPath, 'ui-map.json'), {
      schemaVersion: '1.0',
      mapType: 'semantic_ui_section',
      mapId: 'quartus.tools',
      nodes: toolsNodes
    });
  }

  return root;
}

async function writeJson(filePath, content) {
  await fs.writeFile(filePath, JSON.stringify(content), 'utf8');
}

async function cleanup(root) {
  await fs.rm(root, {recursive: true, force: true});
}
