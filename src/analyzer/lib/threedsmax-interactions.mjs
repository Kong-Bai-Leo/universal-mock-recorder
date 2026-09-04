// 3ds Max interactive tools can keep consuming mouse motion after button-up
// (Bevel Outline and primitive Height, for example). These are candidates, not
// command recognition: the VLM must confirm the active tool in the screenshots.
export function annotateThreeDsMaxContinuations(actions, events) {
  const eventIndex = new Map(events.map((event, index) => [event.id, index]));
  for (let index = 0; index + 1 < actions.length; index++) {
    const drag = actions[index], confirmation = actions[index + 1];
    if (drag.action !== "drag" || drag.button !== "left" || confirmation.action !== "click" || confirmation.button !== "left" ||
        !sameWindow(drag.window, confirmation.window) || !inViewport(drag.to) || !inViewport(confirmation.at) ||
        confirmation.startMs - drag.endMs > 120000) continue;
    const first = eventIndex.get(drag.sourceEventIds.at(-1));
    const last = eventIndex.get(confirmation.sourceEventIds[0]);
    if (first === undefined || last === undefined || first >= last) continue;
    const between = events.slice(first + 1, last);
    if (between.some((e) => e.eventType !== "mouse_move" || !sameWindow(drag.window, e.window))) continue;
    const motion = between.filter((e) => Number.isFinite(e.x) && Number.isFinite(e.y));
    if (!motion.length || Math.hypot(confirmation.at.x - drag.to.x, confirmation.at.y - drag.to.y) < 6) continue;
    const points = [point(drag.to, drag.endMs), ...motion.map((e) => point(e, e.timestampMs)), point(confirmation.at, confirmation.startMs)];
    const path = Array.from({ length: Math.min(8, points.length) }, (_, n) => points[Math.round(n * (points.length - 1) / (Math.min(8, points.length) - 1))]);
    drag.interactiveContinuation = {
      kind: "drag_release_move_click_candidate", candidateOnly: true,
      startMs: drag.endMs, endMs: confirmation.endMs,
      completionEventIds: confirmation.sourceEventIds,
      from: points[0], to: points.at(-1),
      deltaPixels: [confirmation.at.x - drag.to.x, confirmation.at.y - drag.to.y],
      recordedMotionCount: motion.length, sampledPath: path,
      interpretation: "Confirm tool visually; release can end Height while unpressed motion sets Outline. Pixels are not scene units."
    };
  }
  return actions;
}

export function interactiveSessionImageGroups(actions) {
  const groups = [];
  for (let index = 0; index < actions.length; index++) {
    const action = actions[index];
    if (!action.interactiveContinuation) continue;
    const ids = new Set(action.interactiveContinuation.completionEventIds);
    const endIndex = actions.findIndex((a, i) => i > index && a.sourceEventIds?.some((id) => ids.has(id)));
    if (endIndex < 0) continue;
    const end = actions[endIndex], settled = actions[endIndex + 1];
    const hasExit = settled?.action === "press_key" && /^(ESC|ESCAPE)$/i.test(settled.key ?? "") &&
      sameWindow(end.window, settled.window) && settled.startMs >= end.endMs && settled.startMs - end.endMs <= 5000;
    const explicit = /bevel|poly|extrude|inset/i.test(JSON.stringify(action.target ?? {}));
    const menu = actions.slice(Math.max(0, index - 3), index).some((a) => a.action === "right_click");
    // Complete sessions outrank unrelated selection rectangles. Reserve all
    // three stages together instead of spending the face budget on first drags.
    groups.push({ index, score: 50 + (explicit ? 30 : 0) + (menu ? 4 : 0),
      screenshots: [...new Set([action.screenshotBefore, action.screenshotAfter, end.screenshotAfter,
        hasExit ? settled.screenshotAfter : null].filter(Boolean))] });
  }
  return groups.sort((a,b) => b.score - a.score || b.index - a.index);
}

function sameWindow(a,b) {
  if (!a || !b) return false;
  return a.processName === b.processName && a.processId === b.processId && a.width === b.width && a.height === b.height &&
    a.x === b.x && a.y === b.y && a.title === b.title;
}
function inViewport(p) { return p && p.relativeX > 0.12 && p.relativeX < 0.89 && p.relativeY > 0.10 && p.relativeY < 0.89; }
function point(p, timeMs) { return { x: p.x, y: p.y, relativeX: p.relativeX, relativeY: p.relativeY, timeMs }; }
