# KiCad 10.0.6 English UI Map

This map combines the official KiCad 10.0 documentation with a live scan of the stock Windows English UI in KiCad 10.0.6. It is deliberately separate from the AutoCAD and 3ds Max maps.

## Coverage

- KiCad Project Manager: project tree, project operations toolbar, application launcher, and core project actions.
- Schematic Editor: core menu hierarchy, top/left/right toolbars, docked panels, canvas, and the basic capture-to-PCB workflow.
- PCB Editor: core menu hierarchy, top/left/right toolbars, docked panels, placement/routing tools, and the basic schematic-to-board workflow.

The UI map contains semantic `locatorId` values for repository lookup. The live evidence is stored in `live-observation.json`. Its `commandId` values are native KiCad/wxWidgets menu command identifiers, not Windows UI Automation IDs. Runtime-only negative control IDs are retained only as diagnostic observations and must not be used for replay. No pixel coordinate or runtime window bound is stored as a durable selector.

## Verification model

`official_documentation` means the official KiCad 10.0 English manual explicitly documents the control, path, region, or behavior. `official_action_reference` means the official action table confirms the action name and any listed hotkey. `live_observed` means the item was inspected in the running 10.0.6 application. `documentation_inferred` remains useful for semantic lookup but is not automatically promoted unless the corresponding live evidence exists.

The installed application was verified in two ways: winget and `kicad-cli version` reported 10.0.6, then the Project Manager, Schematic Editor, and PCB Editor were opened and scanned. The scan used blank unsaved editor documents and made no project changes. English was selected only for the scan; the Manager was restored to the system-default Chinese UI afterward. The portable path stored in the index uses `%LOCALAPPDATA%` instead of a user-specific absolute path.

The current official 10.0 manuals state that they are based on 10.0.5. Live observation is therefore the authority for labels and command IDs captured from 10.0.6, while the manuals remain the authority for behavior and workflow explanations.

## Sources

- [KiCad 10.0.6 release](https://www.kicad.org/blog/2026/08/KiCad-10.0.6-Release/)
- [KiCad Project Manager 10.0 manual](https://docs.kicad.org/10.0/en/kicad/kicad.html)
- [Schematic Editor 10.0 manual](https://docs.kicad.org/10.0/en/eeschema/eeschema.html)
- [PCB Editor 10.0 manual](https://docs.kicad.org/10.0/en/pcbnew/pcbnew.html)

## Validate

From the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\test-kicad-ui-map.ps1
```

The validator parses all required JSON, checks application identity and required coverage, rejects user-profile paths, Automation ID fields, coordinate-like replay data, and actionable entries without provenance and verification.

## Live scan result and remaining backlog

- Verified the English top-level menus and the visible command labels/IDs of the Manager, Schematic Editor, and PCB Editor.
- Verified the Manager launcher labels, the two editor canvas accessibility names, and the visible PCB layer list.
- The wxWidgets accessibility tree did not expose most toolbar glyphs as named buttons. Toolbar recognition must therefore combine visible icon/tooltip evidence, documentation, shortcut, editor state, and surrounding controls.
- First-run Welcome and library-table setup flow remains unscanned.
- Dialog contents for Schematic Setup, Board Setup, ERC, DRC, footprint assignment, update-from-schematic, fabrication output, and chooser dialogs.
- Context-sensitive canvas menus and tool states.
- Plugin and user-customized toolbar surfaces.

Future scans must append separate evidence and may promote individual entries from `needs_live_scan` or `documentation_inferred`; they must not silently relabel documentation-derived data as live-observed.
