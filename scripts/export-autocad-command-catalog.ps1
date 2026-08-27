param(
    [Parameter(Mandatory = $true)]
    [string]$SupportDirectory,

    [Parameter(Mandatory = $true)]
    [string]$Output,

    [string]$UiMapRoot,

    [switch]$RefreshOfficial,

    [string]$AutoCadVersion = '2027',

    [string]$Language = 'en-US'
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.IO.Compression.FileSystem

function Read-ZipText {
    param(
        [System.IO.Compression.ZipArchive]$Archive,
        [string]$EntryName
    )

    $entry = $Archive.GetEntry($EntryName)
    if (-not $entry) { return $null }
    $reader = [System.IO.StreamReader]::new($entry.Open())
    try { return $reader.ReadToEnd() }
    finally { $reader.Dispose() }
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

function Convert-ToCommandName {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) { return $null }
    $candidate = $Value.Trim()
    if ($candidate -match '^([^\s(]+)') { $candidate = $matches[1] }
    $candidate = $candidate -replace '^[_.]+', ''
    if ($candidate -notmatch '^-?[A-Za-z0-9_+]+$') { return $null }
    return $candidate.ToUpperInvariant()
}

function Convert-ToIdPart {
    param([string]$Value)

    $part = $Value.ToLowerInvariant() -replace '^-', 'dash-'
    $part = $part -replace '^\+', 'plus-'
    $part = $part -replace '[^a-z0-9]+', '-'
    return $part.Trim('-')
}

function Get-PgpSection {
    param(
        [int]$LineNumber,
        [int]$AlternativeStart,
        [int]$LegacyStart,
        [int]$UserStart
    )

    if ($LineNumber -ge $UserStart) { return 'user_defined' }
    if ($LineNumber -ge $LegacyStart) { return 'legacy_compatibility' }
    if ($LineNumber -ge $AlternativeStart) { return 'alternative' }
    return 'default'
}

function Get-OfficialCommandIndex {
    param(
        [string]$CachePath,
        [switch]$Refresh,
        [string]$Version,
        [string]$Locale
    )

    if ((-not $Refresh) -and (Test-Path -LiteralPath $CachePath)) {
        return Get-Content -Raw -LiteralPath $CachePath | ConvertFrom-Json -AsHashtable
    }

    $apiLanguage = if ($Locale -eq 'en-US') { 'ENU' } else { $Locale }
    $endpoint = 'https://beehive.autodesk.com/community/service/rest/cloudhelp/resource/cloudhelpchannel/search/'
    # The visible A-Z page requests one letter at a time and does not expose
    # commands whose canonical names begin with '-' or '+'. The same official
    # endpoint can return the complete command subtype by excluding a guaranteed
    # nonexistent term. This retains prompt-only commands such as -ARRAY and
    # -LAYER while still letting us filter Express Tools by their official title.
    $queryTerm = '-CODEXNONEXISTENTAUTOCADCOMMANDTERM'
    $start = 0
    $allItems = [System.Collections.ArrayList]::new()
    do {
        $parameters = [ordered]@{
            origin = 'upi'
            source = 'all'
            p = 'ACD'
            v = $Version
            l = $apiLanguage
            sort = 'PublishDate desc,title_sort asc'
            q = $queryTerm
            maxresults = '150'
            start = if ($start -gt 0) { [string]$start } else { $null }
            subType = 'command'
        }
        $query = ($parameters.GetEnumerator() | Where-Object { $null -ne $_.Value } | ForEach-Object {
            [uri]::EscapeDataString($_.Key) + '=' + [uri]::EscapeDataString($_.Value)
        }) -join '&'
        $response = Invoke-RestMethod -Uri ($endpoint + '?' + $query)
        foreach ($item in @($response.entries.item)) { [void]$allItems.Add($item) }
        $total = [int]$response.totalResult
        $start += 150
    } while ($start -lt $total)

    $commandsByName = [ordered]@{}
    $excludedExpressTools = [System.Collections.ArrayList]::new()
    foreach ($item in @($allItems)) {
            $title = [string]$item.title
            if ($title -match '^(.+?)\s+\(Express Tool\)$') {
                [void]$excludedExpressTools.Add([ordered]@{
                    name = $matches[1].Trim().ToUpperInvariant()
                    title = $title
                    description = [string]$item.shortDescription
                    url = [string]$item.url
                    topicId = [string]$item.topicId
                })
                continue
            }
            if ($title -notmatch '^(.+?)\s+\(Command\)$') { continue }
            $name = $matches[1].Trim().ToUpperInvariant()
            if ($commandsByName.Contains($name)) { continue }
            $commandsByName[$name] = [ordered]@{
                name = $name
                title = $title
                description = [string]$item.shortDescription
                url = [string]$item.url
                topicId = [string]$item.topicId
                caasKey = [string]$item.caasKey
                publishDate = [string]$item.publishDate
            }
    }

    $index = [ordered]@{
        schemaVersion = '1.0'
        application = [ordered]@{
            name = 'Autodesk AutoCAD'
            version = $Version
            language = $Locale
        }
        retrievedAt = (Get-Date).ToUniversalTime().ToString('o')
        source = [ordered]@{
            type = 'autodesk_official_help_az_command_index'
            page = "https://help.autodesk.com/view/ACD/$Version/ENU/?page=commands&q=*"
            endpoint = $endpoint
            queryStrategy = 'all command-subtype records, including leading-hyphen and leading-plus commands'
        }
        totals = [ordered]@{
            commands = $commandsByName.Count
            excludedExpressTools = @($excludedExpressTools).Count
        }
        commands = @($commandsByName.Values | Sort-Object name)
        excluded = [ordered]@{
            expressTools = @($excludedExpressTools | Sort-Object name -Unique)
        }
    }

    $cacheDirectory = Split-Path -Parent $CachePath
    if (-not (Test-Path -LiteralPath $cacheDirectory)) {
        New-Item -ItemType Directory -Path $cacheDirectory -Force | Out-Null
    }
    $index | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $CachePath -Encoding utf8
    return $index
}

$resolvedSupport = (Resolve-Path -LiteralPath $SupportDirectory).Path
$pgpPath = Join-Path $resolvedSupport 'acad.pgp'
$synonymPath = Join-Path $resolvedSupport 'acadSynonymsGlobalDB.pgp'
$weightPath = Join-Path $resolvedSupport 'AcCommandWeight.xml'
foreach ($requiredPath in @($pgpPath, $synonymPath, $weightPath)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) {
        throw "Required AutoCAD support file was not found: $requiredPath"
    }
}

