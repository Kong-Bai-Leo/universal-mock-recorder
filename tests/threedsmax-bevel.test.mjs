import test from "node:test";
import assert from "node:assert/strict";
import { bevelOperation, bevelAnalysis } from "./fixtures/threedsmax-bevel.mjs";
import { validateThreeDsMaxAnalysis } from "../src/analyzer/lib/threedsmax-workflow.mjs";
import { renderMaxScript } from "../src/analyzer/lib/maxscript-renderer.mjs";
import { assertThreeDsMaxEvidenceCoverage } from "../src/analyzer/lib/threedsmax-replay-audit.mjs";
import { buildThreeDsMaxObjectContext } from "../src/analyzer/lib/threedsmax-face-catalog.mjs";
import { selectThreeDsMaxScreenshots } from "../src/analyzer/lib/threedsmax-screenshots.mjs";

test("Bevel compiles an explicit face selector and height/outline, not a whole-object transform", () => {
  const rendered = renderMaxScript(bevelAnalysis());
  assert.equal(rendered.partial, false);
  assert.match(rendered.script, /\.bevelFaces 5\.0 -1\.0/);
  assert.match(rendered.script, /umr_faces.numberSet != 1/);
  assert.match(rendered.script, /classOf umr_node.baseObject != Editable_Poly/);
  assert.doesNotMatch(rendered.script, /move umr_obj|\.position =/);
});
test("Bevel rejects absent numbers, default placeholders and conflicting object transforms", () => {
  for (const number of [null, undefined, NaN, "5"]) {
    const op = bevelOperation(); op.polyEdit.height = number;
    assert.throws(() => validateThreeDsMaxAnalysis(bevelAnalysis(op)), /height\/outline/);
  }
  const op = bevelOperation(); op.transform.mode = "absolute";
  assert.throws(() => renderMaxScript(bevelAnalysis(op)), /整体 transform/);
});
test("face-index selector requires geometry checks and matching object/revision namespace", () => {
  const op = bevelOperation();
  op.polyEdit.selection = { method: "face_indices", indices: [2], faceIds: ["obj:t0:f2"], topologyRevision: 0,
    axis: null, side: null, expectedCount: 1, expectedFaceCount: 6, expectedVertexCount: 8,
    faceChecks: [{ index: 2, center: [0,0,10], normal: [0,0,1] }] };
  assert.match(renderMaxScript(bevelAnalysis(op)).script, /face-center guard failed/);
  op.polyEdit.selection.faceIds = ["other-object:t0:f2"];
  assert.throws(() => renderMaxScript(bevelAnalysis(op)), /面 ID/);
  op.polyEdit.selection.faceIds = ["obj:t0:f2"];
  op.polyEdit.selection.faceChecks = [];
  assert.throws(() => renderMaxScript(bevelAnalysis(op)), /局部中心/);
});
test("Bevel type is explicit and local-normal bias cannot be silently defaulted", () => {
  const op = bevelOperation(); op.polyEdit.bevelType = "local_normal";
  assert.throws(() => renderMaxScript(bevelAnalysis(op)), /bias/);
  op.polyEdit.bias = 0.75;
  assert.match(renderMaxScript(bevelAnalysis(op)).script, /bevel_bias = 0\.75/);
});
test("conversion creates logical face records without detaching nodes", () => {
  const op = bevelOperation({ kind: "convert_to_poly", polyEdit: null });
  const script = renderMaxScript(bevelAnalysis(op)).script;
  assert.match(script, /umrRecordFaces UMRFaceCatalogs umr_obj_1 "obj" 1/);
  assert.match(script, /getFaceCenter/);
  assert.match(script, /getFaceNormal/);
  assert.doesNotMatch(script, /detachFaces|snapshotAsMesh/);
});
test("later topology changes invalidate old face references and propagate instance revisions", () => {
  const first = bevelOperation();
  const second = bevelOperation({ id: "next" }); second.polyEdit.selection.topologyRevision = 0;
  const input = bevelAnalysis(); input.maxProgram.operations = [first, second];
  assert.throws(() => renderMaxScript(input), /stale face topology revision/);
  const instance = bevelOperation({ id: "clone", kind: "clone_objects", polyEdit: null,
    resultObjectIds: ["copy"], parameters: [{ name: "cloneType", value: "Instance", unit: null, confidence: 1 }] });
  input.maxProgram.operations = [instance, first];
  const context = buildThreeDsMaxObjectContext([input]);
  assert.equal(context.find((item) => item.id === "obj").topologyRevision, 1);
  assert.equal(context.find((item) => item.id === "copy").topologyRevision, 1);
  assert.equal(context[0].faceCatalog.geometryAvailableToAnalysis, false);
});
test("supported Bevel covers a subobject drag without falsely marking replay incomplete", () => {
  const input = bevelAnalysis();
  input.dragAssessments = [{ sourceEventIds: ["evt-bevel"], category: "subobject_edit", selectionLevel: "subobject",
    activeTool: "Bevel", coordinateMeaning: "not_applicable", displayMode: "not_applicable",
    numericReadability: "not_applicable", persistentChange: true, evidenceScreenshots: ["after.jpg"], reason: "Confirmed face Bevel" }];
  const payload = { evidencePolicyVersion: 2, actions: [{ action: "drag", button: "left", sourceEventIds: ["evt-bevel"],
    screenshotBefore: "selection.jpg", screenshotAfter: "after.jpg", transformEvidence: [
      { kind: "subobject_parameters", screenshot: "parameters.jpg", uploadedEvidence: true }
    ] }] };
  const normalized = validateThreeDsMaxAnalysis(input);
  assertThreeDsMaxEvidenceCoverage(normalized, payload);
  assert.equal(normalized.maxProgram.complete, true);
  payload.actions[0].transformEvidence[0].kind = "transform_type_in";
  assert.throws(() => assertThreeDsMaxEvidenceCoverage(input, payload), /不能从整体 XYZ/);
  payload.actions[0].transformEvidence[0].uploadedEvidence = false;
  assert.throws(() => assertThreeDsMaxEvidenceCoverage(input, payload), /未上传/);
});
test("Bevel requires completion evidence and preserves parameter caddy before dismissal", () => {
  const op = bevelOperation(); op.polyEdit.evidence.completion = [];
  assert.throws(() => renderMaxScript(bevelAnalysis(op)), /completion/);
  const images = selectThreeDsMaxScreenshots([{ action: "click", screenshotBefore: "full1", screenshotAfter: "full2", transformEvidence: [
    { kind: "subobject_parameters", phase: "before", screenshot: "caddy-before" },
    { kind: "subobject_parameters", phase: "after", screenshot: "caddy-after" }
  ] }], 3);
  assert.ok(images.includes("caddy-before"));
  assert.ok(images.includes("full2"));
});
test("non-Bevel operations cannot smuggle an uncompiled poly edit", () => {
  assert.throws(() => renderMaxScript(bevelAnalysis(bevelOperation({ kind: "select_objects" }))), /仅适用于/);
});
test("deleted objects and their faces cannot be referenced again", () => {
  const input = bevelAnalysis();
  const deletion = bevelOperation({ id: "delete", kind: "delete_objects", polyEdit: null });
  input.maxProgram.operations = [deletion, bevelOperation()];
  assert.throws(() => renderMaxScript(input), /尚未定义/);
  assert.deepEqual(buildThreeDsMaxObjectContext([bevelAnalysis(deletion)]), []);
  input.maxProgram.operations = [deletion, bevelOperation({ id: "recreate", kind: "create_primitive", polyEdit: null,
    targetObjectIds: [], resultObjectIds: ["obj"], className: "Box" })];
  assert.throws(() => renderMaxScript(input), /对象 ID 重复/);
});
