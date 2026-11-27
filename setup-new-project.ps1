# setup-new-project.ps1 - one-time set-up of Ashadi + Sithiji in a new root folder (same laptop).
#   .\setup-new-project.ps1                 install dependencies and check keys
#   .\setup-new-project.ps1 -RegisterTasks  also (re)create the two scheduled tasks pointing HERE
#                                           (same names as before, so the old tasks are replaced, not duplicated)
param([string]$Root = $PSScriptRoot, [switch]$RegisterTasks)
$ErrorActionPreference = 'Stop'
Set-Location $Root
function Say($m) { Write-Host $m -ForegroundColor Cyan }

Say "Root: $Root"
foreach ($t in 'node','npm','python') {
  if (-not (Get-Command $t -ErrorAction SilentlyContinue)) { Write-Host "MISSING: $t is not on PATH" -ForegroundColor Red }
}

Say "1/4 npm install (tools)"
Push-Location (Join-Path $Root 'tools'); npm install; Pop-Location

Say "2/4 pip install (Sithiji)"
python -m pip install -r (Join-Path $Root 'requirements-sithiji.txt')
Write-Host "Ashadi cut-outs also need rembg:  python -m pip install rembg pillow onnxruntime   (skip if already installed)"

Say "3/4 keys (names only, values are never shown)"
$envFile = Join-Path $Root '.env'
if (-not (Test-Path $envFile)) { Write-Host "No .env here yet: copy KEYS-private\.env to $envFile" -ForegroundColor Yellow }
else {
  $have = @{}
  foreach ($l in Get-Content $envFile) { if ($l -match '^\s*(?:var\s+|const\s+|let\s+|export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*;?\s*$') { if ($Matches[2].Trim("'",'"') -ne '') { $have[$Matches[1]] = $true } } }
  $need = 'CANVA_CLIENT_ID','CANVA_CLIENT_SECRET','GEMINI_API_KEY','TELEGRAM_BOT_TOKEN','SITHIJI_BOT_TOKEN','SITHIJI_WORKER_KEY','SITHIJI_REMOTE_URL','SITHIJI_OVERRIDE_PASSWORD','META_APP_SECRET','WA_TOKEN','ASHADI_HUB_URL','ASHADI_WORKER_KEY'
  $miss = $need | Where-Object { -not $have[$_] }
  if ($miss) { Write-Host ("Missing or empty: " + ($miss -join ', ')) -ForegroundColor Yellow } else { Write-Host "All required key names are present." }
}
if (-not (Test-Path (Join-Path $Root '.canva-tokens.json'))) { Write-Host "No .canva-tokens.json yet - expected on a new laptop. Do NOT copy one from the old PC (single-use tokens); open http://127.0.0.1:5041 and click Connect Canva." -ForegroundColor Yellow }

Say "4/4 scheduled tasks"
if ($RegisterTasks) {
  $user = "$env:USERDOMAIN\$env:USERNAME"
  $princ = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
  $set = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -StartWhenAvailable

  $auto = Join-Path $Root 'tools\ig2img\autostart.ps1'
  $a1 = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$auto`""
  $t1 = @((New-ScheduledTaskTrigger -AtLogOn -User $user),
          (New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)))
  Register-ScheduledTask -TaskName 'Kapruka-ig2img-autostart' -Action $a1 -Trigger $t1 -Settings $set -Principal $princ -Force | Out-Null

  $bat = Join-Path $Root 'run_sithiji_worker.bat'
  $a2 = New-ScheduledTaskAction -Execute $bat -WorkingDirectory $Root
  Register-ScheduledTask -TaskName 'Sithiji Worker' -Action $a2 -Trigger (New-ScheduledTaskTrigger -AtLogOn -User $user) -Settings $set -Principal $princ -Force | Out-Null
  Write-Host "Registered: Kapruka-ig2img-autostart, Sithiji Worker -> $Root"
} else { Write-Host "Skipped (add -RegisterTasks when the old copies are stopped)." }
Say "Done. Start with: tools\ig2img\autostart.ps1  (Chrome, web UI, Telegram bot, Sithiji worker)"
