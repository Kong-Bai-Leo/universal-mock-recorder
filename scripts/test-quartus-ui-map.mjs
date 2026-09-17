import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {loadQuartusKnowledge} from '../src/analyzer/lib/quartus-knowledge.mjs';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const options = { evidence: false, writeReport: false };
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--evidence') options.evidence = true;
  else if (arg === '--write-report') options.writeReport = true;
  else if (arg === '--root') {
    assert(i + 1 < args.length, 'Missing --root value');
    options.root = path.resolve(args[++i]);
  } else {
    assert(false, `Unknown option: ${arg}`);
  }
}
const root = options.root ?? path.join(workspace, 'ui-maps', 'quartus', '26.1.1-pro', 'en-US');

function within(rootDir, relative) {
  assert.equal(typeof relative, 'string');
  if (relative === '.') return rootDir;
  assert(!path.isAbsolute(relative), `Expected relative path: ${relative}`);
  assert(!relative.includes('\\'), `Expected portable relative path: ${relative}`);
  const target = path.resolve(rootDir, relative);
  const rel = path.relative(rootDir, target);
  assert((rel === '' || rel && !rel.startsWith('..') && !path.isAbsolute(rel)), `Path escapes root: ${relative}`);
  return target;
}

const ALLOWED_SOURCE_KEYS = new Set([
  'official_documentation_only',
  'live_visual_observed',
  'unknown_identity'
]);
const FORBIDDEN_STATIC_KEYS = new Set([
  'bounds', 'x', 'y', 'screenX', 'screenY', 'enabled', 'checked', 'displayedValue',
  'automationId', 'commandId'
]);
const OFFICIAL_DOC_DOMAINS = ['docs.altera.com', 'resources.altera.com', 'intel.com'];
const OFFICIAL_DOC_SOURCE_FIELDS = ['id', 'url', 'title', 'version', 'readStatus', 'accessedOn'];
function inspectStatic(obj) {
  if (Array.isArray(obj)) return obj.forEach(inspectStatic);
  if (!obj || typeof obj !== 'object') return;
  for (const [key, value] of Object.entries(obj)) {
    assert(![...FORBIDDEN_STATIC_KEYS].some(k=>k.toLowerCase()===key.toLowerCase()), `snapshot/native key leaked into semantic map: ${key}`);
    inspectStatic(value);
  }
}

function isOfficialDocSource(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password
      && OFFICIAL_DOC_DOMAINS.some((domain) => host === domain || (domain === 'intel.com' && host.endsWith('.intel.com')));
  } catch (error) {
    return false;
  }
}

function imageDimensions(bytes) {
  if (bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') {
    return {width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), mimeType: 'image/png'};
  }
  assert(bytes[0] === 0xff && bytes[1] === 0xd8, 'Unrecognized screenshot encoding');
  let offset = 2;
  while (offset < bytes.length) {
    assert.equal(bytes[offset++], 0xff, 'Invalid JPEG marker');
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const length = bytes.readUInt16BE(offset);
    assert(length >= 2 && offset + length <= bytes.length, 'Invalid JPEG segment length');
    if ([0xc0,0xc1,0xc2,0xC3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
      return {width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3), mimeType: 'image/jpeg'};
    }
    offset += length;
  }
  throw new Error('JPEG dimensions not found');
}

async function assertLocalFile(file) {
  const absolute=path.resolve(file);
  let cursor=path.parse(absolute).root;
  for(const part of absolute.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor=path.join(cursor,part);
    assert(!(await fs.lstat(cursor)).isSymbolicLink(), `Symlink disallowed: ${file}`);
  }
}
const parseJson = async (file) => { await assertLocalFile(file); return JSON.parse(await fs.readFile(file, 'utf8')); };
const index = await parseJson(path.join(root, 'ui-index.json'));
assert.equal(index.application.name, 'Quartus Prime');
assert.equal(index.application.version, '26.1.1');
assert.equal(index.application.edition, 'Pro');
assert.equal(index.application.language, 'en-US');
assert.equal(index.schemaVersion, '1.0');

