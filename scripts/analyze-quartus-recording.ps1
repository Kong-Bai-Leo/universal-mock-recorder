param(
    [Parameter(Mandatory = $true)][string]$Recording,
    [string]$Config,
    [string]$Output,
    [string]$ReprocessFrom,
    [switch]$PrepareOnly
)
$ErrorActionPreference = 'Stop'
$quartusWorkspace = Split-Path -Parent $PSScriptRoot
$quartusNodeCommand = Get-Command node -ErrorAction SilentlyContinue
$quartusPackagedNode = Join-Path $quartusWorkspace 'runtime\node.exe'
$quartusUserDirectory = [Environment]::GetFolderPath('UserProfile')
if (-not $quartusUserDirectory) { $quartusUserDirectory = $env:USERPROFILE }
$quartusCodexNode = if ($quartusUserDirectory) { Join-Path $quartusUserDirectory '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' } else { $null }
$quartusNodePath = if (Test-Path -LiteralPath $quartusPackagedNode) { $quartusPackagedNode } elseif ($quartusNodeCommand) { $quartusNodeCommand.Source } elseif ($quartusCodexNode -and (Test-Path -LiteralPath $quartusCodexNode)) { $quartusCodexNode } else { $null }
if (-not $quartusNodePath) { throw 'Analysis requires Node.js 20 or later. Recording does not require Node.js.' }
if (-not $Config) { $Config = Join-Path $quartusWorkspace 'config.json' }
if ($ReprocessFrom -and (-not $Output -or $PrepareOnly)) { throw 'Offline reprocessing requires a new -Output directory and cannot use -PrepareOnly.' }
if (-not $Output) { $Output = Join-Path $Recording 'generated' }
$quartusArguments = @((Join-Path $quartusWorkspace 'src\analyzer\quartus-cli.mjs'), '--recording', $Recording, '--output', $Output)
if ($PrepareOnly) { $quartusArguments += '--prepare-only' }
if ($ReprocessFrom) { $quartusArguments += @('--reprocess-from', $ReprocessFrom) }
if (Test-Path -LiteralPath $Config) { $quartusArguments += @('--config', (Resolve-Path -LiteralPath $Config).Path) }
elseif (-not $PrepareOnly -and -not $ReprocessFrom) { throw 'AI analysis requires config.json. Use -PrepareOnly for local preparation.' }
& $quartusNodePath @quartusArguments
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
