param(
    [Parameter(Mandatory = $true)]
    [string]$Root
)

$ErrorActionPreference = 'Stop'

function Assert-Contextual {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

$resolvedRoot = (Resolve-Path -LiteralPath $Root).Path
$indexPath = Join-Path $resolvedRoot 'contextual-tabs\index.json'
Assert-Contextual (Test-Path -LiteralPath $indexPath) 'Contextual tab index is missing.'
$rawIndex = Get-Content -Raw -LiteralPath $indexPath
$index = $rawIndex | ConvertFrom-Json -AsHashtable

Assert-Contextual ([int]$index.totals.tabs -eq $index.tabs.Count) 'Contextual tab total is inconsistent.'
Assert-Contextual ($index.tabs.Count -ge 25) 'Too few stock contextual tabs were exported.'
Assert-Contextual (@($index.tabs | Where-Object { $_.uid -eq 'ID_CTS-TestBlock' }).Count -eq 0) 'Internal Test Block tab must be excluded.'
Assert-Contextual (@($index.tabs | Where-Object { $_.source -notin @('acad.CUIX', 'ModelDoc.cuix', 'dbcon.cuix') }).Count -eq 0) 'A non-core CUIX tab was included.'

foreach ($tab in $index.tabs) {
    $mapPath = Join-Path (Join-Path $resolvedRoot 'contextual-tabs') $tab.map
    Assert-Contextual (Test-Path -LiteralPath $mapPath) "Contextual tab map is missing: $($tab.uid)"
    Assert-Contextual (-not $tab.verification.contextTriggerTested) "Untested contextual tab was marked trigger-tested: $($tab.uid)"
}

Assert-Contextual ($rawIndex -notmatch 'C:\\Users\\') 'Contextual tab index contains an absolute user profile path.'

[ordered]@{
    result = 'pass'
    index = $indexPath
    tabs = $index.tabs.Count
    nodes = [int]$index.totals.nodes
    panels = [int]$index.totals.panels
    actionableControls = [int]$index.totals.actionableControls
    liveObserved = [int]$index.totals.liveObserved
    contextTriggerTested = [int]$index.totals.contextTriggerTested
} | ConvertTo-Json -Depth 4