const sourceData = await parseJson(within(root, index.sources));
const live = await parseJson(within(root, index.liveObservation));

const sourceMap = new Map();
for (const source of sourceData.sources ?? []) {
  assert(!sourceMap.has(source.id), `Duplicate source: ${source.id}`);
  assert.equal(typeof source.url, 'string');
  assert.equal(source.readStatus, 'read');
  assert.ok(source.id && source.title && source.version && source.accessedOn);
  sourceMap.set(source.id, source);
}

const evidenceMap = new Map();
for (const item of live.evidence ?? []) {
  assert(!evidenceMap.has(item.id), `Duplicate evidence: ${item.id}`);
  assert(/^[a-f0-9]{64}$/i.test(item.sha256), `Invalid sha256: ${item.id}`);
  assert(Number.isFinite(Date.parse(item.recordedAt)), `Invalid recordedAt: ${item.id}`);
  assert(item.width > 0 && item.height > 0, `Invalid bounds size: ${item.id}`);
  evidenceMap.set(item.id, item);
}

const knowledge = await loadQuartusKnowledge(root);
const sectionFiles = new Set(index.sections.map((section) => section.map));
assert.equal(sectionFiles.size, index.sections.length, 'Duplicate section map');
const knownNodes = new Set();
const sectionRoots = new Map(index.sections.map((section) => [section.rootLocatorId, section.id]));
const staticObjects = [index, sourceData];

for (const section of index.sections) {
  const map = await parseJson(within(root, section.map));
  staticObjects.push(map);
  assert.equal(map.mapType, 'semantic_ui_section');
  assert.equal(map.schemaVersion, '1.0');
  assert.equal(map.mapId, section.rootLocatorId);
  assert(map.nodes.some((item) => item.locatorId === section.rootLocatorId), `Section root missing: ${section.id}`);

for (const node of map.nodes) {
    assert(!knownNodes.has(node.locatorId), `Duplicate locator: ${node.locatorId}`);
    knownNodes.add(node.locatorId);
    assert(typeof node.locatorId === 'string');
    assert(typeof node.canonicalName === 'string');
    assert(Array.isArray(node.aliases));
    assert(ALLOWED_SOURCE_KEYS.has(node.verification), `Invalid verification: ${node.locatorId}`);
    assert(typeof node.behaviorVerification === 'string' && node.behaviorVerification.length > 0);
    assert(typeof node.labelFidelity === 'string' && node.labelFidelity.length > 0);
    assert.equal(node.nativeIdentifier, null, `Invented native identifier: ${node.locatorId}`);
    const refs = node.sourceRefs ?? [];
    const evidences = node.evidenceRefs ?? [];
    for (const ref of refs) {
      const source = sourceMap.get(ref);
      assert(source, `Unknown source: ${ref}`);
      if (node.verification === 'official_documentation_only') {
        assert(isOfficialDocSource(source.url), `Source url outside official domain: ${ref} (${source.url})`);
        assert(source.readStatus === 'read', `Source not read: ${ref}`);
        for (const field of OFFICIAL_DOC_SOURCE_FIELDS) {
          assert(source[field], `Source missing ${field}: ${ref}`);
        }
      }
    }
    for (const ref of refs) assert(sourceMap.has(ref), `Unknown source: ${ref}`);
    for (const ref of evidences) assert(evidenceMap.has(ref), `Unknown evidence: ${ref}`);
    if (node.verification === 'official_documentation_only') {
      assert.equal(evidences.length, 0);
      assert.equal(node.behaviorVerification, 'not_executed');
    } else if(node.verification === 'live_visual_observed') {
      assert(evidences.length > 0, `Live-relevant node without evidence: ${node.locatorId}`);
    }
    if (node.verification === 'unknown_identity') assert.equal(node.visibleLabel, null);
    for (const key of ['opensMap', 'relatedMap']) {
      if (node[key]) assert(sectionFiles.has(node[key]), `Unresolved map reference: ${node[key]}`);
    }

    if (node.parentId) {
      const p = node.parentId;
      assert(knownNodes.has(p) || map.nodes.some((item) => item.locatorId === p),
        `Unknown parent ${p} for ${node.locatorId}`);
    }
    if (node.role === 'split_button') {
      const children = map.nodes.filter((item) => item.parentId === node.locatorId);
      const parts = children.map((item) => item.part);
      assert(parts.includes('primary_action'), `Missing split button primary_action: ${node.locatorId}`);
      assert(parts.includes('dropdown'), `Missing split button dropdown: ${node.locatorId}`);
    }
  }
}

