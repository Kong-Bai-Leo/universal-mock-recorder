import test from "node:test";
import assert from "node:assert/strict";
import { buildThreeDsMaxEvidenceCrop } from "../src/analyzer/lib/threedsmax-evidence-crops.mjs";
import { annotateThreeDsMaxTransformContexts, buildThreeDsMaxTransformHarness } from "../src/analyzer/lib/threedsmax-transform-harness.mjs";
import { assertThreeDsMaxEvidenceCoverage } from "../src/analyzer/lib/threedsmax-replay-audit.mjs";
import { emptyThreeDsMaxAnalysis, validateThreeDsMaxAnalysis, THREE_DSMAX_ANALYSIS_SCHEMA } from "../src/analyzer/lib/threedsmax-workflow.mjs";
import { chunkThreeDsMaxActions, previousThreeDsMaxActionTail, selectPreviousThreeDsMaxContextImages } from "../src/analyzer/lib/threedsmax-chunks.mjs";
import { selectThreeDsMaxScreenshots } from "../src/analyzer/lib/threedsmax-screenshots.mjs";

const drag = () => ({ action: "drag", button: "left", sourceEventIds: ["evt-201", "evt-205"],
  screenshotBefore: "before.jpg", screenshotAfter: "after.jpg", visualChange: { changed: true },
  transformEvidence: [{ kind: "transform_type_in", screenshot: "xyz.jpg", uploadedEvidence: true }] });
const assessment = (overrides = {}) => ({
  sourceEventIds: ["evt-201", "evt-205"], category: "object_transform", selectionLevel: "object",
  activeTool: "Move", coordinateMeaning: "position", displayMode: "absolute",
  numericReadability: "readable", persistentChange: true, evidenceScreenshots: ["before.jpg", "after.jpg"],
  reason: "Visible Move tool and object selection with labeled XYZ", ...overrides
});
const payload = () => ({ evidencePolicyVersion: 2, actions: [drag()] });
function result(item, operations = []) {
  const value = emptyThreeDsMaxAnalysis();
  value.dragAssessments = [item];
  value.maxProgram.operations = operations;
  return value;
}
const transform = (overrides = {}) => ({ kind: "transform", sourceEventIds: ["evt-201", "evt-205"],
  confidence: 0.95, transform: { mode: "absolute", position: [1, 2, 3], rotationEulerDegrees: null, scalePercent: null }, ...overrides });

