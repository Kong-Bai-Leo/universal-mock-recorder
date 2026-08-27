export const ANALYSIS_HARNESS_VERSION = "0.1";

export function buildAnalysisHarness({
  actions,
  previousCommandState = null,
  knowledge = null,
  knowledgeContext = null,
  cadEntityCatalog = [],
  uiAutomationTargetsRecorded = true,
  chunk = null
}) {
  const actionList = Array.isArray(actions) ? actions : [];
  const previous = normalizePreviousCommandState(previousCommandState);
  const catalog = knowledge?.commandCatalog ?? null;
  const grammarCatalog = knowledge?.commandGrammar ?? null;
  const directCandidates = collectDirectCommandCandidates(actionList, catalog);
  const typedCandidates = collectTypedCommandCandidates(actionList, catalog);
  const retrievedCandidates = (knowledgeContext?.commands ?? []).map((command) => ({
    canonicalName: normalizeCommand(command.canonicalName),
    confidence: Math.min(0.6, Math.max(0.35, Number(command.retrievalScore ?? 0) / 400)),
    matchMethod: "knowledge_retrieval_candidate",
    evidence: command.reference ?? null
  })).filter((item) => item.canonicalName);
  const commandCandidates = deduplicateCandidates([
    ...directCandidates,
    ...typedCandidates,
    ...retrievedCandidates
  ]).slice(0, 8);

  const previousActive = ["active", "deferred"].includes(previous.status)
    ? normalizeCommand(previous.activeCommand)
    : null;
  const strongestLocal = commandCandidates.find((candidate) =>
    candidate.confidence >= 0.75 && candidate.matchMethod !== "knowledge_retrieval_candidate");
  const activeCommandHypothesis = previousActive ?? strongestLocal?.canonicalName ?? null;
  const activeCommandConfidence = previousActive
    ? previous.confidence
    : strongestLocal?.confidence ?? 0;
  const commandGrammar = activeCommandHypothesis
    ? compactCommandGrammar(grammarCatalog?.commands?.[activeCommandHypothesis])
    : null;
  const inputInterpretations = interpretInputs(
    actionList,
    previousActive,
    previous.stage,
    grammarCatalog,
    catalog
  );
  const lastEscapeIndex = findLastIndex(actionList, (action) =>
    action.action === "press_key" && action.key === "ESCAPE");
  const lastCommandEvidenceIndex = findLastIndex(actionList, (action) =>
    action.resolvedCadCommandContext || action.cadInputEvidence?.command || action.action === "type_text");
  const locallyCancelled = lastEscapeIndex >= 0 && lastEscapeIndex > lastCommandEvidenceIndex;
  const stateHypothesis = {
    status: locallyCancelled
      ? "idle_candidate"
      : activeCommandHypothesis ? "active_candidate" : "unknown",
    activeCommand: locallyCancelled ? null : activeCommandHypothesis,
    stage: previousActive && previous.stage
      ? previous.stage
      : commandGrammar?.startStage ?? null,
    confidence: locallyCancelled ? 0.9 : activeCommandConfidence,
    basis: previousActive
      ? "previous_ai_command_state"
      : strongestLocal?.matchMethod ?? "no_reliable_local_command_state"
  };

  const harness = {
    format: "RecorderAnalysisHarness",
    version: ANALYSIS_HARNESS_VERSION,
    application: knowledge ? "Autodesk AutoCAD" : null,
    chunk,
    recognitionMode: uiAutomationTargetsRecorded
      ? "input_screenshots_plus_ui_automation"
      : "input_screenshots_without_ui_automation",
    previousCommandState: previous,
    commandStateHypothesis: stateHypothesis,
    commandCandidates,
    commandGrammar,
    inputInterpretations,
    evidenceSummary: summarizeEvidence(actionList),
    entitySummary: summarizeEntities(cadEntityCatalog),
    decisionRules: [
      "Treat the visible AutoCAD prompt and dynamic-input screenshot as authoritative for command stage.",
      "At an idle Command prompt, a submitted token may be a command or alias; inside an active command, first match it against options allowed by that command and stage.",
      "ENTER is context-dependent: it may submit a value, accept a default, finish a selection, finish a command, or repeat the previous command while idle.",
      "ESCAPE cancels the active command or selection; an ordinary blank-canvas click is never a universal completion signal.",
      "Repeated-character normalization is a candidate aid only. Confirm it against the visible prompt and subsequent state before accepting it.",
      "The command grammar and command candidates do not prove user intent. Keep uncertainty explicit in commandState and step confidence.",
      "Use deterministic cadEntityCatalog geometry for calculations; never convert screenshot pixels into CAD business units."
    ]
  };
  return {
    context: harness,
    audit: {
      version: ANALYSIS_HARNESS_VERSION,
      chunk,
      previousCommandState: previous,
      commandStateHypothesis: stateHypothesis,
      commandCandidates,
      inputInterpretations,
      grammarCommand: activeCommandHypothesis && commandGrammar ? activeCommandHypothesis : null,
      grammarAvailable: Boolean(commandGrammar),
      entityCount: Array.isArray(cadEntityCatalog) ? cadEntityCatalog.length : 0
    }
  };
}

