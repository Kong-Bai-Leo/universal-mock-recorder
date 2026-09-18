$ErrorActionPreference = 'Stop'
$recorderRoot = Split-Path -Parent $PSScriptRoot
$recorderOutput = Join-Path $recorderRoot 'bin\stata-recorder'
$recorderCompiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$assemblyRoot = 'C:\Windows\Microsoft.NET\assembly\GAC_MSIL'
New-Item -ItemType Directory -Force -Path $recorderOutput | Out-Null
& $recorderCompiler /nologo /target:winexe /optimize+ /platform:x64 /define:STATA `
    ("/out:" + (Join-Path $recorderOutput 'StataRecorder.exe')) `
    /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll `
    /reference:System.Windows.Forms.dll /reference:System.Runtime.Serialization.dll `
    ("/reference:" + (Join-Path $assemblyRoot 'UIAutomationClient\v4.0_4.0.0.0__31bf3856ad364e35\UIAutomationClient.dll')) `
    ("/reference:" + (Join-Path $assemblyRoot 'UIAutomationTypes\v4.0_4.0.0.0__31bf3856ad364e35\UIAutomationTypes.dll')) `
    ("/reference:" + (Join-Path $assemblyRoot 'WindowsBase\v4.0_4.0.0.0__31bf3856ad364e35\WindowsBase.dll')) `
    (Join-Path $recorderRoot 'src\Recorder.Native\Recorder.cs') `
    (Join-Path $recorderRoot 'src\Recorder.Stata\StataRecorderForm.cs')
if ($LASTEXITCODE -ne 0) { throw 'STATA recorder build failed.' }
Write-Output (Join-Path $recorderOutput 'StataRecorder.exe')
