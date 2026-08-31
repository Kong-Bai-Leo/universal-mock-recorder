param(
    [string]$Version = '10.0.6',
    [string]$Language = 'en-US'
)

$ErrorActionPreference = 'Stop'

function Assert-KiCadUiMap {
    param(
        [bool]$Condition,
        [string]$Message
    )

    if (-not $Condition) { throw $Message }
}

function Test-ProvenanceNode {
    param(
        [object]$Node,
        [string]$Path
    )

    if ($null -eq $Node) { return }

    if ($Node -is [pscustomobject] -or $Node -is [System.Collections.IDictionary]) {
        $propertyNames = if ($Node -is [System.Collections.IDictionary]) { @($Node.Keys) } else { @($Node.PSObject.Properties.Name) }
        if ($propertyNames -contains 'kind') {
            Assert-KiCadUiMap (-not [string]::IsNullOrWhiteSpace([string]$Node.verification)) "Missing verification at $Path"
            Assert-KiCadUiMap (@($Node.provenance).Count -gt 0) "Missing provenance at $Path"
        }

        foreach ($key in $propertyNames) {
            $value = if ($Node -is [System.Collections.IDictionary]) { $Node[$key] } else { $Node.$key }
            Test-ProvenanceNode -Node $value -Path "$Path.$key"
        }
        return
    }

    if ($Node -is [System.Collections.IEnumerable] -and $Node -isnot [string]) {
        $index = 0
        foreach ($item in $Node) {
            Test-ProvenanceNode -Node $item -Path "$Path[$index]"
            $index++
        }
    }
}

$workspaceRoot = Split-Path -Parent $PSScriptRoot
$root = Join-Path $workspaceRoot "ui-maps\kicad\$Version\$Language"
$requiredFiles = @(
    'ui-index.json',
    'live-observation.json',
    'manager\ui-map.json',
    'schematic-editor\ui-map.json',
    'pcb-editor\ui-map.json',
    'README.md'
)

foreach ($relativePath in $requiredFiles) {
    Assert-KiCadUiMap (Test-Path -LiteralPath (Join-Path $root $relativePath)) "Missing KiCad UI map file: $relativePath"
}

$jsonFiles = @($requiredFiles | Where-Object { $_ -like '*.json' })
$maps = @{}
foreach ($relativePath in $jsonFiles) {
    $path = Join-Path $root $relativePath
    $raw = Get-Content -Raw -Encoding UTF8 -LiteralPath $path
    Assert-KiCadUiMap ($raw -notmatch 'C:\\Users\\') "User-specific absolute path found in $relativePath"
    Assert-KiCadUiMap ($raw -notmatch '(?i)\"automationId\"\s*:') "Automation ID field is forbidden before live UI verification: $relativePath"
    Assert-KiCadUiMap ($raw -notmatch '(?i)\"(x|y|left|top|right|bottom|bounds|coordinates)\"\s*:') "Coordinate-like replay data found in $relativePath"
    $maps[$relativePath] = $raw | ConvertFrom-Json
}

$index = $maps['ui-index.json']
Assert-KiCadUiMap ($index.schemaVersion -eq '1.0') 'Unexpected KiCad UI map schema version.'
Assert-KiCadUiMap ($index.application.name -eq 'KiCad') 'Unexpected application name.'
Assert-KiCadUiMap ($index.application.version -eq $Version) 'Unexpected KiCad application version.'
Assert-KiCadUiMap ($index.application.language -eq $Language) 'Unexpected KiCad UI map language.'
Assert-KiCadUiMap ($index.application.packageIdentifier -eq 'KiCad.KiCad') 'Unexpected winget package identifier.'
Assert-KiCadUiMap (-not [bool]$index.identifierPolicy.automationIdsPresent) 'The index must state that Automation IDs are absent.'
Assert-KiCadUiMap ([bool]$index.identifierPolicy.menuCommandIdsPresent) 'The index must declare live menu command IDs.'
Assert-KiCadUiMap (-not [bool]$index.identifierPolicy.menuCommandIdsAreAutomationIds) 'Menu command IDs must not be represented as Windows Automation IDs.'
Assert-KiCadUiMap (@($index.sources).Count -ge 4) 'Official release and manual sources are incomplete.'
Assert-KiCadUiMap (@($index.sections).Count -eq 3) 'Expected exactly three first-pass application surfaces.'

$live = $maps['live-observation.json']
Assert-KiCadUiMap ($live.mapType -eq 'live_ui_observation') 'Unexpected live-observation map type.'
Assert-KiCadUiMap ($live.application.version -eq $Version) 'Live observation targets the wrong KiCad version.'
Assert-KiCadUiMap ($live.application.scanLanguage -eq $Language) 'Live observation targets the wrong language.'
Assert-KiCadUiMap (-not [bool]$live.identifierPolicy.menuCommandIdsAreAutomationIds) 'Live command IDs must not be represented as Automation IDs.'
Assert-KiCadUiMap (-not [bool]$live.identifierPolicy.automationIdsPresent) 'Live scan must not claim unavailable Automation IDs.'

$liveSurfaces = @($live.surfaces.PSObject.Properties.Name)
foreach ($required in @('manager', 'schematicEditor', 'pcbEditor')) {
    Assert-KiCadUiMap ($liveSurfaces -contains $required) "Missing live-observed surface: $required"
}

