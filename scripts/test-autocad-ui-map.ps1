param(
    [Parameter(Mandatory = $true)]
    [string]$Map,

    [string]$Evidence
)

$ErrorActionPreference = 'Stop'

function Assert-UiMap {
    param(
        [bool]$Condition,
        [string]$Message
    )

    if (-not $Condition) { throw $Message }
}

function Get-MenuItems {
    param(
        [System.Collections.IDictionary]$UiMap,
        [System.Collections.IDictionary]$Split
    )

    $trigger = $UiMap.nodes[$Split.menuTriggerNodeId]
    $menu = $UiMap.nodes[$trigger.opensNodeId]
    return @($menu.children | ForEach-Object { $UiMap.nodes[$_] } | Where-Object { $_.kind -eq 'command_button' })
}

$resolvedMap = (Resolve-Path -LiteralPath $Map).Path
$uiMap = Get-Content -Raw -LiteralPath $resolvedMap | ConvertFrom-Json -AsHashtable

Assert-UiMap ($uiMap.schemaVersion -eq '1.0') 'Unexpected schema version.'
Assert-UiMap ($uiMap.nodes.Contains($uiMap.rootNodeId)) 'The root node does not exist.'

if (-not [string]::IsNullOrWhiteSpace($uiMap.scope.panelUid)) {
    Assert-UiMap (-not [string]::IsNullOrWhiteSpace($uiMap.focusNodeId)) 'A panel map must declare focusNodeId.'
    Assert-UiMap ($uiMap.nodes.Contains($uiMap.focusNodeId)) 'The focused panel node does not exist.'
    Assert-UiMap ($uiMap.nodes[$uiMap.focusNodeId].kind -eq 'panel') 'focusNodeId must reference a panel node.'
    Assert-UiMap ($uiMap.nodes[$uiMap.focusNodeId].source.uid -eq $uiMap.scope.panelUid) 'The focused panel does not match scope.panelUid.'
}

$brokenParents = @()
$brokenChildren = @()
$blankNames = @()
foreach ($node in $uiMap.nodes.Values) {
    if ($node.parentId -and -not $uiMap.nodes.Contains($node.parentId)) { $brokenParents += $node.id }
    if ([string]::IsNullOrWhiteSpace($node.name)) { $blankNames += $node.id }
    foreach ($childId in @($node.children)) {
        if (-not $uiMap.nodes.Contains($childId) -or $uiMap.nodes[$childId].parentId -ne $node.id) {
            $brokenChildren += "$($node.id) -> $childId"
        }
    }
}
Assert-UiMap ($brokenParents.Count -eq 0) "Broken parent links: $($brokenParents -join ', ')"
Assert-UiMap ($brokenChildren.Count -eq 0) "Broken child links: $($brokenChildren -join ', ')"
Assert-UiMap ($blankNames.Count -eq 0) "Blank node names: $($blankNames -join ', ')"

$actualPanels = @($uiMap.nodes.Values | Where-Object { $_.kind -eq 'panel' } | ForEach-Object { $_.name })

$splits = @($uiMap.nodes.Values | Where-Object { $_.kind -eq 'split_button' })
foreach ($split in $splits) {
    Assert-UiMap (-not [string]::IsNullOrWhiteSpace($split.menuTriggerNodeId)) "Split button has no menu trigger: $($split.id)"
    Assert-UiMap ($uiMap.nodes[$split.menuTriggerNodeId].kind -eq 'menu_trigger') "Invalid menu trigger: $($split.id)"
    if ($split.compositeMode -eq 'dropdown_only') {
        Assert-UiMap ([string]::IsNullOrWhiteSpace($split.primaryActionNodeId)) "Dropdown-only control has a primary action: $($split.id)"
    }
    else {
        Assert-UiMap ($uiMap.nodes[$split.primaryActionNodeId].kind -eq 'primary_button') "True split button has no primary action: $($split.id)"
    }
}

