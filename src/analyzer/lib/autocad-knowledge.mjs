import fs from "node:fs/promises";
import path from "node:path";

const QUERY_STOP_WORDS = new Set([
  "AUTOCAD", "AUTODESK", "EDUCATION", "NON", "COMMERCIAL", "DRAWING",
  "CONTROLTYPE", "WINDOW", "PANE", "GROUP", "CUSTOM", "BUTTON", "EDIT",
  "ENTER", "ESCAPE", "BACKSPACE", "DELETE", "TAB", "SHIFT", "CONTROL", "ALT"
]);

export async function loadAutoCadKnowledge(rootDirectory) {
  const root = path.resolve(rootDirectory);
  const uiIndex = await readJson(path.join(root, "ui-index.json"));
  const commandCatalog = await readJson(path.join(root, "commands", "command-catalog.json"));
  const commandGrammar = await readOptionalJson(path.join(root, "commands", "analysis-grammar.json"));
  const controls = [];
  const menus = [];
  const tabs = [];
  const loadWarnings = [];

  for (const tab of asArray(uiIndex.tabs)) {
    await loadTab(root, tab, controls, tabs, loadWarnings, "visible_ribbon");
  }

  const contextualIndex = await readOptionalJson(path.join(root, "contextual-tabs", "index.json"));
  for (const tab of asArray(contextualIndex?.tabs)) {
    await loadTab(root, tab, controls, tabs, loadWarnings, "contextual_or_on_demand");
  }

  const shell = await readOptionalJson(path.join(root, "shell", "ui-map.json"));
  if (shell?.nodes) {
    for (const node of Object.values(shell.nodes)) {
      const compact = compactControl(node, "shell/ui-map.json", {});
      if (compact) controls.push(compact);
    }
  }

  const menuCatalog = await readOptionalJson(path.join(root, "menus", "menu-catalog.json"));
  for (const menu of asArray(menuCatalog?.menus)) {
    for (const item of asArray(menu.items)) {
      if (item.kind !== "command_item") continue;
      menus.push({
        reference: `menus/menu-catalog.json#${menu.id}/${item.id}`,
        menu: cleanDynamicLabel(menu.name),
        menuClassification: menu.classification ?? null,
        id: item.id ?? null,
        name: cleanDynamicLabel(item.name),
        command: item.command ?? null,
        order: item.order ?? null,
        liveObserved: Boolean(menu.verification?.liveObserved)
      });
    }
  }

  return {
    root,
    application: uiIndex.application,
    scope: uiIndex.scope,
    lookupPolicy: uiIndex.lookupPolicy,
    executionPolicy: commandCatalog.executionPolicy,
    commandCatalog,
    commandGrammar,
    controls,
    menus,
    tabs: deduplicateTabs(tabs),
    loadWarnings,
    metadata: {
      uiSchemaVersion: uiIndex.schemaVersion,
      commandSchemaVersion: commandCatalog.schemaVersion,
      commandCatalogGeneratedAt: commandCatalog.generatedAt ?? null,
      commandGrammarVersion: commandGrammar?.version ?? null,
      commandGrammarCommands: Object.keys(commandGrammar?.commands ?? {}).length,
      officialCoreCommands: commandCatalog.totals?.officialCoreCommands ?? 0,
      effectiveAliases: commandCatalog.totals?.effectiveAliases ?? 0,
      indexedControls: controls.length,
      indexedMenuItems: menus.length
    }
  };
}

