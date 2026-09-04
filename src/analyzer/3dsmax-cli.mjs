#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { GptClient, summarizeUsageRecords } from "./lib/gpt-client.mjs";
import {
  createAnalysisCheckpointIdentity,
  loadAnalysisCheckpoint,
  saveAnalysisCheckpoint
} from "./lib/analysis-checkpoint.mjs";
import { optimizeScreenshots } from "./lib/image-optimizer.mjs";
import { buildThreeDsMaxEvidenceCrop } from "./lib/threedsmax-evidence-crops.mjs";
import { buildThreeDsMaxObjectContext } from "./lib/threedsmax-face-catalog.mjs";
import { annotateThreeDsMaxContinuations } from "./lib/threedsmax-interactions.mjs";
import { buildVisualFaceInput, mergeVisualFaceTracking, visualFaceContextScreenshots,
  visualFacePriorityScreenshots, trackVisualFaces, visualFaceLimits } from "./lib/threedsmax-visual-faces.mjs";
import { chunkThreeDsMaxActions, previousThreeDsMaxActionTail, selectPreviousThreeDsMaxContextImages } from "./lib/threedsmax-chunks.mjs";
import { loadLocalEnv } from "./lib/local-env.mjs";
import { renderMaxScript } from "./lib/maxscript-renderer.mjs";
import { THREE_DSMAX_ANALYSIS_INSTRUCTIONS } from "./lib/threedsmax-prompt.mjs";
import {
  loadThreeDsMaxKnowledge,
  retrieveThreeDsMaxKnowledge
} from "./lib/threedsmax-knowledge.mjs";
import { selectThreeDsMaxScreenshots } from "./lib/threedsmax-screenshots.mjs";
import {
  annotateThreeDsMaxTransformContexts,
  buildThreeDsMaxTransformHarness
} from "./lib/threedsmax-transform-harness.mjs";
import {
  assertThreeDsMaxEvidenceCoverage,
  auditThreeDsMaxReplayCompleteness
} from "./lib/threedsmax-replay-audit.mjs";
import {
  THREE_DSMAX_ANALYSIS_SCHEMA,
  emptyThreeDsMaxAnalysis,
  mergeThreeDsMaxAnalyses,
  validateThreeDsMaxAnalysis
} from "./lib/threedsmax-workflow.mjs";
import { buildCandidateActions, readJsonLines } from "./lib/trace.mjs";

let activeStage = "startup";
const args = parseArgs(process.argv.slice(2));

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!args.recording || !args.config) {
    console.error("用法: node src/analyzer/3dsmax-cli.mjs --recording <录制目录> --config <config.json> [--output <目录>]");
    process.exitCode = 1;
  } else {
    try {
      await main(args);
    } catch (error) {
      const errorPath = await writeAnalysisError(args, error, activeStage).catch(() => null);
      console.error(`${error?.message ?? error}${errorPath ? `\n错误详情已保存：${errorPath}` : ""}`);
      process.exitCode = 1;
    }
  }
}

