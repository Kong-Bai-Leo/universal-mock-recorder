export function renderAutoCadScr(plan, options = {}) {
  const program = plan?.cadProgram;
  if (!program || program.format !== "autocad_command_ir" || !Array.isArray(program.operations) ||
    program.operations.length === 0) {
    const details = program?.warnings?.join("；") || "录制中缺少可编译的结构化 CAD 操作";
    throw new Error(`无法生成可运行的 AutoCAD SCR：${details}`);
  }

  const lines = compileCadOperations(program.operations, options);
  if (lines.some((line) => typeof line !== "string" || /[\r\n]/.test(line)))
    throw new Error("CAD 编译器的每个输出元素只能表示一行 SCR 输入");
  return lines.join("\r\n") + "\r\n";
}

function compileCadOperations(operations, options) {
  const exactFinalState = compileExactFinalState(operations);
  if (exactFinalState) return exactFinalState;

  const lines = [];
  const entities = new Map();
  for (const operation of operations) {
    if (operation.semanticKind === "offset") {
      if (!Array.isArray(operation.resultGeometry) || operation.resultGeometry.length === 0) {
        throw new Error(
          `SCR 后端无法在没有精确 resultGeometry 时编译 OFFSET ${operation.id}；结构化方向证据已保留`
        );
      }
      const produced = operation.resultGeometry.map(resultGeometryToEntity);
      produced.forEach((entity) => appendEntity(lines, entity));
      registerResultGeometry(operation.resultGeometry, produced, entities);
      continue;
    }
    if (operation.semanticKind === "trim") {
      throw new Error(
        `SCR 后端不会用窗口选择猜测 TRIM ${operation.id} 的实体；请由 Mock Runtime 使用 resultGeometry 精确执行`
      );
    }
    if (operation.semanticKind === "polar_array") {
      if (!compileDeterministicPolarArray(lines, operation, entities)) {
        throw new Error(
          `SCR 后端暂时无法编译极轴阵列 ${operation.id}；结构化 CAD 操作已保留，不应改写识别结果`
        );
      }
      continue;
    }

    lines.push(resolveScriptCommand(operation.command, options.knowledge));
    for (const argument of operation.arguments) appendArgument(lines, argument, entities);
    registerOperationEntities(operation, entities);
  }
  return lines;
}

function compileExactFinalState(operations) {
  const activeEntities = new Map();

  for (const operation of operations) {
    const command = String(operation.command ?? "").trim().toUpperCase();
    // Constraints and dimensions annotate existing geometry but do not change the
    // drawable final-state entity set.  Keep the exact-geometry SCR backend usable
    // when an otherwise complete recording ends with DCLINEAR/DCRADIUS/etc.  Those
    // annotations remain in cad-program.json for runtimes that support them; the
    // validation SCR deliberately draws only geometry that is known exactly.
    if (isCadAnnotationOperation(operation, command)) continue;
    assertActiveSelections(operation, activeEntities);

    if (operation.semanticKind === "polar_array") {
      const generated = expandPolarArrayEntities(operation, activeEntities);
      if (!generated) return null;
      if ((operation.resultEntityIds ?? []).length > 0)
        registerGeneratedEntities(operation.resultEntityIds, generated, activeEntities);
      else
        activeEntities.set(`__array_result__${operation.id}`, { type: "group", entities: generated });
      continue;
    }

    const exactGeometry = Array.isArray(operation.resultGeometry)
      ? operation.resultGeometry
      : [];
    if (exactGeometry.length > 0) {
      if (!canApplyExactGeometry(command, operation.semanticKind)) return null;
      if (replacesSourceEntities(command, operation)) {
        const sourceIds = new Set(exactGeometry.flatMap((item) => item.sourceEntityIds ?? []));
        deleteSourcesAndExactOverlaps(activeEntities, sourceIds);
      }
      exactGeometry.forEach((geometry) =>
        activeEntities.set(geometry.id, resultGeometryToEntity(geometry)));
      continue;
    }

    if (command === "ERASE" || command === "DELETE") {
      selectedEntityIds(operation).forEach((id) => activeEntities.delete(id));
      continue;
    }

    const produced = primitiveOperationEntities(operation);
    if (produced.length === 0) return null;
    registerGeneratedEntities(operation.resultEntityIds, produced, activeEntities);
  }

  const lines = [];
  for (const entity of activeEntities.values()) {
    if (entity.type === "group") entity.entities.forEach((item) => appendEntity(lines, item));
    else appendEntity(lines, entity);
  }
  return lines.length > 0 ? lines : null;
}

