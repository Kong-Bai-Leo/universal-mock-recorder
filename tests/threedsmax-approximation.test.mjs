import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { bevelOperation, bevelAnalysis } from "./fixtures/threedsmax-bevel.mjs";
import { validateThreeDsMaxAnalysis, mergeThreeDsMaxAnalyses } from "../src/analyzer/lib/threedsmax-workflow.mjs";
import { renderMaxScript } from "../src/analyzer/lib/maxscript-renderer.mjs";
import { assertThreeDsMaxEvidenceCoverage, auditThreeDsMaxReplayCompleteness } from "../src/analyzer/lib/threedsmax-replay-audit.mjs";
import { buildThreeDsMaxObjectContext } from "../src/analyzer/lib/threedsmax-face-catalog.mjs";
import { annotateThreeDsMaxContinuations } from "../src/analyzer/lib/threedsmax-interactions.mjs";
import { visualFacePriorityScreenshots } from "../src/analyzer/lib/threedsmax-visual-faces.mjs";
import { selectThreeDsMaxScreenshots } from "../src/analyzer/lib/threedsmax-screenshots.mjs";
import { chunkThreeDsMaxActions } from "../src/analyzer/lib/threedsmax-chunks.mjs";
import { analyzeChunk } from "../src/analyzer/3dsmax-cli.mjs";
import { buildCandidateActions, readJsonLines } from "../src/analyzer/lib/trace.mjs";
import { estimatedBevelFixture } from "./fixtures/threedsmax-estimated-bevel.mjs";

test("reference-ratio Bevel derives rounded values locally and labels a complete approximate script", () => {
  const input = estimatedBevelFixture();
  const result = validateThreeDsMaxAnalysis(input);
  const op = result.maxProgram.operations.at(-1);
  assert.equal(op.polyEdit.height, 5);
  assert.equal(op.polyEdit.outline, -1);
  assert.equal(op.confidence, 0.4);
  assert.equal(result.maxProgram.complete, true);
  assert.equal(result.maxProgram.replayAccuracy, "approximate");
  const rendered = renderMaxScript(result);
  assert.equal(rendered.approximate, true);
  assert.equal(rendered.partial, false);
  assert.match(rendered.script, /APPROXIMATE BEVEL/);
  assert.match(rendered.script, /\.bevelFaces 5\.0 -1\.0/);
  assert.match(rendered.script, /numberSet != 1/);
  assert.equal(input.maxProgram.operations.at(-1).polyEdit.height, null, "normalizing must not mutate raw model output");
});

test("exact Bevel is unchanged and null numbers without an estimate still fail", () => {
  const exact = bevelAnalysis();
  assert.equal(renderMaxScript(exact).approximate, false);
  exact.maxProgram.operations[0].polyEdit.height = null;
  assert.throws(() => validateThreeDsMaxAnalysis(exact), /height\/outline/);
});

test("estimate guards reject invented anchors, future anchors and numerically inconsistent proposals", () => {
  for (const change of [
    (a) => a.reference.value = 999,
    (a) => a.reference.operationId = "future-op",
    (a) => a.reference.parameter = "imaginary-size",
    (a) => a.reference.objectId = "another-object"
  ]) {
    const input = estimatedBevelFixture(); change(input.maxProgram.operations.at(-1).polyEdit.approximation);
    assert.throws(() => validateThreeDsMaxAnalysis(input), /参照|尺度/);
  }
  const input = estimatedBevelFixture(); input.maxProgram.operations.at(-1).polyEdit.height = 99;
  assert.throws(() => validateThreeDsMaxAnalysis(input), /不一致/);
  const future = estimatedBevelFixture(); future.maxProgram.operations.reverse();
  assert.throws(() => validateThreeDsMaxAnalysis(future), /参照|尚未定义/);
});

test("approximation cannot smuggle exactness, ambiguous directions or unsupported calibration", () => {
  for (const change of [
    (a) => a.confidence = 0.99,
    (a) => a.heightRatioRange = [0.5, 0.5],
    (a) => a.heightRatioRange = [-1, 1],
    (a) => a.heightRatioRange = [0.1, 3],
    (a) => a.outlineRatioRange = [1, 2],
    (a) => a.method = "pixels_times_constant",
    (a) => a.viewStable = false,
    (a) => a.referenceVisibleUnchanged = false,
    (a) => a.limitations = []
  ]) {
    const input = estimatedBevelFixture(); change(input.maxProgram.operations.at(-1).polyEdit.approximation);
    assert.throws(() => validateThreeDsMaxAnalysis(input), /视觉估算/);
  }
});

