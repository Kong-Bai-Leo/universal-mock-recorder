const nullableString = { type: ["string", "null"] };
const nullableNumber = { type: ["number", "null"] };
const confidence = { type: "number", minimum: 0, maximum: 1 };
const stringArray = { type: "array", items: { type: "string" } };
const nullableVector3 = {
  anyOf: [
    { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
    { type: "null" }
  ]
};

const sceneObjectSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    name: nullableString,
    className: nullableString,
    confidence
  },
  required: ["id", "name", "className", "confidence"]
};

const parameterSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string" },
    value: {
      anyOf: [
        { type: "string" },
        { type: "number" },
        { type: "boolean" },
        { type: "null" }
      ]
    },
    unit: nullableString,
    confidence
  },
  required: ["name", "value", "unit", "confidence"]
};

const transformSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    mode: { type: "string", enum: ["none", "absolute", "relative"] },
    position: nullableVector3,
    rotationEulerDegrees: nullableVector3,
    scalePercent: nullableVector3,
    coordinateSystem: { type: "string", enum: ["world", "local", "view", "parent", "unknown"] }
  },
  required: ["mode", "position", "rotationEulerDegrees", "scalePercent", "coordinateSystem"]
};

const operationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    kind: {
      type: "string",
      enum: [
        "create_primitive", "select_objects", "transform", "add_modifier",
        "set_parameters", "set_pivot", "clone_objects", "delete_objects", "convert_to_poly", "other"
      ]
    },
    targetObjectIds: stringArray,
    resultObjectIds: stringArray,
    className: nullableString,
    objectName: nullableString,
    parameters: { type: "array", items: parameterSchema },
    propertyTarget: { type: "string", enum: ["object", "latest_modifier", "none"] },
    transform: transformSchema,
    selectionMode: { type: "string", enum: ["replace", "add", "remove", "clear", "none"] },
    sourceEventIds: stringArray,
    sourceScreenshots: stringArray,
    confidence
  },
  required: [
    "id", "kind", "targetObjectIds", "resultObjectIds", "className", "objectName",
    "parameters", "propertyTarget", "transform", "selectionMode", "sourceEventIds",
    "sourceScreenshots", "confidence"
  ]
};

const maxProgramSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    format: { type: "string", enum: ["3dsmax_scene_ir", "none"] },
    initialObjects: { type: "array", items: sceneObjectSchema },
    operations: { type: "array", items: operationSchema },
    confidence,
    warnings: stringArray,
    complete: { type: "boolean" }
  },
  required: ["format", "initialObjects", "operations", "confidence", "warnings", "complete"]
};

export const THREE_DSMAX_ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    maxProgram: maxProgramSchema,
    omitted: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          sourceEventIds: stringArray,
          reason: { type: "string" },
          confidence
        },
        required: ["sourceEventIds", "reason", "confidence"]
      }
    },
    warnings: stringArray
  },
  required: ["summary", "maxProgram", "omitted", "warnings"]
};

export function validateThreeDsMaxAnalysis(result, options = {}) {
  if (!result || typeof result !== "object" || Array.isArray(result))
    throw new Error("3ds Max 分析结果必须是 JSON 对象");
  if (typeof result.summary !== "string") throw new Error("3ds Max 分析结果缺少 summary");
  if (!Array.isArray(result.omitted)) throw new Error("3ds Max 分析结果缺少 omitted");
  if (!Array.isArray(result.warnings)) throw new Error("3ds Max 分析结果缺少 warnings");
  assertStringArray(result.warnings, "warnings");

  const normalized = JSON.parse(JSON.stringify(result));
  assertMaxProgram(normalized.maxProgram, options);
  normalized.omitted.forEach((item, index) => {
    const label = `omitted[${index}]`;
    if (!item || typeof item.reason !== "string") throw new Error(`${label} 无效`);
    assertStringArray(item.sourceEventIds, `${label}.sourceEventIds`);
    assertConfidence(item.confidence, `${label}.confidence`);
  });
  return normalized;
}

