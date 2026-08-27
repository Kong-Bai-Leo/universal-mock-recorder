param(
    [Parameter(Mandatory = $true)]
    [string]$SupportDirectory,

    [Parameter(Mandatory = $true)]
    [string]$OutputRoot,

    [Parameter(Mandatory = $true)]
    [string]$CommandCatalog,

    [string]$AutoCadVersion = '2027',

    [string]$Language = 'en-US'
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.IO.Compression.FileSystem

function Read-ZipXml {
    param(
        [System.IO.Compression.ZipArchive]$Archive,
        [string]$EntryName
    )

    $entry = $Archive.GetEntry($EntryName)
    if (-not $entry) { return $null }
    $reader = [System.IO.StreamReader]::new($entry.Open())
    try { return [xml]$reader.ReadToEnd() }
    finally { $reader.Dispose() }
}

function Get-AttributeValue {
    param(
        [System.Xml.XmlNode]$Node,
        [string]$Name
    )

    if (-not $Node -or -not $Node.Attributes) { return $null }
    $attribute = $Node.Attributes[$Name]
    if ($attribute) { return $attribute.Value }
    return $null
}

function Get-ChildText {
    param(
        [System.Xml.XmlNode]$Node,
        [string]$LocalName
    )

    if (-not $Node) { return $null }
    $child = $Node.SelectSingleNode("./*[local-name()='$LocalName']")
    if ($child) { return $child.InnerText.Trim() }
    return $null
}

function Convert-ToCommandName {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) { return $null }
    $candidate = $Value.Trim()
    if ($candidate -match '^([^\s(]+)') { $candidate = $matches[1] }
    $candidate = $candidate -replace '^[_.]+', ''
    if ($candidate -notmatch '^-?[A-Za-z0-9_+]+$') { return $null }
    return $candidate.ToUpperInvariant()
}

function Convert-ToVisibleLabel {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) { return $null }
    return ($Value -replace '&', '').Trim()
}

function Convert-ToStablePart {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) { return 'unnamed' }
    $part = $Value.ToLowerInvariant() -replace '[^a-z0-9]+', '-'
    return $part.Trim('-')
}

function Write-JsonFile {
    param(
        [object]$Value,
        [string]$Path,
        [int]$Depth = 14
    )

    $directory = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $directory)) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }
    $Value | ConvertTo-Json -Depth $Depth | Set-Content -LiteralPath $Path -Encoding utf8
}

$resolvedSupport = (Resolve-Path -LiteralPath $SupportDirectory).Path
$resolvedOutputRoot = [System.IO.Path]::GetFullPath($OutputRoot)
$commandCatalogPath = (Resolve-Path -LiteralPath $CommandCatalog).Path
$commandCatalogData = Get-Content -Raw -LiteralPath $commandCatalogPath | ConvertFrom-Json -AsHashtable

$coreCuixNames = @('acad.CUIX', 'ModelDoc.cuix', 'dbcon.cuix', 'custom.cuix')
$sourceDocuments = [System.Collections.ArrayList]::new()
foreach ($cuixName in $coreCuixNames) {
    $cuixPath = Join-Path $resolvedSupport $cuixName
    if (-not (Test-Path -LiteralPath $cuixPath)) { continue }
    $archive = [System.IO.Compression.ZipFile]::OpenRead($cuixPath)
    try {
        [void]$sourceDocuments.Add([ordered]@{
            name = $cuixName
            menu = Read-ZipXml $archive 'MenuGroup.cui'
            ribbon = Read-ZipXml $archive 'RibbonRoot.cui'
            workspace = Read-ZipXml $archive 'WorkspaceRoot.cui'
            quickAccess = Read-ZipXml $archive 'QuickAccessToolbarRoot.cui'
            popMenu = Read-ZipXml $archive 'PopMenuRoot.cui'
        })
    }
    finally { $archive.Dispose() }
}

$acadSource = $sourceDocuments | Where-Object { $_.name -ieq 'acad.CUIX' } | Select-Object -First 1
if (-not $acadSource -or -not $acadSource.workspace -or -not $acadSource.ribbon) {
    throw 'acad.CUIX does not contain the expected workspace and Ribbon definitions.'
}

