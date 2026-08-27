#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { GptClient } from "./lib/gpt-client.mjs";
import { loadLocalEnv } from "./lib/local-env.mjs";
import { ANALYSIS_INSTRUCTIONS } from "./lib/prompt.mjs";
import { renderTypeScript } from "./lib/script-renderer.mjs";
import { renderComputerUseTask } from "./lib/computer-use-renderer.mjs";
import { renderAutoCadScr } from "./lib/autocad-scr-renderer.mjs";
import {
  annotatePersistentCanvasBaselines,
  buildCandidateActions,
  chunkActions,
  makeAnalysisBundle,
  readJsonLines
} from "./lib/trace.mjs";
import { mergeWorkflows, validateWorkflow } from "./lib/workflow.mjs";
import { optimizeScreenshots } from "./lib/image-optimizer.mjs";
import { loadActionMacroEvidence, retrieveActionMacroChunk } from "./lib/action-macro.mjs";
import { analyzeValidatedChunk } from "./lib/analysis-repair.mjs";
import { buildCadEntityCatalog } from "./lib/cad-context.mjs";
import { materializeDeterministicCadGeometry } from "./lib/cad-derived-geometry.mjs";
import { ANALYSIS_HARNESS_VERSION, buildAnalysisHarness } from "./lib/analysis-harness.mjs";
import { auditFinalCadProgram } from "./lib/final-cad-audit.mjs";
import {
  createAnalysisCheckpointIdentity,
  loadAnalysisCheckpoint,
  saveAnalysisCheckpoint
} from "./lib/analysis-checkpoint.mjs";
import {
  isAutoCadRecording,
  loadAutoCadKnowledge,
  reconcileAutoCadCommandContexts,
  retrieveAutoCadKnowledge,
  validateAutoCadProgramWithKnowledge
} from "./lib/autocad-knowledge.mjs";

let activeAnalysisStage = "startup";
const VISUAL_ONLY_AUTOCAD_COMMAND_CANDIDATES = [
  "LINE", "PLINE", "CIRCLE", "ARC", "RECTANG", "POLYGON", "ELLIPSE",
  "ARRAY", "-ARRAY", "TRIM", "EXTEND", "OFFSET", "FILLET", "CHAMFER",
  "MOVE", "COPY", "ROTATE", "MIRROR", "SCALE", "ERASE"
];
const args = parseArgs(process.argv.slice(2));
if (!args.recording || !args.config) {
  usage();
  process.exitCode = 1;
} else {
  try {
    await main(args);
  } catch (error) {
    const errorLogPath = await writeAnalysisError(args, error, activeAnalysisStage).catch(() => null);
    console.error(
      (error?.message ?? String(error)) +
      (errorLogPath ? `\n错误详情已保存：${errorLogPath}` : "")
    );
    process.exitCode = 1;
  }
}