export function mergeThreeDsMaxAnalyses(parts, options = {}) {
  if (!Array.isArray(parts) || parts.length === 0) {
    return validateThreeDsMaxAnalysis(emptyThreeDsMaxAnalysis(), options);
  }
  const validated = parts.map((part) => validateThreeDsMaxAnalysis(part, {
    ...options,
    validateReferences: false
  }));
  const operations = validated.flatMap((part) => part.maxProgram.operations);
  const generatedObjectIds = new Set(
    operations.flatMap((operation) => operation.resultObjectIds)
  );
  const initialById = new Map();
  const removedContextObjectIds = new Set();
  for (const part of validated) {
    for (const object of part.maxProgram.initialObjects) {
      // A later chunk may echo an object from previousContext as an initial object.
      // If that ID is produced by an operation in the recording, the operation is
      // authoritative and the echoed entry is only cross-chunk context.
      if (generatedObjectIds.has(object.id)) {
        removedContextObjectIds.add(object.id);
        continue;
      }
      if (!initialById.has(object.id)) initialById.set(object.id, object);
    }
  }
  const mergeWarnings = removedContextObjectIds.size > 0
    ? [`分段合并时已将前序创建对象从 initialObjects 移除：${[...removedContextObjectIds].join(", ")}`]
    : [];
  const merged = {
    summary: validated.map((part) => part.summary).filter(Boolean).join(" → ") || "未检测到场景修改",
    maxProgram: {
      format: validated.some((part) => part.maxProgram.format === "3dsmax_scene_ir")
        ? "3dsmax_scene_ir"
        : "none",
      initialObjects: [...initialById.values()],
      operations,
      confidence: Math.min(...validated.map((part) => part.maxProgram.confidence)),
      warnings: [...validated.flatMap((part) => part.maxProgram.warnings), ...mergeWarnings],
      complete: validated.every((part) => part.maxProgram.complete)
    },
    omitted: validated.flatMap((part) => part.omitted),
    warnings: validated.flatMap((part) => part.warnings)
  };
  return validateThreeDsMaxAnalysis(merged, { ...options, validateReferences: true });
}

export function emptyThreeDsMaxAnalysis() {
  return {
    summary: "未检测到可复现的 3ds Max 场景操作",
    maxProgram: {
      format: "none",
      initialObjects: [],
      operations: [],
      confidence: 1,
      warnings: [],
      complete: true
    },
    omitted: [],
    warnings: []
  };
}

function assertMaxProgram(program, options) {
  if (!program || !["3dsmax_scene_ir", "none"].includes(program.format))
    throw new Error("maxProgram.format 无效");
  if (!Array.isArray(program.initialObjects)) throw new Error("maxProgram.initialObjects 必须是数组");
  if (!Array.isArray(program.operations)) throw new Error("maxProgram.operations 必须是数组");
  assertConfidence(program.confidence, "maxProgram.confidence");
  assertStringArray(program.warnings, "maxProgram.warnings");
  if (typeof program.complete !== "boolean") throw new Error("maxProgram.complete 必须是布尔值");
  if (program.format === "none" && program.operations.length > 0)
    throw new Error("maxProgram.format 为 none 时 operations 必须为空");

  const known = new Set(options.knownObjectIds ?? []);
  for (const [index, object] of program.initialObjects.entries()) {
    assertSceneObject(object, `maxProgram.initialObjects[${index}]`);
    if (known.has(object.id)) continue;
    known.add(object.id);
  }
  const operationIds = new Set();
  for (const [index, operation] of program.operations.entries()) {
    const label = `maxProgram.operations[${index}]`;
    assertOperation(operation, label);
    if (operationIds.has(operation.id)) throw new Error(`3ds Max 操作 ID 重复: ${operation.id}`);
    operationIds.add(operation.id);
    if (options.validateReferences !== false) {
      for (const objectId of operation.targetObjectIds) {
        if (!known.has(objectId))
          throw new Error(`3ds Max 操作 ${operation.id} 引用了尚未定义的对象 ${objectId}`);
      }
      if (operation.kind === "set_pivot" && pivotModeOf(operation) === "match_object_center") {
        const referenceObjectId = parameterValue(operation, "referenceObjectId");
        if (!known.has(referenceObjectId))
          throw new Error(`3ds Max 操作 ${operation.id} 的枢轴对齐目标尚未定义：${referenceObjectId}`);
      }
    }
    for (const objectId of operation.resultObjectIds) {
      if (known.has(objectId)) throw new Error(`3ds Max 对象 ID 重复: ${objectId}`);
      known.add(objectId);
    }
  }
}

function assertSceneObject(object, label) {
  if (!object || typeof object.id !== "string" || !object.id.trim()) throw new Error(`${label}.id 无效`);
  assertNullableString(object.name, `${label}.name`);
  assertNullableString(object.className, `${label}.className`);
  assertConfidence(object.confidence, `${label}.confidence`);
}

