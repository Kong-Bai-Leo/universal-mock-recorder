# AutoCAD 2027 UI and command knowledge base

This directory is the semantic UI and command map used by a vision/computer-use agent to locate and understand stock AutoCAD controls without relying on AutoCAD application APIs.

## Start here

- `ui-index.json` lists the 18 mapped core Ribbon tabs visible across Drafting & Annotation, 3D Basics, and 3D Modeling.
- `commands/command-catalog.json` contains the Autodesk Help command inventory, active `acad.pgp` aliases, recognition synonyms, script-safe full command forms, CUIX references, and UI-node links.
- `shell/ui-map.json` maps the application shell, Application Menu, Quick Access Toolbar, drawing area, command line, and status bar.
- `workspaces/index.json` describes the three stock workspaces and their tabs, panels, palettes, classic menus, and visibility state.
- `ribbon/all-tabs-index.json` lists every core CUIX tab definition and separates workspace tabs from contextual/on-demand candidates.
- `contextual-tabs/index.json` points to standalone stock contextual/on-demand tab maps. These are structurally extracted but remain trigger-unverified until a live interaction pass marks them otherwise.
- `menus/menu-catalog.json` contains classic menus, submenus, and right-click context menus extracted from the stock CUIX files.
- Each tab directory contains a lightweight `ui-map.json` manifest, live observation evidence, and a physical `panels/` directory. Panel controls are not duplicated in the tab manifest.
- Each Ribbon panel has its own directory and focused map. For example, Home contains `panels/draw/ui-map.json`, `panels/modify/ui-map.json`, and the other Home panels.
- Tab and panel maps keep only a lightweight `validation.evidence` reference. Detailed viewport data, observed control IDs, and interaction samples live only in the tab's `live-observation.json`.
- The hierarchy is `application -> window -> ribbon -> tab -> panel -> layout -> control`.
- A split button continues as `split_button -> primary_button + menu_trigger -> popup_menu -> menu_item`.

## How an agent should use the map

1. Read `shell/ui-map.json` to identify the current surface and `workspaces/index.json` to identify the active workspace.
2. Inspect the current screenshot and determine the active Ribbon tab. Read that tab's `ui-map.json` manifest or `panels/index.json`, then load only the matching panel's map.
3. Resolve the target using `name`, stable IDs under `source`/`ui`, panel ancestry, `placement.region`, sibling order, and icon resources.
4. Re-detect the control on the current screenshot. Do not replay stored pixel coordinates because window size, DPI, Ribbon collapse state, and workspace can change.
5. Read `semantics.description` and `action` before clicking.
6. For a `split_button`, choose deliberately between:
   - `primaryActionNodeId`: execute the current/default action;
   - `menuTriggerNodeId`: open the popup without executing the primary action.
7. If the requested variant is in a popup, follow `menuTriggerNodeId -> opensNodeId -> children` and select the matching menu item.
8. When producing an SCR file, resolve the canonical command in `commands/command-catalog.json` and use `scriptCommand` such as `_.LINE` or `_.-LAYER`. Never emit a PGP alias such as `L`, `C`, or `-LA` into an SCR file.

## Important fields

- `id`: stable semantic path within this knowledge base.
- `parentId` / `children`: exact ownership and hierarchy.
- `ownerSplitButtonId`: identifies which split button owns a split part or menu item.
- `names.visible`: label rendered by AutoCAD, when present.
- `names.official`: Autodesk macro name.
- `icon.smallResource` / `icon.largeResource`: installed Autodesk image resource identifiers, including icon-only buttons.
- `action.cliCommand` / `action.macro`: command semantics for reasoning; these are descriptive and do not require direct AutoCAD API access.
- `semantics.description`: official CUIX help text when available, otherwise a deterministic structural fallback.
- `placement.region`: `main`, `slideout`, or `transient`.
- `verification`: whether a control was observed in the live accessibility tree or interaction-tested.

## Scope and dynamic content

- Pixel bounds for popups and galleries are intentionally not hard-coded.
- The default scope is core stock AutoCAD. Express Tools, Add-ins, Featured Apps/App Store, industry toolsets, object enablers, and third-party plug-ins are excluded from the main index.
- Older extracted plug-in maps can remain on disk as optional evidence, but the main `ui-index.json` does not load them.
- Application Menu and status-bar items have a live observation file. Their nested runtime submenus still require a deeper interaction pass.
- Contextual/on-demand tabs are indexed from CUIX. A tab is not considered trigger-verified until its `verification.contextTriggerTested` field is true.
- Custom workspaces and user CUI customizations require regeneration and a new live observation pass.

## Verification tiers

- `extracted`: present in an installed Autodesk CUIX/PGP resource.
- `liveObserved`: visibly confirmed in the running AutoCAD 2027 interface.
- `interactionTested`: its trigger or behavior was exercised without changing the drawing unexpectedly.
- `official_help_index`: command name and description were found in Autodesk's official AutoCAD 2027 command index.

## Regenerate and verify

Run `scripts/build-autocad-knowledge-base.ps1`. Add `-RefreshOfficial` when the Autodesk Help command cache should be refreshed. The script rebuilds the stock workspace Ribbon maps, command catalog, shell/workspace/menu indexes, command links, and structural tests.
