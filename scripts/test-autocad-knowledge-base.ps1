param(
    [string]$Root = (Join-Path $PSScriptRoot '..\ui-maps\autocad\2027\en-US')
)

$ErrorActionPreference = 'Stop'

$commandResult = & (Join-Path $PSScriptRoot 'test-autocad-command-catalog.ps1') `
    -CatalogPath (Join-Path $Root 'commands\command-catalog.json') | ConvertFrom-Json
$structureResult = & (Join-Path $PSScriptRoot 'test-autocad-structure-map.ps1') `
    -Root $Root | ConvertFrom-Json
$contextualResult = & (Join-Path $PSScriptRoot 'test-autocad-contextual-tabs.ps1') `
    -Root $Root | ConvertFrom-Json

[ordered]@{
    result = 'pass'
    commandCatalog = $commandResult
    structure = $structureResult
    contextualTabs = $contextualResult
} | ConvertTo-Json -Depth 8