$outputPath = [System.IO.Path]::GetFullPath($Output)
$outputDirectory = Split-Path -Parent $outputPath
if (-not (Test-Path -LiteralPath $outputDirectory)) {
    New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
}
$officialCachePath = Join-Path $outputDirectory 'official-command-index.json'
$officialIndex = Get-OfficialCommandIndex -CachePath $officialCachePath -Refresh:$RefreshOfficial -Version $AutoCadVersion -Locale $Language

$officialByName = [ordered]@{}
foreach ($entry in @($officialIndex.commands)) {
    $officialByName[[string]$entry.name] = $entry
}

$pgpLines = Get-Content -LiteralPath $pgpPath
$alternativeStart = 447
$legacyStart = 467
$userStart = 552
for ($index = 0; $index -lt $pgpLines.Count; $index += 1) {
    $line = $pgpLines[$index]
    if ($line -match '^;\s*The following are alternative aliases') { $alternativeStart = $index + 1 }
    if ($line -match '^;\s*Aliases for Hyperlink/URL') { $legacyStart = $index + 1 }
    if ($line -match '^;\s*-- User Defined Command Aliases --') { $userStart = $index + 1 }
}

$aliasOccurrences = [System.Collections.ArrayList]::new()
for ($index = 0; $index -lt $pgpLines.Count; $index += 1) {
    $line = $pgpLines[$index]
    if ($line -notmatch '^\s*([^;\s][^,]*?)\s*,\s*\*([^\s;]+)') { continue }
    $alias = $matches[1].Trim().ToUpperInvariant()
    $command = Convert-ToCommandName $matches[2]
    if (-not $command) { continue }
    $lineNumber = $index + 1
    [void]$aliasOccurrences.Add([ordered]@{
        value = $alias
        command = $command
        source = 'active_acad_pgp'
        section = Get-PgpSection $lineNumber $alternativeStart $legacyStart $userStart
        line = $lineNumber
        effective = $false
        preferred = $false
        scriptSafe = $false
    })
}

$effectiveOccurrenceByAlias = [ordered]@{}
foreach ($occurrence in $aliasOccurrences) { $effectiveOccurrenceByAlias[$occurrence.value] = $occurrence }
foreach ($occurrence in $aliasOccurrences) {
    if ([object]::ReferenceEquals($occurrence, $effectiveOccurrenceByAlias[$occurrence.value])) {
        $occurrence.effective = $true
        $occurrence.preferred = $occurrence.section -in @('default', 'user_defined')
    }
}

