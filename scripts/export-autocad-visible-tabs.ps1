param(
    [string]$SupportDirectory = "$env:APPDATA\Autodesk\AutoCAD 2027\R26.0\enu\Support",

    [string]$OutputRoot = (Join-Path $PSScriptRoot '..\ui-maps\autocad\2027\en-US'),

    [string[]]$SelectedTabs = @()
)

$ErrorActionPreference = 'Stop'

$profiles = @(
    [ordered]@{ uid = 'ID_TabHome'; slug = 'home'; name = 'Home'; workspaces = @('Drafting & Annotation') },
    [ordered]@{ uid = 'ID_TabHome3D'; slug = 'home-3d-modeling'; name = 'Home'; workspaces = @('3D Modeling') },
    [ordered]@{ uid = 'ID_3dBasics_Home'; slug = 'home-3d-basics'; name = 'Home'; workspaces = @('3D Basics') },
    [ordered]@{ uid = 'ID_TabInsert'; slug = 'insert'; name = 'Insert'; workspaces = @('Drafting & Annotation', '3D Modeling') },
    [ordered]@{ uid = 'ID_3dBasics_Insert'; slug = 'insert-3d-basics'; name = 'Insert'; workspaces = @('3D Basics') },
    [ordered]@{ uid = 'ID_TabAnnotate'; slug = 'annotate'; name = 'Annotate'; workspaces = @('Drafting & Annotation', '3D Modeling') },
    [ordered]@{ uid = 'ID_TabParametric'; slug = 'parametric'; name = 'Parametric'; workspaces = @('Drafting & Annotation', '3D Modeling') },
    [ordered]@{ uid = 'ID_TabView'; slug = 'view'; name = 'View'; workspaces = @('Drafting & Annotation') },
    [ordered]@{ uid = 'ID_TabView3D'; slug = 'view-3d'; name = 'View'; workspaces = @('3D Basics', '3D Modeling') },
    [ordered]@{ uid = 'ID_TabManage'; slug = 'manage'; name = 'Manage'; workspaces = @('Drafting & Annotation', '3D Basics', '3D Modeling') },
    [ordered]@{ uid = 'ID_TabOutput'; slug = 'output'; name = 'Output'; workspaces = @('Drafting & Annotation') },
    [ordered]@{ uid = 'ID_TabOutput3D'; slug = 'output-3d'; name = 'Output'; workspaces = @('3D Basics', '3D Modeling') },
    [ordered]@{ uid = 'ID_TabCollaborate'; slug = 'collaborate'; name = 'Collaborate'; workspaces = @('Drafting & Annotation', '3D Basics', '3D Modeling') },
    [ordered]@{ uid = 'ID_SolidModeling'; slug = 'solid'; name = 'Solid'; workspaces = @('3D Modeling') },
    [ordered]@{ uid = 'ID_SurfaceTab'; slug = 'surface'; name = 'Surface'; workspaces = @('3D Modeling') },
    [ordered]@{ uid = 'ID_TabMeshModeling'; slug = 'mesh'; name = 'Mesh'; workspaces = @('3D Modeling') },
    [ordered]@{ uid = 'ID_TabRender'; slug = 'visualize-3d-modeling'; name = 'Visualize'; workspaces = @('3D Modeling') },
    [ordered]@{ uid = 'ID_3dBasics_Render'; slug = 'visualize-3d-basics'; name = 'Visualize'; workspaces = @('3D Basics') }
)

if (-not (Test-Path -LiteralPath $SupportDirectory)) {
    throw "AutoCAD Support directory was not found: $SupportDirectory"
}

$primaryCuix = Join-Path $SupportDirectory 'acad.CUIX'
if (-not (Test-Path -LiteralPath $primaryCuix)) {
    throw "Primary AutoCAD CUIX was not found: $primaryCuix"
}

$additionalCuix = @('ModelDoc.cuix', 'dbcon.cuix', 'custom.cuix') | ForEach-Object {
    $candidate = Join-Path $SupportDirectory $_
    if (Test-Path -LiteralPath $candidate) { $candidate }
}

if ($SelectedTabs.Count -gt 0) {
    $profiles = @($profiles | Where-Object {
        $SelectedTabs -contains $_.uid -or $SelectedTabs -contains $_.slug -or $SelectedTabs -contains $_.name
    })
}

if ($profiles.Count -eq 0) { throw 'No Ribbon tabs matched SelectedTabs.' }

