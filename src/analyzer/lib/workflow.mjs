const ACTIONS = new Set([
  "click", "double_click", "right_click", "middle_click", "drag",
  "scroll", "type_text", "press_key", "wait"
]);

const nullableString = { type: ["string", "null"] };
const stringArray = { type: "array", items: { type: "string" } };
const confidenceSchema = { type: "number", minimum: 0, maximum: 1 };
const relativePointSchema = {
  type: "array",
  items: { type: "number", minimum: 0, maximum: 1 },
  minItems: 2,
  maxItems: 2
};

const targetSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    semanticFunction: nullableString,
    role: { type: "string", enum: ["button", "menu_item", "input", "canvas_position", "other"] },
    textCandidates: stringArray,
    visualDescription: nullableString,
    expectedRegion: nullableString,
    relativePositionFallback: {
      anyOf: [
        {
          type: "array",
          items: { type: "number", minimum: 0, maximum: 1 },
          minItems: 2,
          maxItems: 2
        },
        { type: "null" }
      ]
    }
  },
  required: [
    "semanticFunction", "role", "textCandidates", "visualDescription",
    "expectedRegion", "relativePositionFallback"
  ]
};

const expectedStateSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    visibleTextCandidates: stringArray,
    visualDescription: nullableString,
    stateChange: nullableString
  },
  required: ["visibleTextCandidates", "visualDescription", "stateChange"]
};

const gestureSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    fromRelative: { anyOf: [relativePointSchema, { type: "null" }] },
    toRelative: { anyOf: [relativePointSchema, { type: "null" }] },
    pathRelative: { type: "array", items: relativePointSchema }
  },
  required: ["fromRelative", "toRelative", "pathRelative"]
};

const canvasChangeSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    detected: { type: "boolean" },
    changeType: {
      type: "string",
      enum: ["create", "delete", "move", "resize", "rotate", "modify", "selection", "view", "none", "unknown"]
    },
    objectDescription: nullableString,
    beforeScreenshot: nullableString,
    afterScreenshot: nullableString,
    changedRegionRelative: {
      anyOf: [
        {
          type: "array",
          items: { type: "number", minimum: 0, maximum: 1 },
          minItems: 4,
          maxItems: 4
        },
        { type: "null" }
      ]
    },
    measurements: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          value: { type: "number" },
          unit: { type: "string" },
          confidence: confidenceSchema
        },
        required: ["name", "value", "unit", "confidence"]
      }
    }
  },
  required: [
    "detected", "changeType", "objectDescription", "beforeScreenshot",
    "afterScreenshot", "changedRegionRelative", "measurements"
  ]
};

export const MOCK_WORKFLOW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    steps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          goal: { type: "string" },
          action: { type: "string", enum: [...ACTIONS] },
          target: { anyOf: [targetSchema, { type: "null" }] },
          gesture: { anyOf: [gestureSchema, { type: "null" }] },
          value: {
            anyOf: [
              { type: "string" }, { type: "number" },
              { type: "boolean" }, { type: "null" }
            ]
          },
          expectedState: expectedStateSchema,
          canvasChange: canvasChangeSchema,
          sourceEventIds: stringArray,
          confidence: confidenceSchema
        },
        required: [
          "id", "goal", "action", "target", "gesture", "value", "expectedState", "canvasChange",
          "sourceEventIds", "confidence"
        ]
      }
    },
    omitted: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          sourceEventIds: stringArray,
          reason: { type: "string" },
          confidence: confidenceSchema
        },
        required: ["sourceEventIds", "reason", "confidence"]
      }
    },
    nativeScript: {
      type: "object",
      additionalProperties: false,
      properties: {
        format: { type: "string", enum: ["autocad_scr", "none"] },
        lines: stringArray,
        confidence: confidenceSchema,
        warnings: stringArray,
        complete: { type: "boolean" }
      },
      required: ["format", "lines", "confidence", "warnings", "complete"]
    },
    warnings: stringArray
  },
  required: ["summary", "steps", "omitted", "nativeScript", "warnings"]
};

