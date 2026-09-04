import { validatePolyEdit } from "./threedsmax-poly-edit.mjs";
import { annotateReplayAccuracy } from "./threedsmax-approximation.mjs";

export function auditThreeDsMaxReplayCompleteness(input) {
  const analysis = JSON.parse(JSON.stringify(input));
  const warnings = new Set(analysis.maxProgram?.warnings ?? []);
  let incomplete = false;

  for (const operation of analysis.maxProgram?.operations ?? []) {
    if (operation.kind !== "create_primitive") continue;
    if ((operation.parameters ?? []).length === 0) {
      warnings.add(`${operation.id} 创建了 ${operation.className ?? "基本体"}，但没有任何带标签的尺寸参数；默认尺寸不能视为录制结果。`);
      incomplete = true;
    }
    const transform = operation.transform ?? {};
    if (transform.mode === "none" || transform.position === null) {
      warnings.add(`${operation.id} 缺少精确创建位置；不能把 3ds Max 默认原点当作用户取点。`);
      incomplete = true;
    }
  }

  if (incomplete) analysis.maxProgram.complete = false;
  analysis.maxProgram.warnings = [...warnings];
  annotateReplayAccuracy(analysis.maxProgram);
  return analysis;
}

export function assertThreeDsMaxEvidenceCoverage(analysis, payload) {
  const actions = payload?.actions ?? [];
  assertQuickAlignCoverage(analysis, actions);
  assertDragInterpretations(analysis, payload);
  const suppliedActions = [...(payload?.previousContext?.rawActionTail ?? []), ...actions];
  for (const operation of analysis?.maxProgram?.operations ?? []) {
    if (operation.kind !== "bevel_faces") continue;
    validatePolyEdit(operation);
    const related = suppliedActions.filter((action) => intersects(operation.sourceEventIds, action.sourceEventIds ?? []));
    const imageRoles = new Map();
    for (const action of related) {
      for (const name of [action.screenshotBefore, action.screenshotAfter, action.screenshotSelection].filter(Boolean)) imageRoles.set(name, "full_frame");
      for (const item of action.transformEvidence ?? []) if (item.uploadedEvidence) imageRoles.set(item.screenshot, item.kind);
    }
    for (const role of ["selection", "parameters", "completion"]) {
      if (operation.polyEdit.evidence[role].some((name) => !imageRoles.has(name)))
        throw new Error(`${operation.id}: Bevel ${role} 引用了未上传或无关联事件的截图`);
    }
    if (operation.polyEdit.evidence.parameters.every((name) => imageRoles.get(name) === "transform_type_in"))
      throw new Error(`${operation.id}: Bevel 的 Height/Outline 不能从整体 XYZ 字段读取`);
    if (operation.polyEdit.approximation) assertApproximationImages(operation, suppliedActions, imageRoles);
  }
  for (const operation of analysis?.maxProgram?.operations ?? []) {
    const relatedActions = actions.filter((action) => intersects(
      operation.sourceEventIds ?? [],
      action.sourceEventIds ?? []
    ));
    const evidenceKinds = new Set(relatedActions.flatMap((action) =>
      (action.transformEvidence ?? []).map((item) => item.kind)));

    if (operation.kind === "create_primitive" &&
      evidenceKinds.has("command_panel_parameters")) {
      const expected = requiredPrimitiveParameters(operation.className);
      const actual = new Set((operation.parameters ?? []).map((item) => normalizeParameterName(item.name)));
      const missing = expected.filter((name) => !actual.has(name));
      const lowConfidence = (operation.parameters ?? []).filter((item) => item.confidence < 0.85);
      if ((operation.parameters ?? []).length === 0 || missing.length > 0) {
        throw new Error(
          `${operation.id} 引用了 command_panel_parameters 高清证据，但创建参数未被可靠逐字读取；` +
          `缺少字段=${missing.join(",") || "无"}；低置信字段=${lowConfidence.map((item) => item.name).join(",") || "无"}。` +
          "必须重新查看该紧裁图并抄录实际数字，不能沿用常见默认值，也不能只提高 confidence 而不重新核对数值。"
        );
      }
      if (lowConfidence.length > 0 || operation.confidence < 0.85) {
        throw new Error(
          `${operation.id} 引用了 command_panel_parameters 高清证据，但创建参数未被可靠逐字读取；` +
          `缺少字段=无；低置信字段=${lowConfidence.map((item) => item.name).join(",") || "operation"}。` +
          "必须重新查看放大的最终 Parameters 图并逐字抄录；即使已用完自动修复次数，也禁止保留默认值或近似值生成脚本。"
        );
      }
    }

    const exactCloneDrag = relatedActions.some((action) =>
      action.transformHarness?.interactionState === "viewport_clone_transform_drag" &&
      action.transformHarness?.dragTransaction?.transformTypeInPair);
    if (operation.kind === "clone_objects" && exactCloneDrag && !hasTransformValue(operation.transform)) {
      throw new Error(
        `${operation.id} 来自 SHIFT 视口拖拽且存在成对 Transform Type-In 证据，` +
        "但 clone transform 为空；必须按 Absolute/Offset 状态计算拖拽前后 XYZ。"
      );
    }

    const exactNumericTransform = relatedActions.some((action) =>
      action.transformHarness?.dragTransaction?.transformTypeInPair ||
      action.transformHarness?.interactionState === "coordinate_display_commit_candidate");
    if (hasTransformValue(operation.transform) && exactNumericTransform && operation.confidence < 0.85) {
      throw new Error(
        `${operation.id}（${(operation.sourceEventIds ?? []).join(",")}）使用了成对 Transform Type-In 精确证据，但操作置信度仅为 ${operation.confidence}；` +
        "必须重新读取同一动作的 before/after XYZ、确认 Absolute/Offset 后重新计算，不能输出低置信猜测。"
      );
    }
  }
  annotateReplayAccuracy(analysis.maxProgram);
  return analysis;
}

