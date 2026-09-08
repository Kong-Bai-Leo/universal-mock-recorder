param([switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$quartusTestRoot = Split-Path -Parent $PSScriptRoot
if (-not $SkipBuild) { & (Join-Path $PSScriptRoot 'build-quartus-recorder.ps1') }
$quartusAssembly = [Reflection.Assembly]::LoadFile((Join-Path $quartusTestRoot 'bin\quartus-recorder\QuartusRecorder.exe'))
$quartusProfile = $quartusAssembly.GetType('UniversalMockRecorder.RecorderProfile', $true)
$quartusMatcher = $quartusProfile.GetMethod('MatchesTargetProcess')
foreach ($quartusCase in @(@('quartus',$true), @('QUARTUS',$true), @('mstsc',$false), @('qsys-edit',$false), @('PscadFree',$false), @('quartus_sh',$false), @('java',$false))) {
    if ($quartusMatcher.Invoke($null, @($quartusCase[0])) -ne $quartusCase[1]) { throw "Process filter failed: $($quartusCase[0])" }
}
$quartusTestOutput = Join-Path $quartusTestRoot ('.equile-local\quartus-profile-test-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $quartusTestOutput -Force | Out-Null
$quartusEngineType = $quartusAssembly.GetType('UniversalMockRecorder.RecorderEngine', $true)
$quartusEngine = $quartusEngineType.GetConstructor(@([string], [bool])).Invoke(@([string]$quartusTestOutput, [bool]$true))
$quartusPrivate = [Reflection.BindingFlags]'Instance,NonPublic'
if ($quartusEngineType.GetField('_captureUiAutomationTargets', $quartusPrivate).GetValue($quartusEngine) -ne $false) { throw 'Quartus UIA must stay disabled even when a caller requests it.' }
$quartusEngineType.GetMethod('WriteManifest', $quartusPrivate).Invoke($quartusEngine, @()) | Out-Null
$quartusManifest = Get-Content -Raw -LiteralPath (Join-Path $quartusTestOutput 'manifest.json') | ConvertFrom-Json
if ($quartusManifest.applicationProfile -ne 'quartus' -or $quartusManifest.captureMode -ne 'visual-input' -or $quartusManifest.captureLocation -ne 'same-windows-session-as-quartus') { throw 'Wrong application capture manifest.' }
if ($quartusManifest.uiAutomationTargets -or $quartusManifest.softwareInternalApi -or $quartusManifest.passwordFieldProbe) { throw 'Capture must not query application APIs or UIA.' }
if ($quartusManifest.targetProcesses.Count -ne 1 -or $quartusManifest.targetProcesses[0] -ne 'quartus') { throw 'Unexpected target processes.' }
$quartusWindowType = $quartusEngineType.GetNestedType('WindowInfo', [Reflection.BindingFlags]::NonPublic)
if (-not $quartusWindowType.GetField('Handle')) { throw 'Quartus evidence must preserve the system window identity.' }
$quartusRawType = $quartusEngineType.GetNestedType('RawInputEvent', [Reflection.BindingFlags]::NonPublic)
$quartusRaw = [Activator]::CreateInstance($quartusRawType, $true)
$quartusRawType.GetField('EventType').SetValue($quartusRaw, 'key_down')
$quartusRawType.GetField('Key').SetValue($quartusRaw, 'A')
$quartusTransition = $quartusEngineType.GetMethod('ShouldCaptureKeyTransition', [Reflection.BindingFlags]'NonPublic,Static')
if (-not $quartusTransition.Invoke($null, @($quartusRaw))) { throw 'Typed field edits must retain screenshot evidence.' }
$quartusRawType.GetField('Key').SetValue($quartusRaw, 'REDACTED')
if ($quartusTransition.Invoke($null, @($quartusRaw))) { throw 'Redacted keys must not trigger screenshots.' }
$quartusEngine.Dispose()
Write-Output 'PASS: compiled Quartus process filter, manifest, forced visual-only capture and key evidence policy. No hooks, screenshots, user UI or network calls were used.'
