import test from "node:test";
import assert from "node:assert/strict";
import { buildCadEntityCatalog } from "../src/analyzer/lib/cad-context.mjs";

test("跨分段实体目录保留创建参数和稳定 ID", () => {
  const arguments_ = [{ kind: "point", name: "start", point: { x: 1, y: 2 } }];
  const result = buildCadEntityCatalog([{
    cadProgram: {
      format: "autocad_command_ir",
      operations: [{
        id: "c1-op-001",
        semanticKind: "line",
        command: "LINE",
        arguments: arguments_,
        resultEntityIds: ["c1-entity-001"],
        resultGeometry: [],
        confidence: 0.94
      }]
    }
  }]);

  assert.deepEqual(result, [{
    entityId: "c1-entity-001",
    createdByOperationId: "c1-op-001",
    semanticKind: "line",
    command: "LINE",
    arguments: arguments_,
    resultGeometry: [],
    confidence: 0.94
  }]);
});

test("TRIM 后实体目录只暴露仍然存在的结果圆弧", () => {
  const result = buildCadEntityCatalog([{
    cadProgram: {
      format: "autocad_command_ir",
      operations: [{
        id: "circle-op", semanticKind: "circle", command: "CIRCLE",
        arguments: [], resultEntityIds: ["full-circle"], resultGeometry: [], confidence: 0.95
      }, {
        id: "trim-op", semanticKind: "trim", command: "TRIM", arguments: [],
        resultEntityIds: ["arc-left", "arc-right"],
        resultGeometry: [{ id: "arc-left", kind: "arc_center" }, { id: "arc-right", kind: "arc_center" }],
        visualInference: { sourceEntityIds: ["full-circle"] }, confidence: 0.9
      }]
    }
  }]);

  assert.deepEqual(result.map((item) => item.entityId), ["arc-left", "arc-right"]);
});

test("实体目录标记完全重合线并在 FILLET 后折叠整个可见几何组", () => {
  const lineArguments = [
    pointArgument("start", 0, 0), pointArgument("end", 0, 10)
  ];
  const baseOperations = [
    lineOperation("line-original-op", "line-original", lineArguments),
    lineOperation("line-copy-op", "line-copy", lineArguments)
  ];
  const overlaps = buildCadEntityCatalog([{
    cadProgram: { format: "autocad_command_ir", operations: baseOperations }
  }]);

  assert.deepEqual(overlaps.map((item) => item.canonicalEntityId), ["line-copy", "line-copy"]);
  assert.deepEqual(overlaps[0].equivalentEntityIds, ["line-original", "line-copy"]);
  assert.equal(overlaps[0].exactOverlap, true);

  const fillet = {
    id: "fillet-op", semanticKind: "fillet", command: "FILLET", arguments: [],
    resultEntityIds: ["corner-diagonal", "corner-vertical"],
    resultGeometry: [
      lineGeometry("corner-diagonal", -5, 5, 0, 5, ["diagonal"]),
      lineGeometry("corner-vertical", 0, 5, 0, 10, ["line-copy"])
    ],
    visualInference: {
      sourceEntityIds: ["diagonal", "line-copy"], referenceEntityIds: []
    },
    confidence: 0.9
  };
  const result = buildCadEntityCatalog([{
    cadProgram: {
      format: "autocad_command_ir",
      operations: [
        ...baseOperations,
        lineOperation("diagonal-op", "diagonal", [
          pointArgument("start", -5, 5), pointArgument("end", 5, 5)
        ]),
        fillet
      ]
    }
  }]);

  assert.deepEqual(result.map((item) => item.entityId), ["corner-diagonal", "corner-vertical"]);
});

function lineOperation(id, entityId, arguments_) {
  return {
    id, semanticKind: "line", command: "LINE", arguments: arguments_,
    resultEntityIds: [entityId], resultGeometry: [], confidence: 0.95
  };
}

function pointArgument(name, x, y) {
  return {
    kind: "point", name,
    point: { x, y, snap: "none", referenceEntityIds: [], confidence: 0.95 }
  };
}

function lineGeometry(id, x1, y1, x2, y2, sourceEntityIds) {
  return {
    id, kind: "line",
    points: [
      { x: x1, y: y1, snap: "none", referenceEntityIds: [], confidence: 0.9 },
      { x: x2, y: y2, snap: "none", referenceEntityIds: [], confidence: 0.9 }
    ],
    center: null, radius: null, startAngle: null, endAngle: null,
    clockwise: null, closed: false, sourceEntityIds, confidence: 0.9
  };
}
