import test from "node:test";
import assert from "node:assert/strict";
import { mergeWorkflows, validateWorkflow } from "../src/analyzer/lib/workflow.mjs";

let workflowSequence = 0;

function workflow(stepOverrides = {}) {
  const sequence = ++workflowSequence;
  return {
    summary: "测试流程",
    steps: [{
      id: "temporary",
      goal: "点击测试按钮",
      action: "click",
      target: {
        semanticFunction: "confirm",
        role: "button",
        textCandidates: ["确定"],
        visualDescription: null,
        expectedRegion: null,
        relativePositionFallback: null
      },
      gesture: null,
      value: null,
      expectedState: {
        visibleTextCandidates: [],
        visualDescription: null,
        stateChange: "对话框关闭"
      },
      canvasChange: {
        detected: false,
        changeType: "none",
        objectDescription: null,
        beforeScreenshot: null,
        afterScreenshot: null,
        changedRegionRelative: null,
        measurements: []
      },
      sourceEventIds: ["evt-1"],
      confidence: 0.9,
      ...stepOverrides
    }],
    omitted: [],
    cadProgram: {
      format: "autocad_command_ir",
      operations: [cadOperation("TEST", sequence)],
      confidence: 0.9,
      warnings: [],
      complete: true
    },
    warnings: []
  };
}

test("验证工作流并规范步骤编号", () => {
  const result = validateWorkflow(workflow());
  assert.equal(result.steps[0].id, "step-001");
});

test("合并分段并标记低置信度", () => {
  const result = mergeWorkflows([workflow(), workflow({ confidence: 0.4 })], {
    minimumConfidence: 0.65
  });
  assert.deepEqual(result.steps.map((step) => step.id), ["step-001", "step-002"]);
  assert.match(result.warnings.at(-1), /低于最低置信度/);
});

test("拒绝不受支持的动作", () => {
  assert.throws(() => validateWorkflow(workflow({ action: "launch_missiles" })), /不受支持/);
});

test("已完整处理但没有新增命令的分段不会抹掉其他 CAD 操作", () => {
  const geometry = workflow();
  const canceled = workflow();
  canceled.cadProgram = {
    format: "autocad_command_ir",
    operations: [],
    confidence: 0.95,
    warnings: ["本段阵列已撤销，无需追加命令。"],
    complete: true
  };

  const result = mergeWorkflows([geometry, canceled]);
  assert.equal(result.cadProgram.format, "autocad_command_ir");
  assert.equal(result.cadProgram.complete, true);
  assert.deepEqual(result.cadProgram.operations.map((operation) => operation.command), ["TEST"]);
});

test("最终有效操作部分缺失时保留已经确认的 CAD 操作", () => {
  const geometry = workflow();
  const incomplete = workflow();
  incomplete.cadProgram = {
    format: "autocad_command_ir",
    operations: [cadOperation("PARTIAL", ++workflowSequence)],
    confidence: 0.6,
    warnings: ["最终保留的矩形尺寸不可见。"],
    complete: false
  };

  const result = mergeWorkflows([geometry, incomplete]);
  assert.equal(result.cadProgram.format, "autocad_command_ir");
  assert.equal(result.cadProgram.complete, false);
  assert.deepEqual(result.cadProgram.operations.map((operation) => operation.command), ["TEST", "PARTIAL"]);
});

test("允许部分 CAD 操作使用 complete=false", () => {
  const invalid = workflow();
  invalid.cadProgram.complete = false;
  assert.equal(validateWorkflow(invalid).cadProgram.complete, false);
});

