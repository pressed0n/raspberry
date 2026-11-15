# Runs the Checkbox probe against a disposable copy of the app, end to end.
#
# WHY A COPY
# The probe presses a cell's tick, which is a real cell write, and the rule is that no probe
# write lands in the owner's database (docs/TESTING.md). This starts a second dev server from
# a copy of the project on port 3105, pointed at `artifacts/qa-run-checkbox/data/qa.sqlite`.
# The copy shares `node_modules` through a junction, so it costs a few hundred KB.
#
# Port 3105: the status-groups runner owns 3103 and the dates runner owns 3104, and two
# runners on one port is a probe talking to another feature's instance.
#
# The server is started, used and stopped inside *one* command, because a background child of
# a finished shell does not reliably outlive it on this machine.
$ErrorActionPreference = "Stop"
$root = $PWD.Path
$qa = Join-Path $root "artifacts\qa-run-checkbox"
$node = Join-Path $root ".tools\node-v24.22.1-win-x64\node.exe"
$env:Path = (Join-Path $root ".tools\node-v24.22.1-win-x64") + ";" + $env:Path

# A run that was killed leaves this copy behind, because `finally` never ran. Starting on top
# of it mixed an old `data/qa.sqlite` and an old `src/` into a "fresh" sandbox, which is how a
# probe ends up verifying code that is not on disk.
if (Test-Path $qa) { Remove-Item -Recurse -Force $qa -ErrorAction SilentlyContinue }

New-Item -ItemType Directory -Force -Path $qa | Out-Null
Copy-Item package.json, tsconfig.json, next.config.ts, next-env.d.ts -Destination $qa -Force
robocopy src "$qa\src" /E /NFL /NDL /NJH /NJS /NP | Out-Null
robocopy scripts "$qa\scripts" /E /XF "*.log" /NFL /NDL /NJH /NJS /NP | Out-Null
New-Item -ItemType Directory -Force -Path "$qa\data" | Out-Null
if (-not (Test-Path "$qa\node_modules")) { cmd /c mklink /J "$qa\node_modules" "$root\node_modules" | Out-Null }

$env:PORT = "3105"
$env:DATABASE_URL = "file:./data/qa.sqlite"
$env:RASPBERRY_AUTH_MODE = "local"
$env:RASPBERRY_LOCAL_DEV = "1"
$env:APP_ORIGIN = "http://127.0.0.1:3105"
$server = Start-Process -FilePath $node -ArgumentList "node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", "3105" -WorkingDirectory $qa -PassThru -NoNewWindow -RedirectStandardOutput "$qa\qa.out.log" -RedirectStandardError "$qa\qa.err.log"

try {
  $ready = $false
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Seconds 2
    try {
      $health = (Invoke-WebRequest -Uri "http://127.0.0.1:3105/api/health" -UseBasicParsing -TimeoutSec 8).Content
      if ($health -match "ok") { $ready = $true; break }
    } catch { }
  }
  if (-not $ready) { Get-Content "$qa\qa.err.log" -Tail 15; throw "the disposable instance never became healthy" }

  $env:BASE = "http://127.0.0.1:3105"

  # One fresh database per resolution, on purpose: the probe presses a tick, so a shared seed
  # would let the second pass read the first pass's leftovers.
  $code = 0
  foreach ($size in @(@(1400, 900), @(390, 844))) {
    $seed = (node scripts\seed-qa-checkbox.mjs) -join ""
    $pageId = ([regex]'"pageId": "([0-9a-f-]{36})"').Match($seed).Groups[1].Value
    $dbId = ([regex]'"databaseId": "([0-9a-f-]{36})"').Match($seed).Groups[1].Value
    $boxId = ([regex]'"boxId": "([0-9a-f-]{36})"').Match($seed).Groups[1].Value
    if (-not $pageId) { throw "the seed printed no page id" }
    if (-not $dbId) { throw "the seed printed no database id" }
    if (-not $boxId) { throw "the seed printed no Checkbox property id" }

    $env:PAGE = $pageId
    $env:DB = $dbId
    $env:BOX = $boxId
    Write-Output "--- $($size[0])x$($size[1]) ---"
    node scripts\verify-db-checkbox.mjs $($size[0]) $($size[1])
    if ($LASTEXITCODE -ne 0) { $code = $LASTEXITCODE }
  }
} finally {
  try { Stop-Process -Id $server.Id -Force } catch { }
  # The copy is a build artefact, not evidence.
  Remove-Item -Recurse -Force $qa -ErrorAction SilentlyContinue
}
exit $code