$macros = [ordered]@{}
foreach ($source in $sourceDocuments) {
    if (-not $source.menu) { continue }
    foreach ($menuMacro in $source.menu.SelectNodes("//*[local-name()='MenuMacro']")) {
        $uid = Get-AttributeValue $menuMacro 'UID'
        $macro = $menuMacro.SelectSingleNode("./*[local-name()='Macro']")
        if (-not $uid -or -not $macro) { continue }
        $commandName = Convert-ToCommandName (Get-ChildText $macro 'CLICommand')
        $macros[$uid] = [ordered]@{
            id = $uid
            name = Get-ChildText $macro 'Name'
            description = Get-ChildText $macro 'HelpString'
            cliCommand = Get-ChildText $macro 'CLICommand'
            macro = Get-ChildText $macro 'Command'
            canonicalCommand = $commandName
            commandCatalogRef = if ($commandName -and $commandCatalogData.commands.Contains($commandName)) { "commands.$commandName" } else { $null }
            source = $source.name
        }
    }
}

$workspaceRecords = [System.Collections.ArrayList]::new()
$workspaceById = [ordered]@{}
$workspaceTabRefs = [ordered]@{}
$workspacePanelRefs = [ordered]@{}
$topMenuIds = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
foreach ($workspaceNode in $acadSource.workspace.SelectNodes("//*[local-name()='Workspace']")) {
    $workspaceId = Get-AttributeValue $workspaceNode 'UID'
    $workspaceName = Get-ChildText $workspaceNode 'Name'
    $tabs = [System.Collections.ArrayList]::new()
    foreach ($tabRef in $workspaceNode.SelectNodes(".//*[local-name()='WSRibbonTabSourceReference']")) {
        $tabId = Get-AttributeValue $tabRef 'TabId'
        $menuGroup = Get-AttributeValue $tabRef 'MenuGroup'
        $record = [ordered]@{
            tabId = $tabId
            menuGroup = $menuGroup
            shown = (Get-AttributeValue $tabRef 'Show') -eq 'true'
            active = (Get-AttributeValue $tabRef 'IsActive') -eq 'true'
            sourceUid = Get-AttributeValue $tabRef 'UID'
            includedInCore = $menuGroup -eq 'ACAD'
        }
        [void]$tabs.Add($record)
        if (-not $workspaceTabRefs.Contains($tabId)) { $workspaceTabRefs[$tabId] = [System.Collections.ArrayList]::new() }
        [void]$workspaceTabRefs[$tabId].Add([ordered]@{
            workspaceId = $workspaceId
            workspaceName = $workspaceName
            shown = $record.shown
            menuGroup = $menuGroup
        })
    }

    $panels = [System.Collections.ArrayList]::new()
    foreach ($panelRef in $workspaceNode.SelectNodes(".//*[local-name()='WSRibbonPanelSourceReference']")) {
        $panelId = Get-AttributeValue $panelRef 'PanelId'
        $record = [ordered]@{
            panelId = $panelId
            shown = (Get-AttributeValue $panelRef 'Show') -eq 'true'
            orientation = Get-AttributeValue $panelRef 'Orientation'
            sourceUid = Get-AttributeValue $panelRef 'UID'
        }
        [void]$panels.Add($record)
        if (-not $workspacePanelRefs.Contains($panelId)) { $workspacePanelRefs[$panelId] = [System.Collections.ArrayList]::new() }
        [void]$workspacePanelRefs[$panelId].Add([ordered]@{
            workspaceId = $workspaceId
            workspaceName = $workspaceName
            shown = $record.shown
        })
    }

    $classicMenus = [System.Collections.ArrayList]::new()
    foreach ($menuRef in $workspaceNode.SelectNodes(".//*[local-name()='WSPop']")) {
        $menuId = Get-AttributeValue $menuRef 'pUID'
        $menuGroup = Get-AttributeValue $menuRef 'MenuGroup'
        [void]$classicMenus.Add([ordered]@{
            menuId = $menuId
            menuGroup = $menuGroup
            includedInCore = $menuGroup -eq 'ACAD'
            displayedWhenMenuBarEnabled = (Get-AttributeValue $menuRef 'Display') -eq '1'
        })
        if ($menuGroup -eq 'ACAD') { [void]$topMenuIds.Add($menuId) }
    }

    $palettes = [System.Collections.ArrayList]::new()
    foreach ($paletteNode in $workspaceNode.SelectNodes(".//*[local-name()='WSESW']")) {
        [void]$palettes.Add([ordered]@{
            id = Get-AttributeValue $paletteNode 'UID'
            name = Get-ChildText $paletteNode 'Name'
            command = Convert-ToCommandName (Get-AttributeValue $paletteNode 'CommandName')
            displayed = (Get-AttributeValue $paletteNode 'Display') -eq 'yes'
            dockState = Get-AttributeValue $paletteNode 'DockFloat'
            orientation = Get-AttributeValue $paletteNode 'Orientation'
        })
    }

    $workspaceRecord = [ordered]@{
        id = $workspaceId
        name = $workspaceName
        default = (Get-AttributeValue $workspaceNode 'DefaultWorkspace') -eq 'true'
        uiState = [ordered]@{
            menuBar = Get-AttributeValue $workspaceNode 'MenuBar'
            statusBar = Get-AttributeValue $workspaceNode 'StatusBar'
            navigationBar = Get-AttributeValue $workspaceNode 'NavigationBar'
            layoutModelTabs = Get-AttributeValue $workspaceNode 'LayoutModelTabs'
        }
        ribbonTabs = [object[]]@($tabs)
        ribbonPanels = [object[]]@($panels)
        classicMenus = [object[]]@($classicMenus)
        palettes = [object[]]@($palettes)
        quickAccessToolbar = [ordered]@{
            id = [string]$workspaceNode.SelectSingleNode(".//*[local-name()='WSQuickAccessToolbarReference']").Attributes['ToolbarId'].Value
            orientation = [string]$workspaceNode.SelectSingleNode(".//*[local-name()='WSQuickAccessToolbarReference']").Attributes['Orientation'].Value
        }
        verification = [ordered]@{
            extracted = $true
            liveObserved = $false
            evidence = @('autodesk_installed_acad_cuix')
        }
    }
    [void]$workspaceRecords.Add($workspaceRecord)
    $workspaceById[$workspaceId] = $workspaceRecord
}

