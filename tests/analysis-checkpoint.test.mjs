import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createAnalysisCheckpointIdentity,
  loadAnalysisCheckpoint,
  saveAnalysisCheckpoint
} from "../src/analyzer/lib/analysis-checkpoint.mjs";

test("长流程检查点只恢复连续且输入身份一致的已完成分段", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "analysis-checkpoint-"));
  const file = path.join(directory, "generated", "analysis-checkpoint.json");
  try {
    const identity = createAnalysisCheckpointIdentity({ actions: [1, 2], model: "test" });
    await saveAnalysisCheckpoint(file, {
      identity,
      totalChunks: 3,
      completed: [{ index: 1, plan: { summary: "one" }, audit: { chunk: 1 } }]
    });
    const restored = await loadAnalysisCheckpoint(file, identity, 3);
    assert.equal(restored.completed.length, 1);
    assert.equal(restored.completed[0].plan.summary, "one");
    assert.equal(await loadAnalysisCheckpoint(file, "different", 3), null);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
