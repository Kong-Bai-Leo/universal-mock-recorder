import fs from "node:fs/promises";
import path from "node:path";

export async function readJsonLines(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`无法解析第 ${index + 1} 行记录: ${error.message}`);
      }
    });
}

export function buildCandidateActions(events, options = {}) {
  const doubleClickMs = options.doubleClickMs ?? 500;
  const dragDistance = options.dragDistance ?? 6;
  const actions = [];
  let pointerDown = null;
  let pointerPath = [];
  let lastClick = null;
  let textRun = null;

  const flushText = () => {
    if (!textRun) return;
    actions.push(textRun);
    textRun = null;
  };

  for (const event of events) {
    if (event.eventType === "mouse_move") {
      if (pointerDown) pointerPath.push(pointOf(event));
      continue;
    }

    if (event.eventType === "key_down") {
      const normalizedKey = normalizeKeyName(event.key);
      if (isModifierKey(normalizedKey)) continue;
      if (isTextKey(event)) {
        if (!textRun || event.timestampMs - textRun.endMs > 1200) {
          flushText();
          textRun = {
            action: "type_text",
            text: "",
            startMs: event.timestampMs,
            endMs: event.timestampMs,
            target: event.target ?? null,
            window: event.window ?? null,
            sourceEventIds: []
          };
        }
        textRun.text += event.text;
        textRun.endMs = event.timestampMs;
        textRun.sourceEventIds.push(event.id);
      } else {
        flushText();
        actions.push({
          action: "press_key",
          key: normalizedKey,
          modifiers: event.modifiers ?? [],
          target: event.target ?? null,
          window: event.window ?? null,
          screenshotBefore: event.screenshotBefore ?? null,
          screenshotBeforeTimestampMs: event.screenshotBeforeTimestampMs ?? null,
          screenshotAfter: event.screenshotAfter ?? event.screenshot ?? null,
          screenshotAfterTimestampMs: event.screenshotAfterTimestampMs ?? event.screenshotTimestampMs ?? null,
          visualChange: event.visualChange ?? null,
          startMs: event.timestampMs,
          endMs: event.timestampMs,
          sourceEventIds: [event.id]
        });
      }
      continue;
    }

    if (event.eventType === "mouse_down") {
      flushText();
      pointerDown = event;
      pointerPath = [pointOf(event)];
      continue;
    }

    if (event.eventType === "mouse_up" && pointerDown) {
      const distance = pointDistance(pointerDown, event);
      const base = {
        button: pointerDown.button,
        startMs: pointerDown.timestampMs,
        endMs: event.timestampMs,
        target: pointerDown.target ?? null,
        window: pointerDown.window ?? null,
        screenshotBefore: pointerDown.screenshotBefore ?? pointerDown.screenshot ?? null,
        screenshotBeforeTimestampMs: pointerDown.screenshotBeforeTimestampMs ?? pointerDown.screenshotTimestampMs ?? null,
        screenshotAfter: event.screenshotAfter ?? event.screenshot ?? null,
        screenshotAfterTimestampMs: event.screenshotAfterTimestampMs ?? event.screenshotTimestampMs ?? null,
        visualChange: event.visualChange ?? null,
        sourceEventIds: [pointerDown.id, event.id]
      };

      if (distance >= dragDistance) {
        actions.push({
          ...base,
          action: "drag",
          from: pointOf(pointerDown),
          to: pointOf(event),
          path: [...pointerPath, pointOf(event)]
        });
        lastClick = null;
      } else {
        const clickAction = pointerDown.button === "right"
          ? "right_click"
          : pointerDown.button === "middle" ? "middle_click" : "click";
        const click = { ...base, action: clickAction, at: pointOf(event) };
        if (
          lastClick &&
          lastClick.action === "click" &&
          click.action === "click" &&
          actions[actions.length - 1] === lastClick &&
          lastClick.button === click.button &&
          click.endMs - lastClick.endMs <= doubleClickMs &&
          pointDistance(lastClick.at, click.at) <= dragDistance
        ) {
          click.action = "double_click";
          click.startMs = lastClick.startMs;
          click.screenshotBefore = lastClick.screenshotBefore;
          click.sourceEventIds = [...lastClick.sourceEventIds, ...click.sourceEventIds];
          actions[actions.length - 1] = click;
          lastClick = null;
        } else {
          actions.push(click);
          lastClick = click;
        }
      }
      pointerDown = null;
      pointerPath = [];
      continue;
    }

    if (event.eventType === "mouse_wheel") {
      flushText();
      actions.push({
        action: "scroll",
        delta: event.wheelDelta,
        at: pointOf(event),
        startMs: event.timestampMs,
        endMs: event.timestampMs,
        window: event.window ?? null,
        sourceEventIds: [event.id]
      });
    }
  }

  flushText();
  return actions;
}

