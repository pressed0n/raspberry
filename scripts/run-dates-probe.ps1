# Runs the Date-picker probe against a disposable copy of the app, end to end.
#
# WHY A COPY
# The probe writes a cell, turns on `Include time` (a property write) and changes the date
# format. Those are real writes, and the rule is that none of them lands in the owner's
# database (docs/TESTING.md), so this starts a second dev server from a copy of the project on
# port 3104, pointed at `artifacts/qa-run-dates/data/qa.sqlite`. The copy shares `node_modules`
# through a junction, so it costs a few hundred KB.
#
# Port 3104, not 3103: the status-groups runner owns 3103, and two runners on one port is a
# probe that talks to the other feature's instance.
#
# The server is started, used and stopped inside *one* command, because a background child of
# a finished shell does not reliably outlive it on this machine.
$ErrorActionPreference = "Stop"
$root = $PWD.Path
$qa = Join-Path $root "artifacts\qa-run-dates"
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

$env:PORT = "3104"
$env:DATABASE_URL = "file:./data/qa.sqlite"
$env:RASPBERRY_AUTH_MODE = "local"
$env:RASPBERRY_LOCAL_DEV = "1"
$env:APP_ORIGIN = "http://127.0.0.1:3104"
$server = Start-Process -FilePath $node -ArgumentList "node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", "3104" -WorkingDirectory $qa -PassThru -NoNewWindow -RedirectStandardOutput "$qa\qa.out.log" -RedirectStandardError "$qa\qa.err.log"

try {
  $ready = $false
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Seconds 2
    try {
      $health = (Invoke-WebRequest -Uri "http://127.0.0.1:3104/api/health" -UseBasicParsing -TimeoutSec 8).Content
      if ($health -match "ok") { $ready = $true; break }
    } catch { }
  }
  if (-not $ready) { Get-Content "$qa\qa.err.log" -Tail 15; throw "the disposable instance never became healthy" }

  $env:BASE = "http://127.0.0.1:3104"

  # One fresh database per resolution, on purpose: the probe clears a cell, turns a property
  # setting on and changes a format, so a shared seed would let the second pass read the first
  # pass's leftovers.
  $code = 0
  foreach ($size in @(@(1400, 900), @(390, 844))) {
    $seed = (node scripts\seed-qa-dates.mjs) -join ""
    $pageId = ([regex]'"pageId": "([0-9a-f-]{36})"').Match($seed).Groups[1].Value
    $dbId = ([regex]'"databaseId": "([0-9a-f-]{36})"').Match($seed).Groups[1].Value
    $dateId = ([regex]'"dateId": "([0-9a-f-]{36})"').Match($seed).Groups[1].Value
    if (-not $pageId) { throw "the seed printed no page id" }
    if (-not $dbId) { throw "the seed printed no database id" }
    if (-not $dateId) { throw "the seed printed no Date property id" }

    $env:PAGE = $pageId
    $env:DB = $dbId
    $env:DATE = $dateId
    Write-Output "--- $($size[0])x$($size[1]) ---"
    node scripts\verify-db-dates.mjs $($size[0]) $($size[1])
    if ($LASTEXITCODE -ne 0) { $code = $LASTEXITCODE }

    # The date cell's trigger clips its text for the ellipsis, which is the shape that cut the
    # descender off a tag chip. Same page, same measurement, and it runs *after* the probe so
    # the cells hold a date and a range rather than "Empty".
    Write-Output "--- text clip @ $($size[0])x$($size[1]) ---"
    node scripts\verify-text-clip.mjs $($size[0]) $($size[1])
    if ($LASTEXITCODE -ne 0) { $code = $LASTEXITCODE }
  }
} finally {
  try { Stop-Process -Id $server.Id -Force } catch { }
  # The copy is a build artefact, not evidence.
  Remove-Item -Recurse -Force $qa -ErrorAction SilentlyContinue
}
exit $code
