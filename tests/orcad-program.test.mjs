import test from 'node:test';
import assert from 'node:assert/strict';
import { ORCAD_INTERFACE_IDS, ORCAD_SCHEMA, validateOrcadProgram } from '../src/analyzer/lib/orcad-program.mjs';
import { renderOrcadTcl } from '../src/analyzer/lib/orcad-renderer.mjs';
import { createOrcadFixture as fixture, createOrcadPageCoordinate as q, orcadEvidenceIds as evidence } from './fixtures/orcad.mjs';

const validate = (program, extras = {}) => validateOrcadProgram(program, { eventIds: evidence, currentInputIds: ['wire', 'alias'], final: true, ...extras });
const mutate = change => { const program = fixture(); change(program); return program; };

test('bounded native interface list and exact, evidence-grounded plan validate', () => {
  assert.deepEqual(ORCAD_INTERFACE_IDS, ['capture-tcl-place-wire', 'capture-tcl-place-net-alias']);
  const result = validate(fixture());
  assert.equal(result.wires.length, 1);
  assert.equal(result.aliases[0].wireId, 'wireOne');
});

test('structured-output schema is closed at every object and matches the bounded fixture', () => {
  function check(value, schema) {
    if (schema.anyOf) {
      assert.ok(schema.anyOf.some(choice => { try { check(value, choice); return true; } catch { return false; } }));
      return;
    }
    assert.equal(typeof value, schema.type === 'array' ? 'object' : schema.type);
    if (schema.const !== undefined) assert.equal(value, schema.const);
    if (schema.enum) assert.ok(schema.enum.includes(value));
    if (schema.type === 'array') {
      assert.ok(Array.isArray(value));
      value.forEach(item => check(item, schema.items));
    } else if (schema.type === 'object') {
      assert.ok(value && !Array.isArray(value));
      assert.equal(schema.additionalProperties, false);
      assert.deepEqual(new Set(schema.required), new Set(Object.keys(schema.properties)));
      assert.deepEqual(new Set(Object.keys(value)), new Set(schema.required));
      for (const key of schema.required) check(value[key], schema.properties[key]);
    }
  }
  check(fixture(), ORCAD_SCHEMA);
  assert.throws(() => check(mutate(p => { p.operations[0].apiCall.arguments.x1 = '1.7'; }), ORCAD_SCHEMA));
  assert.throws(() => check(mutate(p => { p.operations[0].script = 'source'; }), ORCAD_SCHEMA));
});

test('rejects untrusted Tcl, unexpected fields and unsafe identifiers', () => {
  assert.throws(() => validate(mutate(p => { p.script = 'source evil.tcl'; })), /unexpected field/);
  assert.throws(() => validate(mutate(p => { p.operations[0].tcl = 'exec calc'; })), /unexpected field/);
  assert.throws(() => validate(mutate(p => { p.operations[0].id = 'op;exec'; })), /invalid ID/);
  assert.throws(() => validate(mutate(p => { p.operations[1].name = 'NET;exec calc'; p.operations[1].apiCall.arguments.name = 'NET;exec calc'; })), /unsafe\/unsupported/);
  assert.throws(() => validate(mutate(p => { p.pageContext.pageName = 'PAGE1};exec calc'; })), /isolated blank page/);
});

test('page name is evidence-bound data, not hard-coded PAGE1', () => {
  const plan = mutate(p => { p.pageContext.pageName = 'TEST_PAGE_2'; });
  const script = renderOrcadTcl(plan, { eventIds: evidence, currentInputIds: ['wire', 'alias'] });
  assert.match(script, /__orc_assertPage \{TEST_PAGE_2\}/);
  assert.doesNotMatch(script, /__orc_assertPage \{PAGE1\}/);
});

test('rejects guessed, pixel, nonfinite, overly fine or unsupported numeric coordinates', () => {
  assert.throws(() => validate(mutate(p => { p.operations[0].x1.precision = 'estimated'; })), /unrecognized\/estimated/);
  assert.throws(() => validate(mutate(p => { p.operations[0].x1.coordinateSpace = 'screenshot_pixel'; })), /not a Capture page-inch/);
  assert.throws(() => validate(mutate(p => { p.operations[0].x1.value = null; })), /known finite number/);
  assert.throws(() => validate(mutate(p => { p.operations[0].x1.value = 1.705; })), /finer than observed/);
  assert.throws(() => validate(mutate(p => { p.calibration.docUnitsPerInch = 1000; })), /calibration differs/);
  assert.throws(() => validate(mutate(p => { p.operations[0].x1.evidenceIds = ['invented']; })), /unknown evidence/);
});

