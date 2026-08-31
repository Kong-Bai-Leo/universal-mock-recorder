import fs from "node:fs/promises";
import path from "node:path";

const COMMAND_PANEL_FILES = [
  "create/ui-map.json",
  "modify/ui-map.json",
  "hierarchy/ui-map.json",
  "motion/ui-map.json",
  "display/ui-map.json",
  "utilities/ui-map.json"
];

export async function loadThreeDsMaxKnowledge(root) {
  const resolvedRoot = path.resolve(root);
  const [index, liveObservation, menus, toolbar, commandPanelIndex, ...panelMaps] = await Promise.all([
    readJson(path.join(resolvedRoot, "ui-index.json")),
    readJson(path.join(resolvedRoot, "live-observation.json")),
    readJson(path.join(resolvedRoot, "menus", "ui-map.json")),
    readJson(path.join(resolvedRoot, "toolbars", "main-toolbar", "ui-map.json")),
    readJson(path.join(resolvedRoot, "command-panel", "index.json")),
    ...COMMAND_PANEL_FILES.map((file) => readJson(path.join(resolvedRoot, "command-panel", file)))
  ]);
  if (index.application?.name !== "Autodesk 3ds Max")
    throw new Error("UI Map 不是 Autodesk 3ds Max 知识库");
  return {
    root: resolvedRoot,
    metadata: {
      mapId: index.mapId,
      version: index.application?.version ?? null,
      language: index.application?.language ?? null,
      liveObservedAt: liveObservation.observedAt ?? null
    },
    topLevelMenus: liveObservation.observedTopLevelMenus ?? [],
    menus: menus.menus ?? [],
    toolbarControls: toolbar.controls ?? [],
    commandPanelTabs: commandPanelIndex.tabs ?? [],
    commandPanels: Object.fromEntries(panelMaps.map((panel) => [panel.name, panel]))
  };
}

export function retrieveThreeDsMaxKnowledge(knowledge, actions, options = {}) {
  if (!knowledge) return { metadata: null, context: null, matches: [] };
  const maxMenus = options.maxMenus ?? 8;
  const maxMenuItems = options.maxMenuItems ?? 40;
  const maxToolbarControls = options.maxToolbarControls ?? 20;
  const searchable = actions.map(actionSearchText).join(" ").toLowerCase();
  const tokens = new Set(searchable.split(/[^a-z0-9_]+/).filter((token) => token.length >= 2));
  const score = (text) => {
    const lower = String(text ?? "").toLowerCase();
    let total = 0;
    for (const token of tokens) if (lower.includes(token)) total += token.length;
    return total;
  };

  const fallbackMenuNames = new Set(["Create", "Modifiers", "Edit", "Tools"]);
  const rankedMenus = knowledge.menus
    .map((menu) => ({ menu, score: score(`${menu.name} ${(menu.items ?? []).join(" ")}`) }))
    .filter((item) => item.score > 0 || fallbackMenuNames.has(item.menu.name))
    .sort((left, right) => right.score - left.score)
    .slice(0, maxMenus)
    .map(({ menu }) => ({
      name: menu.name,
      items: (menu.items ?? [])
        .map((name) => ({ name, score: score(name) }))
        .sort((left, right) => right.score - left.score)
        .slice(0, Math.max(6, Math.ceil(maxMenuItems / Math.max(1, maxMenus))))
        .map((item) => item.name)
    }));

  const toolbarControls = knowledge.toolbarControls
    .map((control) => ({ control, score: score(`${control.name} ${control.actionId} ${control.automationId}`) }))
    .filter((item) => item.score > 0 || /Select and (Move|Rotate|Uniform Scale)|Select Object|Undo|Redo/i.test(item.control.name))
    .sort((left, right) => right.score - left.score)
    .slice(0, maxToolbarControls)
    .map(({ control }) => control);

  const panelNames = new Set(["Create", "Modify"]);
  for (const tab of knowledge.commandPanelTabs) {
    if (score(tab.name) > 0) panelNames.add(tab.name);
  }
  const commandPanels = [...panelNames]
    .map((name) => knowledge.commandPanels[name])
    .filter(Boolean);

  return {
    metadata: knowledge.metadata,
    matches: [...tokens].slice(0, 40),
    context: {
      topLevelMenus: knowledge.topLevelMenus,
      menus: rankedMenus,
      toolbarControls,
      commandPanels,
      replayPolicy: {
        preferred: "MAXScript",
        absolutePixelReplayAllowed: false,
        parameterPriority: [
          "typed spinner value",
          "visible labeled field",
          "viewport interaction with explicit units",
          "visual inference only for qualitative topology"
        ]
      }
    }
  };
}

function actionSearchText(action) {
  return [
    action.action,
    action.text,
    action.key,
    action.target?.name,
    action.target?.role,
    action.target?.automationId,
    action.target?.className,
    ...(action.target?.ancestors ?? []).flatMap((item) => [
      item.name, item.role, item.automationId, item.className
    ])
  ].filter(Boolean).join(" ");
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}
