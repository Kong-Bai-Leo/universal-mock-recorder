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
import { buildCandidateActions, chunkActions, makeAnalysisBundle, readJsonLines } from "./lib/trace.mjs";
import { mergeWorkflows, validateWorkflow } from "./lib/workflow.mjs";
import { optimizeScreenshots } from "./lib/image-optimizer.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.recording || !args.config) {
  usage();
  process.exitCode = 1;
} else {
  try {
    await main(args);
  } catch (error) {
    console.error(error?.message ?? String(error));
    process.exitCode = 1;
  }
}

async function main(options) {
  const analyzerDir = path.dirname(fileURLToPath(import.meta.url));
  await loadLocalEnv(path.resolve(analyzerDir, "../..", ".env"));
  const recordingDir = path.resolve(options.recording);
  const config = JSON.parse(await fs.readFile(path.resolve(options.config), "utf8"));
  if ((config.output?.scriptLanguage ?? "typescript") !== "typescript")
    throw new Error("当前版本只支持生成 TypeScript Mock 脚本");
  const events = await readJsonLines(path.join(recordingDir, "events.jsonl"));
  const actions = buildCandidateActions(events);
  const minimumConfidence = config.analysis?.minimumConfidence ?? 0.65;
  const maxScreenshotsPerRequest = config.analysis?.maxScreenshotsPerRequest ?? 16;
  const actionChunks = chunkActions(actions, config.analysis?.maxActionsPerRequest ?? 150, {
    maxCanvasEvidence: Math.max(1, maxScreenshotsPerRequest - 4)
  });
  const client = new GptClient(config.provider);
  const partialPlans = [];
  const analysisInputChunks = [];
  const apiImageDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "mock-recorder-api-images-"));

  try {
    if (actions.length === 0) {
      partialPlans.push({ summary: "未检测到可执行操作", steps: [], omitted: [], warnings: [] });
    } else {
      for (let index = 0; index < actionChunks.length; index += 1) {
        const chunk = actionChunks[index];
        const bundle = makeAnalysisBundle(
          recordingDir,
          chunk,
          config.analysis?.maxScreenshotsPerRequest ?? 8
        );
        const originalScreenshots = config.analysis?.includeScreenshots === false
          ? []
          : bundle.screenshots.map((file) => makeScreenshotInput(recordingDir, file, chunk));
        const screenshots = await optimizeScreenshots(
          originalScreenshots,
          path.join(apiImageDirectory, `chunk-${index + 1}`),
          config.analysis
        );

        const partialPlan = await client.analyze({
          instructions: ANALYSIS_INSTRUCTIONS,
          payload: {
            format: "UniversalInteractionTrace",
            version: "0.1",
            outputLanguage: config.analysis?.language ?? "zh-CN",
            minimumConfidence,
            chunk: { index: index + 1, total: actionChunks.length },
            previousChunkContext: partialPlans.length === 0 ? null : {
              summary: partialPlans.map((plan) => plan.summary).filter(Boolean).slice(-3).join(" → "),
              recentSteps: partialPlans.flatMap((plan) => plan.steps ?? []).slice(-8).map((step) => ({
                goal: step.goal,
                action: step.action,
                value: step.value,
                expectedState: step.expectedState,
                canvasChange: step.canvasChange
              })),
              nativeScriptTail: partialPlans
                .filter((plan) => plan.nativeScript?.format === "autocad_scr")
                .flatMap((plan) => plan.nativeScript.lines)
                .slice(-24),
              nativeScriptWarnings: partialPlans
                .flatMap((plan) => plan.nativeScript?.warnings ?? [])
                .slice(-8)
            },
            candidateActions: chunk
          },
          screenshots
        });
        analysisInputChunks.push({
          chunk: index + 1,
          actionCount: chunk.length,
          screenshots: originalScreenshots.map((item) => ({
            source: path.relative(recordingDir, item.path).replaceAll("\\", "/"),
            uploadedAs: item.crop ? "canvas_click_crop" : "overview",
            label: item.label
          }))
        });
        partialPlans.push(validateWorkflow(partialPlan));
      }
    }
  } finally {
    await fs.rm(apiImageDirectory, { recursive: true, force: true });
  }

  const plan = mergeWorkflows(partialPlans, { minimumConfidence });

  const outputDir = path.resolve(options.output ?? path.join(recordingDir, "generated"));
  await fs.mkdir(outputDir, { recursive: true });
  await Promise.all([
    fs.rm(path.join(outputDir, "windows-replay.ps1"), { force: true }),
    fs.rm(path.join(outputDir, "运行回放.cmd"), { force: true }),
    fs.rm(path.join(outputDir, "autocad-replay.scr"), { force: true })
  ]);
  // 即使关键业务数值不足以生成 SCR，也先保留完整分析结果，便于用户查看真实原因并重新录制。
  await fs.writeFile(path.join(outputDir, "semantic-trace.json"), JSON.stringify(plan, null, 2));
  await fs.writeFile(
    path.join(outputDir, "analysis-input-manifest.json"),
    JSON.stringify({
      format: "RecorderAnalysisInputManifest",
      version: "0.1",
      model: config.provider?.model ?? null,
      requestCount: analysisInputChunks.length,
      totalUploadedImages: analysisInputChunks.reduce((sum, chunk) => sum + chunk.screenshots.length, 0),
      chunks: analysisInputChunks
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
  const autoCadScr = renderAutoCadScr(plan);
  await fs.writeFile(
    path.join(outputDir, "autocad-replay.scr"),
    autoCadScr,
    "utf8"
  );
  console.log(`已生成: ${outputDir}`);
}

function makeScreenshotInput(recordingDir, file, actions) {
  const pointAction = actions.find((action) =>
    action.screenshotBefore === file && isLikelyCanvasPointAction(action));
  if (!pointAction) return { path: path.join(recordingDir, file), label: file };
  return {
    path: path.join(recordingDir, file),
    label: `${file}（画布取点局部放大，图片中心是点击位置）`,
    crop: {
      centerX: pointAction.at.x,
      centerY: pointAction.at.y,
      width: 1200,
      height: 700
    }
  };
}

function isLikelyCanvasPointAction(action) {
  if (!["click", "double_click", "right_click", "middle_click"].includes(action.action)) return false;
  const target = action.target;
  const window = action.window;
  if (!action.at || !target?.width || !target?.height || !window?.width || !window?.height) return false;
  const areaRatio = target.width * target.height / Math.max(1, window.width * window.height);
  return /Pane|Document|Custom/i.test(String(target.role ?? "")) && areaRatio >= 0.2;
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--recording") result.recording = argv[++index];
    else if (key === "--config") result.config = argv[++index];
    else if (key === "--output") result.output = argv[++index];
  }
  return result;
}

function usage() {
  console.error("用法: node src/analyzer/cli.mjs --recording <录制目录> --config <config.json> [--output <目录>]");
}