async function main(options) {
  activeStage = "loading_recording";
  const analyzerDirectory = path.dirname(fileURLToPath(import.meta.url));
  const workspaceRoot = path.resolve(analyzerDirectory, "../..");
  await loadLocalEnv(path.join(workspaceRoot, ".env"));
  const recordingDirectory = path.resolve(options.recording);
  const configPath = path.resolve(options.config);
  const config = JSON.parse(await fs.readFile(configPath, "utf8"));
  const manifest = await readOptionalJson(path.join(recordingDirectory, "manifest.json"));
  if (manifest?.applicationProfile && manifest.applicationProfile !== "autodesk-3dsmax")
    throw new Error(`录制文件属于 ${manifest.applicationProfile}，不能交给 3ds Max 分析器`);

  const events = await readJsonLines(path.join(recordingDirectory, "events.jsonl"));
  const actions = annotateThreeDsMaxContinuations(annotateThreeDsMaxTransformContexts(buildCandidateActions(events)), events);
  const analysisOptions = config.analysis ?? {};
  const threeDsMaxOptions = analysisOptions.threeDsMax ?? {};
  const faceOptions = threeDsMaxOptions.visualFaceTracking ?? {};
  const trackFaces = faceOptions.enabled !== false;
  const knowledgeOptions = analysisOptions.threeDsMaxKnowledge ?? {};
  const knowledgeRoot = knowledgeOptions.root
    ? path.resolve(path.dirname(configPath), knowledgeOptions.root)
    : path.join(workspaceRoot, "ui-maps", "3dsmax", "2027", "en-US");
  const knowledge = knowledgeOptions.enabled === false
    ? null
    : await loadThreeDsMaxKnowledge(knowledgeRoot);
  const maxScreenshots = threeDsMaxOptions.maxScreenshotsPerRequest ??
    analysisOptions.maxScreenshotsPerRequest ?? 18;
  const maxActions = threeDsMaxOptions.maxActionsPerRequest ??
    analysisOptions.maxActionsPerRequest ?? 200;
  const chunks = chunkThreeDsMaxActions(actions, maxActions, {
    maxCanvasEvidence: Math.max(2, maxScreenshots),
    minActionsPerChunk: threeDsMaxOptions.minActionsPerRequest ??
      analysisOptions.minActionsPerRequest ?? 0
  });
  const client = new GptClient(config.provider);
  const outputDirectory = path.resolve(options.output ?? path.join(recordingDirectory, "generated"));
  await fs.mkdir(outputDirectory, { recursive: true });
  const checkpointPath = path.join(outputDirectory, "analysis-checkpoint.json");
  const checkpointIdentity = createAnalysisCheckpointIdentity({
    pipelineVersion: "3dsmax-2026-09-03-bevel-approximation.1",
    provider: {
      model: config.provider?.model ?? null,
      reasoningEffort: config.provider?.reasoningEffort ?? null,
      verbosity: config.provider?.verbosity ?? null,
      imageDetail: config.provider?.imageDetail ?? null
    },
    analysis: {
      includeScreenshots: analysisOptions.includeScreenshots ?? true,
      threeDsMax: threeDsMaxOptions,
      threeDsMaxKnowledge: knowledgeOptions
    },
    instructions: THREE_DSMAX_ANALYSIS_INSTRUCTIONS,
    chunks,
    knowledgeMetadata: knowledge?.metadata ?? null,
    uiAutomationTargetsRecorded: manifest?.uiAutomationTargets !== false
  });
  const restoredCheckpoint = actions.length > 0
    ? await loadAnalysisCheckpoint(checkpointPath, checkpointIdentity, chunks.length)
    : null;
  const parts = restoredCheckpoint?.completed.map((item) => item.plan) ?? [];
  const audits = restoredCheckpoint?.completed.map((item) => item.audit) ?? [];
  const resumeChunkIndex = parts.length;
  if (resumeChunkIndex > 0)
    console.log(`已恢复 ${resumeChunkIndex}/${chunks.length} 个 3ds Max 分段，从下一分段继续。`);
  const apiImagesDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "mock-recorder-3dsmax-images-"));

  try {
    if (actions.length === 0) {
      parts.push(emptyThreeDsMaxAnalysis());
    } else {
      for (let index = resumeChunkIndex; index < chunks.length; index += 1) {
        activeStage = `chunk_${index + 1}_of_${chunks.length}`;
        const chunk = chunks[index];
        const rawActionTail = previousThreeDsMaxActionTail(chunks, index);
        const knownObjects = buildThreeDsMaxObjectContext(parts);
        const visualFaceState = mergeVisualFaceTracking(parts);
        const knowledgeRetrieval = retrieveThreeDsMaxKnowledge(knowledge, chunk, knowledgeOptions);
        const contextNames = analysisOptions.includeScreenshots === false ? [] :
          [...new Set([
            ...(trackFaces ? visualFaceContextScreenshots(visualFaceState) : []),
            ...selectPreviousThreeDsMaxContextImages(rawActionTail)
          ])].slice(0, Math.min(4, Math.floor(maxScreenshots / 4)));
        const selectedScreenshotNames = analysisOptions.includeScreenshots === false
          ? []
          : [...new Set([...contextNames, ...selectThreeDsMaxScreenshots(chunk, maxScreenshots - contextNames.length, {
            uploadAll: threeDsMaxOptions.uploadAllScreenshots === true,
            priorityScreenshots: trackFaces ? visualFacePriorityScreenshots(chunk,
              Math.min(visualFaceLimits(faceOptions).maxFrames, Math.floor(maxScreenshots / 3))) : []
          })])];
        const sourceScreenshots = await existingScreenshotInputs(
          recordingDirectory,
          selectedScreenshotNames,
          [...rawActionTail, ...chunk]
        );
        const screenshots = await optimizeScreenshots(
          sourceScreenshots,
          path.join(apiImagesDirectory, `chunk-${index + 1}`),
          {
            scriptPath: path.join(workspaceRoot, "scripts", "optimize-screenshots.ps1"),
            maxImageWidth: threeDsMaxOptions.maxImageWidth ?? analysisOptions.maxImageWidth ?? 1600,
            maxImageHeight: threeDsMaxOptions.maxImageHeight ?? analysisOptions.maxImageHeight ?? 1000,
            jpegQuality: threeDsMaxOptions.jpegQuality ?? analysisOptions.jpegQuality ?? 72
          }
        );
        const uploadedScreenshotNames = new Set(screenshots.map((item) => item.logicalScreenshot));
        const payload = {
          format: "ThreeDsMaxRecordingAnalysisInput",
          version: "0.1",
          evidencePolicyVersion: 2,
          approximationPolicy: { bevel: "reference_geometry_ratio", maxConfidence: 0.45,
            preferLabeledNumbers: true, requireStableViewAndFullBeforeAfter: true,
            uncertaintyIsModelEstimateNotStatisticalInterval: true },
          visualFaceInput: trackFaces ? buildVisualFaceInput(screenshots, [...rawActionTail, ...chunk],
            visualFaceState, index + 1, faceOptions) : { enabled: false },
          application: {
            profile: manifest?.applicationProfile ?? "autodesk-3dsmax",
            name: manifest?.applicationName ?? "Autodesk 3ds Max",
            version: manifest?.applicationVersion ?? "2027",
            language: manifest?.language ?? "en-US"
          },
          captureContext: {
            uiAutomationTargetsRecorded: manifest?.uiAutomationTargets !== false,
            preferredReplayFormat: manifest?.preferredReplayFormat ?? "maxscript"
          },
          chunk: { index: index + 1, total: chunks.length },
          previousContext: {
            knownObjects,
            rawActionTail: rawActionTail.map((action) => compactAction(action, uploadedScreenshotNames)),
            pendingInteractions: (parts.at(-1)?.dragAssessments ?? []).filter((item) =>
              item.category === "unresolved").slice(-8),
            recentOperations: parts.flatMap((part) => part.maxProgram.operations).slice(-16),
            previousWarnings: parts.flatMap((part) => part.maxProgram.warnings).slice(-10)
          },
          knowledge: knowledgeRetrieval.context,
          actions: chunk.map((action) => compactAction(action, uploadedScreenshotNames)),
          screenshots: screenshots.map((item) => ({
            label: item.label,
            evidenceRole: item.evidenceRole,
            imageMapping: item.imageMapping ?? null
          }))
        };
        const usageRecordStart = client.getUsageRecords().length;
        const result = await analyzeChunk({
          client,
          payload,
          screenshots,
          knownObjects,
          visualFaceState,
          maxValidationRepairs: threeDsMaxOptions.maxValidationRepairs ??
            analysisOptions.maxValidationRepairs ?? 1
        });
        parts.push(result);
        audits.push({
          chunk: payload.chunk,
          actionCount: chunk.length,
          uploadedScreenshots: screenshots.map((item) => path.basename(item.path)),
          knowledgeMatches: knowledgeRetrieval.matches,
          visualFaceTracking: { frameCount: result.visualFaceTracking?.frames.length ?? 0,
            updatedTrackCount: result.visualFaceTracking?.updates.length ?? 0, issueCount: result.visualFaceTracking?.issues.length ?? 0 },
          apiUsage: client.getUsageRecords().slice(usageRecordStart)
        });
        await saveAnalysisCheckpoint(checkpointPath, {
          identity: checkpointIdentity,
          totalChunks: chunks.length,
          completed: parts.map((plan, completedIndex) => ({
            index: completedIndex + 1,
            plan,
            audit: audits[completedIndex]
          }))
        });
        console.log(`已完成 3ds Max 分段 ${index + 1}/${chunks.length}`);
      }
    }
  } finally {
    await fs.rm(apiImagesDirectory, { recursive: true, force: true });
  }

  activeStage = "merging_scene_program";
  const mergedAnalysis = mergeThreeDsMaxAnalyses(parts, {
    minimumConfidence: analysisOptions.minimumConfidence ?? 0.65,
    validateReferences: true
  });
  const analysis = auditThreeDsMaxReplayCompleteness(mergedAnalysis);
  const apiUsage = summarizeUsageRecords(audits.flatMap((audit) => audit.apiUsage ?? []));
  const semanticTrace = { ...analysis, apiUsage };
  const rendered = renderMaxScript(analysis);

  activeStage = "writing_generated_files";
  await Promise.all([
    fs.writeFile(
      path.join(outputDirectory, "semantic-trace.json"),
      JSON.stringify(semanticTrace, null, 2),
      "utf8"
    ),
    fs.writeFile(
      path.join(outputDirectory, "max-program.json"),
      JSON.stringify(analysis.maxProgram, null, 2),
      "utf8"
    ),
    fs.writeFile(path.join(outputDirectory, "3dsmax-replay.ms"), rendered.script, "utf8")
  ]);
  if (config.output?.keepDiagnostics === true) {
    await fs.writeFile(
      path.join(outputDirectory, "analysis-input-manifest.json"),
      JSON.stringify({
        format: "ThreeDsMaxAnalysisInputManifest",
        version: "0.1",
        model: config.provider?.model ?? null,
        requestCount: audits.length,
        totalUploadedImages: audits.reduce((sum, audit) => sum + audit.uploadedScreenshots.length, 0),
        apiUsage,
        chunks: audits,
        knowledge: knowledge?.metadata ?? null,
        renderer: {
          partial: rendered.partial,
          renderedOperationCount: rendered.renderedOperationCount,
          skipped: rendered.skipped
        }
      }, null, 2),
      "utf8"
    );
  } else {
    await fs.rm(path.join(outputDirectory, "analysis-input-manifest.json"), { force: true });
  }
  await fs.rm(checkpointPath, { force: true });
  await fs.rm(path.join(outputDirectory, "analysis-error.json"), { force: true });
  activeStage = "complete";
  console.log(`已生成 3ds Max MAXScript：${path.join(outputDirectory, "3dsmax-replay.ms")}`);
  if (rendered.approximate) console.warn("MAXScript 包含明确标注的视觉估算参数，只用于近似形状还原，不是精确尺寸复现。");
  if (trackFaces) {
    const faces = analysis.visualFaceTracking;
    console.log(`视觉面追踪：${faces?.frames.length ?? 0} 个已分析帧，${faces?.tracks.length ?? 0} 个视觉身份，` +
      `${faces?.tracks.filter((t) => t.identity === "candidate").length ?? 0} 个候选；` +
      `${faces?.issues.length ?? 0} 项覆盖/匹配提示，详见 semantic-trace.json。`);
  }
  if (rendered.partial)
    console.warn(`MAXScript 只包含已确认操作；${rendered.skipped.length} 项后端不支持或证据不足。`);
}

