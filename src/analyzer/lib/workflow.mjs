const ACTIONS = new Set([
  "click", "double_click", "right_click", "middle_click", "drag",
  "scroll", "type_text", "press_key", "wait"
]);

const nullableString = { type: ["string", "null"] };
const stringArray = { type: "array", items: { type: "string" } };
const confidenceSchema = { type: "number", minimum: 0, maximum: 1 };
const nullableNumber = { type: ["number", "null"] };
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
    matchMethod: {
      type: "string",
      enum: ["exact", "closest_candidate", "visual_only", "none"]
    },
    knowledgeReference: nullableString,
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
    "expectedRegion", "matchMethod", "knowledgeReference", "relativePositionFallback"
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

const cadPointSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    x: { type: "number" },
    y: { type: "number" },
    snap: {
      type: "string",
      enum: [
        "none", "endpoint", "center", "intersection", "midpoint", "quadrant",
        "perpendicular", "tangent", "nearest", "unknown"
      ]
    },
    referenceEntityIds: stringArray,
    confidence: confidenceSchema
  },
  required: ["x", "y", "snap", "referenceEntityIds", "confidence"]
};

const nullableCadPointSchema = { anyOf: [cadPointSchema, { type: "null" }] };

const cadSelectionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    mode: { type: "string", enum: ["last", "previous", "window", "crossing", "entities", "all"] },
    entityIds: stringArray,
    firstCorner: nullableCadPointSchema,
    secondCorner: nullableCadPointSchema
  },
  required: ["mode", "entityIds", "firstCorner", "secondCorner"]
};

const cadArgumentSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: {
      type: "string",
      enum: ["point", "number", "integer", "keyword", "text", "enter", "selection"]
    },
    name: { type: "string" },
    point: nullableCadPointSchema,
    number: nullableNumber,
    text: nullableString,
    selection: { anyOf: [cadSelectionSchema, { type: "null" }] }
  },
  required: ["kind", "name", "point", "number", "text", "selection"]
};

const cadVisualInferenceSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    method: { type: "string", enum: ["none", "before_after_diff", "combined"] },
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
    sourceEntityIds: stringArray,
    referenceEntityIds: stringArray,
    side: {
      type: "string",
      enum: ["none", "left", "right", "inside", "outside", "both", "unknown"]
    },
    confidence: confidenceSchema
  },
  required: [
    "method", "beforeScreenshot", "afterScreenshot", "changedRegionRelative",
    "sourceEntityIds", "referenceEntityIds", "side", "confidence"
  ]
};

const cadResultGeometrySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    kind: { type: "string", enum: ["line", "polyline", "circle", "arc_3point", "arc_center"] },
    points: { type: "array", items: cadPointSchema },
    center: nullableCadPointSchema,
    radius: nullableNumber,
    startAngle: nullableNumber,
    endAngle: nullableNumber,
    clockwise: { type: ["boolean", "null"] },
    closed: { type: "boolean" },
    sourceEntityIds: stringArray,
    confidence: confidenceSchema
  },
  required: [
    "id", "kind", "points", "center", "radius", "startAngle", "endAngle", "clockwise",
    "closed", "sourceEntityIds", "confidence"
  ]
};

const cadOperationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    semanticKind: {
      type: "string",
      enum: [
        "command", "circle", "line", "polyline", "arc_3point", "offset", "trim",
        "polar_array", "linear_constraint", "other"
      ]
    },
    command: { type: "string" },
    arguments: { type: "array", items: cadArgumentSchema },
    resultEntityIds: stringArray,
    resultGeometry: { type: "array", items: cadResultGeometrySchema },
    visualInference: cadVisualInferenceSchema,
    sourceEventIds: stringArray,
    sourceScreenshots: stringArray,
    confidence: confidenceSchema
  },
  required: [
    "id", "semanticKind", "command", "arguments", "resultEntityIds", "resultGeometry", "visualInference",
    "sourceEventIds", "sourceScreenshots", "confidence"
  ]
};

const analysisCommandStateSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", enum: ["idle", "active", "deferred", "cancelled", "unknown"] },
    activeCommand: nullableString,
    stage: nullableString,
    pendingParameter: nullableString,
    visiblePrompt: nullableString,
    lastCompletedCommand: nullableString,
    evidenceEventIds: stringArray,
    confidence: confidenceSchema
  },
  required: [
    "status", "activeCommand", "stage", "pendingParameter", "visiblePrompt",
    "lastCompletedCommand", "evidenceEventIds", "confidence"
  ]
};

const cadProgramSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    format: { type: "string", enum: ["autocad_command_ir", "none"] },
    operations: { type: "array", items: cadOperationSchema },
    confidence: confidenceSchema,
    warnings: stringArray,
    complete: { type: "boolean" }
  },
  required: ["format", "operations", "confidence", "warnings", "complete"]
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
    commandState: analysisCommandStateSchema,
    cadProgram: cadProgramSchema,
    warnings: stringArray
  },
  required: ["summary", "steps", "omitted", "commandState", "cadProgram", "warnings"]
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
  // 兼容旧 semantic-trace；新 API 响应必须提供结构化 cadProgram，不再让模型直接写 SCR。
  normalized.cadProgram ??= {
    format: "none",
    operations: [],
    confidence: 0,
    warnings: ["旧版分析结果不含结构化 CAD 操作，请重新生成。"],
    complete: false
  };
  normalized.commandState ??= defaultAnalysisCommandState();
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
  assertAnalysisCommandState(normalized.commandState, "commandState");
  assertCadProgram(normalized.cadProgram, options);
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
    commandState: workflows.at(-1)?.commandState ?? defaultAnalysisCommandState(),
    cadProgram: mergeCadPrograms(workflows.map((workflow) => workflow.cadProgram)),
    warnings: workflows.flatMap((workflow) => workflow.warnings ?? [])
  };
  return validateWorkflow(merged, options);
}

function defaultAnalysisCommandState() {
  return {
    status: "unknown",
    activeCommand: null,
    stage: null,
    pendingParameter: null,
    visiblePrompt: null,
    lastCompletedCommand: null,
    evidenceEventIds: [],
    confidence: 0
  };
}

function assertAnalysisCommandState(state, label) {
  if (!state || typeof state !== "object" || Array.isArray(state))
    throw new Error(`${label} 必须是对象`);
  if (!["idle", "active", "deferred", "cancelled", "unknown"].includes(state.status))
    throw new Error(`${label}.status 无效`);
  for (const property of [
    "activeCommand", "stage", "pendingParameter", "visiblePrompt", "lastCompletedCommand"
  ]) assertNullableString(state[property], `${label}.${property}`);
  assertStringArray(state.evidenceEventIds, `${label}.evidenceEventIds`);
  assertConfidence(state.confidence, `${label}.confidence`);
  if (["active", "deferred"].includes(state.status) && !state.activeCommand)
    throw new Error(`${label} 活跃时缺少 activeCommand`);
  if (!["active", "deferred"].includes(state.status) && state.activeCommand !== null)
    throw new Error(`${label} 非活跃状态的 activeCommand 必须为 null`);
  for (const property of ["activeCommand", "lastCompletedCommand"]) {
    if (state[property] !== null && !/^-?[A-Z][A-Z0-9_+]*$/.test(state[property]))
      throw new Error(`${label}.${property} 必须是英文规范命令名`);
  }
}

function mergeCadPrograms(programs) {
  const usable = programs.filter((program) => program?.format === "autocad_command_ir");
  if (usable.length === 0) {
    return {
      format: "none",
      operations: [],
      confidence: programs.length > 0 ? Math.min(...programs.map((program) => program?.confidence ?? 0)) : 0,
      warnings: programs.flatMap((program) => program?.warnings ?? []),
      complete: false
    };
  }
  return {
    format: "autocad_command_ir",
    operations: usable.flatMap((program) => program.operations ?? []),
    confidence: Math.min(...programs.map((program) => program?.confidence ?? 0)),
    warnings: programs.flatMap((program) => program?.warnings ?? []),
    complete: programs.every((program) =>
      program?.format === "autocad_command_ir" && program?.complete === true)
  };
}

