import test from "node:test";
import assert from "node:assert/strict";
import { materializeDeterministicCadGeometry } from "../src/analyzer/lib/cad-derived-geometry.mjs";

test("极轴阵列组在下一分段前展开为可独立引用的精确成员", () => {
  const plan = {
    cadProgram: {
      format: "autocad_command_ir",
      operations: [
        operation("c1-op-001", "line", "LINE", [
          pointArgument("start", -1, 10), pointArgument("end", 1, 10)
        ], ["c1-entity-001"]),
        operation("c1-op-002", "polar_array", "ARRAY", [
          selectionArgument(["c1-entity-001"]), pointArgument("center", 0, 0),
          numberArgument("item_count", 4, "integer"), numberArgument("fill_angle", 360)
        ], ["c1-array-001"])
      ]
    }
  };

  const result = materializeDeterministicCadGeometry(plan);
  const array = result.cadProgram.operations[1];
  assert.equal(array.resultEntityIds.length, 3);
  assert.deepEqual(array.resultEntityIds, [
    "c1-array-001-member-001", "c1-array-001-member-002", "c1-array-001-member-003"
  ]);
  assert.equal(array.resultGeometry.length, 3);
  assert.deepEqual(array.resultGeometry[0].sourceEntityIds, ["c1-entity-001"]);
  assert.ok(Math.abs(array.resultGeometry[0].points[0].x + 10) < 1e-9);
  assert.ok(Math.abs(array.resultGeometry[0].points[0].y + 1) < 1e-9);
});

function operation(id, semanticKind, command, arguments_, resultEntityIds) {
  return {
    id, semanticKind, command, arguments: arguments_, resultEntityIds, resultGeometry: [],
    visualInference: null, sourceEventIds: [], sourceScreenshots: [], confidence: 0.95
  };
}

function pointArgument(name, x, y) {
  return {
    kind: "point", name,
    point: { x, y, snap: "none", referenceEntityIds: [], confidence: 0.99 },
    number: null, text: null, selection: null
  };
}

function numberArgument(name, number, kind = "number") {
  return { kind, name, point: null, number, text: null, selection: null };
}

function selectionArgument(entityIds) {
  return {
    kind: "selection", name: "source_objects", point: null, number: null, text: null,
    selection: { mode: "entities", entityIds, firstCorner: null, secondCorner: null }
  };
}