export function retrieveAutoCadKnowledge(knowledge, actions, options = {}) {
  if (!knowledge || !isAutoCadRecording(actions)) {
    return {
      context: null,
      audit: {
        applicable: false,
        reason: knowledge ? "recording_is_not_autocad" : "knowledge_base_unavailable",
        providedToModel: false
      }
    };
  }

  const query = buildQuery(actions, options.previousCommands ?? []);
  const maxControls = options.maxControls ?? 18;
  const maxCommands = options.maxCommands ?? 14;
  const maxMenus = options.maxMenus ?? 10;
  const fallbackCommandNames = new Set(asArray(options.fallbackCommands)
    .map(normalizeCommandName)
    .filter((name) => knowledge.commandCatalog.commands?.[name]?.includedInCore));
  const initialCommandScores = scoreCommands(knowledge.commandCatalog, query);
  const initialCommandNames = new Set(initialCommandScores
    .filter((item) => item.score > 0)
    .slice(0, maxCommands)
    .map((item) => item.name));
  const candidateCommandNames = new Set([...initialCommandNames, ...fallbackCommandNames]);
  const controlMatches = rankEntries(knowledge.controls, query, maxControls, candidateCommandNames);
  const menuMatches = rankEntries(knowledge.menus, query, maxMenus, candidateCommandNames);

  const linkedCommands = new Set(candidateCommandNames);
  const directlyLinkedCommands = new Set();
  for (const match of [...controlMatches, ...menuMatches]) {
    if (!match.entry.command) continue;
    const command = normalizeCommandName(match.entry.command);
    if (!command) continue;
    linkedCommands.add(command);
    directlyLinkedCommands.add(command);
  }
  addRelatedCommandNames(linkedCommands, knowledge.commandCatalog);

  const commandMatches = scoreCommands(knowledge.commandCatalog, query)
    .filter((match) => match.score > 0 || linkedCommands.has(match.name))
    .sort((left, right) => {
      const leftDirect = directlyLinkedCommands.has(left.name) ? 1 : 0;
      const rightDirect = directlyLinkedCommands.has(right.name) ? 1 : 0;
      const leftLinked = linkedCommands.has(left.name) ? 1 : 0;
      const rightLinked = linkedCommands.has(right.name) ? 1 : 0;
      const leftEvidenceLinked = initialCommandNames.has(left.name) ? 1 : 0;
      const rightEvidenceLinked = initialCommandNames.has(right.name) ? 1 : 0;
      const leftFallback = fallbackCommandNames.has(left.name) ? 1 : 0;
      const rightFallback = fallbackCommandNames.has(right.name) ? 1 : 0;
      return right.exactEvidenceRank - left.exactEvidenceRank ||
        rightDirect - leftDirect || rightEvidenceLinked - leftEvidenceLinked ||
        right.score - left.score || rightFallback - leftFallback ||
        rightLinked - leftLinked || left.name.localeCompare(right.name);
    })
    .slice(0, maxCommands)
    .map(({ name, score, command }) => compactCommand(name, command, score));

  const context = {
    format: "AutoCADKnowledgeContext",
    version: "0.1",
    application: knowledge.application,
    scope: knowledge.scope,
    retrieval: {
      evidenceTerms: query.displayTerms,
      controlsReturned: controlMatches.length,
      menuItemsReturned: menuMatches.length,
      commandsReturned: commandMatches.length,
      fallbackCandidateCommands: [...fallbackCommandNames],
      rankingScoresAreRetrievalOnly: true
    },
    groundingRules: [
      "Use current screenshots and recorded events as truth for current state; this knowledge describes possible stock AutoCAD UI and commands.",
      "Resolve controls by tab, panel, stable ID, visible name, icon and sibling context; never reuse stored pixel coordinates.",
      "PGP aliases are recognition-only. cadProgram.operation.command must use the canonicalName; executors choose scriptCommand.",
      "The knowledge base does not prove drawing coordinates, sizes, selections or object-snap results. Those require recording evidence.",
      "fallbackCandidateCommands are generic retrieval aids for visual-only recordings, not evidence that any command was actually used.",
      "With default Dynamic Input Polar/Relative pointer settings, a second or subsequent point is relative to the previous specified point. When the active command prompt and screenshot clearly show distance and angle, use cursor direction to resolve the displayed acute angle's quadrant."
    ],
    behaviorReferences: [
      "https://help.autodesk.com/cloudhelp/2027/ENG/AutoCAD-Core/files/GUID-30ECFD30-A1D6-4D60-9DD1-B487603F6772.htm",
      "https://help.autodesk.com/cloudhelp/2023/ENU/AutoCAD-DidYouKnow/files/GUID-683349C0-E5C2-4E16-8846-5523E71172A9.htm"
    ],
    navigation: {
      tabs: knowledge.tabs.map((tab) => ({
        name: tab.name,
        uid: tab.uid,
        type: tab.type,
        workspaces: tab.workspaces,
        panels: tab.panels
      }))
    },
    controls: controlMatches.map(({ entry, score }) => ({ ...entry, retrievalScore: score })),
    menuItems: menuMatches.map(({ entry, score }) => ({ ...entry, retrievalScore: score })),
    commands: commandMatches,
    executionPolicy: knowledge.executionPolicy
  };

  return {
    context,
    audit: {
      applicable: true,
      providedToModel: true,
      knowledgeVersion: {
        uiSchemaVersion: knowledge.metadata.uiSchemaVersion,
        commandSchemaVersion: knowledge.metadata.commandSchemaVersion,
        commandCatalogGeneratedAt: knowledge.metadata.commandCatalogGeneratedAt
      },
      evidenceTerms: query.displayTerms,
      fallbackCandidateCommands: [...fallbackCommandNames],
      controlReferences: context.controls.map((item) => item.reference),
      menuReferences: context.menuItems.map((item) => item.reference),
      commands: context.commands.map((item) => ({
        canonicalName: item.canonicalName,
        scriptCommand: item.scriptCommand
      })),
      payloadBytes: Buffer.byteLength(JSON.stringify(context), "utf8"),
      loadWarnings: knowledge.loadWarnings
    }
  };
}