test("low-confidence and estimated dimensions cannot become a trusted scale reference", () => {
  for (const change of [
    (p) => p.confidence = 0.4,
    (p) => p.unit = "estimated_scene_units",
    (p) => p.unit = "normalized_units"
  ]) {
    const input = estimatedBevelFixture(); change(input.maxProgram.operations[0].parameters[0]);
    assert.throws(() => validateThreeDsMaxAnalysis(input), /参照/);
  }
});

test("geometry references survive conversion and chunk boundaries, but not unknown geometry/scale changes", () => {
  const all = estimatedBevelFixture();
  const first = structuredClone(all); first.maxProgram.operations.pop();
  const context = buildThreeDsMaxObjectContext([first]);
  assert.equal(context[0].geometryReferences.find((r) => r.parameter === "radius").value, 10);
  const second = structuredClone(all); second.maxProgram.operations = [second.maxProgram.operations.at(-1)];
  const options = { knownObjectIds: ["obj"], geometryReferences: context[0].geometryReferences };
  assert.doesNotThrow(() => validateThreeDsMaxAnalysis(second, options));
  assert.equal(mergeThreeDsMaxAnalyses([first, second]).maxProgram.replayAccuracy, "approximate");
  for (const kind of ["add_modifier", "other", "transform"]) {
    const changed = structuredClone(first);
    changed.maxProgram.operations.push(bevelOperation({ id: "change", kind, polyEdit: null, className: "Bend",
      transform: { mode: "relative", position: null, rotationEulerDegrees: null, scalePercent: [200,200,200], coordinateSystem: "local" } }));
    assert.equal(buildThreeDsMaxObjectContext([changed])[0].geometryReferences.length, 0);
  }
});

function evidencePayload() {
  return { evidencePolicyVersion: 2, actions: [
    { action: "drag", button: "left", sourceEventIds: ["evt-bevel"], startMs: 10, endMs: 20,
      screenshotBefore: "selection.jpg", screenshotAfter: "height.jpg",
      interactiveContinuation: { completionEventIds: ["evt-confirm"] } },
    { action: "click", button: "left", sourceEventIds: ["evt-confirm"], startMs: 30, endMs: 40,
      screenshotBefore: "preview.jpg", screenshotAfter: "after.jpg" }
  ] };
}
function estimatedWithAssessment() {
  const input = estimatedBevelFixture();
  input.maxProgram.operations.at(-1).sourceEventIds.push("evt-confirm");
  input.dragAssessments = [{ sourceEventIds: ["evt-bevel"], category: "subobject_edit", selectionLevel: "subobject", activeTool: "Bevel",
    coordinateMeaning: "not_applicable", displayMode: "not_applicable", numericReadability: "not_applicable", persistentChange: true,
    evidenceScreenshots: ["selection.jpg", "height.jpg"], reason: "Synthetic completed two-stage Bevel" }];
  return validateThreeDsMaxAnalysis(input);
}

test("approximate Bevel needs uploaded full before/final frames, not XYZ/crops or first-stage preview", () => {
  assert.doesNotThrow(() => assertThreeDsMaxEvidenceCoverage(estimatedWithAssessment(), evidencePayload()));
  const missing = evidencePayload(); missing.actions[1].screenshotAfter = null;
  assert.throws(() => assertThreeDsMaxEvidenceCoverage(estimatedWithAssessment(), missing), /未上传/);
  const preview = estimatedWithAssessment(), op = preview.maxProgram.operations.at(-1);
  op.sourceScreenshots.push("height.jpg");
  op.polyEdit.evidence.completion = ["height.jpg"];
  op.polyEdit.evidence.parameters = ["selection.jpg", "height.jpg"];
  assert.throws(() => assertThreeDsMaxEvidenceCoverage(preview, evidencePayload()), /最终确认/);
  const nav = evidencePayload(); nav.actions.splice(1, 0, { action: "scroll", startMs: 25, endMs: 25, sourceEventIds: ["evt-wheel"] });
  assert.throws(() => assertThreeDsMaxEvidenceCoverage(estimatedWithAssessment(), nav), /导航/);
});

test("approximate scripts do not hide other omissions and final audit preserves estimate flag", () => {
  const input = estimatedBevelFixture(); input.maxProgram.complete = false;
  const audited = auditThreeDsMaxReplayCompleteness(validateThreeDsMaxAnalysis(input));
  assert.equal(audited.maxProgram.replayAccuracy, "partial");
  assert.equal(audited.maxProgram.containsEstimates, true);
  assert.equal(renderMaxScript(audited).partial, true);
});

test("existing analyzeChunk consumes an approximate VLM response in one call, without extra paid passes", async () => {
  let calls = 0;
  const output = await analyzeChunk({ client: { analyze: async () => { calls++; return estimatedWithAssessment(); } },
    payload: evidencePayload(), screenshots: [], knownObjects: [], maxValidationRepairs: 0 });
  assert.equal(calls, 1);
  assert.equal(output.maxProgram.replayAccuracy, "approximate");
});

