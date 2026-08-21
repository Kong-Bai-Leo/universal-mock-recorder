param(
    [Parameter(Mandatory = $true)]
    [string]$Recording,

    [string]$Config = 'config.json',

    [string]$Output
)

$ErrorActionPreference = 'Stop'

$workspaceRoot = Split-Path -Parent $PSScriptRoot
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$userProfileDirectory = [Environment]::GetFolderPath('UserProfile')
$codexBundledNode = Join-Path $userProfileDirectory '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$nodeExecutable = if ($nodeCommand) {
    $nodeCommand.Source
} elseif (Test-Path -LiteralPath $codexBundledNode) {
    $codexBundledNode
} else {
    $null
}

if (-not $nodeExecutable -or -not (Test-Path -LiteralPath $nodeExecutable)) {
    throw 'Node.js was not found. Install Node.js 20 or later and try again.'
}

$arguments = @(
    (Join-Path $workspaceRoot 'src\analyzer\cli.mjs'),
    '--recording', $Recording,
    '--config', $Config
)

if ($Output) {
    $arguments += @('--output', $Output)
}

& $nodeExecutable @arguments
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
