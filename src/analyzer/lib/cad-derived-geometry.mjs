export function materializeDeterministicCadGeometry(plan, previousPlans = []) {
  if (!plan || typeof plan !== "object") return plan;
  const normalized = JSON.parse(JSON.stringify(plan));
  if (normalized.cadProgram?.format !== "autocad_command_ir") return normalized;

  const entities = new Map();
  for (const previousPlan of Array.isArray(previousPlans) ? previousPlans : [])
    indexOperations(previousPlan?.cadProgram?.operations, entities, false);
  indexOperations(normalized.cadProgram.operations, entities, true);
  return normalized;
}

function indexOperations(operations, entities, materializeArrays) {
  for (const operation of Array.isArray(operations) ? operations : []) {
    if (operation.semanticKind === "polar_array") {
      const generated = expandPolarArray(operation, entities);
      if (!generated) continue;
      if (materializeArrays) {
        operation.resultEntityIds = generated.map((item) => item.id);
        operation.resultGeometry = generated.map((item) => item.geometry);
      }
      generated.forEach((item) => entities.set(item.id, item.geometry));
      continue;
    }

    const exactGeometry = Array.isArray(operation.resultGeometry)
      ? operation.resultGeometry
      : [];
    if (exactGeometry.length > 0) {
      exactGeometry.forEach((geometry) => entities.set(geometry.id, geometry));
      continue;
    }
    primitiveGeometry(operation).forEach(({ id, geometry }) => entities.set(id, geometry));
  }
}

function expandPolarArray(operation, entities) {
  const selection = operation.arguments?.find((argument) => argument.kind === "selection")?.selection;
  const center = namedPoint(operation, "center") ?? firstPoint(operation);
  const itemCount = namedNumber(operation, "item_count", "items");
  const fillAngle = namedNumber(operation, "fill_angle", "fill");
  if (!selection || selection.mode !== "entities" || !center ||
    !Number.isInteger(itemCount) || itemCount < 2 || !Number.isFinite(fillAngle)) return null;

  const sources = [];
  for (const sourceId of selection.entityIds ?? []) {
    const geometry = entities.get(sourceId);
    if (!geometry || !isRotatableGeometry(geometry)) return null;
    sources.push({ sourceId, geometry });
  }
  if (sources.length === 0) return null;

  const generatedGeometry = [];
  const angleStep = fillAngle / itemCount;
  for (let item = 1; item < itemCount; item += 1) {
    for (const source of sources) {
      generatedGeometry.push({
        sourceId: source.sourceId,
        geometry: rotateGeometry(source.geometry, center, angleStep * item, operation.confidence)
      });
    }
  }

  const existingIds = Array.isArray(operation.resultEntityIds) ? operation.resultEntityIds : [];
  const baseId = existingIds.length === 1
    ? existingIds[0]
    : `${operation.id}-array`;
  const ids = existingIds.length === generatedGeometry.length
    ? existingIds
    : generatedGeometry.map((_, index) =>
      `${baseId}-member-${String(index + 1).padStart(3, "0")}`);
  return generatedGeometry.map((item, index) => ({
    id: ids[index],
    geometry: {
      ...item.geometry,
      id: ids[index],
      sourceEntityIds: [item.sourceId],
      confidence: minimumConfidence(operation.confidence, item.geometry.confidence)
    }
  }));
}

