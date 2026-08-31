export const CAD_GEOMETRY_CANDIDATE_VERSION = "0.1";

export function buildCadGeometryCandidateLayer({
  cadEntityCatalog = [],
  actions = [],
  maxEntities = 36,
  maxPointCandidates = 180,
  maxPairCandidates = 120,
  maxEvidenceContracts = 40
} = {}) {
  const allEntities = canonicalizeEntities(cadEntityCatalog);
  const entities = selectEntities(allEntities, maxEntities);
  const pointCandidates = [];
  const pairCandidates = [];

  for (const entity of entities)
    pointCandidates.push(...intrinsicPointCandidates(entity));

  outer:
  for (let leftIndex = 0; leftIndex < entities.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < entities.length; rightIndex += 1) {
      if (pairCandidates.length >= maxPairCandidates || pointCandidates.length >= maxPointCandidates)
        break outer;
      const left = entities[leftIndex];
      const right = entities[rightIndex];
      const intersections = intersectEntities(left, right);
      if (intersections.length === 0) continue;
      const available = intersections.slice(0, Math.max(0, maxPointCandidates - pointCandidates.length));
      const intersectionPointCandidateIds = [];
      for (let index = 0; index < available.length; index += 1) {
        const intersection = available[index];
        const pointCandidateId = `point:intersection:${left.canonicalEntityId}:${right.canonicalEntityId}:${index + 1}`;
        intersectionPointCandidateIds.push(pointCandidateId);
        pointCandidates.push({
          pointCandidateId,
          point: exactPoint(intersection.x, intersection.y),
          snap: "intersection",
          referenceEntityIds: [left.canonicalEntityId, right.canonicalEntityId],
          equivalentReferenceEntityIds: unique([
            ...left.equivalentEntityIds, ...right.equivalentEntityIds
          ]),
          derivation: intersection.derivation,
          withinEntitySegments: {
            [left.canonicalEntityId]: intersection.withinLeft,
            [right.canonicalEntityId]: intersection.withinRight
          },
          supportedRoles: ["fillet_corner", "trim_boundary", "line_start", "line_end"],
          confidence: roundConfidence(Math.min(left.confidence, right.confidence) * intersection.weight)
        });
      }
      pairCandidates.push({
        entityPairCandidateId: `pair:${left.canonicalEntityId}:${right.canonicalEntityId}`,
        entityIds: [left.canonicalEntityId, right.canonicalEntityId],
        equivalentEntityIds: unique([...left.equivalentEntityIds, ...right.equivalentEntityIds]),
        intersectionPointCandidateIds,
        supportedCommands: supportedPairCommands(left.kind, right.kind),
        confidence: roundConfidence(Math.min(left.confidence, right.confidence))
      });
    }
  }

  const allEvidenceContracts = buildEvidenceContracts(actions);
  const evidenceContracts = allEvidenceContracts.slice(-maxEvidenceContracts);
  return {
    format: "RecorderCadGeometricCandidates",
    version: CAD_GEOMETRY_CANDIDATE_VERSION,
    entityCandidates: entities.map((entity) => ({
      entityCandidateId: `entity:${entity.canonicalEntityId}`,
      canonicalEntityId: entity.canonicalEntityId,
      equivalentEntityIds: entity.equivalentEntityIds,
      exactOverlap: entity.equivalentEntityIds.length > 1,
      kind: entity.kind,
      confidence: entity.confidence
    })),
    pointCandidates: pointCandidates.slice(0, maxPointCandidates),
    entityPairCandidates: pairCandidates,
    evidenceContracts,
    limits: {
      maxEntities,
      maxPointCandidates,
      maxPairCandidates,
      maxEvidenceContracts
    },
    truncated: {
      entities: allEntities.length > entities.length,
      points: pointCandidates.length > maxPointCandidates,
      pairs: pairCandidates.length >= maxPairCandidates,
      evidence: allEvidenceContracts.length > evidenceContracts.length
    }
  };
}

function canonicalizeEntities(catalog) {
  const groups = new Map();
  for (const entry of Array.isArray(catalog) ? catalog : []) {
    const geometry = exactGeometryOf(entry);
    if (!geometry || !["line", "circle", "arc_center"].includes(geometry.kind)) continue;
    const canonicalEntityId = entry.canonicalEntityId ?? entry.entityId;
    if (!canonicalEntityId) continue;
    const existing = groups.get(canonicalEntityId);
    const equivalentEntityIds = unique([
      ...(existing?.equivalentEntityIds ?? []),
      ...(entry.equivalentEntityIds ?? []),
      entry.entityId,
      canonicalEntityId
    ]);
    groups.set(canonicalEntityId, {
      canonicalEntityId,
      equivalentEntityIds,
      kind: geometry.kind,
      geometry,
      confidence: roundConfidence(Math.max(
        Number(existing?.confidence ?? 0),
        Number(entry.confidence ?? geometry.confidence ?? 0.7)
      ))
    });
  }
  return [...groups.values()];
}

