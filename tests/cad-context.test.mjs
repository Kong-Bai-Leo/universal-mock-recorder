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
