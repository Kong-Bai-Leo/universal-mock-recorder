import test from "node:test";
import assert from "node:assert/strict";
import { buildCadGeometryCandidateLayer } from "../src/analyzer/lib/cad-geometry-candidates.mjs";

test("几何候选层折叠重合实体并生成精确 FILLET 交点", () => {
  const layer = buildCadGeometryCandidateLayer({
    cadEntityCatalog: [
      lineEntity("vertical-original", 0, 0, 0, 10, {
        canonicalEntityId: "vertical-copy",
        equivalentEntityIds: ["vertical-original", "vertical-copy"]
      }),
      lineEntity("vertical-copy", 0, 0, 0, 10, {
        canonicalEntityId: "vertical-copy",
        equivalentEntityIds: ["vertical-original", "vertical-copy"]
      }),
      lineEntity("diagonal", -5, 0, 5, 10)
    ],
    actions: [{
      action: "click", sourceEventIds: ["evt-fillet"],
      screenshotBefore: "before.jpg", screenshotAfter: "after.jpg",
      visualCommandContext: "FILLET", at: { x: 500, y: 400 }
    }]
  });

  assert.equal(layer.entityCandidates.length, 2);
  const vertical = layer.entityCandidates.find((item) => item.canonicalEntityId === "vertical-copy");
  assert.equal(vertical.exactOverlap, true);
  assert.deepEqual(vertical.equivalentEntityIds, ["vertical-original", "vertical-copy"]);

  const intersection = layer.pointCandidates.find((item) =>
    item.derivation === "exact_line_line_intersection");
  assert.deepEqual(intersection.point, { x: 0, y: 5 });
  assert.deepEqual(intersection.referenceEntityIds, ["vertical-copy", "diagonal"]);
  assert.ok(layer.entityPairCandidates[0].supportedCommands.includes("FILLET"));
  assert.equal(layer.evidenceContracts[0].evidenceHealth.status, "paired");
});

test("几何候选层生成圆象限和线圆解析交点", () => {
  const layer = buildCadGeometryCandidateLayer({
    cadEntityCatalog: [
      circleEntity("circle", 0, 0, 5),
      lineEntity("horizontal", -10, 0, 10, 0)
    ]
  });

  const intersections = layer.pointCandidates
    .filter((item) => item.derivation === "exact_line_circle_intersection")
    .map((item) => item.point)
    .sort((left, right) => left.x - right.x);
  assert.deepEqual(intersections, [{ x: -5, y: 0 }, { x: 5, y: 0 }]);
  assert.ok(layer.pointCandidates.some((item) =>
    item.pointCandidateId === "point:quadrant:circle:east" && item.point.x === 5));
});

test("证据健康状态不会把单边截图宣称为可验证前后图", () => {
  const layer = buildCadGeometryCandidateLayer({
    actions: [{
      action: "click", sourceEventIds: ["evt-one-sided"], screenshotAfter: "after.jpg"
    }]
  });

  assert.equal(layer.evidenceContracts[0].evidenceHealth.status, "single_sided");
  assert.equal(layer.evidenceContracts[0].evidenceHealth.usableForTopologyChange, false);
});

function lineEntity(entityId, x1, y1, x2, y2, overrides = {}) {
  return {
    entityId,
    semanticKind: "line",
    confidence: 0.95,
    exactGeometry: {
      id: entityId, kind: "line", points: [point(x1, y1), point(x2, y2)],
      center: null, radius: null, startAngle: null, endAngle: null,
      clockwise: null, closed: false, sourceEntityIds: [], confidence: 0.95
    },
    ...overrides
  };
}

function circleEntity(entityId, x, y, radius) {
  return {
    entityId,
    semanticKind: "circle",
    confidence: 0.96,
    exactGeometry: {
      id: entityId, kind: "circle", points: [], center: point(x, y), radius,
      startAngle: null, endAngle: null, clockwise: null,
      closed: true, sourceEntityIds: [], confidence: 0.96
    }
  };
}

function point(x, y) {
  return { x, y, snap: "none", referenceEntityIds: [], confidence: 0.95 };
}
