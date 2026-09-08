param(
    [string]$Name = ('quartus-recorder-' + (Get-Date -Format 'yyyyMMdd-HHmmss')),
    [switch]$IncludeNode,
    [string]$NodePath,
    [string]$NodeLicensePath
)
$ErrorActionPreference = 'Stop'
if ($Name -notmatch '^quartus-recorder-[a-zA-Z0-9-]+$') { throw 'Invalid package name.' }
$quartusWorkspace = Split-Path -Parent $PSScriptRoot
$quartusPackage = Join-Path $quartusWorkspace ('dist\' + $Name)
$quartusZip = $quartusPackage + '.zip'
if ((Test-Path -LiteralPath $quartusPackage) -or (Test-Path -LiteralPath $quartusZip)) { throw 'Package already exists; choose another name.' }
& (Join-Path $PSScriptRoot 'build-quartus-recorder.ps1')
$quartusFiles = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($quartusFixedFile in @('bin/quartus-recorder/QuartusRecorder.exe', 'scripts/analyze-quartus-recording.ps1', 'scripts/optimize-screenshots.ps1', 'config.example.json', 'docs/quartus-recorder-status-2026-09-07.md')) { [void]$quartusFiles.Add($quartusFixedFile) }
# Only source-code modules reached from Quartus entry points are copied. No config.json,
# dotenv files, user recordings or screenshot folders are ever traversed.
$quartusPending = [Collections.Generic.Queue[string]]::new()
$quartusPending.Enqueue('src/analyzer/quartus-cli.mjs')
Get-ChildItem -LiteralPath (Join-Path $quartusWorkspace 'src/analyzer') -Filter 'quartus-*.mjs' -File | ForEach-Object { $quartusPending.Enqueue('src/analyzer/' + $_.Name) }
while ($quartusPending.Count -gt 0) {
    $quartusModule = $quartusPending.Dequeue()
    if (-not $quartusFiles.Add($quartusModule)) { continue }
    $quartusModulePath = Join-Path $quartusWorkspace $quartusModule
    $quartusModuleText = [IO.File]::ReadAllText($quartusModulePath)
    foreach ($quartusMatch in [regex]::Matches($quartusModuleText, '(?m)^\s*(?:import|export)\s+(?:[\w*{},\s]+?\s+from\s+)?[''"]([^''"]+)[''"]')) {
        $quartusImport = $quartusMatch.Groups[1].Value
        if ($quartusImport.StartsWith('node:')) { continue }
        if (-not $quartusImport.StartsWith('.')) { throw "Unsupported external dependency: $quartusImport" }
        $quartusDependency = [IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $quartusModulePath) $quartusImport))
        $quartusSourceRoot = [IO.Path]::GetFullPath((Join-Path $quartusWorkspace 'src/analyzer')) + [IO.Path]::DirectorySeparatorChar
        if (-not $quartusDependency.StartsWith($quartusSourceRoot, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetExtension($quartusDependency) -ne '.mjs') { throw "Dependency outside permitted source modules: $quartusImport" }
        $quartusPending.Enqueue($quartusDependency.Substring($quartusWorkspace.Length + 1).Replace('\','/'))
    }
}
$quartusMapRoot = 'ui-maps/quartus/26.1.1-pro/en-US'
$quartusIndex = Get-Content -Raw -LiteralPath (Join-Path $quartusWorkspace ($quartusMapRoot + '/ui-index.json')) | ConvertFrom-Json
foreach ($quartusMetadata in @('ui-index.json', 'sources.json', 'live-observation.json', 'verification-report.json', 'README.md')) { [void]$quartusFiles.Add($quartusMapRoot + '/' + $quartusMetadata) }
foreach ($quartusSection in $quartusIndex.sections) { [void]$quartusFiles.Add($quartusMapRoot + '/' + $quartusSection.map) }
foreach ($quartusFile in $quartusFiles) {
    $quartusSource = Join-Path $quartusWorkspace $quartusFile
    $quartusDestination = Join-Path $quartusPackage $quartusFile
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $quartusDestination) | Out-Null
    Copy-Item -LiteralPath $quartusSource -Destination $quartusDestination
}
Copy-Item -LiteralPath (Join-Path $quartusWorkspace 'src/Recorder.Quartus/README.md') -Destination (Join-Path $quartusPackage 'README.md')
if ($IncludeNode) {
    if (-not $NodePath) {
        $quartusNodeCommand = Get-Command node -ErrorAction SilentlyContinue
        $quartusUserDirectory = [Environment]::GetFolderPath('UserProfile')
        if (-not $quartusUserDirectory) { $quartusUserDirectory = $env:USERPROFILE }
        $NodePath = if ($quartusNodeCommand) { $quartusNodeCommand.Source } elseif ($quartusUserDirectory) { Join-Path $quartusUserDirectory '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' } else { $null }
    }
    if (-not $NodePath -or -not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw 'Node executable not found.' }
    New-Item -ItemType Directory -Force -Path (Join-Path $quartusPackage 'runtime') | Out-Null
    Copy-Item -LiteralPath $NodePath -Destination (Join-Path $quartusPackage 'runtime/node.exe')
    $quartusNodeVersion = & $NodePath --version
    if (-not $NodeLicensePath -and $quartusNodeVersion -eq 'v24.19.0') { $NodeLicensePath = Join-Path $quartusWorkspace 'src/Recorder.Quartus/node-v24.19.0-LICENSE.txt' }
    if (-not $NodeLicensePath) { $NodeLicensePath = Join-Path (Split-Path -Parent $NodePath) 'LICENSE' }
    if (-not (Test-Path -LiteralPath $NodeLicensePath -PathType Leaf)) { throw 'Provide -NodeLicensePath for the selected Node version.' }
    Copy-Item -LiteralPath $NodeLicensePath -Destination (Join-Path $quartusPackage 'runtime/LICENSE.txt')
}
$quartusHashes = Get-ChildItem -LiteralPath $quartusPackage -File -Recurse | ForEach-Object {
    [ordered]@{ file = $_.FullName.Substring($quartusPackage.Length + 1).Replace('\','/'); bytes = $_.Length; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
}
[IO.File]::WriteAllText((Join-Path $quartusPackage 'package-manifest.json'),
    (ConvertTo-Json -Depth 6 -InputObject ([ordered]@{ format='QuartusRecorderPackage'; createdAt=[DateTimeOffset]::UtcNow.ToString('o');
        evidence='UI map evidence metadata only; original images remain on the development machine. Runtime knowledge lookup does not require those images.';
        excludes=@('API keys', 'local config.json', '.env', 'recordings', 'live screenshots'); includesNode=[bool]$IncludeNode; files=@($quartusHashes) })), [Text.UTF8Encoding]::new($false))
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($quartusPackage, $quartusZip)
Write-Output "Package: $quartusPackage"
Write-Output "Archive: $quartusZip"
