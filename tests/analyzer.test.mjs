import test from "node:test";
import assert from "node:assert/strict";
import { buildCandidateActions, chunkActions, makeAnalysisBundle } from "../src/analyzer/lib/trace.mjs";
import { renderTypeScript } from "../src/analyzer/lib/script-renderer.mjs";
import { renderComputerUseTask } from "../src/analyzer/lib/computer-use-renderer.mjs";
import { renderAutoCadScr } from "../src/analyzer/lib/autocad-scr-renderer.mjs";

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
    { id: "1", eventType: "mouse_down", timestampMs: 10, x: 10, y: 20, relativeX: 0.1, relativeY: 0.2, button: "left", screenshotBefore: "screenshots/before.jpg" },
    { id: "m", eventType: "mouse_move", timestampMs: 250, x: 50, y: 80 },
    { id: "2", eventType: "mouse_up", timestampMs: 500, x: 100, y: 200, relativeX: 0.8, relativeY: 0.9, button: "left", screenshotAfter: "screenshots/after.jpg", visualChange: { changed: true, relativeBounds: [0.1, 0.2, 0.7, 0.7] } }
  ]);
  assert.equal(actions[0].action, "drag");
  assert.deepEqual(actions[0].to, { x: 100, y: 200, relativeX: 0.8, relativeY: 0.9 });
  assert.equal(actions[0].path.length, 3);
  assert.equal(actions[0].screenshotBefore, "screenshots/before.jpg");
  assert.equal(actions[0].screenshotAfter, "screenshots/after.jpg");
  assert.equal(actions[0].visualChange.changed, true);
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
  assert.match(script, /verifyAfterEachStep: true/);
  assert.match(script, /@test\/mock/);
  assert.match(script, /export const workflow/);
});

test("生成 Computer Use Agent 任务说明", () => {
  const task = renderComputerUseTask({ summary: "画一个圆", steps: [] });
  assert.match(task, /Computer Use Agent/);
  assert.match(task, /canvasChange/);
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

test("生成 AutoCAD SCR 并保留空行 Enter", () => {
  const result = renderAutoCadScr({
    nativeScript: {
      format: "autocad_scr",
      lines: ["_.RECTANG", "0,0", "100,60", "", "_.CIRCLE", "50,30", "20"]
    }
  });
  assert.equal(result,
    "_.RECTANG\r\n_NON\r\n0,0\r\n_NON\r\n100,60\r\n\r\n_.CIRCLE\r\n_NON\r\n50,30\r\n20\r\n");
});

test("缺少精确业务数值时拒绝输出伪 SCR", () => {
  assert.throws(() => renderAutoCadScr({
    nativeScript: { format: "none", lines: [], warnings: ["圆半径不可见"] }
  }), /圆半径不可见/);
});

test("拒绝会进入关联阵列界面的不稳定 SCR 命令", () => {
  assert.throws(() => renderAutoCadScr({
    nativeScript: {
      format: "autocad_scr",
      lines: ["_.ARRAYPOLAR", "_L", "", "0,0", "18", "360"]
    }
  }), /请使用 _\.-ARRAY/);
});

test("允许使用命令行版极轴阵列和单个开口多段线", () => {
  const result = renderAutoCadScr({
    nativeScript: {
      format: "autocad_scr",
      lines: [
        "_.PLINE", "0,10", "@4<0", "@5<90", "@4<180", "",
        "_.-ARRAY", "_L", "", "_P", "0,0", "18", "360", "_Y"
      ]
    }
  });
  assert.match(result, /_\.-ARRAY\r\n_L\r\n\r\n_P\r\n_NON\r\n0,0\r\n18\r\n360\r\n_Y/);
});

test("将舍入后的竖线端点校正到已知圆的精确交点", () => {
  const result = renderAutoCadScr({
    nativeScript: {
      format: "autocad_scr",
      lines: [
        "_.CIRCLE", "3035.4412,6399.7927", "3438.565",
        "_.LINE", "3749.2137,10831.596", "3749.2137,9763.4601", ""
      ]
    }
  });
  const outputLines = result.split("\r\n");
  const endpoint = outputLines.filter((line) => /^3749\.2137,/.test(line)).at(-1).split(",").map(Number);
  const distance = Math.hypot(endpoint[0] - 3035.4412, endpoint[1] - 6399.7927);
  assert.ok(Math.abs(distance - 3438.565) < 1e-7);
  assert.notEqual(outputLines.filter((line) => /^3749\.2137,/.test(line)).at(-1), "3749.2137,9763.4601");
  assert.match(result, /_NON\r\n3749\.2137,/);
});

test("为 Window 对象选择自动增加微小安全边距", () => {
  const result = renderAutoCadScr({
    nativeScript: {
      format: "autocad_scr",
      lines: ["_.-ARRAY", "_W", "10,20", "30,60", "", "_P", "0,0", "10", "360", "_Y"]
    }
  });
  const lines = result.split("\r\n");
  assert.equal(lines[2], "_NON");
  assert.equal(lines[3], "9.996,19.996");
  assert.equal(lines[4], "_NON");
  assert.equal(lines[5], "30.004,60.004");
});

test("每个脚本坐标前加入单次 NON 覆盖且不破坏显式捕捉", () => {
  const result = renderAutoCadScr({
    nativeScript: {
      format: "autocad_scr",
      lines: ["_.LINE", "0,0", "@10<90", "_INT", "5,5", ""]
    }
  });
  assert.equal(result,
    "_.LINE\r\n_NON\r\n0,0\r\n_NON\r\n@10<90\r\n_INT\r\n5,5\r\n\r\n");
});