function assertCadProgram(program, options = {}) {
  if (!program || !["autocad_command_ir", "none"].includes(program.format))
    throw new Error("cadProgram.format 无效");
  if (!Array.isArray(program.operations)) throw new Error("cadProgram.operations 必须是数组");
  assertConfidence(program.confidence, "cadProgram.confidence");
  assertStringArray(program.warnings, "cadProgram.warnings");
  if (typeof program.complete !== "boolean")
    throw new Error("cadProgram.complete 必须是布尔值");
  if (program.format === "none" && program.operations.length > 0)
    throw new Error("cadProgram.format 为 none 时 operations 必须为空");
  if (program.complete && program.format !== "autocad_command_ir")
    throw new Error("完整的 cadProgram 必须使用 autocad_command_ir 格式");
  if (program.format === "none" && program.complete)
    throw new Error("不适用的 cadProgram 不能标记为完整");

  const operationIds = new Set();
  const entityIds = new Set();
  const availableEntityIds = new Set(options.knownCadEntityIds ?? []);
  const retiredEntityIds = new Set();
  program.operations.forEach((operation, index) => {
    assertCadOperation(operation, `cadProgram.operations[${index}]`);
    if (operationIds.has(operation.id)) throw new Error(`CAD 操作 ID 重复: ${operation.id}`);
    operationIds.add(operation.id);
    if (options.validateCadReferences === true) {
      for (const referencedId of cadOperationReferenceIds(operation)) {
        if (!availableEntityIds.has(referencedId)) {
          if (retiredEntityIds.has(referencedId)) {
            throw new Error(
              `CAD 操作 ${operation.id} 引用了已经被此前 TRIM 替换的实体 ${referencedId}`
            );
          }
          throw new Error(
            `CAD 操作 ${operation.id} 引用了尚未由此前 operation 生成的实体 ${referencedId}`
          );
        }
      }
    }
    if (operation.semanticKind === "trim") {
      for (const sourceId of operation.visualInference?.sourceEntityIds ?? []) {
        availableEntityIds.delete(sourceId);
        retiredEntityIds.add(sourceId);
      }
    }
    for (const entityId of operation.resultEntityIds) {
      if (entityIds.has(entityId)) throw new Error(`CAD 实体 ID 重复: ${entityId}`);
      if (options.validateCadReferences === true && availableEntityIds.has(entityId))
        throw new Error(`CAD 操作 ${operation.id} 试图重复定义既有实体 ${entityId}`);
      entityIds.add(entityId);
      availableEntityIds.add(entityId);
    }
  });
}

function cadOperationReferenceIds(operation) {
  const references = [];
  for (const argument of operation.arguments ?? []) {
    if (argument.point) references.push(...(argument.point.referenceEntityIds ?? []));
    if (argument.selection) references.push(...(argument.selection.entityIds ?? []));
  }
  references.push(...(operation.visualInference?.sourceEntityIds ?? []));
  references.push(...(operation.visualInference?.referenceEntityIds ?? []));
  for (const geometry of operation.resultGeometry ?? []) {
    references.push(...(geometry.sourceEntityIds ?? []));
    if (geometry.center) references.push(...(geometry.center.referenceEntityIds ?? []));
    for (const point of geometry.points ?? [])
      references.push(...(point.referenceEntityIds ?? []));
  }
  return [...new Set(references.filter(Boolean))];
}