export function emptyAnalysisCommandState() {
  return {
    status: "unknown",
    activeCommand: null,
    stage: null,
    pendingParameter: null,
    visiblePrompt: null,
    lastCompletedCommand: null,
    evidenceEventIds: [],
    confidence: 0
  };
}

function normalizePreviousCommandState(value) {
  if (!value || typeof value !== "object") return emptyAnalysisCommandState();
  return {
    status: ["idle", "active", "deferred", "cancelled", "unknown"].includes(value.status)
      ? value.status : "unknown",
    activeCommand: normalizeCommand(value.activeCommand),
    stage: nullableText(value.stage),
    pendingParameter: nullableText(value.pendingParameter),
    visiblePrompt: nullableText(value.visiblePrompt),
    lastCompletedCommand: normalizeCommand(value.lastCompletedCommand),
    evidenceEventIds: Array.isArray(value.evidenceEventIds)
      ? value.evidenceEventIds.filter((item) => typeof item === "string") : [],
    confidence: Number.isFinite(value.confidence)
      ? Math.min(1, Math.max(0, value.confidence)) : 0
  };
}

function collectDirectCommandCandidates(actions, catalog) {
  const candidates = [];
  for (const action of actions) {
    for (const [value, method, confidence] of [
      [action.resolvedCadCommandContext, "resolved_command_context", 0.98],
      [action.cadInputEvidence?.command, "committed_input_command", action.cadInputEvidence?.parameterRoleExact ? 0.98 : 0.86],
      [action.visualCommandContext, "recorded_visual_command_context", 0.72],
      [action.cadCommandContext, "recorded_cad_command_context", 0.68]
    ]) {
      const canonicalName = resolveCanonicalCommand(value, catalog)?.command;
      if (!canonicalName) continue;
      candidates.push({
        canonicalName,
        confidence,
        matchMethod: method,
        evidence: action.sourceEventIds?.join("+") ?? null
      });
    }
  }
  return candidates;
}

function collectTypedCommandCandidates(actions, catalog) {
  const candidates = [];
  for (const action of actions) {
    if (action.action !== "type_text") continue;
    const raw = normalizeToken(action.text);
    if (!raw || isNumericToken(raw)) continue;
    const exact = resolveCanonicalCommand(raw, catalog);
    if (exact) {
      candidates.push({
        canonicalName: exact.command,
        confidence: exact.alias ? 0.94 : 0.97,
        matchMethod: exact.alias ? "typed_exact_alias" : "typed_exact_command",
        evidence: action.sourceEventIds?.join("+") ?? raw
      });
      continue;
    }
    const collapsed = collapseRepeatedLetters(raw);
    if (collapsed === raw) continue;
    const repeated = resolveCanonicalCommand(collapsed, catalog);
    if (!repeated) continue;
    candidates.push({
      canonicalName: repeated.command,
      confidence: 0.82,
      matchMethod: "typed_repeated_character_normalization",
      evidence: `${raw}->${collapsed}`
    });
  }
  return candidates;
}

function interpretInputs(actions, initialCommand, previousStage, grammarCatalog, catalog) {
  const interpretations = [];
  let pendingParameter = null;
  let activeCommand = initialCommand;
  let activeStage = initialCommand ? previousStage : null;
  let grammar = compactCommandGrammar(grammarCatalog?.commands?.[activeCommand]) ?? null;
  for (const action of actions) {
    if (action.action === "press_key") {
      if (["ENTER", "SPACE", "ESCAPE"].includes(action.key)) {
        interpretations.push({
          sourceEventIds: action.sourceEventIds ?? [],
          raw: action.key,
          normalized: action.key,
          classification: action.key === "ESCAPE" ? "cancel_signal" : "context_dependent_commit",
          command: activeCommand,
          stage: activeStage,
          option: null,
          parameterName: pendingParameter,
          value: null,
          matchMethod: "key_semantics",
          confidence: action.key === "ESCAPE" ? 0.99 : 0.55
        });
        if (action.key === "ESCAPE") {
          pendingParameter = null;
          activeCommand = null;
          activeStage = null;
          grammar = null;
        }
      }
      continue;
    }
    if (action.action !== "type_text") continue;
    const rawText = String(action.text ?? "");
    const token = normalizeToken(rawText);
    const collapsed = collapseRepeatedLetters(token);
    const optionMatches = activeCommand
      ? (grammar?.options ?? []).filter((option) =>
        option.keys.some((key) => normalizeToken(key) === token || normalizeToken(key) === collapsed))
      : [];
    const stageMatches = activeStage
      ? optionMatches.filter((option) => option.validStages.includes(activeStage))
      : optionMatches;
    const option = (stageMatches.length > 0 ? stageMatches : optionMatches)[0] ?? null;
    if (option) {
      pendingParameter = option.valueType === "none" ? null : option.parameterName;
      interpretations.push({
        sourceEventIds: action.sourceEventIds ?? [],
        raw: rawText,
        normalized: collapsed,
        classification: "command_option_candidate",
        command: activeCommand,
        stage: activeStage,
        option: option.name,
        parameterName: option.parameterName,
        value: null,
        matchMethod: collapsed !== token ? "repeated_character_normalization" : "exact_option_key",
        confidence: collapsed !== token ? 0.82 : 0.94
      });
      continue;
    }
    if (isNumericToken(token)) {
      interpretations.push({
        sourceEventIds: action.sourceEventIds ?? [],
        raw: rawText,
        normalized: token,
        classification: pendingParameter ? "parameter_value_candidate" : "numeric_value_candidate",
        command: activeCommand,
        stage: activeStage,
        option: null,
        parameterName: pendingParameter,
        value: Number(token),
        matchMethod: pendingParameter ? "preceding_option_state" : "numeric_syntax_only",
        confidence: pendingParameter ? 0.88 : 0.6
      });
      continue;
    }
    const command = resolveCanonicalCommand(token, catalog) ?? resolveCanonicalCommand(collapsed, catalog);
    if (command) {
      activeCommand = command.command;
      grammar = compactCommandGrammar(grammarCatalog?.commands?.[activeCommand]) ?? null;
      activeStage = grammar?.startStage ?? null;
      pendingParameter = null;
    }
    interpretations.push({
      sourceEventIds: action.sourceEventIds ?? [],
      raw: rawText,
      normalized: token,
      classification: command ? "command_candidate" : "unclassified_text",
      command: command?.command ?? activeCommand,
      stage: activeStage,
      option: null,
      parameterName: null,
      value: rawText,
      matchMethod: command ? "command_catalog" : "none",
      confidence: command ? 0.8 : 0.2
    });
  }
  return interpretations;
}

