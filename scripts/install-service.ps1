# Registers Raspberry to start when you sign in and restart after a crash.
#
# Run from an elevated PowerShell prompt in the repository root:
#   powershell -ExecutionPolicy Bypass -File scripts\install-service.ps1
# Remove it again with scripts\uninstall-service.ps1
#
# Honest limitations:
#   - The trigger is "at sign-in", not "at boot". A boot-time task on Windows
#     needs stored credentials or a service wrapper, and this laptop is expected
#     to be signed in anyway. If NikDTM reboots unattended and nobody signs in,
#     Raspberry stays down.
#   - It runs `scripts/serve.mjs`, which refuses to boot while
#     RASPBERRY_AUTH_MODE=session, so this cannot expose an unauthenticated app.
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$taskName = "Raspberry"

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw "Node.js 24 or newer was not found on PATH. Install it, then run pnpm install." }
$nodePath = $node.Source

if (-not (Test-Path (Join-Path $root "node_modules\next\dist\bin\next"))) {
  throw "Dependencies are missing. Run pnpm install in $root first."
}
if (-not (Test-Path (Join-Path $root ".next\BUILD_ID"))) {
  throw "No production build found. Run pnpm build in $root first."
}
if (-not (Test-Path (Join-Path $root ".env.local"))) {
  throw "Missing .env.local. Copy .env.example to .env.local and set RASPBERRY_LOCAL_DEV=1 plus DATABASE_URL."
}

$action = New-ScheduledTaskAction -Execute $nodePath -Argument "scripts\serve.mjs" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
  -Description "Raspberry notes, started at sign-in with automatic restart." -Force | Out-Null

Start-ScheduledTask -TaskName $taskName
Write-Host "Registered scheduled task '$taskName' using $nodePath"
Write-Host "Check it with: Get-ScheduledTask -TaskName $taskName"
Write-Host "Health check:  Invoke-RestMethod http://127.0.0.1:3000/api/health"
