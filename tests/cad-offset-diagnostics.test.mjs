import assert from "node:assert/strict";
import test from "node:test";
import { buildSuspiciousOffsetOverlaps } from "../src/analyzer/lib/cad-offset-diagnostics.mjs";

test("OFFSET 结果与旧线重合时提供另一侧精确候选", () => {
  const source = line("source", 0, 0, 0, 20);
  const existing = line("existing", -10, 0, -10, 20);
  const offset = line("offset", -10, 0, -10, 20, ["source"]);
  const cadProgram = {
    operations: [
      operation("source-op", "LINE", [], [source]),
      operation("existing-op", "LINE", [], [existing]),
      operation("offset-op", "OFFSET", [
        { kind: "number", name: "offset_distance", number: 10 },
        { kind: "selection", name: "source_entities", selection: { mode: "entities", entityIds: ["source"] } },
        { kind: "keyword", name: "side", text: "left" }
      ], [offset], {
        beforeScreenshot: "screenshots/before.jpg",
        afterScreenshot: "screenshots/after.jpg"
      })
    ]
  };
  const activeCadEntityCatalog = [
    overlapEntry("existing", ["existing", "offset"], existing),
    overlapEntry("offset", ["existing", "offset"], offset)
  ];

  const result = buildSuspiciousOffsetOverlaps({ cadProgram, activeCadEntityCatalog });
  assert.equal(result.suspiciousOverlaps.length, 1);
  const diagnostic = result.suspiciousOverlaps[0];
  assert.equal(diagnostic.currentSide, "left");
  assert.deepEqual(diagnostic.exactOverlap.otherEntityIds, ["existing"]);
  assert.equal(diagnostic.alternativeResultCandidates[0].side, "right");
  assert.deepEqual(diagnostic.alternativeResultCandidates[0].geometry.points, [
    { x: 10, y: 0 }, { x: 10, y: 20 }
  ]);
});

test("没有可见重合组的 OFFSET 不产生误报", () => {
  const source = line("source", 0, 0, 0, 20);
  const offset = line("offset", 10, 0, 10, 20, ["source"]);
  const cadProgram = { operations: [
    operation("source-op", "LINE", [], [source]),
    operation("offset-op", "OFFSET", [
      { kind: "number", name: "offset_distance", number: 10 },
      { kind: "selection", name: "source_entities", selection: { mode: "entities", entityIds: ["source"] } }
    ], [offset])
  ] };
  const result = buildSuspiciousOffsetOverlaps({ cadProgram, activeCadEntityCatalog: [] });
  assert.equal(result.suspiciousOverlaps.length, 0);
});

function operation(id, command, args, geometry, visualInference = null) {
  return {
    id,
    command,
    arguments: args,
    resultEntityIds: geometry.map((item) => item.id),
    resultGeometry: geometry,
    visualInference,
    sourceEventIds: [],
    sourceScreenshots: []
  };
}

function line(id, x1, y1, x2, y2, sourceEntityIds = []) {
  return {
    id,
    kind: "line",
    points: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
    sourceEntityIds,
    confidence: 0.99
  };
}

function overlapEntry(entityId, equivalentEntityIds, exactGeometry) {
  return {
    entityId,
    canonicalEntityId: "offset",
    equivalentEntityIds,
    exactOverlap: true,
    exactGeometry,
    confidence: 0.99
  };
}