function assertCadOperation(operation, label) {
  const semanticKinds = new Set([
    "command", "circle", "line", "polyline", "arc_3point", "offset", "trim",
    "polar_array", "linear_constraint", "other"
  ]);
  if (!operation || typeof operation !== "object" || Array.isArray(operation))
    throw new Error(`${label} 必须是对象`);
  if (typeof operation.id !== "string" || !operation.id.trim()) throw new Error(`${label}.id 无效`);
  if (!semanticKinds.has(operation.semanticKind)) throw new Error(`${label}.semanticKind 无效`);
  if (typeof operation.command !== "string" || !/^-?[A-Z][A-Z0-9_+]*$/i.test(operation.command))
    throw new Error(`${label}.command 必须是英文完整命令名`);
  if (!Array.isArray(operation.arguments)) throw new Error(`${label}.arguments 必须是数组`);
  assertStringArray(operation.resultEntityIds, `${label}.resultEntityIds`);
  if (!Array.isArray(operation.resultGeometry)) throw new Error(`${label}.resultGeometry 必须是数组`);
  assertCadVisualInference(operation.visualInference, `${label}.visualInference`);
  assertStringArray(operation.sourceEventIds, `${label}.sourceEventIds`);
  assertStringArray(operation.sourceScreenshots, `${label}.sourceScreenshots`);
  assertConfidence(operation.confidence, `${label}.confidence`);
  operation.arguments.forEach((argument, index) => assertCadArgument(argument, `${label}.arguments[${index}]`));
  operation.resultGeometry.forEach((geometry, index) =>
    assertCadResultGeometry(geometry, `${label}.resultGeometry[${index}]`));
  for (const geometry of operation.resultGeometry) {
    if (!operation.resultEntityIds.includes(geometry.id))
      throw new Error(`${label}.resultGeometry 的 ${geometry.id} 未列入 resultEntityIds`);
  }

  if (["offset", "trim"].includes(operation.semanticKind)) {
    const inference = operation.visualInference;
    if (inference.method === "none" || !inference.beforeScreenshot || !inference.afterScreenshot)
      throw new Error(`${label} 的 ${operation.semanticKind.toUpperCase()} 缺少成对的前后截图推断`);
    if (inference.sourceEntityIds.length === 0)
      throw new Error(`${label} 的 ${operation.semanticKind.toUpperCase()} 缺少源实体引用`);
    if (!operation.sourceScreenshots.includes(inference.beforeScreenshot) ||
      !operation.sourceScreenshots.includes(inference.afterScreenshot))
      throw new Error(`${label} 的 sourceScreenshots 未包含视觉推断截图对`);
  }
  if (operation.semanticKind === "offset") {
    const hasDistance = operation.arguments.some((argument) =>
      ["number", "integer"].includes(argument.kind) &&
      ["distance", "offset_distance"].includes(normalizeCadName(argument.name)));
    if (!hasDistance) throw new Error(`${label} 的 OFFSET 缺少明确距离`);
    if (["none", "unknown"].includes(operation.visualInference.side) && operation.resultGeometry.length === 0)
      throw new Error(`${label} 的 OFFSET 既没有可靠方向，也没有最终几何`);
  }
  if (operation.semanticKind === "trim" && operation.resultGeometry.length === 0)
    throw new Error(`${label} 的 TRIM 缺少可验证的最终几何`);
}

function assertCadVisualInference(inference, label) {
  const methods = new Set(["none", "before_after_diff", "combined"]);
  const sides = new Set(["none", "left", "right", "inside", "outside", "both", "unknown"]);
  if (!inference || typeof inference !== "object" || Array.isArray(inference))
    throw new Error(`${label} 必须是对象`);
  if (!methods.has(inference.method)) throw new Error(`${label}.method 无效`);
  assertNullableString(inference.beforeScreenshot, `${label}.beforeScreenshot`);
  assertNullableString(inference.afterScreenshot, `${label}.afterScreenshot`);
  if (inference.changedRegionRelative !== null) {
    if (!Array.isArray(inference.changedRegionRelative) || inference.changedRegionRelative.length !== 4 ||
      inference.changedRegionRelative.some((value) => typeof value !== "number" || value < 0 || value > 1))
      throw new Error(`${label}.changedRegionRelative 无效`);
  }
  assertStringArray(inference.sourceEntityIds, `${label}.sourceEntityIds`);
  assertStringArray(inference.referenceEntityIds, `${label}.referenceEntityIds`);
  if (!sides.has(inference.side)) throw new Error(`${label}.side 无效`);
  assertConfidence(inference.confidence, `${label}.confidence`);
}

function assertCadResultGeometry(geometry, label) {
  if (!geometry || typeof geometry !== "object" || Array.isArray(geometry))
    throw new Error(`${label} 必须是对象`);
  if (typeof geometry.id !== "string" || !geometry.id.trim()) throw new Error(`${label}.id 无效`);
  if (!["line", "polyline", "circle", "arc_3point", "arc_center"].includes(geometry.kind))
    throw new Error(`${label}.kind 无效`);
  if (!Array.isArray(geometry.points)) throw new Error(`${label}.points 必须是数组`);
  geometry.points.forEach((point, index) => assertCadPoint(point, `${label}.points[${index}]`));
  if (geometry.center !== null) assertCadPoint(geometry.center, `${label}.center`);
  if (geometry.radius !== null && (!Number.isFinite(geometry.radius) || geometry.radius <= 0))
    throw new Error(`${label}.radius 无效`);
  if (geometry.startAngle !== undefined && geometry.startAngle !== null && !Number.isFinite(geometry.startAngle))
    throw new Error(`${label}.startAngle 无效`);
  if (geometry.endAngle !== undefined && geometry.endAngle !== null && !Number.isFinite(geometry.endAngle))
    throw new Error(`${label}.endAngle 无效`);
  if (geometry.clockwise !== undefined && geometry.clockwise !== null && typeof geometry.clockwise !== "boolean")
    throw new Error(`${label}.clockwise 无效`);
  if (typeof geometry.closed !== "boolean") throw new Error(`${label}.closed 必须是布尔值`);
  assertStringArray(geometry.sourceEntityIds, `${label}.sourceEntityIds`);
  assertConfidence(geometry.confidence, `${label}.confidence`);

  if (geometry.kind === "line" && geometry.points.length !== 2)
    throw new Error(`${label} 的 line 必须恰好有两个点`);
  if (geometry.kind === "polyline" && geometry.points.length < 2)
    throw new Error(`${label} 的 polyline 至少需要两个点`);
  if (geometry.kind === "arc_3point" && geometry.points.length !== 3)
    throw new Error(`${label} 的 arc_3point 必须恰好有三个点`);
  if (geometry.kind === "circle" && (!geometry.center || !Number.isFinite(geometry.radius)))
    throw new Error(`${label} 的 circle 缺少圆心或半径`);
  if (geometry.kind === "arc_center" && (
    !geometry.center || !Number.isFinite(geometry.radius) ||
    !Number.isFinite(geometry.startAngle) || !Number.isFinite(geometry.endAngle) ||
    typeof geometry.clockwise !== "boolean"))
    throw new Error(`${label} 的 arc_center 缺少圆心、半径、起止角或方向`);
}

