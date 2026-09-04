import { interactiveSessionImageGroups } from "./threedsmax-interactions.mjs";

export function selectThreeDsMaxScreenshots(actions, maximum, options = {}) {
  const all = listThreeDsMaxScreenshots(actions);
  if (options.uploadAll === true) return all;
  if (maximum <= 0) return [];
  if (all.length <= maximum) return all;

  const priority = [];
  priority.push(...(options.priorityScreenshots ?? []).filter((name) => all.includes(name)));
  // Also preserve full sessions when visual-face tracking is disabled. Bounded
  // within the existing image budget; no extra API request or blanket upload.
  let sessionBudget = Math.min(8, Math.floor(maximum / 3));
  for (const group of interactiveSessionImageGroups(actions)) {
    if (group.screenshots.length > sessionBudget) continue;
    priority.push(...group.screenshots);
    sessionBudget -= group.screenshots.length;
  }
  // Numeric Bevel caddies can disappear on OK; preserve their pre-commit frame.
  for (const action of actions.filter((item) => hasEvidence(item, "subobject_parameters"))) {
    priority.push(...evidenceScreenshots(action, "subobject_parameters", ["before", "after"]));
    priority.push(action.screenshotAfter);
  }
  const creationParameterActions = findCreationParameterActions(actions);
  const numericTransformActions = actions.filter((item) =>
    hasEvidence(item, "viewport_transform_overlay") &&
    hasEvidence(item, "transform_type_in") &&
    isObjectTransformDrag(item) &&
    !isLikelySelectionRectangle(item) &&
    (!creationParameterActions.includes(item) || isCloneDrag(item)));

  // These are drag candidates, not proven object transforms. Keep panel state
  // alongside XYZ so Bevel/sub-object edits cannot be mistaken for whole objects.
  for (const action of numericTransformActions) {
    priority.push(...evidenceScreenshots(action, "transform_type_in", ["before", "after"]));
    // Name and Color 局部图给出当前选中对象名。没有这张图，即使 XYZ 清晰，
    // 模型也可能因无法把数值绑到稳定 object ID 而省略整个操作。
    priority.push(...evidenceScreenshots(action, "selected_object", ["before"]));
    priority.push(...evidenceScreenshots(action, "command_panel_parameters", ["after"]));
  }
  for (const action of evenlySelect(actions.filter((item) => hasEvidence(item, "subobject_operation_context")), 3)) {
    priority.push(...evidenceScreenshots(action, "subobject_operation_context", ["before", "after"]));
  }

  // Shift 拖拽是克隆的唯一可靠边界。先保留同一动作的数值前后对、视口增量和工具状态，
  // 避免大量普通面板图把真正决定副本位置的局部证据挤出请求。
  for (const action of actions.filter(isCloneDrag)) {
    priority.push(...evidenceScreenshots(action, "viewport_transform_overlay", ["after"]));
  }

  // Clone Options 很小且包含离散语义，每个交互保留最终态即可。
  for (const action of actions.filter((item) => hasEvidence(item, "clone_options")))
    priority.push(...evidenceScreenshots(action, "clone_options", ["after"]));

  // 基本体创建拖拽结束后的 Parameters 是尺寸真值。禁止用较早的空 Create 面板
  // 或较晚选中其它对象后的同一区域替代它。
  for (const action of creationParameterActions) {
    const cropped = evidenceScreenshots(action, "command_panel_parameters", ["after"]);
    priority.push(...(cropped.length > 0 ? cropped : [action.screenshotAfter]));
  }
  if (creationParameterActions.length === 0) {
    const parameterActions = actions.filter((item) => hasEvidence(item, "command_panel_parameters"));
    for (const action of evenlySelect(parameterActions, Math.min(2, parameterActions.length)))
      priority.push(...evidenceScreenshots(action, "command_panel_parameters", ["after"]));
  }

  // Shift+A 是 Quick Align。它后面的第一次视口点击是目标对象，而不是普通选择；
  // 但只保留辨认 source→target 所需的最小图组，并排在尺寸、拖拽数值和目标身份之后。
  for (const sequence of findQuickAlignSequences(actions)) {
    const shortcut = actions[sequence.firstIndex];
    const lastShortcut = actions[sequence.lastIndex];
    const target = actions[sequence.targetIndex];
    priority.push(shortcut.screenshotBefore);
    priority.push(...evidenceScreenshots(shortcut, "command_panel_context", ["before"]));
    priority.push(...evidenceScreenshots(lastShortcut, "command_panel_context", ["after"]));
    if (target) {
      priority.push(target.screenshotAfter ?? target.screenshotSelection ?? target.screenshotBefore);
      priority.push(...evidenceScreenshots(target, "selected_object", ["after"]));
    }
  }

  // 普通 Move/Rotate/Scale 和数值提交必须成对读取。按动作均匀抽样，不能按图片顺序
  // 让最早动作的所有局部图占满额度。
  for (const action of numericTransformActions.filter((item) => !isCloneDrag(item))) {
    priority.push(...evidenceScreenshots(action, "viewport_transform_overlay", ["after"]));
  }
  let fallbackNumericActions = [];
  if (numericTransformActions.length === 0) {
    fallbackNumericActions = actions.filter((item) =>
      hasEvidence(item, "transform_type_in") && isObjectTransformDrag(item));
    for (const action of evenlySelect(fallbackNumericActions, Math.min(2, fallbackNumericActions.length)))
      priority.push(...evidenceScreenshots(action, "transform_type_in", ["before", "after"]));
  }

  // 变换工具只需少量局部图确认 W/E/R 模式，实际数值仍由上面的同事件 XYZ 对决定。
  for (const action of evenlySelect([...actions.filter((item) =>
    hasEvidence(item, "transform_toolbar") &&
    (isCloneDrag(item) || numericTransformActions.includes(item) || fallbackNumericActions.includes(item)))], 2))
    priority.push(...evidenceScreenshots(action, "transform_toolbar", ["after"]));

  const contextActions = actions.filter((item) =>
    hasEvidence(item, "command_panel_context") && isHighValueUiAction(item));
  for (const action of evenlySelect(contextActions, Math.min(3, contextActions.length)))
    priority.push(...evidenceScreenshots(action, "command_panel_context", ["after"]));

  const changed = actions.filter((action) =>
    action.visualChange?.changed === true && action.screenshotBefore && action.screenshotAfter);
  for (const action of evenlySelect(changed, Math.floor(maximum / 2)))
    priority.push(action.screenshotBefore, action.screenshotAfter);
  for (const action of actions) {
    if (isHighValueUiAction(action))
      priority.push(action.screenshotBefore, action.screenshotSelection, action.screenshotAfter);
  }
  const pairs = new Map();
  for (const action of actions) {
    const pair = evidenceScreenshots(action, "transform_type_in", ["before", "after"]);
    if (pair.length === 2) for (const name of pair) pairs.set(name, pair);
  }
  const selected = [];
  const append = (name) => {
    const group = (pairs.get(name) ?? [name]).filter((file) => !selected.includes(file));
    if (selected.length + group.length <= maximum) selected.push(...group);
  };
  for (const name of new Set(priority.filter(Boolean))) append(name);
  const remaining = all.filter((file) => !selected.includes(file));
  for (const name of evenlySelect(remaining, maximum - selected.length)) append(name);
  return selected.sort((left, right) => all.indexOf(left) - all.indexOf(right));
}