function compactCommandGrammar(grammar) {
  if (!grammar) return null;
  return {
    startStage: grammar.startStage ?? null,
    stages: (grammar.stages ?? []).map((stage) => ({
      id: stage.id,
      expects: stage.expects,
      promptPatterns: stage.promptPatterns ?? []
    })),
    options: (grammar.options ?? []).map((option) => ({
      keys: option.keys ?? [],
      name: option.name,
      parameterName: option.parameterName,
      valueType: option.valueType,
      validStages: option.validStages ?? []
    })),
    completionSignals: grammar.completionSignals ?? []
  };
}

function summarizeEvidence(actions) {
  return {
    actionCount: actions.length,
    typedInputs: actions.filter((action) => action.action === "type_text")
      .map((action) => String(action.text ?? "")),
    enterCount: actions.filter((action) => action.action === "press_key" && action.key === "ENTER").length,
    escapeCount: actions.filter((action) => action.action === "press_key" && action.key === "ESCAPE").length,
    pointerActionCount: actions.filter((action) =>
      ["click", "double_click", "right_click", "middle_click", "drag"].includes(action.action)).length,
    persistentCanvasChangeCount: actions.filter((action) => action.visualChange?.changed === true).length,
    pairedScreenshotCount: actions.filter((action) => action.screenshotBefore && action.screenshotAfter).length,
    committedCadInputCount: actions.filter((action) => action.cadInputEvidence?.exact === true).length
  };
}

function summarizeEntities(catalog) {
  const entities = Array.isArray(catalog) ? catalog : [];
  const bySemanticKind = {};
  for (const entity of entities) {
    const key = entity.semanticKind ?? "unknown";
    bySemanticKind[key] = (bySemanticKind[key] ?? 0) + 1;
  }
  return {
    count: entities.length,
    bySemanticKind,
    entityIds: entities.map((entity) => entity.entityId)
  };
}

function resolveCanonicalCommand(value, catalog) {
  const token = normalizeToken(value);
  if (!token || !catalog) return null;
  if (catalog.commands?.[token]?.includedInCore) return { command: token, alias: false };
  const alias = catalog.aliasIndex?.[token];
  const command = normalizeCommand(alias?.command);
  return command && catalog.commands?.[command]?.includedInCore
    ? { command, alias: true }
    : null;
}

function deduplicateCandidates(candidates) {
  const found = new Map();
  for (const candidate of candidates) {
    if (!candidate.canonicalName) continue;
    const existing = found.get(candidate.canonicalName);
    if (!existing || candidate.confidence > existing.confidence)
      found.set(candidate.canonicalName, candidate);
  }
  return [...found.values()].sort((left, right) =>
    right.confidence - left.confidence || left.canonicalName.localeCompare(right.canonicalName));
}

function normalizeCommand(value) {
  const token = normalizeToken(value);
  return /^-?[A-Z][A-Z0-9_+]*$/.test(token) ? token : null;
}

function normalizeToken(value) {
  return String(value ?? "").trim().toUpperCase().replace(/^_\./, "").replace(/\s+/g, "");
}

function collapseRepeatedLetters(value) {
  return String(value ?? "").replace(/([A-Z])\1+/g, "$1");
}

function isNumericToken(value) {
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(String(value ?? ""));
}

function nullableText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function findLastIndex(values, predicate) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (predicate(values[index])) return index;
  }
  return -1;
}