$results = [System.Collections.ArrayList]::new()
foreach ($profile in $profiles) {
    $tabDirectory = Join-Path $OutputRoot $profile.slug
    $mapPath = Join-Path $tabDirectory 'ui-map.json'
    $evidencePath = Join-Path $tabDirectory 'live-observation.json'
    $exportArguments = @{
        Cuix = $primaryCuix
        AdditionalCuix = $additionalCuix
        TabUid = $profile.uid
        Output = $mapPath
    }
    if (Test-Path -LiteralPath $evidencePath) { $exportArguments.LiveEvidence = $evidencePath }

    $exportResult = & (Join-Path $PSScriptRoot 'export-autocad-ui-map.ps1') @exportArguments | ConvertFrom-Json
    $testArguments = @{ Map = $mapPath }
    if (Test-Path -LiteralPath $evidencePath) { $testArguments.Evidence = $evidencePath }
    $testResult = & (Join-Path $PSScriptRoot 'test-autocad-ui-map.ps1') @testArguments | ConvertFrom-Json

    [void]$results.Add([ordered]@{
        tab = $profile.name
        uid = $profile.uid
        workspaces = $profile.workspaces
        output = $exportResult.output
        nodes = $testResult.nodes
        panels = $testResult.panels
        panelMaps = $exportResult.panelMaps
        actionableControls = $testResult.actionableControls
        splitButtons = $testResult.splitButtons
        iconOnlyControls = $testResult.iconOnlyControls
        liveEvidenceControlsMatched = $testResult.liveEvidenceControlsMatched
        result = $testResult.result
    })
}

$indexTabs = @()
foreach ($profile in $profiles) {
    $tabResult = $results | Where-Object { $_.uid -eq $profile.uid } | Select-Object -First 1
    $indexTabs += [ordered]@{
        tab = $profile.name
        uid = $profile.uid
        workspaces = $profile.workspaces
        map = "$($profile.slug)/ui-map.json"
        panelsIndex = "$($profile.slug)/panels/index.json"
        evidence = if (Test-Path -LiteralPath (Join-Path $OutputRoot "$($profile.slug)\live-observation.json")) { "$($profile.slug)/live-observation.json" } else { $null }
        nodes = $tabResult.nodes
        panels = $tabResult.panels
        panelMaps = $tabResult.panelMaps
        actionableControls = $tabResult.actionableControls
        splitButtons = $tabResult.splitButtons
        iconOnlyControls = $tabResult.iconOnlyControls
        liveEvidenceControlsMatched = $tabResult.liveEvidenceControlsMatched
    }
}

$index = [ordered]@{
    schemaVersion = '1.0'
    application = [ordered]@{
        name = 'Autodesk AutoCAD'
        version = '2027'
        language = 'en-US'
        platform = 'Windows'
        workspaces = @('Drafting & Annotation', '3D Basics', '3D Modeling')
    }
    scope = [ordered]@{
        defaultForAgent = 'core_stock_only'
        included = 'Visible Ribbon tabs in the three stock AutoCAD workspaces'
        excluded = @('Add-ins', 'Express Tools', 'Featured Apps', 'industry toolsets', 'third-party plug-ins')
    }
    related = [ordered]@{
        commandCatalog = 'commands/command-catalog.json'
        applicationShell = 'shell/ui-map.json'
        workspaceIndex = 'workspaces/index.json'
        allRibbonTabs = 'ribbon/all-tabs-index.json'
        contextualTabs = 'contextual-tabs/index.json'
        menuCatalog = 'menus/menu-catalog.json'
    }
    hierarchy = @('application', 'window', 'ribbon', 'tab', 'panel', 'layout', 'control', 'split part', 'popup menu', 'menu item')
    lookupPolicy = 'Choose the active tab map, then resolve a control by stable ID, name, panel ancestry, region, sibling order, icon resource, and current screenshot. Do not reuse stored pixel coordinates across windows.'
    totals = [ordered]@{
        tabs = $indexTabs.Count
        nodes = ($indexTabs | ForEach-Object { [int]$_.nodes } | Measure-Object -Sum).Sum
        panels = ($indexTabs | ForEach-Object { [int]$_.panels } | Measure-Object -Sum).Sum
        panelMaps = ($indexTabs | ForEach-Object { [int]$_.panelMaps } | Measure-Object -Sum).Sum
        actionableControls = ($indexTabs | ForEach-Object { [int]$_.actionableControls } | Measure-Object -Sum).Sum
        splitButtons = ($indexTabs | ForEach-Object { [int]$_.splitButtons } | Measure-Object -Sum).Sum
        iconOnlyControls = ($indexTabs | ForEach-Object { [int]$_.iconOnlyControls } | Measure-Object -Sum).Sum
        liveEvidenceControlsMatched = ($indexTabs | ForEach-Object { [int]$_.liveEvidenceControlsMatched } | Measure-Object -Sum).Sum
    }
    tabs = $indexTabs
}

$indexPath = Join-Path $OutputRoot 'ui-index.json'
[System.IO.File]::WriteAllText($indexPath, ($index | ConvertTo-Json -Depth 20), [System.Text.UTF8Encoding]::new($false))

[ordered]@{
    index = (Resolve-Path -LiteralPath $indexPath).Path
    totals = $index.totals
    tabs = $results
} | ConvertTo-Json -Depth 20
