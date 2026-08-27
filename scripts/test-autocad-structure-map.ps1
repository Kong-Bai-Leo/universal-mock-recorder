param(
    [Parameter(Mandatory = $true)]
    [string]$Root
)

$ErrorActionPreference = 'Stop'

function Assert-Structure {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

$resolvedRoot = (Resolve-Path -LiteralPath $Root).Path
$shellPath = Join-Path $resolvedRoot 'shell\ui-map.json'
$workspacePath = Join-Path $resolvedRoot 'workspaces\index.json'
$tabPath = Join-Path $resolvedRoot 'ribbon\all-tabs-index.json'
$menuPath = Join-Path $resolvedRoot 'menus\menu-catalog.json'
foreach ($path in @($shellPath, $workspacePath, $tabPath, $menuPath)) {
    Assert-Structure (Test-Path -LiteralPath $path) "Generated structure file is missing: $path"
}

$shell = Get-Content -Raw -LiteralPath $shellPath | ConvertFrom-Json -AsHashtable
$workspaces = Get-Content -Raw -LiteralPath $workspacePath | ConvertFrom-Json -AsHashtable
$tabs = Get-Content -Raw -LiteralPath $tabPath | ConvertFrom-Json -AsHashtable
$menus = Get-Content -Raw -LiteralPath $menuPath | ConvertFrom-Json -AsHashtable

Assert-Structure ($shell.mapType -eq 'application_shell') 'Unexpected shell map type.'
Assert-Structure ($shell.nodes.Contains('autocad.window.quick-access-toolbar')) 'Quick Access Toolbar is missing.'
Assert-Structure ($shell.nodes['autocad.window.quick-access-toolbar'].children.Count -eq 7) 'Expected seven default Quick Access controls.'
Assert-Structure ($shell.nodes['autocad.window.quick-access-toolbar.acqatnew'].action.command -eq 'QNEW') 'QAT New must invoke QNEW.'
Assert-Structure ($shell.nodes['autocad.window.quick-access-toolbar.acqatsave'].action.command -eq 'QSAVE') 'QAT Save must invoke QSAVE.'
Assert-Structure ($shell.nodes['autocad.window.application-menu'].verification.liveObserved) 'Application Menu live evidence is missing.'
Assert-Structure ($shell.nodes['autocad.window.application-menu'].children.Count -eq 15) 'Unexpected Application Menu control count.'
Assert-Structure ($shell.nodes['autocad.window.application-menu.save'].action.command -eq 'QSAVE') 'Application Menu Save must invoke QSAVE.'
Assert-Structure ($shell.nodes['autocad.window.status-bar'].verification.liveObserved) 'Status Bar live evidence is missing.'
Assert-Structure ($shell.nodes['autocad.window.status-bar'].children.Count -eq 30) 'Expected 29 status controls plus the customization trigger.'
Assert-Structure ($shell.nodes['autocad.window.status-bar.workspace-switching'].enabledInObservedWorkspace) 'Workspace Switching should be enabled in the observed workspace.'

Assert-Structure ($workspaces.workspaces.Count -eq 3) 'Expected three stock AutoCAD workspaces.'
$workspaceNames = @($workspaces.workspaces | ForEach-Object { $_.name })
foreach ($name in @('Drafting & Annotation', '3D Basics', '3D Modeling')) {
    Assert-Structure ($workspaceNames -contains $name) "Workspace is missing: $name"
}

Assert-Structure ([int]$tabs.totals.workspaceTabs -gt 0) 'No workspace Ribbon tabs were extracted.'
Assert-Structure ([int]$tabs.totals.contextualOrOnDemand -gt 0) 'No contextual/on-demand Ribbon tabs were identified.'
Assert-Structure ([int]$menus.totals.contextMenus -gt 0) 'No context menus were extracted.'
Assert-Structure ([int]$menus.totals.commandItems -gt 500) 'Too few popup-menu command items were extracted.'

$allRaw = (Get-Content -Raw -LiteralPath $shellPath) + (Get-Content -Raw -LiteralPath $workspacePath) + (Get-Content -Raw -LiteralPath $tabPath) + (Get-Content -Raw -LiteralPath $menuPath)
Assert-Structure ($allRaw -notmatch 'C:\\Users\\') 'Generated structure data contains an absolute user profile path.'

[ordered]@{
    result = 'pass'
    root = $resolvedRoot
    workspaces = $workspaces.workspaces.Count
    ribbonTabs = [int]$tabs.totals.tabs
    workspaceTabs = [int]$tabs.totals.workspaceTabs
    contextualOrOnDemandTabs = [int]$tabs.totals.contextualOrOnDemand
    menus = [int]$menus.totals.menus
    contextMenus = [int]$menus.totals.contextMenus
    quickAccessControls = $shell.nodes['autocad.window.quick-access-toolbar'].children.Count
} | ConvertTo-Json -Depth 4