export function validateAutoCadProgramWithKnowledge(plan, knowledge) {
  const program = plan?.cadProgram;
  if (!program || program.format !== "autocad_command_ir" || !Array.isArray(program.operations)) {
    return { valid: true, checkedCommands: [], skipped: "no_complete_autocad_program" };
  }

  const checkedCommands = [];
  for (const operation of program.operations) {
    const requestedName = normalizeCommandName(operation.command);
    const alias = requestedName ? knowledge?.commandCatalog?.aliasIndex?.[requestedName] : null;
    if (alias && !knowledge?.commandCatalog?.commands?.[requestedName]?.includedInCore) {
      throw new Error(
        `AutoCAD 知识库校验失败：${operation.command} 是仅供识别的 PGP 缩写；请使用 ${alias.command}`
      );
    }
    const requested = knowledge?.commandCatalog?.commands?.[requestedName];
    const name = requested?.scriptCommandCanonicalName ?? requestedName;
    const command = knowledge?.commandCatalog?.commands?.[name] ?? requested;
    if (!command?.includedInCore) {
      throw new Error(`AutoCAD 知识库校验失败：CAD 操作使用了未收录的核心命令 ${operation.command}`);
    }
    checkedCommands.push({
      canonicalName: requestedName,
      scriptCommand: command.scriptCommand,
      documentation: command.documentation?.url ?? null
    });
  }
  return { valid: true, checkedCommands, skipped: null };
}

export function isAutoCadRecording(actions) {
  return asArray(actions).some((action) => {
    const processName = String(action?.window?.processName ?? "");
    const title = String(action?.window?.title ?? "");
    return /^acad(?:\.exe)?$/i.test(processName) || /\bAutoCAD\b/i.test(title);
  });
}

export function reconcileAutoCadCommandContexts(actions, knowledge) {
  if (!Array.isArray(actions) || !knowledge?.commandCatalog) return actions;
  const commands = knowledge.commandCatalog.commands ?? {};
  const aliases = knowledge.commandCatalog.aliasIndex ?? {};
  let activeCommand = null;
  let offsetDistanceExpected = false;

  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index];
    delete action.visualComparisonContext;
    const key = String(action.key ?? "").toUpperCase();
    if (key === "ESCAPE") {
      activeCommand = null;
      offsetDistanceExpected = false;
      action.resolvedCadCommandContext = null;
      continue;
    }

    const targetCommand = resolveTargetCommand(action, commands, aliases);
    if (targetCommand) {
      activeCommand = targetCommand;
      offsetDistanceExpected = targetCommand === "OFFSET";
    }

    const isEnter = action.action === "press_key" && key === "ENTER";
    if (isEnter && !activeCommand) {
      const previousText = actions[index - 1]?.action === "type_text"
        ? actions[index - 1].text
        : action.target?.name;
      const typedCommand = resolveCommandToken(previousText, commands, aliases);
      const recorderCommand = normalizeCommandName(action.visualCommandContext);
      activeCommand = typedCommand ?? (commands[recorderCommand]?.includedInCore ? recorderCommand : null);
      offsetDistanceExpected = activeCommand === "OFFSET";
    }

    action.resolvedCadCommandContext = activeCommand;
    const evidence = isEnter ? action.cadInputEvidence : null;
    if (!evidence || !activeCommand) continue;

    let parameterName = "committed_value";
    if (activeCommand === "OFFSET" && offsetDistanceExpected) parameterName = "distance";
    else if (activeCommand === "LINE") parameterName = "distance";
    else if (activeCommand === "CIRCLE") parameterName = "radius";
    else if (activeCommand === "ROTATE") parameterName = "rotation_angle";

    const corrected = {
      ...evidence,
      command: activeCommand,
      parameterName,
      valueExact: true,
      parameterRoleExact: parameterName !== "committed_value",
      commandContextReliable: true
    };
    action.cadInputEvidence = corrected;
    if (actions[index - 1]?.action === "type_text")
      actions[index - 1].cadInputEvidence = corrected;

    if (activeCommand === "OFFSET" && offsetDistanceExpected) offsetDistanceExpected = false;
    if (["CIRCLE", "ROTATE"].includes(activeCommand)) {
      activeCommand = null;
      offsetDistanceExpected = false;
    }
  }
  return actions;
}