test("跨分段命令状态必须携带规范命令和待填参数", () => {
  const invalid = workflow();
  invalid.commandState = {
    status: "deferred",
    activeCommand: null,
    stage: "array_parameters",
    pendingParameter: "item_count",
    visiblePrompt: "Enter number of items",
    lastCompletedCommand: null,
    evidenceEventIds: ["evt-array-items"],
    confidence: 0.9
  };
  assert.throws(() => validateWorkflow(invalid), /活跃时缺少 activeCommand/);

  const valid = workflow();
  valid.commandState = {
    status: "deferred",
    activeCommand: "ARRAY",
    stage: "array_parameters",
    pendingParameter: "item_count",
    visiblePrompt: "Enter number of items",
    lastCompletedCommand: null,
    evidenceEventIds: ["evt-array-items"],
    confidence: 0.9
  };
  assert.equal(validateWorkflow(valid).commandState.activeCommand, "ARRAY");
  assert.equal(validateWorkflow(valid).commandState.pendingParameter, "item_count");
});

test("合并分段时保留最后一个命令状态", () => {
  const first = workflow();
  first.commandState = {
    status: "deferred",
    activeCommand: "ARRAY",
    stage: "array_parameters",
    pendingParameter: "item_count",
    visiblePrompt: "Enter number of items",
    lastCompletedCommand: null,
    evidenceEventIds: ["evt-array-items"],
    confidence: 0.88
  };
  const second = workflow();
  second.commandState = {
    status: "idle",
    activeCommand: null,
    stage: null,
    pendingParameter: null,
    visiblePrompt: null,
    lastCompletedCommand: "ARRAY",
    evidenceEventIds: ["evt-array-complete"],
    confidence: 0.96
  };

  const result = mergeWorkflows([first, second]);
  assert.equal(result.commandState.status, "idle");
  assert.equal(result.commandState.lastCompletedCommand, "ARRAY");
});

test("拒绝不适用的 CAD 程序标记为完整", () => {
  const invalid = workflow();
  invalid.cadProgram = { format: "none", operations: [], confidence: 0, warnings: [], complete: true };
  assert.throws(() => validateWorkflow(invalid), /必须使用 autocad_command_ir/);
});

test("允许用成对截图和最终几何表达 OFFSET", () => {
  const valid = workflow();
  valid.cadProgram.operations = [{
    ...cadOperation("OFFSET", ++workflowSequence),
    semanticKind: "offset",
    arguments: [{
      kind: "number", name: "distance", point: null, number: 5, text: null, selection: null
    }],
    resultEntityIds: ["offset-line"],
    resultGeometry: [{
      id: "offset-line", kind: "line",
      points: [cadPoint(0, 5), cadPoint(10, 5)], center: null, radius: null, closed: false,
      sourceEntityIds: ["source-line"], confidence: 0.95
    }],
    visualInference: {
      method: "combined", beforeScreenshot: "before.jpg", afterScreenshot: "after.jpg",
      changedRegionRelative: [0.1, 0.1, 0.5, 0.5],
      sourceEntityIds: ["source-line"], referenceEntityIds: [], side: "left", confidence: 0.95
    },
    sourceScreenshots: ["before.jpg", "after.jpg"]
  }];
  assert.equal(validateWorkflow(valid).cadProgram.operations[0].semanticKind, "offset");
});

test("拒绝只有模糊点击而没有最终几何的 TRIM", () => {
  const invalid = workflow();
  invalid.cadProgram.operations = [{
    ...cadOperation("TRIM", ++workflowSequence),
    semanticKind: "trim",
    visualInference: {
      method: "before_after_diff", beforeScreenshot: "before.jpg", afterScreenshot: "after.jpg",
      changedRegionRelative: [0.1, 0.1, 0.5, 0.5],
      sourceEntityIds: ["source-line"], referenceEntityIds: ["cutter-line"],
      side: "unknown", confidence: 0.7
    },
    sourceScreenshots: ["before.jpg", "after.jpg"]
  }];
  assert.throws(() => validateWorkflow(invalid), /TRIM 缺少可验证的最终几何/);
});

