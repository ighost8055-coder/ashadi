# check-setup.ps1 - read-only health check for the new laptop. Changes nothing, prints no secret values.
#   powershell -ExecutionPolicy Bypass -File .\check-setup.ps1
# Every line is OK / WARN / FAIL with what to do. Run it after setup and any time something looks wrong.
param([string]$Root = $PSScriptRoot)
$ErrorActionPreference = 'Continue'
[System.Net.WebRequest]::DefaultWebProxy = New-Object System.Net.WebProxy
$script:fail = 0; $script:warn = 0
function Ok($m)   { Write-Host "  OK    $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  WARN  $m" -ForegroundColor Yellow; $script:warn++ }
function Bad($m)  { Write-Host "  FAIL  $m" -ForegroundColor Red; $script:fail++ }
function Head($m) { Write-Host "`n$m" -ForegroundColor Cyan }

Head "1. Software"
foreach ($t in @(@('node','Node.js 22+ (winget install OpenJS.NodeJS.LTS)'), @('python','Python 3.12+ (winget install Python.Python.3.12)'), @('ffmpeg','ffmpeg (winget install Gyan.FFmpeg)'))) {
  if (Get-Command $t[0] -ErrorAction SilentlyContinue) { Ok "$($t[0]) found" } else { Bad "$($t[0]) missing - $($t[1])" }
}
try { $v = (node --version) -replace 'v',''; if ([int]($v.Split('.')[0]) -ge 22) { Ok "node $v" } else { Warn "node $v is older than 22" } } catch {}
$chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ }
if ($chrome) { Ok "Google Chrome found" } else { Bad "Google Chrome not found" }
if (Get-Command claude -ErrorAction SilentlyContinue) { Ok "Claude CLI present (optional)" } else { Ok "Claude CLI not installed (optional)" }

Head "2. Folder layout"
foreach ($p in 'tools\ig2img\web\server.mjs','tools\ig2img\web\hub-worker.mjs','tools\ig2img\autostart.ps1','tools\ig2img\start-chrome.ps1','sithiji\worker_pc.py','run_sithiji_worker.bat','1-foundation\05-strategist-craft.md','tools\node_modules\playwright') {
  if (Test-Path (Join-Path $Root $p)) { Ok $p } else { Bad "$p missing (unzip the kit again / run npm install in tools)" }
}

Head "3. Keys (names only)"
$envFile = Join-Path $Root '.env'
$have = @{}
if (-not (Test-Path $envFile)) { Bad ".env missing - copy KEYS-private\Ashadi-Sithiji\.env here" }
else {
  foreach ($l in Get-Content $envFile) { if ($l -match '^\s*(?:var\s+|const\s+|let\s+|export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*;?\s*$') { if ($Matches[2].Trim("'",'"') -ne '') { $have[$Matches[1]] = $Matches[2].Trim("'",'"') } } }
  foreach ($k in 'CANVA_CLIENT_ID','CANVA_CLIENT_SECRET','TELEGRAM_BOT_TOKEN','SITHIJI_WORKER_KEY','SITHIJI_REMOTE_URL','ASHADI_HUB_URL','ASHADI_WORKER_KEY','OPENAI_API_KEY') {
    if ($have[$k]) { Ok $k } else { Bad "$k is missing or empty in .env" }
  }
  if ($have['ASHADI_HUB_URL'] -and $have['ASHADI_HUB_URL'] -notmatch '^https://') { Bad "ASHADI_HUB_URL must start with https://" }
  if ($have['ASHADI_WORKER_KEY'] -and $have['ASHADI_WORKER_KEY'].Length -lt 24) { Warn "ASHADI_WORKER_KEY looks too short" }
}

Head "4. Local engine"
try {
  $s = Invoke-RestMethod 'http://127.0.0.1:5041/api/status' -TimeoutSec 8
  Ok "engine answers on 127.0.0.1:5041"
  if ($s.chrome) { Ok "automation Chrome is up" } else { Warn "automation Chrome is not running (start-chrome.ps1 / autostart.ps1)" }
  if ($s.canva.connected) { Ok "Canva connected" } else { Warn "Canva not connected - click Connect Canva at http://127.0.0.1:5041 (new team active)" }
  if ($s.ai.aiMethod -eq 'gemini') { Ok "AI method: Non-CLI (Gemini)" } else { Warn "AI method is '$($s.ai.aiMethod)' - expected Non-CLI (Gemini)" }
  if ($s.bot.state -in 'ok','working') { Ok "Telegram bot: $($s.bot.state)" } else { Warn "Telegram bot state: $($s.bot.state)" }
} catch { Bad "engine is not answering on 127.0.0.1:5041 - run tools\ig2img\autostart.ps1" }

Head "5. Hub worker and the VPS"
$w = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match 'hub-worker' }
if ($w) { Ok "hub worker process running" } else { Bad "hub worker not running - run tools\ig2img\autostart.ps1 (needs ASHADI_HUB_URL + ASHADI_WORKER_KEY)" }
if ($have['ASHADI_HUB_URL']) {
  try {
    $h = Invoke-RestMethod ($have['ASHADI_HUB_URL'].TrimEnd('/') + '/healthz') -TimeoutSec 15
    Ok "hub reachable"
    if ($h.laptopOnline) { Ok "hub says: laptop online" } else { Warn "hub says: laptop OFFLINE - read tools\logs\hub-worker.log" }
    Ok "jobs waiting on the hub: $($h.queued)"
  } catch { Bad "hub not reachable at $($have['ASHADI_HUB_URL']) ($($_.Exception.Message))" }
}
$log = Join-Path $Root 'tools\logs\hub-worker.log'
if (Test-Path $log) { $last = Get-Content $log -Tail 3; Write-Host "  last worker log lines:"; $last | ForEach-Object { Write-Host "    $_" } }

Head "6. Sithiji worker, tasks, old copies"
$sw = Get-CimInstance Win32_Process -Filter "Name like 'python%'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match 'worker_pc' }
if ($sw) { Ok "Sithiji worker running" } else { Warn "Sithiji worker not running (run_sithiji_worker.bat / autostart.ps1)" }
foreach ($t in 'Kapruka-ig2img-autostart','Sithiji Worker') {
  $task = Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue
  if ($task) { if ($task.State -eq 'Disabled') { Warn "task '$t' is DISABLED" } else { Ok "task '$t' registered" } } else { Warn "task '$t' not registered (setup-new-project.ps1 -RegisterTasks, after the old PC is off)" }
}
$chromes = (Get-NetTCPConnection -State Listen -LocalPort 9222 -ErrorAction SilentlyContinue | Measure-Object).Count
if ($chromes) { Ok "debug port 9222 listening" } else { Warn "nothing on 9222 (automation Chrome not started)" }

Write-Host ""
if ($script:fail) { Write-Host "$($script:fail) FAIL, $($script:warn) WARN - fix the FAIL lines first." -ForegroundColor Red; exit 1 }
elseif ($script:warn) { Write-Host "No failures, $($script:warn) warning(s)." -ForegroundColor Yellow }
else { Write-Host "All checks passed." -ForegroundColor Green }