function primitiveGeometry(operation) {
  const ids = Array.isArray(operation.resultEntityIds) ? operation.resultEntityIds : [];
  const points = operation.arguments?.filter((argument) => argument.kind === "point" && argument.point)
    .map((argument) => argument.point) ?? [];
  const confidence = Number.isFinite(operation.confidence) ? operation.confidence : 0;
  let geometries = [];

  if (operation.semanticKind === "circle") {
    const center = namedPoint(operation, "center") ?? points[0];
    const radius = namedNumber(operation, "radius");
    if (center && Number.isFinite(radius) && radius > 0) {
      geometries = [{
        kind: "circle", points: [], center, radius,
        startAngle: null, endAngle: null, clockwise: null, closed: true,
        sourceEntityIds: [], confidence
      }];
    }
  } else if (operation.semanticKind === "line") {
    geometries = points.slice(1).map((point, index) => ({
      kind: "line", points: [points[index], point], center: null, radius: null,
      startAngle: null, endAngle: null, clockwise: null, closed: false,
      sourceEntityIds: [], confidence
    }));
  } else if (operation.semanticKind === "polyline" && points.length >= 2) {
    geometries = [{
      kind: "polyline", points, center: null, radius: null,
      startAngle: null, endAngle: null, clockwise: null,
      closed: operation.arguments?.some((argument) =>
        argument.kind === "keyword" && /^C(?:LOSE)?$/i.test(argument.text ?? "")) ?? false,
      sourceEntityIds: [], confidence
    }];
  } else if (operation.semanticKind === "arc_3point" && points.length === 3) {
    geometries = [{
      kind: "arc_3point", points, center: null, radius: null,
      startAngle: null, endAngle: null, clockwise: null, closed: false,
      sourceEntityIds: [], confidence
    }];
  }

  if (ids.length !== geometries.length) return [];
  return geometries.map((geometry, index) => ({
    id: ids[index],
    geometry: { ...geometry, id: ids[index] }
  }));
}

function rotateGeometry(geometry, center, angleDegrees, operationConfidence) {
  const confidence = minimumConfidence(geometry.confidence, operationConfidence);
  if (geometry.kind === "line" || geometry.kind === "polyline" || geometry.kind === "arc_3point") {
    return {
      ...geometry,
      points: geometry.points.map((point) => rotatePoint(point, center, angleDegrees, confidence)),
      center: null,
      confidence
    };
  }
  if (geometry.kind === "circle") {
    return {
      ...geometry,
      points: [],
      center: rotatePoint(geometry.center, center, angleDegrees, confidence),
      confidence
    };
  }
  if (geometry.kind === "arc_center") {
    return {
      ...geometry,
      points: [],
      center: rotatePoint(geometry.center, center, angleDegrees, confidence),
      startAngle: normalizeAngle(geometry.startAngle + angleDegrees),
      endAngle: normalizeAngle(geometry.endAngle + angleDegrees),
      confidence
    };
  }
  return geometry;
}

function rotatePoint(point, center, angleDegrees, confidence) {
  const radians = angleDegrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const x = point.x - center.x;
  const y = point.y - center.y;
  return {
    x: center.x + x * cosine - y * sine,
    y: center.y + x * sine + y * cosine,
    snap: "none",
    referenceEntityIds: [],
    confidence: minimumConfidence(point.confidence, confidence)
  };
}

function firstPoint(operation) {
  return operation.arguments?.find((argument) => argument.kind === "point" && argument.point)?.point ?? null;
}

function namedPoint(operation, ...names) {
  const normalizedNames = new Set(names.map(normalizeName));
  return operation.arguments?.find((argument) =>
    argument.kind === "point" && argument.point && normalizedNames.has(normalizeName(argument.name)))?.point ?? null;
}

function namedNumber(operation, ...names) {
  const normalizedNames = new Set(names.map(normalizeName));
  return operation.arguments?.find((argument) =>
    ["number", "integer"].includes(argument.kind) &&
    normalizedNames.has(normalizeName(argument.name)))?.number ?? null;
}

function normalizeName(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function isRotatableGeometry(geometry) {
  return ["line", "polyline", "circle", "arc_3point", "arc_center"].includes(geometry.kind);
}

function normalizeAngle(value) {
  return ((value % 360) + 360) % 360;
}

function minimumConfidence(...values) {
  const finite = values.filter(Number.isFinite);
  return finite.length > 0 ? Math.min(...finite) : 0;
}
