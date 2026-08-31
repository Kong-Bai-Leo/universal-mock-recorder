import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  annotatePersistentCanvasBaselines,
  buildCandidateActions,
  chunkActions,
  makeAnalysisBundle
} from "../src/analyzer/lib/trace.mjs";
import { renderTypeScript } from "../src/analyzer/lib/script-renderer.mjs";
import { renderComputerUseTask } from "../src/analyzer/lib/computer-use-renderer.mjs";
import { renderAutoCadScr } from "../src/analyzer/lib/autocad-scr-renderer.mjs";
import {
  findFinalScreenshot,
  inferTopologyActionContexts,
  selectFinalCadAuditFiles,
  shouldRunFinalCadAudit
} from "../src/analyzer/lib/final-cad-audit.mjs";

test("组合单击并忽略纯鼠标移动", () => {
  const actions = buildCandidateActions([
    { id: "1", eventType: "mouse_move", timestampMs: 1, x: 1, y: 1 },
    { id: "2", eventType: "mouse_down", timestampMs: 10, x: 100, y: 100, button: "left" },
    { id: "3", eventType: "mouse_up", timestampMs: 50, x: 101, y: 100, button: "left" }
  ]);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].action, "click");
});

test("识别拖拽", () => {
  const actions = buildCandidateActions([
    { id: "1", eventType: "mouse_down", timestampMs: 10, x: 10, y: 20, relativeX: 0.1, relativeY: 0.2, button: "left", modifiers: ["SHIFT"], screenshotBefore: "screenshots/before.jpg" },
    { id: "m", eventType: "mouse_move", timestampMs: 250, x: 50, y: 80 },
    { id: "2", eventType: "mouse_up", timestampMs: 500, x: 100, y: 200, relativeX: 0.8, relativeY: 0.9, button: "left", screenshotAfter: "screenshots/after.jpg", visualChange: { changed: true, relativeBounds: [0.1, 0.2, 0.7, 0.7] } }
  ]);
  assert.equal(actions[0].action, "drag");
  assert.equal(actions[0].button, "left");
  assert.deepEqual(actions[0].modifiers, ["SHIFT"]);
  assert.deepEqual(actions[0].to, { x: 100, y: 200, relativeX: 0.8, relativeY: 0.9 });
  assert.equal(actions[0].path.length, 3);
  assert.equal(actions[0].screenshotBefore, "screenshots/before.jpg");
  assert.equal(actions[0].screenshotAfter, "screenshots/after.jpg");
  assert.equal(actions[0].visualChange.changed, true);
});

test("最终 CAD 审计保留录制终态并均匀覆盖 TRIM 前后证据", () => {
  const trimActions = Array.from({ length: 9 }, (_, index) => ({
    action: "click",
    resolvedCadCommandContext: "TRIM",
    screenshotBefore: `screenshots/trim-${index}-before.jpg`,
    screenshotAfter: `screenshots/trim-${index}-after.jpg`,
    sourceEventIds: [`evt-${index}`]
  }));
  const plan = { cadProgram: { format: "autocad_command_ir" } };
  assert.equal(shouldRunFinalCadAudit(plan, trimActions), true);
  const files = selectFinalCadAuditFiles(trimActions, "screenshots/final.jpg", 7);
  assert.equal(files[0], "screenshots/final.jpg");
  assert.equal(files.length, 7);
  assert.ok(files.includes("screenshots/trim-0-before.jpg"));
  assert.ok(files.includes("screenshots/trim-8-after.jpg"));
});

test("无 UIA 时最终审计用分段 commandState 恢复 TRIM 点击上下文", () => {
  const ribbon = {
    action: "click", at: { relativeY: 0.06 }, target: null,
    screenshotBefore: "ribbon-before.jpg", screenshotAfter: "ribbon-after.jpg",
    sourceEventIds: ["evt-ribbon"]
  };
  const trimClick = {
    action: "click", at: { relativeY: 0.4 }, target: null,
    screenshotBefore: "trim-before.jpg", screenshotAfter: "trim-after.jpg",
    sourceEventIds: ["evt-trim"]
  };
  const state = {
    status: "active", activeCommand: "TRIM", lastCompletedCommand: "ARRAY",
    evidenceEventIds: ["evt-trim"]
  };
  const actions = inferTopologyActionContexts(
    [ribbon, trimClick], [{ actions: [ribbon, trimClick], commandState: state }],
    { commandState: state });

  assert.equal(actions[0].inferredCadCommandContext, undefined);
  assert.equal(actions[1].inferredCadCommandContext, "TRIM");
  assert.equal(shouldRunFinalCadAudit({
    cadProgram: { format: "autocad_command_ir" }, commandState: state
  }, actions), true);
});

