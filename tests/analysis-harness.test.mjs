import test from "node:test";
import assert from "node:assert/strict";
import { buildAnalysisHarness } from "../src/analyzer/lib/analysis-harness.mjs";

test("Harness 在空闲状态把重复字符命令别名归一化为候选", () => {
  const result = buildAnalysisHarness({
    actions: [
      keyAction("ESCAPE", "escape-1"),
      textAction("aar", "type-array"),
      keyAction("ENTER", "enter-array")
    ],
    knowledge: fixtureKnowledge(),
    knowledgeContext: { commands: [] },
    uiAutomationTargetsRecorded: false,
    chunk: { index: 1, total: 2 }
  });

  assert.equal(result.context.commandStateHypothesis.activeCommand, "ARRAY");
  assert.equal(result.context.commandStateHypothesis.basis, "typed_repeated_character_normalization");
  assert.deepEqual(result.context.commandCandidates[0], {
    canonicalName: "ARRAY",
    confidence: 0.82,
    matchMethod: "typed_repeated_character_normalization",
    evidence: "AAR->AR"
  });
  assert.equal(result.context.inputInterpretations[0].command, null);
  assert.equal(result.context.inputInterpretations[1].classification, "command_candidate");
  assert.equal(result.context.inputInterpretations[1].command, "ARRAY");
});

test("Harness 在 ARRAY 活跃时把 ii 和 12 解释为 Items 与 item_count", () => {
  const result = buildAnalysisHarness({
    actions: [
      textAction("ii", "items-option"),
      keyAction("ENTER", "items-enter"),
      textAction(" 12", "items-value"),
      keyAction("ENTER", "value-enter")
    ],
    previousCommandState: {
      status: "deferred", activeCommand: "ARRAY", stage: "array_parameters",
      pendingParameter: null, visiblePrompt: "Items", lastCompletedCommand: null,
      evidenceEventIds: [], confidence: 0.94
    },
    knowledge: fixtureKnowledge(),
    knowledgeContext: { commands: [] },
    uiAutomationTargetsRecorded: false,
    chunk: { index: 2, total: 2 }
  });

  const option = result.context.inputInterpretations[0];
  const value = result.context.inputInterpretations[2];
  assert.equal(option.classification, "command_option_candidate");
  assert.equal(option.option, "Items");
  assert.equal(option.parameterName, "item_count");
  assert.equal(option.matchMethod, "repeated_character_normalization");
  assert.equal(value.classification, "parameter_value_candidate");
  assert.equal(value.parameterName, "item_count");
  assert.equal(value.value, 12);
});

function fixtureKnowledge() {
  return {
    commandCatalog: {
      aliasIndex: { AR: { command: "ARRAY" } },
      commands: {
        ARRAY: { includedInCore: true }
      }
    },
    commandGrammar: {
      commands: {
        ARRAY: {
          startStage: "select_objects",
          stages: [
            { id: "select_objects", expects: "selection", promptPatterns: ["Select objects"] },
            { id: "array_parameters", expects: "option_or_completion", promptPatterns: ["Items"] }
          ],
          options: [{
            keys: ["I"], name: "Items", parameterName: "item_count", valueType: "integer",
            validStages: ["array_parameters"]
          }],
          completionSignals: ["array_geometry_persists"]
        }
      }
    }
  };
}

function textAction(text, eventId) {
  return { action: "type_text", text, sourceEventIds: [eventId] };
}

function keyAction(key, eventId) {
  return { action: "press_key", key, sourceEventIds: [eventId] };
}