export async function analyzeChunk({ client, payload, screenshots, knownObjects, visualFaceState = mergeVisualFaceTracking([]), maxValidationRepairs }) {
  let result = await client.analyze({
    instructions: THREE_DSMAX_ANALYSIS_INSTRUCTIONS,
    payload,
    screenshots,
    outputSchema: THREE_DSMAX_ANALYSIS_SCHEMA,
    outputName: "three_ds_max_scene_analysis",
    outputDescription: "从 3ds Max 录制证据恢复的结构化场景操作，不包含自由编写的脚本"
  });
  for (let attempt = 0; ; attempt += 1) {
    try {
      const validated = validateThreeDsMaxAnalysis(result, {
        knownObjectIds: knownObjects.map((object) => object.id),
        geometryReferences: knownObjects.flatMap((object) => object.geometryReferences ?? []),
        validateReferences: true
      });
      assertThreeDsMaxEvidenceCoverage(validated, payload);
      validated.visualFaceTracking = trackVisualFaces(visualFaceState, validated.visualFaceFrames, payload, validated);
      return validated;
    } catch (error) {
      // 有精确拖拽证据却仍丢失/读错变换时，不得生成看似可运行的部分脚本。
      // 这种脚本会把副本移到视野外，比明确失败更难察觉。
      if (attempt >= maxValidationRepairs) {
        error.lastAnalysisResult = result;
        throw error;
      }
      const repairFocus = buildRepairFocus(payload, screenshots, error.message);
      result = await client.analyze({
        instructions: `${THREE_DSMAX_ANALYSIS_INSTRUCTIONS}\n\n上一轮结果未通过本地语义校验。以 previousResult 为基础输出完整修正结果，保留可靠操作。先重新判断工具、选择层级和数值含义，再读取同事务证据。若为子对象编辑或证据不可读，明确填写 dragAssessments 并标记不完整；禁止为了通过校验提高置信度或编造变换。`,
        payload: {
          ...payload,
          actions: repairFocus.actions,
          screenshots: repairFocus.screenshotMetadata,
          repair: {
            validationError: error.message,
            previousResult: result,
            focusSourceEventIds: repairFocus.sourceEventIds,
            focusActions: repairFocus.actions
          }
        },
        screenshots: repairFocus.screenshots,
        outputSchema: THREE_DSMAX_ANALYSIS_SCHEMA,
        outputName: "three_ds_max_scene_analysis_repair",
        outputDescription: "修复对象引用后可编译为 MAXScript 的 3ds Max 场景操作"
      });
    }
  }
}