test("最终审计用 semantic step 覆盖事件中滞后的 OFFSET 上下文", () => {
  const filletClick = {
    action: "click", at: { relativeY: 0.45 }, target: null,
    visualCommandContext: "OFFSET", cadCommandContext: "OFFSET",
    screenshotBefore: "fillet-before.jpg", screenshotAfter: "fillet-after.jpg",
    sourceEventIds: ["evt-fillet"]
  };
  const plan = {
    steps: [{
      id: "step-fillet", goal: "完成第一组 FILLET 尖角连接",
      target: { semanticFunction: "select_second_fillet_object", textCandidates: [] },
      expectedState: { visibleTextCandidates: [], visualDescription: null, stateChange: "完成 FILLET" },
      canvasChange: { objectDescription: "两条线连接" }, sourceEventIds: ["evt-fillet"]
    }]
  };

  const [result] = inferTopologyActionContexts([filletClick], [], plan);
  assert.equal(result.auditCadCommandContext, "FILLET");
  assert.equal(result.semanticPlanEvidence.stepId, "step-fillet");
});

test("最终审计优先选择最后一张 AutoCAD 主窗口截图", async () => {
  const recordingDir = await fs.mkdtemp(path.join(os.tmpdir(), "final-cad-shot-"));
  const screenshotDir = path.join(recordingDir, "screenshots");
  await fs.mkdir(screenshotDir);
  await Promise.all([
    fs.writeFile(path.join(screenshotDir, "evt-00000100-after.jpg"), "cad"),
    fs.writeFile(path.join(screenshotDir, "evt-00000101.jpg"), "taskbar")
  ]);
  try {
    const result = await findFinalScreenshot(recordingDir, [{
      action: "press_key", endMs: 100,
      window: { processName: "acad", title: "Autodesk AutoCAD", width: 1900, height: 1000 },
      screenshotAfter: "screenshots/evt-00000100-after.jpg"
    }, {
      action: "click", endMs: 110,
      window: { processName: "explorer", title: "", width: 1900, height: 40 },
      screenshotAfter: "screenshots/evt-00000101.jpg"
    }]);
    assert.equal(result, "screenshots/evt-00000100-after.jpg");
  } finally {
    await fs.rm(recordingDir, { recursive: true, force: true });
  }
});

test("修改命令保留选择中间态与录制时命令上下文", () => {
  const window = { width: 1000, height: 800 };
  const canvas = { role: "ControlType.Pane", width: 800, height: 600 };
  const actions = buildCandidateActions([
    {
      id: "down", eventType: "mouse_down", timestampMs: 10, x: 300, y: 240,
      button: "left", target: canvas, window, screenshotBefore: "trim-before.jpg",
      visualCommandContext: "TRIM"
    },
    {
      id: "up", eventType: "mouse_up", timestampMs: 100, x: 300, y: 240,
      button: "left", target: canvas, window, screenshotSelection: "trim-selection.jpg",
      screenshotAfter: "trim-after.jpg", visualCommandContext: "TRIM",
      visualChange: { changed: true }
    }
  ]);
  assert.equal(actions[0].visualCommandContext, "TRIM");
  assert.equal(actions[0].screenshotSelection, "trim-selection.jpg");
  assert.deepEqual(makeAnalysisBundle(".", actions, 3).screenshots,
    ["trim-before.jpg", "trim-selection.jpg", "trim-after.jpg"]);
});

test("OFFSET 首个已提交数值被标注为精确距离参数", () => {
  const events = [
    { id: "o", eventType: "key_down", timestampMs: 10, key: "O", text: "o" },
    { id: "f", eventType: "key_down", timestampMs: 20, key: "F", text: "f" },
    {
      id: "command-enter", eventType: "key_down", timestampMs: 30, key: "ENTER", text: "",
      visualCommandContext: "OFFSET", target: { name: "OFFSET" }
    },
    { id: "one", eventType: "key_down", timestampMs: 40, key: "D1", text: "1", visualCommandContext: "OFFSET" },
    { id: "zero", eventType: "key_down", timestampMs: 50, key: "D0", text: "0", visualCommandContext: "OFFSET" },
    {
      id: "distance-enter", eventType: "key_down", timestampMs: 60, key: "ENTER", text: "",
      visualCommandContext: "OFFSET", target: { name: "10" }
    }
  ];
  const actions = buildCandidateActions(events);
  const distance = actions.find((action) => action.action === "type_text" && action.text === "10");
  assert.deepEqual(distance.cadInputEvidence, {
    command: "OFFSET",
    parameterName: "distance",
    value: 10,
    unit: "cad_drawing_unit",
    exact: true,
    valueExact: true,
    parameterRoleExact: true,
    source: "keyboard_committed",
    sourceEventIds: ["one", "zero", "distance-enter"]
  });
});

test("连续字符合并为文本输入", () => {
  const actions = buildCandidateActions([
    { id: "1", eventType: "key_down", timestampMs: 10, key: "A", text: "a", modifiers: [] },
    { id: "2", eventType: "key_down", timestampMs: 20, key: "B", text: "b", modifiers: [] },
    { id: "3", eventType: "key_down", timestampMs: 30, key: "ENTER", text: "", modifiers: [] }
  ]);
  assert.equal(actions[0].action, "type_text");
  assert.equal(actions[0].text, "ab");
  assert.equal(actions[1].action, "press_key");
});