export function validateWorkflow(workflow, options = {}) {
  const minimumConfidence = options.minimumConfidence ?? 0;
  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow))
    throw new Error("工作流必须是 JSON 对象");
  if (typeof workflow.summary !== "string") throw new Error("工作流缺少 summary");
  if (!Array.isArray(workflow.steps)) throw new Error("工作流缺少 steps 数组");
  if (!Array.isArray(workflow.omitted)) throw new Error("工作流缺少 omitted 数组");
  if (!Array.isArray(workflow.warnings)) throw new Error("工作流缺少 warnings 数组");

  const normalized = JSON.parse(JSON.stringify(workflow));
  // 兼容升级前保存的 semantic-trace；新的 API 响应仍由严格 JSON Schema 强制提供此字段。
  normalized.nativeScript ??= {
    format: "none",
    lines: [],
    confidence: 0,
    warnings: ["旧版分析结果不含原生 SCR 数据，请重新生成。"],
    complete: false
  };
  // 兼容升级前已经保存的分析结果。新响应必须由严格 Schema 明确给出 complete。
  // 旧版 autocad_scr 代表已生成可用脚本；旧版 none 无法区分“无新增命令”和
  // “缺少关键参数”，因此保守地视为不完整。
  normalized.nativeScript.complete ??= normalized.nativeScript.format === "autocad_scr";
  const lowConfidenceIds = [];
  normalized.steps.forEach((step, index) => {
    const label = `steps[${index}]`;
    if (!step || typeof step !== "object") throw new Error(`${label} 不是对象`);
    if (!ACTIONS.has(step.action)) throw new Error(`${label}.action 不受支持: ${step.action}`);
    if (typeof step.goal !== "string" || step.goal.length === 0) throw new Error(`${label}.goal 无效`);
    if (!Array.isArray(step.sourceEventIds)) throw new Error(`${label}.sourceEventIds 无效`);
    if (!step.expectedState || typeof step.expectedState !== "object")
      throw new Error(`${label}.expectedState 无效`);
    assertStringArray(step.sourceEventIds, `${label}.sourceEventIds`);
    assertTarget(step.target, `${label}.target`);
    assertGesture(step.gesture, `${label}.gesture`);
    assertExpectedState(step.expectedState, `${label}.expectedState`);
    assertCanvasChange(step.canvasChange, `${label}.canvasChange`);
    if (!["string", "number", "boolean"].includes(typeof step.value) && step.value !== null)
      throw new Error(`${label}.value 必须是字符串、数字、布尔值或 null`);
    assertConfidence(step.confidence, `${label}.confidence`);
    step.id = `step-${String(index + 1).padStart(3, "0")}`;
    if (step.confidence < minimumConfidence) lowConfidenceIds.push(step.id);
  });

  normalized.omitted.forEach((item, index) => {
    if (!item || typeof item.reason !== "string" || !Array.isArray(item.sourceEventIds))
      throw new Error(`omitted[${index}] 无效`);
    assertConfidence(item.confidence, `omitted[${index}].confidence`);
    assertStringArray(item.sourceEventIds, `omitted[${index}].sourceEventIds`);
  });
  assertNativeScript(normalized.nativeScript);
  if (!normalized.warnings.every((item) => typeof item === "string"))
    throw new Error("warnings 必须全部是字符串");

  if (lowConfidenceIds.length > 0) {
    normalized.warnings.push(
      `以下步骤低于最低置信度 ${minimumConfidence}: ${lowConfidenceIds.join(", ")}`
    );
  }
  return normalized;
}

export function mergeWorkflows(workflows, options = {}) {
  if (!Array.isArray(workflows) || workflows.length === 0)
    throw new Error("没有可合并的工作流");
  const merged = {
    summary: workflows.map((workflow) => workflow.summary).filter(Boolean).join(" → "),
    steps: workflows.flatMap((workflow) => workflow.steps ?? []),
    omitted: workflows.flatMap((workflow) => workflow.omitted ?? []),
    nativeScript: mergeNativeScripts(workflows.map((workflow) => workflow.nativeScript)),
    warnings: workflows.flatMap((workflow) => workflow.warnings ?? [])
  };
  return validateWorkflow(merged, options);
}

function mergeNativeScripts(scripts) {
  if (scripts.some((script) => script?.complete !== true)) {
    return {
      format: "none",
      lines: [],
      confidence: Math.min(...scripts.map((script) => script?.confidence ?? 0)),
      warnings: scripts.flatMap((script) => script?.warnings ?? []),
      complete: false
    };
  }
  const usable = scripts.filter((script) => script?.format === "autocad_scr");
  if (usable.length === 0) {
    return {
      format: "none",
      lines: [],
      confidence: scripts.length > 0 ? Math.min(...scripts.map((script) => script?.confidence ?? 0)) : 0,
      warnings: scripts.flatMap((script) => script?.warnings ?? []),
      complete: false
    };
  }
  return {
    format: "autocad_scr",
    lines: usable.flatMap((script) => script.lines ?? []),
    confidence: Math.min(...usable.map((script) => script.confidence)),
    warnings: scripts.flatMap((script) => script?.warnings ?? []),
    complete: true
  };
}