$workspaceIndex = [ordered]@{
    schemaVersion = '1.0'
    application = [ordered]@{ name = 'Autodesk AutoCAD'; version = $AutoCadVersion; language = $Language; platform = 'Windows' }
    source = [ordered]@{ type = 'autodesk_installed_cuix'; file = 'acad.CUIX'; entry = 'WorkspaceRoot.cui' }
    defaultWorkspaceId = [string]($workspaceRecords | Where-Object { $_.default } | Select-Object -First 1).id
    totals = [ordered]@{
        workspaces = $workspaceRecords.Count
        coreVisibleRibbonTabReferences = @($workspaceRecords.ribbonTabs | Where-Object { $_.includedInCore -and $_.shown }).Count
        palettes = @($workspaceRecords.palettes | Group-Object id).Count
    }
    workspaces = [object[]]@($workspaceRecords)
}
Write-JsonFile $workspaceIndex (Join-Path $resolvedOutputRoot 'workspaces\index.json')

$tabRecords = [System.Collections.ArrayList]::new()
$seenTabs = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
foreach ($source in $sourceDocuments) {
    if (-not $source.ribbon) { continue }
    foreach ($tabNode in $source.ribbon.SelectNodes("//*[local-name()='RibbonTabSource']")) {
        $tabId = Get-AttributeValue $tabNode 'UID'
        if (-not $tabId -or $seenTabs.Contains($tabId)) { continue }
        [void]$seenTabs.Add($tabId)
        [object[]]$references = if ($workspaceTabRefs.Contains($tabId)) { @($workspaceTabRefs[$tabId]) } else { @() }
        $coreReferences = @($references | Where-Object { $_.menuGroup -eq 'ACAD' })
        $classification = if ($coreReferences.Count -gt 0) {
            'workspace_tab'
        }
        elseif ($source.name -in @('acad.CUIX', 'ModelDoc.cuix', 'dbcon.cuix')) {
            'contextual_or_on_demand_tab'
        }
        else {
            'custom_or_unclassified_tab'
        }
        [void]$tabRecords.Add([ordered]@{
            id = $tabId
            name = Get-AttributeValue $tabNode 'Text'
            aliases = [object[]]@($tabNode.SelectNodes("./*[local-name()='Alias']") | ForEach-Object { $_.InnerText.Trim() })
            source = $source.name
            workspaceBehavior = Get-AttributeValue $tabNode 'WorkspaceBehavior'
            classification = $classification
            workspaceRefs = $references
            visibleInCoreWorkspaces = [object[]]@($coreReferences | Where-Object { $_.shown } | ForEach-Object { $_.workspaceName } | Sort-Object -Unique)
            verification = [ordered]@{ extracted = $true; liveObserved = $false; contextTriggerTested = $false }
        })
    }
}

