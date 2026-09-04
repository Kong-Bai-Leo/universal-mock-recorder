$b = "C:\Users\aaron\orca\universal-mock-recorder\prototype\out\replica\l15"
$acad = "C:\Program Files\Autodesk\AutoCAD 2027\accoreconsole.exe"

$lines = @(
  "FILEDIA 0", "OSMODE 0",
  "_.RECTANG 0,0 140,100", "_.RECTANG 160,0 300,100", "_.RECTANG 320,0 460,100",
  "_.ZOOM _W -60,-60 520,160",
  "_.-HATCH _P _S 70,50 ", "_.-HATCH _P _S 230,50 ", "_.-HATCH _P _S 390,50 ",
  "_.ZOOM _E",
  "_.SAVEAS 2018 C:/Users/aaron/orca/universal-mock-recorder/prototype/out/replica/l15/l15.dwg",
  "_.DXFOUT C:/Users/aaron/orca/universal-mock-recorder/prototype/out/replica/l15/l15.dxf 16"
)
Set-Content "$b\l15.scr" ($lines -join "`r`n") -Encoding ascii

Get-Process accoreconsole -ErrorAction SilentlyContinue | Stop-Process -Force -Confirm:$false
foreach ($f in @("$b\l15.dwg", "$b\l15.dxf")) { if (Test-Path $f) { Remove-Item $f -Force } }

$p = Start-Process $acad -ArgumentList "/s", "`"$b\l15.scr`"" -RedirectStandardOutput "$b\log.txt" -PassThru -NoNewWindow
if (-not $p.WaitForExit(150000)) { $p.Kill(); Write-Output "TIMEOUT" }
Write-Output ("dwg: " + (Test-Path "$b\l15.dwg"))
$t = (Get-Content "$b\log.txt" -Raw) -replace [char]0, ''
($t -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -Last 8) -join "`n"
