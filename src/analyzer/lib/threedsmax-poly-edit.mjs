import { BEVEL_APPROXIMATION_SCHEMA, normalizeBevelApproximation } from "./threedsmax-approximation.mjs";

const vector3 = { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 };
const positiveInteger = { type: "integer", minimum: 1 };
const nullableCount = { type: ["integer", "null"], minimum: 1 };
const faceCheck = {
  type: "object", additionalProperties: false,
  properties: { index: positiveInteger, center: vector3, normal: vector3 },
  required: ["index", "center", "normal"]
};
export const POLY_EDIT_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    height: { type: ["number", "null"] }, outline: { type: ["number", "null"] },
    approximation: { anyOf: [BEVEL_APPROXIMATION_SCHEMA, { type: "null" }] },
    bevelType: { type: "string", enum: ["group", "local_normal", "by_polygon"] },
    bias: { type: ["number", "null"] },
    selection: {
      type: "object", additionalProperties: false,
      properties: {
        method: { type: "string", enum: ["face_indices", "axis_extreme"] },
        indices: { type: "array", items: positiveInteger },
        faceIds: { type: "array", items: { type: "string" } },
        topologyRevision: { type: ["integer", "null"], minimum: 0 },
        axis: { type: ["string", "null"], enum: ["x", "y", "z", null] },
        side: { type: ["string", "null"], enum: ["min", "max", null] },
        expectedCount: positiveInteger,
        expectedFaceCount: nullableCount, expectedVertexCount: nullableCount,
        faceChecks: { type: "array", items: faceCheck }
      },
      required: ["method", "indices", "faceIds", "topologyRevision", "axis", "side", "expectedCount", "expectedFaceCount", "expectedVertexCount", "faceChecks"]
    },
    evidence: {
      type: "object", additionalProperties: false,
      properties: {
        selection: { type: "array", items: { type: "string" }, minItems: 1 },
        parameters: { type: "array", items: { type: "string" }, minItems: 1 },
        completion: { type: "array", items: { type: "string" }, minItems: 1 }
      }, required: ["selection", "parameters", "completion"]
    }
  }, required: ["height", "outline", "approximation", "bevelType", "bias", "selection", "evidence"]
};

export function validatePolyEdit(operation) {
  const fail = (message) => { throw new Error(`${operation.id}: Bevel ${message}`); };
  const edit = operation.polyEdit;
  if (!edit || typeof edit !== "object") fail("缺少 polyEdit");
  normalizeBevelApproximation(operation);
  if (operation.targetObjectIds.length !== 1 || operation.resultObjectIds.length !== 0)
    fail("必须修改一个既有对象，不能创建新对象身份");
  if (operation.transform?.mode !== "none" ||
    [operation.transform.position, operation.transform.rotationEulerDegrees, operation.transform.scalePercent].some((v) => v !== null))
    fail("不能携带整体 transform");
  if (operation.parameters.length || operation.propertyTarget !== "object") fail("参数必须写入 polyEdit，目标必须为 base object");
  if (![edit.height, edit.outline].every(Number.isFinite)) fail("height/outline 必须为有证据的有限数值");
  if (edit.height === 0 && edit.outline === 0) fail("不能用全零参数冒充持久变化");
  if (!["group", "local_normal", "by_polygon"].includes(edit.bevelType)) fail("bevelType 无效");
  if (edit.bevelType === "local_normal" ? !Number.isFinite(edit.bias) : edit.bias !== null) fail("Local Normal 必须提供 bias，其它模式使用 null");
  const s = edit.selection;
  if (!s || !["face_indices", "axis_extreme"].includes(s.method)) fail("选面方法无效");
  if (!Number.isInteger(s.expectedCount) || s.expectedCount < 1) fail("缺少准确的选中面数量");
  for (const field of ["expectedFaceCount", "expectedVertexCount"])
    if (s[field] !== null && (!Number.isInteger(s[field]) || s[field] < 1)) fail(`${field} 无效`);
  if (!Array.isArray(s.indices) || !Array.isArray(s.faceChecks)) fail("indices/faceChecks 必须是数组");
  if (!Array.isArray(s.faceIds) || s.topologyRevision !== null && (!Number.isInteger(s.topologyRevision) || s.topologyRevision < 0)) fail("逻辑面身份或拓扑版本无效");
  if (s.method === "axis_extreme") {
    if (!["x", "y", "z"].includes(s.axis) || !["min", "max"].includes(s.side) || s.indices.length || s.faceChecks.length || s.faceIds.length)
      fail("axis_extreme 需要物体局部轴及 min/max，不能混入面编号");
  } else {
    if (!s.expectedFaceCount || !s.expectedVertexCount || s.axis !== null || s.side !== null)
      fail("面编号需要拓扑数量校验，且不能混入极值选择条件");
    if (s.indices.length !== s.expectedCount || new Set(s.indices).size !== s.indices.length ||
      s.indices.some((n) => !Number.isInteger(n) || n < 1 || n > s.expectedFaceCount)) fail("面编号数量、范围或唯一性无效");
    if (s.topologyRevision === null || s.faceIds.length !== s.indices.length ||
      s.faceIds.some((id, i) => id !== `${operation.targetObjectIds[0]}:t${s.topologyRevision}:f${s.indices[i]}`))
      fail("面 ID 必须匹配所属物体、拓扑版本与面编号");
    if (s.faceChecks.length !== s.indices.length || new Set(s.faceChecks.map((f) => f.index)).size !== s.indices.length)
      fail("每个面编号必须有独立的局部中心和法向校验");
    for (const check of s.faceChecks) {
      if (!s.indices.includes(check.index) || !isVector(check.center) || !isVector(check.normal) || Math.abs(Math.hypot(...check.normal) - 1) > 0.001)
        fail("面几何校验必须有已知局部中心与单位法向，不能只凭面编号");
    }
  }
  for (const role of ["selection", "parameters", "completion"]) {
    const names = edit.evidence?.[role];
    if (!Array.isArray(names) || names.length === 0 || names.some((name) => typeof name !== "string" || !name || !operation.sourceScreenshots.includes(name)))
      fail(`缺少 ${role} 证据或未引用 sourceScreenshots`);
  }
  return edit;
}

