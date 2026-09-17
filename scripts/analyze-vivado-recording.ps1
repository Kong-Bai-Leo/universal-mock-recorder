param(
    [Parameter(Mandatory = $true)][string]$Recording,
    [string]$Config,
    [switch]$PrepareOnly,
    [switch]$Analyze,
    [switch]$RetryFailed,
    [string]$CompileSavedRun,
    [string]$ResumeSavedRun
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
if ($Analyze -and $PrepareOnly) { throw 'Choose PrepareOnly or Analyze, not both.' }
if ($CompileSavedRun -and ($Analyze -or $PrepareOnly -or $RetryFailed -or $ResumeSavedRun)) { throw 'CompileSavedRun is offline; do not combine it with upload, prepare or retry options.' }
if ($ResumeSavedRun -and (-not $Analyze -or -not $RetryFailed)) { throw 'ResumeSavedRun requires Analyze and RetryFailed.' }
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $Config) { $Config = Join-Path $projectRoot 'config.json' }
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$bundledNode = Join-Path $projectRoot 'runtime\node.exe'
$userRuntime = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$nodeExe = if (Test-Path -LiteralPath $bundledNode) { $bundledNode } elseif ($nodeCommand) { $nodeCommand.Source } elseif (Test-Path -LiteralPath $userRuntime) { $userRuntime } else { throw 'Node.js 20+ is required for analysis. Recording still works without it.' }
$analysisArgs = @((Join-Path $projectRoot 'src\analyzer\vivado-cli.mjs'), '--recording', $Recording, '--config', $Config)
if ($CompileSavedRun) { $analysisArgs += @('--compile-saved-run', $CompileSavedRun) }
elseif ($Analyze) { $analysisArgs += '--analyze' } else { $analysisArgs += '--prepare-only' }
if ($RetryFailed) { $analysisArgs += '--retry-failed' }
if ($ResumeSavedRun) { $analysisArgs += @('--resume-saved-run', $ResumeSavedRun) }
& $nodeExe @analysisArgs
exit $LASTEXITCODE