test("Windows RETURN 被规范为独立 ENTER 动作", () => {
  const actions = buildCandidateActions([
    { id: "t", eventType: "key_down", timestampMs: 10, key: "A", text: "a", modifiers: [] },
    { id: "r", eventType: "key_down", timestampMs: 20, key: "RETURN", text: "\r", modifiers: [], screenshotAfter: "screenshots/return-after.jpg" }
  ]);
  assert.deepEqual(actions.map((action) => action.action), ["type_text", "press_key"]);
  assert.equal(actions[1].key, "ENTER");
  assert.equal(actions[1].screenshotAfter, "screenshots/return-after.jpg");
});

test("双击保留为一个动作", () => {
  const actions = buildCandidateActions([
    { id: "1d", eventType: "mouse_down", timestampMs: 10, x: 30, y: 40, button: "left" },
    { id: "1u", eventType: "mouse_up", timestampMs: 30, x: 30, y: 40, button: "left" },
    { id: "2d", eventType: "mouse_down", timestampMs: 100, x: 30, y: 40, button: "left" },
    { id: "2u", eventType: "mouse_up", timestampMs: 120, x: 30, y: 40, button: "left" }
  ]);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].action, "double_click");
  assert.deepEqual(actions[0].sourceEventIds, ["1d", "1u", "2d", "2u"]);
});

test("有中间动作的两次点击不会误合并", () => {
  const actions = buildCandidateActions([
    { id: "1d", eventType: "mouse_down", timestampMs: 10, x: 30, y: 40, button: "left" },
    { id: "1u", eventType: "mouse_up", timestampMs: 30, x: 30, y: 40, button: "left" },
    { id: "enter", eventType: "key_down", timestampMs: 60, key: "ENTER", text: "", modifiers: [] },
    { id: "2d", eventType: "mouse_down", timestampMs: 100, x: 30, y: 40, button: "left" },
    { id: "2u", eventType: "mouse_up", timestampMs: 120, x: 30, y: 40, button: "left" }
  ]);
  assert.deepEqual(actions.map((action) => action.action), ["click", "press_key", "click"]);
});

test("纯修饰键不会成为独立动作", () => {
  const actions = buildCandidateActions([
    { id: "ctrl", eventType: "key_down", timestampMs: 10, key: "CONTROLKEY", text: null, modifiers: ["CTRL"] },
    { id: "c", eventType: "key_down", timestampMs: 20, key: "C", text: null, modifiers: ["CTRL"] }
  ]);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].key, "C");
  assert.deepEqual(actions[0].modifiers, ["CTRL"]);
});

test("长流程截图均匀覆盖开头和结尾", () => {
  const actions = Array.from({ length: 5 }, (_, index) => ({
    screenshotBefore: `screenshots/${index}-before.jpg`,
    screenshotAfter: `screenshots/${index}-after.jpg`
  }));
  const bundle = makeAnalysisBundle(".", actions, 3);
  assert.deepEqual(bundle.screenshots, [
    "screenshots/0-before.jpg",
    "screenshots/2-after.jpg",
    "screenshots/4-after.jpg"
  ]);
  assert.deepEqual(chunkActions(actions, 2).map((chunk) => chunk.length), [2, 2, 1]);
});

test("生成脚本包含语义优先定位策略", () => {
  const script = renderTypeScript({ summary: "test", steps: [] }, "@test/mock");
  assert.match(script, /semantic/);
  assert.match(script, /preferStructuredCadProgram: true/);
  assert.match(script, /verifyAfterEachStep: true/);
  assert.match(script, /@test\/mock/);
  assert.match(script, /export const workflow/);
});

test("生成 Computer Use Agent 任务说明", () => {
  const task = renderComputerUseTask({ summary: "画一个圆", steps: [] });
  assert.match(task, /Computer Use Agent/);
  assert.match(task, /canvasChange/);
  assert.match(task, /cad-program\.json/);
  assert.match(task, /画一个圆/);
});

test("截图名额优先保留画布取点时的业务数值画面", () => {
  const window = { width: 1000, height: 800 };
  const canvas = { role: "ControlType.Pane", width: 800, height: 600 };
  const actions = [
    { action: "press_key", screenshotBefore: "start.jpg", screenshotAfter: "command.jpg" },
    { action: "click", target: canvas, window, screenshotBefore: "center-value.jpg", screenshotAfter: "center-after.jpg" },
    { action: "press_key", screenshotBefore: "middle.jpg", screenshotAfter: "middle-after.jpg" },
    { action: "click", target: canvas, window, screenshotBefore: "radius-value.jpg", screenshotAfter: "radius-after.jpg" },
    { action: "press_key", screenshotAfter: "final.jpg" }
  ];
  const screenshots = makeAnalysisBundle(".", actions, 4).screenshots;
  assert.deepEqual(screenshots, [
    "start.jpg", "center-value.jpg", "radius-value.jpg", "final.jpg"
  ]);
});

