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
            visualCommandContext: event.visualCommandContext ?? null,
            sourceEventIds: []
          };
        }
        textRun.text += event.text;
        textRun.endMs = event.timestampMs;
        if (event.visualCommandContext) textRun.visualCommandContext = event.visualCommandContext;
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
          screenshotSelection: event.screenshotSelection ?? null,
          screenshotSelectionTimestampMs: event.screenshotSelectionTimestampMs ?? null,
          visualCommandContext: event.visualCommandContext ?? null,
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
        screenshotSelection: event.screenshotSelection ?? null,
        screenshotSelectionTimestampMs: event.screenshotSelectionTimestampMs ?? null,
        visualCommandContext: event.visualCommandContext ?? pointerDown.visualCommandContext ?? null,
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
  annotateVisualModificationContexts(actions);
  annotateCadInputEvidence(actions);
  annotatePersistentCanvasBaselines(actions);
  return actions;
}

export function annotatePersistentCanvasBaselines(actions, options = {}) {
  const maximumGapMs = options.maximumGapMs ?? 30000;
  const latestSettledByContext = new Map();

  for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
    const action = actions[actionIndex];
    delete action.persistentBaselineScreenshot;
    delete action.persistentBaselineSourceEventIds;

    if (!isLikelyCanvasChangeAction(action) || action.visualChange?.changed !== true ||
      !action.screenshotAfter) continue;

    const hasResolvedContext = Object.prototype.hasOwnProperty.call(
      action,
      "resolvedCadCommandContext"
    );
    const context = String(
      hasResolvedContext
        ? action.resolvedCadCommandContext ?? ""
        : action.visualComparisonContext ?? action.visualCommandContext ?? ""
    ).toUpperCase();
    if (!context) continue;

    const previous = latestSettledByContext.get(context);
    if (previous && Number.isFinite(action.startMs) && Number.isFinite(previous.endMs) &&
      action.startMs >= previous.endMs && action.startMs - previous.endMs <= maximumGapMs) {
      action.persistentBaselineScreenshot = previous.screenshotAfter;
      action.persistentBaselineSourceEventIds = previous.sourceEventIds ?? [];
    }
    latestSettledByContext.set(context, action);
  }

  return actions;
}

export function makeAnalysisBundle(recordingDir, actions, maxScreenshots = 12, options = {}) {
  const screenshots = selectAnalysisScreenshots(actions, maxScreenshots, options);

  return {
    recordingDir: path.resolve(recordingDir),
    actions,
    screenshots
  };
}

function selectAnalysisScreenshots(actions, maximum, options = {}) {
  if (maximum <= 0) return [];
  const ordered = [...new Set(actions.flatMap((action) => [
    action.persistentBaselineScreenshot,
    action.screenshotBefore,
    action.screenshotSelection,
    action.screenshotAfter
  ]).filter(Boolean))];
  if (ordered.length <= maximum) return ordered;

  // 对本地差分已经确认发生画布变化的动作，前后截图必须成对上传。
  // OFFSET/TRIM 的侧点可能没有可靠 CAD 坐标，但配准后的差分仍可确定方向和被删除区段。
  const highValuePairs = findHighValueVisualComparisonActions(actions);
  const eligiblePairs = actions.filter((action) =>
    isLikelyCanvasChangeAction(action) && action.visualChange?.changed === true &&
    action.screenshotBefore && action.screenshotAfter);
  // 优先完整覆盖 OFFSET/TRIM；若本段没有这类命令，仍均匀保留少量通用变化对。
  const changedPairs = highValuePairs.length > 0
    ? highValuePairs
    : selectEvenly(eligiblePairs, Math.min(2, Math.floor(maximum / 2)));
  const maximumPairs = Math.floor(maximum / 2);
  const pairedActions = options.preferRecent
    ? changedPairs.slice(-maximumPairs)
    : selectEvenly(changedPairs, maximumPairs);
  const priority = [];
  for (const action of pairedActions) {
    priority.push(action.screenshotBefore, action.screenshotAfter);
  }
  // 持久状态基线很重要，但不能挤掉任何当前操作的 before/after 完整证据对。
  // 连续修改时它通常就是上一操作的 after，因此大多不会额外占用图片名额。
  for (const action of pairedActions) {
    priority.push(action.persistentBaselineScreenshot);
  }

  // Enter 提交前的截图会同时保留键入值、当前提示、动态输入字段标签以及极轴角度。
  // 提交后的截图则可能是 OFFSET 侧点、LINE 终点、ROTATE 角度等真正产生最终几何的时刻。
  // 两者优先级都高于选择高亮中间态、普通画布概览和单纯的点击位置。
  const prioritizedActions = options.preferRecent ? [...actions].reverse() : actions;
  for (const action of prioritizedActions) {
    if (!isCommittedCadInputAction(action)) continue;
    priority.push(action.screenshotBefore, action.screenshotAfter);
  }

  // 三态录制的中间图用于辨认选择高亮和被修改对象；数值提交前后证据完整后再使用剩余名额。
  for (const action of pairedActions) {
    if (action.screenshotSelection) priority.push(action.screenshotSelection);
  }

  // 画布点击前的截图经常包含 AutoCAD 动态输入框中的业务坐标、半径或角度，
  // 在变化对之外继续优先保留，不能被普通概览图的均匀抽样跳过。
  for (const action of prioritizedActions) {
    if (!isLikelyCanvasPointerAction(action)) continue;
    if (action.screenshotBefore) priority.push(action.screenshotBefore);
  }

  const selected = [...new Set(priority.filter(Boolean))].slice(0, maximum);
  if (selected.length < maximum) {
    const remaining = ordered.filter((file) => !selected.includes(file));
    selected.push(...(options.preferRecent
      ? remaining.slice(-(maximum - selected.length))
      : selectEvenly(remaining, maximum - selected.length)));
  }
  return selected.sort((left, right) => ordered.indexOf(left) - ordered.indexOf(right));
}