function assertApproximationImages(operation, actions, imageRoles) {
  const evidence = operation.polyEdit.evidence;
  // Crops alone cannot establish perspective, unchanged scale, or the complete
  // two-stage edit. Require actual uploaded full frames from both ends.
  const before = actions.filter((a) => evidence.selection.includes(a.screenshotBefore) && imageRoles.get(a.screenshotBefore) === "full_frame");
  const after = actions.filter((a) => evidence.completion.includes(a.screenshotAfter) && imageRoles.get(a.screenshotAfter) === "full_frame");
  const pair = before.flatMap((a) => after.map((b) => [a,b])).find(([a,b]) =>
    a.screenshotBefore !== b.screenshotAfter && Number.isFinite(a.startMs) && Number.isFinite(b.endMs) && a.startMs < b.endMs &&
    evidence.parameters.includes(a.screenshotBefore) && evidence.parameters.includes(b.screenshotAfter));
  if (!pair) throw new Error(`${operation.id}: Bevel 视觉估算需要按时间配对的完整选面前图和完成后图，并同时作为比例依据`);
  const [start, end] = pair;
  if (start.window && end.window && ["width", "height", "x", "y", "processId"].some((key) => start.window[key] !== end.window[key]))
    throw new Error(`${operation.id}: Bevel 视觉估算前后窗口或画布尺度发生变化，需要重新建立参照`);
  if (actions.some((a) => a.startMs > start.startMs && a.startMs < end.endMs &&
      (a.action === "scroll" || a.action === "drag" && ["middle", "right"].includes(a.button))))
    throw new Error(`${operation.id}: Bevel 视觉估算前后存在视口导航，不能沿用旧的比例`);
  for (const a of actions.filter((a) => intersects(a.sourceEventIds ?? [], operation.sourceEventIds) && a.interactiveContinuation)) {
    const confirmation = actions.find((b) => intersects(b.sourceEventIds ?? [], a.interactiveContinuation.completionEventIds));
    if (!confirmation || !intersects(confirmation.sourceEventIds ?? [], operation.sourceEventIds) ||
        end.endMs < confirmation.endMs)
      throw new Error(`${operation.id}: Bevel 视觉估算缺少松开后移动及最终确认阶段，不能将第一阶段预览当成完成`);
  }
}