test("Bevel is reported incomplete without forced object XYZ or a retry loop", () => {
  const value = result(assessment({ category: "subobject_edit", selectionLevel: "subobject", activeTool: "Bevel",
    coordinateMeaning: "not_applicable", displayMode: "not_applicable", numericReadability: "not_applicable" }));
  assert.doesNotThrow(() => assertThreeDsMaxEvidenceCoverage(value, payload()));
  assert.equal(value.maxProgram.complete, false);
  value.maxProgram.operations.push(transform());
  assert.throws(() => assertThreeDsMaxEvidenceCoverage(value, payload()), /子对象编辑/);
});
test("unreadable crop is explicit uncertainty, not permission to fabricate", () => {
  const value = result(assessment({ category: "unresolved", numericReadability: "unreadable", displayMode: "unknown", persistentChange: null }));
  assertThreeDsMaxEvidenceCoverage(value, payload());
  assert.equal(value.maxProgram.complete, false);
  value.maxProgram.operations.push(transform());
  assert.throws(() => assertThreeDsMaxEvidenceCoverage(value, payload()), /不支持整体变换/);
});
test("confirmed numeric transforms still require an actual operation, not select_objects", () => {
  assert.throws(() => assertThreeDsMaxEvidenceCoverage(result(assessment(), [{ kind: "select_objects", sourceEventIds: ["evt-201"] }]), payload()), /未生成对应变换/);
  assert.doesNotThrow(() => assertThreeDsMaxEvidenceCoverage(result(assessment(), [transform()]), payload()));
});
test("scale XYZ cannot be emitted as position; cursor XYZ cannot transform an object", () => {
  assert.throws(() => assertThreeDsMaxEvidenceCoverage(result(assessment({ activeTool: "Scale", coordinateMeaning: "scale" }), [transform()]), payload()), /字段不一致/);
  assert.throws(() => assertThreeDsMaxEvidenceCoverage(result(assessment({ coordinateMeaning: "cursor_world" }), [transform()]), payload()), /不支持整体变换/);
});
test("coverage rejects unuploaded evidence and duplicate or missing interpretations", () => {
  assert.throws(() => assertThreeDsMaxEvidenceCoverage(result(assessment({ evidenceScreenshots: ["unuploaded.jpg"] })), payload()), /未上传/);
  const value = result(assessment()); value.dragAssessments.push(assessment());
  assert.throws(() => assertThreeDsMaxEvidenceCoverage(value, payload()), /仅有一项/);
  assert.throws(() => assertThreeDsMaxEvidenceCoverage(emptyThreeDsMaxAnalysis(), payload()), /dragAssessments/);
});
test("legacy narrow XYZ crop is recovered from matching full frame, retaining toggle region", () => {
  const action = { window: { width: 2576, height: 1408 } };
  const evidence = { kind: "transform_type_in", pixelBounds: [1757, 1316, 489, 77], relativeBounds: [0.685, 0.94, 0.19, 0.055] };
  const plan = buildThreeDsMaxEvidenceCrop(action, evidence, true);
  assert.equal(plan.fromFullFrame, true);
  assert.ok(plan.crop.centerX - plan.crop.width / 2 < 1757);
  assert.ok(plan.crop.width > 900);
  const fallback = buildThreeDsMaxEvidenceCrop(action, evidence, false);
  assert.deepEqual(fallback.crop, { centerX: 244.5, centerY: 38.5, width: 489, height: 77 });
});
test("parameter fallback never cuts off field labels", () => {
  const plan = buildThreeDsMaxEvidenceCrop({}, { kind: "command_panel_parameters", pixelBounds: [0, 0, 250, 380] });
  assert.deepEqual(plan.crop, { centerX: 125, centerY: 190, width: 250, height: 380 });
});
test("stale W tool is invalidated by an unknown click and Bevel is a subobject candidate", () => {
  const actions = [{ action: "type_text", text: "W" }, { action: "click" }, { action: "click", target: { name: "Bevel" } }];
  annotateThreeDsMaxTransformContexts(actions);
  assert.equal(actions[0].threeDsMaxTransformContext.activeTool, "move");
  assert.equal(actions[1].threeDsMaxTransformContext.activeTool, null);
  assert.equal(actions[2].threeDsMaxTransformContext.interactionMode, "subobject_edit_candidate");
});
test("capture timing is reported rather than incorrectly guaranteed", () => {
  const harness = buildThreeDsMaxTransformHarness({ ...drag(), startMs: 1000, screenshotBeforeTimestampMs: 1053,
    from: { x: 10, y: 10, relativeX: 0.4, relativeY: 0.4 }, to: { x: 14, y: 0, relativeX: 0.4, relativeY: 0.3 } });
  assert.equal(harness.interactionState, "viewport_drag_candidate");
  assert.equal(harness.coordinateDisplayCapture.beforeTimestampMs, 1053);
  assert.match(harness.coordinateDisplayCapture.beforeTiming, /verify/);
});
test("near-boundary Shift drag stays with its Clone Options without duplicate actions", () => {
  const actions = Array.from({ length: 5 }, (_, i) => ({ action: "click", sourceEventIds: [`evt-${i}`] }));
  actions[2] = { ...actions[2], action: "drag", button: "left", modifiers: ["SHIFT"] };
  actions[3].window = { title: "Clone Options" };
  const chunks = chunkThreeDsMaxActions(actions, 3);
  assert.deepEqual(chunks.map((part) => part.length), [2, 3]);
  assert.deepEqual(chunks.flat(), actions);
  assert.deepEqual(previousThreeDsMaxActionTail(chunks, 1), actions.slice(0, 2));
  assert.deepEqual(previousThreeDsMaxActionTail(chunks, 0), []);
});
test("context images have a bounded allowance and numeric pair selection is atomic", () => {
  const action = { ...drag(), modifiers: ["SHIFT"], transformEvidence: [
    { kind: "transform_type_in", phase: "before", screenshot: "xyz-before.jpg" },
    { kind: "transform_type_in", phase: "after", screenshot: "xyz-after.jpg" }
  ] };
  assert.ok(selectPreviousThreeDsMaxContextImages([action]).length <= 4);
  for (let budget = 1; budget <= 6; budget++) {
    const names = selectThreeDsMaxScreenshots([action], budget);
    assert.ok(names.length <= budget);
    assert.equal(names.includes("xyz-before.jpg"), names.includes("xyz-after.jpg"));
  }
});
test("new strict response schema has all properties required and supports legacy saved plans", () => {
  function check(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "object") {
      assert.equal(node.additionalProperties, false);
      assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort());
    }
    for (const value of Object.values(node)) if (value && typeof value === "object") check(value);
  }
  check(THREE_DSMAX_ANALYSIS_SCHEMA);
  const old = emptyThreeDsMaxAnalysis(); delete old.dragAssessments;
  assert.deepEqual(validateThreeDsMaxAnalysis(old).dragAssessments, []);
});