test("严格实体追踪拒绝跨分段凭空恢复的幽灵实体", () => {
  const invalid = workflow();
  invalid.cadProgram.operations = [{
    ...cadOperation("OFFSET", ++workflowSequence),
    semanticKind: "offset",
    arguments: [{
      kind: "number", name: "distance", point: null, number: 10, text: null, selection: null
    }, {
      kind: "selection", name: "source", point: null, number: null, text: null,
      selection: { mode: "entities", entityIds: ["ghost-entity"], firstCorner: null, secondCorner: null }
    }],
    resultEntityIds: ["new-line"],
    resultGeometry: [{
      id: "new-line", kind: "line", points: [cadPoint(0, 0), cadPoint(0, 10)],
      center: null, radius: null, closed: false, sourceEntityIds: ["ghost-entity"], confidence: 0.9
    }],
    visualInference: {
      method: "combined", beforeScreenshot: "before.jpg", afterScreenshot: "after.jpg",
      changedRegionRelative: null, sourceEntityIds: ["ghost-entity"], referenceEntityIds: [],
      side: "left", confidence: 0.9
    },
    sourceScreenshots: ["before.jpg", "after.jpg"]
  }];
  assert.throws(() => validateWorkflow(invalid, { validateCadReferences: true }),
    /尚未由此前 operation 生成的实体 ghost-entity/);
  assert.equal(validateWorkflow(invalid, {
    validateCadReferences: true,
    knownCadEntityIds: ["ghost-entity"]
  }).cadProgram.operations.length, 1);
});

test("严格实体追踪拒绝连续 TRIM 再次引用已被替换的完整圆", () => {
  const invalid = workflow();
  const circle = cadOperation("CIRCLE", ++workflowSequence);
  circle.semanticKind = "circle";
  circle.resultEntityIds = ["full-circle"];
  invalid.cadProgram.operations = [
    circle,
    trimArcOperation("trim-first", "full-circle", "arc-first", 0, 180),
    trimArcOperation("trim-second", "full-circle", "arc-second", 180, 360)
  ];

  assert.throws(() => validateWorkflow(invalid, { validateCadReferences: true }),
    /已经被此前 TRIM 替换的实体 full-circle/);
});

function cadOperation(command, sequence) {
  return {
    id: `c${sequence}-op-${command.toLowerCase()}`,
    semanticKind: "command",
    command,
    arguments: [],
    resultEntityIds: [],
    resultGeometry: [],
    visualInference: {
      method: "none",
      beforeScreenshot: null,
      afterScreenshot: null,
      changedRegionRelative: null,
      sourceEntityIds: [],
      referenceEntityIds: [],
      side: "none",
      confidence: 1
    },
    sourceEventIds: ["evt-1"],
    sourceScreenshots: [],
    confidence: 0.9
  };
}

function cadPoint(x, y) {
  return { x, y, snap: "none", referenceEntityIds: [], confidence: 0.95 };
}

function trimArcOperation(id, sourceId, resultId, startAngle, endAngle) {
  return {
    ...cadOperation("TRIM", ++workflowSequence),
    id,
    semanticKind: "trim",
    arguments: [{
      kind: "selection", name: "source", point: null, number: null, text: null,
      selection: { mode: "entities", entityIds: [sourceId], firstCorner: null, secondCorner: null }
    }],
    resultEntityIds: [resultId],
    resultGeometry: [{
      id: resultId, kind: "arc_center", points: [], center: cadPoint(0, 0), radius: 10,
      startAngle, endAngle, clockwise: false, closed: false,
      sourceEntityIds: [sourceId], confidence: 0.9
    }],
    visualInference: {
      method: "combined", beforeScreenshot: `${id}-before.jpg`, afterScreenshot: `${id}-after.jpg`,
      changedRegionRelative: null, sourceEntityIds: [sourceId], referenceEntityIds: [],
      side: "unknown", confidence: 0.9
    },
    sourceScreenshots: [`${id}-before.jpg`, `${id}-after.jpg`]
  };
}
