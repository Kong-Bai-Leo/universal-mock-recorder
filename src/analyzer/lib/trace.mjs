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
      if (isModifierKey(event.key)) continue;
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
          key: event.key,
          modifiers: event.modifiers ?? [],
          target: event.target ?? null,
          window: event.window ?? null,
          screenshotAfter: event.screenshot ?? null,
          screenshotAfterTimestampMs: event.screenshotTimestampMs ?? null,
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
        screenshotBefore: pointerDown.screenshot ?? null,
        screenshotBeforeTimestampMs: pointerDown.screenshotTimestampMs ?? null,
        screenshotAfter: event.screenshot ?? null,
        screenshotAfterTimestampMs: event.screenshotTimestampMs ?? null,
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
  const screenshotCandidates = actions
    .flatMap((action) => [action.screenshotBefore, action.screenshotAfter])
    .filter(Boolean);
  const screenshots = selectEvenly([...new Set(screenshotCandidates)], maxScreenshots);

  return {
    recordingDir: path.resolve(recordingDir),
    actions,
    screenshots
  };
}

export function chunkActions(actions, maxActions = 150) {
  if (!Number.isInteger(maxActions) || maxActions < 1)
    throw new Error("maxActions 必须是大于 0 的整数");
  const chunks = [];
  for (let index = 0; index < actions.length; index += maxActions)
    chunks.push(actions.slice(index, index + maxActions));
  return chunks.length > 0 ? chunks : [[]];
}

function isTextKey(event) {
  return typeof event.text === "string" && event.text.length > 0 &&
    !(event.modifiers ?? []).some((key) => key === "CTRL" || key === "ALT" || key === "WIN");
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