if ($uiMap.scope.tabUid -eq 'ID_TabHome' -and [string]::IsNullOrWhiteSpace($uiMap.scope.panelUid) -and $uiMap.mapType -ne 'tab_manifest') {
    $expectedPanels = @('Draw', 'Modify', 'Annotation', 'Layers', 'Block', 'Properties', 'Groups', 'Utilities', 'Clipboard', 'View')
    Assert-UiMap ($actualPanels.Count -eq $expectedPanels.Count) "Expected $($expectedPanels.Count) Home panels, found $($actualPanels.Count)."
    Assert-UiMap (@($expectedPanels | Where-Object { $actualPanels -notcontains $_ }).Count -eq 0) 'One or more expected Home panels are missing.'
    Assert-UiMap ($splits.Count -eq 20) "Expected 20 Home split buttons, found $($splits.Count)."

    $circle = $splits | Where-Object { $_.name -eq 'Circle' } | Select-Object -First 1
    $circleNames = @(Get-MenuItems $uiMap $circle | ForEach-Object { $_.name })
    $expectedCircle = @('Center, Radius', 'Center, Diameter', '2-Point', '3-Point', 'Tan, Tan, Radius', 'Tan, Tan, Tan')
    Assert-UiMap ($circle.compositeMode -eq 'split') 'Circle must be represented as a true split button.'
    Assert-UiMap ($circleNames.Count -eq 6) "Expected six Circle menu items, found $($circleNames.Count)."
    Assert-UiMap (@($expectedCircle | Where-Object { $circleNames -notcontains $_ }).Count -eq 0) 'Circle menu items do not match Autodesk CUIX.'

    $array = $splits | Where-Object { $_.name -eq 'Array' } | Select-Object -First 1
    $arrayNames = @(Get-MenuItems $uiMap $array | ForEach-Object { $_.name })
    $expectedArray = @('Rectangular Array', 'Path Array', 'Polar Array')
    Assert-UiMap (@($expectedArray | Where-Object { $arrayNames -notcontains $_ }).Count -eq 0) 'Array menu items are incomplete or unnamed.'

    $base = $splits | Where-Object { $_.name -eq 'Base' } | Select-Object -First 1
    $baseNames = @(Get-MenuItems $uiMap $base | ForEach-Object { $_.name })
    Assert-UiMap ($base.compositeMode -eq 'dropdown_only') 'Base must be represented as dropdown-only.'
    Assert-UiMap ($baseNames.Count -eq 2) "Expected two Base menu items, found $($baseNames.Count)."
}

$opaqueCommandNames = @($uiMap.nodes.Values | Where-Object {
    $_.kind -in @('command_button', 'toggle_button') -and $_.name -match '^(ID_|RBN_|ACAD\.)'
})
Assert-UiMap ($opaqueCommandNames.Count -eq 0) 'One or more controls still use opaque CUIX UIDs as their user-facing names.'

$iconOnly = @($uiMap.nodes.Values | Where-Object { $_.icon.iconOnly })
$unidentifiedIcons = @($iconOnly | Where-Object {
    [string]::IsNullOrWhiteSpace($_.name) -or (
        [string]::IsNullOrWhiteSpace($_.icon.smallResource) -and
        [string]::IsNullOrWhiteSpace($_.icon.largeResource) -and
        [string]::IsNullOrWhiteSpace($_.ui.controlId) -and
        [string]::IsNullOrWhiteSpace($_.source.uid)
    )
})
Assert-UiMap ($unidentifiedIcons.Count -eq 0) 'An icon-only control lacks both a semantic name and a stable visual/control identifier.'

$actionableKinds = @('command_button', 'toggle_button', 'primary_button', 'menu_trigger', 'combo_box', 'gallery', 'data_bound_dropdown', 'ribbon_control', 'dialog_launcher')
$undocumentedActionable = @($uiMap.nodes.Values | Where-Object {
    $_.kind -in $actionableKinds -and [string]::IsNullOrWhiteSpace($_.semantics.description)
})
Assert-UiMap ($undocumentedActionable.Count -eq 0) 'One or more actionable controls lack a functional description.'

$serializedMap = Get-Content -Raw -LiteralPath $resolvedMap
Assert-UiMap ($serializedMap -notmatch 'C:\\Users\\') 'The generated map contains an absolute user profile path.'

if (-not [string]::IsNullOrWhiteSpace($uiMap.validation.evidence)) {
    $validationEvidencePath = Join-Path (Split-Path -Parent $resolvedMap) $uiMap.validation.evidence
    Assert-UiMap (Test-Path -LiteralPath $validationEvidencePath) 'The referenced live-observation evidence file does not exist.'
}

