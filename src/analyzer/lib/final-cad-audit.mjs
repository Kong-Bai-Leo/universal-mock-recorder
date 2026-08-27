import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { optimizeScreenshots } from "./image-optimizer.mjs";
import { composeTrimEvidence } from "./trim-evidence.mjs";
import { MOCK_WORKFLOW_SCHEMA, validateWorkflow } from "./workflow.mjs";

const TOPOLOGY_COMMANDS = new Set([
  "TRIM", "EXTEND", "FILLET", "CHAMFER", "BREAK"
]);

const FINAL_CAD_AUDIT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    changed: { type: "boolean" },
    findings: { type: "array", items: { type: "string" } },
    cadProgram: MOCK_WORKFLOW_SCHEMA.properties.cadProgram
  },
  required: ["changed", "findings", "cadProgram"]
};

export const FINAL_CAD_AUDIT_INSTRUCTIONS = `
你是 AutoCAD 最终几何审计器。输入包含已经通过结构校验的 cadProgram、修改命令的原始交互证据，以及录制结束时的最终画布截图。

任务不是重做整个操作识别，而是把 cadProgram 解析执行后的最终有效几何，与 final_canvas_target 截图逐项核对，并返回完整替换 cadProgram。

硬性规则：
1. final_canvas_target 是本次真实录制的正确最终画布，不是脚本回放结果。以它的可见拓扑为准；选择框、光标、动态提示和高亮不是几何。
2. 保留现有 cadProgram 中已有充分证据的命令、精确数值、实体 ID 和顺序。只有发现最终几何遗漏、错误保留或错误删除时才修改。
3. 尤其复核 TRIM/EXTEND/FILLET/CHAMFER/BREAK。逐个比较每条最终直线、圆和圆弧是否仍穿过本应终止的交点，不能只检查命令是否出现过。
4. 一次 TRIM 会删除被点击点所在的、由相邻切割交点或原端点限定的整个区段；不等于只删除点击附近的几个像素。若直线从圆内或圆边开始并延伸到圆外，最终图显示它在圆边终止，则用直线—圆方程求严格交点，并把保留段写成新的 line resultGeometry。
5. 若一条线穿过圆且被删除的是圆内区段，应根据原线端点、圆心、半径和点击所在区段解析保留的一段或多段。截图只决定对象身份与保留哪段，禁止用像素比例估算 CAD 长度。
6. 细的单像素线段消失也属于持久几何变化。不得仅因全屏差异较小，就把有明确前后图的修剪点击归为无意义输入。
7. 对每个已知线—线、线—圆交点都要检查交点两侧实际保留的区段。一次 TRIM 会话中，用户可能连续点击并分别修改交点两侧的两个实体；不能因为已经修剪了斜线，就默认与它相交的竖线无需再次修剪。最终图若显示竖线终止于斜线交点，必须删除竖线越过该交点的突出段。
8. 局部图片标签中的 cropRectOriginal、clickOriginal、clickCrop、scale 是局部图到原图的严格映射。先在局部图识别消失区段，再用 original=(cropRect.xy + local/scale) 映射回完整画布确认对象身份。不同裁剪图坐标不能直接互相比较。
9. trim_click_aligned_comparison 把同一次 TRIM 点击的 persistent_baseline（若有）、immediate_before、selection_feedback、settled_after 按相同裁剪范围并排。必须逐图独立比较 immediate_before 与 settled_after，禁止把相邻 pair 的截图混用。persistent_baseline 只用于检查连续状态，不得覆盖即时前后图中明确的本次变化；CAD 的重绘、高亮或截图时序可能令它暂时未显示待选对象。黄圈只标示点击位置，不属于画布几何。
10. trimClickCoverage 会列出当前 cadProgram 已分配给每次点击的 operation。即使某个 pair 已有 operation，也必须验证该 operation 修改的实体和 resultGeometry 是否与该 pair 中真实消失的线段一致；错误归因应替换，不能因“已有 operation”而跳过。
11. selection_feedback 中出现红叉、提示或高亮，不足以证明点击无效；只要 settled_after 相对 immediate_before 永久少了一段线，该点击就是有效几何修改。即使 persistent_baseline 与 settled_after 看起来相同，也不能否定即时前后图中明确消失的被点击区段。只有 immediate_before 与 settled_after 的稳定几何确实相同才可判定无效。
12. 每个新增或修正 operation 的实体引用必须按时间顺序合法：只能引用之前已经生成且当时仍存在的实体。修改操作应让 resultGeometry.sourceEntityIds 指回被修改实体。
13. 若早期分段已经发生的 TRIM 因中间圆弧 ID 缺失而没有写入 cadProgram，不要因此放弃全部后续 TRIM，也不要创建幽灵中间实体。只要原始源圆/线、全部切割边和每次点击的前后证据足以严格确定最终拓扑，允许把作用于同一源实体的连续 TRIM 规范化为一个 composite TRIM：引用最初合法源实体和所有实际切割边，一次输出最终全部保留圆弧/线段，并合并所有相关 sourceEventIds/sourceScreenshots。其结果必须与 final_canvas_target 一致。
14. composite TRIM 的每个圆弧端点仍必须来自已知线—圆解析交点；截图只决定删除哪些角区间。不同源实体（例如一条斜线和一条竖线）不得无依据合并为同一个 source；应分别输出替换操作。
15. 如果现有结果已经与最终画布一致，changed=false 并原样返回 cadProgram。若修改，changed=true，并在 findings 简要列出修复的拓扑差异。
16. 返回内容必须符合给定 JSON Schema；不要输出 SCR、解释性 Markdown 或 JSON 补丁。
`;