$tabIndex = [ordered]@{
    schemaVersion = '1.0'
    application = [ordered]@{ name = 'Autodesk AutoCAD'; version = $AutoCadVersion; language = $Language; platform = 'Windows' }
    policy = 'Workspace tabs are always or optionally available in a stock workspace. Other core CUIX tabs are contextual or on-demand until a live trigger is verified.'
    totals = [ordered]@{
        tabs = $tabRecords.Count
        workspaceTabs = @($tabRecords | Where-Object { $_.classification -eq 'workspace_tab' }).Count
        contextualOrOnDemand = @($tabRecords | Where-Object { $_.classification -eq 'contextual_or_on_demand_tab' }).Count
    }
    tabs = [object[]]@($tabRecords | Sort-Object name, id)
}
Write-JsonFile $tabIndex (Join-Path $resolvedOutputRoot 'ribbon\all-tabs-index.json')

$menuRecords = [System.Collections.ArrayList]::new()
foreach ($source in $sourceDocuments) {
    if (-not $source.popMenu) { continue }
    foreach ($menuNode in $source.popMenu.SelectNodes("//*[local-name()='PopMenu']")) {
        $menuId = Get-AttributeValue $menuNode 'UID'
        $aliases = @($menuNode.SelectNodes("./*[local-name()='Alias']") | ForEach-Object { $_.InnerText.Trim() })
        $items = [System.Collections.ArrayList]::new()
        $itemOrder = 0
        foreach ($child in $menuNode.ChildNodes) {
            if ($child.LocalName -notin @('PopMenuItem', 'PopMenuRef')) { continue }
            $itemOrder += 1
            if ($child.LocalName -eq 'PopMenuRef') {
                [void]$items.Add([ordered]@{
                    kind = 'submenu_reference'
                    id = Get-AttributeValue $child 'UID'
                    targetMenuId = Get-AttributeValue $child 'pUID'
                    order = $itemOrder
                })
                continue
            }
            if ((Get-AttributeValue $child 'IsSeparator') -eq 'true') {
                [void]$items.Add([ordered]@{ kind = 'separator'; id = Get-AttributeValue $child 'UID'; order = $itemOrder })
                continue
            }
            $macroRef = $child.SelectSingleNode(".//*[local-name()='MacroRef']")
            $macroId = Get-AttributeValue $macroRef 'MenuMacroID'
            $macro = if ($macroId -and $macros.Contains($macroId)) { $macros[$macroId] } else { $null }
            $rawName = Get-ChildText $child 'NameRef'
            [void]$items.Add([ordered]@{
                kind = 'command_item'
                id = Get-AttributeValue $child 'UID'
                name = Convert-ToVisibleLabel $rawName
                sourceLabel = $rawName
                dynamicLabel = (Get-AttributeValue $child 'hasDiesel') -eq 'true'
                macroId = $macroId
                command = if ($macro) { $macro.canonicalCommand } else { $null }
                commandCatalogRef = if ($macro) { $macro.commandCatalogRef } else { $null }
                order = $itemOrder
            })
        }
        $isContext = @($aliases | Where-Object { $_ -match '^(CM|OBJECT_|POP5)' }).Count -gt 0
        $classification = if ($topMenuIds.Contains($menuId)) { 'classic_menu_bar' } elseif ($isContext) { 'context_menu' } else { 'submenu_or_runtime_menu' }
        [void]$menuRecords.Add([ordered]@{
            id = $menuId
            name = Get-ChildText $menuNode 'Name'
            aliases = [object[]]$aliases
            classification = $classification
            source = $source.name
            dynamic = (Get-AttributeValue $menuNode 'hasDiesel') -eq 'true'
            items = [object[]]@($items)
            verification = [ordered]@{ extracted = $true; liveObserved = $false; interactionTested = $false }
        })
    }
}