function isCadAnnotationOperation(operation, command) {
  const semanticKind = String(operation?.semanticKind ?? "").toLowerCase();
  return semanticKind.includes("constraint") ||
    command === "DIMCONSTRAINT" ||
    command.startsWith("DC");
}

function assertActiveSelections(operation, activeEntities) {
  for (const argument of operation.arguments ?? []) {
    if (argument.kind !== "selection" || argument.selection?.mode !== "entities") continue;
    for (const id of argument.selection.entityIds ?? []) {
      if (!activeEntities.has(id))
        throw new Error(`CAD 操作引用了尚未生成的实体或已被替换的实体：${id}`);
    }
  }
}

function selectedEntityIds(operation) {
  return (operation.arguments ?? [])
    .filter((argument) => argument.kind === "selection" && argument.selection?.mode === "entities")
    .flatMap((argument) => argument.selection.entityIds ?? []);
}

function canApplyExactGeometry(command, semanticKind) {
  return new Set([
    "OFFSET", "COPY", "MOVE", "ROTATE", "SCALE", "STRETCH", "MIRROR",
    "FILLET", "CHAMFER", "TRIM", "EXTEND", "BREAK"
  ]).has(command) || [
    "offset", "trim", "circle", "line", "polyline", "arc_3point"
  ].includes(semanticKind);
}

function replacesSourceEntities(command, operation) {
  if (["OFFSET", "COPY"].includes(command)) return false;
  if (command === "ROTATE" && operation.arguments?.some((argument) =>
    argument.kind === "keyword" &&
    (/copy/i.test(String(argument.name)) || /copy/i.test(String(argument.text))))) return false;
  if (command === "MIRROR") {
    const eraseSource = operation.arguments?.find((argument) =>
      argument.kind === "keyword" && /erase|source/i.test(String(argument.name)));
    return /^(y|yes|true|1)$/i.test(String(eraseSource?.text ?? ""));
  }
  return [
    "MOVE", "ROTATE", "SCALE", "STRETCH", "FILLET", "CHAMFER",
    "TRIM", "EXTEND", "BREAK"
  ].includes(command);
}

function deleteSourcesAndExactOverlaps(activeEntities, sourceIds) {
  const signatures = new Set();
  for (const id of sourceIds) {
    const entity = activeEntities.get(id);
    const signature = exactEntitySignature(entity);
    if (signature) signatures.add(signature);
    activeEntities.delete(id);
  }
  if (signatures.size === 0) return;
  for (const [id, entity] of activeEntities) {
    if (signatures.has(exactEntitySignature(entity))) activeEntities.delete(id);
  }
}

function exactEntitySignature(entity) {
  if (!entity) return null;
  if (entity.type === "line" && entity.start && entity.end) {
    const points = [pointSignature(entity.start), pointSignature(entity.end)].sort();
    return `line:${points.join("|")}`;
  }
  if (entity.type === "circle" && entity.center && Number.isFinite(entity.radius))
    return `circle:${pointSignature(entity.center)}:${numberSignature(entity.radius)}`;
  return null;
}

function pointSignature(point) {
  return `${numberSignature(point?.x)},${numberSignature(point?.y)}`;
}

function numberSignature(value) {
  return Number(value).toFixed(7);
}

function primitiveOperationEntities(operation) {
  const points = (operation.arguments ?? [])
    .filter((argument) => argument.kind === "point")
    .map((argument) => argument.point);
  const numbers = (operation.arguments ?? [])
    .filter((argument) => ["number", "integer"].includes(argument.kind));

  if (operation.semanticKind === "circle") {
    const center = findNamedPoint(operation, "center") ?? points[0];
    const radius = findNamedNumber(operation, "radius") ?? numbers[0]?.number;
    return center && Number.isFinite(radius) && radius > 0
      ? [{ type: "circle", center, radius }]
      : [];
  }
  if (operation.semanticKind === "line")
    return points.slice(1).map((point, index) => ({ type: "line", start: points[index], end: point }));
  if (operation.semanticKind === "polyline" && points.length >= 2)
    return [{ type: "polyline", points, closed: hasCloseKeyword(operation) }];
  if (operation.semanticKind === "arc_3point" && points.length === 3)
    return [{ type: "arc_3point", points }];
  return [];
}

