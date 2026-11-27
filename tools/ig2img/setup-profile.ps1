# setup-profile.ps1 — build the automation Chrome profile, ONCE.
#
# Chrome 136+ refuses to open --remote-debugging-port when --user-data-dir points
# at the DEFAULT Chrome profile folder (a deliberate anti-cookie-theft measure).
# So the automation needs its own user-data-dir. This seeds that folder from one of
# your real profiles, so your ChatGPT and Instagram logins carry straight over and
# you don't have to sign in again.
#
#   powershell -File tools\ig2img\setup-profile.ps1                # seeds from Profile 5
#   powershell -File tools\ig2img\setup-profile.ps1 -Source "Profile 6"
#
# Re-run it any time the automation profile gets signed out.
param(
  [string]$Source = "Profile 5",
  [string]$Dest   = "$env:LOCALAPPDATA\Google\Chrome\Automation Profile"
)

$ud = "$env:LOCALAPPDATA\Google\Chrome\User Data"
$src = Join-Path $ud $Source
if (-not (Test-Path $src)) { Write-Host "No such profile: $src" -ForegroundColor Red; exit 1 }

# Cookie/state files are locked while Chrome runs, and a half-flushed copy loses the session.
$running = Get-Process chrome -ErrorAction SilentlyContinue
if ($running) {
  Write-Host "Chrome must be closed to copy the session files cleanly." -ForegroundColor Yellow
  $a = Read-Host "Close Chrome now? (y/N)"
  if ($a -ne 'y') { Write-Host "Aborted."; exit 1 }
  $running | Stop-Process -Force
  Start-Sleep -Seconds 5
}

$destDefault = Join-Path $Dest "Default"
New-Item -ItemType Directory -Force -Path $destDefault | Out-Null

# Local State holds the DPAPI-wrapped key that decrypts the cookies. Same Windows
# user, so it still decrypts in the new folder — but WITHOUT it, every cookie is junk.
Copy-Item (Join-Path $ud "Local State") (Join-Path $Dest "Local State") -Force -ErrorAction SilentlyContinue

$files = @(
  "Preferences", "Secure Preferences", "Login Data", "Web Data",
  "Network\Cookies", "Network\Network Persistent State", "Network\Trust Tokens"
)
$dirs = @("Local Storage", "Session Storage", "IndexedDB")

foreach ($f in $files) {
  $s = Join-Path $src $f
  if (Test-Path $s) {
    $d = Join-Path $destDefault $f
    New-Item -ItemType Directory -Force -Path (Split-Path $d) | Out-Null
    Copy-Item $s $d -Force -ErrorAction SilentlyContinue
    Write-Host "  copied $f"
  }
}
foreach ($dir in $dirs) {
  $s = Join-Path $src $dir
  if (Test-Path $s) {
    Copy-Item $s (Join-Path $destDefault $dir) -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "  copied $dir\"
  }
}

Write-Host ""
Write-Host "Automation profile ready:" -ForegroundColor Green
Write-Host "  $Dest"
Write-Host ""
Write-Host "Next:  powershell -File tools\ig2img\start-chrome.ps1" -ForegroundColor Cyan
Write-Host "Then confirm that window is signed in to chatgpt.com and instagram.com."
Write-Host "This profile is separate from your everyday Chrome, so from now on the two never fight." -ForegroundColor DarkGray
