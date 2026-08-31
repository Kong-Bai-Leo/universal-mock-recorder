import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAuditedCadProgram } from "../src/analyzer/lib/cad-program-normalizer.mjs";

test("最终审计操作按实体依赖和录制事件恢复顺序", () => {
  const producer = operation("c6-op-001", "LINE", "line", [], ["source"], [], 100);
  const consumer = operation("c5-op-002", "OFFSET", "offset", ["source"], ["offset"], [
    lineGeometry("offset", "source")
  ], 200);
  const result = normalizeAuditedCadProgram(program([consumer, producer]));

  assert.deepEqual(result.program.operations.map((item) => item.id), ["c6-op-001", "c5-op-002"]);
  assert.equal(result.changed, true);
});

test("后续操作引用已替换实体时沿唯一血缘改用新实体", () => {
  const producer = operation("c1-op-001", "LINE", "line", [], ["source"], [], 100);
  const firstFillet = operation("c2-op-001", "FILLET", "fillet", ["source"], ["fillet-line"], [
    lineGeometry("fillet-line", "source")
  ], 200);
  const secondFillet = operation("c3-op-001", "FILLET", "fillet", ["source"], ["final-line"], [
    lineGeometry("final-line", "source")
  ], 300);
  const result = normalizeAuditedCadProgram(program([producer, firstFillet, secondFillet]));
  const repaired = result.program.operations[2];

  assert.deepEqual(repaired.arguments[0].selection.entityIds, ["fillet-line"]);
  assert.deepEqual(repaired.visualInference.sourceEntityIds, ["fillet-line"]);
  assert.deepEqual(repaired.resultGeometry[0].sourceEntityIds, ["fillet-line"]);
  assert.match(result.findings.join("；"), /source->fillet-line/);
});

test("一个旧实体产生多个后继时不猜测后续应引用哪一个", () => {
  const producer = operation("c1-op-001", "CIRCLE", "circle", [], ["circle"], [], 100);
  const trim = operation("c2-op-001", "TRIM", "trim", ["circle"], ["arc-a", "arc-b"], [
    lineGeometry("arc-a", "circle"), lineGeometry("arc-b", "circle")
  ], 200);
  const later = operation("c3-op-001", "MOVE", "other", ["circle"], ["moved"], [
    lineGeometry("moved", "circle")
  ], 300);
  const result = normalizeAuditedCadProgram(program([producer, trim, later]));

  assert.deepEqual(result.program.operations[2].arguments[0].selection.entityIds, ["circle"]);
  assert.equal(result.findings.some((item) => /circle->/.test(item)), false);
});

function program(operations) {
  return {
    format: "autocad_command_ir", operations, confidence: 0.9, warnings: [], complete: true
  };
}

function operation(id, command, semanticKind, sourceIds, resultEntityIds, resultGeometry, eventNumber) {
  return {
    id, command, semanticKind,
    arguments: sourceIds.length > 0 ? [{
      kind: "selection", name: "objects", point: null, number: null, text: null,
      selection: { mode: "entities", entityIds: sourceIds, firstCorner: null, secondCorner: null }
    }] : [],
    resultEntityIds,
    resultGeometry,
    visualInference: {
      method: sourceIds.length > 0 ? "combined" : "none",
      beforeScreenshot: sourceIds.length > 0 ? `evt-${eventNumber}-before.jpg` : null,
      afterScreenshot: sourceIds.length > 0 ? `evt-${eventNumber}-after.jpg` : null,
      changedRegionRelative: null, sourceEntityIds: sourceIds,
      referenceEntityIds: [], side: "unknown", confidence: 0.9
    },
    sourceEventIds: [`evt-${String(eventNumber).padStart(8, "0")}`],
    sourceScreenshots: [], confidence: 0.9
  };
}

function lineGeometry(id, sourceId) {
  return {
    id, kind: "line",
    points: [point(0, 0), point(0, 10)], center: null, radius: null,
    startAngle: null, endAngle: null, clockwise: null, closed: false,
    sourceEntityIds: [sourceId], confidence: 0.9
  };
}

function point(x, y) {
  return { x, y, snap: "none", referenceEntityIds: [], confidence: 0.9 };
}
