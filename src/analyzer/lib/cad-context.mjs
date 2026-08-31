const REPLACEMENT_COMMANDS = new Set([
  "MOVE", "ROTATE", "SCALE", "STRETCH", "FILLET", "CHAMFER",
  "TRIM", "EXTEND", "BREAK"
]);

export function buildCadEntityCatalog(plans) {
  const activeEntities = new Map();
  for (const plan of Array.isArray(plans) ? plans : []) {
    if (plan?.cadProgram?.format !== "autocad_command_ir") continue;
    for (const operation of plan.cadProgram.operations ?? []) {
      const replacementIds = replacementSourceEntityIds(operation);
      for (const sourceId of replacementIds)
        deleteEntityAndExactOverlaps(activeEntities, sourceId);

      const exactGeometry = operationEntityGeometry(operation);
      for (const entityId of operation.resultEntityIds ?? []) {
        const geometry = exactGeometry.get(entityId) ?? null;
        activeEntities.set(entityId, {
          entityId,
          createdByOperationId: operation.id,
          semanticKind: operation.semanticKind,
          command: operation.command,
          // 创建参数本身也能严格定义几何；不能因为 resultGeometry 为空就忘掉实体。
          arguments: operation.arguments ?? [],
          resultGeometry: (operation.resultGeometry ?? [])
            .filter((item) => item.id === entityId),
          ...(geometry ? { exactGeometry: geometry } : {}),
          confidence: operation.confidence
        });
      }
    }
  }
  return annotateExactOverlapGroups([...activeEntities.values()]);
}

function replacementSourceEntityIds(operation) {
  const command = String(operation?.command ?? "").trim().toUpperCase();
  if (!REPLACEMENT_COMMANDS.has(command) && operation?.semanticKind !== "trim" &&
    operation?.semanticKind !== "fillet") return [];
  if (command === "ROTATE" && hasCopyOption(operation)) return [];

  const geometrySources = (operation?.resultGeometry ?? [])
    .flatMap((geometry) => geometry.sourceEntityIds ?? []);
  const inferenceSources = operation?.visualInference?.sourceEntityIds ?? [];
  return [...new Set([...geometrySources, ...inferenceSources].filter(Boolean))];
}

function hasCopyOption(operation) {
  return operation?.arguments?.some((argument) =>
    argument.kind === "keyword" &&
    (/copy/i.test(String(argument.name ?? "")) || /copy/i.test(String(argument.text ?? "")))) ?? false;
}

function deleteEntityAndExactOverlaps(activeEntities, sourceId) {
  const source = activeEntities.get(sourceId);
  if (!source) return;
  const signature = geometrySignature(source.exactGeometry);
  activeEntities.delete(sourceId);
  if (!signature) return;
  for (const [entityId, entity] of activeEntities) {
    if (geometrySignature(entity.exactGeometry) === signature)
      activeEntities.delete(entityId);
  }
}

function annotateExactOverlapGroups(entities) {
  const groups = new Map();
  for (const entity of entities) {
    const signature = geometrySignature(entity.exactGeometry);
    if (!signature) continue;
    const group = groups.get(signature) ?? [];
    group.push(entity);
    groups.set(signature, group);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    // AutoCAD 点击完全重合对象时通常优先命中后创建对象；同时把全部等价 ID 提供给
    // 审计器，使其按最终可见画布决定是否需要一起替换。
    const canonicalEntityId = group.at(-1).entityId;
    const equivalentEntityIds = group.map((entity) => entity.entityId);
    for (const entity of group) {
      entity.canonicalEntityId = canonicalEntityId;
      entity.equivalentEntityIds = equivalentEntityIds;
      entity.exactOverlap = true;
    }
  }
  return entities;
}

function operationEntityGeometry(operation) {
  const geometries = new Map();
  for (const geometry of operation?.resultGeometry ?? [])
    geometries.set(geometry.id, geometry);
  if (geometries.size > 0) return geometries;

  const ids = operation?.resultEntityIds ?? [];
  const points = (operation?.arguments ?? [])
    .filter((argument) => argument.kind === "point" && argument.point)
    .map((argument) => argument.point);
  if (operation?.semanticKind === "line" && ids.length === points.length - 1) {
    ids.forEach((id, index) => geometries.set(id, {
      id, kind: "line", points: [points[index], points[index + 1]], center: null,
      radius: null, startAngle: null, endAngle: null, clockwise: null, closed: false
    }));
  } else if (operation?.semanticKind === "circle" && ids.length === 1) {
    const center = namedPoint(operation, "center") ?? points[0];
    const radius = namedNumber(operation, "radius");
    if (center && Number.isFinite(radius)) geometries.set(ids[0], {
      id: ids[0], kind: "circle", points: [], center, radius,
      startAngle: null, endAngle: null, clockwise: null, closed: true
    });
  }
  return geometries;
}

function namedPoint(operation, name) {
  return operation?.arguments?.find((argument) =>
    argument.kind === "point" && normalizeName(argument.name) === name)?.point ?? null;
}

function namedNumber(operation, name) {
  return operation?.arguments?.find((argument) =>
    ["number", "integer"].includes(argument.kind) && normalizeName(argument.name) === name)?.number ?? null;
}

function normalizeName(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function geometrySignature(geometry) {
  if (!geometry) return null;
  if (geometry.kind === "line" && geometry.points?.length === 2) {
    const points = geometry.points.map(pointSignature).sort();
    return `line:${points.join("|")}`;
  }
  if (geometry.kind === "circle" && geometry.center && Number.isFinite(geometry.radius))
    return `circle:${pointSignature(geometry.center)}:${numberSignature(geometry.radius)}`;
  return null;
}

function pointSignature(point) {
  return `${numberSignature(point?.x)},${numberSignature(point?.y)}`;
}

function numberSignature(value) {
  return Number(value).toFixed(7);
}