function assertDragInterpretations(analysis, payload) {
  const actions = payload?.actions ?? [];
  const operations = analysis?.maxProgram?.operations ?? [];
  const assessments = analysis.dragAssessments ?? [];
  const currentIds = new Set(actions.flatMap((action) => action.sourceEventIds ?? []));
  const contextIds = new Set((payload?.previousContext?.rawActionTail ?? []).flatMap((action) => action.sourceEventIds ?? []));
  for (const assessment of assessments) {
    if (assessment.sourceEventIds.some((id) => !currentIds.has(id) && !contextIds.has(id)))
      throw new Error(`dragAssessments 引用了未提供的事件：${assessment.sourceEventIds.join(",")}`);
  }
  for (const action of actions) {
    if (action.action !== "drag" || action.button !== "left") continue;
    const sourceIds = action.sourceEventIds ?? [];
    const matches = assessments.filter((item) => intersects(item.sourceEventIds, sourceIds));
    if (matches.length === 0 && payload.evidencePolicyVersion !== 2) continue;
    if (matches.length !== 1) throw new Error(`拖拽 ${sourceIds.join(",")} 必须有且仅有一项 dragAssessments，先判断工具及对象/子对象层级，不得强制猜测变换。`);
    const assessment = matches[0];
    const related = operations.filter((op) => intersects(op.sourceEventIds ?? [], sourceIds));
    const transformOps = related.filter((op) => ["transform", "clone_objects", "set_pivot"].includes(op.kind));
    const bevelOps = related.filter((op) => op.kind === "bevel_faces");
    if (bevelOps.length && (assessment.category !== "subobject_edit" || assessment.selectionLevel !== "subobject" ||
      !/bevel/i.test(assessment.activeTool ?? "") || assessment.persistentChange !== true))
      throw new Error(`拖拽 ${sourceIds.join(",")} 的 Bevel 与工具、子对象层级或完成状态不一致`);
    const uploaded = new Set([
      action.screenshotBefore, action.screenshotAfter, action.screenshotSelection,
      ...(action.transformEvidence ?? []).filter((item) => item.uploadedEvidence).map((item) => item.screenshot)
    ].filter(Boolean));
    if (assessment.evidenceScreenshots.some((name) => !uploaded.has(name)))
      throw new Error(`拖拽 ${sourceIds.join(",")} 引用了不属于本动作或未上传的截图`);
    const isTransform = ["object_transform", "clone_transform"].includes(assessment.category);
    const toolMatches = ({ position: /\bmove\b/i, rotation: /\brotate\b/i, scale: /\bscale\b/i })[assessment.coordinateMeaning]
      ?.test(assessment.activeTool ?? "");
    const supportedTransform = isTransform && assessment.selectionLevel === "object" &&
      ["position", "rotation", "scale"].includes(assessment.coordinateMeaning) &&
      ["absolute", "offset"].includes(assessment.displayMode) &&
      assessment.numericReadability === "readable" && toolMatches &&
      assessment.evidenceScreenshots.length > 0;
    if (transformOps.length > 0 && !supportedTransform)
      throw new Error(`拖拽 ${sourceIds.join(",")} 的工具、选择层级或数值含义不支持整体变换；不得把子对象编辑/游标 XYZ 编译为 transform。`);
    for (const op of transformOps) {
      const expectedField = { position: "position", rotation: "rotationEulerDegrees", scale: "scalePercent" }[assessment.coordinateMeaning];
      if (["position", "rotationEulerDegrees", "scalePercent"].some((field) => field !== expectedField && Array.isArray(op.transform?.[field])))
        throw new Error(`拖拽 ${sourceIds.join(",")} 的 XYZ 数值含义与输出变换字段不一致`);
      if (assessment.category === "clone_transform" && op.kind !== "clone_objects")
        throw new Error(`拖拽 ${sourceIds.join(",")} 是复制，不能只变换原对象`);
    }
    if (supportedTransform && assessment.persistentChange === true &&
      !transformOps.some((op) => hasTransformValue(op.transform)))
      throw new Error(`拖拽 ${sourceIds.join(",")} 已明确识别可读的整体变换，但未生成对应变换。`);
    if (assessment.category === "subobject_edit" && bevelOps.length === 0 || assessment.category === "unresolved" ||
      isTransform && !supportedTransform) {
      analysis.maxProgram.complete = false;
      const warning = `拖拽 ${sourceIds.join(",")}：${assessment.reason}（未恢复的场景变化，非完整回放）`;
      if (!analysis.maxProgram.warnings.includes(warning)) analysis.maxProgram.warnings.push(warning);
    }
    if (["selection", "navigation", "no_change"].includes(assessment.category) && assessment.persistentChange === true)
      throw new Error(`拖拽 ${sourceIds.join(",")} 同时声明无几何贡献和持久场景变化，请复核前后图。`);
  }
}

