param(
    [string]$SupportDirectory = "$env:APPDATA\Autodesk\AutoCAD 2027\R26.0\enu\Support",

    [string]$OutputRoot = (Join-Path $PSScriptRoot '..\ui-maps\autocad\2027\en-US'),

    [switch]$RefreshOfficial
)

$ErrorActionPreference = 'Stop'

$visibleTabsResult = & (Join-Path $PSScriptRoot 'export-autocad-visible-tabs.ps1') `
    -SupportDirectory $SupportDirectory `
    -OutputRoot $OutputRoot | ConvertFrom-Json

$commandOutput = Join-Path $OutputRoot 'commands\command-catalog.json'
$commandArguments = @{
    SupportDirectory = $SupportDirectory
    Output = $commandOutput
    UiMapRoot = $OutputRoot
}
if ($RefreshOfficial) { $commandArguments.RefreshOfficial = $true }
$commandResult = & (Join-Path $PSScriptRoot 'export-autocad-command-catalog.ps1') @commandArguments | ConvertFrom-Json

$structureResult = & (Join-Path $PSScriptRoot 'export-autocad-structure-map.ps1') `
    -SupportDirectory $SupportDirectory `
    -OutputRoot $OutputRoot `
    -CommandCatalog $commandOutput | ConvertFrom-Json

$contextualResult = & (Join-Path $PSScriptRoot 'export-autocad-contextual-tabs.ps1') `
    -SupportDirectory $SupportDirectory `
    -OutputRoot $OutputRoot | ConvertFrom-Json

# Re-link the command catalog after the shell map has been regenerated so QAT
# and Application Menu command buttons receive command -> UI references too.
$commandResult = & (Join-Path $PSScriptRoot 'export-autocad-command-catalog.ps1') @commandArguments | ConvertFrom-Json
$commandTest = & (Join-Path $PSScriptRoot 'test-autocad-command-catalog.ps1') -CatalogPath $commandOutput | ConvertFrom-Json
$structureTest = & (Join-Path $PSScriptRoot 'test-autocad-structure-map.ps1') -Root $OutputRoot | ConvertFrom-Json
$contextualTest = & (Join-Path $PSScriptRoot 'test-autocad-contextual-tabs.ps1') -Root $OutputRoot | ConvertFrom-Json

[ordered]@{
    result = 'pass'
    outputRoot = [System.IO.Path]::GetFullPath($OutputRoot)
    visibleRibbon = $visibleTabsResult.totals
    commands = $commandResult.totals
    structure = [ordered]@{
        workspaces = $structureResult.workspaces
        ribbonTabs = $structureResult.ribbonTabs
        menus = $structureResult.menus
        quickAccessControls = $structureResult.quickAccessControls
        contextualTabs = $contextualResult.totals
    }
    tests = [ordered]@{
        commandCatalog = $commandTest.result
        structure = $structureTest.result
        contextualTabs = $contextualTest.result
    }
} | ConvertTo-Json -Depth 10