$menuCatalog = [ordered]@{
    schemaVersion = '1.0'
    application = [ordered]@{ name = 'Autodesk AutoCAD'; version = $AutoCadVersion; language = $Language; platform = 'Windows' }
    source = [ordered]@{ type = 'autodesk_installed_core_cuix'; entries = @('PopMenuRoot.cui', 'MenuGroup.cui') }
    totals = [ordered]@{
        menus = $menuRecords.Count
        classicMenuBar = @($menuRecords | Where-Object { $_.classification -eq 'classic_menu_bar' }).Count
        contextMenus = @($menuRecords | Where-Object { $_.classification -eq 'context_menu' }).Count
        commandItems = @($menuRecords.items | Where-Object { $_.kind -eq 'command_item' }).Count
    }
    menus = [object[]]@($menuRecords | Sort-Object classification, name, id)
}
Write-JsonFile $menuCatalog (Join-Path $resolvedOutputRoot 'menus\menu-catalog.json')

$qatCommandMap = [ordered]@{
    'AcQATNew' = [ordered]@{ name = 'New'; command = 'QNEW' }
    'AcQATOpen' = [ordered]@{ name = 'Open'; command = 'OPEN' }
    'AcQATSave' = [ordered]@{ name = 'Save'; command = 'QSAVE' }
    'AcQATSaveAs' = [ordered]@{ name = 'Save As'; command = 'SAVEAS' }
    'AcQATPlot' = [ordered]@{ name = 'Plot'; command = 'PLOT' }
    'AcQATUndo' = [ordered]@{ name = 'Undo'; command = 'UNDO' }
    'AcQATRedo' = [ordered]@{ name = 'Redo'; command = 'REDO' }
}

