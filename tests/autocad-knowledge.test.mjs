import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  isAutoCadRecording,
  loadAutoCadKnowledge,
  reconcileAutoCadCommandContexts,
  retrieveAutoCadKnowledge,
  validateAutoCadProgramWithKnowledge
} from "../src/analyzer/lib/autocad-knowledge.mjs";
import { ANALYSIS_INSTRUCTIONS } from "../src/analyzer/lib/prompt.mjs";

test("按录制证据检索 AutoCAD 控件、命令和安全 SCR 形式", async () => {
  const root = await createKnowledgeFixture();
  try {
    const knowledge = await loadAutoCadKnowledge(root);
    const actions = [{
      action: "click",
      target: {
        name: "",
        automationId: "AcRibbonCommandButton",
        ancestors: [{ name: "Circle", automationId: "ID_RBN_CMDBTN_CIRCLE" }]
      },
      window: { processName: "acad", title: "Autodesk AutoCAD 2027" }
    }, {
      action: "type_text",
      text: "C",
      window: { processName: "acad", title: "Autodesk AutoCAD 2027" }
    }];
    const result = retrieveAutoCadKnowledge(knowledge, actions);

    assert.equal(result.audit.applicable, true);
    assert.equal(result.audit.providedToModel, true);
    assert.ok(result.context.controls.some((item) => item.name === "Circle"));
    assert.ok(result.context.commands.some((item) =>
      item.canonicalName === "CIRCLE" && item.scriptCommand === "_.CIRCLE"));
    assert.deepEqual(result.context.navigation.tabs[0].panels, ["Draw"]);
    assert.ok(result.audit.payloadBytes > 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("非 AutoCAD 录制不注入 AutoCAD 知识", async () => {
  const result = retrieveAutoCadKnowledge({ controls: [] }, [{
    action: "click",
    window: { processName: "notepad", title: "Untitled - Notepad" }
  }]);
  assert.equal(isAutoCadRecording([{ window: { processName: "notepad" } }]), false);
  assert.equal(result.context, null);
  assert.equal(result.audit.providedToModel, false);
});

test("命令行中的明确别名不会被同一分段后续按钮候选挤出", async () => {
  const root = await createKnowledgeFixture();
  try {
    const knowledge = await loadAutoCadKnowledge(root);
    const result = retrieveAutoCadKnowledge(knowledge, [{
      action: "press_key",
      key: "ENTER",
      target: { name: "AR" },
      window: { processName: "acad" }
    }, {
      action: "click",
      target: { name: "Circle" },
      window: { processName: "acad" }
    }], { maxCommands: 1 });
    assert.equal(result.context.commands[0].canonicalName, "ARRAY");
    assert.equal(result.context.commands[0].scriptCommand, "_.-ARRAY");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Recorder 命令上下文直接参与命令目录检索", async () => {
  const root = await createKnowledgeFixture();
  try {
    const knowledge = await loadAutoCadKnowledge(root);
    const result = retrieveAutoCadKnowledge(knowledge, [{
      action: "press_key",
      key: "ENTER",
      visualCommandContext: "CIRCLE",
      cadInputEvidence: { command: "CIRCLE", parameterName: "radius", value: 12, exact: true },
      window: { processName: "acad" }
    }], { maxCommands: 1 });
    assert.equal(result.context.commands[0].canonicalName, "CIRCLE");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("无 UIA 且精确词匹配失败时仍提供可审计的最近命令候选", async () => {
  const root = await createKnowledgeFixture();
  try {
    const knowledge = await loadAutoCadKnowledge(root);
    const result = retrieveAutoCadKnowledge(knowledge, [{
      action: "click", target: null,
      window: { processName: "acad", title: "Autodesk AutoCAD 2027" }
    }], { fallbackCommands: ["ARRAY"], maxCommands: 3 });
    assert.ok(result.context.commands.some((item) => item.canonicalName === "ARRAY"));
    assert.deepEqual(result.context.retrieval.fallbackCandidateCommands, ["ARRAY"]);
    assert.deepEqual(result.audit.fallbackCandidateCommands, ["ARRAY"]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("命令完成后用目录别名覆盖滞后的 Recorder 上下文", async () => {
  const root = await createKnowledgeFixture();
  try {
    const knowledge = await loadAutoCadKnowledge(root);
    const actions = [{ action: "press_key", key: "ENTER", visualCommandContext: "CIRCLE" },
      { action: "type_text", text: "12", visualCommandContext: "CIRCLE" },
      {
        action: "press_key", key: "ENTER", visualCommandContext: "CIRCLE",
        cadInputEvidence: { command: "CIRCLE", parameterName: "radius", value: 12, exact: true }
      },
      { action: "type_text", text: "AR", visualCommandContext: "CIRCLE" },
      { action: "press_key", key: "ENTER", visualCommandContext: "CIRCLE", target: { name: "AR" } }];
    reconcileAutoCadCommandContexts(actions, knowledge);
    assert.equal(actions[2].resolvedCadCommandContext, "CIRCLE");
    assert.equal(actions[3].resolvedCadCommandContext, null);
    assert.equal(actions[4].resolvedCadCommandContext, "ARRAY");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("分析规则允许用连续动态极坐标重建多点几何", () => {
  assert.match(ANALYSIS_INSTRUCTIONS, /Pnext=Pprevious\+d×\(cosθ,sinθ\)/);
  assert.match(ANALYSIS_INSTRUCTIONS, /rawActionTail/);
  assert.match(ANALYSIS_INSTRUCTIONS, /cadProgram 是与 SCR 无关的结构化中间表示/);
  assert.match(ANALYSIS_INSTRUCTIONS, /禁止因为一项不完整而清空已确认操作/);
  assert.match(ANALYSIS_INSTRUCTIONS, /cad_input_commit/);
  assert.match(ANALYSIS_INSTRUCTIONS, /cadEntityCatalog/);
  assert.match(ANALYSIS_INSTRUCTIONS, /90° 对应 \(x,y\+d\)/);
  assert.match(ANALYSIS_INSTRUCTIONS, /uiAutomationTargetsRecorded=false/);
  assert.match(ANALYSIS_INSTRUCTIONS, /不得编造 name、AutomationId/);
  assert.doesNotMatch(ANALYSIS_INSTRUCTIONS, /nativeScript\.lines/);
});

test("用命令目录验证 CAD 中间表示中的规范命令", async () => {
  const root = await createKnowledgeFixture();
  try {
    const knowledge = await loadAutoCadKnowledge(root);
    assert.throws(() => validateAutoCadProgramWithKnowledge(programWithCommands("C"), knowledge),
      /仅供识别的 PGP 缩写/);
    assert.throws(() => validateAutoCadProgramWithKnowledge(programWithCommands("NOTACOMMAND"), knowledge),
      /未收录的核心命令/);

    const valid = validateAutoCadProgramWithKnowledge(programWithCommands("CIRCLE", "ARRAY"), knowledge);
    assert.equal(valid.valid, true);
    assert.deepEqual(valid.checkedCommands.map((item) => item.canonicalName), ["CIRCLE", "ARRAY"]);
    assert.deepEqual(valid.checkedCommands.map((item) => item.scriptCommand), ["_.CIRCLE", "_.-ARRAY"]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

function programWithCommands(...commands) {
  return {
    cadProgram: {
      format: "autocad_command_ir",
      operations: commands.map((command, index) => ({
        id: `c1-op-${index}`,
        semanticKind: "command",
        command,
        arguments: [],
        resultEntityIds: [],
        sourceEventIds: [],
        sourceScreenshots: [],
        confidence: 0.9
      })),
      confidence: 0.9,
      warnings: [],
      complete: true
    }
  };
}

async function createKnowledgeFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "autocad-knowledge-"));
  await fs.mkdir(path.join(root, "commands"), { recursive: true });
  await fs.mkdir(path.join(root, "home", "panels", "draw"), { recursive: true });
  await writeJson(path.join(root, "ui-index.json"), {
    schemaVersion: "1.0",
    application: { name: "Autodesk AutoCAD", version: "2027", language: "en-US" },
    scope: { defaultForAgent: "core_stock_only" },
    lookupPolicy: "semantic hierarchy",
    tabs: [{
      tab: "Home",
      uid: "ID_TabHome",
      workspaces: ["Drafting & Annotation"],
      panelsIndex: "home/panels/index.json"
    }]
  });
  await writeJson(path.join(root, "home", "panels", "index.json"), {
    panels: [{ name: "Draw", uid: "ID_PanelDraw", map: "draw/ui-map.json" }]
  });
  await writeJson(path.join(root, "home", "panels", "draw", "ui-map.json"), {
    application: { workspace: "Drafting & Annotation" },
    scope: { tabName: "Home", tabUid: "ID_TabHome", panelName: "Draw", panelUid: "ID_PanelDraw" },
    nodes: {
      circle: {
        id: "circle",
        kind: "command_button",
        name: "Circle",
        names: { visible: "Circle", official: "Circle", aliases: ["CIRCLE"] },
        placement: { region: "main", order: 1 },
        action: { type: "invoke_command", cliCommand: "CIRCLE" },
        semantics: { description: "Creates a circle." },
        verification: { liveObserved: true, interactionTested: false, confidence: 0.95 }
      }
    }
  });
  await writeJson(path.join(root, "commands", "command-catalog.json"), {
    schemaVersion: "1.0",
    generatedAt: "2026-08-25T00:00:00Z",
    executionPolicy: { aliasesAreForRecognitionOnly: true, aliasesAreScriptSafe: false },
    totals: { officialCoreCommands: 3, effectiveAliases: 2 },
    aliasIndex: {
      C: { command: "CIRCLE", scriptSafe: false },
      AR: { command: "ARRAY", scriptSafe: false }
    },
    commands: {
      CIRCLE: command("CIRCLE", "_.CIRCLE", [{ value: "C" }], "Creates a circle."),
      ARRAY: {
        ...command("ARRAY", "_.-ARRAY", [{ value: "AR" }], "Creates copies in a pattern."),
        scriptCommandCanonicalName: "-ARRAY",
        related: { dialogCommand: null, commandLineVariant: "-ARRAY" }
      },
      "-ARRAY": {
        ...command("-ARRAY", "_.-ARRAY", [{ value: "-AR" }], "Creates copies from the command line."),
        related: { dialogCommand: "ARRAY", commandLineVariant: null }
      }
    }
  });
  return root;
}

function command(name, scriptCommand, aliases, description) {
  return {
    canonicalName: name,
    includedInCore: true,
    globalCommand: `_.${name}`,
    scriptCommand,
    scriptCommandCanonicalName: name,
    description,
    aliases,
    recognitionSynonyms: [],
    related: { dialogCommand: null, commandLineVariant: null },
    documentation: { url: `https://help.example/${encodeURIComponent(name)}` }
  };
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, JSON.stringify(value), "utf8");
}
