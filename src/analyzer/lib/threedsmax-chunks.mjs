import { chunkActions } from "./trace.mjs";

const isShiftDrag = (action) => action.action === "drag" && action.button === "left" &&
  (action.modifiers ?? []).includes("SHIFT");
const isCloneDialog = (action) => /Clone Options/i.test(action.window?.title ?? "") ||
  (action.transformEvidence ?? []).some((item) => item.kind === "clone_options");

export function chunkThreeDsMaxActions(actions, maxActions, options = {}) {
  const chunks = chunkActions(actions, maxActions, options);
  // A release/move/click session must not lose its confirmation at the chunk
  // boundary. Move its small tail forward without duplicating events.
  for (let index = 0; index + 1 < chunks.length; index++) {
    const left = chunks[index], right = chunks[index + 1];
    const start = left.findLastIndex((a) => a.interactiveContinuation && right.slice(0, 3).some((b) =>
      b.sourceEventIds?.some((id) => a.interactiveContinuation.completionEventIds.includes(id))));
    if (start < 0 || left.length - start > 4 || left.length - start + right.length > maxActions) continue;
    right.unshift(...left.splice(start));
  }
  // Move a near-boundary Shift gesture into the following dialog chunk instead
  // of losing the original transform context. Never reorder or duplicate events.
  for (let index = 0; index + 1 < chunks.length; index++) {
    const left = chunks[index];
    const right = chunks[index + 1];
    if (!right.slice(0, 8).some(isCloneDialog)) continue;
    const start = left.findLastIndex(isShiftDrag);
    if (start < 0 || left.length - start > 8) continue;
    const tail = left.slice(start);
    if (tail.length + right.length > maxActions) continue;
    left.splice(start);
    right.unshift(...tail);
  }
  return chunks.filter((chunk) => chunk.length > 0);
}

export function previousThreeDsMaxActionTail(chunks, index) {
  return index > 0 ? chunks[index - 1].slice(-8) : [];
}

export function selectPreviousThreeDsMaxContextImages(tail, maximum = 4) {
  // Last frame plus the last Shift gesture's numerical pair. Limited to four
  // images, deducted from the existing per-request budget, not added to it.
  const last = tail.at(-1);
  const shift = tail.findLast(isShiftDrag);
  return [...new Set([
    last?.screenshotAfter,
    ...(shift?.transformEvidence ?? []).filter((item) => item.kind === "transform_type_in").map((item) => item.screenshot),
    shift?.screenshotAfter,
    last?.screenshotBefore
  ].filter(Boolean))].slice(0, maximum);
}