export function shouldRunFinalCadAudit(plan, actions, options = {}) {
  if (options.enabled === false || options.includeScreenshots === false) return false;
  if (plan?.cadProgram?.format !== "autocad_command_ir") return false;
  if (actions.some((action) => TOPOLOGY_COMMANDS.has(resolveCommand(action)))) return true;
  const stateCommands = [plan?.commandState?.activeCommand, plan?.commandState?.lastCompletedCommand]
    .map((command) => String(command ?? "").toUpperCase());
  if (stateCommands.some((command) => TOPOLOGY_COMMANDS.has(command))) return true;
  return [plan?.summary, ...(plan?.warnings ?? []), ...(plan?.cadProgram?.warnings ?? [])]
    .some((text) => /\b(?:TRIM|EXTEND|FILLET|CHAMFER|BREAK)\b/i.test(String(text ?? "")));
}

export async function auditFinalCadProgram({
  client,
  plan,
  actions,
  commandStateTimeline = [],
  recordingDir,
  analysisOptions = {},
  minimumConfidence = 0.65
}) {
  const auditOptions = analysisOptions.finalCadVisualAudit ?? {};
  const contextualActions = inferTopologyActionContexts(actions, commandStateTimeline, plan);
  if (!shouldRunFinalCadAudit(plan, contextualActions, {
    enabled: auditOptions.enabled,
    includeScreenshots: analysisOptions.includeScreenshots
  })) {
    return {
      plan,
      audit: { attempted: false, changed: false, screenshots: [], findings: [], skipped: "not_required" }
    };
  }

  const finalScreenshot = await findFinalScreenshot(recordingDir);
  if (!finalScreenshot) {
    return {
      plan,
      audit: {
        attempted: false,
        changed: false,
        screenshots: [],
        findings: [],
        skipped: "no_final_screenshot"
      }
    };
  }

  const limit = Math.max(3, auditOptions.maxScreenshots ?? analysisOptions.maxScreenshotsPerRequest ?? 16);
  const relevantActions = contextualActions.filter((action) => TOPOLOGY_COMMANDS.has(resolveCommand(action)));
  const trimActions = relevantActions.filter(isCanvasTrimAction);
  const selectedTrimActions = sampleEvenly(trimActions, Math.min(trimActions.length, limit - 1));
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mock-recorder-final-cad-audit-"));

  try {
    const finalInputs = [makeAuditScreenshotInput(
      recordingDir, finalScreenshot, finalScreenshot, relevantActions)];
    const optimizedFinal = await optimizeScreenshots(finalInputs, tempDir, analysisOptions);
    const trimComparisons = await composeTrimEvidence(
      selectedTrimActions, recordingDir, tempDir, {
        ...analysisOptions,
        ...(auditOptions.trimEvidence ?? {})
      });
    const remaining = Math.max(0, limit - optimizedFinal.length - trimComparisons.length);
    const nonTrimActions = relevantActions.filter((action) => resolveCommand(action) !== "TRIM");
    const supplementalFiles = selectFinalCadAuditFiles(
      nonTrimActions, finalScreenshot, remaining + 1)
      .filter((file) => file !== finalScreenshot)
      .slice(0, remaining);
    const supplementalInputs = supplementalFiles.map((file) =>
      makeAuditScreenshotInput(recordingDir, file, finalScreenshot, nonTrimActions));
    const optimizedSupplemental = await optimizeScreenshots(
      supplementalInputs, path.join(tempDir, "supplemental"), analysisOptions);
    const screenshots = [...optimizedFinal, ...trimComparisons, ...optimizedSupplemental];
    const auditResult = await client.analyze({
      instructions: FINAL_CAD_AUDIT_INSTRUCTIONS,
      payload: {
        format: "FinalCadGeometryAudit",
        version: "0.1",
        outputLanguage: analysisOptions.language ?? "zh-CN",
        minimumConfidence,
        existingCadProgram: plan.cadProgram,
        candidateModificationActions: relevantActions.map(compactAuditAction),
        trimClickCoverage: selectedTrimActions.map((action) => ({
          action: compactAuditAction(action),
          existingOperations: findOperationsForAction(plan.cadProgram, action)
        })),
        finalCanvasScreenshot: finalScreenshot
      },
      screenshots,
      outputSchema: FINAL_CAD_AUDIT_SCHEMA,
      outputName: "final_cad_geometry_audit",
      outputDescription: "核对录制结束画布后得到的完整 AutoCAD CAD IR"
    });
    const auditedPlan = validateWorkflow({
      ...plan,
      cadProgram: auditResult.cadProgram,
      warnings: [...new Set([...(plan.warnings ?? []), ...(auditResult.findings ?? [])])]
    }, {
      minimumConfidence,
      validateCadReferences: true
    });
    return {
      plan: auditedPlan,
      audit: {
        attempted: true,
        changed: auditResult.changed,
        findings: auditResult.findings,
        screenshots: screenshots.map((item) => ({
          source: formatAuditSource(recordingDir, item),
          uploadedAs: item.evidenceRole,
          label: item.label,
          imageMapping: item.imageMapping ?? null,
          sourceEventIds: item.sourceEventIds ?? []
        }))
      }
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

export function selectFinalCadAuditFiles(actions, finalScreenshot, limit = 16) {
  const selected = [finalScreenshot];
  const pairBudget = Math.max(1, Math.floor((limit - 1) / 2));
  const trimActions = actions.filter((action) => resolveCommand(action) === "TRIM");
  const otherActions = actions.filter((action) => resolveCommand(action) !== "TRIM");
  const chosen = sampleEvenly(trimActions, Math.min(pairBudget, trimActions.length));
  if (chosen.length < pairBudget)
    chosen.push(...sampleEvenly(otherActions, pairBudget - chosen.length));

  for (const action of chosen) {
    addUnique(selected, action.persistentBaselineScreenshot ?? action.screenshotBefore);
    addUnique(selected, action.screenshotAfter);
  }
  for (const action of chosen) {
    if (selected.length >= limit) break;
    addUnique(selected, action.screenshotSelection);
  }
  return selected.filter(Boolean).slice(0, limit);
}

function makeAuditScreenshotInput(recordingDir, file, finalScreenshot, actions) {
  if (file === finalScreenshot) {
    return {
      path: path.join(recordingDir, file),
      label: `${file}（final_canvas_target：录制结束时的权威最终画布；必须与 existingCadProgram 的最终有效几何逐项核对）`,
      evidenceRole: "final_canvas_target"
    };
  }
  const action = actions.find((candidate) => [
    candidate.persistentBaselineScreenshot,
    candidate.screenshotBefore,
    candidate.screenshotSelection,
    candidate.screenshotAfter
  ].includes(file));
  const command = resolveCommand(action) || "MODIFY";
  const phase = file === action?.screenshotAfter
    ? "after"
    : file === action?.screenshotSelection ? "selection" : "before_or_baseline";
  const item = {
    path: path.join(recordingDir, file),
    label: `${file}（final_audit_${phase}；命令=${command}；events=${action?.sourceEventIds?.join("+") ?? "unknown"}）`,
    evidenceRole: `final_audit_${phase}`
  };
  if (Number.isFinite(action?.at?.x) && Number.isFinite(action?.at?.y)) {
    item.crop = {
      centerX: action.at.x,
      centerY: action.at.y,
      width: 1400,
      height: 900
    };
  }
  return item;
}

async function findFinalScreenshot(recordingDir) {
  const screenshotDir = path.join(recordingDir, "screenshots");
  let files;
  try {
    files = await fs.readdir(screenshotDir);
  } catch {
    return null;
  }
  const finalFile = files
    .filter((file) => /^evt-\d+(?:-(?:before|after))?\.(?:jpe?g|png)$/i.test(file))
    .sort((left, right) => left.localeCompare(right, "en"))
    .at(-1);
  return finalFile ? `screenshots/${finalFile}` : null;
}

function compactAuditAction(action) {
  return {
    action: action.action,
    at: action.at ?? null,
    visualChange: action.visualChange ?? null,
    screenshotBefore: action.screenshotBefore ?? null,
    screenshotSelection: action.screenshotSelection ?? null,
    screenshotAfter: action.screenshotAfter ?? null,
    persistentBaselineScreenshot: action.persistentBaselineScreenshot ?? null,
    visualCommandContext: action.visualCommandContext ?? null,
    visualComparisonContext: action.visualComparisonContext ?? null,
    resolvedCadCommandContext: action.resolvedCadCommandContext ?? null,
    inferredCadCommandContext: action.inferredCadCommandContext ?? null,
    sourceEventIds: action.sourceEventIds ?? []
  };
}

function isCanvasTrimAction(action) {
  if (resolveCommand(action) !== "TRIM") return false;
  if (!Number.isFinite(action?.at?.x) || !Number.isFinite(action?.at?.y)) return false;
  if (!action?.screenshotAfter) return false;
  if (!action?.persistentBaselineScreenshot && !action?.screenshotBefore) return false;
  const targetRole = String(action?.target?.role ?? "").toLowerCase();
  const targetClass = String(action?.target?.className ?? action?.target?.class ?? "").toLowerCase();
  const targetName = String(action?.target?.name ?? "").toLowerCase();
  if (targetRole.includes("button") || targetClass.includes("ribbon") || targetName.includes("trim"))
    return false;
  return true;
}

function findOperationsForAction(cadProgram, action) {
  const eventIds = new Set(action.sourceEventIds ?? []);
  return (cadProgram?.operations ?? [])
    .filter((operation) => (operation.sourceEventIds ?? []).some((eventId) => eventIds.has(eventId)))
    .map((operation) => ({
      id: operation.id,
      semanticKind: operation.semanticKind,
      command: operation.command,
      sourceEventIds: operation.sourceEventIds ?? [],
      selectionEntityIds: (operation.arguments ?? [])
        .flatMap((argument) => argument.selection?.entityIds ?? []),
      resultGeometry: operation.resultGeometry ?? []
    }));
}

function formatAuditSource(recordingDir, item) {
  const sources = item.sourceScreenshots ?? [item.path];
  return sources.map((source) => {
    const relative = path.relative(recordingDir, source).replaceAll("\\", "/");
    return relative.startsWith("../") ? path.basename(source) : relative;
  }).join(" + ");
}

function resolveCommand(action) {
  return String(
    action?.resolvedCadCommandContext ??
    action?.inferredCadCommandContext ??
    action?.visualComparisonContext ??
    action?.visualCommandContext ??
    action?.cadCommandContext ??
    ""
  ).trim().toUpperCase();
}

export function inferTopologyActionContexts(actions, commandStateTimeline, plan) {
  const inferred = new Map();
  const contexts = Array.isArray(commandStateTimeline) ? commandStateTimeline : [];
  for (const context of contexts) {
    const command = topologyCommandFromState(context?.commandState);
    if (!command) continue;
    const evidenceIds = new Set(context.commandState?.evidenceEventIds ?? []);
    const contextActions = Array.isArray(context?.actions) ? context.actions : [];
    const evidenceMatches = evidenceIds.size > 0
      ? contextActions.filter((action) => (action.sourceEventIds ?? [])
        .some((eventId) => evidenceIds.has(eventId)))
      : [];
    const candidates = evidenceMatches.length > 0
      ? evidenceMatches
      : contextActions.filter(isLikelyTopologyCanvasAction);
    for (const action of candidates) {
      if (!resolveCommand(action) && isLikelyTopologyCanvasAction(action))
        inferred.set(action, command);
    }
  }

  // 读取旧 semantic-trace 进行单独最终审计时没有逐分段状态；至少用最终状态中
  // 精确保存的 evidenceEventIds 恢复对应修改点击，而不是因无 UIA 直接跳过审计。
  const finalCommand = topologyCommandFromState(plan?.commandState);
  const finalEvidenceIds = new Set(plan?.commandState?.evidenceEventIds ?? []);
  if (finalCommand && finalEvidenceIds.size > 0) {
    for (const action of actions) {
      if ((action.sourceEventIds ?? []).some((eventId) => finalEvidenceIds.has(eventId)) &&
        !resolveCommand(action) && isLikelyTopologyCanvasAction(action))
        inferred.set(action, finalCommand);
    }
  }

  return actions.map((action) => inferred.has(action)
    ? { ...action, inferredCadCommandContext: inferred.get(action) }
    : action);
}

function topologyCommandFromState(state) {
  if (!state) return null;
  const command = [state.activeCommand, state.lastCompletedCommand]
    .map((value) => String(value ?? "").toUpperCase())
    .find((value) => TOPOLOGY_COMMANDS.has(value));
  return command ?? null;
}

function isLikelyTopologyCanvasAction(action) {
  if (!["click", "double_click", "drag"].includes(action?.action)) return false;
  if (!action?.screenshotAfter || (!action?.screenshotBefore && !action?.persistentBaselineScreenshot))
    return false;
  const point = action.at ?? action.to ?? action.from;
  if (Number.isFinite(point?.relativeY) && point.relativeY < 0.12) return false;
  const targetRole = String(action?.target?.role ?? "").toLowerCase();
  const targetClass = String(action?.target?.className ?? action?.target?.class ?? "").toLowerCase();
  return !targetRole.includes("button") && !targetClass.includes("ribbon");
}

function sampleEvenly(items, count) {
  if (count <= 0 || items.length === 0) return [];
  if (items.length <= count) return [...items];
  if (count === 1) return [items.at(-1)];
  const selected = [];
  for (let index = 0; index < count; index += 1) {
    const sourceIndex = Math.round(index * (items.length - 1) / (count - 1));
    selected.push(items[sourceIndex]);
  }
  return selected;
}

function addUnique(items, value) {
  if (value && !items.includes(value)) items.push(value);
}