function assertOperation(operation, label) {
  const kinds = new Set([
    "create_primitive", "select_objects", "transform", "add_modifier",
    "set_parameters", "set_pivot", "clone_objects", "delete_objects", "convert_to_poly", "other"
  ]);
  if (!operation || typeof operation.id !== "string" || !operation.id.trim())
    throw new Error(`${label}.id 无效`);
  if (!kinds.has(operation.kind)) throw new Error(`${label}.kind 无效`);
  assertStringArray(operation.targetObjectIds, `${label}.targetObjectIds`);
  assertStringArray(operation.resultObjectIds, `${label}.resultObjectIds`);
  assertNullableString(operation.className, `${label}.className`);
  assertNullableString(operation.objectName, `${label}.objectName`);
  if (!Array.isArray(operation.parameters)) throw new Error(`${label}.parameters 必须是数组`);
  operation.parameters.forEach((parameter, index) => assertParameter(parameter, `${label}.parameters[${index}]`));
  if (!["object", "latest_modifier", "none"].includes(operation.propertyTarget))
    throw new Error(`${label}.propertyTarget 无效`);
  assertTransform(operation.transform, `${label}.transform`);
  if (!["replace", "add", "remove", "clear", "none"].includes(operation.selectionMode))
    throw new Error(`${label}.selectionMode 无效`);
  assertStringArray(operation.sourceEventIds, `${label}.sourceEventIds`);
  assertStringArray(operation.sourceScreenshots, `${label}.sourceScreenshots`);
  assertConfidence(operation.confidence, `${label}.confidence`);

  if (operation.kind === "create_primitive" &&
    (!operation.className || operation.targetObjectIds.length !== 0 || operation.resultObjectIds.length !== 1))
    throw new Error(`${label} 的 create_primitive 必须提供类名和一个新对象 ID`);
  if (["transform", "add_modifier", "set_parameters", "set_pivot", "delete_objects", "convert_to_poly"].includes(operation.kind) &&
    operation.targetObjectIds.length === 0)
    throw new Error(`${label} 缺少目标对象`);
  if (operation.kind === "add_modifier" && !operation.className)
    throw new Error(`${label} 的 add_modifier 缺少修改器类名`);
  if (operation.kind === "clone_objects" && (
    operation.targetObjectIds.length === 0 || operation.targetObjectIds.length !== operation.resultObjectIds.length))
    throw new Error(`${label} 的 clone_objects 源对象和结果对象数量必须一致`);
  if (operation.kind === "transform" && operation.transform.mode === "none")
    throw new Error(`${label} 的 transform 缺少变换数据`);
  if (operation.kind === "set_pivot" && operation.transform.position === null) {
    const pivotMode = pivotModeOf(operation);
    if (pivotMode === "center_to_object") return;
    if (pivotMode === "match_object_center" && typeof parameterValue(operation, "referenceObjectId") === "string") return;
    throw new Error(`${label} 的 set_pivot 缺少精确位置、center_to_object 或 match_object_center 模式`);
  }
}

function pivotModeOf(operation) {
  return parameterValue(operation, "pivotMode");
}

function parameterValue(operation, name) {
  return operation.parameters.find((parameter) => parameter.name === name)?.value ?? null;
}

function assertParameter(parameter, label) {
  if (!parameter || typeof parameter.name !== "string" || !parameter.name.trim())
    throw new Error(`${label}.name 无效`);
  if (!["string", "number", "boolean"].includes(typeof parameter.value) && parameter.value !== null)
    throw new Error(`${label}.value 无效`);
  assertNullableString(parameter.unit, `${label}.unit`);
  assertConfidence(parameter.confidence, `${label}.confidence`);
}

function assertTransform(transform, label) {
  if (!transform || !["none", "absolute", "relative"].includes(transform.mode))
    throw new Error(`${label}.mode 无效`);
  assertNullableVector3(transform.position, `${label}.position`);
  assertNullableVector3(transform.rotationEulerDegrees, `${label}.rotationEulerDegrees`);
  assertNullableVector3(transform.scalePercent, `${label}.scalePercent`);
  if (!["world", "local", "view", "parent", "unknown"].includes(transform.coordinateSystem))
    throw new Error(`${label}.coordinateSystem 无效`);
}

function assertNullableVector3(value, label) {
  if (value === null) return;
  if (!Array.isArray(value) || value.length !== 3 || value.some((item) => !Number.isFinite(item)))
    throw new Error(`${label} 必须是三个有限数字或 null`);
}

function assertStringArray(value, label) {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.length > 0))
    throw new Error(`${label} 必须是非空字符串数组`);
}

function assertNullableString(value, label) {
  if (value !== null && typeof value !== "string") throw new Error(`${label} 必须是字符串或 null`);
}

function assertConfidence(value, label) {
  if (!Number.isFinite(value) || value < 0 || value > 1)
    throw new Error(`${label} 必须是 0 到 1 之间的数字`);
}