function resolveTargetCommand(action, commands, aliases) {
  if (!["click", "double_click"].includes(action?.action)) return null;
  const targetArea = Number(action.target?.width) * Number(action.target?.height);
  const windowArea = Number(action.window?.width) * Number(action.window?.height);
  if (Number.isFinite(targetArea) && Number.isFinite(windowArea) && windowArea > 0 &&
    targetArea / windowArea > 0.2) return null;
  const values = [
    action.target?.name,
    action.target?.automationId,
    ...(action.target?.ancestors ?? []).flatMap((ancestor) => [ancestor.name, ancestor.automationId])
  ].filter(Boolean);
  const searchable = values.join(" ");
  if (!/ID_Panel|RibbonItemControl|FlyoutButton|CMDBTN|ID_(?!Tab)/i.test(searchable)) return null;
  for (const value of values) {
    const exact = resolveCommandToken(value, commands, aliases);
    if (exact) return exact;
    const tokens = String(value).toUpperCase().split(/[^A-Z0-9+]+/).filter(Boolean);
    for (const token of tokens) {
      const command = resolveCommandToken(token, commands, aliases);
      if (command) return command;
    }
  }
  return null;
}

function resolveCommandToken(value, commands, aliases) {
  const token = normalizeCommandName(value);
  if (!token) return null;
  if (commands[token]?.includedInCore) return token;
  const alias = aliases[token]?.command;
  return commands[alias]?.includedInCore ? alias : null;
}

async function loadTab(root, descriptor, controls, tabs, warnings, type) {
  if (!descriptor?.panelsIndex) return;
  const panelIndexPath = path.join(root, descriptor.panelsIndex);
  let panelIndex;
  try {
    panelIndex = await readJson(panelIndexPath);
  } catch (error) {
    warnings.push(`Unable to load ${toPosix(descriptor.panelsIndex)}: ${error.message}`);
    return;
  }

  const panels = asArray(panelIndex.panels).map((panel) => panel.name).filter(Boolean);
  tabs.push({
    name: descriptor.tab,
    uid: descriptor.uid,
    type,
    workspaces: asArray(descriptor.workspaces),
    panels
  });

  for (const panel of asArray(panelIndex.panels)) {
    const mapRelative = toPosix(path.join(path.dirname(descriptor.panelsIndex), panel.map));
    try {
      const panelMap = await readJson(path.join(root, mapRelative));
      for (const node of Object.values(panelMap.nodes ?? {})) {
        const compact = compactControl(node, mapRelative, {
          tab: panelMap.scope?.tabName ?? descriptor.tab,
          tabUid: panelMap.scope?.tabUid ?? descriptor.uid,
          panel: panelMap.scope?.panelName ?? panel.name,
          panelUid: panelMap.scope?.panelUid ?? panel.uid,
          workspace: panelMap.application?.workspace ?? null,
          contextual: type === "contextual_or_on_demand"
        });
        if (compact) controls.push(compact);
      }
    } catch (error) {
      warnings.push(`Unable to load ${mapRelative}: ${error.message}`);
    }
  }
}

function compactControl(node, source, location) {
  const names = uniqueStrings([
    node?.name,
    node?.ui?.text,
    node?.ui?.officialName,
    node?.names?.visible,
    node?.names?.official,
    ...asArray(node?.names?.aliases)
  ].map(cleanDynamicLabel));
  const command = normalizeCommandName(
    node?.action?.cliCommand ?? node?.action?.command ?? node?.action?.scriptCommand
  );
  const isUsefulContainer = ["tab", "panel", "application_menu", "quick_access_toolbar", "status_bar"]
    .includes(node?.kind);
  if (names.length === 0 && !command) return null;
  if (!node?.action && !isUsefulContainer && !/button|menu|control|toggle|split|input/i.test(String(node?.kind)))
    return null;

  return {
    reference: `${toPosix(source)}#${node.id}`,
    id: node.id,
    kind: node.kind ?? null,
    name: names[0] ?? null,
    names,
    location: {
      tab: cleanDynamicLabel(location.tab),
      tabUid: location.tabUid ?? null,
      panel: cleanDynamicLabel(location.panel),
      panelUid: location.panelUid ?? null,
      workspace: cleanDynamicLabel(location.workspace),
      region: node?.placement?.region ?? null,
      order: node?.placement?.order ?? null,
      contextual: Boolean(location.contextual)
    },
    command,
    actionType: node?.action?.type ?? null,
    description: truncate(node?.semantics?.description, 240),
    icon: node?.icon ? {
      iconOnly: Boolean(node.icon.iconOnly),
      smallResource: node.icon.smallResource ?? null,
      largeResource: node.icon.largeResource ?? null
    } : null,
    verification: node?.verification ? {
      liveObserved: Boolean(node.verification.liveObserved),
      interactionTested: Boolean(node.verification.interactionTested),
      confidence: node.verification.confidence ?? null
    } : null
  };
}

