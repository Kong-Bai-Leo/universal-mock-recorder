# Autodesk 3ds Max 2027 English UI Map

This map is intentionally separate from the AutoCAD UI map. It describes the English 3ds Max 2027 main window, core menus, Main Toolbar, and six Command Panel tabs observed in a live blank scene.

The map stores semantic ownership, labels, action IDs, and stable UI Automation IDs where 3ds Max exposes them. It does not store fixed replay coordinates. The recorder should combine this knowledge with the active window, current screenshot, object selection, viewport state, and event timing.

Coverage in this first pass is strongest for the Main Toolbar, core top-level menus, the Create panel, and the static structure of all Command Panel tabs. Plugin menus and object-dependent modifier rollouts are registered but require later contextual scans.

Replay should target MAXScript first, Python second, and computer-use only when the operation cannot be represented safely as a scene script.