function evidenceScreenshots(action, kind, phases) {
  const evidence = action.transformEvidence ?? [];
  const matched = phases.flatMap((phase) => evidence
    .filter((item) => item.kind === kind && item.phase === phase)
    .map((item) => item.screenshot)
  ).filter(Boolean);
  if (matched.length > 0) return matched;
  // 兼容早期录制和单元证据：没有 phase 时把该局部图视为最终态。
  return phases.includes("after")
    ? evidence.filter((item) => item.kind === kind && !item.phase).map((item) => item.screenshot).filter(Boolean)
    : [];
}

function hasEvidence(action, kind) {
  return (action.transformEvidence ?? []).some((item) => item.kind === kind);
}

function isCloneDrag(action) {
  return action.action === "drag" && action.button === "left" &&
    (action.modifiers ?? []).includes("SHIFT");
}

function isQuickAlignShortcut(action) {
  return action.action === "type_text" && /^A$/i.test(String(action.text ?? "")) &&
    (action.modifiers ?? []).includes("SHIFT");
}

function findQuickAlignSequences(actions) {
  const results = [];
  for (let index = 0; index < actions.length; index += 1) {
    if (!isQuickAlignShortcut(actions[index])) continue;
    const firstIndex = index;
    while (index + 1 < actions.length && isQuickAlignShortcut(actions[index + 1])) index += 1;
    let targetIndex = index + 1;
    while (targetIndex < actions.length && isQuickAlignShortcut(actions[targetIndex])) targetIndex += 1;
    results.push({ firstIndex, lastIndex: index, targetIndex });
  }
  return results;
}

function isNumericTransformBoundary(action) {
  return action.action === "drag" || action.action === "press_key" &&
    /^(ENTER|RETURN)$/i.test(String(action.key ?? ""));
}

function isObjectTransformDrag(action) {
  return action.action === "drag" && action.button === "left";
}

