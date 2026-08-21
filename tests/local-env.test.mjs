import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadLocalEnv } from "../src/analyzer/lib/local-env.mjs";

test("从本地 .env 读取 OpenAI API 密钥", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mock-recorder-env-"));
  const filePath = path.join(directory, ".env");
  await fs.writeFile(filePath, "# local secret\nOPENAI_API_KEY=secret-from-file\n", "utf8");
  delete process.env.OPENAI_API_KEY;

  try {
    await loadLocalEnv(filePath);
    assert.equal(process.env.OPENAI_API_KEY, "secret-from-file");
  } finally {
    delete process.env.OPENAI_API_KEY;
    await fs.rm(directory, { recursive: true, force: true });
  }
});
