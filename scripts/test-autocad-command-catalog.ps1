param(
    [Parameter(Mandatory = $true)]
    [string]$CatalogPath
)

$ErrorActionPreference = 'Stop'

function Assert-Catalog {
    param(
        [bool]$Condition,
        [string]$Message
    )

    if (-not $Condition) { throw $Message }
}

$resolvedCatalog = (Resolve-Path -LiteralPath $CatalogPath).Path
$rawCatalog = Get-Content -Raw -LiteralPath $resolvedCatalog
$catalog = $rawCatalog | ConvertFrom-Json -AsHashtable

Assert-Catalog ($catalog.schemaVersion -eq '1.0') 'Unexpected command catalog schema version.'
Assert-Catalog ($catalog.scope.defaultForAgent -eq 'core_stock_only') 'The agent default scope must be core stock only.'
Assert-Catalog ($catalog.executionPolicy.aliasesAreScriptSafe -eq $false) 'Aliases must never be marked script-safe.'
Assert-Catalog ($catalog.sources.installed.excludedCuix -contains 'acetmain.cuix') 'Express Tools CUIX must be excluded.'
Assert-Catalog ($catalog.sources.installed.excludedCuix -contains 'AecArchxOE.cuix') 'Industry object-enabler CUIX must be excluded.'
Assert-Catalog ($catalog.aliasIndex.L.command -eq 'LINE') 'The active L alias must resolve to LINE.'
Assert-Catalog ($catalog.aliasIndex.C.command -eq 'CIRCLE') 'The active C alias must resolve to CIRCLE.'
Assert-Catalog ($catalog.aliasIndex.Z.command -eq 'ZOOM') 'The active Z alias must resolve to ZOOM.'
Assert-Catalog ($catalog.aliasIndex.L.scriptSafe -eq $false) 'The L alias must be recognition-only for scripts.'

foreach ($requiredCommand in @('LINE', 'CIRCLE', 'ARRAY', '-ARRAY', 'ARRAYPOLAR', 'ARRAYRECT', 'ARRAYPATH', 'LAYER', '-LAYER', 'ZOOM')) {
    Assert-Catalog ($catalog.commands.Contains($requiredCommand)) "Required command is missing: $requiredCommand"
    Assert-Catalog ($catalog.commands[$requiredCommand].includedInCore) "Required command is not core stock: $requiredCommand"
}

Assert-Catalog ($catalog.commands.LINE.scriptCommand -eq '_.LINE') 'LINE must keep its direct script command.'
Assert-Catalog ($catalog.commands.CIRCLE.scriptCommand -eq '_.CIRCLE') 'CIRCLE must keep its direct script command.'
Assert-Catalog ($catalog.commands.ARRAY.scriptCommand -eq '_.-ARRAY') 'ARRAY must prefer its prompt-based command-line variant in scripts.'
Assert-Catalog ($catalog.commands['-ARRAY'].scriptCommand -eq '_.-ARRAY') '-ARRAY must keep its prompt-based script command.'
Assert-Catalog ($catalog.commands.ARRAYPOLAR.scriptCommand -eq '_.-ARRAY') 'ARRAYPOLAR must use the stable prompt-based ARRAY command in scripts.'
Assert-Catalog ($catalog.commands.ARRAYRECT.scriptCommand -eq '_.-ARRAY') 'ARRAYRECT must use the stable prompt-based ARRAY command in scripts.'
Assert-Catalog ($catalog.commands.ARRAYPATH.scriptCommand -eq '_.-ARRAY') 'ARRAYPATH must use the stable prompt-based ARRAY command in scripts.'
Assert-Catalog ($catalog.commands.LAYER.scriptCommand -eq '_.-LAYER') 'LAYER must prefer its prompt-based command-line variant in scripts.'
Assert-Catalog ($catalog.commands['-LAYER'].scriptCommand -eq '_.-LAYER') '-LAYER must keep its prompt-based script command.'
Assert-Catalog ($catalog.commands.ZOOM.scriptCommand -eq '_.ZOOM') 'ZOOM must keep its direct script command.'
Assert-Catalog ($catalog.commands.LAYER.scriptCommandCanonicalName -eq '-LAYER') 'LAYER must expose the selected script command name.'
Assert-Catalog ($catalog.commands.LAYER.scriptSafety.selectedCommandLineVariant) 'LAYER must record that its command-line variant was selected.'
Assert-Catalog ($catalog.commands.LAYER.related.commandLineVariant -eq '-LAYER') 'LAYER must link to -LAYER.'
Assert-Catalog ($catalog.commands['-LAYER'].related.dialogCommand -eq 'LAYER') '-LAYER must link back to LAYER.'
Assert-Catalog ($catalog.commands['-ARRAY'].aliases -is [System.Collections.IList]) 'Command aliases must always serialize as an array.'
Assert-Catalog ($catalog.commands.LINE.recognitionSynonyms -is [System.Collections.IList]) 'Recognition synonyms must always serialize as an array.'
Assert-Catalog ($catalog.commands.LINE.uiNodeRefs -is [System.Collections.IList]) 'UI node references must always serialize as an array.'

$invalidCoreCommands = @($catalog.commands.Values | Where-Object {
    $_.includedInCore -and (
        [string]::IsNullOrWhiteSpace($_.description) -or
        [string]::IsNullOrWhiteSpace($_.documentation.url) -or
        $_.scriptCommand -notmatch '^_\.-?[A-Z0-9_+]+$'
    )
})
Assert-Catalog ($invalidCoreCommands.Count -eq 0) 'One or more core commands lack official documentation or a safe full script form.'

$unsafeAliases = @($catalog.aliasIndex.Values | Where-Object { $_.scriptSafe })
Assert-Catalog ($unsafeAliases.Count -eq 0) 'One or more aliases are incorrectly marked script-safe.'
Assert-Catalog ($rawCatalog -notmatch 'C:\\Users\\') 'The generated command catalog contains an absolute user profile path.'
Assert-Catalog ([int]$catalog.totals.officialCoreCommands -eq @($catalog.commands.Values | Where-Object { $_.includedInCore }).Count) 'Core command total is inconsistent.'
Assert-Catalog ([int]$catalog.totals.effectiveAliases -eq $catalog.aliasIndex.Count) 'Alias total is inconsistent.'

[ordered]@{
    result = 'pass'
    catalog = $resolvedCatalog
    officialCoreCommands = [int]$catalog.totals.officialCoreCommands
    recognitionOnlyCommands = [int]$catalog.totals.recognitionOnlyCommands
    effectiveAliases = [int]$catalog.totals.effectiveAliases
    recognitionSynonyms = [int]$catalog.totals.recognitionSynonyms
    commandsLinkedToCoreCuix = [int]$catalog.totals.commandsLinkedToCoreCuix
    commandsLinkedToUiMap = [int]$catalog.totals.commandsLinkedToUiMap
} | ConvertTo-Json -Depth 4