function assertNativeScript(script) {
  if (!script || !["autocad_scr", "none"].includes(script.format))
    throw new Error("nativeScript.format 无效");
  assertStringArray(script.lines, "nativeScript.lines");
  assertConfidence(script.confidence, "nativeScript.confidence");
  assertStringArray(script.warnings, "nativeScript.warnings");
  if (typeof script.complete !== "boolean")
    throw new Error("nativeScript.complete 必须是布尔值");
  if (script.format === "none" && script.lines.length > 0)
    throw new Error("nativeScript.format 为 none 时 lines 必须为空");
  if (script.complete && script.format !== "autocad_scr")
    throw new Error("完整的 nativeScript 必须使用 autocad_scr 格式");
  if (!script.complete && script.format !== "none")
    throw new Error("不完整的 nativeScript 必须使用 none 格式");
}

function assertConfidence(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1)
    throw new Error(`${label} 必须是 0 到 1 之间的数字`);
}

function assertTarget(target, label) {
  if (target === null) return;
  if (!target || typeof target !== "object" || Array.isArray(target))
    throw new Error(`${label} 必须是对象或 null`);
  if (!["button", "menu_item", "input", "canvas_position", "other"].includes(target.role))
    throw new Error(`${label}.role 无效`);
  assertNullableString(target.semanticFunction, `${label}.semanticFunction`);
  assertStringArray(target.textCandidates, `${label}.textCandidates`);
  assertNullableString(target.visualDescription, `${label}.visualDescription`);
  assertNullableString(target.expectedRegion, `${label}.expectedRegion`);
  const position = target.relativePositionFallback;
  if (position !== null && (
    !Array.isArray(position) || position.length !== 2 ||
    position.some((value) => typeof value !== "number" || value < 0 || value > 1)
  )) throw new Error(`${label}.relativePositionFallback 无效`);
}

function assertExpectedState(state, label) {
  assertStringArray(state.visibleTextCandidates, `${label}.visibleTextCandidates`);
  assertNullableString(state.visualDescription, `${label}.visualDescription`);
  assertNullableString(state.stateChange, `${label}.stateChange`);
}

function assertGesture(gesture, label) {
  if (gesture === null) return;
  if (!gesture || typeof gesture !== "object" || Array.isArray(gesture))
    throw new Error(`${label} 必须是对象或 null`);
  assertNullablePoint(gesture.fromRelative, `${label}.fromRelative`);
  assertNullablePoint(gesture.toRelative, `${label}.toRelative`);
  if (!Array.isArray(gesture.pathRelative)) throw new Error(`${label}.pathRelative 必须是数组`);
  gesture.pathRelative.forEach((point, index) => assertPoint(point, `${label}.pathRelative[${index}]`));
}

function assertCanvasChange(change, label) {
  if (!change || typeof change !== "object" || Array.isArray(change))
    throw new Error(`${label} 必须是对象`);
  if (typeof change.detected !== "boolean") throw new Error(`${label}.detected 必须是布尔值`);
  if (!["create", "delete", "move", "resize", "rotate", "modify", "selection", "view", "none", "unknown"].includes(change.changeType))
    throw new Error(`${label}.changeType 无效`);
  assertNullableString(change.objectDescription, `${label}.objectDescription`);
  assertNullableString(change.beforeScreenshot, `${label}.beforeScreenshot`);
  assertNullableString(change.afterScreenshot, `${label}.afterScreenshot`);
  if (change.changedRegionRelative !== null) {
    if (!Array.isArray(change.changedRegionRelative) || change.changedRegionRelative.length !== 4 ||
      change.changedRegionRelative.some((value) => typeof value !== "number" || value < 0 || value > 1))
      throw new Error(`${label}.changedRegionRelative 无效`);
  }
  if (!Array.isArray(change.measurements)) throw new Error(`${label}.measurements 必须是数组`);
  change.measurements.forEach((measurement, index) => {
    const itemLabel = `${label}.measurements[${index}]`;
    if (!measurement || typeof measurement.name !== "string" || typeof measurement.unit !== "string" ||
      typeof measurement.value !== "number" || !Number.isFinite(measurement.value))
      throw new Error(`${itemLabel} 无效`);
    assertConfidence(measurement.confidence, `${itemLabel}.confidence`);
  });
}

function assertNullablePoint(value, label) {
  if (value !== null) assertPoint(value, label);
}

function assertPoint(value, label) {
  if (!Array.isArray(value) || value.length !== 2 ||
    value.some((item) => typeof item !== "number" || item < 0 || item > 1))
    throw new Error(`${label} 无效`);
}

function assertStringArray(value, label) {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string"))
    throw new Error(`${label} 必须是字符串数组`);
}

function assertNullableString(value, label) {
  if (value !== null && typeof value !== "string")
    throw new Error(`${label} 必须是字符串或 null`);
}
