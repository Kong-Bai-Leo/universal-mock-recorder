import test from "node:test";
import assert from "node:assert/strict";
import { mergeWorkflows, validateWorkflow } from "../src/analyzer/lib/workflow.mjs";

function workflow(stepOverrides = {}) {
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
