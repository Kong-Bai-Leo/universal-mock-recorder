# 复刻回放执行器: 清理旧产物 -> 跑 .scr(硬超时) -> 验证 DXF
# 用法: powershell -File run_lesson.ps1 <lessonNumber> [timeoutSeconds]
#
# 并发安全: 只杀自己启动的进程, 绝不 Stop-Process 全部 accoreconsole
#           (多 agent 并行时会互相打断)。
param(
  [Parameter(Mandatory = $true)][string]$N,
  [int]$TimeoutSec = 420
)

$acad = "C:\Program Files\Autodesk\AutoCAD 2027\accoreconsole.exe"
$b = "C:\Users\aaron\orca\universal-mock-recorder\prototype\out\replica\l$N"
$scr = "$b\l$N.scr"
if (-not (Test-Path $scr)) { Write-Output "missing $scr"; exit 1 }

# SAVEAS 遇到已存在文件会弹覆盖确认, 无头下会挂死 -> 先删
foreach ($f in @("$b\l$N.dwg", "$b\l$N.dxf")) { if (Test-Path $f) { Remove-Item $f -Force } }

$p = Start-Process $acad -ArgumentList "/s", "`"$scr`"" `
     -RedirectStandardOutput "$b\log.txt" -PassThru -NoNewWindow
if (-not $p.WaitForExit($TimeoutSec * 1000)) {
  try { $p.Kill() } catch {}
  Write-Output "TIMEOUT (killed pid $($p.Id))"
}

if (Test-Path "$b\l$N.dxf") {
  py -3.11 "C:\Users\aaron\orca\universal-mock-recorder\prototype\verify.py" "$b\l$N.dxf"
} else {
  Write-Output "FAILED - tail of log:"
  $t = (Get-Content "$b\log.txt" -Raw -ErrorAction SilentlyContinue) -replace [char]0, ''
  ($t -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -Last 14) -join "`n"
}
