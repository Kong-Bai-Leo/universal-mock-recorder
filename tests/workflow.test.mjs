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
    nativeScript: {
      format: "autocad_scr",
      lines: ["_.TEST"],
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

test("已完整处理但没有新增命令的分段不会抹掉其他 SCR", () => {
  const geometry = workflow();
  const canceled = workflow();
  canceled.nativeScript = {
    format: "autocad_scr",
    lines: [],
    confidence: 0.95,
    warnings: ["本段阵列已撤销，无需追加命令。"],
    complete: true
  };

  const result = mergeWorkflows([geometry, canceled]);
  assert.equal(result.nativeScript.format, "autocad_scr");
  assert.equal(result.nativeScript.complete, true);
  assert.deepEqual(result.nativeScript.lines, ["_.TEST"]);
});

test("最终有效操作缺少关键参数时仍阻止输出不完整 SCR", () => {
  const geometry = workflow();
  const incomplete = workflow();
  incomplete.nativeScript = {
    format: "none",
    lines: [],
    confidence: 0.6,
    warnings: ["最终保留的矩形尺寸不可见。"],
    complete: false
  };

  const result = mergeWorkflows([geometry, incomplete]);
  assert.equal(result.nativeScript.format, "none");
  assert.equal(result.nativeScript.complete, false);
  assert.deepEqual(result.nativeScript.lines, []);
});

test("拒绝 complete 与 format 相互矛盾的原生脚本状态", () => {
  const invalid = workflow();
  invalid.nativeScript.complete = false;
  assert.throws(() => validateWorkflow(invalid), /不完整的 nativeScript 必须使用 none/);
});