function selectEntities(entities, maximum) {
  if (entities.length <= maximum) return entities;
  const firstCount = Math.min(8, Math.floor(maximum / 3));
  return [...entities.slice(0, firstCount), ...entities.slice(-(maximum - firstCount))];
}

function exactGeometryOf(entity) {
  if (entity?.exactGeometry) return entity.exactGeometry;
  if (Array.isArray(entity?.resultGeometry) && entity.resultGeometry.length === 1)
    return entity.resultGeometry[0];
  return null;
}

function intrinsicPointCandidates(entity) {
  const result = [];
  if (entity.kind === "line" && entity.geometry.points?.length === 2) {
    entity.geometry.points.forEach((point, index) => result.push({
      pointCandidateId: `point:endpoint:${entity.canonicalEntityId}:${index + 1}`,
      point: exactPoint(point.x, point.y),
      snap: "endpoint",
      referenceEntityIds: [entity.canonicalEntityId],
      equivalentReferenceEntityIds: entity.equivalentEntityIds,
      derivation: "known_line_endpoint",
      withinEntitySegments: { [entity.canonicalEntityId]: true },
      supportedRoles: ["line_start", "line_end", "move_base", "rotate_base"],
      confidence: entity.confidence
    }));
  }
  if (["circle", "arc_center"].includes(entity.kind) && entity.geometry.center &&
    Number.isFinite(entity.geometry.radius)) {
    const center = entity.geometry.center;
    const radius = entity.geometry.radius;
    result.push({
      pointCandidateId: `point:center:${entity.canonicalEntityId}`,
      point: exactPoint(center.x, center.y),
      snap: "center",
      referenceEntityIds: [entity.canonicalEntityId],
      equivalentReferenceEntityIds: entity.equivalentEntityIds,
      derivation: "known_circle_center",
      withinEntitySegments: { [entity.canonicalEntityId]: true },
      supportedRoles: ["circle_center", "array_center", "move_base", "rotate_base"],
      confidence: entity.confidence
    });
    for (const [name, x, y] of [
      ["east", center.x + radius, center.y],
      ["north", center.x, center.y + radius],
      ["west", center.x - radius, center.y],
      ["south", center.x, center.y - radius]
    ]) {
      result.push({
        pointCandidateId: `point:quadrant:${entity.canonicalEntityId}:${name}`,
        point: exactPoint(x, y),
        snap: "quadrant",
        referenceEntityIds: [entity.canonicalEntityId],
        equivalentReferenceEntityIds: entity.equivalentEntityIds,
        derivation: `known_circle_${name}_quadrant`,
        withinEntitySegments: { [entity.canonicalEntityId]: true },
        supportedRoles: ["line_start", "line_end", "copy_base", "move_base"],
        confidence: entity.confidence
      });
    }
  }
  return result;
}

function intersectEntities(left, right) {
  if (left.kind === "line" && right.kind === "line")
    return lineLineIntersections(left.geometry, right.geometry);
  if (left.kind === "line" && isCircleLike(right.kind))
    return lineCircleIntersections(left.geometry, right.geometry, false);
  if (isCircleLike(left.kind) && right.kind === "line")
    return lineCircleIntersections(right.geometry, left.geometry, true);
  if (isCircleLike(left.kind) && isCircleLike(right.kind))
    return circleCircleIntersections(left.geometry, right.geometry);
  return [];
}

function lineLineIntersections(left, right) {
  const [p1, p2] = left.points ?? [];
  const [q1, q2] = right.points ?? [];
  if (!p1 || !p2 || !q1 || !q2) return [];
  const rx = p2.x - p1.x;
  const ry = p2.y - p1.y;
  const sx = q2.x - q1.x;
  const sy = q2.y - q1.y;
  const denominator = cross(rx, ry, sx, sy);
  if (Math.abs(denominator) < 1e-10) return [];
  const qpx = q1.x - p1.x;
  const qpy = q1.y - p1.y;
  const t = cross(qpx, qpy, sx, sy) / denominator;
  const u = cross(qpx, qpy, rx, ry) / denominator;
  const withinLeft = withinUnit(t);
  const withinRight = withinUnit(u);
  return [{
    x: p1.x + t * rx,
    y: p1.y + t * ry,
    withinLeft,
    withinRight,
    derivation: "exact_line_line_intersection",
    weight: withinLeft && withinRight ? 1 : withinLeft || withinRight ? 0.94 : 0.86
  }];
}