$synonyms = [System.Collections.ArrayList]::new()
$synonymLines = Get-Content -LiteralPath $synonymPath
for ($index = 0; $index -lt $synonymLines.Count; $index += 1) {
    $line = $synonymLines[$index]
    if ($line -notmatch '^\s*([^;\s][^,]*?)\s*,\s*\*([^\s;]+)') { continue }
    $command = Convert-ToCommandName $matches[2]
    if (-not $command) { continue }
    [void]$synonyms.Add([ordered]@{
        value = $matches[1].Trim().ToUpperInvariant()
        command = $command
        source = 'acad_synonyms_global_db'
        line = $index + 1
        recognitionOnly = $true
        scriptSafe = $false
    })
}

[xml]$weightDocument = Get-Content -Raw -LiteralPath $weightPath
$installedVocabulary = @($weightDocument.SelectNodes("//*[local-name()='Command']") | ForEach-Object {
    (Get-AttributeValue $_ 'Name').ToUpperInvariant()
} | Sort-Object -Unique)
$installedVocabularySet = [System.Collections.Generic.HashSet[string]]::new([string[]]$installedVocabulary, [System.StringComparer]::OrdinalIgnoreCase)

$includedCuixNames = @('acad.CUIX', 'ModelDoc.cuix', 'dbcon.cuix', 'custom.cuix')
$excludedCuixNames = @('acetmain.cuix', 'AecArchxOE.cuix', 'AppManager.cuix', 'FeaturedApps.cuix')
$cuixMacroLinks = [ordered]@{}
foreach ($cuixName in $includedCuixNames) {
    $cuixPath = Join-Path $resolvedSupport $cuixName
    if (-not (Test-Path -LiteralPath $cuixPath)) { continue }
    $archive = [System.IO.Compression.ZipFile]::OpenRead($cuixPath)
    try {
        $menuText = Read-ZipText $archive 'MenuGroup.cui'
        if ([string]::IsNullOrWhiteSpace($menuText)) { continue }
        [xml]$menuDocument = $menuText
        foreach ($menuMacro in $menuDocument.SelectNodes("//*[local-name()='MenuMacro']")) {
            $macro = $menuMacro.SelectSingleNode("./*[local-name()='Macro']")
            if (-not $macro) { continue }
            $command = Convert-ToCommandName (Get-ChildText $macro 'CLICommand')
            if (-not $command -or -not $officialByName.Contains($command)) { continue }
            if (-not $cuixMacroLinks.Contains($command)) { $cuixMacroLinks[$command] = [System.Collections.ArrayList]::new() }
            $reference = [ordered]@{
                source = $cuixName
                menuMacroId = Get-AttributeValue $menuMacro 'UID'
                name = Get-ChildText $macro 'Name'
                cliCommand = Get-ChildText $macro 'CLICommand'
                macro = Get-ChildText $macro 'Command'
            }
            $referenceKey = "$($reference.source)|$($reference.menuMacroId)"
            $existingKeys = @($cuixMacroLinks[$command] | ForEach-Object { "$($_.source)|$($_.menuMacroId)" })
            if ($existingKeys -notcontains $referenceKey) { [void]$cuixMacroLinks[$command].Add($reference) }
        }
    }
    finally { $archive.Dispose() }
}