function buildRepairFocus(payload, screenshots, validationError) {
  const sourceEventIds = [...new Set(String(validationError ?? "").match(/evt-\d+/g) ?? [])];
  if (sourceEventIds.length === 0 || payload.visualFaceInput?.enabled) {
    return {
      sourceEventIds,
      actions: payload.actions,
      screenshots,
      screenshotMetadata: payload.screenshots
    };
  }

  const eventSet = new Set(sourceEventIds);
  const matchingIndexes = payload.actions.map((action, index) =>
    (action.sourceEventIds ?? []).some((id) => eventSet.has(id)) ? index : -1
  ).filter((index) => index >= 0);
  const includedIndexes = new Set();
  for (const index of matchingIndexes) {
    // 前面的工具/选择操作和后面的 Clone Options 都可能是当前拖拽的必要语义。
    for (let candidate = Math.max(0, index - 3);
      candidate <= Math.min(payload.actions.length - 1, index + 4); candidate += 1)
      includedIndexes.add(candidate);
  }
  const actions = [...includedIndexes].sort((left, right) => left - right)
    .map((index) => payload.actions[index]);
  const evidenceNames = new Set(actions.flatMap((action) => [
    action.screenshotBefore,
    action.screenshotSelection,
    action.screenshotAfter,
    ...(action.transformEvidence ?? []).map((item) => item.screenshot)
  ].filter(Boolean)));
  const focusedScreenshots = screenshots.filter((item) =>
    [...evidenceNames].some((name) => item.label?.includes(name)));
  const usableScreenshots = focusedScreenshots.length > 0 ? focusedScreenshots : screenshots;
  const screenshotMetadata = (payload.screenshots ?? []).filter((item) =>
    usableScreenshots.some((screenshot) => screenshot.label === item.label));
  return {
    sourceEventIds,
    actions,
    screenshots: usableScreenshots,
    screenshotMetadata
  };
}