async function main(options) {
  activeAnalysisStage = "loading_recording";
  const analyzerDir = path.dirname(fileURLToPath(import.meta.url));
  await loadLocalEnv(path.resolve(analyzerDir, "../..", ".env"));
  const recordingDir = path.resolve(options.recording);
  const configPath = path.resolve(options.config);
  const config = JSON.parse(await fs.readFile(configPath, "utf8"));
  if ((config.output?.scriptLanguage ?? "typescript") !== "typescript")
    throw new Error("当前版本只支持生成 TypeScript Mock 脚本");
  const recordingManifest = await readOptionalJson(path.join(recordingDir, "manifest.json"));
  const uiAutomationTargetsRecorded = recordingManifest?.uiAutomationTargets !== false;
  const events = await readJsonLines(path.join(recordingDir, "events.jsonl"));
  const actions = buildCandidateActions(events);
  const autoCadDetected = isAutoCadRecording(actions.length > 0 ? actions : events);
  const knowledgeOptions = config.analysis?.autoCadKnowledge ?? {};
  const knowledgeEnabled = knowledgeOptions.enabled !== false;
  const configuredKnowledgeRoot = knowledgeOptions.root;
  const knowledgeRoot = configuredKnowledgeRoot
    ? path.resolve(path.dirname(configPath), configuredKnowledgeRoot)
    : path.resolve(analyzerDir, "../..", "ui-maps", "autocad", "2027", "en-US");
  let autoCadKnowledge = null;
  if (autoCadDetected && knowledgeEnabled) {
    try {
      autoCadKnowledge = await loadAutoCadKnowledge(knowledgeRoot);
    } catch (error) {
      throw new Error(`无法加载 AutoCAD 识别知识库 ${knowledgeRoot}：${error.message}`);
    }
  }
  if (autoCadDetected && autoCadKnowledge)
    reconcileAutoCadCommandContexts(actions, autoCadKnowledge);
  annotatePersistentCanvasBaselines(actions);
  const actionMacroEvidence = autoCadDetected
    ? await loadActionMacroEvidence(recordingDir)
    : null;
  const minimumConfidence = config.analysis?.minimumConfidence ?? 0.65;
  const maxScreenshotsPerRequest = config.analysis?.maxScreenshotsPerRequest ?? 16;
  const actionChunks = chunkActions(actions, config.analysis?.maxActionsPerRequest ?? 150, {
    maxCanvasEvidence: Math.max(1, maxScreenshotsPerRequest - 4),
    commandCatalog: autoCadKnowledge?.commandCatalog ?? null
  });
  const client = new GptClient(config.provider);
  const outputDir = path.resolve(options.output ?? path.join(recordingDir, "generated"));
  await fs.mkdir(outputDir, { recursive: true });
  const existingPlan = options.auditExisting
    ? validateWorkflow(JSON.parse(await fs.readFile(path.join(outputDir, "semantic-trace.json"), "utf8")), {
      minimumConfidence,
      validateCadReferences: true
    })
    : null;
  const existingInputManifest = options.auditExisting
    ? await readOptionalJson(path.join(outputDir, "analysis-input-manifest.json"))
    : null;
  const checkpointPath = path.join(outputDir, "analysis-checkpoint.json");
  const checkpointIdentity = createAnalysisCheckpointIdentity({
    pipelineVersion: "2026-08-26.1",
    model: config.provider?.model ?? null,
    analysis: config.analysis ?? {},
    instructions: ANALYSIS_INSTRUCTIONS,
    actionChunks,
    actionMacroEntries: actionMacroEvidence?.entries ?? [],
    knowledgeMetadata: autoCadKnowledge?.metadata ?? null,
    uiAutomationTargetsRecorded
  });
  const restoredCheckpoint = !existingPlan && actions.length > 0
    ? await loadAnalysisCheckpoint(checkpointPath, checkpointIdentity, actionChunks.length)
    : null;
  const partialPlans = existingPlan
    ? [existingPlan]
    : restoredCheckpoint?.completed.map((item) => item.plan) ?? [];
  const analysisInputChunks = existingPlan
    ? existingInputManifest?.chunks ?? []
    : restoredCheckpoint?.completed.map((item) => item.audit) ?? [];
  const resumeChunkIndex = partialPlans.length;
  if (!existingPlan && resumeChunkIndex > 0)
    console.log(`已恢复 ${resumeChunkIndex}/${actionChunks.length} 个完成分段，从下一分段继续。`);
  const apiImageDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "mock-recorder-api-images-"));

  try {
    if (existingPlan) {
      console.log("已读取现有分析结果，仅执行最终 CAD 画布审计。 ");
    } else if (actions.length === 0) {
      partialPlans.push({ summary: "未检测到可执行操作", steps: [], omitted: [], warnings: [] });
    } else {
      for (let index = resumeChunkIndex; index < actionChunks.length; index += 1) {
        activeAnalysisStage = `chunk_${index + 1}_of_${actionChunks.length}_prepare`;
        const chunk = actionChunks[index];
        const boundaryActions = index === 0 ? [] : actionChunks[index - 1].slice(-3);
        const previousCadEntities = buildCadEntityCatalog(partialPlans);
        const previousChunkContext = partialPlans.length === 0 ? null : {
          commandState: partialPlans.at(-1)?.commandState ?? null,
          summary: partialPlans.map((plan) => plan.summary).filter(Boolean).slice(-3).join(" → "),
          recentSteps: partialPlans.flatMap((plan) => plan.steps ?? []).slice(-8).map((step) => ({
            goal: step.goal,
            action: step.action,
            value: step.value,
            expectedState: step.expectedState,
            canvasChange: step.canvasChange
          })),
          cadOperationTail: partialPlans
            .filter((plan) => plan.cadProgram?.format === "autocad_command_ir")
            .flatMap((plan) => plan.cadProgram.operations)
            .slice(-8),
          cadEntityCatalog: previousCadEntities,
          cadProgramWarnings: partialPlans
            .flatMap((plan) => plan.cadProgram?.warnings ?? [])
            .slice(-8),
          rawActionTail: boundaryActions.map(compactBoundaryAction)
        };
        const knowledgeRetrieval = retrieveAutoCadKnowledge(autoCadKnowledge, chunk, {
          previousCommands: previousChunkContext?.cadOperationTail?.map((operation) => operation.command) ?? [],
          maxControls: uiAutomationTargetsRecorded
            ? knowledgeOptions.maxControls
            : Math.max(knowledgeOptions.maxControls ?? 18, 30),
          maxCommands: uiAutomationTargetsRecorded
            ? knowledgeOptions.maxCommands
            : Math.max(knowledgeOptions.maxCommands ?? 14, VISUAL_ONLY_AUTOCAD_COMMAND_CANDIDATES.length),
          maxMenus: uiAutomationTargetsRecorded
            ? knowledgeOptions.maxMenus
            : Math.max(knowledgeOptions.maxMenus ?? 10, 16),
          fallbackCommands: uiAutomationTargetsRecorded ? [] : VISUAL_ONLY_AUTOCAD_COMMAND_CANDIDATES
        });
        const analysisHarness = buildAnalysisHarness({
          actions: chunk,
          previousCommandState: partialPlans.at(-1)?.commandState ?? null,
          knowledge: autoCadKnowledge,
          knowledgeContext: knowledgeRetrieval.context,
          cadEntityCatalog: previousCadEntities,
          uiAutomationTargetsRecorded,
          chunk: { index: index + 1, total: actionChunks.length }
        });
        const actionMacroRetrieval = retrieveActionMacroChunk(
          actionMacroEvidence,
          index + 1,
          actionChunks.length,
          { maxEntries: config.analysis?.maxActionMacroEntriesPerRequest ?? 90 }
        );
        const screenshotLimit = config.analysis?.maxScreenshotsPerRequest ?? 8;
        const boundaryScreenshotLimit = boundaryActions.length > 0 && screenshotLimit > 1
          ? Math.min(2, screenshotLimit - 1)
          : 0;
        const boundaryScreenshots = makeAnalysisBundle(
          recordingDir,
          boundaryActions,
          boundaryScreenshotLimit,
          { preferRecent: true }
        ).screenshots;
        const currentScreenshots = makeAnalysisBundle(
          recordingDir,
          chunk,
          Math.max(1, screenshotLimit - boundaryScreenshots.length)
        ).screenshots;
        const screenshotFiles = [...new Set([...boundaryScreenshots, ...currentScreenshots])];
        const boundaryScreenshotSet = new Set(boundaryScreenshots);
        const originalScreenshots = config.analysis?.includeScreenshots === false
          ? []
          : screenshotFiles.map((file) => {
            const item = makeScreenshotInput(
              recordingDir,
              file,
              [...boundaryActions, ...chunk],
              screenshotFiles
            );
            return boundaryScreenshotSet.has(file)
              ? { ...item, label: `${item.label}（上一分段边界上下文，只用于恢复进行中的操作）`, boundaryContext: true }
              : item;
          });
        const screenshots = await optimizeScreenshots(
          originalScreenshots,
          path.join(apiImageDirectory, `chunk-${index + 1}`),
          config.analysis
        );

        activeAnalysisStage = `chunk_${index + 1}_of_${actionChunks.length}_api`;
        const analysisResult = await analyzeValidatedChunk({
          client,
          instructions: ANALYSIS_INSTRUCTIONS,
          payload: {
            format: "UniversalInteractionTrace",
            version: "0.1",
            outputLanguage: config.analysis?.language ?? "zh-CN",
            minimumConfidence,
            chunk: { index: index + 1, total: actionChunks.length },
            captureContext: {
              uiAutomationTargetsRecorded,
              recognitionMode: uiAutomationTargetsRecorded
                ? "input_screenshots_plus_ui_automation"
                : "input_screenshots_without_ui_automation",
              rule: uiAutomationTargetsRecorded
                ? "UI Automation target fields may be used as direct control evidence."
                : "No UI Automation target identity was recorded. Infer controls only from screenshots, mouse position, keyboard input and visible state; never invent AutomationId."
            },
            previousChunkContext,
            analysisHarness: analysisHarness.context,
            ...(knowledgeRetrieval.context ? { autoCadKnowledge: knowledgeRetrieval.context } : {}),
            ...(actionMacroRetrieval.context ? { autoCadActionMacro: actionMacroRetrieval.context } : {}),
            candidateActions: chunk
          },
          screenshots,
          validate: (workflow) => validateWorkflow(workflow, {
            validateCadReferences: true,
            knownCadEntityIds: previousCadEntities.map((entity) => entity.entityId)
          }),
          maxValidationRepairs: config.analysis?.maxValidationRepairs ?? 1
        });
        const partialPlan = materializeDeterministicCadGeometry(analysisResult.plan, partialPlans);
        validateWorkflow(partialPlan, {
          validateCadReferences: true,
          knownCadEntityIds: previousCadEntities.map((entity) => entity.entityId)
        });
        const chunkAudit = {
          chunk: index + 1,
          actionCount: chunk.length,
          screenshots: originalScreenshots.map((item, screenshotIndex) => ({
            source: path.relative(recordingDir, item.path).replaceAll("\\", "/"),
            uploadedAs: item.boundaryContext
              ? "boundary_context"
              : item.evidenceRole ?? (item.crop ? "canvas_click_crop" : "overview"),
            label: screenshots[screenshotIndex]?.label ?? item.label,
            imageMapping: screenshots[screenshotIndex]?.imageMapping ?? null
          })),
          knowledge: knowledgeRetrieval.audit,
          analysisHarness: analysisHarness.audit,
          actionMacro: actionMacroRetrieval.audit,
          validationRepairs: analysisResult.validationRepairs
        };
        analysisInputChunks.push(chunkAudit);
        partialPlans.push(partialPlan);
        await saveAnalysisCheckpoint(checkpointPath, {
          identity: checkpointIdentity,
          totalChunks: actionChunks.length,
          completed: partialPlans.map((plan, completedIndex) => ({
            index: completedIndex + 1,
            plan,
            audit: analysisInputChunks[completedIndex]
          }))
        });
      }
    }
  } finally {
    await fs.rm(apiImageDirectory, { recursive: true, force: true });
  }

  const mergedPlan = existingPlan ?? mergeWorkflows(partialPlans, {
      minimumConfidence,
      validateCadReferences: true
    });
  activeAnalysisStage = "final_cad_visual_audit_api";
  const finalCadAuditResult = autoCadDetected
    ? await auditFinalCadProgram({
      client,
      plan: mergedPlan,
      actions,
      commandStateTimeline: existingPlan ? [] : actionChunks.map((chunk, index) => ({
        actions: chunk,
        commandState: partialPlans[index]?.commandState ?? null
      })),
      recordingDir,
      analysisOptions: config.analysis ?? {},
      minimumConfidence
    })
    : {
      plan: mergedPlan,
      audit: { attempted: false, changed: false, screenshots: [], findings: [], skipped: "not_autocad" }
    };
  const plan = finalCadAuditResult.plan;

  activeAnalysisStage = "writing_generated_files";
  await Promise.all([
    fs.rm(path.join(outputDir, "windows-replay.ps1"), { force: true }),
    fs.rm(path.join(outputDir, "运行回放.cmd"), { force: true }),
    fs.rm(path.join(outputDir, "autocad-replay.scr"), { force: true }),
    fs.rm(path.join(outputDir, "autocad-scr-validation.json"), { force: true }),
    fs.rm(path.join(outputDir, "cad-program.json"), { force: true })
  ]);
  let knowledgeValidation = { valid: true, checkedCommands: [], skipped: "not_an_autocad_recording" };
  let knowledgeValidationError = null;
  if (autoCadDetected && autoCadKnowledge) {
    try {
      knowledgeValidation = validateAutoCadProgramWithKnowledge(plan, autoCadKnowledge);
    } catch (error) {
      knowledgeValidationError = error;
      knowledgeValidation = { valid: false, checkedCommands: [], error: error.message };
    }
  } else if (autoCadDetected && !knowledgeEnabled) {
    knowledgeValidation = { valid: true, checkedCommands: [], skipped: "knowledge_disabled_by_config" };
  }

  const knowledgeManifest = {
    format: "RecorderKnowledgeUsageManifest",
    version: "0.1",
    applicationDetected: autoCadDetected ? "Autodesk AutoCAD" : null,
    enabled: knowledgeEnabled,
    knowledgeRoot: autoCadKnowledge
      ? path.relative(path.dirname(configPath), knowledgeRoot).replaceAll("\\", "/") || "."
      : null,
    knowledgeBase: autoCadKnowledge?.metadata ?? null,
    captureContext: {
      uiAutomationTargetsRecorded,
      recognitionMode: uiAutomationTargetsRecorded
        ? "input_screenshots_plus_ui_automation"
        : "input_screenshots_without_ui_automation"
    },
    analysisHarness: {
      version: ANALYSIS_HARNESS_VERSION,
      commandGrammarVersion: autoCadKnowledge?.metadata?.commandGrammarVersion ?? null,
      commandGrammarCommands: autoCadKnowledge?.metadata?.commandGrammarCommands ?? 0
    },
    chunks: analysisInputChunks.map((chunk) => ({ chunk: chunk.chunk, ...chunk.knowledge })),
    cadProgramValidation: knowledgeValidation
  };

  // 结构化识别结果是主产物；SCR 只是 AutoCAD 的一个可选验证后端。
  await fs.writeFile(path.join(outputDir, "semantic-trace.json"), JSON.stringify(plan, null, 2));
  await fs.writeFile(
    path.join(outputDir, "cad-program.json"),
    JSON.stringify(plan.cadProgram, null, 2),
    "utf8"
  );
  await fs.writeFile(
    path.join(outputDir, "analysis-input-manifest.json"),
    JSON.stringify({
      format: "RecorderAnalysisInputManifest",
      version: "0.1",
      model: config.provider?.model ?? null,
      captureContext: knowledgeManifest.captureContext,
      requestCount: analysisInputChunks.length + (finalCadAuditResult.audit.attempted ? 1 : 0),
      totalUploadedImages: analysisInputChunks.reduce((sum, chunk) => sum + chunk.screenshots.length, 0) +
        (finalCadAuditResult.audit.screenshots?.length ?? 0),
      chunks: analysisInputChunks,
      finalCadAudit: finalCadAuditResult.audit,
      actionRecorder: actionMacroEvidence?.metadata ?? {
        available: false,
        status: "not_enabled"
      }
    }, null, 2),
    "utf8"
  );
  await fs.writeFile(
    path.join(outputDir, "knowledge-used.json"),
    JSON.stringify(knowledgeManifest, null, 2),
    "utf8"
  );
  await fs.writeFile(
    path.join(outputDir, "analysis-harness.json"),
    JSON.stringify({
      format: "RecorderAnalysisHarnessManifest",
      version: ANALYSIS_HARNESS_VERSION,
      captureContext: knowledgeManifest.captureContext,
      commandGrammar: knowledgeManifest.analysisHarness,
      chunks: analysisInputChunks.map((chunk) => ({
        chunk: chunk.chunk,
        ...chunk.analysisHarness
      })),
      finalCommandState: plan.commandState ?? null
    }, null, 2),
    "utf8"
  );
  await fs.writeFile(
    path.join(outputDir, "mock-script.ts"),
    renderTypeScript(plan, config.output?.runtimeImport),
    "utf8"
  );
  await fs.writeFile(
    path.join(outputDir, "computer-use-task.md"),
    renderComputerUseTask(plan),
    "utf8"
  );
  if (knowledgeValidationError) throw knowledgeValidationError;
  let scrValidation = {
    format: "RecorderBackendValidation",
    version: "0.1",
    backend: "autocad_scr",
    attempted: false,
    generated: false,
    cadProgramComplete: plan.cadProgram?.complete === true,
    error: null
  };
  if (autoCadDetected) {
    if (plan.cadProgram?.complete !== true) {
      scrValidation.error = plan.cadProgram?.warnings?.join("；") || "结构化 CAD 操作不完整";
      const warningCount = plan.cadProgram?.warnings?.length ?? 0;
      console.warn(
        `AI 已生成部分 CAD 操作；另有 ${warningCount} 项诊断未能精确建模。SCR 验证已跳过。`
      );
    } else {
      scrValidation.attempted = true;
      try {
        const autoCadScr = renderAutoCadScr(plan, { knowledge: autoCadKnowledge });
        await fs.writeFile(
          path.join(outputDir, "autocad-replay.scr"),
          autoCadScr,
          "utf8"
        );
        scrValidation.generated = true;
      } catch (error) {
        scrValidation.error = error.message;
        console.warn(`结构化 CAD 操作已生成，但 SCR 验证后端未通过：${error.message}`);
      }
    }
    await fs.writeFile(
      path.join(outputDir, "autocad-scr-validation.json"),
      JSON.stringify(scrValidation, null, 2),
      "utf8"
    );
  }
  await fs.rm(checkpointPath, { force: true });
  await fs.rm(path.join(outputDir, "analysis-error.json"), { force: true });
  activeAnalysisStage = "complete";
  console.log(`已生成: ${outputDir}`);
}