$uiNodeLinks = [ordered]@{}
if (-not [string]::IsNullOrWhiteSpace($UiMapRoot) -and (Test-Path -LiteralPath $UiMapRoot)) {
    $resolvedUiRoot = (Resolve-Path -LiteralPath $UiMapRoot).Path
    foreach ($mapFile in Get-ChildItem -LiteralPath $resolvedUiRoot -Recurse -Filter 'ui-map.json' -File) {
        $relativePath = [System.IO.Path]::GetRelativePath($resolvedUiRoot, $mapFile.FullName).Replace('\', '/')
        $topLevelFolder = $relativePath.Split('/')[0]
        if ($topLevelFolder -in @('express-tools', 'featured-apps', 'add-ins')) { continue }
        $map = Get-Content -Raw -LiteralPath $mapFile.FullName | ConvertFrom-Json -AsHashtable
        if (-not $map.nodes) { continue }
        foreach ($node in $map.nodes.Values) {
            $rawCommand = [string]$node.action.cliCommand
            if ([string]::IsNullOrWhiteSpace($rawCommand)) { $rawCommand = [string]$node.action.command }
            $command = Convert-ToCommandName $rawCommand
            if (-not $command -or -not $officialByName.Contains($command)) { continue }
            if (-not $uiNodeLinks.Contains($command)) { $uiNodeLinks[$command] = [System.Collections.ArrayList]::new() }
            $reference = [ordered]@{
                map = $relativePath
                nodeId = [string]$node.id
                name = [string]$node.name
                kind = [string]$node.kind
                menuMacroId = [string]$node.ui.menuMacroId
            }
            $referenceKey = "$($reference.map)|$($reference.nodeId)"
            $existingKeys = @($uiNodeLinks[$command] | ForEach-Object { "$($_.map)|$($_.nodeId)" })
            if ($existingKeys -notcontains $referenceKey) { [void]$uiNodeLinks[$command].Add($reference) }
        }
    }
}

$aliasesByCommand = [ordered]@{}
foreach ($occurrence in $aliasOccurrences) {
    if (-not $aliasesByCommand.Contains($occurrence.command)) { $aliasesByCommand[$occurrence.command] = [System.Collections.ArrayList]::new() }
    [void]$aliasesByCommand[$occurrence.command].Add($occurrence)
}
$synonymsByCommand = [ordered]@{}
foreach ($synonym in $synonyms) {
    if (-not $synonymsByCommand.Contains($synonym.command)) { $synonymsByCommand[$synonym.command] = [System.Collections.ArrayList]::new() }
    [void]$synonymsByCommand[$synonym.command].Add($synonym)
}

$allCommandNames = @(
    @($officialByName.Keys)
    @($aliasesByCommand.Keys)
    @($synonymsByCommand.Keys)
) | Sort-Object -Unique

$commands = [ordered]@{}
$scriptCommandOverrides = @{
    'ARRAYPOLAR' = '-ARRAY'
    'ARRAYRECT' = '-ARRAY'
    'ARRAYPATH' = '-ARRAY'
}
foreach ($commandName in $allCommandNames) {
    $official = if ($officialByName.Contains($commandName)) { $officialByName[$commandName] } else { $null }
    $isOfficialCore = $null -ne $official
    $globalCommand = "_.$commandName"
    $commandLineVariantName = if ($scriptCommandOverrides.ContainsKey($commandName)) {
        $scriptCommandOverrides[$commandName]
    } elseif (-not $commandName.StartsWith('-') -and $officialByName.Contains("-$commandName")) {
        "-$commandName"
    } else { $null }
    $scriptCommandName = if ($commandLineVariantName) { $commandLineVariantName } else { $commandName }
    $scriptCommand = if ($isOfficialCore) { "_.$scriptCommandName" } else { $null }
    $commandAliases = [System.Collections.ArrayList]::new()
    if ($aliasesByCommand.Contains($commandName)) {
        foreach ($item in $aliasesByCommand[$commandName]) { [void]$commandAliases.Add($item) }
    }
    $commandSynonyms = [System.Collections.ArrayList]::new()
    if ($synonymsByCommand.Contains($commandName)) {
        foreach ($item in $synonymsByCommand[$commandName]) { [void]$commandSynonyms.Add($item) }
    }
    $commandUiRefs = [System.Collections.ArrayList]::new()
    if ($uiNodeLinks.Contains($commandName)) {
        foreach ($item in $uiNodeLinks[$commandName]) { [void]$commandUiRefs.Add($item) }
    }
    $commandCuixRefs = [System.Collections.ArrayList]::new()
    if ($cuixMacroLinks.Contains($commandName)) {
        foreach ($item in $cuixMacroLinks[$commandName]) { [void]$commandCuixRefs.Add($item) }
    }
    $commands[$commandName] = [ordered]@{
        id = "autocad.command.$(Convert-ToIdPart $commandName)"
        canonicalName = $commandName
        classification = if ($isOfficialCore) { 'core_stock_command' } else { 'legacy_or_search_recognition_term' }
        includedInCore = $isOfficialCore
        globalCommand = $globalCommand
        scriptCommand = $scriptCommand
        scriptCommandCanonicalName = if ($isOfficialCore) { $scriptCommandName } else { $null }
        scriptSafety = [ordered]@{
            useFullEnglishName = $true
            prefix = '_.'
            aliasAllowed = $false
            recognitionAliasesOnly = $true
            promptBased = $scriptCommandName.StartsWith('-')
            selectedCommandLineVariant = $isOfficialCore -and ($scriptCommandName -ne $commandName)
        }
        description = if ($official) { [string]$official.description } else { $null }
        aliases = $commandAliases
        recognitionSynonyms = $commandSynonyms
        sourcePresence = [ordered]@{
            officialHelp = $isOfficialCore
            activePgp = $aliasesByCommand.Contains($commandName)
            installedSearchVocabulary = $installedVocabularySet.Contains($commandName)
            coreCuix = $cuixMacroLinks.Contains($commandName)
            uiMap = $uiNodeLinks.Contains($commandName)
        }
        uiNodeRefs = $commandUiRefs
        cuixMacroRefs = $commandCuixRefs
        related = [ordered]@{
            dialogCommand = if ($commandName.StartsWith('-') -and $officialByName.Contains($commandName.Substring(1))) { $commandName.Substring(1) } else { $null }
            commandLineVariant = $commandLineVariantName
        }
        documentation = if ($official) {
            [ordered]@{
                source = 'autodesk_official_help'
                url = [string]$official.url
                topicId = [string]$official.topicId
                publishDate = [string]$official.publishDate
            }
        } else { $null }
        verification = [ordered]@{
            tier = if ($official) { 'official_help_index' } else { 'installed_recognition_source_only' }
            liveObserved = $false
            interactionTested = $false
        }
    }
}

$aliasIndex = [ordered]@{}
foreach ($alias in $effectiveOccurrenceByAlias.Keys | Sort-Object) {
    $occurrence = $effectiveOccurrenceByAlias[$alias]
    $aliasIndex[$alias] = [ordered]@{
        command = $occurrence.command
        section = $occurrence.section
        preferred = $occurrence.preferred
        scriptSafe = $false
    }
}

$synonymIndex = [ordered]@{}
foreach ($synonym in $synonyms | Sort-Object value) {
    if (-not $synonymIndex.Contains($synonym.value)) { $synonymIndex[$synonym.value] = $synonym.command }
}

$catalog = [ordered]@{
    schemaVersion = '1.0'
    application = [ordered]@{
        name = 'Autodesk AutoCAD'
        version = $AutoCadVersion
        language = $Language
        platform = 'Windows'
    }
    generatedAt = (Get-Date).ToUniversalTime().ToString('o')
    scope = [ordered]@{
        included = @('AutoCAD core commands documented in Autodesk AutoCAD 2027 Help', 'active acad.pgp aliases', 'global command synonyms', 'core acad/ModelDoc/dbcon CUIX links')
        excluded = @('Express Tools', 'third-party plug-ins', 'Featured Apps/App Store', 'industry toolsets and object-enabler commands')
        defaultForAgent = 'core_stock_only'
    }
    executionPolicy = [ordered]@{
        aliasesAreForRecognitionOnly = $true
        aliasesAreScriptSafe = $false
        preferredScriptForm = 'Use the global English full command name: _.COMMAND. For prompt-only variants use _.-COMMAND.'
        neverInferScriptCommandFromAlias = $true
    }
    sources = [ordered]@{
        officialHelp = [ordered]@{
            commandsIndex = "https://help.autodesk.com/view/ACD/$AutoCadVersion/ENU/?page=commands&q=*"
            aliasGuidance = 'https://help.autodesk.com/view/ACD/2027/ENU/?caas=caas%2Fdocumentation%2FACD%2F2014%2FENU%2Ffiles%2FGUID-FE9AE544-F537-4D3B-8F75-B76484513787-htm.html'
            localCache = 'official-command-index.json'
        }
        installed = [ordered]@{
            aliasFile = 'acad.pgp'
            synonymFile = 'acadSynonymsGlobalDB.pgp'
            searchVocabularyFile = 'AcCommandWeight.xml'
            includedCuix = $includedCuixNames
            excludedCuix = $excludedCuixNames
        }
    }
    totals = [ordered]@{
        officialCoreCommands = @($commands.Values | Where-Object { $_.includedInCore }).Count
        recognitionOnlyCommands = @($commands.Values | Where-Object { -not $_.includedInCore }).Count
        effectiveAliases = $aliasIndex.Count
        aliasOccurrences = $aliasOccurrences.Count
        recognitionSynonyms = $synonymIndex.Count
        commandsLinkedToCoreCuix = @($commands.Values | Where-Object { $_.sourcePresence.coreCuix }).Count
        commandsLinkedToUiMap = @($commands.Values | Where-Object { $_.sourcePresence.uiMap }).Count
        excludedExpressToolHelpEntries = [int]$officialIndex.totals.excludedExpressTools
    }
    aliasIndex = $aliasIndex
    synonymIndex = $synonymIndex
    commands = $commands
}

$catalog | ConvertTo-Json -Depth 16 | Set-Content -LiteralPath $outputPath -Encoding utf8

[ordered]@{
    result = 'generated'
    output = $outputPath
    officialCache = $officialCachePath
    totals = $catalog.totals
} | ConvertTo-Json -Depth 6