const win = { title: "3ds Max", processName: "3dsmax", processId: 1, x: 0, y: 0, width: 1000, height: 800 };
const pos = (x,y) => ({ x, y, relativeX: x / 1000, relativeY: y / 800 });
function session() {
  const actions = [
    { action: "drag", button: "left", startMs: 0, endMs: 10, window: win, to: pos(500,400), sourceEventIds: ["down","up"], screenshotBefore: "before", screenshotAfter: "height" },
    { action: "click", button: "left", startMs: 200, endMs: 210, window: win, at: pos(500,350), sourceEventIds: ["confirm-down","confirm-up"], screenshotBefore: "preview", screenshotAfter: "final" },
    { action: "press_key", key: "Escape", window: win, sourceEventIds: ["esc"], startMs: 220, endMs: 220, screenshotAfter: "settled" }
  ];
  const events = [{ id: "up", eventType: "mouse_up" }, ...Array.from({ length: 80 }, (_, i) => ({ id: `move-${i}`, eventType: "mouse_move",
    timestampMs: 11+i, window: win, ...pos(500,400-i) })), { id: "confirm-down", eventType: "mouse_down" }];
  return { actions, events };
}

test("free motion after release is bounded and linked to a click, never labeled a definite Bevel", () => {
  const { actions, events } = session(); annotateThreeDsMaxContinuations(actions, events);
  const c = actions[0].interactiveContinuation;
  assert.equal(c.candidateOnly, true);
  assert.equal(c.recordedMotionCount, 80);
  assert.equal(c.sampledPath.length, 8);
  assert.deepEqual(c.deltaPixels, [0,-50]);
  assert.deepEqual(c.completionEventIds, ["confirm-down","confirm-up"]);
  for (const type of ["mouse_wheel", "key_down", "mouse_down"]) {
    const s = session(); s.events.splice(2, 0, { eventType: type });
    annotateThreeDsMaxContinuations(s.actions, s.events);
    assert.equal(s.actions[0].interactiveContinuation, undefined);
  }
  const foreign = session(); foreign.events[1].window = { ...win, title: "Other window" };
  annotateThreeDsMaxContinuations(foreign.actions, foreign.events);
  assert.equal(foreign.actions[0].interactiveContinuation, undefined);
});

test("full before/height/final/settled frames survive a crowded image budget and chunk boundary", () => {
  const { actions, events } = session(); annotateThreeDsMaxContinuations(actions, events);
  const earlier = Array.from({ length: 20 }, (_, i) => ({ action: "click", button: "left", sourceEventIds: [`old-${i}`], screenshotBefore: `before-${i}`, screenshotAfter: `after-${i}`, visualChange: { changed: true } }));
  const all = [...earlier, ...actions];
  const priority = visualFacePriorityScreenshots(all, 6);
  for (const name of ["before","height","final","settled"]) assert.ok(priority.includes(name));
  const selected = selectThreeDsMaxScreenshots(all, 32, { priorityScreenshots: priority });
  assert.ok(selected.length <= 32);
  for (const name of ["before","height","final","settled"]) assert.ok(selected.includes(name));
  const withoutTracking = selectThreeDsMaxScreenshots(all, 32);
  for (const name of ["before","height","final","settled"]) assert.ok(withoutTracking.includes(name));
  const chunks = chunkThreeDsMaxActions([earlier[0], earlier[1], actions[0], actions[1], actions[2]], 3);
  assert.deepEqual(chunks.flat(), [earlier[0], earlier[1], actions[0], actions[1], actions[2]]);
  assert.ok(chunks.some((chunk) => chunk.includes(actions[0]) && chunk.includes(actions[1])));
});

test("local 191220 regression retains real Bevel second-stage motion and full completion, with no API call", async (t) => {
  const file = "bin/3dsmax-recorder/recordings/20260903-191220/events.jsonl";
  if (!await fs.access(file).then(() => true, () => false)) return t.skip("Local recording is intentionally not tracked in git");
  const events = await readJsonLines(file);
  const actions = annotateThreeDsMaxContinuations(buildCandidateActions(events), events);
  const bevel = actions.find((a) => a.sourceEventIds.includes("evt-00000352"));
  assert.equal(bevel.interactiveContinuation.recordedMotionCount, 69);
  assert.ok(bevel.interactiveContinuation.completionEventIds.includes("evt-00000429"));
  const selected = selectThreeDsMaxScreenshots(actions, 32, { priorityScreenshots: visualFacePriorityScreenshots(actions,6) });
  assert.ok(selected.includes("screenshots/evt-00000429.jpg"));
  assert.ok(selected.includes("screenshots/evt-00000435-after.jpg"));
  assert.ok(selected.length <= 32);
});