function scoreCommands(catalog, query) {
  const results = [];
  for (const [name, command] of Object.entries(catalog.commands ?? {})) {
    if (!command?.includedInCore) continue;
    const aliases = asArray(command.aliases).map((alias) => alias?.value).filter(Boolean);
    const synonyms = asArray(command.recognitionSynonyms).map((item) => item?.value ?? item).filter(Boolean);
    let score = scoreTextFields([name, command.description, ...aliases, ...synonyms], query);
    let exactEvidenceRank = query.typedCommands.has(name)
      ? 4
      : query.commandLikePhrases.has(name) ? 2 : 0;
    if (query.typedExact.has(normalizeText(name))) score += 180;
    if (query.typedCommands.has(name)) score += 220;
    for (const alias of aliases) {
      if (query.typedExact.has(normalizeText(alias))) score += 170;
      if (query.typedCommands.has(normalizeCommandName(alias))) score += 220;
      if (query.typedCommands.has(normalizeCommandName(alias))) exactEvidenceRank = Math.max(exactEvidenceRank, 4);
      if (normalizeText(alias).length >= 2 &&
        query.commandLikePhrases.has(normalizeCommandName(alias))) {
        exactEvidenceRank = Math.max(exactEvidenceRank, 3);
      }
    }
    if (query.previousCommands.has(name)) score += 120;
    results.push({ name, command, score, exactEvidenceRank });
  }
  return results.sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));
}

