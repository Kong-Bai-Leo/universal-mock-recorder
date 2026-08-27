param(
    [Parameter(Mandatory = $true)]
    [string]$Cuix,

    [string]$TabUid = 'ID_TabHome',

    [Parameter(Mandatory = $true)]
    [string]$Output,

    [string[]]$AdditionalCuix = @(),

    [string]$LiveEvidence,

    [string]$AutoCadVersion = '2027',

    [string]$Language = 'en-US',

    [string]$Workspace = 'Drafting & Annotation',

    [bool]$SplitPanels = $true,

    [bool]$CompactTabMap = $true
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.IO.Compression.FileSystem

function Read-ZipText {
    param(
        [System.IO.Compression.ZipArchive]$Archive,
        [string]$EntryName
    )

    $entry = $Archive.GetEntry($EntryName)
    if (-not $entry) {
        throw "CUIX entry was not found: $EntryName"
    }

    $reader = [System.IO.StreamReader]::new($entry.Open())
    try {
        return $reader.ReadToEnd()
    }
    finally {
        $reader.Dispose()
    }
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

function Convert-ToStablePart {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) { return 'unnamed' }
    $result = $Value.ToLowerInvariant() -replace '[^a-z0-9]+', '-'
    return $result.Trim('-')
}

function New-UniqueNodeId {
    param(
        [string]$ParentId,
        [string]$PreferredPart
    )

    $baseId = if ($ParentId) {
        "$ParentId.$(Convert-ToStablePart $PreferredPart)"
    }
    else {
        Convert-ToStablePart $PreferredPart
    }

    $candidate = $baseId
    $suffix = 2
    while ($script:Nodes.Contains($candidate)) {
        $candidate = "$baseId-$suffix"
        $suffix += 1
    }
    return $candidate
}

function New-NodeRecord {
    param(
        [string]$Id,
        [string]$Kind,
        [string]$Name,
        [string]$ParentId,
        [string]$SourceUid,
        [string]$Region = 'main'
    )

    return [ordered]@{
        id = $Id
        kind = $Kind
        name = $Name
        parentId = $ParentId
        children = [System.Collections.ArrayList]::new()
        source = [ordered]@{
            type = 'autodesk_installed_cuix'
            uid = $SourceUid
        }
        placement = [ordered]@{
            region = $Region
            order = $script:NodeSequence
        }
        verification = [ordered]@{
            liveObserved = $false
            interactionTested = $false
            confidence = 0.55
            evidence = @('autodesk_installed_cuix')
        }
    }
}

function Add-NodeRecord {
    param([System.Collections.IDictionary]$Node)

    $script:NodeSequence += 1
    $script:Nodes[$Node.id] = $Node
    if ($Node.parentId -and $script:Nodes.Contains($Node.parentId)) {
        [void]$script:Nodes[$Node.parentId].children.Add($Node.id)
    }
}

function Get-MacroRecord {
    param([string]$MenuMacroId)

    if ([string]::IsNullOrWhiteSpace($MenuMacroId)) { return $null }
    if ($script:Macros.Contains($MenuMacroId)) { return $script:Macros[$MenuMacroId] }
    return $null
}

function Add-CommandMetadata {
    param(
        [System.Collections.IDictionary]$Record,
        [System.Xml.XmlNode]$XmlNode,
        [string]$MenuMacroId
    )

    $macro = Get-MacroRecord $MenuMacroId
    $commandId = Get-AttributeValue $XmlNode 'CommandID'
    $commandType = Get-AttributeValue $XmlNode 'CommandType'
    $record.ui = [ordered]@{
        uid = Get-AttributeValue $XmlNode 'UID'
        controlId = Get-AttributeValue $XmlNode 'Id'
        text = Get-AttributeValue $XmlNode 'Text'
        buttonStyle = Get-AttributeValue $XmlNode 'ButtonStyle'
        keyTip = Get-AttributeValue $XmlNode 'KeyTip'
        smallImage = Get-AttributeValue $XmlNode 'SmallImage'
        largeImage = Get-AttributeValue $XmlNode 'LargeImage'
        menuMacroId = $MenuMacroId
        commandId = $commandId
        commandType = $commandType
    }

    $description = $null
    $commandName = $null
    $macroName = $null
    $macroType = $null
    $macroText = $null
    $smallImage = $record.ui.smallImage
    $largeImage = $record.ui.largeImage
    if ($macro) {
        $description = $macro.description
        $commandName = $macro.cliCommand
        $macroName = $macro.name
        $macroType = $macro.type
        $macroText = $macro.command
        if (-not $smallImage) { $smallImage = $macro.smallImage }
        if (-not $largeImage) { $largeImage = $macro.largeImage }
    }

    # Icon-only Ribbon items frequently omit their visible Text in CUIX. Use the
    # official macro name so downstream vision agents never receive an opaque UID
    # such as "RBN_01740019" as the button name.
    if ([string]::IsNullOrWhiteSpace($record.ui.text) -and -not [string]::IsNullOrWhiteSpace($macroName)) {
        $record.name = $macroName
    }

    $record.names = [ordered]@{
        visible = $record.ui.text
        official = $macroName
        aliases = @($commandName, $MenuMacroId) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique
    }
    $record.icon = [ordered]@{
        smallResource = $smallImage
        largeResource = $largeImage
        iconOnly = ($record.ui.buttonStyle -like '*WithoutText')
    }
    $record.action = [ordered]@{
        type = if ($commandName -or $macroText -or $commandId) { 'invoke_command' } else { 'invoke_control' }
        cliCommand = $commandName
        macro = $macroText
        macroType = $macroType
        commandId = $commandId
        commandType = $commandType
    }
    if ([string]::IsNullOrWhiteSpace($description)) {
        $description = switch ($record.kind) {
            'toggle_button' { "Toggles $($record.name)." }
            'dialog_launcher' { "Opens the dialog associated with $($record.name)." }
            default {
                if ($commandName) { "Invokes the AutoCAD $commandName command." }
                else { "Invokes $($record.name)." }
            }
        }
    }
    $record.semantics = [ordered]@{
        description = $description
        inputs = @()
        result = $null
        cancelActions = @('Escape')
        risk = 'unclassified'
    }
    $record.documentation = @(
        [ordered]@{
            source = 'autodesk_installed_cuix'
            descriptionVerified = -not [string]::IsNullOrWhiteSpace($description)
            officialHelpQuery = if ($commandName) { "AutoCAD $AutoCadVersion $commandName command" } else { $null }
            url = $null
        }
    )
    $record.verification = [ordered]@{
        liveObserved = $false
        interactionTested = $false
        confidence = if ($macro) { 0.85 } else { 0.55 }
        evidence = @('autodesk_installed_cuix')
    }
}

function Add-GenericElement {
    param(
        [System.Xml.XmlNode]$XmlNode,
        [string]$ParentId,
        [string]$Region,
        [string]$OwnerSplitButtonId
    )

    if ($XmlNode.NodeType -ne [System.Xml.XmlNodeType]::Element) { return }
    $localName = $XmlNode.LocalName
    if ($localName -in @('ModifiedRev', 'Revision', 'Name', 'Alias', 'TooltipTitle', 'Description')) { return }

    $uid = Get-AttributeValue $XmlNode 'UID'
    $text = Get-AttributeValue $XmlNode 'Text'
    $preferredPart = if ($uid) { $uid } elseif ($text) { "$localName-$text" } else { "$localName-$script:NodeSequence" }
    $kind = switch ($localName) {
        'RibbonRow' { 'layout_row' }
        'RibbonRowPanel' { 'layout_group' }
        'RibbonPanelBreak' { 'panel_break' }
        'RibbonSeparator' { 'separator' }
        'RibbonCommandButton' { 'command_button' }
        'RibbonButton' { 'command_button' }
        'RibbonToggleButton' { 'toggle_button' }
        'RibbonSplitButton' { 'split_button' }
        'RibbonComboBox' { 'combo_box' }
        'RibbonGallery' { 'gallery' }
        'RibbonGalleryControl' { 'gallery' }
        'RibbonDataBoundDropDown' { 'data_bound_dropdown' }
        'RibbonControl' { 'ribbon_control' }
        'DialogBoxLauncher' { 'dialog_launcher' }
        default { Convert-ToStablePart $localName }
    }

    $nodeId = New-UniqueNodeId $ParentId $preferredPart
    $displayName = if ($text) { $text } elseif ($uid) { $uid } else { $localName }
    $record = New-NodeRecord $nodeId $kind $displayName $ParentId $uid $Region

    if ($OwnerSplitButtonId) {
        $record.ownerSplitButtonId = $OwnerSplitButtonId
    }

    if ($localName -eq 'RibbonSplitButton') {
        $behavior = Get-AttributeValue $XmlNode 'Behavior'
        $record.ui = [ordered]@{
            uid = $uid
            controlId = Get-AttributeValue $XmlNode 'Id'
            text = $text
            buttonStyle = Get-AttributeValue $XmlNode 'ButtonStyle'
            keyTip = Get-AttributeValue $XmlNode 'KeyTip'
            behavior = $behavior
            listStyle = Get-AttributeValue $XmlNode 'ListStyle'
            grouping = Get-AttributeValue $XmlNode 'Grouping'
            smallImage = Get-AttributeValue $XmlNode 'SmallImage'
            largeImage = Get-AttributeValue $XmlNode 'LargeImage'
            commandId = Get-AttributeValue $XmlNode 'CommandID'
            commandType = Get-AttributeValue $XmlNode 'CommandType'
        }
        $record.compositeMode = if ($behavior -like 'DropDown*') { 'dropdown_only' } else { 'split' }
        $record.defaultActionMode = if ($record.compositeMode -eq 'dropdown_only') { 'none' } elseif ($behavior -like '*Static*') { 'static_default' } else { 'last_or_default' }
        $record.semantics = [ordered]@{
            description = if (Get-ChildText $XmlNode 'Description') {
                Get-ChildText $XmlNode 'Description'
            }
            else {
                "Provides the available $displayName variants. Use its explicit menu trigger to choose a variant."
            }
            inputs = @()
            result = $null
            cancelActions = @('Escape')
            risk = 'unclassified'
        }
        Add-NodeRecord $record

        $primaryId = $null
        $primary = $null
        if ($record.compositeMode -eq 'split') {
            $primaryId = New-UniqueNodeId $nodeId 'primary-action'
            $primary = New-NodeRecord $primaryId 'primary_button' "$displayName primary action" $nodeId "$uid.primary" $Region
            $primary.ownerSplitButtonId = $nodeId
            $primary.part = 'primary'
            $primary.semantics = [ordered]@{
                description = "Executes the current or default $displayName variant without opening the menu."
                inputs = @()
                result = $null
                cancelActions = @('Escape')
                risk = 'unclassified'
            }
            Add-NodeRecord $primary
        }

        $triggerId = New-UniqueNodeId $nodeId 'menu-trigger'
        $trigger = New-NodeRecord $triggerId 'menu_trigger' "Open $displayName menu" $nodeId "$uid.menu-trigger" $Region
        $trigger.ownerSplitButtonId = $nodeId
        $trigger.part = 'dropdown'
        $trigger.semantics = [ordered]@{
            description = "Opens the $displayName menu without executing its primary action."
            inputs = @()
            result = "The $displayName popup menu becomes visible."
            cancelActions = @('Escape')
            risk = 'low'
        }
        Add-NodeRecord $trigger

        $menuId = New-UniqueNodeId $triggerId 'popup-menu'
        $menu = New-NodeRecord $menuId 'popup_menu' "$displayName menu" $triggerId "$uid.popup-menu" 'transient'
        $menu.ownerSplitButtonId = $nodeId
        $menu.transient = $true
        $menu.semantics = [ordered]@{
            description = "Contains the selectable $displayName variants owned by this split button."
            inputs = @()
            result = $null
            cancelActions = @('Escape')
            risk = 'low'
        }
        Add-NodeRecord $menu

        $record.primaryActionNodeId = $primaryId
        $record.menuTriggerNodeId = $triggerId
        $trigger.opensNodeId = $menuId
        $menu.openedByNodeId = $triggerId

        $firstCommandId = $null
        foreach ($child in $XmlNode.ChildNodes) {
            if ($child.LocalName -in @('ModifiedRev', 'Revision', 'Name', 'Alias', 'TooltipTitle', 'Description')) { continue }
            $beforeCount = $script:Nodes.Count
            Add-GenericElement $child $menuId 'transient' $nodeId
            if (-not $firstCommandId -and $script:Nodes.Count -gt $beforeCount) {
                $candidate = $script:Nodes.Values | Where-Object { $_.parentId -eq $menuId -and $_.kind -eq 'command_button' } | Select-Object -First 1
                if ($candidate) { $firstCommandId = $candidate.id }
            }
        }
        $record.defaultTargetNodeId = $firstCommandId
        if ($primary) {
            $primary.defaultTargetNodeId = $firstCommandId
            $primary.action = [ordered]@{
                type = 'invoke_split_default'
                targetMode = $record.defaultActionMode
                defaultTargetNodeId = $firstCommandId
            }
        }
        $trigger.action = [ordered]@{
            type = 'open_menu'
            opensNodeId = $menuId
        }
        return
    }

    if ($localName -in @('RibbonCommandButton', 'RibbonButton', 'RibbonToggleButton', 'DialogBoxLauncher')) {
        $menuMacroId = Get-AttributeValue $XmlNode 'MenuMacroID'
        if (-not $menuMacroId -and (Get-AttributeValue $XmlNode 'CommandType') -eq 'Macro') {
            $menuMacroId = Get-AttributeValue $XmlNode 'CommandID'
        }
        Add-CommandMetadata $record $XmlNode $menuMacroId
    }
    else {
        $record.ui = [ordered]@{
            uid = $uid
            controlId = Get-AttributeValue $XmlNode 'Id'
            text = $text
            keyTip = Get-AttributeValue $XmlNode 'KeyTip'
        }

        if ($kind -in @('combo_box', 'data_bound_dropdown')) {
            $record.semantics = [ordered]@{
                description = "Opens or changes the $displayName selection."
                inputs = @('selected option')
                result = "The $displayName setting changes to the selected option."
                cancelActions = @('Escape')
                risk = 'unclassified'
            }
        }
        elseif ($kind -eq 'gallery') {
            $record.semantics = [ordered]@{
                description = "Displays the $displayName gallery and lets the user choose one of its runtime items."
                inputs = @('gallery item')
                result = "The selected $displayName item is applied or opened."
                cancelActions = @('Escape')
                risk = 'unclassified'
            }
        }
        elseif ($kind -eq 'ribbon_control') {
            $record.semantics = [ordered]@{
                description = "Provides the AutoCAD Ribbon control named $displayName."
                inputs = @()
                result = $null
                cancelActions = @('Escape')
                risk = 'unclassified'
            }
        }
    }

    Add-NodeRecord $record
    foreach ($child in $XmlNode.ChildNodes) {
        Add-GenericElement $child $nodeId $Region $OwnerSplitButtonId
    }
}

if (-not (Test-Path -LiteralPath $Cuix)) {
    throw "CUIX file was not found: $Cuix"
}

$cuixPaths = @($Cuix) + @($AdditionalCuix)
$resolvedCuixPaths = [System.Collections.ArrayList]::new()
$sourceDocuments = [System.Collections.ArrayList]::new()
foreach ($candidatePath in $cuixPaths) {
    if ([string]::IsNullOrWhiteSpace($candidatePath) -or -not (Test-Path -LiteralPath $candidatePath)) { continue }
    $resolvedPath = (Resolve-Path -LiteralPath $candidatePath).Path
    if ($resolvedCuixPaths -contains $resolvedPath) { continue }
    [void]$resolvedCuixPaths.Add($resolvedPath)
    $archive = [System.IO.Compression.ZipFile]::OpenRead($resolvedPath)
    try {
        [xml]$sourceRibbonXml = Read-ZipText $archive 'RibbonRoot.cui'
        $menuEntry = $archive.GetEntry('MenuGroup.cui')
        if ($menuEntry) {
            $menuReader = [System.IO.StreamReader]::new($menuEntry.Open())
            try { [xml]$sourceMenuXml = $menuReader.ReadToEnd() }
            finally { $menuReader.Dispose() }
        }
        else {
            [xml]$sourceMenuXml = '<MenuGroup />'
        }
        [void]$sourceDocuments.Add([ordered]@{
            path = $resolvedPath
            ribbon = $sourceRibbonXml
            menu = $sourceMenuXml
        })
    }
    catch {
        if ($resolvedPath -eq (Resolve-Path -LiteralPath $Cuix).Path) { throw }
    }
    finally {
        $archive.Dispose()
    }
}

if ($sourceDocuments.Count -eq 0) {
    throw 'No readable CUIX sources were found.'
}

$script:Macros = [ordered]@{}
foreach ($sourceDocument in $sourceDocuments) {
foreach ($menuMacro in $sourceDocument.menu.SelectNodes("//*[local-name()='MenuMacro']")) {
    $menuMacroId = Get-AttributeValue $menuMacro 'UID'
    $macro = $menuMacro.SelectSingleNode("./*[local-name()='Macro']")
    if (-not $menuMacroId -or -not $macro) { continue }
    $smallImageNode = $macro.SelectSingleNode("./*[local-name()='SmallImage']")
    $largeImageNode = $macro.SelectSingleNode("./*[local-name()='LargeImage']")
    $script:Macros[$menuMacroId] = [ordered]@{
        id = $menuMacroId
        type = Get-AttributeValue $macro 'type'
        name = Get-ChildText $macro 'Name'
        command = Get-ChildText $macro 'Command'
        cliCommand = Get-ChildText $macro 'CLICommand'
        description = Get-ChildText $macro 'HelpString'
        smallImage = Get-AttributeValue $smallImageNode 'Name'
        largeImage = Get-AttributeValue $largeImageNode 'Name'
        cuixFile = [System.IO.Path]::GetFileName($sourceDocument.path)
    }
}
}

$baseSource = $null
$tab = $null
foreach ($sourceDocument in $sourceDocuments) {
    $candidateTab = $sourceDocument.ribbon.SelectSingleNode("//*[local-name()='RibbonTabSource' and @UID='$TabUid']")
    if ($candidateTab) {
        $baseSource = $sourceDocument
        $tab = $candidateTab
        break
    }
}
if (-not $tab) {
    throw "Ribbon tab was not found: $TabUid"
}
$tabText = Get-AttributeValue $tab 'Text'
$tabAliases = @($tab.SelectNodes("./*[local-name()='Alias']") | ForEach-Object { $_.InnerText.Trim().ToUpperInvariant() })
$tabSources = [System.Collections.ArrayList]::new()
[void]$tabSources.Add([ordered]@{ tab = $tab; path = $baseSource.path })
foreach ($sourceDocument in $sourceDocuments) {
    foreach ($candidateTab in $sourceDocument.ribbon.SelectNodes("//*[local-name()='RibbonTabSource']")) {
        if ($candidateTab -eq $tab) { continue }
        $candidateText = Get-AttributeValue $candidateTab 'Text'
        $candidateBehavior = Get-AttributeValue $candidateTab 'WorkspaceBehavior'
        $candidateAliases = @($candidateTab.SelectNodes("./*[local-name()='Alias']") | ForEach-Object { $_.InnerText.Trim().ToUpperInvariant() })
        $aliasMatch = @($candidateAliases | Where-Object { $tabAliases -contains $_ }).Count -gt 0
        # Autodesk partial CUIX files use either WorkspaceBehavior=MergeTabOnly
        # or a shared Alias to contribute panels to a tab owned by another CUIX.
        # AppManager.cuix, for example, contributes to Add-ins via ID_ADDINSTAB
        # without declaring MergeTabOnly.
        if ($aliasMatch -or ($candidateBehavior -eq 'MergeTabOnly' -and $candidateText -eq $tabText)) {
            [void]$tabSources.Add([ordered]@{ tab = $candidateTab; path = $sourceDocument.path })
        }
    }
}

$panelDefinitions = [ordered]@{}
foreach ($sourceDocument in $sourceDocuments) {
foreach ($panel in $sourceDocument.ribbon.SelectNodes("//*[local-name()='RibbonPanelSource']")) {
    $panelUid = Get-AttributeValue $panel 'UID'
    if ($panelUid) { $panelDefinitions[$panelUid] = [ordered]@{ node = $panel; path = $sourceDocument.path } }
}
}

$script:Nodes = [ordered]@{}
$script:NodeSequence = 0

$rootId = 'autocad'
$root = New-NodeRecord $rootId 'application' 'Autodesk AutoCAD' $null 'autocad' 'application'
Add-NodeRecord $root

$windowId = "$rootId.window.main"
$window = New-NodeRecord $windowId 'window' 'AutoCAD drawing window' $rootId 'main-window' 'window'
Add-NodeRecord $window

$ribbonId = "$windowId.ribbon"
$ribbon = New-NodeRecord $ribbonId 'ribbon' 'Ribbon' $windowId 'Ribbon' 'ribbon'
Add-NodeRecord $ribbon

$tabId = "$ribbonId.tab.$(Convert-ToStablePart $TabUid)"
$tabRecord = New-NodeRecord $tabId 'tab' $tabText $ribbonId $TabUid 'tab'
$tabRecord.ui = [ordered]@{
    uid = $TabUid
    text = $tabText
    keyTip = Get-AttributeValue $tab 'KeyTip'
    alias = Get-ChildText $tab 'Alias'
    officialName = Get-ChildText $tab 'Name'
}
Add-NodeRecord $tabRecord

$addedPanels = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
foreach ($tabSource in $tabSources) {
foreach ($reference in $tabSource.tab.ChildNodes) {
    if ($reference.LocalName -ne 'RibbonPanelSourceReference') { continue }
    $panelUid = Get-AttributeValue $reference 'PanelId'
    if (-not $panelDefinitions.Contains($panelUid) -or -not $addedPanels.Add($panelUid)) { continue }
    $panelDefinition = $panelDefinitions[$panelUid]
    $panelXml = $panelDefinition.node
    $panelText = Get-AttributeValue $panelXml 'Text'
    $panelId = New-UniqueNodeId $tabId $panelUid
    $panelRecord = New-NodeRecord $panelId 'panel' $panelText $tabId $panelUid 'panel'
    $panelRecord.ui = [ordered]@{
        uid = $panelUid
        text = $panelText
        keyTip = Get-AttributeValue $panelXml 'KeyTip'
        alias = Get-ChildText $panelXml 'Alias'
        officialName = Get-ChildText $panelXml 'Name'
        resizeStyle = Get-AttributeValue $reference 'ResizeStyle'
        sourceCuix = [System.IO.Path]::GetFileName($panelDefinition.path)
    }
    Add-NodeRecord $panelRecord

    $region = 'main'
    foreach ($child in $panelXml.ChildNodes) {
        if ($child.LocalName -eq 'RibbonPanelBreak') {
            Add-GenericElement $child $panelId $region $null
            $region = 'slideout'
            continue
        }
        Add-GenericElement $child $panelId $region $null
    }
}
}

$liveValidation = [ordered]@{
    liveWindow = 'Autodesk AutoCAD 2027 drawing window'
    liveAccessibilityChecked = $false
    liveInteractionSamples = @()
    notes = @('Generated from the installed Autodesk CUIX. Live UI observations must be merged before controls are marked interaction-tested.')
}

if (-not [string]::IsNullOrWhiteSpace($LiveEvidence)) {
    if (-not (Test-Path -LiteralPath $LiveEvidence)) {
        throw "Live evidence file was not found: $LiveEvidence"
    }

    $evidence = Get-Content -Raw -LiteralPath $LiveEvidence | ConvertFrom-Json -AsHashtable
    $liveValidation = [ordered]@{
        liveWindow = $evidence.liveWindow
        liveAccessibilityChecked = [bool]$evidence.liveAccessibilityChecked
        observedAt = $evidence.observedAt
        viewport = $evidence.viewport
        observedControlCount = $evidence.observedControlCount
        observedControlIds = @($evidence.observedControlIds)
        liveInteractionSamples = @($evidence.liveInteractionSamples)
        notes = @($evidence.notes)
        evidenceFile = [System.IO.Path]::GetFileName($LiveEvidence)
    }

    $observedIds = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($observedId in @($evidence.observedControlIds)) {
        if (-not [string]::IsNullOrWhiteSpace($observedId)) { [void]$observedIds.Add($observedId) }
    }

    foreach ($node in $script:Nodes.Values) {
        $candidateIds = @($node.source.uid, $node.ui.uid, $node.ui.controlId, $node.ui.menuMacroId) |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
        if (@($candidateIds | Where-Object { $observedIds.Contains($_) }).Count -gt 0) {
            $node.verification.liveObserved = $true
            $node.verification.confidence = [Math]::Max([double]$node.verification.confidence, 0.95)
            $node.verification.evidence = @($node.verification.evidence + 'live_accessibility_tree') | Select-Object -Unique
        }
    }

    foreach ($sample in @($evidence.liveInteractionSamples)) {
        $sampleId = $sample.controlId
        if ([string]::IsNullOrWhiteSpace($sampleId)) { continue }
        foreach ($node in $script:Nodes.Values) {
            $candidateIds = @($node.source.uid, $node.ui.uid, $node.ui.controlId, $node.ui.menuMacroId) |
                Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
            if (@($candidateIds | Where-Object { $_ -eq $sampleId }).Count -eq 0) { continue }
            $node.verification.liveObserved = $true
            $node.verification.interactionTested = $true
            $node.verification.confidence = 1.0
            $node.verification.evidence = @($node.verification.evidence + "live_interaction:$($sample.action)") | Select-Object -Unique
        }
    }
}

$evidenceFileName = if (-not [string]::IsNullOrWhiteSpace($LiveEvidence)) {
    [System.IO.Path]::GetFileName($LiveEvidence)
}
else {
    $null
}
$tabValidationReference = [ordered]@{
    liveWindow = $liveValidation.liveWindow
    liveAccessibilityChecked = [bool]$liveValidation.liveAccessibilityChecked
    observedAt = $liveValidation.observedAt
    observedControlCount = [int]$liveValidation.observedControlCount
    evidence = $evidenceFileName
}
$panelValidationReference = [ordered]@{
    liveWindow = $liveValidation.liveWindow
    liveAccessibilityChecked = [bool]$liveValidation.liveAccessibilityChecked
    observedAt = $liveValidation.observedAt
    observedControlCount = [int]$liveValidation.observedControlCount
    evidence = if ($evidenceFileName) { "../../$evidenceFileName" } else { $null }
}

$result = [ordered]@{
    schemaVersion = '1.0'
    mapId = "autocad-$AutoCadVersion-$((Convert-ToStablePart $Workspace))-$((Convert-ToStablePart $Language))-$((Convert-ToStablePart $TabUid))"
    generatedAt = [DateTime]::UtcNow.ToString('o')
    application = [ordered]@{
        name = 'Autodesk AutoCAD'
        version = $AutoCadVersion
        language = $Language
        workspace = $Workspace
        platform = 'Windows'
        cuixFiles = @($resolvedCuixPaths | ForEach-Object { [System.IO.Path]::GetFileName($_) })
    }
    scope = [ordered]@{
        tabUid = $TabUid
        tabName = $tabText
        completenessPolicy = 'Every actionable Ribbon control, icon-only control, split-button part, menu item, separator, and layout container from the selected installed CUIX tab is retained.'
        locationModel = 'Resolve controls by application/window/ribbon/tab/panel ancestry, stable control IDs, region, and sibling order. Pixel coordinates and transient popup bounds must be detected from the current screenshot rather than hard-coded.'
    }
    rootNodeId = $rootId
    nodes = $script:Nodes
    validation = $tabValidationReference
}

$outputDirectory = Split-Path -Parent $Output
if ($outputDirectory) {
    New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
}

$panelMapCount = 0
$panelIndexEntries = [System.Collections.ArrayList]::new()
if ($SplitPanels) {
    $panelsRoot = Join-Path $outputDirectory 'panels'
    New-Item -ItemType Directory -Force -Path $panelsRoot | Out-Null
    $usedPanelSlugs = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

    foreach ($panel in @($script:Nodes.Values | Where-Object { $_.kind -eq 'panel' })) {
        $panelSlug = Convert-ToStablePart $panel.name
        if (-not $usedPanelSlugs.Add($panelSlug)) {
            $panelSlug = "$panelSlug-$((Convert-ToStablePart $panel.source.uid))"
            [void]$usedPanelSlugs.Add($panelSlug)
        }

        $includedNodeIds = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
        foreach ($ancestorId in @($rootId, $windowId, $ribbonId, $tabId)) { [void]$includedNodeIds.Add($ancestorId) }
        $pendingNodeIds = [System.Collections.Generic.Stack[string]]::new()
        $pendingNodeIds.Push($panel.id)
        while ($pendingNodeIds.Count -gt 0) {
            $currentNodeId = $pendingNodeIds.Pop()
            if (-not $includedNodeIds.Add($currentNodeId)) { continue }
            foreach ($childId in @($script:Nodes[$currentNodeId].children)) { $pendingNodeIds.Push($childId) }
        }

        $panelNodes = [ordered]@{}
        foreach ($nodeEntry in $script:Nodes.GetEnumerator()) {
            if (-not $includedNodeIds.Contains([string]$nodeEntry.Key)) { continue }
            $nodeCopy = $nodeEntry.Value | ConvertTo-Json -Depth 100 | ConvertFrom-Json -AsHashtable
            $nodeCopy.children = @($nodeCopy.children | Where-Object { $includedNodeIds.Contains([string]$_) })
            $panelNodes[$nodeEntry.Key] = $nodeCopy
        }

        $panelMap = [ordered]@{
            schemaVersion = $result.schemaVersion
            mapId = "$($result.mapId)-panel-$panelSlug"
            generatedAt = $result.generatedAt
            application = $result.application
            scope = [ordered]@{
                tabUid = $TabUid
                tabName = $tabText
                panelUid = $panel.source.uid
                panelName = $panel.name
                completenessPolicy = 'This file contains the selected panel, every descendant control and popup item, plus the application/window/ribbon/tab ancestors needed to retain a valid hierarchy.'
                locationModel = $result.scope.locationModel
            }
            rootNodeId = $rootId
            focusNodeId = $panel.id
            nodes = $panelNodes
            validation = $panelValidationReference
        }

        $panelDirectory = Join-Path $panelsRoot $panelSlug
        New-Item -ItemType Directory -Force -Path $panelDirectory | Out-Null
        $panelMapPath = Join-Path $panelDirectory 'ui-map.json'
        [System.IO.File]::WriteAllText($panelMapPath, ($panelMap | ConvertTo-Json -Depth 100), [System.Text.UTF8Encoding]::new($false))

        $panelActionableCount = @($panelNodes.Values | Where-Object { $_.kind -in @('command_button', 'toggle_button', 'primary_button', 'menu_trigger', 'combo_box', 'gallery', 'data_bound_dropdown', 'ribbon_control', 'dialog_launcher') }).Count
        [void]$panelIndexEntries.Add([ordered]@{
            name = $panel.name
            uid = $panel.source.uid
            nodeId = $panel.id
            map = "$panelSlug/ui-map.json"
            nodes = $panelNodes.Count
            actionableControls = $panelActionableCount
        })
        $panelMapCount += 1
    }

    $panelsIndex = [ordered]@{
        schemaVersion = '1.0'
        tabUid = $TabUid
        tabName = $tabText
        panelCount = $panelIndexEntries.Count
        panels = $panelIndexEntries
    }
    [System.IO.File]::WriteAllText((Join-Path $panelsRoot 'index.json'), ($panelsIndex | ConvertTo-Json -Depth 20), [System.Text.UTF8Encoding]::new($false))
}

$nodeCount = $script:Nodes.Count
$panelCount = @($script:Nodes.Values | Where-Object { $_.kind -eq 'panel' }).Count
$actionableCount = @($script:Nodes.Values | Where-Object { $_.kind -in @('command_button', 'toggle_button', 'primary_button', 'menu_trigger', 'combo_box', 'gallery', 'data_bound_dropdown', 'ribbon_control', 'dialog_launcher') }).Count
$iconOnlyCount = @($script:Nodes.Values | Where-Object { $_.icon -and $_.icon.iconOnly }).Count
$splitCount = @($script:Nodes.Values | Where-Object { $_.kind -eq 'split_button' }).Count

$outputResult = $result
if ($CompactTabMap -and $SplitPanels) {
    $manifestNodeIds = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($manifestNodeId in @($rootId, $windowId, $ribbonId, $tabId)) { [void]$manifestNodeIds.Add($manifestNodeId) }

    $manifestNodes = [ordered]@{}
    foreach ($nodeEntry in $script:Nodes.GetEnumerator()) {
        if (-not $manifestNodeIds.Contains([string]$nodeEntry.Key)) { continue }
        $nodeCopy = $nodeEntry.Value | ConvertTo-Json -Depth 100 | ConvertFrom-Json -AsHashtable
        $nodeCopy.children = @($nodeCopy.children | Where-Object { $manifestNodeIds.Contains([string]$_) })
        $manifestNodes[$nodeEntry.Key] = $nodeCopy
    }

    $outputResult = [ordered]@{
        schemaVersion = $result.schemaVersion
        mapType = 'tab_manifest'
        mapId = $result.mapId
        generatedAt = $result.generatedAt
        application = $result.application
        scope = $result.scope
        rootNodeId = $rootId
        focusNodeId = $tabId
        nodes = $manifestNodes
        fragments = [ordered]@{
            kind = 'panel_maps'
            index = 'panels/index.json'
            count = $panelMapCount
            panels = @($panelIndexEntries)
        }
        summary = [ordered]@{
            nodes = $nodeCount
            panels = $panelCount
            actionableControls = $actionableCount
            splitButtons = $splitCount
            iconOnlyControls = $iconOnlyCount
        }
        validation = $result.validation
    }
}

$json = $outputResult | ConvertTo-Json -Depth 100
[System.IO.File]::WriteAllText($Output, $json, [System.Text.UTF8Encoding]::new($false))

[ordered]@{
    output = (Resolve-Path -LiteralPath $Output).Path
    tab = $tabText
    nodes = $nodeCount
    panels = $panelCount
    actionableControls = $actionableCount
    splitButtons = $splitCount
    iconOnlyControls = $iconOnlyCount
    panelMaps = $panelMapCount
} | ConvertTo-Json
