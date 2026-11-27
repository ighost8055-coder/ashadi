# autostart.ps1 — bring up the Telegram-only pipeline on login: automation Chrome
# (debug port + signed-in profile), then the Telegram bot. No tunnel, no webhook —
# Telegram long-polls its own updates.
#
# Wired to Task Scheduler so it fires automatically when this PC logs in, so a
# reboot (Windows Update, a crash) doesn't leave the bot silently dead until
# someone notices and restarts it by hand. Does NOT power the PC on by itself —
# if the machine is fully off, nothing runs until it's turned on.
param(
  [int]$ChromePort = 9222
)

# Invoke-WebRequest can hang for many minutes doing WPAD proxy auto-detection
# before it even attempts the request -- -TimeoutSec does not cover that phase.
# Since this task repeats every 5 min with "no new instance", a single stalled
# run causes every following trigger to be refused (Task Scheduler 0x800710E0).
# These are all localhost calls, so just skip proxy resolution entirely.
[System.Net.WebRequest]::DefaultWebProxy = New-Object System.Net.WebProxy

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = (Resolve-Path (Join-Path $here "..\..")).Path
$logDir = Join-Path $root "tools\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "autostart.log"
function Log($msg) {
  $line = "[$(Get-Date -Format o)] $msg"
  Write-Host $line
  Add-Content -Path $log -Value $line
}

Log "=== autostart ==="

# 1 - automation Chrome (debug port + the signed-in profile)
$chromeUp = $false
try { $chromeUp = (Invoke-WebRequest "http://127.0.0.1:$ChromePort/json/version" -TimeoutSec 2 -UseBasicParsing).StatusCode -eq 200 } catch {}
if ($chromeUp) {
  Log "Chrome already listening on :$ChromePort."
} else {
  Log "Starting automation Chrome ..."
  & (Join-Path $here "start-chrome.ps1") -Port $ChromePort
  # give the debug port a moment even if start-chrome.ps1's own wait already returned
  for ($i = 0; $i -lt 30; $i++) {
    try {
      if ((Invoke-WebRequest "http://127.0.0.1:$ChromePort/json/version" -TimeoutSec 2 -UseBasicParsing).StatusCode -eq 200) { break }
    } catch {}
    Start-Sleep -Seconds 1
  }
}

# 2 - Telegram bot
$tgUp = (Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
         Where-Object { $_.CommandLine -match 'telegram-bot' }) -ne $null
if ($tgUp) {
  Log "Telegram bot already running."
} else {
  Log "Starting Telegram bot ..."
  # quoted: the path contains spaces ("Claude Ads Team") — unquoted, Start-Process
  # splits it and node reports "Cannot find module".
  $tg = '"' + (Join-Path $here "telegram-bot.mjs") + '"'
  Start-Process node -ArgumentList $tg -WorkingDirectory $root -WindowStyle Minimized
}

# 3 - Ashadi web UI + job queue (http://127.0.0.1:5041). The Sithiji "Send to Ashadi" button
# lands here, so it must be up whenever the PC is. start-web.ps1 is idempotent.
try {
  $out = & (Join-Path $here "web\start-web.ps1") 2>&1 | Out-String
  Log ("Ashadi web: " + $out.Trim())
} catch { Log "Ashadi web start failed: $($_.Exception.Message)" }

# 4 - Sithiji PC worker: claims "Send to Ashadi" requests from the VPS and feeds them to step 3.
# Restarted here if it ever dies (its own logon task only fires once per login).
$sithijiBat = Join-Path $root "run_sithiji_worker.bat"   # moved: lives in the project root now
$workerUp = (Get-CimInstance Win32_Process -Filter "Name like 'python%'" -ErrorAction SilentlyContinue |
             Where-Object { $_.CommandLine -match 'worker_pc' }) -ne $null
if ($workerUp) {
  Log "Sithiji worker already running."
} elseif (Test-Path $sithijiBat) {
  Log "Starting Sithiji worker ..."
  Start-Process -FilePath $sithijiBat -WorkingDirectory (Split-Path $sithijiBat) -WindowStyle Hidden
} else {
  Log "Sithiji worker script not found: $sithijiBat"
}

# 5 - VPS hub worker (https://pricelens.lanka.info/ashadi): pulls jobs queued on the VPS page / Facebook tool, runs them in
# step 3's engine, and sends status + finished designs back. Only started when the .env says where the hub is.
$envText = ''
try { $envText = Get-Content (Join-Path $root ".env") -Raw -ErrorAction Stop } catch {}
if ($envText -match '(?m)^\s*ASHADI_HUB_URL\s*=\s*\S+' -and $envText -match '(?m)^\s*ASHADI_WORKER_KEY\s*=\s*\S+') {
  $hubUp = (Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -match 'hub-worker' }) -ne $null
  if ($hubUp) { Log "Hub worker already running." }
  else {
    Log "Starting hub worker ..."
    $hw = '"' + (Join-Path $here "web\hub-worker.mjs") + '"'
    Start-Process node -ArgumentList $hw -WorkingDirectory $root -WindowStyle Hidden
  }
} else { Log "Hub worker not configured (ASHADI_HUB_URL / ASHADI_WORKER_KEY missing in .env) - skipped." }

Log "Ready."
