export const CAD_OFFSET_DIAGNOSTIC_VERSION = "0.1";

export function buildSuspiciousOffsetOverlaps({ cadProgram, activeCadEntityCatalog = [] } = {}) {
  const operations = Array.isArray(cadProgram?.operations) ? cadProgram.operations : [];
  const geometryByEntityId = buildGeometryIndex(operations);
  const overlapByEntityId = buildOverlapIndex(activeCadEntityCatalog);
  const diagnostics = [];

  for (const operation of operations) {
    if (normalizeCommand(operation?.command) !== "OFFSET") continue;
    const distance = offsetDistance(operation);
    if (!Number.isFinite(distance) || distance <= 0) continue;
    const sourceEntityId = offsetSourceEntityId(operation);
    const sourceGeometry = geometryByEntityId.get(sourceEntityId);
    if (!isExactLine(sourceGeometry)) continue;

    for (const resultGeometry of operation.resultGeometry ?? []) {
      if (!isExactLine(resultGeometry)) continue;
      const overlap = overlapByEntityId.get(resultGeometry.id);
      if (!overlap) continue;
      const otherEntityIds = overlap.equivalentEntityIds.filter((id) =>
        id !== resultGeometry.id && !(operation.resultEntityIds ?? []).includes(id));
      if (otherEntityIds.length === 0) continue;

      const candidates = lineOffsetCandidates(sourceGeometry, distance, sourceEntityId);
      const currentCandidate = candidates.find((candidate) =>
        sameLine(candidate.geometry, resultGeometry));
      const alternativeCandidates = candidates.filter((candidate) =>
        !sameLine(candidate.geometry, resultGeometry));
      if (alternativeCandidates.length === 0) continue;

      diagnostics.push({
        diagnosticId: `offset-overlap:${operation.id}:${resultGeometry.id}`,
        severity: "high",
        operationId: operation.id,
        resultEntityId: resultGeometry.id,
        sourceEntityId,
        offsetDistance: distance,
        currentSide: currentCandidate?.side ?? declaredOffsetSide(operation),
        currentResultGeometry: resultGeometry,
        exactOverlap: {
          canonicalEntityId: overlap.canonicalEntityId,
          equivalentEntityIds: overlap.equivalentEntityIds,
          otherEntityIds
        },
        alternativeResultCandidates: alternativeCandidates,
        evidence: {
          beforeScreenshot: operation.visualInference?.beforeScreenshot ?? null,
          afterScreenshot: operation.visualInference?.afterScreenshot ?? null,
          sourceEventIds: operation.sourceEventIds ?? [],
          sourceScreenshots: operation.sourceScreenshots ?? []
        },
        auditInstruction: "OFFSET 结果与已有可见实体完全重合。除非前后截图明确证明用户创建了重合副本，否则必须比较操作前后平行线的数量与左右顺序；若截图出现新的独立平行线，应从 alternativeResultCandidates 选择对应 side 和精确几何，并修复后续实体引用。"
      });
    }
  }
  return {
    format: "RecorderCadOffsetDiagnostics",
    version: CAD_OFFSET_DIAGNOSTIC_VERSION,
    suspiciousOverlaps: diagnostics
  };
}

function buildGeometryIndex(operations) {
  const result = new Map();
  for (const operation of operations) {
    for (const geometry of operation?.resultGeometry ?? []) {
      if (geometry?.id) result.set(geometry.id, geometry);
    }
  }
  return result;
}

function buildOverlapIndex(catalog) {
  const result = new Map();
  for (const entity of Array.isArray(catalog) ? catalog : []) {
    const equivalentEntityIds = unique([
      ...(entity?.equivalentEntityIds ?? []),
      entity?.canonicalEntityId,
      entity?.entityId
    ]);
    if (!entity?.exactOverlap || equivalentEntityIds.length < 2) continue;
    const group = {
      canonicalEntityId: entity.canonicalEntityId ?? entity.entityId,
      equivalentEntityIds
    };
    for (const entityId of equivalentEntityIds) result.set(entityId, group);
  }
  return result;
}

function offsetDistance(operation) {
  return (operation?.arguments ?? [])
    .find((argument) => argument?.kind === "number" &&
      /^(?:offset_)?distance$/i.test(String(argument?.name ?? "")))?.number;
}

function offsetSourceEntityId(operation) {
  const selected = (operation?.arguments ?? [])
    .flatMap((argument) => argument?.selection?.entityIds ?? []);
  return selected[0] ?? operation?.resultGeometry?.[0]?.sourceEntityIds?.[0] ?? null;
}

function declaredOffsetSide(operation) {
  return (operation?.arguments ?? [])
    .find((argument) => argument?.kind === "keyword" && argument?.name === "side")?.text ?? null;
}

function lineOffsetCandidates(sourceGeometry, distance, sourceEntityId) {
  const [start, end] = sourceGeometry.points;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length <= 1e-12) return [];
  const left = { x: -dy / length * distance, y: dx / length * distance };
  const right = { x: -left.x, y: -left.y };
  return [
    offsetCandidate("left", left),
    offsetCandidate("right", right)
  ];

  function offsetCandidate(side, vector) {
    return {
      side,
      derivation: "exact_directed_line_offset",
      geometry: {
        kind: "line",
        points: [
          exactPoint(start.x + vector.x, start.y + vector.y),
          exactPoint(end.x + vector.x, end.y + vector.y)
        ],
        sourceEntityIds: [sourceEntityId],
        confidence: Math.min(1, Number(sourceGeometry.confidence ?? 0.95))
      }
    };
  }
}

function sameLine(left, right) {
  if (!isExactLine(left) || !isExactLine(right)) return false;
  const [a, b] = left.points;
  const [c, d] = right.points;
  return (samePoint(a, c) && samePoint(b, d)) ||
    (samePoint(a, d) && samePoint(b, c));
}

function samePoint(left, right) {
  return Math.abs(left.x - right.x) <= 1e-7 && Math.abs(left.y - right.y) <= 1e-7;
}

function isExactLine(geometry) {
  return geometry?.kind === "line" && geometry?.points?.length === 2 &&
    geometry.points.every((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y));
}

function exactPoint(x, y) {
  return { x: cleanNumber(x), y: cleanNumber(y) };
}

function cleanNumber(value) {
  const rounded = Number(Number(value).toFixed(10));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeCommand(value) {
  return String(value ?? "").trim().toUpperCase().replace(/^_\./, "");
}