function makeScreenshotInput(recordingDir, file, actions, selectedFiles) {
  const selectedSet = new Set(selectedFiles);
  const persistentBaselineAction = actions.find((action) =>
    action.persistentBaselineScreenshot === file &&
    selectedSet.has(action.screenshotAfter));
  if (persistentBaselineAction) {
    const pairId = persistentBaselineAction.sourceEventIds?.join("+") ||
      `${persistentBaselineAction.startMs ?? "unknown"}-${persistentBaselineAction.endMs ?? "unknown"}`;
    const commandContext = persistentBaselineAction.visualComparisonContext
      ? `，命令上下文=${persistentBaselineAction.visualComparisonContext}`
      : "";
    const item = {
      path: path.join(recordingDir, file),
      label: `${file}（pair=${pairId}${commandContext} 的前一稳定画布基线；这是连续状态辅助证据。` +
        "本次操作的主差分仍是同 pair 的即时 before→after；若三者冲突，必须再核对操作前 CAD 实体和最终稳定画布，不能仅因本图与 after 相同就否定即时前后图中明确消失的区段）",
      evidenceRole: "persistent_state_baseline"
    };
    if (isLikelyCanvasPointAction(persistentBaselineAction)) {
      item.crop = {
        centerX: persistentBaselineAction.at.x,
        centerY: persistentBaselineAction.at.y,
        width: 1200,
        height: 700
      };
    }
    return item;
  }
  const changedAction = actions.find((action) =>
    action.cadInputEvidence?.exact !== true &&
    action.visualChange?.changed === true &&
    isLikelyCanvasChangeAction(action) &&
    action.screenshotBefore && action.screenshotAfter &&
    selectedSet.has(action.screenshotBefore) && selectedSet.has(action.screenshotAfter) &&
    (action.screenshotBefore === file || action.screenshotSelection === file || action.screenshotAfter === file));
  if (changedAction) {
    const before = changedAction.screenshotBefore === file;
    const selection = changedAction.screenshotSelection === file;
    const pairId = changedAction.sourceEventIds?.join("+") ||
      `${changedAction.startMs ?? "unknown"}-${changedAction.endMs ?? "unknown"}`;
    const commandContext = changedAction.visualComparisonContext
      ? `，命令上下文=${changedAction.visualComparisonContext}`
      : "";
    const phase = before ? "前" : selection ? "选择/预览中" : "后";
    const item = {
      path: path.join(recordingDir, file),
      label: `${file}（画布变化${phase}，pair=${pairId}${commandContext}；必须与同 pair 的另一张图配准比较）`,
      evidenceRole: before ? "change_pair_before" : selection ? "change_selection_state" : "change_pair_after"
    };
    if (isLikelyCanvasPointAction(changedAction)) {
      item.label = `${file}（画布变化${phase}局部图，pair=${pairId}${commandContext}；同一裁剪范围，图片中心是操作位置）`;
      item.crop = {
        centerX: changedAction.at.x,
        centerY: changedAction.at.y,
        width: 1200,
        height: 700
      };
    }
    return item;
  }

  const committedInputAction = actions.find((action) =>
    action.cadInputEvidence?.exact === true &&
    (action.screenshotBefore === file || action.screenshotAfter === file));
  if (committedInputAction) {
    const evidence = committedInputAction.cadInputEvidence;
    const before = committedInputAction.screenshotBefore === file;
    const target = committedInputAction.target;
    const centerX = Number.isFinite(target?.x) && Number.isFinite(target?.width)
      ? target.x + target.width / 2
      : null;
    const centerY = Number.isFinite(target?.y) && Number.isFinite(target?.height)
      ? target.y + target.height / 2
      : null;
    const item = {
      path: path.join(recordingDir, file),
      label: `${file}（CAD 数值提交${before ? "前" : "后"}，pair=${committedInputAction.sourceEventIds?.join("+") ?? "unknown"}；` +
        `录制器上下文命令=${evidence.command}，本地只确认键盘值=${evidence.value}` +
        `${evidence.parameterRoleExact ? `、参数角色=${evidence.parameterName}` : "，参数角色必须以图片当前提示为准"}；` +
        (before
          ? "请读取字段标签、角度、坐标和对象捕捉标记；必须与同 pair 的提交后图片比较）"
          : "这是提交产生最终几何后的状态；必须与同 pair 的提交前图片比较）"),
      evidenceRole: before ? "cad_input_commit_before" : "cad_input_commit_after"
    };
    if (centerX !== null && centerY !== null) {
      item.crop = { centerX, centerY, width: 1600, height: 900 };
    }
    return item;
  }

  const pointAction = actions.find((action) =>
    action.screenshotBefore === file && isLikelyCanvasPointAction(action));
  if (!pointAction) return { path: path.join(recordingDir, file), label: file, evidenceRole: "overview" };
  return {
    path: path.join(recordingDir, file),
    label: `${file}（画布取点局部放大，图片中心是点击位置）`,
    evidenceRole: "canvas_click_crop",
    crop: {
      centerX: pointAction.at.x,
      centerY: pointAction.at.y,
      width: 1200,
      height: 700
    }
  };
}

