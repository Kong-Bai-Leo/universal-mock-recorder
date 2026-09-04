import test from "node:test";
import assert from "node:assert/strict";
import { buildVisualFaceInput, emptyVisualFaceState, mapVisualPolygon, mergeVisualFaceTracking, polygonIoU,
  trackVisualFaces, visualFaceContext, visualFaceContextScreenshots, visualFacePriorityScreenshots } from "../src/analyzer/lib/threedsmax-visual-faces.mjs";
import { emptyThreeDsMaxAnalysis, mergeThreeDsMaxAnalyses, validateThreeDsMaxAnalysis } from "../src/analyzer/lib/threedsmax-workflow.mjs";
import { analyzeChunk } from "../src/analyzer/3dsmax-cli.mjs";
import { selectThreeDsMaxScreenshots } from "../src/analyzer/lib/threedsmax-screenshots.mjs";
import { bevelOperation, bevelAnalysis } from "./fixtures/threedsmax-bevel.mjs";
import { renderMaxScript } from "../src/analyzer/lib/maxscript-renderer.mjs";

const square = (x = 0.2, y = 0.2, size = 0.2) => [[x,y], [x+size,y], [x+size,y+size], [x,y+size]];
const face = (id, overrides = {}) => ({ observationId: id, objectId: "obj", polygon: square(), visibility: "visible",
  relation: "first_seen", matchRef: null, parentRefs: [], neighborRefs: [], matchBasis: "none", selected: true,
  confidence: 0.96, description: "Synthetic test face, not a VLM prediction", ...overrides });
const frame = (index, faces, overrides = {}) => ({ frameId: `frame-${index}`, comparedToFrameId: index > 1 ? `frame-${index-1}` : null,
  viewport: [0,0,1,1], view: "Perspective", change: index > 1 ? "stable" : "baseline", editCompleted: false,
  sourceEventIds: [`evt-${index}`], objectIds: ["obj"], coverage: "complete_visible", faces, retiredRefs: [], reason: "Synthetic frame", ...overrides });
const mapping = { sourceSize: { width: 1000, height: 800 }, cropRect: { x: 0, y: 0, width: 1000, height: 800 }, outputSize: { width: 500, height: 400 } };
function setup(reports, options = {}) {
  const analysis = emptyThreeDsMaxAnalysis();
  analysis.maxProgram.format = "3dsmax_scene_ir";
  analysis.maxProgram.initialObjects = [{ id: "obj", name: "Test", className: "Editable_Poly", confidence: 1 }];
  analysis.visualFaceFrames = reports;
  const actions = reports.map((r, i) => ({ action: "click", startMs: i * 100 + 1, endMs: (i+1) * 100,
    sourceEventIds: r.sourceEventIds, screenshotAfter: `${r.frameId}.jpg` }));
  const payload = { actions, previousContext: { knownObjects: [], rawActionTail: [] },
    visualFaceInput: { enabled: true, limits: { maxFrames: 16, maxFacesPerFrame: 12 }, excludedFrameCount: 0,
      frames: reports.map((r, i) => ({ id: r.frameId, screenshot: `${r.frameId}.jpg`, phase: "after", historical: false,
        order: i+1, timestampMs: (i+1)*100, inputTimeMs: (i+1)*100, sourceEventIds: r.sourceEventIds, imageMapping: mapping })) } };
  Object.assign(analysis.maxProgram, options.program ?? {});
  return { analysis, payload };
}
function run(reports, configure = () => {}) {
  const { analysis, payload } = setup(reports);
  configure(analysis, payload);
  const delta = trackVisualFaces(emptyVisualFaceState(), reports, payload, analysis);
  return { delta, state: mergeVisualFaceTracking([{ visualFaceTracking: delta }]), analysis, payload };
}
const observationIds = (delta) => delta.frames.map((f) => f.observations.map((o) => o.visualFaceId));

