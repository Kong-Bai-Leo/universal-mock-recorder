import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadActionMacroEvidence, retrieveActionMacroChunk } from "../src/analyzer/lib/action-macro.mjs";

test("读取新版 JSON ACTMX 并保留命令提示和精确参数", async () => {
  const recording = await fs.mkdtemp(path.join(os.tmpdir(), "action-macro-test-"));
  try {
    await fs.mkdir(path.join(recording, "action-recorder"));
    await fs.writeFile(path.join(recording, "action-recorder.json"), JSON.stringify({
      format: "AutoCadActionRecorderEvidence",
      status: "saved",
      macroName: "UMRTEST"
    }));
    await fs.writeFile(path.join(recording, "action-recorder", "UMRTEST.actmx"), JSON.stringify({
      ChildList: {
        List_0: {
          $type: "Autodesk.AutoCAD.MacroRecorder.CommandNode",
          PropertyBag: { m_data: "OFFSET" },
          ChildList: {
            List_0: {
              $type: "Autodesk.AutoCAD.MacroRecorder.GetDistanceNode",
              PropertyBag: { m_data: 10, m_prompt: "Specify offset distance:" }
            }
          }
        }
      }
    }));

    const evidence = await loadActionMacroEvidence(recording);
    assert.equal(evidence.metadata.available, true);
    assert.equal(evidence.metadata.macroName, "UMRTEST");
    assert.equal(evidence.metadata.parsedFormats[0], "actmx_json");
    assert.equal(evidence.entries[0].node.data, "OFFSET");
    assert.equal(evidence.entries[0].node.children[0].data, 10);

    const chunk = retrieveActionMacroChunk(evidence, 1, 2, { maxEntries: 4 });
    assert.equal(chunk.audit.available, true);
    assert.ok(chunk.context.entries.length <= 4);
    assert.match(chunk.context.alignment, /approximately/);
  } finally {
    await fs.rm(recording, { recursive: true, force: true });
  }
});

test("0 字节录制副本可从清单中的同名源文件只读恢复", async () => {
  const recording = await fs.mkdtemp(path.join(os.tmpdir(), "action-macro-recover-"));
  try {
    const source = path.join(recording, "source.actmx");
    await fs.mkdir(path.join(recording, "action-recorder"));
    await fs.writeFile(path.join(recording, "action-recorder", "source.actmx"), "");
    await fs.writeFile(source, JSON.stringify({
      ChildList: {
        List_0: {
          $type: "Autodesk.AutoCAD.MacroRecorder.CommandNode",
          PropertyBag: { m_data: "TRIM" }
        }
      }
    }));
    await fs.writeFile(path.join(recording, "action-recorder.json"), JSON.stringify({
      status: "saved", sourcePath: source
    }));

    const evidence = await loadActionMacroEvidence(recording);
    assert.equal(evidence.metadata.recoveredFromSource, true);
    assert.equal(evidence.entries[0].node.data, "TRIM");
  } finally {
    await fs.rm(recording, { recursive: true, force: true });
  }
});

test("未启用 Action Recorder 时不制造伪证据", async () => {
  const recording = await fs.mkdtemp(path.join(os.tmpdir(), "action-macro-empty-"));
  try {
    assert.equal(await loadActionMacroEvidence(recording), null);
    assert.equal(retrieveActionMacroChunk(null, 1, 1).context, null);
  } finally {
    await fs.rm(recording, { recursive: true, force: true });
  }
});