function isLikelyCanvasChangeAction(action) {
  if (isLikelyCanvasPointAction(action)) return true;
  const searchable = [
    action.window?.title,
    action.target?.name,
    action.target?.className,
    ...(action.target?.ancestors ?? []).flatMap((ancestor) => [
      ancestor.name, ancestor.className, ancestor.automationId
    ])
  ].filter(Boolean).join(" ");
  return /CAcDynInputWndControl|ACADDM_CHILD_DXGI_FLIP_MODE_VIEW_CLASS/i.test(searchable);
}

function isLikelyCanvasPointAction(action) {
  if (!["click", "double_click", "right_click", "middle_click"].includes(action.action)) return false;
  const target = action.target;
  const window = action.window;
  if (!action.at || !window?.width || !window?.height) return false;
  if (!target?.width || !target?.height) {
    const relativeX = Number.isFinite(action.at.relativeX)
      ? action.at.relativeX : (action.at.x - window.x) / window.width;
    const relativeY = Number.isFinite(action.at.relativeY)
      ? action.at.relativeY : (action.at.y - window.y) / window.height;
    return relativeX >= 0.01 && relativeX <= 0.99 && relativeY >= 0.10 && relativeY <= 0.95;
  }
  const areaRatio = target.width * target.height / Math.max(1, window.width * window.height);
  return /Pane|Document|Custom/i.test(String(target.role ?? "")) && areaRatio >= 0.2;
}

