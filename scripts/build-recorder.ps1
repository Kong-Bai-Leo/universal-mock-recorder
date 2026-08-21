$ErrorActionPreference = 'Stop'

$workspaceRoot = Split-Path -Parent $PSScriptRoot
$sourceFile = Join-Path $workspaceRoot 'src\Recorder.Native\Recorder.cs'
$outputDirectory = Join-Path $workspaceRoot 'bin\recorder'
$outputFile = Join-Path $outputDirectory 'UniversalMockRecorder.exe'
$compiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$uiAutomationClient = 'C:\Windows\Microsoft.NET\assembly\GAC_MSIL\UIAutomationClient\v4.0_4.0.0.0__31bf3856ad364e35\UIAutomationClient.dll'
$uiAutomationTypes = 'C:\Windows\Microsoft.NET\assembly\GAC_MSIL\UIAutomationTypes\v4.0_4.0.0.0__31bf3856ad364e35\UIAutomationTypes.dll'
$windowsBase = 'C:\Windows\Microsoft.NET\assembly\GAC_MSIL\WindowsBase\v4.0_4.0.0.0__31bf3856ad364e35\WindowsBase.dll'

if (-not (Test-Path -LiteralPath $compiler)) {
    throw 'Windows C# compiler was not found. Install the .NET SDK and try again.'
}

New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

& $compiler /nologo /target:winexe /optimize+ /platform:x64 `
    /out:$outputFile `
    /reference:System.dll `
    /reference:System.Core.dll `
    /reference:System.Drawing.dll `
    /reference:System.Windows.Forms.dll `
    /reference:System.Runtime.Serialization.dll `
    /reference:$uiAutomationClient `
    /reference:$uiAutomationTypes `
    /reference:$windowsBase `
    $sourceFile

if ($LASTEXITCODE -ne 0) {
    throw "Recorder build failed with exit code: $LASTEXITCODE"
}

Write-Output "Recorder built: $outputFile"
