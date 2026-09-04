// Visual estimates are proposals, not calibrated measurements. This module
// checks their provenance/arithmetic; it does not claim to verify image accuracy.
const range = { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 };
const strings = { type: "array", items: { type: "string" }, minItems: 1 };
export const BEVEL_APPROXIMATION_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    method: { type: "string", enum: ["reference_geometry_ratio"] },
    reference: {
      type: "object", additionalProperties: false,
      properties: {
        objectId: { type: "string" }, operationId: { type: "string" },
        parameter: { type: "string" }, value: { type: "number" }
      }, required: ["objectId", "operationId", "parameter", "value"]
    },
    heightRatio: { type: "number" }, outlineRatio: { type: "number" },
    heightRatioRange: range, outlineRatioRange: range,
    confidence: { type: "number", minimum: 0, maximum: 0.45 },
    view: { type: "string", enum: ["orthographic", "perspective"] },
    viewStable: { type: "boolean" }, referenceVisibleUnchanged: { type: "boolean" },
    reason: { type: "string" }, limitations: strings
  },
  required: ["method", "reference", "heightRatio", "outlineRatio", "heightRatioRange", "outlineRatioRange",
    "confidence", "view", "viewStable", "referenceVisibleUnchanged", "reason", "limitations"]
};

export function normalizeBevelApproximation(operation) {
  const edit = operation.polyEdit;
  edit.approximation ??= null; // Older saved exact plans.
  const estimate = edit.approximation;
  if (estimate === null) return;
  const fail = (message) => { throw new Error(`${operation.id}: Bevel 视觉估算 ${message}`); };
  if (estimate.method !== "reference_geometry_ratio") fail("不支持固定鼠标像素换算");
  const ref = estimate.reference;
  if (!ref || ![ref.objectId, ref.operationId, ref.parameter].every(nonempty) || !Number.isFinite(ref.value) || ref.value <= 0)
    fail("缺少有效的已知尺寸参照");
  if (ref.objectId !== operation.targetObjectIds?.[0]) fail("首版只支持同一目标对象的已知尺寸参照，不能混用不同物体的局部尺度");
  if (!["orthographic", "perspective"].includes(estimate.view) || estimate.viewStable !== true || estimate.referenceVisibleUnchanged !== true)
    fail("需要稳定视角及可见且未改变的参照尺寸；导航后必须重新建立证据");
  if (!nonempty(estimate.reason) || !Array.isArray(estimate.limitations) || !estimate.limitations.length || !estimate.limitations.every(nonempty))
    fail("必须说明形状比例依据和不确定性");
  if (!Number.isFinite(estimate.confidence) || estimate.confidence <= 0 || estimate.confidence > 0.45)
    fail("confidence 必须大于 0 且不超过 0.45，不能冒充精确值");
  for (const field of ["height", "outline"]) {
    const ratio = estimate[`${field}Ratio`];
    const bounds = estimate[`${field}RatioRange`];
    if (!Number.isFinite(ratio) || !Array.isArray(bounds) || bounds.length !== 2 || !bounds.every(Number.isFinite) ||
        bounds[0] >= bounds[1] || ratio < bounds[0] || ratio > bounds[1]) fail(`${field} 缺少包含估值的非零不确定范围`);
    if (ratio !== 0 && bounds[0] * bounds[1] <= 0) fail(`${field} 方向不确定，不能猜测正负`);
    if (bounds[1] - bounds[0] > Math.max(0.1, Math.abs(ratio) * 1.5)) fail(`${field} 不确定范围过大，应保留为未解析`);
    const computed = roundedEstimate(ref.value * ratio);
    if (!Number.isFinite(computed) || !bounds.every((v) => Number.isFinite(v * ref.value))) fail(`${field} 比例计算溢出`);
    // A null field asks the local compiler to calculate it. An explicit field
    // must agree with the documented ratio, rather than smuggling another value.
    if (edit[field] != null && (!Number.isFinite(edit[field]) || Math.abs(edit[field] - computed) > Math.max(1e-8, Math.abs(computed) * 0.006)))
      fail(`${field} 与参照尺寸乘比例不一致；可填 null 由本地计算`);
    edit[field] = computed;
  }
  operation.confidence = Math.min(operation.confidence, estimate.confidence);
}

