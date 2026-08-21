$ErrorActionPreference = 'Stop'

$workspaceRoot = Split-Path -Parent $PSScriptRoot
$validatorPath = Join-Path $workspaceRoot 'bin\validator\ComputerUseValidator.exe'

if (-not (Test-Path -LiteralPath $validatorPath)) {
    & (Join-Path $PSScriptRoot 'build-validator.ps1')
}

$assembly = [Reflection.Assembly]::LoadFile($validatorPath)

$clientType = $assembly.GetType('ComputerUseValidator.OpenAIComputerClient', $true)
$client = [Activator]::CreateInstance($clientType, @('test-key', 'gpt-5.6'))
$parseMethod = $clientType.GetMethod('Parse', [Reflection.BindingFlags]'Instance,NonPublic')
$sampleResponse = '{"id":"resp_test","output":[{"type":"computer_call","call_id":"call_test","actions":[{"type":"click","button":"left","x":10,"y":20},{"type":"drag","path":[{"x":1,"y":2},{"x":3,"y":4}]},{"type":"keypress","keys":["CTRL","Z"]}]}]}'
$parsed = $parseMethod.Invoke($client, @($sampleResponse))

if ($parsed.Id -ne 'resp_test' -or $parsed.Call.CallId -ne 'call_test' -or $parsed.Call.Actions.Count -ne 3) {
    throw 'Computer response parsing test failed.'
}

$buildStartRequest = $clientType.GetMethod('BuildStartRequest', [Reflection.BindingFlags]'Instance,NonPublic')
$startPayload = $buildStartRequest.Invoke($client, [object[]]@([string]'test task'))
if (-not ($startPayload['input'] -is [string]) -or $startPayload['input'] -ne 'test task') {
    throw 'Computer start request must contain text only and no image inputs.'
}

$retryMethod = $clientType.GetMethod('IsRetryable', [Reflection.BindingFlags]'Static,NonPublic')
$receiveFailure = New-Object Net.WebException('receive failed', [Net.WebExceptionStatus]::ReceiveFailure)
$retryArguments = [object[]]@($receiveFailure.PSObject.BaseObject)
$retryable = $retryMethod.Invoke($null, $retryArguments)
if (-not $retryable) {
    throw 'Receive failures must be retried.'
}

$temporaryDirectory = Join-Path ([IO.Path]::GetTempPath()) ('computer-use-validator-test-' + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($temporaryDirectory) | Out-Null
$imagePath = Join-Path $temporaryDirectory 'reference.png'
$markdownPath = Join-Path $temporaryDirectory 'task.md'
[IO.File]::WriteAllBytes($imagePath, [byte[]](1, 2, 3))
[IO.File]::WriteAllText($markdownPath, '参考：`reference.png`', [Text.Encoding]::UTF8)

try {
    $assetsType = $assembly.GetType('ComputerUseValidator.MarkdownAssets', $true)
    $findAssets = $assetsType.GetMethod('FindReferenceImages', [Reflection.BindingFlags]'Static,NonPublic')
    $assetArguments = [object[]]@([string]$markdownPath, [string]'参考：`reference.png`', [int]8)
    $assets = $findAssets.Invoke($null, $assetArguments)
    if ($assets.Count -ne 1 -or $assets[0] -ne $imagePath) {
        throw 'Markdown image discovery test failed.'
    }
}
finally {
    Remove-Item -LiteralPath $markdownPath -Force
    Remove-Item -LiteralPath $imagePath -Force
    Remove-Item -LiteralPath $temporaryDirectory -Force
}

$formType = $assembly.GetType('ComputerUseValidator.MainForm', $true)
$form = [Activator]::CreateInstance($formType, $true)
$form.Dispose()

Write-Output 'Validator response parser: passed'
Write-Output 'Validator initial Computer request uses text only: passed'
Write-Output 'Validator retries transient connection failures: passed'
Write-Output 'Validator Markdown assets: passed'
Write-Output 'Validator form construction: passed'