function isLikelyCanvasPointerAction(action) {
  if (!["click", "double_click", "right_click", "middle_click", "drag"].includes(action.action))
    return false;
  const target = action.target;
  const window = action.window;
  if (!window?.width || !window?.height) return false;
  if (!target?.width || !target?.height) {
    const point = action.at ?? action.to ?? action.from;
    if (!point) return false;
    const relativeX = Number.isFinite(point.relativeX)
      ? point.relativeX : (point.x - window.x) / window.width;
    const relativeY = Number.isFinite(point.relativeY)
      ? point.relativeY : (point.y - window.y) / window.height;
    // UI Automation 关闭时，根据基本鼠标位置保留中央内容区的画布证据。
    return relativeX >= 0.01 && relativeX <= 0.99 && relativeY >= 0.10 && relativeY <= 0.95;
  }
  const role = String(target.role ?? "");
  const areaRatio = target.width * target.height / Math.max(1, window.width * window.height);
  return /Pane|Document|Custom/i.test(role) && areaRatio >= 0.2;
}

export function chunkActions(actions, maxActions = 150, options = {}) {
  if (!Number.isInteger(maxActions) || maxActions < 1)
    throw new Error("maxActions 必须是大于 0 的整数");
  const maxCanvasEvidence = options.maxCanvasEvidence ?? Number.POSITIVE_INFINITY;
  if (!(maxCanvasEvidence > 0)) throw new Error("maxCanvasEvidence 必须大于 0");
  annotateVisualModificationContexts(actions);
  const chunks = [];
  let current = [];
  let canvasEvidence = new Set();
  let activeCompoundCommand = null;
  const highValueComparisons = new Set(findHighValueVisualComparisonActions(actions));
  for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
    const action = actions[actionIndex];
    activeCompoundCommand = updateActiveCompoundCommand(
      activeCompoundCommand, action, options.commandCatalog);
    const evidence = criticalScreenshotEvidence(action, highValueComparisons);
    const additions = evidence.filter((file) => !canvasEvidence.has(file));
    if (current.length > 0 && (
      current.length >= maxActions ||
      (additions.length > 0 && canvasEvidence.size + additions.length > maxCanvasEvidence)
    )) {
      chunks.push(current);
      current = [];
      canvasEvidence = new Set();
    }
    current.push(action);
    evidence.forEach((file) => canvasEvidence.add(file));
    const compoundFinalized = isCadCompoundFinalizeAction(
      activeCompoundCommand, action, actions[actionIndex - 1]);
    if (compoundFinalized || isCadGeometryMaterializationBoundary(
      current, action, actions[actionIndex + 1], activeCompoundCommand)) {
      chunks.push(current);
      current = [];
      canvasEvidence = new Set();
      if (compoundFinalized) activeCompoundCommand = null;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks.length > 0 ? chunks : [[]];
}

function isCadGeometryMaterializationBoundary(current, action, nextAction, activeCompoundCommand = null) {
  if (!nextAction || current.length < 3) return false;
  if (action.action !== "press_key" || action.key !== "ENTER") return false;
  // ARRAY 的数值提交只更新关联阵列参数；在用户点击 Close Array 前，阵列仍处于编辑态，
  // 此时切段会让本段无法输出最终 ARRAY，也会使下一段的修改命令看不到展开成员。
  if (activeCompoundCommand === "ARRAY") return false;
  if (action.visualChange?.changed !== true || !action.screenshotBefore || !action.screenshotAfter)
    return false;
  const processName = String(action.window?.processName ?? nextAction.window?.processName ?? "");
  if (!/^acad(?:\.exe)?$/i.test(processName)) return false;
  if (!["click", "double_click", "right_click", "middle_click"].includes(nextAction.action)) return false;
  // 无 UIA 时命令名可能完全不可见；只在最近确有键入参数且 Enter 后画布持久变化时设检查点。
  // 即使该 Enter 只是多阶段命令的中间参数，下一段也能通过 rawActionTail 恢复状态；
  // 若它完成了 ARRAY 等复合创建，则本地可先展开稳定成员，供紧随其后的修改命令引用。
  return current.slice(-5, -1).some((item) =>
    item.action === "type_text" && String(item.text ?? "").trim().length > 0);
}

function updateActiveCompoundCommand(activeCommand, action, commandCatalog) {
  if (action.action === "press_key" && String(action.key ?? "").toUpperCase() === "ESCAPE")
    return null;
  if (action.action !== "type_text") return activeCommand;
  const raw = String(action.text ?? "").trim().toUpperCase();
  if (!raw) return activeCommand;
  const normalized = collapseRepeatedCharacters(raw);
  const direct = commandCatalog?.commands?.[raw]?.canonicalName ??
    commandCatalog?.aliasIndex?.[raw]?.command;
  const repeated = commandCatalog?.commands?.[normalized]?.canonicalName ??
    commandCatalog?.aliasIndex?.[normalized]?.command;
  const command = String(direct ?? repeated ?? "").toUpperCase();
  return command === "ARRAY" || command === "-ARRAY" ? "ARRAY" : activeCommand;
}

function isCadCompoundFinalizeAction(activeCommand, action, previousAction) {
  if (activeCommand !== "ARRAY" || action.action !== "click") return false;
  const searchable = searchableActionText(action);
  if (/Close\s*Array|ID_(?:CloseArray|Arrayeditclose)/i.test(searchable)) return true;

  // 无 UI Automation 模式下没有按钮 ID。关联阵列参数刚由 Enter 提交后，
  // 紧接着在 AutoCAD 顶部上下文功能区点击并发生持久变化，是 Close Array 的保守候选。
  // 这里只决定分析边界，不把该位置当作最终按钮身份或 CAD 几何证据。
  const point = action.at ?? action.to ?? action.from;
  const processName = String(action.window?.processName ?? "");
  return !action.target && /^acad(?:\.exe)?$/i.test(processName) &&
    Number.isFinite(point?.relativeY) && point.relativeY >= 0 && point.relativeY <= 0.12 &&
    previousAction?.action === "press_key" && previousAction.key === "ENTER" &&
    action.visualChange?.changed === true && Boolean(action.screenshotBefore && action.screenshotAfter);
}

function collapseRepeatedCharacters(value) {
  return String(value ?? "").replace(/(.)\1+/g, "$1");
}

function criticalScreenshotEvidence(action, highValueComparisons) {
  if (highValueComparisons.has(action) && action.visualChange?.changed === true &&
    action.screenshotBefore && action.screenshotAfter)
    return [
      action.persistentBaselineScreenshot,
      action.screenshotBefore,
      action.screenshotAfter
    ].filter(Boolean);
  if (isCommittedCadInputAction(action))
    return [action.screenshotBefore, action.screenshotAfter].filter(Boolean);
  if (isLikelyCanvasPointerAction(action) && action.screenshotBefore) return [action.screenshotBefore];
  return [];
}

function findHighValueVisualComparisonActions(actions) {
  annotateVisualModificationContexts(actions);
  return actions.filter((action) => {
    const isUsefulCommit = ["click", "double_click", "drag"].includes(action.action);
    return action.visualComparisonContext && isUsefulCommit &&
      isLikelyCanvasChangeAction(action) && action.visualChange?.changed === true &&
      action.screenshotBefore && action.screenshotAfter;
  });
}

function annotateVisualModificationContexts(actions) {
  let activeModification = null;
  let remainingActions = 0;
  for (const action of actions) {
    const hasResolvedContext = Object.prototype.hasOwnProperty.call(action, "resolvedCadCommandContext");
    if (hasResolvedContext && action.resolvedCadCommandContext === null) {
      delete action.visualComparisonContext;
      activeModification = null;
      continue;
    }
    const recordedCommand = String(
      hasResolvedContext ? action.resolvedCadCommandContext : action.visualCommandContext ?? ""
    ).toUpperCase();
    const command = recordedCommand || detectVisualModificationCommand(action);
    if (command) {
      activeModification = command;
      remainingActions = 18;
      action.visualComparisonContext = command;
      continue;
    }
    if (String(action.key ?? "").toUpperCase() === "ESCAPE") {
      activeModification = null;
      continue;
    }
    if (activeModification && isDifferentRibbonCommand(action)) {
      activeModification = null;
      continue;
    }
    if (!activeModification) continue;
    remainingActions -= 1;
    if (remainingActions < 0) {
      activeModification = null;
      continue;
    }
    action.visualComparisonContext = activeModification;
  }
}

function annotateCadInputEvidence(actions) {
  let activeCommand = null;
  let expectsOffsetDistance = false;
  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index];
    if (String(action.key ?? "").toUpperCase() === "ESCAPE") {
      activeCommand = null;
      expectsOffsetDistance = false;
      continue;
    }

    const command = String(action.visualCommandContext ?? "").toUpperCase() ||
      detectCadCommand(action);
    const targetName = String(action.target?.name ?? "").trim().toUpperCase();
    const isCommandActivation = Boolean(command && (
      targetName === command ||
      action.target?.automationId && new RegExp(`ID[_-]?${command}`, "i").test(action.target.automationId) ||
      activeCommand !== command
    ));
    if (isCommandActivation) {
      activeCommand = command;
      expectsOffsetDistance = command === "OFFSET";
    }

    if (activeCommand) action.cadCommandContext = activeCommand;

    // 使用 OF/OFFSET 后直接键入的第一个已提交数值，是精确业务输入，不是像素推算。
    // 某些 AutoCAD 动态输入事件直到 Enter 才暴露 canonical command，因此也向前标注相邻文本。
    if (action.action === "press_key" && action.key === "ENTER") {
      const previous = actions[index - 1];
      const numeric = parseExactNumber(previous?.action === "type_text" ? previous.text : null);
      if (numeric !== null && activeCommand) {
        const parameterName = activeCommand === "OFFSET" && expectsOffsetDistance
          ? "distance"
          : activeCommand === "LINE"
            ? "distance"
            : activeCommand === "CIRCLE"
              ? "radius"
              : "committed_value";
        const evidence = {
          command: activeCommand,
          parameterName,
          value: numeric,
          unit: "cad_drawing_unit",
          exact: true,
          valueExact: true,
          parameterRoleExact: parameterName !== "committed_value",
          source: "keyboard_committed",
          sourceEventIds: [...(previous.sourceEventIds ?? []), ...(action.sourceEventIds ?? [])]
        };
        previous.cadInputEvidence = evidence;
        action.cadInputEvidence = evidence;
        if (activeCommand === "OFFSET" && expectsOffsetDistance) expectsOffsetDistance = false;
      }
    }
  }
}