test('API whitelist and operation parameters must match exactly', () => {
  assert.throws(() => validate(mutate(p => { p.operations[0].apiCall.member = 'Eval'; })), /non-whitelisted/);
  assert.throws(() => validate(mutate(p => { p.operations[1].apiCall.interfaceId = 'capture-tcl-menu-save'; })), /non-whitelisted/);
  assert.throws(() => validate(mutate(p => { p.operations[0].apiCall.arguments.x1 = 2.7; })), /does not match/);
  assert.throws(() => validate(mutate(p => { p.operations[1].apiCall.arguments.extra = 'source evil'; })), /unexpected field/);
});

test('incomplete observation without calibration is auditable but never executable', () => {
  const p = fixture();
  p.complete = false;
  p.operations = [];
  p.calibration.evidenceIds = [];
  p.decisions = [{ sourceEventIds: ['wire', 'alias'], disposition: 'unresolved', reason: 'Coordinates unreadable' }];
  p.unresolved = [{ sourceEventIds: ['wire', 'alias'], reason: 'Coordinates unreadable' }];
  assert.doesNotThrow(() => validate(p, { final: false }));
  assert.throws(() => validate(p), /calibration.*evidence/);
  assert.throws(() => validate(mutate(x => { x.calibration.evidenceIds = []; })), /calibration.*evidence/);
  p.calibration.evidenceIds = ['invented'];
  assert.throws(() => validate(p, { final: false }), /unknown evidence/);
});

test('commit order, target identity, and alias endpoint are checked', () => {
  assert.throws(() => validate(mutate(p => { p.operations[1].timestampMs = 50; })), /time order/);
  assert.throws(() => validate(mutate(p => { p.operations.reverse(); })), /target wire must already exist/);
  assert.throws(() => validate(mutate(p => { p.operations[1].targetWireId = 'missingWire'; })), /target wire must already exist/);
  assert.throws(() => validate(mutate(p => { p.operations[1].x.value = 2.7; p.operations[1].apiCall.arguments.x = 2.7; })), /target wire endpoint/);
  assert.throws(() => validate(mutate(p => { p.operations[0].stage = 'pending'; })), /not committed/);
});

test('duplicate, overlap and touching geometry are rejected before ambiguous selection', () => {
  const withWire = (x1, y1, x2, y2) => mutate(p => {
    const next = structuredClone(p.operations[0]);
    Object.assign(next, { id: 'opWireTwo', wireId: 'wireTwo', timestampMs: 150, x1: q(x1), y1: q(y1), x2: q(x2), y2: q(y2) });
    next.apiCall.arguments = { x1, y1, x2, y2 };
    p.operations.splice(1, 0, next);
    p.finalScene.wireIds.push('wireTwo');
  });
  assert.throws(() => validate(withWire(1.7, 3, 3.7, 3)), /duplicate, overlapping or touching/);
  assert.throws(() => validate(withWire(2.7, 3, 4.7, 3)), /duplicate, overlapping or touching/);
  assert.throws(() => validate(withWire(3.7, 3, 3.7, 4)), /duplicate, overlapping or touching/);
  assert.throws(() => validate(withWire(2.7, 2, 2.7, 4)), /duplicate, overlapping or touching/);
});

test('passive known unique wire or alias selections compile, but ambiguous references and pending work reject', () => {
  for (const selections of [['wireOne'], ['aliasOne'], ['wireOne', 'aliasOne']]) {
    const p = mutate(p => { p.commandState.selectionIds = selections; });
    assert.doesNotThrow(() => validate(p));
    assert.match(renderOrcadTcl(p, { eventIds: evidence, currentInputIds: ['wire', 'alias'] }), /PlaceWire/);
  }
  assert.throws(() => validate(mutate(p => { p.commandState.selectionIds = ['wireOne', 'wireOne']; })), /duplicate selected object/);
  assert.throws(() => validate(mutate(p => { p.commandState.selectionIds = ['missing']; })), /unknown selected object/);
  assert.throws(() => validate(mutate(p => { p.commandState.selectionIds = ['bad;id']; })), /invalid ID/);
});