$evidenceNodes = @($uiMap.nodes.Values)
if ($uiMap.mapType -eq 'tab_manifest') {
    Assert-UiMap ($uiMap.fragments.kind -eq 'panel_maps') 'A tab manifest must reference panel maps.'
    Assert-UiMap (-not [string]::IsNullOrWhiteSpace($uiMap.fragments.index)) 'A tab manifest must reference a panel index.'
    Assert-UiMap ([int]$uiMap.fragments.count -eq @($uiMap.fragments.panels).Count) 'The tab manifest panel count does not match its references.'
    Assert-UiMap (@($uiMap.nodes.Values | Where-Object { $_.kind -eq 'panel' }).Count -eq 0) 'A compact tab manifest must not duplicate panel contents.'

    $mapDirectory = Split-Path -Parent $resolvedMap
    $panelIndexPath = Join-Path $mapDirectory $uiMap.fragments.index
    Assert-UiMap (Test-Path -LiteralPath $panelIndexPath) 'The referenced panel index does not exist.'
    $panelIndex = Get-Content -Raw -LiteralPath $panelIndexPath | ConvertFrom-Json -AsHashtable
    Assert-UiMap ([int]$panelIndex.panelCount -eq [int]$uiMap.fragments.count) 'The panel index count does not match the tab manifest.'

    foreach ($panelReference in @($uiMap.fragments.panels)) {
        $panelMapPath = Join-Path $mapDirectory (Join-Path 'panels' $panelReference.map)
        Assert-UiMap (Test-Path -LiteralPath $panelMapPath) "Referenced panel map does not exist: $($panelReference.map)"
        $panelMap = Get-Content -Raw -LiteralPath $panelMapPath | ConvertFrom-Json -AsHashtable
        Assert-UiMap ($panelMap.scope.panelUid -eq $panelReference.uid) "Panel UID mismatch: $($panelReference.map)"
        Assert-UiMap ($panelMap.scope.panelName -eq $panelReference.name) "Panel name mismatch: $($panelReference.map)"
        $evidenceNodes += @($panelMap.nodes.Values)
    }
}

$matchedEvidence = 0
if (-not [string]::IsNullOrWhiteSpace($Evidence)) {
    Assert-UiMap ([bool]$uiMap.validation.liveAccessibilityChecked) 'The map has not been marked as live accessibility checked.'
    $liveEvidence = Get-Content -Raw -LiteralPath $Evidence | ConvertFrom-Json -AsHashtable
    Assert-UiMap ([int]$liveEvidence.observedControlCount -eq @($liveEvidence.observedControlIds).Count) 'Evidence observedControlCount does not match observedControlIds.'
    $allStableIds = @($evidenceNodes | ForEach-Object {
        @($_.source.uid, $_.ui.uid, $_.ui.controlId, $_.ui.menuMacroId)
    } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)
    $missingObservedIds = @($liveEvidence.observedControlIds | Where-Object { $allStableIds -notcontains $_ })
    Assert-UiMap ($missingObservedIds.Count -eq 0) "Observed live controls are missing from the map: $($missingObservedIds -join ', ')"
    $matchedEvidence = @($liveEvidence.observedControlIds).Count
}

$reportedNodes = if ($uiMap.mapType -eq 'tab_manifest') { [int]$uiMap.summary.nodes } else { $uiMap.nodes.Count }
$reportedPanels = if ($uiMap.mapType -eq 'tab_manifest') { [int]$uiMap.summary.panels } else { $actualPanels.Count }
$reportedActionable = if ($uiMap.mapType -eq 'tab_manifest') { [int]$uiMap.summary.actionableControls } else { @($uiMap.nodes.Values | Where-Object { $_.kind -in $actionableKinds }).Count }
$reportedSplits = if ($uiMap.mapType -eq 'tab_manifest') { [int]$uiMap.summary.splitButtons } else { $splits.Count }
$reportedIconOnly = if ($uiMap.mapType -eq 'tab_manifest') { [int]$uiMap.summary.iconOnlyControls } else { $iconOnly.Count }

[ordered]@{
    result = 'pass'
    map = $resolvedMap
    nodes = $reportedNodes
    panels = $reportedPanels
    actionableControls = $reportedActionable
    splitButtons = $reportedSplits
    iconOnlyControls = $reportedIconOnly
    liveEvidenceControlsMatched = $matchedEvidence
} | ConvertTo-Json