function rankEntries(entries, query, maximum, linkedCommands) {
  const ranked = entries
    .map((entry) => {
      const fields = [
        entry.name,
        ...asArray(entry.names),
        entry.menu,
        entry.command,
        entry.description,
        entry.location?.tab,
        entry.location?.panel
      ];
      let score = scoreTextFields(fields, query);
      if (entry.command && linkedCommands.has(normalizeCommandName(entry.command))) score += 90;
      if (entry.verification?.liveObserved || entry.liveObserved) score += score > 0 ? 2 : 0;
      return { entry, score };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score ||
      String(left.entry.reference).localeCompare(String(right.entry.reference)));
  const unique = [];
  const seen = new Set();
  for (const item of ranked) {
    const entry = item.entry;
    const identity = entry.menu
      ? [entry.menu, entry.name, entry.command].join("|")
      : [
        entry.kind, entry.name, entry.command, entry.location?.tab,
        entry.location?.panel, entry.location?.workspace
      ].join("|");
    if (seen.has(identity)) continue;
    seen.add(identity);
    unique.push(item);
    if (unique.length >= maximum) break;
  }
  return unique;
}

function scoreTextFields(fields, query) {
  let score = 0;
  for (const field of uniqueStrings(fields)) {
    const normalized = normalizeText(field);
    if (!normalized) continue;
    if (query.phrases.has(normalized)) score += 80;
    for (const phrase of query.phrases) {
      if (phrase.length >= 3 && normalized.length >= 3 &&
        (normalized.includes(phrase) || phrase.includes(normalized))) score += 25;
    }
    const fieldTokens = tokenize(normalized);
    for (const token of fieldTokens) {
      if (query.tokens.has(token)) score += 8;
    }
  }
  return score;
}

function buildQuery(actions, previousCommandsInput) {
  const phrases = new Set();
  const typedExact = new Set();
  const typedCommands = new Set();
  const commandLikePhrases = new Set();
  const displayTerms = [];
  const add = (value, typed = false) => {
    if (isLowValueQueryValue(value)) return;
    const normalized = normalizeText(value);
    if (!normalized) return;
    phrases.add(normalized);
    const commandLike = normalizeCommandName(value);
    if (commandLike) commandLikePhrases.add(commandLike);
    if (typed) {
      typedExact.add(normalized);
      const command = normalizeCommandName(value);
      if (command) typedCommands.add(command);
    }
    if (!displayTerms.includes(String(value).trim())) displayTerms.push(String(value).trim());
  };

  for (const action of asArray(actions)) {
    add(action?.target?.name);
    add(action?.target?.automationId);
    // Recorder 的命令上下文和本地已解析的提交证据比短别名、空白按钮名更可靠，
    // 必须参与检索，尤其是跨分段时当前 chunk 可能只剩命令后续提示。
    add(action?.visualCommandContext);
    add(action?.visualComparisonContext);
    add(action?.cadCommandContext);
    add(action?.resolvedCadCommandContext);
    add(action?.cadInputEvidence?.command);
    for (const candidate of asArray(action?.target?.textCandidates)) add(candidate);
    for (const ancestor of asArray(action?.target?.ancestors)) {
      add(ancestor?.name);
      add(ancestor?.automationId);
    }
    if (action?.action === "type_text") add(action.text, true);
  }

  const previousCommands = new Set();
  for (const command of asArray(previousCommandsInput)) {
    const normalized = normalizeCommandName(command);
    if (normalized) previousCommands.add(normalized);
  }
  const tokens = new Set([...phrases].flatMap(tokenize));
  return {
    phrases,
    typedExact,
    typedCommands,
    commandLikePhrases,
    tokens,
    previousCommands,
    displayTerms: displayTerms.slice(0, 40)
  };
}

function compactCommand(name, command, score) {
  return {
    reference: `commands/command-catalog.json#commands.${name}`,
    canonicalName: name,
    globalCommand: command.globalCommand,
    scriptCommand: command.scriptCommand,
    scriptCommandCanonicalName: command.scriptCommandCanonicalName ?? name,
    aliasesForRecognitionOnly: asArray(command.aliases).map((alias) => alias?.value).filter(Boolean),
    recognitionSynonyms: asArray(command.recognitionSynonyms)
      .map((item) => item?.value ?? item).filter(Boolean),
    description: truncate(command.description, 320),
    related: command.related,
    documentation: command.documentation?.url ?? null,
    retrievalScore: score
  };
}

function addRelatedCommandNames(names, catalog) {
  for (const name of [...names]) {
    const command = catalog.commands?.[name];
    if (command?.related?.dialogCommand) names.add(command.related.dialogCommand);
    if (command?.related?.commandLineVariant) names.add(command.related.commandLineVariant);
    if (command?.scriptCommandCanonicalName) names.add(command.scriptCommandCanonicalName);
  }
}

function deduplicateTabs(tabs) {
  const found = new Map();
  for (const tab of tabs) {
    const key = `${tab.uid ?? tab.name}|${tab.type}`;
    if (!found.has(key)) found.set(key, tab);
  }
  return [...found.values()];
}

function normalizeCommandName(value) {
  if (!value) return null;
  const normalized = String(value).trim().toUpperCase().replace(/^_\./, "");
  return /^-?[A-Z][A-Z0-9_+]*$/.test(normalized) ? normalized : null;
}

function normalizeText(value) {
  if (value === null || value === undefined) return "";
  const cleaned = cleanDynamicLabel(String(value));
  if (!cleaned) return "";
  return cleaned
    .toUpperCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^A-Z0-9+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isLowValueQueryValue(value) {
  if (value === null || value === undefined) return true;
  const text = String(value).trim();
  return !text || /^\d+$/.test(text) || /\.(?:dwg|dxf)$/i.test(text) ||
    /\bAutodesk AutoCAD\b/i.test(text);
}

function tokenize(value) {
  return normalizeText(value).split(" ")
    .filter((token) => token.length >= 2 && !QUERY_STOP_WORDS.has(token) && !/^\d+(?:\.\d+)?$/.test(token));
}

function cleanDynamicLabel(value) {
  if (value === null || value === undefined) return null;
  return String(value)
    .replace(/\$\([^)]*\)/g, "")
    .replace(/&/g, "")
    .replace(/^~+/, "")
    .trim() || null;
}

function uniqueStrings(values) {
  return [...new Set(asArray(values).filter((value) => typeof value === "string" && value.trim()))];
}

function truncate(value, maximum) {
  if (typeof value !== "string") return null;
  return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;
}

function asArray(value) {
  return Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
}

function toPosix(value) {
  return String(value).replaceAll("\\", "/");
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function readOptionalJson(filePath) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}
