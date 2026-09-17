import fs from 'node:fs/promises';
import path from 'node:path';

export const QUARTUS_PROCESSES = new Set(['quartus']);

export const processName = (window) => String(window?.processName ?? '')
  .toLowerCase()
  .replace(/\.exe$/i, '');

export const isQuartus = (window) => QUARTUS_PROCESSES.has(processName(window));

const ALLOWED_VERIFICATION = new Set(['live_visual_observed', 'official_documentation_only', 'unknown_identity']);
const SOURCE_PROVENANCE_ONLY = new Set(['official_documentation_only']);
const OFFICIAL_DOC_DOMAINS = ['docs.altera.com', 'resources.altera.com', 'intel.com'];
const VERBOSITY_STOPWORDS = new Set([
  'button', 'menu', 'window', 'dialog', 'press', 'click', 'double', 'single', 'left', 'right',
  'the', 'and', 'for', 'with', 'from', 'into', 'tool', 'panel',
  'tab', 'page', 'quartus', 'prime', 'application'
]);
const STATIC_KEY_BLACKLIST = new Set([
  'bounds', 'x', 'y', 'screenx', 'screeny', 'enabled', 'checked', 'displayedvalue',
  'automationid', 'commandid'
]);
const MAX_RETRIEVAL_BUDGET = 100;
const OFFICIAL_DOC_SOURCE_FIELDS = ['id', 'url', 'title', 'version', 'readStatus', 'accessedOn'];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function toTextTokens(value) {
  if (!value) return [];
  return String(value).toLowerCase().normalize('NFKC')
    .match(/[\p{L}\p{N}]+/gu)
    ?.map((token) => token.trim())
    .filter((token) => token.length > 1 && !VERBOSITY_STOPWORDS.has(token)) ?? [];
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

function assertOfficialSource(source, ref, locatorId) {
  assert(source.url && isOfficialDocSource(source.url),
    `文档来源必须来自官方域: ${ref} on ${locatorId}`);
  assert(source.readStatus === 'read', `文档来源未确认读取: ${ref} on ${locatorId}`);
  for (const field of OFFICIAL_DOC_SOURCE_FIELDS) {
    assert(typeof source[field] === 'string' && source[field].length > 0, `${field} 缺失: ${ref} on ${locatorId}`);
  }
}

function assertEvidenceMetadata(evidence, ref) {
  assert(typeof evidence.id === 'string' && evidence.id.length > 0, `evidence.id 不能为空: ${ref}`);
  assert(typeof evidence.file === 'string' && evidence.file.length > 0, `evidence.file 不能为空: ${ref}`);
  assert(!path.isAbsolute(evidence.file), `evidence.file 不能为绝对路径: ${ref}`);
  assert(!evidence.file.includes('..'), `evidence.file 不可包含父级跳转: ${ref}`);
  assert(!evidence.file.includes('\\'), `evidence.file 应使用 POSIX 分隔: ${ref}`);
  assert(typeof evidence.width === 'number' && evidence.width > 0, `evidence.width 无效: ${ref}`);
  assert(typeof evidence.height === 'number' && evidence.height > 0, `evidence.height 无效: ${ref}`);
  assert(typeof evidence.mimeType === 'string' && evidence.mimeType.length > 0, `evidence.mimeType 无效: ${ref}`);
  assert(Number.isInteger(Number(evidence.width)), `evidence.width 类型错误: ${ref}`);
  assert(Number.isInteger(Number(evidence.height)), `evidence.height 类型错误: ${ref}`);
  assert(/^[a-f0-9]{64}$/i.test(evidence.sha256 ?? ''), `evidence.sha256 无效: ${ref}`);
  assert(!Number.isNaN(Date.parse(evidence.recordedAt)), `evidence.recordedAt 无效: ${ref}`);
}

function scanForStaticKeys(obj, pathPrefix = '') {
  if (Array.isArray(obj)) {
    for (const item of obj) scanForStaticKeys(item, `${pathPrefix}[]`);
    return;
  }
  if (!obj || typeof obj !== 'object') return;
  for (const [key, value] of Object.entries(obj)) {
    const normalized = key.toLowerCase();
    if (STATIC_KEY_BLACKLIST.has(normalized)) {
      throw new Error(`静态语义表泄露运行时键: ${pathPrefix ? `${pathPrefix}.` : ''}${key}`);
    }
    scanForStaticKeys(value, pathPrefix ? `${pathPrefix}.${key}` : key);
  }
}

async function ensureNotSymlink(filePath) {
  const root = path.parse(filePath).root;
  let cursor = root;
  const rest = filePath.slice(root.length);
  const parts = rest.split(path.sep).filter(Boolean);
  for (const part of parts) {
    cursor = path.join(cursor, part);
    const stat = await fs.lstat(cursor);
    if (stat.isSymbolicLink()) {
      throw new Error(`路径包含符号链接，拒绝加载: ${filePath}`);
    }
  }
}

function resolveWorkspacePath(root, relative, label) {
  assert(typeof relative === 'string' && relative.length > 0, `${label} 不能为空`);
  assert(!path.isAbsolute(relative), `${label} 不能为绝对路径: ${relative}`);
  assert(!relative.includes('\\'), `${label} 不能包含 Windows 反斜杠: ${relative}`);
  const normalized = path.normalize(relative);
  const segments = normalized.split(path.sep).map((part) => part.trim()).filter(Boolean);
  assert(!segments.includes('..'), `${label} 不可跳出根目录: ${relative}`);
  const target = path.resolve(root, relative);
  const rel = path.relative(root, target);
  assert(rel && !rel.startsWith('..') && !path.isAbsolute(rel), `路径越界: ${relative}`);
  return target;
}

function normalizeNode(node, section, sourceById, evidenceById) {
  assert(typeof node.locatorId === 'string' && node.locatorId.length > 0, '缺少 locatorId');
  assert(node.locatorId.startsWith('quartus.'),
    `locatorId 必须以 quartus. 开头: ${node.locatorId}`);
  assert(node.canonicalName && typeof node.canonicalName === 'string', `缺少 canonicalName: ${node.locatorId}`);
  assert(Array.isArray(node.aliases), `aliases 必须是数组: ${node.locatorId}`);
  assert(node.visibleLabel === null || typeof node.visibleLabel === 'string', `visibleLabel 类型错误: ${node.locatorId}`);
  assert(node.role && typeof node.role === 'string', `role 缺失: ${node.locatorId}`);
  assert(node.purpose && typeof node.purpose === 'string', `purpose 缺失: ${node.locatorId}`);
  assert(node.stage && typeof node.stage === 'string', `stage 缺失: ${node.locatorId}`);
  assert(ALLOWED_VERIFICATION.has(node.verification), `未知 verification: ${node.locatorId}`);
  assert(typeof node.behaviorVerification === 'string' && node.behaviorVerification.length > 0,
    `behaviorVerification 不能为空: ${node.locatorId}`);
  assert(typeof node.labelFidelity === 'string' && node.labelFidelity.length > 0,
    `labelFidelity 不能为空: ${node.locatorId}`);
  assert(node.nativeIdentifier === null, `nativeIdentifier 应为 null: ${node.locatorId}`);
  assert(!node.sourceRefs || Array.isArray(node.sourceRefs), `sourceRefs 必须数组: ${node.locatorId}`);
  assert(!node.evidenceRefs || Array.isArray(node.evidenceRefs), `evidenceRefs 必须数组: ${node.locatorId}`);

  const sourceRefs = node.sourceRefs ?? [];
  for (const ref of sourceRefs) {
    assert(sourceById.has(ref), `未知 sourceRef ${ref} on ${node.locatorId}`);
    const source = sourceById.get(ref);
    if (SOURCE_PROVENANCE_ONLY.has(node.verification)) {
      assertOfficialSource(source, ref, node.locatorId);
    }
  }
  const evidenceRefs = node.evidenceRefs ?? [];
  for (const ref of evidenceRefs) assert(evidenceById.has(ref), `未知 evidenceRef ${ref} on ${node.locatorId}`);
  if (SOURCE_PROVENANCE_ONLY.has(node.verification)) {
    assert(evidenceRefs.length === 0, `文档来源节点不能有 live evidence: ${node.locatorId}`);
    assert(node.behaviorVerification === 'not_executed',
      `文档来源节点行为核验应为 not_executed: ${node.locatorId}`);
  }
  if (node.verification === 'live_visual_observed') {
    assert(evidenceRefs.length > 0, `live_visual 节点必须有 evidenceRefs: ${node.locatorId}`);
  }
  assert(node.verification !== 'official_documentation_only' || sourceRefs.length > 0,
    `文档来源节点必须保留 sourceRefs: ${node.locatorId}`);

  const searchable = [
    node.canonicalName,
    node.visibleLabel,
    ...(node.aliases ?? []),
    node.role,
    node.purpose,
    node.stage,
    ...((node.sectionKeywords ?? []))
  ].join(' ').toLowerCase();

  return {
    locatorId: node.locatorId,
    parentId: node.parentId ?? null,
    canonicalName: node.canonicalName,
    visibleLabel: node.visibleLabel,
    aliases: [...node.aliases],
    role: node.role,
    purpose: node.purpose,
    stage: node.stage,
    verification: node.verification,
    behaviorVerification: node.behaviorVerification,
    labelFidelity: node.labelFidelity,
    nativeIdentifier: null,
    sourceRefs,
    evidenceRefs,
    parameterRole: node.parameterRole ?? null,
    unit: node.unit ?? null,
    sectionId: section.id,
    sectionRootLocatorId: section.rootLocatorId,
    searchable,
    opensMap: node.opensMap ?? null,
    relatedMap: node.relatedMap ?? null,
    mapPath: section.map
  };
}

export async function loadQuartusKnowledge(root) {
  const rootPath = path.resolve(root);
  const indexPath = path.resolve(rootPath, 'ui-index.json');
  await ensureNotSymlink(indexPath);
  const index = JSON.parse(await fs.readFile(indexPath, 'utf8'));
  assert(index?.schemaVersion === '1.0', 'UI Map schemaVersion 必须为 1.0');
  assert(index?.mapId, '缺少 mapId');
  assert(index?.application, '缺少 application');
  assert(index.application.name === 'Quartus Prime', `不是 Quartus 知识库: ${index.application?.name}`);
  assert(index.application.version === '26.1.1', `版本不匹配: ${index.application?.version}`);
  assert(index.application.edition === 'Pro', `版本分支不匹配: ${index.application?.edition}`);
  assert(index.application.language === 'en-US', `语言不匹配: ${index.application?.language}`);
  assert(Array.isArray(index.sections) && index.sections.length > 0, 'sections 不能为空');

  const sourcesPath = resolveWorkspacePath(rootPath, index.sources, 'index.sources');
  const liveObservationPath = resolveWorkspacePath(rootPath, index.liveObservation, 'index.liveObservation');
  await ensureNotSymlink(sourcesPath);
  await ensureNotSymlink(liveObservationPath);
  const sourcesDoc = JSON.parse(await fs.readFile(sourcesPath, 'utf8'));
  const liveObservation = JSON.parse(await fs.readFile(liveObservationPath, 'utf8'));

  assert(Array.isArray(sourcesDoc.sources), 'sources.sources 必须是数组');
  const sourceById = new Map();
  for (const source of sourcesDoc.sources) {
    assert(typeof source.id === 'string' && source.id.length > 0, 'source.id 不能为空');
    assert(!sourceById.has(source.id), `重复 source id: ${source.id}`);
    sourceById.set(source.id, { ...source });
  }

  const evidenceById = new Map();
  if (Array.isArray(liveObservation.evidence)) {
    for (const item of liveObservation.evidence) {
      assert(typeof item.id === 'string' && item.id.length > 0, 'evidence.id 不能为空');
      assert(!evidenceById.has(item.id), `重复 evidence id: ${item.id}`);
      assertEvidenceMetadata(item, item.id);
      evidenceById.set(item.id, item);
    }
  }

  const sectionMapFiles = new Set();
  const nodes = [];
  const nodeById = new Map();
  const sectionFileNames = new Set();
  const sectionIds = new Set();

  for (const section of index.sections) {
    assert(typeof section.id === 'string' && section.id.length > 0, 'section.id 不能为空');
    assert(!sectionIds.has(section.id), `重复 section id: ${section.id}`);
    sectionIds.add(section.id);
    assert(typeof section.map === 'string' && section.map.length > 0, 'section.map 不能为空');
    assert(typeof section.rootLocatorId === 'string' && section.rootLocatorId.length > 0, 'section.rootLocatorId 不能为空');
    if (sectionFileNames.has(section.map)) throw new Error(`重复 section map: ${section.map}`);
    sectionFileNames.add(section.map);

    const mapPath = resolveWorkspacePath(rootPath, section.map, `section ${section.id} map`);
    sectionMapFiles.add(section.map);
    await ensureNotSymlink(mapPath);
    const map = JSON.parse(await fs.readFile(mapPath, 'utf8'));
    assert(map?.schemaVersion === '1.0', `section map schemaVersion 错误: ${section.id}`);
    assert(map?.mapType === 'semantic_ui_section', `section mapType 非 semantic_ui_section: ${section.id}`);
    assert(map?.mapId === section.rootLocatorId, `section mapId 不一致: ${section.id}`);
    assert(Array.isArray(map?.nodes), `section nodes 必须为数组: ${section.id}`);
    assert(map.nodes.some((node) => node.locatorId === section.rootLocatorId), `缺少分区根节点: ${section.id}`);
    scanForStaticKeys(map);

    for (const node of map.nodes) {
      const normalized = normalizeNode(node, section, sourceById, evidenceById);
      if (nodeById.has(normalized.locatorId)) throw new Error(`重复 locatorId: ${normalized.locatorId}`);
      nodeById.set(normalized.locatorId, normalized);
      nodes.push(normalized);
      if (normalized.opensMap) sectionMapFiles.add(normalized.opensMap);
      if (normalized.relatedMap) sectionMapFiles.add(normalized.relatedMap);
    }
  }

  for (const section of index.sections) {
    const mapPath = resolveWorkspacePath(rootPath, section.map, `section ${section.id} map`);
    await ensureNotSymlink(mapPath);
    const map = JSON.parse(await fs.readFile(mapPath, 'utf8'));
    for (const node of map.nodes) {
      const locator = nodeById.get(node.locatorId);
      if (locator.parentId !== null && locator.parentId !== undefined) {
        assert(nodeById.has(locator.parentId), `缺少父节点 ${locator.parentId}: ${locator.locatorId}`);
      }
      if (locator.opensMap) assert(sectionFileNames.has(locator.opensMap),
        `未知 opensMap 引用 ${locator.locatorId} -> ${locator.opensMap}`);
      if (locator.relatedMap) assert(sectionFileNames.has(locator.relatedMap),
        `未知 relatedMap 引用 ${locator.locatorId} -> ${locator.relatedMap}`);
    }
  }

  for (const node of nodes) {
    const seen = new Set();
    let current = node.locatorId;
    while (true) {
      assert(!seen.has(current), `parent cycle: ${node.locatorId}`);
      seen.add(current);
      const parent = nodeById.get(current)?.parentId;
      if (!parent) break;
      assert(nodeById.has(parent), `缺失父节点 ${parent}: ${node.locatorId}`);
      current = parent;
    }
  }
  const rootLocatorIds = new Set([...nodes].map((node) => {
    let current = node.locatorId;
    while (nodeById.get(current)?.parentId) {
      current = nodeById.get(current).parentId;
    }
    return current;
  }));
  assert(rootLocatorIds.size === 1, `必须有且仅有一个无父节点根节点: ${[...rootLocatorIds].join(', ')}`);

  return {
    metadata: {
      mapId: index.mapId,
      application: { ...index.application },
      schemaVersion: index.schemaVersion
    },
    root: rootPath,
    index,
    sources: sourcesDoc,
    liveObservation,
    sourceById,
    evidenceById,
    sectionMaps: [...sectionFileNames],
    entries: nodes
  };
}

export function retrieveQuartusKnowledge(knowledge, actions, previousState = null, limit = 24) {
  const limitValue = Number(limit);
  assert(Number.isInteger(limitValue) && limitValue > 0 && limitValue <= MAX_RETRIEVAL_BUDGET,
    '检索上限应为 1..100');
  if (!knowledge || !Array.isArray(knowledge.entries) || knowledge.entries.length === 0) {
    return {
      metadata: knowledge?.metadata ?? null,
      entries: [],
      retrieval: {
        applicable: false,
        matched: false,
        ambiguity: 0,
        ambiguityReasons: ['未加载 Quartus 知识库']
      },
      identifierPolicy: 'reference is semantic locatorId only; no AutomationId/runtime ID is used as truth'
    };
  }

  const actionList = Array.isArray(actions) ? actions : [];
  const hasQuartusWindow = actionList.some((action) => isQuartus(action?.window));
  const sectionContext = previousState?.sectionId ?? previousState?.section ?? null;
  const knownSections = new Set((knowledge.index?.sections ?? []).map((section) => section.id));
  const sectionContextKnown = typeof sectionContext === 'string' && sectionContext.length > 0 && knownSections.has(sectionContext);
  const appContext = String(previousState?.application ?? '').toLowerCase() === 'quartus'
    || previousState?.processName === 'quartus';
  if (typeof sectionContext === 'string' && sectionContext.length > 0 && !sectionContextKnown) {
    return {
      metadata: knowledge.metadata ?? null,
      entries: [],
      retrieval: {
        applicable: false,
        matched: false,
        ambiguity: 0,
        ambiguityReasons: ['未知 section 上下文']
      },
      identifierPolicy: 'reference is semantic locatorId only; no AutomationId/runtime ID is used as truth'
    };
  }
  if (!hasQuartusWindow && !appContext && !sectionContext) {
    return {
      metadata: knowledge.metadata ?? null,
      entries: [],
      retrieval: {
        applicable: false,
        matched: false,
        ambiguity: 0,
        ambiguityReasons: ['非 Quartus 会话上下文']
      },
      identifierPolicy: 'reference is semantic locatorId only; no AutomationId/runtime ID is used as truth'
    };
  }

  const rawTokens = [
    ...actionList.flatMap((action) => [
      action?.window?.title,
      action?.text,
      action?.value,
      action?.target?.name,
      action?.target?.label,
      action?.target?.text,
      action?.target?.visibleLabel,
      action?.visualText,
      action?.observedText,
      ...(action?.target?.ancestors ?? []).map((x) => x?.name).filter(Boolean),
      ...(action?.observation?.texts ?? [])
    ]),
  ].filter(Boolean).join(' ');
  const tokens = Array.from(new Set(toTextTokens(rawTokens)));
  const scopedEntries = sectionContextKnown
    ? knowledge.entries.filter((entry) => entry.sectionId === sectionContext)
    : knowledge.entries;
  const ranked = scopedEntries.map((entry) => {
    const candidateText = `${entry.searchable} ${entry.sectionId}`.toLowerCase();
    let score = 0;
    for (const token of tokens) {
      if (candidateText.includes(token)) score += Math.max(1, token.length / 2);
    }
    return { entry, score };
  });
  ranked.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return left.entry.locatorId.localeCompare(right.entry.locatorId);
  });

  const matches = ranked.filter((item) => item.score > 0);
  const chosenRaw = matches.length ? matches : ranked.slice(0, 6);
  const chosen = [];
  const chosenSet = new Set();
  const truncation = { requestedLimit: limitValue, dropped: false };
  const byId = new Map(knowledge.entries.map((entry) => [entry.locatorId, entry]));
  const unresolvedTokens = tokens.filter((token) =>
    scopedEntries.every((entry) => !entry.searchable.toLowerCase().includes(token)));

  for (const item of chosenRaw) {
    if (chosen.length >= limitValue) break;
    const chain = [];
    let cursor = item.entry;
    const visited = new Set();
    while (cursor && !visited.has(cursor.locatorId)) {
      chain.push(cursor);
      visited.add(cursor.locatorId);
      if (!cursor.parentId) break;
      cursor = byId.get(cursor.parentId) ?? null;
    }
    for (let i = 0; i < chain.length; i++) {
      const node = chain[i];
      if (chosen.length >= limitValue) {
        truncation.dropped = true;
        break;
      }
      if (!chosenSet.has(node.locatorId)) {
        chosen.push(node);
        chosenSet.add(node.locatorId);
      }
    }
  }

  const resultEntries = chosen.map((entry) => ({
    locatorId: entry.locatorId,
    sectionId: entry.sectionId,
    parentId: entry.parentId,
    canonicalName: entry.canonicalName,
    visibleLabel: entry.visibleLabel,
    aliases: entry.aliases,
    role: entry.role,
    purpose: entry.purpose,
    stage: entry.stage,
    verification: entry.verification,
    behaviorVerification: entry.behaviorVerification,
    labelFidelity: entry.labelFidelity,
    parameterRole: entry.parameterRole,
    unit: entry.unit,
    opensMap: entry.opensMap,
    relatedMap: entry.relatedMap,
    sourceRefs: entry.sourceRefs,
    evidenceRefs: entry.evidenceRefs,
    ancestorIds: (() => {
      const chain = [];
      let cursor = entry;
      while (cursor?.parentId) {
        cursor = byId.get(cursor.parentId);
        if (!cursor) break;
        chain.push(cursor.locatorId);
      }
      return chain;
    })(),
    matchScore: matches.find((item) => item.entry.locatorId === entry.locatorId)?.score ?? 0
  }));

  const hasMatchedScores = resultEntries.some((entry) => entry.matchScore > 0);
  const top = ranked[0]?.score ?? 0;
  const second = ranked[1]?.score ?? 0;
  const ambiguity = matches.length >= 2 && top > 0 && Math.abs(top - second) < 1;
  const fallbackUsed = matches.length === 0;
  const result = {
    metadata: knowledge.metadata,
    entries: resultEntries,
    identifierPolicy: 'reference is a semantic repository ID, not AutomationId/runtime ID. No live bounds or runtime IDs are treated as current truth.',
    retrieval: {
      applicable: true,
      sectionContext,
      sectionContextKnown,
      tokens,
      matched: hasMatchedScores,
      fallbackUsed,
      unmatchedTokens: unresolvedTokens,
      ambiguity: ambiguity ? 1 : 0,
      ambiguityReasons: ambiguity ? ['多候选项分值接近，返回不确定候选集合'] : [],
      hierarchyBudgetUsed: resultEntries.length,
      limit: limitValue,
      truncation,
      warning: hasMatchedScores ? null : '未命中语义匹配，仅返回上下文候选用于审计'
    }
  };
  // Bound the serialized context as well as the node count. Evidence is metadata only.
  const refreshProvenance = () => {
    const sources = new Set(result.entries.flatMap(e => e.sourceRefs));
    const evidence = new Set(result.entries.flatMap(e => e.evidenceRefs));
    result.sourceDetails = [...sources].map(id => {
      const s = knowledge.sourceById.get(id);
      return {id, title:s.title, url:s.url, version:s.version, readStatus:s.readStatus, readScope:s.readScope};
    });
    result.evidenceDetails = [...evidence].map(id => {
      const e=knowledge.evidenceById.get(id);
      return {id, file:e.file, recordedAt:e.recordedAt, sha256:e.sha256, width:e.width, height:e.height};
    });
  };
  result.retrieval.maxContextBytes = 65536;
  result.retrieval.truncation.dropped ||= chosenSet.size < new Set(chosenRaw.map(x=>x.entry.locatorId)).size;
  result.retrieval.tokens = result.retrieval.tokens.slice(0,128).map(t=>t.slice(0,128));
  result.retrieval.unmatchedTokens = result.retrieval.unmatchedTokens.slice(0,128).map(t=>t.slice(0,128));
  refreshProvenance();
  while (Buffer.byteLength(JSON.stringify(result)) > result.retrieval.maxContextBytes && result.entries.length) {
    result.entries.pop();
    result.retrieval.truncation.dropped=true;
    refreshProvenance();
  }
  result.retrieval.hierarchyBudgetUsed=result.entries.length;
  result.retrieval.matched=result.entries.some(e=>e.matchScore>0);
  return result;
}
