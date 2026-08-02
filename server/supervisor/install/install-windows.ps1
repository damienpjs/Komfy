#!/usr/bin/env pwsh
# Install the Komfy supervisor as a Scheduled Task (Windows), started at logon.
# Logon (not boot) so the user's Tailscale is up; the supervisor also retries
# its bind until the Tailscale IP appears.
#
#   pwsh -ExecutionPolicy Bypass -File server\supervisor\install\install-windows.ps1
#
# Uninstall:
#   Unregister-ScheduledTask -TaskName "KomfySupervisor" -Confirm:$false
$ErrorActionPreference = "Stop"

$Repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$Node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $Node) { Write-Error "node not found on PATH - install Node first."; exit 1 }

$Index = Join-Path $Repo "server\supervisor\index.js"
$TaskName = "KomfySupervisor"

$action  = New-ScheduledTaskAction -Execute $Node -Argument "`"$Index`"" -WorkingDirectory $Repo
$trigger = New-ScheduledTaskTrigger -AtLogOn
# Keep it running / restart on failure.
$settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
  -Description "Komfy supervisor (remote ComfyUI on/off + live logs)" | Out-Null

Write-Host "[OK] Registered scheduled task '$TaskName' (runs at logon)."
Write-Host "     Start now: Start-ScheduledTask -TaskName $TaskName"
Write-Host "     The supervisor generates its auth token on first run; then pair with:"
Write-Host "       npm run pair"
