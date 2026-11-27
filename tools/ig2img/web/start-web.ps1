# start-web.ps1 - start the Ashadi web UI (http://127.0.0.1:5041) if it isn't already running.
# Safe to re-run: checks the port first. Logs go to tools\logs\web-stdout.log / web-stderr.log.
# (ASCII only on purpose: Windows PowerShell 5.1 misreads UTF-8 without a BOM.)
param([int]$Port = 5041)

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = (Resolve-Path (Join-Path $here "..\..\..")).Path
$logDir = Join-Path $root "tools\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# localhost only; skip proxy auto-detection (it can hang for minutes - see autostart.ps1)
[System.Net.WebRequest]::DefaultWebProxy = New-Object System.Net.WebProxy
$up = $false
try { $up = (Invoke-WebRequest "http://127.0.0.1:$Port/api/status" -TimeoutSec 3 -UseBasicParsing).StatusCode -eq 200 } catch {}
if ($up) { Write-Host "Already running: http://127.0.0.1:$Port"; exit 0 }

$env:IG2IMG_WEB_PORT = "$Port"
Start-Process -FilePath "node" -ArgumentList "`"$(Join-Path $here 'server.mjs')`"" `
  -WorkingDirectory $root -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $logDir "web-stdout.log") `
  -RedirectStandardError (Join-Path $logDir "web-stderr.log")

Start-Sleep -Seconds 2
try {
  (Invoke-WebRequest "http://127.0.0.1:$Port/api/status" -TimeoutSec 5 -UseBasicParsing) | Out-Null
  Write-Host "Started: http://127.0.0.1:$Port"
} catch {
  Write-Host "Did not come up - check $logDir\web-stderr.log"
  exit 1
}