$nodes = [ordered]@{}
$nodes['autocad'] = [ordered]@{ id = 'autocad'; kind = 'application'; name = 'Autodesk AutoCAD'; parentId = $null; children = @('autocad.window') }
$nodes['autocad.window'] = [ordered]@{ id = 'autocad.window'; kind = 'window'; name = 'AutoCAD drawing window'; parentId = 'autocad'; children = @('autocad.window.application-menu','autocad.window.quick-access-toolbar','autocad.window.ribbon','autocad.window.classic-menu-bar','autocad.window.drawing-area','autocad.window.command-line','autocad.window.status-bar') }
$nodes['autocad.window.application-menu'] = [ordered]@{
    id = 'autocad.window.application-menu'; kind = 'application_menu'; name = 'Application Menu'; parentId = 'autocad.window'; children = @()
    source = [ordered]@{ type = 'runtime_standard_surface'; staticCuixDefinition = $false }
    verification = [ordered]@{ extracted = $false; liveObserved = $false; interactionTested = $false; note = 'Contents require a live observation pass.' }
}
$nodes['autocad.window.quick-access-toolbar'] = [ordered]@{ id = 'autocad.window.quick-access-toolbar'; kind = 'quick_access_toolbar'; name = 'Quick Access Toolbar'; parentId = 'autocad.window'; children = [System.Collections.ArrayList]::new(); source = [ordered]@{ type = 'autodesk_installed_cuix'; file = 'acad.CUIX'; entry = 'QuickAccessToolbarRoot.cui' }; verification = [ordered]@{ extracted = $true; liveObserved = $false; interactionTested = $false } }
$qatNode = $acadSource.quickAccess.SelectSingleNode("//*[local-name()='QuickAccessToolbar']")
$qatOrder = 0
foreach ($item in $qatNode.SelectNodes("./*[local-name()='QuickAccessToolbarStandardItem']")) {
    $qatOrder += 1
    $controlId = Get-AttributeValue $item 'Id'
    $definition = $qatCommandMap[$controlId]
    $nodeId = "autocad.window.quick-access-toolbar.$(Convert-ToStablePart $controlId)"
    [void]$nodes['autocad.window.quick-access-toolbar'].children.Add($nodeId)
    $nodes[$nodeId] = [ordered]@{
        id = $nodeId; kind = 'command_button'; name = $definition.name; parentId = 'autocad.window.quick-access-toolbar'; children = @()
        source = [ordered]@{ type = 'autodesk_installed_cuix'; uid = Get-AttributeValue $item 'UID'; controlId = $controlId }
        placement = [ordered]@{ region = 'title_bar'; order = $qatOrder }
        action = [ordered]@{ type = 'invoke_command'; command = $definition.command; scriptCommand = "_.$($definition.command)"; commandCatalogRef = "commands.$($definition.command)" }
        verification = [ordered]@{ extracted = $true; liveObserved = $false; interactionTested = $false; confidence = 0.8 }
    }
}
$nodes['autocad.window.ribbon'] = [ordered]@{ id = 'autocad.window.ribbon'; kind = 'ribbon'; name = 'Ribbon'; parentId = 'autocad.window'; children = @(); index = '../ribbon/all-tabs-index.json'; verification = [ordered]@{ extracted = $true; liveObserved = $true; evidence = '../home/live-observation.json' } }
$nodes['autocad.window.classic-menu-bar'] = [ordered]@{ id = 'autocad.window.classic-menu-bar'; kind = 'menu_bar'; name = 'Classic Menu Bar'; parentId = 'autocad.window'; children = @(); defaultVisible = $false; catalog = '../menus/menu-catalog.json'; verification = [ordered]@{ extracted = $true; liveObserved = $false; interactionTested = $false } }
$nodes['autocad.window.drawing-area'] = [ordered]@{ id = 'autocad.window.drawing-area'; kind = 'canvas'; name = 'Drawing Area'; parentId = 'autocad.window'; children = @(); verification = [ordered]@{ extracted = $false; liveObserved = $true; interactionTested = $true } }
$nodes['autocad.window.command-line'] = [ordered]@{ id = 'autocad.window.command-line'; kind = 'command_line'; name = 'Command Line'; parentId = 'autocad.window'; children = @(); verification = [ordered]@{ extracted = $true; liveObserved = $true; interactionTested = $true } }
$nodes['autocad.window.status-bar'] = [ordered]@{
    id = 'autocad.window.status-bar'; kind = 'status_bar'; name = 'Status Bar'; parentId = 'autocad.window'; children = @()
    source = [ordered]@{ type = 'runtime_dynamic_surface'; staticCuixDefinition = $false }
    verification = [ordered]@{ extracted = $false; liveObserved = $false; interactionTested = $false; note = 'Enabled controls and customization menu require a live observation pass.' }
}