function assertQuickAlignCoverage(analysis, actions) {
  for (let index = 0; index < actions.length; index += 1) {
    const shortcut = actions[index];
    if (shortcut.transformHarness?.shortcutCommand !== "quick_align") continue;
    const recent = actions.slice(Math.max(0, index - 8), index);
    const pivotContext = recent.some((action) => /Affect Pivot|Center to Object/i.test([
      action.target?.name,
      action.target?.automationId,
      ...(action.target?.ancestors ?? []).flatMap((item) => [item.name, item.automationId])
    ].filter(Boolean).join(" ")));
    if (!pivotContext) continue;

    const sourceIds = new Set(shortcut.sourceEventIds ?? []);
    const operation = (analysis?.maxProgram?.operations ?? []).find((item) =>
      item.kind === "set_pivot" &&
      item.parameters?.some((parameter) => parameter.name === "pivotMode" && parameter.value === "match_object_center") &&
      (item.sourceEventIds ?? []).some((id) => sourceIds.has(id)));
    const referenceObjectId = operation?.parameters?.find((parameter) =>
      parameter.name === "referenceObjectId")?.value;
    if (!operation || typeof referenceObjectId !== "string" || !referenceObjectId) {
      throw new Error(
        `事件 ${(shortcut.sourceEventIds ?? []).join(",") || "未知"} 是 Affect Pivot Only 上下文中的 Shift+A Quick Align，` +
        "必须输出 set_pivot(pivotMode=match_object_center, referenceObjectId=紧接着点击的目标对象)，" +
        "不能只输出两个 center_to_object，也不能把目标点击当普通选择。"
      );
    }
  }
}

function requiredPrimitiveParameters(className) {
  return ({
    cylinder: ["radius", "height", "heightsegs", "capsegs", "sides"],
    sphere: ["radius", "segments"],
    box: ["length", "width", "height", "lengthsegs", "widthsegs", "heightsegs"],
    cone: ["radius1", "radius2", "height", "heightsegs", "capsegs", "sides"],
    tube: ["radius1", "radius2", "height", "heightsegs", "capsegs", "sides"],
    torus: ["radius1", "radius2", "segments", "sides"]
  })[String(className ?? "").toLowerCase()] ?? [];
}

function normalizeParameterName(name) {
  return String(name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")
    .replace(/^heightsegments$/, "heightsegs")
    .replace(/^capsegments$/, "capsegs")
    .replace(/^lengthsegments$/, "lengthsegs")
    .replace(/^widthsegments$/, "widthsegs");
}

function hasTransformValue(transform) {
  return transform?.mode !== "none" && [
    transform?.position,
    transform?.rotationEulerDegrees,
    transform?.scalePercent
  ].some(Array.isArray);
}

function intersects(left, right) {
  const values = new Set(left);
  return right.some((value) => values.has(value));
}