for (const node of knowledge.entries) {
  const chain = new Set([node.locatorId]);
  let current = node.parentId;
  while (current) {
    assert(knownNodes.has(current), `Missing parent ${current}`);
    assert(!chain.has(current), `Parent cycle at ${current}`);
    chain.add(current);
    current = knowledge.entries.find((entry) => entry.locatorId === current)?.parentId ?? null;
  }
}

  let verifiedImages = 0;
  if (options.evidence) {
    assert(live.evidencePathBase === undefined || ['workspace','map'].includes(live.evidencePathBase), 'Invalid evidence path base');
    const evidenceRoot = live.evidencePathBase === 'workspace' ? workspace : root;
    for (const item of evidenceMap.values()) {
      const file = within(evidenceRoot, item.file);
      await assertLocalFile(file);
      await fs.access(file).catch(() => {
        throw new Error(`Evidence file missing: ${file}`);
      });
      const bytes = await fs.readFile(file);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256, `Evidence changed: ${item.id}`);
      const dims = imageDimensions(bytes);
      assert.equal(dims.width, item.width);
      assert.equal(dims.height, item.height);
      assert.equal(dims.mimeType, item.mimeType);
      verifiedImages += 1;
    }
  }

const counts = {
  sectionFiles: sectionFiles.size,
  totalSemanticNodes: knownNodes.size,
  evidenceImages: evidenceMap.size,
  officialSources: sourceMap.size,
  liveVisualNodes: knowledge.entries.filter((entry) => entry.verification === 'live_visual_observed').length,
  unknownIdentityNodes: knowledge.entries.filter((entry) => entry.verification === 'unknown_identity').length,
  documentedOnlyNodes: knowledge.entries.filter((entry) => entry.verification === 'official_documentation_only').length
};
inspectStatic(staticObjects);
const report = {
  schemaVersion: '1.0',
  verifiedAt: new Date().toISOString(),
  result: 'passed',
  checks: [
    'SchemaVersion/application/version/edition/language',
    'Section map schema and section roots',
    'Static semantic/evidence/reference invariants',
    'Parent hierarchy and split-button child ownership',
    'Source and evidence ref integrity'
  ],
  structureAndProvenance: {
    passed: true,
    details: ['UI Map 结构校验通过', '引用关系通过', '文档节点与动态证据边界通过'],
    provenance: {
      index: path.relative(workspace, path.join(root, 'ui-index.json')),
      sourceCount: sourceMap.size,
      evidenceCount: evidenceMap.size
    }
  },
  uiCoverage: {
    tested: 'untested',
    note: '本脚本只做结构与证据完整性校验，不涉及真实 UI 行为覆盖'
  },
  behavior: {
    tested: 'untested',
    note: '未运行 Quartus 实机回放、AI 分析或截图识别流程'
  },
  counts,
  evidenceVerification: {
    requested: options.evidence,
    imagesChecked: verifiedImages ?? 0
  },
  limits: [
    '仅离线校验',
    '仅报告可审计结构、来源与证据完整性'
  ]
};

const reportRelativePath = index.verificationReport ?? 'verification-report.json';
if (options.writeReport) {
  const reportFile=within(root,reportRelativePath);
  await assertLocalFile(path.dirname(reportFile));
  try { await assertLocalFile(reportFile); } catch(error) { if(error.code!=='ENOENT')throw error; }
  await fs.writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(report, null, 2));