$liveCommandMinimums = [ordered]@{
    manager = 30
    schematicEditor = 80
    pcbEditor = 80
}
foreach ($surfaceName in $liveCommandMinimums.Keys) {
    $surface = $live.surfaces.$surfaceName
    $commands = @($surface.menuCommands)
    Assert-KiCadUiMap ($commands.Count -ge $liveCommandMinimums[$surfaceName]) "Live command coverage is too small for $surfaceName"
    foreach ($command in $commands) {
        Assert-KiCadUiMap (-not [string]::IsNullOrWhiteSpace([string]$command.menu)) "Live command has no menu in $surfaceName"
        Assert-KiCadUiMap (-not [string]::IsNullOrWhiteSpace([string]$command.label)) "Live command has no label in $surfaceName"
        Assert-KiCadUiMap ([int]$command.commandId -gt 0) "Live command has an invalid commandId in $surfaceName"
    }
}

Assert-KiCadUiMap (-not [bool]$live.surfaces.schematicEditor.namedToolbarButtonsExposed) 'Schematic toolbar exposure limitation must be explicit.'
Assert-KiCadUiMap (-not [bool]$live.surfaces.pcbEditor.namedToolbarButtonsExposed) 'PCB toolbar exposure limitation must be explicit.'
Assert-KiCadUiMap ($live.surfaces.schematicEditor.canvas.stability -eq 'runtime-only') 'Schematic runtime canvas ID must not be promoted to a durable selector.'
Assert-KiCadUiMap ($live.surfaces.pcbEditor.canvas.stability -eq 'runtime-only') 'PCB runtime canvas ID must not be promoted to a durable selector.'

foreach ($relativePath in @('manager\ui-map.json', 'schematic-editor\ui-map.json', 'pcb-editor\ui-map.json')) {
    $map = $maps[$relativePath]
    Assert-KiCadUiMap ($map.schemaVersion -eq '1.0') "Unexpected schema version in $relativePath"
    Assert-KiCadUiMap (-not [string]::IsNullOrWhiteSpace([string]$map.surface.executable)) "Missing executable in $relativePath"
    Assert-KiCadUiMap (@($map.menus).Count -ge 6) "Core menu coverage is too small in $relativePath"
    Assert-KiCadUiMap (@($map.toolbars).Count -ge 1) "Toolbar coverage is missing in $relativePath"
    Assert-KiCadUiMap (@($map.liveScanGaps).Count -ge 3) "Live-scan gaps are not documented in $relativePath"
    Test-ProvenanceNode -Node $map -Path $relativePath
}

$manager = $maps['manager\ui-map.json']
$managerLaunchers = @($manager.launcher.controls | ForEach-Object { $_.name })
foreach ($required in @('Schematic Editor', 'PCB Editor', 'Gerber Viewer', 'Plugin and Content Manager')) {
    Assert-KiCadUiMap ($managerLaunchers -contains $required) "Missing Manager launcher: $required"
}

$schematic = $maps['schematic-editor\ui-map.json']
$schematicMenus = @($schematic.menus | ForEach-Object { $_.name })
foreach ($required in @('File', 'Edit', 'View', 'Place', 'Inspect', 'Tools', 'Preferences', 'Help')) {
    Assert-KiCadUiMap ($schematicMenus -contains $required) "Missing Schematic Editor menu: $required"
}
$schematicRight = @($schematic.toolbars | Where-Object locatorId -eq 'eeschema.toolbar.right-drawing' | Select-Object -ExpandProperty controls)
foreach ($required in @('Place Symbol', 'Draw Wire', 'Place Junction', 'Place Label')) {
    Assert-KiCadUiMap (@($schematicRight | ForEach-Object { $_.name }) -contains $required) "Missing Schematic Editor drawing control: $required"
}

$pcb = $maps['pcb-editor\ui-map.json']
$pcbMenus = @($pcb.menus | ForEach-Object { $_.name })
foreach ($required in @('File', 'Edit', 'View', 'Place', 'Route', 'Inspect', 'Tools', 'Preferences', 'Help')) {
    Assert-KiCadUiMap ($pcbMenus -contains $required) "Missing PCB Editor menu: $required"
}
$pcbRight = @($pcb.toolbars | Where-Object locatorId -eq 'pcbnew.toolbar.right-drawing' | Select-Object -ExpandProperty controls)
foreach ($required in @('Place Footprint', 'Route', 'Add Filled Zone', 'Measure')) {
    Assert-KiCadUiMap (@($pcbRight | ForEach-Object { $_.name }) -contains $required) "Missing PCB Editor drawing control: $required"
}

$counts = [ordered]@{
    result = 'pass'
    version = $Version
    language = $Language
    surfaces = 3
    managerLaunchers = @($manager.launcher.controls).Count
    schematicMenus = @($schematic.menus).Count
    schematicToolbarControls = @($schematic.toolbars | ForEach-Object { @($_.controls) }).Count
    pcbMenus = @($pcb.menus).Count
    pcbToolbarControls = @($pcb.toolbars | ForEach-Object { @($_.controls) }).Count
    managerLiveCommands = @($live.surfaces.manager.menuCommands).Count
    schematicLiveCommands = @($live.surfaces.schematicEditor.menuCommands).Count
    pcbLiveCommands = @($live.surfaces.pcbEditor.menuCommands).Count
    pcbLiveLayers = @($live.surfaces.pcbEditor.appearanceLayers).Count
    automationIds = 0
}

$counts | ConvertTo-Json
