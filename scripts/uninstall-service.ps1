# Removes the scheduled task created by scripts\install-service.ps1.
$ErrorActionPreference = "Stop"
$taskName = "Raspberry"

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if (-not $task) { Write-Host "No scheduled task named '$taskName'."; exit 0 }

Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
Write-Host "Removed scheduled task '$taskName'. Any running node process must be stopped separately."