function hasCloseKeyword(operation) {
  return operation.arguments?.some((argument) =>
    argument.kind === "keyword" && /^(c|close)$/i.test(String(argument.text ?? ""))) ?? false;
}

function expandPolarArrayEntities(operation, entities) {
  const selection = findArgument(operation, "selection")?.selection;
  const center = findNamedPoint(operation, "center") ?? findFirstPoint(operation);
  const itemCount = findNamedNumber(operation, "item_count", "items");
  const fillAngle = findNamedNumber(operation, "fill_angle", "fill");
  if (!selection || selection.mode !== "entities" || !center ||
    !Number.isInteger(itemCount) || itemCount < 2 || !Number.isFinite(fillAngle)) return null;

  const selected = resolveSelectedEntities(selection.entityIds, entities);
  if (selected.length === 0 || selected.some((entity) => !isRotatableEntity(entity))) return null;
  const generated = [];
  const angleStep = fillAngle / itemCount;
  for (let item = 1; item < itemCount; item += 1) {
    for (const entity of selected)
      generated.push(rotateEntity(entity, center, angleStep * item));
  }
  return generated;
}

function resultGeometryToEntity(geometry) {
  if (geometry.kind === "line") {
    return { type: "line", start: geometry.points[0], end: geometry.points[1] };
  }
  if (geometry.kind === "polyline") {
    return { type: "polyline", points: geometry.points, closed: geometry.closed };
  }
  if (geometry.kind === "circle") {
    return { type: "circle", center: geometry.center, radius: geometry.radius };
  }
  if (geometry.kind === "arc_3point") {
    return { type: "arc_3point", points: geometry.points };
  }
  if (geometry.kind === "arc_center") {
    return {
      type: "arc_center", center: geometry.center, radius: geometry.radius,
      startAngle: geometry.startAngle, endAngle: geometry.endAngle, clockwise: geometry.clockwise
    };
  }
  throw new Error(`不支持的 resultGeometry 类型：${geometry.kind}`);
}

function registerResultGeometry(geometry, produced, entities) {
  geometry.forEach((item, index) => entities.set(item.id, produced[index]));
}

function appendArgument(lines, argument, entities) {
  switch (argument.kind) {
    case "point":
      appendPoint(lines, argument.point);
      return;
    case "number":
    case "integer":
      lines.push(formatNumber(argument.number));
      return;
    case "keyword":
      lines.push(formatKeyword(argument.text));
      return;
    case "text":
      assertSingleLine(argument.text, argument.name);
      lines.push(argument.text);
      return;
    case "enter":
      lines.push("");
      return;
    case "selection":
      appendSelection(lines, argument.selection, entities);
      return;
    default:
      throw new Error(`不支持的 CAD 参数类型：${argument.kind}`);
  }
}

function appendPoint(lines, point) {
  // 捕捉约束保留在 cadProgram；SCR 后端用 _NON 防止运行时 OSNAP 改写精确坐标。
  lines.push("_NON", formatPoint(point));
}

function appendSelection(lines, selection, entities) {
  if (selection.mode === "last") {
    lines.push("_L", "");
    return;
  }
  if (selection.mode === "previous") {
    lines.push("_P", "");
    return;
  }
  if (selection.mode === "all") {
    lines.push("_ALL", "");
    return;
  }

  let first = selection.firstCorner;
  let second = selection.secondCorner;
  let mode = selection.mode;
  if (selection.mode === "entities") {
    const selected = resolveSelectedEntities(selection.entityIds, entities);
    const bounds = entityBounds(selected);
    if (!bounds) throw new Error("CAD 实体选择无法编译：引用的实体没有可计算边界");
    ({ first, second } = expandBounds(bounds));
    mode = "window";
  } else {
    ({ first, second } = expandBoundsFromCorners(first, second));
  }

  lines.push(mode === "crossing" ? "_C" : "_W");
  appendPoint(lines, first);
  appendPoint(lines, second);
  lines.push("");
}

function compileDeterministicPolarArray(lines, operation, entities) {
  const selection = findArgument(operation, "selection")?.selection;
  const center = findNamedPoint(operation, "center") ?? findFirstPoint(operation);
  const itemCount = findNamedNumber(operation, "item_count", "items");
  const fillAngle = findNamedNumber(operation, "fill_angle", "fill");
  if (!selection || selection.mode !== "entities" || !center ||
    !Number.isInteger(itemCount) || itemCount < 2 || !Number.isFinite(fillAngle)) return false;

  const selected = resolveSelectedEntities(selection.entityIds, entities);
  if (selected.length === 0 || selected.some((entity) => !isRotatableEntity(entity))) return false;

  const generated = [];
  const angleStep = fillAngle / itemCount;
  for (let item = 1; item < itemCount; item += 1) {
    for (const entity of selected) {
      const rotated = rotateEntity(entity, center, angleStep * item);
      appendEntity(lines, rotated);
      generated.push(rotated);
    }
  }
  registerGeneratedEntities(operation.resultEntityIds, generated, entities);
  return true;
}

