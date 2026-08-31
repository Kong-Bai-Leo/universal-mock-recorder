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
  return analysis;
}

export function assertThreeDsMaxEvidenceCoverage(analysis, payload) {
  const actions = payload?.actions ?? [];
  assertQuickAlignCoverage(analysis, actions);
  assertUploadedNumericDragCoverage(analysis, actions);
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
  return analysis;
}

function assertUploadedNumericDragCoverage(analysis, actions) {
  const operations = analysis?.maxProgram?.operations ?? [];
  const omitted = analysis?.omitted ?? [];
  const failures = [];
  for (const action of actions) {
    const state = action.transformHarness?.interactionState;
    const pair = action.transformHarness?.dragTransaction?.transformTypeInPair;
    if (!pair?.uploadedEvidence || ![
      "viewport_transform_drag",
      "viewport_clone_transform_drag"
    ].includes(state) || action.visualChange?.changed !== true) continue;

    const sourceIds = action.sourceEventIds ?? [];
    if (operations.some((operation) => intersects(operation.sourceEventIds ?? [], sourceIds))) continue;
    const omission = omitted.find((item) => intersects(item.sourceEventIds ?? [], sourceIds));
    const reason = String(omission?.reason ?? "");
    if (/\bblank\b|\bmultiple\b|\bselection\b|\bunchanged\b|空字段|多选|框选|选择框|未发生|未改变|数值相同/i.test(reason)) continue;

    failures.push(sourceIds.join(",") || "未知");
  }
  if (failures.length > 0) throw new Error(
    `以下拖拽事务已上传各自的 Transform Type-In before/after 数值对且画面发生持久变化，但未生成对应变换：${failures.join(" ；")}。` +
    "必须在同一轮修复中逐项按当前工具读取每对图的 XYZ，不得以目标或数值无法确定为由省略；" +
    "只有图中明确为空字段、多选/框选或数值未变时，才可在 omitted.reason 中具体说明后省略。"
  );
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