export function assertBevelReference(operation, references) {
  const proposed = operation.polyEdit?.approximation?.reference;
  if (!proposed) return;
  const match = references.find((ref) => ref.objectId === proposed.objectId && ref.operationId === proposed.operationId &&
    ref.parameter === proposed.parameter && Math.abs(ref.value - proposed.value) <= Math.max(1e-8, Math.abs(ref.value) * 1e-8));
  if (!match) throw new Error(`${operation.id}: Bevel 视觉估算参照不是此前已确认且仍有效的尺寸，不能使用未来、默认或猜测的尺寸`);
}

const dimensionNames = new Set(["radius", "radius1", "radius2", "length", "width", "height"]);
export function advanceGeometryReferences(references, operation) {
  let result = [...references];
  const targets = operation.targetObjectIds ?? [];
  const invalidate = (ids) => { result = result.filter((ref) => !ids.includes(ref.objectId)); };
  if (operation.kind === "delete_objects") invalidate(targets);
  // Conservative invalidation: shared/instanced geometry may be affected too.
  // A historical primitive dimension is not automatically a current mesh size.
  if (["bevel_faces", "add_modifier", "other"].includes(operation.kind) ||
      operation.kind === "set_parameters" && operation.propertyTarget !== "object") return [];
  if (operation.kind === "transform" && operation.transform?.scalePercent !== null) invalidate(targets);
  if (operation.kind === "clone_objects") {
    for (const [index, id] of operation.resultObjectIds.entries()) {
      const source = targets[index];
      if (operation.transform?.scalePercent == null) result.push(...references.filter((ref) => ref.objectId === source).map((ref) => ({ ...ref, objectId: id })));
    }
  }
  if (!["create_primitive", "set_parameters"].includes(operation.kind)) return result;
  const ids = operation.kind === "create_primitive" ? operation.resultObjectIds : targets;
  for (const p of operation.parameters ?? []) {
    const parameter = p.name.toLowerCase();
    if (!dimensionNames.has(parameter)) continue;
    // Any edit invalidates the old value, including an unreadable/estimated edit.
    result = result.filter((ref) => !((operation.kind === "set_parameters" || ids.includes(ref.objectId)) && ref.parameter === parameter));
    if (!Number.isFinite(p.value) || p.value <= 0 || p.confidence < 0.85 || /estimated|normalized/i.test(p.unit ?? "") || operation.confidence < 0.85) continue;
    for (const objectId of ids) result.push({ objectId, operationId: operation.id, parameter, value: p.value });
  }
  return result;
}

export function geometryReferencesFromParts(parts) {
  let refs = [];
  for (const part of parts) for (const op of part.maxProgram.operations) refs = advanceGeometryReferences(refs, op);
  return refs;
}

export function annotateReplayAccuracy(program) {
  const estimates = program.operations.filter((op) => op.polyEdit?.approximation);
  program.containsEstimates = estimates.length > 0 || program.operations.some((op) =>
    op.parameters?.some((p) => /estimated|normalized/i.test(p.unit ?? "")));
  program.replayAccuracy = program.complete !== true ? "partial" : program.containsEstimates ? "approximate" : "exact";
  for (const op of estimates) {
    const a = op.polyEdit.approximation;
    const bounds = (field) => a[`${field}RatioRange`].map((r) => roundedEstimate(r * a.reference.value)).join(" .. ");
    const warning = `${op.id}: Bevel 为视觉估算（非精确测量）：Height=${op.polyEdit.height}，Outline=${op.polyEdit.outline}；` +
      `模型估计范围 Height=[${bounds("height")}]、Outline=[${bounds("outline")}]，不是统计置信区间。`;
    if (!program.warnings.includes(warning)) program.warnings.push(warning);
  }
  if (estimates.length) program.confidence = Math.min(program.confidence, ...estimates.map((op) => op.confidence));
}

function roundedEstimate(value) { return Number(value.toPrecision(3)); }
function nonempty(value) { return typeof value === "string" && value.trim().length > 0; }