function lineCircleIntersections(line, circle, circleIsLeft) {
  const [start, end] = line.points ?? [];
  const center = circle.center;
  const radius = circle.radius;
  if (!start || !end || !center || !Number.isFinite(radius) || radius <= 0) return [];
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const fx = start.x - center.x;
  const fy = start.y - center.y;
  const a = dx * dx + dy * dy;
  if (a < 1e-16) return [];
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - radius * radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < -1e-9) return [];
  const roots = Math.abs(discriminant) <= 1e-9
    ? [-b / (2 * a)]
    : [
      (-b - Math.sqrt(Math.max(0, discriminant))) / (2 * a),
      (-b + Math.sqrt(Math.max(0, discriminant))) / (2 * a)
    ];
  return roots.map((t) => {
    const withinLine = withinUnit(t);
    return {
      x: start.x + t * dx,
      y: start.y + t * dy,
      withinLeft: circleIsLeft ? true : withinLine,
      withinRight: circleIsLeft ? withinLine : true,
      derivation: "exact_line_circle_intersection",
      weight: withinLine ? 1 : 0.88
    };
  });
}

function circleCircleIntersections(left, right) {
  const p0 = left.center;
  const p1 = right.center;
  const r0 = left.radius;
  const r1 = right.radius;
  if (!p0 || !p1 || !Number.isFinite(r0) || !Number.isFinite(r1)) return [];
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 1e-10 || distance > r0 + r1 + 1e-9 || distance < Math.abs(r0 - r1) - 1e-9)
    return [];
  const along = (r0 * r0 - r1 * r1 + distance * distance) / (2 * distance);
  const heightSquared = Math.max(0, r0 * r0 - along * along);
  const height = Math.sqrt(heightSquared);
  const baseX = p0.x + along * dx / distance;
  const baseY = p0.y + along * dy / distance;
  const offsetX = -dy * height / distance;
  const offsetY = dx * height / distance;
  const points = [{ x: baseX + offsetX, y: baseY + offsetY }];
  if (height > 1e-9) points.push({ x: baseX - offsetX, y: baseY - offsetY });
  return points.map((point) => ({
    ...point,
    withinLeft: true,
    withinRight: true,
    derivation: "exact_circle_circle_intersection",
    weight: 1
  }));
}

function supportedPairCommands(leftKind, rightKind) {
  if (leftKind === "line" && rightKind === "line")
    return ["FILLET", "CHAMFER", "TRIM", "EXTEND", "LINE"];
  return ["TRIM", "EXTEND", "LINE"];
}

function buildEvidenceContracts(actions) {
  return (Array.isArray(actions) ? actions : [])
    .filter((action) => action?.screenshotBefore || action?.screenshotSelection ||
      action?.screenshotAfter || action?.persistentBaselineScreenshot)
    .map((action, index) => {
      const frames = {
        persistentBaseline: action.persistentBaselineScreenshot ?? null,
        immediateBefore: action.screenshotBefore ?? null,
        selectionFeedback: action.screenshotSelection ?? null,
        settledAfter: action.screenshotAfter ?? null
      };
      const availableFrameCount = Object.values(frames).filter(Boolean).length;
      const hasComparisonPair = Boolean(frames.immediateBefore && frames.settledAfter);
      return {
        evidenceCandidateId: `evidence:${(action.sourceEventIds ?? []).join("+") || index + 1}`,
        action: action.action,
        sourceEventIds: action.sourceEventIds ?? [],
        commandCandidates: unique([
          action.resolvedCadCommandContext,
          action.cadInputEvidence?.command,
          action.visualCommandContext,
          action.cadCommandContext
        ].map((item) => normalizeCommand(item)).filter(Boolean)),
        at: action.at ?? action.to ?? action.from ?? null,
        frames,
        evidenceHealth: {
          availableFrameCount,
          hasComparisonPair,
          hasSelectionFeedback: Boolean(frames.selectionFeedback),
          usableForTopologyChange: hasComparisonPair,
          status: hasComparisonPair ? "paired" : availableFrameCount > 0 ? "single_sided" : "missing"
        },
        visualChange: action.visualChange ?? null
      };
    });
}

function isCircleLike(kind) {
  return kind === "circle" || kind === "arc_center";
}

function withinUnit(value) {
  return value >= -1e-9 && value <= 1 + 1e-9;
}

function cross(ax, ay, bx, by) {
  return ax * by - ay * bx;
}

function exactPoint(x, y) {
  return { x: cleanNumber(x), y: cleanNumber(y) };
}

function cleanNumber(value) {
  const rounded = Number(Number(value).toFixed(10));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function roundConfidence(value) {
  return Math.max(0, Math.min(1, Number(Number(value).toFixed(4))));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeCommand(value) {
  const normalized = String(value ?? "").trim().toUpperCase().replace(/^_\./, "");
  return /^-?[A-Z][A-Z0-9_+]*$/.test(normalized) ? normalized : null;
}
