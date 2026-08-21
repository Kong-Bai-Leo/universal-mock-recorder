import test from "node:test";
import assert from "node:assert/strict";
import { buildCandidateActions, chunkActions, makeAnalysisBundle } from "../src/analyzer/lib/trace.mjs";
import { renderTypeScript } from "../src/analyzer/lib/script-renderer.mjs";

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
    { id: "1", eventType: "mouse_down", timestampMs: 10, x: 10, y: 20, button: "left" },
    { id: "m", eventType: "mouse_move", timestampMs: 250, x: 50, y: 80 },
    { id: "2", eventType: "mouse_up", timestampMs: 500, x: 100, y: 200, button: "left" }
  ]);
  assert.equal(actions[0].action, "drag");
  assert.deepEqual(actions[0].to, { x: 100, y: 200, relativeX: undefined, relativeY: undefined });
  assert.equal(actions[0].path.length, 3);
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
});