test("本地检测到画布变化时成对保留操作前后截图", () => {
  const window = { width: 1000, height: 800 };
  const canvas = { role: "ControlType.Pane", width: 800, height: 600 };
  const actions = [
    {
      action: "click", target: canvas, window,
      screenshotBefore: "offset-before.jpg", screenshotAfter: "offset-after.jpg",
      visualChange: { changed: true, relativeBounds: [0.2, 0.2, 0.4, 0.4] }
    },
    { action: "press_key", screenshotBefore: "middle.jpg", screenshotAfter: "middle-after.jpg" },
    {
      action: "click", target: canvas, window,
      screenshotBefore: "trim-before.jpg", screenshotAfter: "trim-after.jpg",
      visualChange: { changed: true, relativeBounds: [0.4, 0.4, 0.2, 0.2] }
    }
  ];
  assert.deepEqual(makeAnalysisBundle(".", actions, 4).screenshots, [
    "offset-before.jpg", "offset-after.jpg", "trim-before.jpg", "trim-after.jpg"
  ]);
});

test("关闭 UI Automation 后仍按鼠标位置保留画布前后证据", () => {
  const actions = [
    { action: "press_key", screenshotBefore: "unrelated-before.jpg", screenshotAfter: "unrelated-after.jpg" },
    {
      action: "click",
      target: null,
      window: { x: 0, y: 0, width: 1000, height: 800 },
      at: { x: 500, y: 400, relativeX: 0.5, relativeY: 0.5 },
      visualComparisonContext: "TRIM",
      screenshotBefore: "visual-only-before.jpg",
      screenshotAfter: "visual-only-after.jpg",
      visualChange: { changed: true }
    }
  ];
  assert.deepEqual(makeAnalysisBundle(".", actions, 2).screenshots, [
    "visual-only-before.jpg",
    "visual-only-after.jpg"
  ]);
});

test("变化截图对按两个证据名额参与自动分段", () => {
  const window = { width: 1000, height: 800 };
  const canvas = { role: "ControlType.Pane", width: 800, height: 600 };
  const trimButton = {
    role: "ControlType.Button", name: "Trim", width: 40, height: 40,
    ancestors: [{ name: "Modify", automationId: "ID_PanelModify" }]
  };
  const actions = [{
    action: "click", target: trimButton, window,
    screenshotBefore: "trim-command-before.jpg", screenshotAfter: "trim-command-after.jpg",
    visualChange: { changed: true }
  }, ...Array.from({ length: 3 }, (_, index) => ({
    action: "click", target: canvas, window,
    screenshotBefore: `change-${index}-before.jpg`,
    screenshotAfter: `change-${index}-after.jpg`,
    visualChange: { changed: true }
  }))];
  const chunks = chunkActions(actions, 150, { maxCanvasEvidence: 4 });
  assert.deepEqual(chunks.map((chunk) => chunk.length), [3, 1]);
  assert.deepEqual(makeAnalysisBundle(".", chunks[1], 2).screenshots,
    ["change-2-before.jpg", "change-2-after.jpg"]);
});

test("跨分段边界优先保留最近一次操作的截图对", () => {
  const window = { width: 1000, height: 800 };
  const canvas = { role: "ControlType.Pane", width: 800, height: 600 };
  const actions = ["old", "new"].map((name) => ({
    action: "click", target: canvas, window, visualComparisonContext: "OFFSET",
    screenshotBefore: `${name}-before.jpg`, screenshotAfter: `${name}-after.jpg`,
    visualChange: { changed: true }
  }));
  assert.deepEqual(makeAnalysisBundle(".", actions, 2, { preferRecent: true }).screenshots,
    ["new-before.jpg", "new-after.jpg"]);
});

test("连续修改动作携带前一稳定画布作为持久状态基线", () => {
  const window = { width: 1000, height: 800 };
  const canvas = { role: "ControlType.Pane", width: 800, height: 600 };
  const actions = [{
    action: "click", target: canvas, window, startMs: 10, endMs: 20,
    sourceEventIds: ["first-down", "first-up"], visualComparisonContext: "TRIM",
    screenshotBefore: "first-before.jpg", screenshotAfter: "first-settled.jpg",
    visualChange: { changed: true }
  }, {
    action: "click", target: canvas, window, startMs: 100, endMs: 110,
    sourceEventIds: ["second-down", "second-up"], visualComparisonContext: "TRIM",
    screenshotBefore: "transient-before.jpg", screenshotAfter: "second-settled.jpg",
    visualChange: { changed: true }
  }];

  annotatePersistentCanvasBaselines(actions);

  assert.equal(actions[1].persistentBaselineScreenshot, "first-settled.jpg");
  assert.deepEqual(actions[1].persistentBaselineSourceEventIds, ["first-down", "first-up"]);
  assert.deepEqual(makeAnalysisBundle(".", actions, 5).screenshots, [
    "first-before.jpg", "first-settled.jpg", "transient-before.jpg", "second-settled.jpg"
  ]);
});

test("已解析为命令结束的动作不会沿用陈旧持久状态基线", () => {
  const window = { width: 1000, height: 800 };
  const canvas = { role: "ControlType.Pane", width: 800, height: 600 };
  const actions = [{
    action: "click", target: canvas, window, startMs: 10, endMs: 20,
    resolvedCadCommandContext: "TRIM", visualComparisonContext: "TRIM",
    screenshotBefore: "trim-before.jpg", screenshotAfter: "trim-after.jpg",
    visualChange: { changed: true }
  }, {
    action: "click", target: canvas, window, startMs: 30, endMs: 40,
    resolvedCadCommandContext: null, visualComparisonContext: "TRIM",
    screenshotBefore: "ordinary-before.jpg", screenshotAfter: "ordinary-after.jpg",
    visualChange: { changed: true }
  }];

  annotatePersistentCanvasBaselines(actions);

  assert.equal(actions[1].persistentBaselineScreenshot, undefined);
});

