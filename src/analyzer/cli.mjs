#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { GptClient } from "./lib/gpt-client.mjs";
import { loadLocalEnv } from "./lib/local-env.mjs";
import { ANALYSIS_INSTRUCTIONS } from "./lib/prompt.mjs";
import { renderTypeScript } from "./lib/script-renderer.mjs";
import { renderComputerUseTask } from "./lib/computer-use-renderer.mjs";
import { buildCandidateActions, chunkActions, makeAnalysisBundle, readJsonLines } from "./lib/trace.mjs";
import { mergeWorkflows, validateWorkflow } from "./lib/workflow.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.recording || !args.config) {
  usage();
  process.exitCode = 1;
} else {
  await main(args);
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
  const actionChunks = chunkActions(actions, config.analysis?.maxActionsPerRequest ?? 150);
  const client = new GptClient(config.provider);
  const partialPlans = [];

  if (actions.length === 0) {
    partialPlans.push({ summary: "未检测到可执行操作", steps: [], omitted: [], warnings: [] });
  } else {
    for (let index = 0; index < actionChunks.length; index += 1) {
      const chunk = actionChunks[index];
      const bundle = makeAnalysisBundle(
        recordingDir,
        chunk,
        config.analysis?.maxScreenshotsPerRequest ?? 12
      );
      const screenshots = config.analysis?.includeScreenshots === false
        ? []
        : bundle.screenshots.map((file) => ({
            path: path.join(recordingDir, file),
            label: file
          }));

      const partialPlan = await client.analyze({
        instructions: ANALYSIS_INSTRUCTIONS,
        payload: {
          format: "UniversalInteractionTrace",
          version: "0.1",
          outputLanguage: config.analysis?.language ?? "zh-CN",
          minimumConfidence,
          chunk: { index: index + 1, total: actionChunks.length },
          previousChunkContext: partialPlans.length === 0 ? null : {
            summary: partialPlans[partialPlans.length - 1].summary,
            recentSteps: partialPlans[partialPlans.length - 1].steps.slice(-5).map((step) => ({
              goal: step.goal,
              action: step.action,
              expectedState: step.expectedState
            }))
          },
          candidateActions: chunk
        },
        screenshots
      });
      partialPlans.push(validateWorkflow(partialPlan));
    }
  }

  const plan = mergeWorkflows(partialPlans, { minimumConfidence });

  const outputDir = path.resolve(options.output ?? path.join(recordingDir, "generated"));
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, "semantic-trace.json"), JSON.stringify(plan, null, 2));
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
  console.log(`已生成: ${outputDir}`);
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