function registerOperationEntities(operation, entities) {
  const points = operation.arguments.filter((argument) => argument.kind === "point")
    .map((argument) => argument.point);
  const numbers = operation.arguments.filter((argument) => ["number", "integer"].includes(argument.kind));
  let produced = [];

  if (operation.semanticKind === "circle") {
    const center = findNamedPoint(operation, "center") ?? points[0];
    const radius = findNamedNumber(operation, "radius") ?? numbers[0]?.number;
    if (center && Number.isFinite(radius) && radius > 0) produced = [{ type: "circle", center, radius }];
  } else if (operation.semanticKind === "line") {
    produced = points.slice(1).map((point, index) => ({ type: "line", start: points[index], end: point }));
  } else if (operation.semanticKind === "polyline") {
    if (points.length >= 2) produced = [{ type: "polyline", points }];
  } else if (operation.semanticKind === "arc_3point") {
    if (points.length === 3) produced = [{ type: "arc_3point", points }];
  }
  registerGeneratedEntities(operation.resultEntityIds, produced, entities);
}

function registerGeneratedEntities(resultIds, produced, entities) {
  if (produced.length === 0 || resultIds.length === 0) return;
  if (resultIds.length === produced.length) {
    resultIds.forEach((id, index) => entities.set(id, produced[index]));
  } else if (resultIds.length === 1) {
    entities.set(resultIds[0], { type: "group", entities: produced });
  }
}

function resolveSelectedEntities(ids, entities) {
  const selected = [];
  for (const id of ids) {
    const entity = entities.get(id);
    if (!entity) throw new Error(`CAD 操作引用了尚未生成的实体：${id}`);
    if (entity.type === "group") selected.push(...entity.entities);
    else selected.push(entity);
  }
  return selected;
}

function appendEntity(lines, entity) {
  if (entity.type === "line") {
    lines.push("_.LINE");
    appendPoint(lines, entity.start);
    appendPoint(lines, entity.end);
    lines.push("");
  } else if (entity.type === "polyline") {
    lines.push("_.PLINE");
    entity.points.forEach((point) => appendPoint(lines, point));
    lines.push(entity.closed ? "_C" : "");
  } else if (entity.type === "circle") {
    lines.push("_.CIRCLE");
    appendPoint(lines, entity.center);
    lines.push(formatNumber(entity.radius));
  } else if (entity.type === "arc_3point") {
    lines.push("_.ARC");
    entity.points.forEach((point) => appendPoint(lines, point));
  } else if (entity.type === "arc_center") {
    lines.push("_.ARC");
    arcCenterToThreePoints(entity).forEach((point) => appendPoint(lines, point));
  } else {
    throw new Error(`无法把 ${entity.type} 阵列实体编译为 SCR`);
  }
}

function rotateEntity(entity, center, angle) {
  if (entity.type === "line") {
    return { type: "line", start: rotatePoint(entity.start, center, angle), end: rotatePoint(entity.end, center, angle) };
  }
  if (entity.type === "polyline" || entity.type === "arc_3point") {
    return { type: entity.type, points: entity.points.map((point) => rotatePoint(point, center, angle)) };
  }
  if (entity.type === "arc_center") {
    return {
      ...entity,
      center: rotatePoint(entity.center, center, angle),
      startAngle: normalizeAngle(entity.startAngle + angle),
      endAngle: normalizeAngle(entity.endAngle + angle)
    };
  }
  if (entity.type === "circle") {
    return { type: "circle", center: rotatePoint(entity.center, center, angle), radius: entity.radius };
  }
  return entity;
}

function rotatePoint(point, center, angleDegrees) {
  const radians = angleDegrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const x = point.x - center.x;
  const y = point.y - center.y;
  return pointLike(point, center.x + x * cosine - y * sine, center.y + x * sine + y * cosine);
}

function isRotatableEntity(entity) {
  return ["line", "polyline", "circle", "arc_3point", "arc_center"].includes(entity.type);
}

