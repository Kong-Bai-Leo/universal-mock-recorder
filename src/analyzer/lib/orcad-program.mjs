// OrCAD X Capture 24.1 P001: deliberately narrow, data-only recording contract.
// This validates a proposed edit plan; it does not establish a safe runtime page.
const fail = message => { throw new Error(`OrCAD: ${message}`); };
const idPattern = /^[A-Za-z][A-Za-z0-9_-]{0,79}$/;
const pagePattern = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const aliasPattern = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const own = (value, key) => Object.hasOwn(value, key);
const object = (value, keys, at) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${at} must be object`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${at}.${key} unexpected field`);
  for (const key of keys) if (!own(value, key)) fail(`${at}.${key} missing`);
};
const array = (value, at, limit = 128) => {
  if (!Array.isArray(value) || value.length > limit) fail(`${at} invalid array`);
};
const identifier = (value, at) => {
  if (typeof value !== 'string' || !idPattern.test(value)) fail(`${at} invalid ID`);
};
const refs = (value, at, allowed, nonempty = true) => {
  array(value, at);
  if ((nonempty && !value.length) || new Set(value).size !== value.length) fail(`${at} missing/duplicate evidence`);
  for (const ref of value) {
    identifier(ref, at);
    if (!allowed.has(ref)) fail(`${at} unknown evidence ID ${ref}`);
  }
};
const finite = (value, at) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${at} must be a known finite number`);
};
const equal = (a, b) => Math.abs(a - b) < 1e-9;
const pointEqual = (a, b) => equal(a.x, b.x) && equal(a.y, b.y);
const between = (x, a, b) => x >= Math.min(a, b) - 1e-9 && x <= Math.max(a, b) + 1e-9;
const onSegment = (point, wire) => wire.horizontal
  ? equal(point.y, wire.a.y) && between(point.x, wire.a.x, wire.b.x)
  : equal(point.x, wire.a.x) && between(point.y, wire.a.y, wire.b.y);
const touches = (a, b) => [a.a, a.b].some(p => onSegment(p, b)) || [b.a, b.b].some(p => onSegment(p, a))
  || (a.horizontal !== b.horizontal && onSegment({ x: a.horizontal ? b.a.x : a.a.x, y: a.horizontal ? a.a.y : b.a.y }, a)
    && onSegment({ x: a.horizontal ? b.a.x : a.a.x, y: a.horizontal ? a.a.y : b.a.y }, b));

// Strict, data-only structured-output shape. Cross-field and evidence checks
// remain in validateOrcadProgram; JSON Schema alone cannot prove them.
const schemaObject = properties => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) });
const schemaArray = items => ({ type: 'array', items });
const schemaString = { type: 'string' }, schemaNumber = { type: 'number' };
const schemaStrings = schemaArray(schemaString);
const schemaChoice = (...values) => ({ type: 'string', enum: values });
const schemaCoordinate = schemaObject({
  value: schemaNumber, unit: { type: 'string', const: 'page_inch' },
  coordinateSpace: { type: 'string', const: 'capture_page' },
  precision: schemaChoice('exact', 'estimated', 'unknown'),
  basis: schemaChoice('native_page_coordinate', 'calibrated_page_grid', 'labeled_numeric_field'),
  evidenceIds: schemaStrings
});
const schemaCommon = { id: schemaString, timestampMs: schemaNumber, stage: { type: 'string', const: 'committed' }, sourceEventIds: schemaStrings };
const schemaCall = (interfaceId, member, args) => schemaObject({
  interfaceId: { type: 'string', const: interfaceId }, member: { type: 'string', const: member }, arguments: schemaObject(args)
});
export const ORCAD_SCHEMA = schemaObject({
  version: { type: 'string', const: '1.0' }, complete: { type: 'boolean' }, summary: schemaString,
  pageContext: schemaObject({ application: { type: 'string', const: 'OrCAD X Capture' }, version: { type: 'string', const: '24.1 P001' }, pageName: schemaString, initialState: { type: 'string', const: 'isolated_blank' }, evidenceIds: schemaStrings }),
  calibration: schemaObject({ coordinateSpace: { type: 'string', const: 'capture_page' }, unit: { type: 'string', const: 'page_inch' }, physicalGranularity: { type: 'number', const: 100 }, docUnitsPerInch: { type: 'number', const: 100 }, evidenceIds: schemaStrings }),
  operations: schemaArray({ anyOf: [
    schemaObject({ ...schemaCommon, kind: { type: 'string', const: 'place_wire' }, wireId: schemaString, x1: schemaCoordinate, y1: schemaCoordinate, x2: schemaCoordinate, y2: schemaCoordinate,
      apiCall: schemaCall('capture-tcl-place-wire', 'PlaceWire', { x1: schemaNumber, y1: schemaNumber, x2: schemaNumber, y2: schemaNumber }) }),
    schemaObject({ ...schemaCommon, kind: { type: 'string', const: 'place_net_alias' }, aliasId: schemaString, targetWireId: schemaString, x: schemaCoordinate, y: schemaCoordinate, name: schemaString,
      apiCall: schemaCall('capture-tcl-place-net-alias', 'PlaceNetAlias', { x: schemaNumber, y: schemaNumber, name: schemaString }) })
  ] }),
  decisions: schemaArray(schemaObject({ sourceEventIds: schemaStrings, disposition: schemaChoice('modeled', 'navigation', 'cancelled', 'deferred', 'unresolved'), reason: schemaString })),
  unresolved: schemaArray(schemaObject({ sourceEventIds: schemaStrings, reason: schemaString })),
  finalScene: schemaObject({ kind: schemaChoice('observed', 'unknown'), wireIds: schemaStrings, aliasIds: schemaStrings, evidenceIds: schemaStrings }),
  commandState: schemaObject({ pendingEventIds: schemaStrings, selectionIds: schemaStrings })
});

function coordinate(q, at, allowed) {
  object(q, ['value', 'unit', 'coordinateSpace', 'precision', 'basis', 'evidenceIds'], at);
  finite(q.value, `${at}.value`);
  if (q.value < 0 || q.value > 1000) fail(`${at} outside bounded page-coordinate range`);
  if (q.unit !== 'page_inch' || q.coordinateSpace !== 'capture_page') fail(`${at} is not a Capture page-inch coordinate`);
  if (q.precision !== 'exact' || !['native_page_coordinate', 'calibrated_page_grid', 'labeled_numeric_field'].includes(q.basis))
    fail(`${at} unrecognized/estimated coordinate cannot be compiled`);
  refs(q.evidenceIds, `${at}.evidenceIds`, allowed);
  if (!equal(q.value * 100, Math.round(q.value * 100))) fail(`${at} finer than observed 100 units/inch granularity`);
  return q.value;
}
function sameArguments(args, expected, at) {
  object(args, Object.keys(expected), at);
  for (const [key, value] of Object.entries(expected)) if (args[key] !== value) fail(`${at}.${key} does not match evidence-grounded operation`);
}
function validateCall(call, interfaceId, member, args, at) {
  object(call, ['interfaceId', 'member', 'arguments'], at);
  if (call.interfaceId !== interfaceId || call.member !== member) fail(`${at} non-whitelisted/mismatched interface`);
  sameArguments(call.arguments, args, `${at}.arguments`);
}
function validateCalibration(calibration, allowed, requireEvidence) {
  object(calibration, ['coordinateSpace', 'unit', 'physicalGranularity', 'docUnitsPerInch', 'evidenceIds'], 'calibration');
  if (calibration.coordinateSpace !== 'capture_page' || calibration.unit !== 'page_inch') fail('calibration must name Capture page inches');
  if (calibration.physicalGranularity !== 100 || calibration.docUnitsPerInch !== 100)
    fail('calibration differs from observed 24.1 P001 page values');
  refs(calibration.evidenceIds, 'calibration.evidenceIds', allowed, requireEvidence);
}

export const ORCAD_INTERFACE_IDS = Object.freeze(['capture-tcl-place-wire', 'capture-tcl-place-net-alias']);
export const ORCAD_INSTRUCTIONS = `Return structured JSON data only, never Tcl, script text or source paths. Scope: an already open isolated blank schematic page in OrCAD X Capture 24.1 P001. State its observed, safe page name rather than assuming PAGE1. Use only PlaceWire(x1,y1,x2,y2) and PlaceNetAlias(x,y,name), with matching interface IDs and exact arguments. Coordinates are Capture page inches grounded in page-native numeric/grid evidence; screenshot pixels and estimates are not coordinates. Inspect the small Scale / X / Y display in the application status bar near the bottom of each full screenshot. Its X/Y are page cursor coordinates, not selected-object properties: associate them with the point-accepting click only when frame timing, cursor location, placement stage and later persistent geometry agree. Do not use a later unrelated hover value, screen x/y, or the zoom percentage as an endpoint. Read the displayed numeric values yourself; no source-project object data is provided. GetPhysicalGranularity=100 and GetDocUnitsPerInch=100 are the supported backend calibration preconditions, independently checked at replay, not numbers to claim were visually read. calibration.evidenceIds cites the page-coordinate context; it may be empty only in an incomplete plan with zero operations. Every operation parameter needs evidence IDs and precision. Model only committed, nonintersecting axis-aligned wires, then a unique endpoint alias on an earlier wire. Unseen edits, ambiguous selections, existing objects, save/project creation, simulation and arbitrary Tcl are unresolved. complete=true only when no persistent edit is omitted. Do not claim this plan was compiled or replayed; generated Tcl requires a fresh isolated blank page and does not save.`;

export function validateOrcadProgram(program, { eventIds, currentInputIds = null, final = false } = {}) {
  object(program, ['version', 'complete', 'summary', 'pageContext', 'calibration', 'operations', 'decisions', 'unresolved', 'finalScene', 'commandState'], 'program');
  if (program.version !== '1.0') fail('unsupported program version');
  if (typeof program.complete !== 'boolean') fail('complete must be boolean');
  if (typeof program.summary !== 'string' || program.summary.length > 1000) fail('invalid summary');
  array(eventIds, 'eventIds', 10000);
  const allowed = new Set(eventIds);
  if (allowed.size !== eventIds.length) fail('duplicate provided event ID');
  for (const id of allowed) identifier(id, 'eventIds');
  object(program.pageContext, ['application', 'version', 'pageName', 'initialState', 'evidenceIds'], 'pageContext');
  if (program.pageContext.application !== 'OrCAD X Capture' || program.pageContext.version !== '24.1 P001'
      || typeof program.pageContext.pageName !== 'string' || !pagePattern.test(program.pageContext.pageName)
      || program.pageContext.initialState !== 'isolated_blank')
    fail('only a named 24.1 P001 isolated blank page is in scope');
  refs(program.pageContext.evidenceIds, 'pageContext.evidenceIds', allowed);
  array(program.operations, 'operations', 32);
  validateCalibration(program.calibration, allowed, program.complete || program.operations.length > 0 || final);
  array(program.decisions, 'decisions');
  array(program.unresolved, 'unresolved');
  const wires = new Map(), aliases = new Map(), ids = new Set();
  let lastTime = -1;
  for (const [index, op] of program.operations.entries()) {
    const at = `operations[${index}]`;
    if (!op || typeof op !== 'object' || Array.isArray(op)) fail(`${at} invalid operation`);
    const common = ['id', 'kind', 'timestampMs', 'stage', 'sourceEventIds', 'apiCall'];
    if (op.kind === 'place_wire') object(op, [...common, 'wireId', 'x1', 'y1', 'x2', 'y2'], at);
    else if (op.kind === 'place_net_alias') object(op, [...common, 'aliasId', 'targetWireId', 'x', 'y', 'name'], at);
    else fail(`${at} unsupported operation kind`);
    identifier(op.id, `${at}.id`);
    if (ids.has(op.id)) fail(`duplicate operation ID ${op.id}`);
    ids.add(op.id);
    finite(op.timestampMs, `${at}.timestampMs`);
    if (op.timestampMs < 0 || op.timestampMs < lastTime) fail('operations out of committed time order');
    lastTime = op.timestampMs;
    if (op.stage !== 'committed') fail(`${at} is not committed`);
    refs(op.sourceEventIds, `${at}.sourceEventIds`, allowed);
    if (op.kind === 'place_wire') {
      identifier(op.wireId, `${at}.wireId`);
      if (ids.has(op.wireId)) fail(`duplicate/reused wire ID ${op.wireId}`);
      ids.add(op.wireId);
      const x1 = coordinate(op.x1, `${at}.x1`, allowed), y1 = coordinate(op.y1, `${at}.y1`, allowed);
      const x2 = coordinate(op.x2, `${at}.x2`, allowed), y2 = coordinate(op.y2, `${at}.y2`, allowed);
      const a = { x: x1, y: y1 }, b = { x: x2, y: y2 };
      if (pointEqual(a, b) || equal(x1, x2) === equal(y1, y2)) fail('wire must be nonzero and axis-aligned');
      const wire = { id: op.wireId, a, b, horizontal: equal(y1, y2) };
      if ([...wires.values()].some(existing => touches(existing, wire))) fail('duplicate, overlapping or touching wires have ambiguous connectivity');
      validateCall(op.apiCall, 'capture-tcl-place-wire', 'PlaceWire', { x1, y1, x2, y2 }, `${at}.apiCall`);
      wires.set(wire.id, wire);
    } else {
      identifier(op.aliasId, `${at}.aliasId`);
      if (ids.has(op.aliasId)) fail(`duplicate/reused alias ID ${op.aliasId}`);
      ids.add(op.aliasId);
      identifier(op.targetWireId, `${at}.targetWireId`);
      const wire = wires.get(op.targetWireId);
      if (!wire) fail('net alias target wire must already exist');
      const x = coordinate(op.x, `${at}.x`, allowed), y = coordinate(op.y, `${at}.y`, allowed);
      const anchor = { x, y };
      if (![wire.a, wire.b].some(point => pointEqual(point, anchor))) fail('net alias must anchor at target wire endpoint');
      if ([...wires.values()].filter(candidate => onSegment(anchor, candidate)).length !== 1) fail('net alias selection is ambiguous');
      if (typeof op.name !== 'string' || !aliasPattern.test(op.name)) fail('unsafe/unsupported net alias name');
      if ([...aliases.values()].some(item => item.wireId === wire.id || pointEqual(item.anchor, anchor))) fail('duplicate/overlapping net alias');
      validateCall(op.apiCall, 'capture-tcl-place-net-alias', 'PlaceNetAlias', { x, y, name: op.name }, `${at}.apiCall`);
      aliases.set(op.aliasId, { id: op.aliasId, wireId: wire.id, anchor, name: op.name });
    }
  }
  for (const [index, item] of program.decisions.entries()) {
    object(item, ['sourceEventIds', 'disposition', 'reason'], `decisions[${index}]`);
    refs(item.sourceEventIds, `decisions[${index}].sourceEventIds`, allowed);
    if (!['modeled', 'navigation', 'cancelled', 'deferred', 'unresolved'].includes(item.disposition)) fail('invalid decision disposition');
    if (typeof item.reason !== 'string' || !item.reason.trim() || item.reason.length > 500) fail('invalid decision reason');
  }
  for (const [index, item] of program.unresolved.entries()) {
    object(item, ['sourceEventIds', 'reason'], `unresolved[${index}]`);
    refs(item.sourceEventIds, `unresolved[${index}].sourceEventIds`, allowed);
    if (typeof item.reason !== 'string' || !item.reason.trim() || item.reason.length > 500) fail('unresolved operation needs a reason');
  }
  const unresolvedEvidence = new Set(program.unresolved.flatMap(item => item.sourceEventIds));
  for (const decision of program.decisions) if (decision.disposition === 'unresolved'
      && !decision.sourceEventIds.every(id => unresolvedEvidence.has(id))) fail('unresolved decision missing from unresolved ledger');
  if (program.complete === (program.unresolved.length > 0 || program.decisions.some(x => x.disposition === 'unresolved')))
    fail('complete/unresolved coverage conflict');
  const modeled = new Set(program.operations.flatMap(op => op.sourceEventIds));
  for (const decision of program.decisions) if (decision.disposition === 'modeled' && !decision.sourceEventIds.some(id => modeled.has(id))) fail('modeled decision has no operation');
  if (currentInputIds !== null) {
    array(currentInputIds, 'currentInputIds');
    const covered = new Set(program.decisions.flatMap(item => item.sourceEventIds));
    if (currentInputIds.some(id => !covered.has(id))) fail('input coverage gap');
  }
  object(program.finalScene, ['kind', 'wireIds', 'aliasIds', 'evidenceIds'], 'finalScene');
  if (!['observed', 'unknown'].includes(program.finalScene.kind)) fail('invalid final scene kind');
  refs(program.finalScene.evidenceIds, 'finalScene.evidenceIds', allowed);
  for (const key of ['wireIds', 'aliasIds']) {
    array(program.finalScene[key], `finalScene.${key}`);
    for (const id of program.finalScene[key]) identifier(id, `finalScene.${key}`);
    if (new Set(program.finalScene[key]).size !== program.finalScene[key].length) fail('duplicate final object ID');
  }
  object(program.commandState, ['pendingEventIds', 'selectionIds'], 'commandState');
  refs(program.commandState.pendingEventIds, 'commandState.pendingEventIds', allowed, false);
  array(program.commandState.selectionIds, 'commandState.selectionIds');
  if (new Set(program.commandState.selectionIds).size !== program.commandState.selectionIds.length) fail('duplicate selected object');
  for (const id of program.commandState.selectionIds) {
    identifier(id, 'commandState.selectionIds');
    if (!wires.has(id) && !aliases.has(id)) fail('unknown selected object');
  }
  if (final) {
    if (!program.complete || program.unresolved.length || program.decisions.some(x => x.disposition === 'unresolved')) fail('incomplete/unresolved plan cannot be rendered');
    if (program.decisions.some(x => x.disposition === 'deferred')) fail('deferred action at final state');
    // A unique, already-known object may remain highlighted after the last
    // committed edit. Selection alone is not a pending edit transaction.
    if (program.commandState.pendingEventIds.length) fail('pending event at final state');
    if (program.finalScene.kind !== 'observed') fail('final inventory not observed');
    const same = (actual, expected) => actual.length === expected.length && actual.every(id => expected.includes(id));
    if (!same(program.finalScene.wireIds, [...wires.keys()]) || !same(program.finalScene.aliasIds, [...aliases.keys()])) fail('final object inventory mismatch');
    if (!wires.size) fail('no supported committed wire');
  }
  return { wires: [...wires.values()], aliases: [...aliases.values()] };
}