test("关键画布证据超过单次上限时自动分段且不遗漏", () => {
  const window = { width: 1000, height: 800 };
  const canvas = { role: "ControlType.Pane", width: 800, height: 600 };
  const actions = Array.from({ length: 7 }, (_, index) => ({
    action: "click",
    target: canvas,
    window,
    screenshotBefore: `point-${index}.jpg`
  }));
  const chunks = chunkActions(actions, 150, { maxCanvasEvidence: 3 });
  assert.deepEqual(chunks.map((chunk) => chunk.length), [3, 3, 1]);
  assert.deepEqual(chunks.flatMap((chunk) => chunk.map((action) => action.screenshotBefore)),
    actions.map((action) => action.screenshotBefore));
});

test("无 UIA 的 CAD 参数提交后先建立几何检查点再分析后续修改", () => {
  const window = { processName: "acad", width: 1000, height: 800 };
  const actions = [
    { action: "click", target: null, window },
    { action: "type_text", text: "12", target: null, window },
    {
      action: "press_key", key: "ENTER", target: null, window,
      screenshotBefore: "array-before.jpg", screenshotAfter: "array-after.jpg",
      visualChange: { changed: true }
    },
    {
      action: "click", target: null, window,
      screenshotBefore: "trim-before.jpg", screenshotAfter: "trim-after.jpg",
      visualChange: { changed: true }
    }
  ];
  const chunks = chunkActions(actions, 150, { maxCanvasEvidence: 20 });
  assert.deepEqual(chunks.map((chunk) => chunk.length), [3, 1]);
  assert.equal(chunks[0].at(-1).key, "ENTER");
  assert.equal(chunks[1][0].screenshotBefore, "trim-before.jpg");
});

test("经济模式合并过小的几何检查点以减少 API 请求", () => {
  const window = { processName: "acad", width: 1000, height: 800 };
  const actions = [
    { action: "click", target: null, window },
    { action: "type_text", text: "12", target: null, window },
    {
      action: "press_key", key: "ENTER", target: null, window,
      screenshotBefore: "circle-before.jpg", screenshotAfter: "circle-after.jpg",
      visualChange: { changed: true }
    },
    { action: "click", target: null, window, screenshotBefore: "next-command.jpg" }
  ];
  const chunks = chunkActions(actions, 150, {
    maxCanvasEvidence: 20,
    minActionsPerChunk: 4
  });
  assert.deepEqual(chunks.map((chunk) => chunk.length), [4]);
});

test("无 UIA 的关联阵列等到 Close Array 后才切段", () => {
  const window = { processName: "acad", width: 1000, height: 800 };
  const actions = [
    { action: "type_text", text: "aar", target: null, window },
    { action: "press_key", key: "ENTER", target: null, window },
    { action: "type_text", text: "ii", target: null, window },
    { action: "press_key", key: "ENTER", target: null, window },
    { action: "type_text", text: "12", target: null, window },
    {
      action: "press_key", key: "ENTER", target: null, window,
      screenshotBefore: "items-before.jpg", screenshotAfter: "items-after.jpg",
      visualChange: { changed: true }
    },
    {
      action: "click", target: null, window,
      at: { relativeX: 0.38, relativeY: 0.075 },
      screenshotBefore: "array-editor.jpg", screenshotAfter: "array-closed.jpg",
      visualChange: { changed: true }
    },
    {
      action: "click", target: null, window,
      at: { relativeX: 0.16, relativeY: 0.06 },
      screenshotBefore: "trim-button-before.jpg", screenshotAfter: "trim-button-after.jpg",
      visualChange: { changed: true }
    }
  ];
  const commandCatalog = {
    commands: { ARRAY: { canonicalName: "ARRAY" } },
    aliasIndex: { AR: { command: "ARRAY" } }
  };

  const chunks = chunkActions(actions, 150, { maxCanvasEvidence: 20, commandCatalog });
  assert.deepEqual(chunks.map((chunk) => chunk.length), [7, 1]);
  assert.equal(chunks[0].at(-1).screenshotAfter, "array-closed.jpg");
  assert.equal(chunks[1][0].screenshotBefore, "trim-button-before.jpg");
});