function normalizeCadName(value) {
  return String(value).trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function assertCadArgument(argument, label) {
  const kinds = new Set(["point", "number", "integer", "keyword", "text", "enter", "selection"]);
  if (!argument || typeof argument !== "object" || Array.isArray(argument) || !kinds.has(argument.kind))
    throw new Error(`${label}.kind 无效`);
  if (typeof argument.name !== "string" || !argument.name.trim()) throw new Error(`${label}.name 无效`);
  if (argument.point !== null) assertCadPoint(argument.point, `${label}.point`);
  if (argument.number !== null && (typeof argument.number !== "number" || !Number.isFinite(argument.number)))
    throw new Error(`${label}.number 无效`);
  assertNullableString(argument.text, `${label}.text`);
  if (argument.selection !== null) assertCadSelection(argument.selection, `${label}.selection`);

  if (argument.kind === "point" && argument.point === null) throw new Error(`${label} 缺少 point`);
  if (["number", "integer"].includes(argument.kind) && argument.number === null)
    throw new Error(`${label} 缺少 number`);
  if (argument.kind === "integer" && !Number.isInteger(argument.number)) throw new Error(`${label}.number 必须是整数`);
  if (["keyword", "text"].includes(argument.kind) && argument.text === null)
    throw new Error(`${label} 缺少 text`);
  if (argument.kind === "selection" && argument.selection === null) throw new Error(`${label} 缺少 selection`);
}

function assertCadPoint(point, label) {
  const snapTypes = new Set([
    "none", "endpoint", "center", "intersection", "midpoint", "quadrant",
    "perpendicular", "tangent", "nearest", "unknown"
  ]);
  if (!point || typeof point !== "object" || !Number.isFinite(point.x) || !Number.isFinite(point.y))
    throw new Error(`${label} 无效`);
  if (!snapTypes.has(point.snap)) throw new Error(`${label}.snap 无效`);
  assertStringArray(point.referenceEntityIds, `${label}.referenceEntityIds`);
  assertConfidence(point.confidence, `${label}.confidence`);
}

function assertCadSelection(selection, label) {
  if (!selection || typeof selection !== "object" ||
    !["last", "previous", "window", "crossing", "entities", "all"].includes(selection.mode))
    throw new Error(`${label}.mode 无效`);
  assertStringArray(selection.entityIds, `${label}.entityIds`);
  if (selection.firstCorner !== null) assertCadPoint(selection.firstCorner, `${label}.firstCorner`);
  if (selection.secondCorner !== null) assertCadPoint(selection.secondCorner, `${label}.secondCorner`);
  if (["window", "crossing"].includes(selection.mode) &&
    (!selection.firstCorner || !selection.secondCorner))
    throw new Error(`${label} 的窗口选择缺少两个角点`);
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
  if (target.matchMethod !== undefined &&
    !["exact", "closest_candidate", "visual_only", "none"].includes(target.matchMethod))
    throw new Error(`${label}.matchMethod 无效`);
  if (target.knowledgeReference !== undefined)
    assertNullableString(target.knowledgeReference, `${label}.knowledgeReference`);
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