async function existingScreenshotInputs(recordingDirectory, names, actions) {
  const items = [];
  for (const name of names) {
    const filePath = path.join(recordingDirectory, name);
    try {
      await fs.access(filePath);
    } catch {
      continue;
    }
    const action = actions.find((candidate) =>
      candidate.screenshotBefore === name || candidate.screenshotSelection === name ||
      candidate.screenshotAfter === name ||
      (candidate.transformEvidence ?? []).some((item) => item.screenshot === name));
    const transformEvidence = (action?.transformEvidence ?? []).find((item) => item.screenshot === name);
    const phase = transformEvidence?.phase ?? (action?.screenshotBefore === name
      ? "before"
      : action?.screenshotSelection === name ? "selection" : "after");
    const evidenceKind = transformEvidence?.kind ?? null;
    const fullFrameName = phase === "before" ? action?.screenshotBefore : action?.screenshotAfter;
    const fullFramePath = fullFrameName ? path.join(recordingDirectory, fullFrameName) : null;
    const fullFrameAvailable = fullFramePath ? await fs.access(fullFramePath).then(() => true, () => false) : false;
    const cropPlan = buildThreeDsMaxEvidenceCrop(action, transformEvidence, fullFrameAvailable);
    items.push({
      logicalScreenshot: name,
      path: cropPlan?.fromFullFrame ? fullFramePath : filePath,
      label: evidenceKind
        ? `${name}（3ds Max 局部证据；区域=${evidenceKind}；阶段=${phase}；${cropPlan?.fromFullFrame ? `从同阶段全图 ${fullFrameName} 重新裁取；` : "保留原局部图全部内容；"}必须视觉确认工具、对象/子对象层级、标签、模式和字段可读性；图片存在不代表数值有效）`
        : `${name}（3ds Max 操作${phase}；与同一 sourceEventIds 的其它图片比较最终场景变化）`,
      evidenceRole: evidenceKind
        ? `3dsmax_transform_${evidenceKind}_${phase}`
        : action?.visualChange?.changed === true
          ? `3dsmax_scene_change_${phase}`
          : `3dsmax_interaction_${phase}`,
      ...(evidenceKind ? { detail: "high" } : {}),
      ...(cropPlan ? { crop: cropPlan.crop, cropIsRegion: true, upscale: cropPlan.upscale } : {})
    });
  }
  return items;
}