test("LINE 数值提交保留命令角色并优先上传 Enter 前截图", () => {
  const window = { processName: "acad", title: "Autodesk AutoCAD", width: 1000, height: 800 };
  const lineButton = {
    role: "ControlType.Button", name: "Line", automationId: "ID_Line",
    width: 40, height: 40
  };
  const actions = buildCandidateActions([
    { id: "down", eventType: "mouse_down", timestampMs: 1, x: 20, y: 20, button: "left", target: lineButton, window },
    { id: "up", eventType: "mouse_up", timestampMs: 2, x: 20, y: 20, button: "left", target: lineButton, window },
    { id: "7", eventType: "key_down", timestampMs: 3, key: "D7", text: "7", window },
    { id: "5", eventType: "key_down", timestampMs: 4, key: "D5", text: "5", window },
    {
      id: "enter", eventType: "key_down", timestampMs: 5, key: "ENTER", window,
      screenshotBefore: "line-75-before.jpg", screenshotAfter: "line-75-after.jpg"
    }
  ]);
  const enter = actions.find((action) => action.key === "ENTER");
  assert.deepEqual(enter.cadInputEvidence, {
    command: "LINE", parameterName: "distance", value: 75,
    unit: "cad_drawing_unit", exact: true, valueExact: true,
    parameterRoleExact: true, source: "keyboard_committed",
    sourceEventIds: ["7", "5", "enter"]
  });
  assert.deepEqual(makeAnalysisBundle(".", [
    ...Array.from({ length: 5 }, (_, index) => ({
      action: "click", target: { role: "ControlType.Pane", width: 800, height: 600 }, window,
      screenshotBefore: `point-${index}.jpg`
    })),
    enter
  ], 3).screenshots, ["point-0.jpg", "line-75-before.jpg", "line-75-after.jpg"]);
});

test("从结构化 CAD 操作生成 SCR 并保留 Enter", () => {
  const result = renderAutoCadScr(cadPlan([
    cadOperation("op-rect", "command", "RECTANG", [pointArg("first", 0, 0), pointArg("second", 100, 60), enterArg()]),
    cadOperation("op-circle", "circle", "CIRCLE", [pointArg("center", 50, 30), numberArg("radius", 20)], ["circle-1"])
  ]));
  assert.equal(result,
    "_.RECTANG\r\n_NON\r\n0,0\r\n_NON\r\n100,60\r\n\r\n_.CIRCLE\r\n_NON\r\n50,30\r\n20\r\n");
});

test("缺少精确业务数值时拒绝编译伪操作", () => {
  assert.throws(() => renderAutoCadScr({
    cadProgram: { format: "none", operations: [], warnings: ["圆半径不可见"] }
  }), /圆半径不可见/);
});

test("CAD 程序不完整时仍可从已有精确几何生成部分 SCR，并忽略尺寸标注", () => {
  const plan = cadPlan([
    cadOperation("op-circle", "circle", "CIRCLE", [
      pointArg("center", 10, 20), numberArg("radius", 5)
    ], ["circle-1"]),
    cadOperation("op-radius", "radial_constraint", "DCRADIUS", [
      selectionArg({ mode: "entities", entityIds: ["circle-1"] }),
      numberArg("constraint_value", 5)
    ], ["constraint-1"])
  ]);
  plan.cadProgram.complete = false;
  plan.cadProgram.warnings = ["末尾直径约束缺少完整交互证据"];

  const result = renderAutoCadScr(plan);
  assert.equal(result, "_.CIRCLE\r\n_NON\r\n10,20\r\n5\r\n");
  assert.doesNotMatch(result, /DCRADIUS/);
});

test("SCR 后端不会偷偷修改 AI 识别出的几何坐标", () => {
  const result = renderAutoCadScr(cadPlan([
    cadOperation("op-circle", "circle", "CIRCLE", [
      pointArg("center", 3035.4412, 6399.7927), numberArg("radius", 3438.565)
    ], ["circle-1"]),
    cadOperation("op-line", "line", "LINE", [
      pointArg("start", 3749.2137, 10831.596),
      pointArg("end", 3749.2137, 9763.4601, "intersection", ["circle-1"]), enterArg()
    ], ["line-1"])
  ]));
  assert.match(result, /_NON\r\n3749\.2137,9763\.4601/);
});

test("结构化窗口选择在编译时增加安全边距", () => {
  const result = renderAutoCadScr(cadPlan([
    cadOperation("op-array", "command", "-ARRAY", [
      selectionArg({ mode: "window", firstCorner: cadPoint(10, 20), secondCorner: cadPoint(30, 60) }),
      keywordArg("array_type", "P"), pointArg("center", 0, 0), integerArg("item_count", 10),
      numberArg("fill_angle", 360), keywordArg("rotate_items", "Y")
    ])
  ]));
  const lines = result.split("\r\n");
  assert.deepEqual(lines.slice(1, 6), ["_W", "_NON", "9.996,19.996", "_NON", "30.004,60.004"]);
});

test("所有结构化坐标由 SCR 后端统一加入 NON", () => {
  const result = renderAutoCadScr(cadPlan([
    cadOperation("op-line", "line", "LINE", [
      pointArg("start", 0, 0), pointArg("end", 5, 5, "intersection", ["other-1"]), enterArg()
    ], ["line-1"])
  ]));
  assert.equal(result, "_.LINE\r\n_NON\r\n0,0\r\n_NON\r\n5,5\r\n\r\n");
});