test('incomplete coverage, pending or deferred action and final inventory reject final rendering', () => {
  assert.throws(() => validate(mutate(p => { p.complete = false; })), /coverage conflict/);
  assert.throws(() => validate(mutate(p => { p.unresolved.push({ sourceEventIds: ['wire'], reason: 'Missing edit' }); })), /coverage conflict/);
  assert.throws(() => validate(mutate(p => { p.complete = false; p.unresolved.push({ sourceEventIds: ['wire'], reason: 'Missing edit' }); })), /incomplete\/unresolved/);
  assert.throws(() => validate(mutate(p => { p.complete = false; p.decisions[0].disposition = 'unresolved'; })), /unresolved decision missing/);
  assert.throws(() => validate(mutate(p => { p.decisions[0].disposition = 'deferred'; })), /deferred action/);
  assert.throws(() => validate(mutate(p => { p.commandState.pendingEventIds = ['wire']; p.commandState.selectionIds = ['wireOne']; })), /pending event/);
  assert.throws(() => validate(mutate(p => { p.finalScene.aliasIds = []; })), /inventory mismatch/);
  assert.throws(() => validate(mutate(p => { p.decisions = []; })), /input coverage gap/);
});

test('renderer emits guarded fixed API calls and independent native readback, without save', () => {
  const script = renderOrcadTcl(fixture(), { eventIds: evidence, currentInputIds: ['wire', 'alias'] });
  assert.match(script, /set page \[GetActivePage\]/);
  assert.match(script, /GetName \$name/);
  assert.match(script, /GetPhysicalGranularity/);
  assert.match(script, /GetDocUnitsPerInch/);
  for (const method of ['GetPartInstCount', 'GetWireCount', 'GetBusEntryCount', 'GetPortCount', 'GetGlobalCount', 'GetOffPageConnectorCount', 'GetCommentGraphicCount']) assert.ok(script.includes(method));
  assert.match(script, /NewWiresIter \$status/);
  assert.match(script, /delete_DboPageWiresIter \$iter/);
  assert.match(script, /NewAliasesIter \$status/);
  assert.match(script, /delete_DboWireAliasesIter \$aliasIter/);
  assert.match(script, /GetStartPoint \$status/);
  assert.match(script, /GetEndPoint \$status/);
  assert.match(script, /GetLocation \$status/);
  assert.match(script, /\[\[\$alias GetOwner\] GetId \$status\]/);
  assert.match(script, /set __orc_newIds \{\}/);
  assert.match(script, /__orc_assertGeometry \[__orc_findRow/);
  assert.match(script, /if \{\[PlaceWire 1\.7 3 3\.7 3\] != 0\}/);
  assert.match(script, /if \{\[PlaceNetAlias 1\.7 3 \{RECORDER_TEST\}\] != 0\}/);
  assert.match(script, /Net alias name\/owner\/anchor readback mismatch/);
  assert.match(script, /Final net alias readback mismatch/);
  assert.doesNotMatch(script, /SaveDesign|capNewProject|DboSession_CreateDesign|^exec |^source /m);
  assert.doesNotMatch(script, /^error \{OrCAD recorder review only/m);
});

test('review mode remains non-mutating, and invalid data never reaches either renderer', () => {
  const script = renderOrcadTcl(fixture(), { eventIds: evidence, currentInputIds: ['wire', 'alias'] }, { mode: 'review' });
  assert.match(script, /^# OrCAD X Capture/);
  assert.match(script, /\r\nerror \{OrCAD recorder review only: no edits performed\}\r\n/);
  assert.match(script, /# PlaceWire 1\.7 3 3\.7 3/);
  assert.match(script, /# PlaceNetAlias 1\.7 3 RECORDER_TEST/);
  assert.doesNotMatch(script, /\r\nPlaceWire /);
  assert.doesNotMatch(script, /\r\nPlaceNetAlias /);
  assert.throws(() => renderOrcadTcl(mutate(p => { p.operations[1].name = 'INJECT;'; }), { eventIds: evidence }, { mode: 'review' }), /unsafe\/unsupported/);
});