function isCommittedCadInputAction(action) {
  return action?.action === "press_key" && String(action.key ?? "").toUpperCase() === "ENTER" &&
    action.cadInputEvidence?.exact === true && Boolean(action.screenshotBefore);
}

function parseExactNumber(value) {
  const normalized = String(value ?? "").trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return null;
  const result = Number(normalized);
  return Number.isFinite(result) ? result : null;
}

function detectVisualModificationCommand(action) {
  const searchable = searchableActionText(action);
  for (const command of [
    "OFFSET", "TRIM", "EXTEND", "FILLET", "CHAMFER", "BREAK",
    "STRETCH", "MOVE", "COPY", "ROTATE", "SCALE", "MIRROR"
  ]) {
    const token = new RegExp(`(^|\\W)${command}(\\W|$)|ID_${command}`, "i");
    if (token.test(searchable)) return command;
  }
  return null;
}

function detectCadCommand(action) {
  const modification = detectVisualModificationCommand(action);
  if (modification) return modification;
  const searchable = searchableActionText(action);
  for (const command of [
    "LINE", "PLINE", "CIRCLE", "ARC", "RECTANG", "POLYGON", "ELLIPSE",
    "ARRAY", "ERASE"
  ]) {
    const token = new RegExp(`(^|\\W)${command}(\\W|$)|ID[_-]?${command}`, "i");
    if (token.test(searchable)) return command;
  }
  return null;
}

function isDifferentRibbonCommand(action) {
  if (!["click", "double_click"].includes(action.action)) return false;
  const searchable = searchableActionText(action);
  return /ID_Panel|RibbonItemControl|\bRibbon\b/i.test(searchable) &&
    detectVisualModificationCommand(action) === null;
}

function searchableActionText(action) {
  return [
    action.text,
    action.key,
    action.window?.title,
    action.target?.name,
    action.target?.className,
    action.target?.automationId,
    ...(action.target?.ancestors ?? []).flatMap((ancestor) => [
      ancestor.name, ancestor.className, ancestor.automationId
    ])
  ].filter(Boolean).join(" ");
}

function isLikelyCanvasChangeAction(action) {
  if (isLikelyCanvasPointerAction(action)) return true;
  const searchable = searchableActionText(action);
  // AutoCAD 取点期间键盘焦点会暂时落在动态输入小窗，不能因此把提交后的画布截图对丢掉。
  return /CAcDynInputWndControl|ACADDM_CHILD_DXGI_FLIP_MODE_VIEW_CLASS/i.test(searchable);
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