test("stable screenshot contours reuse locally assigned IDs and keep image-to-source coordinates", () => {
  const { delta, state } = run([frame(1, [face("a")]), frame(2, [face("b", { polygon: square(0.202) })])]);
  assert.deepEqual(observationIds(delta), [["vf-000001"], ["vf-000001"]]);
  assert.equal(state.tracks.length, 1);
  assert.equal(state.tracks[0].runtimeFaceId, null);
  assert.deepEqual(delta.frames[0].observations[0].sourcePixelPolygon[0], [200,160]);
});
test("same screen region on another object cannot inherit a face identity", () => {
  const reports = [frame(1,[face("a")]), frame(2,[face("b", { objectId: "other", relation: "same", matchRef: "a", matchBasis: "distinctive_feature" })], { objectIds: ["other"] })];
  const { delta } = run(reports, (a) => a.maxProgram.initialObjects.push({ id: "other" }));
  assert.deepEqual(observationIds(delta), [["vf-000001"], ["vf-000002"]]);
  assert.equal(delta.frames[1].observations[0].relation, "candidate");
});
test("wheel/viewport navigation blocks overlap matching even if model incorrectly says stable", () => {
  const { delta } = run([frame(1,[face("a")]), frame(2,[face("b")])], (a,p) => { p.actions[1].action = "scroll"; });
  assert.deepEqual(observationIds(delta), [["vf-000001"], ["vf-000002"]]);
  assert.equal(delta.frames[1].change, "view_change");
  assert.equal(delta.updates[1].origin, "newly_visible");
});
test("actual object transformations also disable unregistered pixel-overlap association", () => {
  const { delta } = run([frame(1,[face("a")]), frame(2,[face("b")])], (a) => {
    a.maxProgram.operations = [{ kind: "transform", sourceEventIds: ["evt-2"] }];
  });
  assert.deepEqual(observationIds(delta), [["vf-000001"], ["vf-000002"]]);
});
test("a newly exposed face is not called newly created, including a false created proposal", () => {
  const { delta } = run([frame(1,[face("a")]), frame(2,[face("b", { relation: "created", parentRefs: ["a"] })], { change: "view_change", editCompleted: true })]);
  assert.equal(delta.updates[1].origin, "newly_visible");
  assert.equal(delta.updates[1].identity, "candidate");
  assert.deepEqual(delta.updates[1].parentIds, []);
  assert.ok(delta.issues.some((i) => i.code === "new_face_not_proven_by_completed_edit"));
});
test("occlusion preserves old ID; distinct features with actual reference image can reidentify it", () => {
  const { delta, state } = run([frame(1,[face("a")]), frame(2,[]), frame(3,[face("c", {
    relation: "same", matchRef: "a", polygon: square(0.6), matchBasis: "distinctive_feature" })])]);
  assert.deepEqual(observationIds(delta), [["vf-000001"], [], ["vf-000001"]]);
  assert.equal(state.tracks[0].status, "visible");
  const hidden = run([frame(1,[face("a")]), frame(2,[])]).state.tracks[0];
  assert.equal(hidden.status, "not_observed");
  assert.notEqual(hidden.status, "retired");
});
test("completed Bevel creates child identities and explicitly retires a replaced parent", () => {
  const reports = [frame(1,[face("a")]), frame(2,[face("b", { relation: "created", parentRefs: ["a"] }),
    face("c", { relation: "created", parentRefs: ["a"], polygon: square(0.5) })], { change: "topology_edit", editCompleted: true, retiredRefs: ["a"] })];
  const { state } = run(reports, (a) => a.maxProgram.operations.push({ kind: "bevel_faces", targetObjectIds: ["obj"], sourceEventIds: ["evt-2"] }));
  assert.equal(state.tracks[0].status, "retired");
  assert.deepEqual(state.tracks[1].parentIds, ["vf-000001"]);
  assert.equal(state.tracks[2].origin, "created_by_edit");
});
test("preview/uncompleted edit cannot create or retire a face", () => {
  const { state, delta } = run([frame(1,[face("a")]), frame(2,[face("b", { relation: "created", parentRefs: ["a"] })],
    { change: "topology_edit", editCompleted: false, retiredRefs: ["a"] })]);
  assert.equal(state.tracks[0].status, "not_observed");
  assert.equal(state.tracks[1].identity, "candidate");
  assert.ok(delta.issues.some((i) => i.code === "unproven_retirement"));
});
test("equal candidates and competing detections cannot silently pick the first face", () => {
  const { delta } = run([frame(1,[face("a"), face("b")]), frame(2,[face("c")])]);
  assert.equal(delta.frames[1].observations[0].relation, "candidate");
  assert.equal(delta.frames[1].observations[0].candidateIds.length, 2);
  const competing = run([frame(1,[face("a")]), frame(2,[face("b"), face("c")])]).delta;
  assert.deepEqual(observationIds(competing)[1], ["vf-000002", "vf-000003"]);
  assert.ok(competing.issues.some((i) => i.code === "ambiguous_many_to_one"));
});
test("local neighborhood references are resolved to canonical IDs after the whole frame", () => {
  const { state } = run([frame(1,[face("a", { neighborRefs: ["b"] }), face("b", { polygon: square(0.4), neighborRefs: ["a"] })])]);
  assert.deepEqual(state.tracks[0].neighborIds, ["vf-000002"]);
  assert.deepEqual(state.tracks[1].neighborIds, ["vf-000001"]);
});
test("wrong screenshot, polygon, viewport, event, future references and duplicate observations are quarantined", () => {
  for (const overrides of [ { polygon: [[1.5,0],[0,1],[1,1]] }, { polygon: [[0,0],[0.2,0.2],[0.3,0.3]] },
    { objectId: "missing" }, { observationId: "vf-000123" } ]) {
    const { delta } = run([frame(1,[face("a", overrides)])]);
    assert.equal(delta.updates.length, 0);
    assert.equal(delta.issues[0].code, "invalid_or_duplicate_face_observation");
  }
  const { analysis, payload } = setup([frame(1,[face("a")])]);
  const invalid = trackVisualFaces(emptyVisualFaceState(), [frame(99,[face("b")])], payload, analysis);
  assert.equal(invalid.updates.length, 0);
  assert.ok(invalid.issues.some((i) => i.code === "unknown_historical_or_duplicate_frame"));
  const future = run([frame(1,[face("a", { relation: "same", matchRef: "b", matchBasis: "distinctive_feature" })]), frame(2,[face("b")])]);
  assert.equal(future.delta.frames[0].observations[0].relation, "candidate");
});
test("source pixel mapping composes crop and resizing, without producing 3D coordinates", () => {
  const mapped = mapVisualPolygon([[0.5,0.5]], { sourceSize: { width: 2000,height: 1000 }, cropRect: { x: 200,y:100,width:800,height:400 }, outputSize: { width:400,height:200 } });
  assert.deepEqual(mapped.pixels, [[600,300]]);
  assert.deepEqual(mapped.normalized, [[0.3,0.3]]);
  assert.deepEqual(mapVisualPolygon(square(), null), { normalized: null, pixels: null });
  assert.equal(polygonIoU(square(), square()), 1);
  assert.equal(polygonIoU(square(), square(0.7)), 0);
  assert.ok(polygonIoU([[0,0],[1,0],[0,1]], [[1,1],[1,0],[0,1]]) < 0.05);
});
test("checkpoint deltas restore ID allocation and permit cross-chunk matching only with uploaded history", () => {
  const first = run([frame(1,[face("a")])]);
  const prior = first.state;
  const reports = [frame(2,[face("b", { relation: "same", matchRef: "vf-000001", matchBasis: "distinctive_feature" })])];
  const { analysis, payload } = setup(reports);
  payload.visualFaceInput.frames[0].order = 2;
  payload.visualFaceInput.frames[0].timestampMs = 200;
  payload.actions[0].startMs = 101;
  payload.actions[0].endMs = 200;
  const missing = trackVisualFaces(prior, reports, payload, analysis);
  assert.equal(missing.frames[0].observations[0].visualFaceId, "vf-000002");
  payload.visualFaceInput.frames.unshift({ ...first.payload.visualFaceInput.frames[0], historical: true });
  const next = trackVisualFaces(prior, reports, payload, analysis);
  assert.equal(next.frames[0].observations[0].visualFaceId, "vf-000001");
  const restored = mergeVisualFaceTracking([{ visualFaceTracking: first.delta }, { visualFaceTracking: next }]);
  assert.equal(restored.tracks.length, 1);
  assert.equal(restored.frames.length, 2);
  assert.equal(restored.nextId, 2);
});
test("only uploaded full frames are offered; budgets, unreadable frames, and bounded context are explicit", () => {
  const actions = Array.from({length:8}, (_, i) => ({ action: "drag", button: "left", sourceEventIds: [`evt-${i}`],
    screenshotBefore: `${i}-before.jpg`, screenshotAfter: `${i}-after.jpg`, startMs: i*100, endMs: i*100+90 }));
  const images = actions.flatMap((a) => [a.screenshotBefore, a.screenshotAfter]).map((name) =>
    ({ logicalScreenshot: name, label: name, evidenceRole: "3dsmax_interaction_after", imageMapping: mapping }));
  images[0].evidenceRole = "3dsmax_transform_transform_type_in_before";
  const input = buildVisualFaceInput(images, actions, emptyVisualFaceState(), 1, { maxFrames: 1 });
  assert.equal(input.frames.length, 1);
  assert.equal(input.excludedFrameCount, 14);
  assert.ok(!input.frames.some((f) => f.screenshot === "0-before.jpg"));
  const selected = selectThreeDsMaxScreenshots(actions, 6, { priorityScreenshots: visualFacePriorityScreenshots(actions, 4) });
  assert.ok(selected.length <= 6);
  assert.ok(selected.includes("0-before.jpg") && selected.includes("0-after.jpg"));
  const { state } = run([frame(1, [face("a"), face("b", {polygon: square(0.6)})])]);
  assert.equal(visualFaceContext(state, { maxContextTracks: 1 }).tracks.length, 1);
  assert.equal(visualFaceContext(state, { maxContextTracks: 1 }).omittedTrackCount, 1);
  assert.equal(visualFaceContextScreenshots(state).length, 1);
});
test("schema compatibility, final merge and runtime index guard keep visual identity separate", () => {
  const legacy = emptyThreeDsMaxAnalysis(); delete legacy.visualFaceFrames;
  assert.deepEqual(validateThreeDsMaxAnalysis(legacy).visualFaceFrames, []);
  const { delta, analysis } = run([frame(1,[face("a")])]);
  analysis.visualFaceTracking = delta;
  const merged = mergeThreeDsMaxAnalyses([analysis]);
  assert.equal(merged.visualFaceTracking.tracks[0].id, "vf-000001");
  const op = bevelOperation();
  op.polyEdit.selection = { method: "face_indices", indices: [2], faceIds: ["vf-000001"], topologyRevision: 0,
    axis: null, side: null, expectedCount: 1, expectedFaceCount: 6, expectedVertexCount: 8,
    faceChecks: [{index:2,center:[0,0,10],normal:[0,0,1]}] };
  assert.throws(() => renderMaxScript(bevelAnalysis(op)), /面 ID/);
});
test("analysis pipeline consumes VLM observations in its existing single request without extra calls", async () => {
  const reports = [frame(1,[face("a")]), frame(2,[face("b")])];
  const { analysis, payload } = setup(reports);
  let calls = 0;
  const client = { async analyze(request) {
    calls++; assert.ok(request.outputSchema.properties.visualFaceFrames);
    assert.equal(request.payload.visualFaceInput.frames.length, 2);
    return analysis;
  } };
  const result = await analyzeChunk({ client, payload, screenshots: [], knownObjects: [], maxValidationRepairs: 0 });
  assert.equal(calls, 1);
  assert.deepEqual(observationIds(result.visualFaceTracking), [["vf-000001"],["vf-000001"]]);
  const malformed = { ...analysis, visualFaceFrames: [frame(1,[face("broken", {polygon: []})])] };
  client.analyze = async () => { calls++; return malformed; };
  const partial = await analyzeChunk({ client, payload, screenshots: [], knownObjects: [], maxValidationRepairs: 2 });
  assert.equal(calls, 2);
  assert.ok(partial.visualFaceTracking.issues.length);
  assert.equal(partial.maxProgram.complete, true);
});
test("raw tail frames cannot rewind the ledger; capture timestamps override phase ordering", () => {
  const prior = run([frame(1,[face("a")])]).state;
  prior.frames[0].order = 100;
  const actions = [{sourceEventIds:["evt-old"],startMs:20,endMs:30,screenshotAfter:"older.jpg"},
    {sourceEventIds:["evt-new"],startMs:120,endMs:180,screenshotBefore:"late-before.jpg",screenshotBeforeTimestampMs:200,
      screenshotAfter:"early-after.jpg",screenshotAfterTimestampMs:190}];
  const images = ["older.jpg","late-before.jpg","early-after.jpg"].map((name)=>({logicalScreenshot:name,label:name}));
  const input = buildVisualFaceInput(images, actions, prior, 2);
  assert.equal(input.excludedHistoryCount, 1);
  assert.deepEqual(input.frames.map((f)=>f.screenshot), ["early-after.jpg","late-before.jpg"]);
});
test("candidate identities stay low confidence even after stable local continuation", () => {
  const { delta, state } = run([frame(1,[face("a", {confidence:0.4})]), frame(2,[face("b")])]);
  assert.deepEqual(observationIds(delta), [["vf-000001"],["vf-000001"]]);
  assert.equal(state.tracks[0].identity, "candidate");
  assert.ok(state.tracks[0].confidence <= 0.49);
});
test("malformed/self-crossing contours and irrelevant event assertions do not get identities", () => {
  const { delta } = run([frame(1,[face("a", {polygon:[[0,0],[0.8,1],[1,0],[0,0.8],[1,0.8]]})])]);
  assert.equal(delta.updates.length,0);
  const {analysis,payload} = setup([frame(1,[face("a")])]);
  const report = frame(1,[face("a")], {sourceEventIds:["unrelated"]});
  const rejected = trackVisualFaces(emptyVisualFaceState(),[report],payload,analysis);
  assert.equal(rejected.updates.length,0);
});
test("disabled visual tracking does not allocate identities", () => {
  const {analysis,payload} = setup([frame(1,[face("a")])]);
  payload.visualFaceInput.enabled = false;
  assert.deepEqual(trackVisualFaces(emptyVisualFaceState(),analysis.visualFaceFrames,payload,analysis).updates,[]);
});
test("face evidence prioritizes editing gestures and completion over generic changed UI screenshots", () => {
  const generic = Array.from({length:10},(_,i)=>({action:"click",button:"left",visualChange:{changed:true},
    screenshotBefore:`ui-${i}-before`,screenshotAfter:`ui-${i}-after`}));
  generic.splice(6,0,{action:"right_click",screenshotBefore:"menu-before",screenshotAfter:"menu-after"},
    {action:"drag",button:"left",visualChange:{changed:true},screenshotBefore:"edit-before",screenshotAfter:"edit-after"},
    {action:"click",button:"left",visualChange:{changed:false},screenshotBefore:"completion-before",screenshotAfter:"completion-after"});
  const names = visualFacePriorityScreenshots(generic,4);
  assert.deepEqual(names,["edit-before","edit-after","completion-before","completion-after"]);
});
test("deleting an owning object retires its face tracks and removes them from future context", () => {
  const {state} = run([frame(1,[face("a")])], a=>a.maxProgram.operations.push({kind:"delete_objects",targetObjectIds:["obj"],sourceEventIds:["evt-1"]}));
  assert.equal(state.tracks[0].status,"retired");
  assert.equal(state.tracks[0].retirementReason,"owning_object_deleted");
  assert.equal(visualFaceContext(state).tracks.length,0);
  assert.equal(visualFaceContextScreenshots(state).length,0);
});