$shellEvidencePath = Join-Path $resolvedOutputRoot 'shell\live-observation.json'
$shellEvidence = $null
if (Test-Path -LiteralPath $shellEvidencePath) {
    $shellEvidence = Get-Content -Raw -LiteralPath $shellEvidencePath | ConvertFrom-Json -AsHashtable

    $applicationMenuId = 'autocad.window.application-menu'
    $applicationChildren = [System.Collections.ArrayList]::new()
    $applicationOrder = 0
    foreach ($item in @($shellEvidence.surfaces.applicationMenu.items)) {
        $applicationOrder += 1
        $nodeId = "$applicationMenuId.$($item.id)"
        [void]$applicationChildren.Add($nodeId)
        $command = Convert-ToCommandName ([string]$item.command)
        $nodes[$nodeId] = [ordered]@{
            id = $nodeId
            kind = [string]$item.kind
            name = [string]$item.name
            parentId = $applicationMenuId
            children = @()
            placement = [ordered]@{ region = if ($item.id -in @('options', 'exit')) { 'footer' } else { 'main' }; order = $applicationOrder }
            hasSubmenu = [bool]$item.hasSubmenu
            action = if ($command) {
                [ordered]@{
                    type = if ($item.hasSubmenu) { 'invoke_primary_or_open_submenu' } else { 'invoke_command' }
                    command = $command
                    scriptCommand = "_.$command"
                    commandCatalogRef = if ($commandCatalogData.commands.Contains($command)) { "commands.$command" } else { $null }
                }
            } else {
                [ordered]@{ type = if ($item.kind -eq 'search_box') { 'search_application_menu' } elseif ($item.hasSubmenu) { 'open_submenu' } else { 'select_view' } }
            }
            verification = [ordered]@{ extracted = $false; liveObserved = $true; interactionTested = $false; evidence = 'live-observation.json' }
        }
    }
    $nodes[$applicationMenuId].children = [object[]]@($applicationChildren)
    $nodes[$applicationMenuId].verification = [ordered]@{
        extracted = $false
        liveObserved = [bool]$shellEvidence.surfaces.applicationMenu.opened
        interactionTested = [bool]$shellEvidence.surfaces.applicationMenu.interactionTested
        evidence = 'live-observation.json'
    }

    $statusBarId = 'autocad.window.status-bar'
    $statusChildren = [System.Collections.ArrayList]::new()
    $statusOrder = 0
    foreach ($item in @($shellEvidence.surfaces.statusBarCustomization.items)) {
        $statusOrder += 1
        $nodeId = "$statusBarId.$($item.id)"
        [void]$statusChildren.Add($nodeId)
        $nodes[$nodeId] = [ordered]@{
            id = $nodeId
            kind = 'status_bar_control'
            name = [string]$item.name
            parentId = $statusBarId
            children = @()
            enabledInObservedWorkspace = [bool]$item.enabled
            placement = [ordered]@{ region = 'bottom_status_bar'; order = $statusOrder }
            action = [ordered]@{ type = 'toggle_or_open_status_control'; runtimeStateRequired = $true }
            verification = [ordered]@{ extracted = $false; liveObserved = $true; interactionTested = $false; evidence = 'live-observation.json' }
        }
    }
    $customizeId = "$statusBarId.customization-menu"
    [void]$statusChildren.Add($customizeId)
    $nodes[$customizeId] = [ordered]@{
        id = $customizeId
        kind = 'menu_trigger'
        name = 'Customization'
        parentId = $statusBarId
        children = @()
        action = [ordered]@{ type = 'open_status_bar_customization_menu' }
        verification = [ordered]@{ extracted = $false; liveObserved = $true; interactionTested = $true; evidence = 'live-observation.json' }
    }
    $nodes[$statusBarId].children = [object[]]@($statusChildren)
    $nodes[$statusBarId].verification = [ordered]@{
        extracted = $false
        liveObserved = [bool]$shellEvidence.surfaces.statusBarCustomization.opened
        interactionTested = [bool]$shellEvidence.surfaces.statusBarCustomization.interactionTested
        evidence = 'live-observation.json'
    }
}

$shellMap = [ordered]@{
    schemaVersion = '1.0'
    application = [ordered]@{ name = 'Autodesk AutoCAD'; version = $AutoCadVersion; language = $Language; platform = 'Windows' }
    mapType = 'application_shell'
    rootNodeId = 'autocad'
    lookupPolicy = 'Resolve by surface, stable control ID, name, sibling order, current workspace, and current screenshot. Never reuse saved pixel coordinates.'
    related = [ordered]@{
        commandCatalog = '../commands/command-catalog.json'
        workspaceIndex = '../workspaces/index.json'
        ribbonTabIndex = '../ribbon/all-tabs-index.json'
        menuCatalog = '../menus/menu-catalog.json'
    }
    summary = [ordered]@{
        nodes = $nodes.Count
        quickAccessControls = $qatOrder
        applicationMenuControls = $nodes['autocad.window.application-menu'].children.Count
        statusBarControls = @($nodes['autocad.window.status-bar'].children | Where-Object { $_ -ne 'autocad.window.status-bar.customization-menu' }).Count
        pendingLiveSurfaces = if ($shellEvidence) { @() } else { @('Application Menu', 'Status Bar') }
    }
    nodes = $nodes
}
Write-JsonFile $shellMap (Join-Path $resolvedOutputRoot 'shell\ui-map.json')

[ordered]@{
    result = 'generated'
    outputRoot = $resolvedOutputRoot
    workspaces = $workspaceRecords.Count
    ribbonTabs = $tabRecords.Count
    menus = $menuRecords.Count
    quickAccessControls = $qatOrder
} | ConvertTo-Json -Depth 5