test("按实体引用将语义极轴阵列确定性展开", () => {
  const result = renderAutoCadScr(cadPlan([
    cadOperation("op-source", "line", "LINE", [
      pointArg("start", -1, 10), pointArg("end", 1, 10), enterArg()
    ], ["tooth-line"]),
    polarArrayOperation("op-array", ["tooth-line"], 0, 0, 4, 360)
  ]));
  assert.doesNotMatch(result, /ARRAY/);
  assert.equal(result.split("\r\n").filter((line) => line === "_.LINE").length, 4);
  assert.match(result, /_NON\r\n-10,-1\r\n_NON\r\n-10,1/);
  assert.match(result, /_NON\r\n1,-10\r\n_NON\r\n-1,-10/);
});

test("极轴阵列只复制 AI 明确引用的源实体", () => {
  const result = renderAutoCadScr(cadPlan([
    cadOperation("op-circle", "circle", "CIRCLE", [pointArg("center", 0, 0), numberArg("radius", 5)], ["circle-1"]),
    cadOperation("op-source", "line", "LINE", [pointArg("start", -1, 10), pointArg("end", 1, 10), enterArg()], ["line-1"]),
    polarArrayOperation("op-array", ["line-1"], 0, 0, 4, 360)
  ]));
  assert.equal(result.split("\r\n").filter((line) => line === "_.CIRCLE").length, 1);
  assert.equal(result.split("\r\n").filter((line) => line === "_.LINE").length, 4);
});

test("阵列引用不存在的实体时拒绝生成，避免猜测选择集", () => {
  assert.throws(() => renderAutoCadScr(cadPlan([
    polarArrayOperation("op-array", ["missing-entity"], 0, 0, 4, 360)
  ])), /尚未生成的实体/);
});

test("OFFSET 有精确最终几何时不依赖不可靠的侧点生成", () => {
  const offset = cadOperation("op-offset", "offset", "OFFSET", [
    numberArg("distance", 5),
    selectionArg({ mode: "entities", entityIds: ["source-line"] })
  ], ["offset-line"], {
    resultGeometry: [lineGeometry("offset-line", 0, 5, 10, 5, ["source-line"])],
    visualInference: changedInference(["source-line"], "left")
  });
  const result = renderAutoCadScr(cadPlan([
    cadOperation("op-source", "line", "LINE", [
      pointArg("start", 0, 0), pointArg("end", 10, 0), enterArg()
    ], ["source-line"]),
    offset
  ]));
  assert.doesNotMatch(result, /OFFSET/);
  assert.match(result, /_NON\r\n0,5\r\n_NON\r\n10,5/);
});

test("最终几何 SCR 后端注册 ROTATE 结果并支持后续 OFFSET 引用", () => {
  const rotated = cadOperation("op-rotate", "other", "ROTATE", [
    selectionArg({ mode: "entities", entityIds: ["source-line"] }),
    pointArg("base_point", 0, 0), keywordArg("copy", "Copy"), numberArg("rotation_angle", 90)
  ], ["rotated-line"], {
    resultGeometry: [lineGeometry("rotated-line", 0, 0, 0, 10, ["source-line"])]
  });
  const offset = cadOperation("op-offset", "offset", "OFFSET", [
    numberArg("offset_distance", 2),
    selectionArg({ mode: "entities", entityIds: ["rotated-line"] })
  ], ["offset-line"], {
    resultGeometry: [lineGeometry("offset-line", 2, 0, 2, 10, ["rotated-line"])]
  });
  const result = renderAutoCadScr(cadPlan([
    cadOperation("op-source", "line", "LINE", [
      pointArg("start", 0, 0), pointArg("end", 10, 0), enterArg()
    ], ["source-line"]),
    rotated,
    offset
  ]));
  assert.doesNotMatch(result, /ROTATE|OFFSET/);
  assert.equal(result.split("\r\n").filter((line) => line === "_.LINE").length, 3);
  assert.match(result, /_NON\r\n2,0\r\n_NON\r\n2,10/);
});

test("最终几何 SCR 后端用精确 TRIM 结果替换源实体", () => {
  const trim = cadOperation("op-trim", "trim", "TRIM", [
    selectionArg({ mode: "entities", entityIds: ["long-line"] }),
    selectionArg({ mode: "entities", entityIds: ["cutter"] })
  ], ["short-line"], {
    resultGeometry: [lineGeometry("short-line", 5, 0, 10, 0, ["long-line"])]
  });
  const result = renderAutoCadScr(cadPlan([
    cadOperation("op-long", "line", "LINE", [
      pointArg("start", 0, 0), pointArg("end", 10, 0), enterArg()
    ], ["long-line"]),
    cadOperation("op-cutter", "line", "LINE", [
      pointArg("start", 5, -5), pointArg("end", 5, 5), enterArg()
    ], ["cutter"]),
    trim
  ]));
  assert.doesNotMatch(result, /TRIM/);
  assert.doesNotMatch(result, /_NON\r\n0,0\r\n_NON\r\n10,0/);
  assert.match(result, /_NON\r\n5,0\r\n_NON\r\n10,0/);
});