export function makeAnalysisBundle(recordingDir, actions, maxScreenshots = 12) {
  const screenshots = selectAnalysisScreenshots(actions, maxScreenshots);

  return {
    recordingDir: path.resolve(recordingDir),
    actions,
    screenshots
  };
}

function selectAnalysisScreenshots(actions, maximum) {
  if (maximum <= 0) return [];
  const ordered = [...new Set(actions.flatMap((action) => [
    action.screenshotBefore,
    action.screenshotAfter
  ]).filter(Boolean))];
  if (ordered.length <= maximum) return ordered;

  // 画布点击前的截图经常包含 AutoCAD 动态输入框中的业务坐标、半径或角度，
  // 这些证据比普通流程截图更重要，不能被均匀抽样跳过。
  const priority = [];
  for (const action of actions) {
    if (!isLikelyCanvasPointerAction(action)) continue;
    if (action.screenshotBefore) priority.push(action.screenshotBefore);
  }

  // 每个取点只占一个名额：点击前的动态输入截图含坐标/距离/角度；
  // 点击后的整体变化由剩余名额均匀覆盖，避免成对截图挤掉后半段取点证据。
  const selected = [...new Set(priority)].slice(0, maximum);
  if (selected.length < maximum) {
    const remaining = ordered.filter((file) => !selected.includes(file));
    selected.push(...selectEvenly(remaining, maximum - selected.length));
  }
  return selected.sort((left, right) => ordered.indexOf(left) - ordered.indexOf(right));
}

function isLikelyCanvasPointerAction(action) {
  if (!["click", "double_click", "right_click", "middle_click", "drag"].includes(action.action))
    return false;
  const target = action.target;
  const window = action.window;
  if (!target?.width || !target?.height || !window?.width || !window?.height) return false;
  const role = String(target.role ?? "");
  const areaRatio = target.width * target.height / Math.max(1, window.width * window.height);
  return /Pane|Document|Custom/i.test(role) && areaRatio >= 0.2;
}

export function chunkActions(actions, maxActions = 150, options = {}) {
  if (!Number.isInteger(maxActions) || maxActions < 1)
    throw new Error("maxActions 必须是大于 0 的整数");
  const maxCanvasEvidence = options.maxCanvasEvidence ?? Number.POSITIVE_INFINITY;
  if (!(maxCanvasEvidence > 0)) throw new Error("maxCanvasEvidence 必须大于 0");
  const chunks = [];
  let current = [];
  let canvasEvidence = new Set();
  for (const action of actions) {
    const evidence = isLikelyCanvasPointerAction(action) ? action.screenshotBefore : null;
    const addsEvidence = evidence && !canvasEvidence.has(evidence);
    if (current.length > 0 && (
      current.length >= maxActions || (addsEvidence && canvasEvidence.size >= maxCanvasEvidence)
    )) {
      chunks.push(current);
      current = [];
      canvasEvidence = new Set();
    }
    current.push(action);
    if (evidence) canvasEvidence.add(evidence);
  }
  if (current.length > 0) chunks.push(current);
  return chunks.length > 0 ? chunks : [[]];
}

function isTextKey(event) {
  if (["ENTER", "RETURN", "ESCAPE", "BACK", "BACKSPACE", "DELETE", "TAB"].includes(
    String(event.key ?? "").toUpperCase()
  )) return false;
  return typeof event.text === "string" && event.text.length > 0 &&
    !(event.modifiers ?? []).some((key) => key === "CTRL" || key === "ALT" || key === "WIN");
}

function normalizeKeyName(key) {
  const normalized = String(key ?? "").toUpperCase();
  if (normalized === "RETURN") return "ENTER";
  if (normalized === "BACK") return "BACKSPACE";
  return normalized;
}

function isModifierKey(key) {
  return [
    "CONTROLKEY", "LCONTROLKEY", "RCONTROLKEY",
    "SHIFTKEY", "LSHIFTKEY", "RSHIFTKEY",
    "MENU", "LMENU", "RMENU", "LWIN", "RWIN"
  ].includes(String(key ?? "").toUpperCase());
}

function selectEvenly(items, maximum) {
  if (maximum <= 0 || items.length === 0) return [];
  if (items.length <= maximum) return items;
  if (maximum === 1) return [items[0]];

  const selected = [];
  for (let index = 0; index < maximum; index += 1) {
    const sourceIndex = Math.round(index * (items.length - 1) / (maximum - 1));
    selected.push(items[sourceIndex]);
  }
  return selected;
}

function pointOf(event) {
  return {
    x: event.x,
    y: event.y,
    relativeX: event.relativeX,
    relativeY: event.relativeY
  };
}

function pointDistance(a, b) {
  const ax = a.x ?? 0;
  const ay = a.y ?? 0;
  const bx = b.x ?? 0;
  const by = b.y ?? 0;
  return Math.hypot(ax - bx, ay - by);
}