function compactBoundaryAction(action) {
  return {
    action: action.action,
    text: action.text ?? null,
    key: action.key ?? null,
    modifiers: action.modifiers ?? [],
    at: action.at ?? null,
    from: action.from ?? null,
    to: action.to ?? null,
    target: action.target ?? null,
    window: action.window ?? null,
    screenshotBefore: action.screenshotBefore ?? null,
    screenshotSelection: action.screenshotSelection ?? null,
    screenshotAfter: action.screenshotAfter ?? null,
    persistentBaselineScreenshot: action.persistentBaselineScreenshot ?? null,
    persistentBaselineSourceEventIds: action.persistentBaselineSourceEventIds ?? [],
    visualCommandContext: action.visualCommandContext ?? null,
    resolvedCadCommandContext: action.resolvedCadCommandContext ?? null,
    cadInputEvidence: action.cadInputEvidence ?? null,
    sourceEventIds: action.sourceEventIds ?? []
  };
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--recording") result.recording = argv[++index];
    else if (key === "--config") result.config = argv[++index];
    else if (key === "--output") result.output = argv[++index];
    else if (key === "--audit-existing") result.auditExisting = true;
  }
  return result;
}

function usage() {
  console.error("用法: node src/analyzer/cli.mjs --recording <录制目录> --config <config.json> [--output <目录>] [--audit-existing]");
}

async function readOptionalJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function writeAnalysisError(options, error, stage) {
  const recordingDir = path.resolve(options.recording);
  const outputDir = path.resolve(options.output ?? path.join(recordingDir, "generated"));
  await fs.mkdir(outputDir, { recursive: true });
  const errorPath = path.join(outputDir, "analysis-error.json");
  await fs.writeFile(errorPath, JSON.stringify({
    format: "RecorderAnalysisError",
    version: "0.1",
    failedAt: new Date().toISOString(),
    stage,
    recording: recordingDir,
    node: process.version,
    error: serializeError(error)
  }, null, 2), "utf8");
  return errorPath;
}

function serializeError(error, depth = 0) {
  if (!error || depth > 3) return null;
  return {
    name: error.name ?? null,
    message: error.message ?? String(error),
    code: error.code ?? null,
    status: error.status ?? null,
    requestId: error.requestId ?? null,
    clientRequestId: error.clientRequestId ?? null,
    requestSizeMb: error.requestSizeMb ?? null,
    stack: error.stack ?? null,
    cause: serializeError(error.cause, depth + 1)
  };
}
