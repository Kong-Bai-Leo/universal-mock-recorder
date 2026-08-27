import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

export function createAnalysisCheckpointIdentity(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function loadAnalysisCheckpoint(file, identity, totalChunks) {
  try {
    const checkpoint = JSON.parse(await fs.readFile(file, "utf8"));
    if (checkpoint?.format !== "RecorderAnalysisCheckpoint" ||
        checkpoint.version !== "0.1" || checkpoint.identity !== identity ||
        checkpoint.totalChunks !== totalChunks || !Array.isArray(checkpoint.completed))
      return null;
    const completed = [...checkpoint.completed].sort((left, right) => left.index - right.index);
    if (completed.some((item, index) => item.index !== index + 1 || !item.plan || !item.audit))
      return null;
    return { ...checkpoint, completed };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    return null;
  }
}

export async function saveAnalysisCheckpoint(file, checkpoint) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await fs.writeFile(temporary, JSON.stringify({
    format: "RecorderAnalysisCheckpoint",
    version: "0.1",
    updatedAt: new Date().toISOString(),
    ...checkpoint
  }, null, 2), "utf8");
  await fs.rm(file, { force: true });
  await fs.rename(temporary, file);
}