function compactAction(action, uploadedScreenshots = null) {
  const uploaded = (name) => !uploadedScreenshots || (name && uploadedScreenshots.has(name));
  const harness = buildThreeDsMaxTransformHarness(action);
  if (harness?.dragTransaction?.transformTypeInPair) {
    const pair = harness.dragTransaction.transformTypeInPair;
    const pairUploaded = uploaded(pair.beforeScreenshot) && uploaded(pair.afterScreenshot);
    harness.dragTransaction.transformTypeInPair = pairUploaded
      ? { ...pair, uploadedEvidence: true }
      : null;
  }
  return {
    action: action.action,
    startMs: action.startMs ?? null,
    endMs: action.endMs ?? null,
    screenshotBeforeTimestampMs: action.screenshotBeforeTimestampMs ?? null,
    screenshotAfterTimestampMs: action.screenshotAfterTimestampMs ?? null,
    button: action.button ?? null,
    text: action.text ?? null,
    key: action.key ?? null,
    modifiers: action.modifiers ?? [],
    at: action.at ?? null,
    from: action.from ?? null,
    to: action.to ?? null,
    interactiveContinuation: action.interactiveContinuation ?? null,
    target: compactTarget(action.target),
    window: action.window ? {
      title: action.window.title ?? null,
      processName: action.window.processName ?? null,
      width: action.window.width ?? null,
      height: action.window.height ?? null
    } : null,
    screenshotBefore: uploaded(action.screenshotBefore) ? action.screenshotBefore : null,
    screenshotSelection: uploaded(action.screenshotSelection) ? action.screenshotSelection : null,
    screenshotAfter: uploaded(action.screenshotAfter) ? action.screenshotAfter : null,
    transformEvidence: (action.transformEvidence ?? []).map((item) => ({
      kind: item.kind ?? null,
      phase: item.phase ?? null,
      screenshot: item.screenshot ?? null,
      relativeBounds: item.relativeBounds ?? null,
      pixelBounds: item.pixelBounds ?? null
    })).filter((item) => uploaded(item.screenshot)).map((item) => ({
      ...item,
      uploadedEvidence: true
    })),
    transformHarness: harness,
    visualChange: action.visualChange ?? null,
    sourceEventIds: action.sourceEventIds ?? []
  };
}

function compactTarget(target) {
  if (!target) return null;
  return {
    name: target.name ?? null,
    role: target.role ?? null,
    automationId: target.automationId ?? null,
    className: target.className ?? null,
    relativeX: target.relativeX ?? null,
    relativeY: target.relativeY ?? null,
    ancestors: (target.ancestors ?? []).slice(0, 6).map((item) => ({
      name: item.name ?? null,
      role: item.role ?? null,
      automationId: item.automationId ?? null,
      className: item.className ?? null
    }))
  };
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--recording") result.recording = argv[++index];
    else if (argv[index] === "--config") result.config = argv[++index];
    else if (argv[index] === "--output") result.output = argv[++index];
  }
  return result;
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
  const recordingDirectory = path.resolve(options.recording);
  const outputDirectory = path.resolve(options.output ?? path.join(recordingDirectory, "generated"));
  await fs.mkdir(outputDirectory, { recursive: true });
  const errorPath = path.join(outputDirectory, "analysis-error.json");
  await fs.writeFile(errorPath, JSON.stringify({
    format: "ThreeDsMaxRecorderAnalysisError",
    version: "0.1",
    failedAt: new Date().toISOString(),
    stage,
    error: serializeError(error),
    lastAnalysisResult: error.lastAnalysisResult ?? null
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
    stack: error.stack ?? null,
    cause: serializeError(error.cause, depth + 1)
  };
}
