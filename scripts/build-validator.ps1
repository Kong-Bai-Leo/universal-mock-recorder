$ErrorActionPreference = 'Stop'

$workspaceRoot = Split-Path -Parent $PSScriptRoot
$sourceDirectory = Join-Path $workspaceRoot 'src\Validator.Native'
$outputDirectory = Join-Path $workspaceRoot 'bin\validator'
$outputFile = Join-Path $outputDirectory 'ComputerUseValidator.exe'
$compiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'

if (-not (Test-Path -LiteralPath $compiler)) {
    throw 'Windows C# compiler was not found.'
}

$sourceFiles = Get-ChildItem -LiteralPath $sourceDirectory -Filter '*.cs' | Select-Object -ExpandProperty FullName
if ($sourceFiles.Count -eq 0) {
    throw 'Validator source files were not found.'
}

New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

& $compiler /nologo /target:winexe /optimize+ /platform:x64 `
    /out:$outputFile `
    /reference:System.dll `
    /reference:System.Core.dll `
    /reference:System.Drawing.dll `
    /reference:System.Windows.Forms.dll `
    $sourceFiles

if ($LASTEXITCODE -ne 0) {
    throw "Validator build failed with exit code: $LASTEXITCODE"
}

Write-Output "Validator built: $outputFile"