function isLikelySelectionRectangle(action) {
  if (!isObjectTransformDrag(action) || isCloneDrag(action)) return false;
  const from = action.from;
  const to = action.to;
  const deltaX = Math.abs(Number(to?.relativeX) - Number(from?.relativeX));
  const deltaY = Math.abs(Number(to?.relativeY) - Number(from?.relativeY));
  // 同时横跨视口宽高大片区域的对角拖拽通常是框选；普通单轴变换即使距离大，
  // 也通常只有一个屏幕方向占主导。这里只用于截图名额，不用来构造场景操作。
  return Number.isFinite(deltaX) && Number.isFinite(deltaY) && deltaX >= 0.20 && deltaY >= 0.20;
}

function findCreationParameterActions(actions) {
  const results = [];
  for (let index = 0; index < actions.length; index += 1) {
    if (!isPrimitiveCreateAction(actions[index])) continue;
    const candidates = [];
    for (const action of actions.slice(index + 1, index + 7)) {
      if (action.action === "press_key" && /^(ESCAPE|ESC)$/i.test(String(action.key ?? ""))) break;
      if (isPrimitiveCreateAction(action)) break;
      if (isViewportCreationStep(action)) candidates.push(action);
      if (candidates.length >= 2) break;
    }
    for (const candidate of candidates)
      if (!results.includes(candidate)) results.push(candidate);
  }
  return results;
}

function isViewportCreationStep(action) {
  if (!["drag", "click"].includes(action.action) || action.button !== "left") return false;
  const point = action.at ?? action.to ?? action.from;
  const relativeX = Number(point?.relativeX);
  const relativeY = Number(point?.relativeY);
  return Number.isFinite(relativeX) && Number.isFinite(relativeY) &&
    relativeX >= 0.01 && relativeX <= 0.90 && relativeY >= 0.10 && relativeY <= 0.95;
}

function isPrimitiveCreateAction(action) {
  const text = [
    action.target?.name,
    action.target?.automationId,
    ...(action.target?.ancestors ?? []).flatMap((item) => [item.name, item.automationId])
  ].filter(Boolean).join(" ");
  const exactUiTarget = /\b(Box|Sphere|GeoSphere|Cylinder|Tube|Torus|Teapot|Plane|Cone|Pyramid|TextPlus)\b/i.test(text) &&
    /Create|Object Type|CreateButtonPanel/i.test(text);
  if (exactUiTarget) return true;

  // UI Automation 可关闭。此时用命令面板顶部 Standard Primitives 按钮区域建立候选，
  // 但只有后面立即出现视口创建阶段时 findCreationParameterActions 才会采用。
  const point = action.at ?? action.to ?? action.from;
  const relativeX = Number(point?.relativeX);
  const relativeY = Number(point?.relativeY);
  return action.action === "click" && action.button === "left" &&
    Number.isFinite(relativeX) && Number.isFinite(relativeY) &&
    relativeX >= 0.90 && relativeY >= 0.14 && relativeY <= 0.30 &&
    hasEvidence(action, "command_panel_parameters");
}

function transformEvidencePriority(item) {
  return ({
    viewport_transform_overlay: 0,
    clone_options: 1,
    context_menu: 2,
    command_panel_parameters: 3,
    transform_type_in: 4,
    command_panel_context: 5,
    transform_toolbar: 6,
    selected_object: 7,
    scene_explorer: 8
  })[item?.kind] ?? 9;
}

export function listThreeDsMaxScreenshots(actions) {
  return [...new Set(actions.flatMap((action) => [
    action.screenshotBefore,
    action.screenshotSelection,
    action.screenshotAfter,
    ...(action.transformEvidence ?? []).map((item) => item.screenshot)
  ]).filter(Boolean))];
}

function isHighValueUiAction(action) {
  const text = [
    action.action, action.text, action.key, action.target?.name, action.target?.automationId,
    ...(action.target?.ancestors ?? []).flatMap((item) => [item.name, item.automationId])
  ].filter(Boolean).join(" ");
  return /Create|Modify|Box|Sphere|Cylinder|Torus|Teapot|Plane|Move|Rotate|Scale|Clone|Delete|Modifier|Spinner|Parameter|Quick Align|Affect Pivot|Center to Object/i.test(text) ||
    isQuickAlignShortcut(action);
}

function evenlySelect(items, maximum) {
  if (maximum <= 0 || items.length === 0) return [];
  if (items.length <= maximum) return [...items];
  if (maximum === 1) return [items.at(-1)];
  return Array.from({ length: maximum }, (_, index) =>
    items[Math.round(index * (items.length - 1) / (maximum - 1))]);
}