function entityBounds(selected) {
  const points = [];
  for (const entity of selected) {
    if (entity.type === "line") points.push(entity.start, entity.end);
    else if (entity.type === "polyline" || entity.type === "arc_3point") points.push(...entity.points);
    else if (entity.type === "circle" || entity.type === "arc_center") {
      points.push(
        pointLike(entity.center, entity.center.x - entity.radius, entity.center.y - entity.radius),
        pointLike(entity.center, entity.center.x + entity.radius, entity.center.y + entity.radius)
      );
    }
  }
  if (points.length === 0) return null;
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y))
  };
}

function arcCenterToThreePoints(entity) {
  const start = entity.startAngle;
  const end = entity.endAngle;
  const sweep = entity.clockwise
    ? -normalizeAngle(start - end)
    : normalizeAngle(end - start);
  if (!Number.isFinite(sweep) || Math.abs(sweep) < 1e-10)
    throw new Error("arc_center 的起止角不能表示零长度或整圆圆弧");
  const mid = start + sweep / 2;
  return [start, mid, end].map((angle) => polarPoint(entity.center, entity.radius, angle));
}

function polarPoint(center, radius, angleDegrees) {
  const radians = angleDegrees * Math.PI / 180;
  return barePoint(center.x + radius * Math.cos(radians), center.y + radius * Math.sin(radians));
}

function normalizeAngle(value) {
  return ((value % 360) + 360) % 360;
}

function expandBounds(bounds) {
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1e-6);
  const margin = Math.max(1e-6, span * 1e-4);
  return {
    first: barePoint(bounds.minX - margin, bounds.minY - margin),
    second: barePoint(bounds.maxX + margin, bounds.maxY + margin)
  };
}

function expandBoundsFromCorners(first, second) {
  if (!first || !second) throw new Error("窗口选择缺少两个 CAD 角点");
  return expandBounds({
    minX: Math.min(first.x, second.x),
    minY: Math.min(first.y, second.y),
    maxX: Math.max(first.x, second.x),
    maxY: Math.max(first.y, second.y)
  });
}

function resolveScriptCommand(commandName, knowledge) {
  const name = String(commandName).trim().toUpperCase();
  const entry = knowledge?.commandCatalog?.commands?.[name];
  const canonicalEntry = entry?.scriptCommandCanonicalName
    ? knowledge?.commandCatalog?.commands?.[entry.scriptCommandCanonicalName]
    : null;
  const scriptCommand = canonicalEntry?.scriptCommand ?? entry?.scriptCommand;
  if (scriptCommand) return scriptCommand;
  if (name === "ARRAY") return "_.-ARRAY";
  return `_.${name}`;
}

function findArgument(operation, kind) {
  return operation.arguments.find((argument) => argument.kind === kind) ?? null;
}

function findFirstPoint(operation) {
  return operation.arguments.find((argument) => argument.kind === "point")?.point ?? null;
}

function findNamedPoint(operation, ...names) {
  const wanted = new Set(names.map(normalizeName));
  return operation.arguments.find((argument) =>
    argument.kind === "point" && wanted.has(normalizeName(argument.name)))?.point ?? null;
}

function findNamedNumber(operation, ...names) {
  const wanted = new Set(names.map(normalizeName));
  return operation.arguments.find((argument) =>
    ["number", "integer"].includes(argument.kind) && wanted.has(normalizeName(argument.name)))?.number ?? null;
}

function normalizeName(value) {
  return String(value).trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function formatKeyword(value) {
  assertSingleLine(value, "keyword");
  return value.startsWith("_") ? value : `_${value}`;
}

function assertSingleLine(value, label) {
  if (typeof value !== "string" || /[\r\n]/.test(value)) throw new Error(`${label} 必须是单行字符串`);
}

function formatPoint(point) {
  return `${formatNumber(point.x)},${formatNumber(point.y)}`;
}

function formatNumber(value) {
  if (!Number.isFinite(value)) throw new Error(`CAD 数值无效：${value}`);
  const normalized = Math.abs(value) < 5e-11 ? 0 : value;
  return normalized.toFixed(10).replace(/\.?0+$/, "");
}

function barePoint(x, y) {
  return { x, y, snap: "none", referenceEntityIds: [], confidence: 1 };
}

function pointLike(source, x, y) {
  return {
    x,
    y,
    snap: source.snap ?? "none",
    referenceEntityIds: [...(source.referenceEntityIds ?? [])],
    confidence: source.confidence ?? 1
  };
}
