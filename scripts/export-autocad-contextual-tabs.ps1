param(
    [string]$SupportDirectory = "$env:APPDATA\Autodesk\AutoCAD 2027\R26.0\enu\Support",

    [string]$OutputRoot = (Join-Path $PSScriptRoot '..\ui-maps\autocad\2027\en-US'),

    [string[]]$SelectedTabs = @()
)

$ErrorActionPreference = 'Stop'

function Convert-ToStablePart {
    param([string]$Value)
    $part = $Value.ToLowerInvariant() -replace '[^a-z0-9]+', '-'
    return $part.Trim('-')
}

$tabIndexPath = Join-Path $OutputRoot 'ribbon\all-tabs-index.json'
if (-not (Test-Path -LiteralPath $tabIndexPath)) {
    throw "Ribbon tab index was not found: $tabIndexPath"
}

$tabIndex = Get-Content -Raw -LiteralPath $tabIndexPath | ConvertFrom-Json -AsHashtable
$profiles = @($tabIndex.tabs | Where-Object {
    $_.classification -eq 'contextual_or_on_demand_tab' -and
    $_.workspaceBehavior -ne 'MergeTabOnly' -and
    $_.id -ne 'ID_CTS-TestBlock'
})
if ($SelectedTabs.Count -gt 0) {
    $profiles = @($profiles | Where-Object {
        $SelectedTabs -contains $_.id -or $SelectedTabs -contains $_.name -or @($_.aliases | Where-Object { $SelectedTabs -contains $_ }).Count -gt 0
    })
}
if ($profiles.Count -eq 0) { throw 'No contextual/on-demand Ribbon tabs matched.' }

$primaryCuix = Join-Path $SupportDirectory 'acad.CUIX'
$additionalCuix = @('ModelDoc.cuix', 'dbcon.cuix', 'custom.cuix') | ForEach-Object {
    $candidate = Join-Path $SupportDirectory $_
    if (Test-Path -LiteralPath $candidate) { $candidate }
}

$results = [System.Collections.ArrayList]::new()
foreach ($profile in $profiles) {
    $slug = "$(Convert-ToStablePart $profile.name)-$(Convert-ToStablePart $profile.id)"
    $tabDirectory = Join-Path $OutputRoot (Join-Path 'contextual-tabs' $slug)
    $mapPath = Join-Path $tabDirectory 'ui-map.json'
    $exportResult = & (Join-Path $PSScriptRoot 'export-autocad-ui-map.ps1') `
        -Cuix $primaryCuix `
        -AdditionalCuix $additionalCuix `
        -TabUid $profile.id `
        -Output $mapPath | ConvertFrom-Json
    $testResult = & (Join-Path $PSScriptRoot 'test-autocad-ui-map.ps1') -Map $mapPath | ConvertFrom-Json
    [void]$results.Add([ordered]@{
        tab = $profile.name
        uid = $profile.id
        aliases = [object[]]@($profile.aliases)
        source = $profile.source
        map = "$slug/ui-map.json"
        panelsIndex = "$slug/panels/index.json"
        nodes = [int]$testResult.nodes
        panels = [int]$testResult.panels
        panelMaps = [int]$exportResult.panelMaps
        actionableControls = [int]$testResult.actionableControls
        splitButtons = [int]$testResult.splitButtons
        iconOnlyControls = [int]$testResult.iconOnlyControls
        verification = [ordered]@{
            extracted = $true
            liveObserved = $false
            contextTriggerTested = $false
            triggerHint = $null
        }
    })
}

$index = [ordered]@{
    schemaVersion = '1.0'
    application = [ordered]@{ name = 'Autodesk AutoCAD'; version = '2027'; language = 'en-US'; platform = 'Windows' }
    scope = [ordered]@{
        included = 'Standalone stock contextual/on-demand Ribbon tabs extracted from acad.CUIX and ModelDoc.cuix'
        excluded = @('MergeTabOnly contributions', 'internal Test Block tab', 'plug-in tabs', 'industry toolset tabs')
    }
    usagePolicy = 'Do not assume a contextual tab is visible. Confirm its triggering object/editor state in the current screenshot before loading its map.'
    totals = [ordered]@{
        tabs = $results.Count
        nodes = ($results | ForEach-Object { $_.nodes } | Measure-Object -Sum).Sum
        panels = ($results | ForEach-Object { $_.panels } | Measure-Object -Sum).Sum
        panelMaps = ($results | ForEach-Object { $_.panelMaps } | Measure-Object -Sum).Sum
        actionableControls = ($results | ForEach-Object { $_.actionableControls } | Measure-Object -Sum).Sum
        liveObserved = @($results | Where-Object { $_.verification.liveObserved }).Count
        contextTriggerTested = @($results | Where-Object { $_.verification.contextTriggerTested }).Count
    }
    tabs = [object[]]@($results | Sort-Object tab, uid)
}

$indexPath = Join-Path $OutputRoot 'contextual-tabs\index.json'
$indexDirectory = Split-Path -Parent $indexPath
if (-not (Test-Path -LiteralPath $indexDirectory)) { New-Item -ItemType Directory -Path $indexDirectory -Force | Out-Null }
$index | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $indexPath -Encoding utf8

[ordered]@{ result = 'generated'; index = [System.IO.Path]::GetFullPath($indexPath); totals = $index.totals } | ConvertTo-Json -Depth 6