function isVector(value) {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
}

// All strings below are compiler-owned. Model output is limited to enums and
// validated numbers; no arbitrary MAXScript or raw selection expression enters.
export function renderPolyBevel(operation, nodeVariable) {
  const edit = validatePolyEdit(operation);
  const s = edit.selection;
  const n = (v) => Number.isInteger(v) ? `${v}.0` : String(v);
  const point = (v) => `[${v.map(n).join(",")}]`;
  const lines = [
    ...(edit.approximation ? [`    -- APPROXIMATE BEVEL: Height=${n(edit.height)}, Outline=${n(edit.outline)}; visual estimate, not a measurement.`] : []),
    "    (",
    `      local umr_node = ${nodeVariable}`,
    '      if (classOf umr_node.baseObject != Editable_Poly) or (umr_node.modifiers.count != 0) do throw "Bevel requires a collapsed Editable Poly with no modifiers"',
    "      local umr_poly = umr_node.baseObject",
    "      local umr_nf = polyop.getNumFaces umr_poly",
    "      local umr_nv = polyop.getNumVerts umr_poly",
    '      if umr_nf < 1 or umr_nv < 1 do throw "Bevel target is empty"',
    "      local umr_min = polyop.getVert umr_poly 1",
    "      local umr_max = copy umr_min",
    "      for vi = 2 to umr_nv do (",
    "        local v = polyop.getVert umr_poly vi",
    "        for ai = 1 to 3 do (umr_min[ai] = amin umr_min[ai] v[ai]; umr_max[ai] = amax umr_max[ai] v[ai])",
    "      )",
    "      local umr_tol = amax 0.000001 ((distance umr_min umr_max) * 0.00001)",
    "      local umr_faces = #{}"
  ];
  if (s.expectedFaceCount !== null) lines.push(`      if umr_nf != ${s.expectedFaceCount} do throw "Bevel face-count guard failed"`);
  if (s.expectedVertexCount !== null) lines.push(`      if umr_nv != ${s.expectedVertexCount} do throw "Bevel vertex-count guard failed"`);
  if (s.method === "face_indices") {
    lines.push(`      umr_faces = #{${s.indices.join(",")}}`);
    for (const check of s.faceChecks) {
      lines.push(`      if (distance (polyop.getFaceCenter umr_poly ${check.index}) ${point(check.center)}) > umr_tol do throw "Bevel face-center guard failed"`);
      lines.push(`      if (dot (normalize (polyop.getFaceNormal umr_poly ${check.index})) ${point(check.normal)}) < 0.99999 do throw "Bevel face-normal guard failed"`);
    }
  } else {
    const axis = { x: 1, y: 2, z: 3 }[s.axis];
    const sign = s.side === "max" ? 1 : -1;
    lines.push(`      local umr_extreme = ${s.side === "max" ? "umr_max" : "umr_min"}[${axis}]`);
    lines.push("      for fi = 1 to umr_nf do (");
    lines.push("        local normal = polyop.getFaceNormal umr_poly fi");
    lines.push(`        if normal != undefined and (normal[${axis}] * ${sign}) > 0.99999 do (`);
    lines.push("          local onPlane = true");
    lines.push(`          for vi in (polyop.getFaceVerts umr_poly fi) do (if (abs ((polyop.getVert umr_poly vi)[${axis}] - umr_extreme)) > umr_tol do onPlane = false)`);
    lines.push("          if onPlane do umr_faces[fi] = true");
    lines.push("        )", "      )");
  }
  lines.push(`      if umr_faces.numberSet != ${s.expectedCount} do throw "Bevel face selection is ambiguous or missing"`);
  lines.push("      local umr_oldType = umr_poly.bevelType", "      local umr_oldBias = umr_poly.bevel_bias");
  lines.push("      try (", `        umr_poly.bevelType = ${{ group: 0, local_normal: 1, by_polygon: 2 }[edit.bevelType]}`);
  if (edit.bias !== null) lines.push(`        umr_poly.bevel_bias = ${n(edit.bias)}`);
  lines.push("        polyop.setFaceSelection umr_poly umr_faces");
  lines.push(`        umr_poly.bevelFaces ${n(edit.height)} ${n(edit.outline)}`);
  lines.push("      ) catch (umr_poly.bevelType = umr_oldType; umr_poly.bevel_bias = umr_oldBias; throw())");
  lines.push("      umr_poly.bevelType = umr_oldType", "      umr_poly.bevel_bias = umr_oldBias", "      update umr_node");
  lines.push('      if (polyop.getNumFaces umr_poly) <= umr_nf do throw "Bevel did not create the expected topology change"', "    )");
  return lines;
}
