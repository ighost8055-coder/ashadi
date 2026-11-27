# start-chrome.ps1 — start the AUTOMATION Chrome with the debug port open.
#
# This is a separate Chrome profile from your everyday browsing, because Chrome 136+
# refuses to open the debug port on the default profile folder. Run setup-profile.ps1
# first — it copies your ChatGPT and Instagram logins across so you don't re-sign-in.
#
# Your normal Chrome can stay open the whole time; the two never fight.
param(
  [int]$Port    = 9222,
  [string]$Profile = "$env:LOCALAPPDATA\Google\Chrome\Automation Profile"
)

$exe = "C:\Program Files\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $exe)) { $exe = "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe" }

try {
  if ((Invoke-WebRequest "http://127.0.0.1:$Port/json/version" -TimeoutSec 2 -UseBasicParsing).StatusCode -eq 200) {
    Write-Host "Automation Chrome is already listening on port $Port." -ForegroundColor Green
    exit 0
  }
} catch {}

if (-not (Test-Path $Profile)) {
  Write-Host "The automation profile does not exist yet." -ForegroundColor Yellow
  Write-Host "Run this first:  powershell -File tools\ig2img\setup-profile.ps1" -ForegroundColor Cyan
  exit 1
}

Start-Process $exe -ArgumentList @(
  "--remote-debugging-port=$Port",
  "--user-data-dir=$Profile",
  "--profile-directory=Default"
)

for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  try {
    if ((Invoke-WebRequest "http://127.0.0.1:$Port/json/version" -TimeoutSec 2 -UseBasicParsing).StatusCode -eq 200) {
      Write-Host "Automation Chrome is up on port $Port." -ForegroundColor Green
      Write-Host "Confirm that window is signed in to chatgpt.com and instagram.com." -ForegroundColor Yellow
      exit 0
    }
  } catch {}
}

Write-Host "Chrome started but the debug port never opened." -ForegroundColor Red
Write-Host "Most common cause: --user-data-dir pointing at the DEFAULT Chrome folder, which Chrome 136+ blocks." -ForegroundColor DarkGray
exit 1
