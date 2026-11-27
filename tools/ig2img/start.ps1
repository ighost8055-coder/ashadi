# start.ps1 — bring the whole pipeline up: Chrome (debug port) + webhook + Cloudflare Tunnel.
# Run this, then paste the printed URL into the Meta webhook screen (first time only).
param(
  [int]$Port = 8787,
  [int]$ChromePort = 9222,
  [string]$TunnelName = "kapruka-ig2img",
  [string]$Hostname = "ig.360world.lk",
  [switch]$SkipTunnel        # Telegram-only mode: no tunnel, no Meta webhook
)

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = (Resolve-Path (Join-Path $here "..\..")).Path

Write-Host "=== Kapruka ig2img ===" -ForegroundColor Cyan

# 1 - cloudflared. Prefer the standalone .exe kept in tools\ (no installer, no admin
#     rights needed); fall back to a system-wide install if one exists.
$cf = Join-Path $root "tools\cloudflared.exe"
if (-not (Test-Path $cf)) {
  $sys = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
  if ($sys) {
    $cf = $sys
  } else {
    Write-Host "cloudflared not found. Downloading the standalone binary (~55 MB)..." -ForegroundColor Yellow
    $cf = Join-Path $root "tools\cloudflared.exe"
    $src = "https://github.com/cloudflare/cloudflared/releases/download/2026.8.2/cloudflared-windows-amd64.exe"
    # curl.exe rather than Invoke-WebRequest: it resumes and retries. A truncated
    # download still has a valid MZ header and fails later with a confusing
    # "not a valid application for this OS platform".
    & curl.exe -L --retry 5 --retry-delay 3 --retry-all-errors -C - --max-time 900 -o $cf $src
    if (-not (Test-Path $cf)) {
      Write-Host "Download failed. Get it manually from:" -ForegroundColor Red
      Write-Host "  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
      exit 1
    }
  }
}
Write-Host ("cloudflared: " + $cf) -ForegroundColor DarkGray

# 2 - Chrome with the debug port
$chromeUp = $false
try { $chromeUp = (Invoke-WebRequest "http://127.0.0.1:$ChromePort/json/version" -TimeoutSec 2 -UseBasicParsing).StatusCode -eq 200 } catch {}
if (-not $chromeUp) { & (Join-Path $here "start-chrome.ps1") -Port $ChromePort }

# 3 - webhook
$health = "http://127.0.0.1:$Port/health"
$webhookUp = $false
try { $webhookUp = (Invoke-WebRequest $health -TimeoutSec 2 -UseBasicParsing).StatusCode -eq 200 } catch {}
if ($webhookUp) {
  Write-Host "Webhook already listening on :$Port." -ForegroundColor Green
} else {
  Write-Host "Starting webhook on :$Port ..." -ForegroundColor Green
  # The path contains spaces ("Claude Ads Team"), so it MUST be quoted here —
  # unquoted, Start-Process splits it and node reports "Cannot find module".
  $mjs = '"' + (Join-Path $here "webhook.mjs") + '"'
  Start-Process node -ArgumentList $mjs -WorkingDirectory $root -WindowStyle Minimized
  Start-Sleep -Seconds 3
}

# 3b - Telegram bot. Needs no tunnel and no Meta config: Telegram bots long-poll
#      for their own updates, so this works from behind any router.
$tgUp = (Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
         Where-Object { $_.CommandLine -match 'telegram-bot' }) -ne $null
if ($tgUp) {
  Write-Host "Telegram bot already running." -ForegroundColor Green
} else {
  Write-Host "Starting Telegram bot ..." -ForegroundColor Green
  $tg = '"' + (Join-Path $here "telegram-bot.mjs") + '"'
  Start-Process node -ArgumentList $tg -WorkingDirectory $root -WindowStyle Minimized
  Start-Sleep -Seconds 3
}

# 4 - tunnel (WhatsApp only — skip it entirely if you use just Telegram)
if ($SkipTunnel) {
  Write-Host ""
  Write-Host "Skipping the tunnel (Telegram needs no public URL)." -ForegroundColor DarkGray
  Write-Host "Ready. Message the Telegram bot with an Instagram link plus the word 'create'." -ForegroundColor Green
  exit 0
}

$logDir = Join-Path $root "tools\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "cloudflared.log"
if (Test-Path $log) { Remove-Item $log -Force -ErrorAction SilentlyContinue }

Write-Host "Starting Cloudflare Tunnel ..." -ForegroundColor Green
# NAMED tunnel (config at ~\.cloudflared\config.yml) — the hostname is permanent,
# so the Meta callback URL never needs re-pasting. Falls back to a throwaway quick
# tunnel if the named one isn't set up on this machine.
$named = Test-Path (Join-Path $env:USERPROFILE ".cloudflared\config.yml")
$url = $null

if ($named) {
  Start-Process $cf -ArgumentList @("tunnel", "--no-autoupdate", "run", $TunnelName) `
    -RedirectStandardError $log -RedirectStandardOutput "$log.out" -WindowStyle Minimized
  Write-Host "Waiting for the tunnel to register ..."
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 1
    if ((Test-Path $log) -and (Select-String -Path $log -Pattern "Registered tunnel connection" -ErrorAction SilentlyContinue)) {
      $url = "https://$Hostname"; break
    }
  }
} else {
  Start-Process $cf -ArgumentList @("tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:$Port") `
    -RedirectStandardError $log -RedirectStandardOutput "$log.out" -WindowStyle Minimized
  Write-Host "Waiting for the public URL ..."
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Path $log) {
      $m = Select-String -Path $log -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -ErrorAction SilentlyContinue | Select-Object -Last 1
      if ($m) { $url = $m.Matches[0].Value; break }
    }
  }
}

Write-Host ""
if ($url) {
  Write-Host "PUBLIC WEBHOOK URL:" -ForegroundColor Cyan
  Write-Host ("  " + $url + "/webhook") -ForegroundColor White
  Write-Host ""
  Write-Host "Paste it at developers.facebook.com -> your app -> WhatsApp -> Configuration:" -ForegroundColor Yellow
  Write-Host ("  Callback URL   " + $url + "/webhook")
  Write-Host "  Verify token   <the WA_VERIFY_TOKEN value from .env>     (must match WA_VERIFY_TOKEN in .env)"
  Write-Host "  Webhook fields tick 'messages'"
  Write-Host ""
  if ($named) {
    Write-Host "This is the NAMED tunnel - the URL is permanent. Paste it into Meta once and never again." -ForegroundColor DarkGray
  } else {
    Write-Host "NOTE: this is a throwaway URL and CHANGES on every restart. The named tunnel" -ForegroundColor DarkGray
    Write-Host "      makes it permanent - see README.md." -ForegroundColor DarkGray
  }
} else {
  Write-Host "Could not read the tunnel URL. Check $log" -ForegroundColor Red
}

Write-Host ""
Write-Host "Ready. WhatsApp an Instagram link plus the word 'create' to 070 117 8279." -ForegroundColor Green
Write-Host "Logs: tools\logs\ig2img.log   Stop: close the node and cloudflared windows." -ForegroundColor DarkGray