test("尖角 FILLET 替换规范实体时同步折叠完全重合的可见线", () => {
  const fillet = cadOperation("op-fillet", "fillet", "FILLET", [
    selectionArg({ mode: "entities", entityIds: ["line-copy", "diagonal"] })
  ], ["corner-vertical", "corner-diagonal"], {
    resultGeometry: [
      lineGeometry("corner-vertical", 0, 5, 0, 10, ["line-copy"]),
      lineGeometry("corner-diagonal", -5, 5, 0, 5, ["diagonal"])
    ],
    visualInference: changedInference(["line-copy", "diagonal"], "unknown"),
    sourceScreenshots: ["offset-before.jpg", "offset-after.jpg"]
  });
  const result = renderAutoCadScr(cadPlan([
    cadOperation("op-original", "line", "LINE", [
      pointArg("start", 0, 0), pointArg("end", 0, 10), enterArg()
    ], ["line-original"]),
    cadOperation("op-copy", "line", "LINE", [
      pointArg("start", 0, 0), pointArg("end", 0, 10), enterArg()
    ], ["line-copy"]),
    cadOperation("op-diagonal", "line", "LINE", [
      pointArg("start", -5, 5), pointArg("end", 5, 5), enterArg()
    ], ["diagonal"]),
    fillet
  ]));

  assert.equal(result.split("\r\n").filter((line) => line === "_.LINE").length, 2);
  assert.doesNotMatch(result, /_NON\r\n0,0\r\n_NON\r\n0,10/);
  assert.match(result, /_NON\r\n0,5\r\n_NON\r\n0,10/);
});

test("圆的 TRIM 结果可用圆心半径和起止角精确编译", () => {
  const trim = cadOperation("op-trim", "trim", "TRIM", [
    selectionArg({ mode: "entities", entityIds: ["source-circle"] })
  ], ["trimmed-arc"], {
    resultGeometry: [{
      id: "trimmed-arc", kind: "arc_center", points: [], center: cadPoint(0, 0), radius: 10,
      startAngle: 0, endAngle: 90, clockwise: false, closed: false,
      sourceEntityIds: ["source-circle"], confidence: 0.98
    }],
    visualInference: changedInference(["source-circle"], "inside")
  });
  const result = renderAutoCadScr(cadPlan([
    cadOperation("op-circle", "circle", "CIRCLE", [
      pointArg("center", 0, 0), numberArg("radius", 10)
    ], ["source-circle"]),
    trim
  ]));
  assert.doesNotMatch(result, /CIRCLE|TRIM/);
  assert.equal(result.split("\r\n").filter((line) => line === "_.ARC").length, 1);
  assert.match(result, /_NON\r\n10,0/);
  assert.match(result, /_NON\r\n0,10/);
});

function cadPlan(operations) {
  return {
    cadProgram: {
      format: "autocad_command_ir",
      operations,
      confidence: 0.9,
      warnings: [],
      complete: true
    }
  };
}

function cadOperation(id, semanticKind, command, args, resultEntityIds = [], overrides = {}) {
  return {
    id,
    semanticKind,
    command,
    arguments: args,
    resultEntityIds,
    resultGeometry: [],
    visualInference: noVisualInference(),
    sourceEventIds: [],
    sourceScreenshots: [],
    confidence: 0.9,
    ...overrides
  };
}

function noVisualInference() {
  return {
    method: "none", beforeScreenshot: null, afterScreenshot: null,
    changedRegionRelative: null, sourceEntityIds: [], referenceEntityIds: [],
    side: "none", confidence: 1
  };
}

function changedInference(sourceEntityIds, side) {
  return {
    method: "combined", beforeScreenshot: "offset-before.jpg", afterScreenshot: "offset-after.jpg",
    changedRegionRelative: [0.1, 0.1, 0.5, 0.5], sourceEntityIds, referenceEntityIds: [],
    side, confidence: 0.95
  };
}

function lineGeometry(id, x1, y1, x2, y2, sourceEntityIds = []) {
  return {
    id, kind: "line", points: [cadPoint(x1, y1), cadPoint(x2, y2)],
    center: null, radius: null, closed: false, sourceEntityIds, confidence: 0.95
  };
}

function polarArrayOperation(id, entityIds, centerX, centerY, itemCount, fillAngle) {
  return cadOperation(id, "polar_array", "ARRAY", [
    selectionArg({ mode: "entities", entityIds }),
    pointArg("center", centerX, centerY),
    integerArg("item_count", itemCount),
    numberArg("fill_angle", fillAngle)
  ]);
}

function pointArg(name, x, y, snap = "none", referenceEntityIds = []) {
  return argument("point", name, { point: cadPoint(x, y, snap, referenceEntityIds) });
}

function numberArg(name, number) {
  return argument("number", name, { number });
}

function integerArg(name, number) {
  return argument("integer", name, { number });
}

function keywordArg(name, text) {
  return argument("keyword", name, { text });
}

function enterArg() {
  return argument("enter", "confirm");
}

function selectionArg({ mode, entityIds = [], firstCorner = null, secondCorner = null }) {
  return argument("selection", "objects", {
    selection: { mode, entityIds, firstCorner, secondCorner }
  });
}

function argument(kind, name, overrides = {}) {
  return { kind, name, point: null, number: null, text: null, selection: null, ...overrides };
}

function cadPoint(x, y, snap = "none", referenceEntityIds = []) {
  return { x, y, snap, referenceEntityIds, confidence: 0.95 };
}
