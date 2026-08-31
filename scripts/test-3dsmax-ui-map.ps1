$ErrorActionPreference = 'Stop'

$workspaceRoot = Split-Path -Parent $PSScriptRoot
$root = Join-Path $workspaceRoot 'ui-maps\3dsmax\2027\en-US'
$requiredFiles = @(
    'ui-index.json',
    'live-observation.json',
    'menus\ui-map.json',
    'toolbars\main-toolbar\ui-map.json',
    'command-panel\index.json',
    'command-panel\create\ui-map.json',
    'command-panel\modify\ui-map.json',
    'command-panel\hierarchy\ui-map.json',
    'command-panel\motion\ui-map.json',
    'command-panel\display\ui-map.json',
    'command-panel\utilities\ui-map.json'
)

foreach ($relativePath in $requiredFiles) {
    $path = Join-Path $root $relativePath
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Missing 3ds Max UI map file: $relativePath"
    }
    $null = Get-Content -Raw -LiteralPath $path | ConvertFrom-Json
}

$index = Get-Content -Raw -LiteralPath (Join-Path $root 'ui-index.json') | ConvertFrom-Json
if ($index.application.version -ne '2027' -or $index.application.language -ne 'en-US') {
    throw '3ds Max UI map application identity is incorrect.'
}

$menus = Get-Content -Raw -LiteralPath (Join-Path $root 'menus\ui-map.json') | ConvertFrom-Json
if ($menus.menus.Count -lt 17) {
    throw '3ds Max top-level menu coverage is incomplete.'
}
foreach ($coreMenu in @('Create', 'Modifiers', 'Animation', 'Rendering', 'Scripting')) {
    $entry = $menus.menus | Where-Object name -eq $coreMenu | Select-Object -First 1
    if ($null -eq $entry -or $entry.verification -ne 'live_expanded' -or $entry.items.Count -eq 0) {
        throw "Core menu was not live-expanded: $coreMenu"
    }
}

$toolbar = Get-Content -Raw -LiteralPath (Join-Path $root 'toolbars\main-toolbar\ui-map.json') | ConvertFrom-Json
if (($toolbar.controls | Where-Object automationId).Count -lt 20) {
    throw 'Main Toolbar stable ID coverage is unexpectedly low.'
}

$commandPanel = Get-Content -Raw -LiteralPath (Join-Path $root 'command-panel\index.json') | ConvertFrom-Json
if ($commandPanel.tabs.Count -ne 6) {
    throw 'The 3ds Max Command Panel must contain six top-level tabs.'
}

Write-Output "3ds Max UI map validated: $($menus.menus.Count) menus, $($toolbar.controls.Count) toolbar controls, $($commandPanel.tabs.Count) Command Panel tabs."
