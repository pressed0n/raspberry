# Runs the picked-place-card probe against a disposable copy of the app, end to end.
#
# WHY A COPY
# The probe picks places, which commits cell values — a database write. The rule in
# docs/TESTING.md is that no probe points its gestures at the owner's instance, and a copy is the
# only way to be sure. Port 3109: the groups runner owns 3103, dates 3104, checkbox 3105,
# row-open 3106, url 3107, places 3108.
#
# WHY TWO FIXTURES
# `RASPBERRY_PLACES_URL` and `RASPBERRY_TILES_URL` are both pointed at loopback servers that
# `scripts/verify-db-place-map.mjs` starts itself (3118 and 3119). Without them this run would
# send the words this probe types to a public geocoder **and** ask a public tile server for
# squares of the owner's chosen addresses, on every keystroke of every run. The tile fixture also
# answers with pixel-coded squares, which is what lets the probe say *which* square ended up
# where instead of "a map appeared".
#
# -Before
# Rebuilds the tree as it was before the card existed (B52) inside the copy — the card gone, so a
# picked place closes the list and the cell shows nothing but its address — and expects the probe to
# fail. It does not revert B52b (the link's destination): with no card there is no link to point
# anywhere, so the link check fails inside the same 24, and that turn's own falsification was the
# mutation recorded in docs/STATE.md instead.
#
# Two edits, exactly B52's two changes: the `card` condition (which is what makes the
# surface a map) and the pick's decision to keep the surface open. Reverts them to the shape the
# column had an hour before that turn: `const card = false`, and `setOpen(false)` after every pick.
param([switch]$Before)
$ErrorActionPreference = "Stop"
$root = $PWD.Path
$qa = Join-Path $root "artifacts\qa-run-place-map"
$node = Join-Path $root ".tools\node-v24.22.1-win-x64\node.exe"
$env:Path = (Join-Path $root ".tools\node-v24.22.1-win-x64") + ";" + $env:Path

if (Test-Path $qa) { Remove-Item -Recurse -Force $qa -ErrorAction SilentlyContinue }

New-Item -ItemType Directory -Force -Path $qa | Out-Null
Copy-Item package.json, tsconfig.json, next.config.ts, next-env.d.ts -Destination $qa -Force
robocopy src "$qa\src" /E /NFL /NDL /NJH /NJS /NP | Out-Null
robocopy scripts "$qa\scripts" /E /XF "*.log" /NFL /NDL /NJH /NJS /NP | Out-Null
New-Item -ItemType Directory -Force -Path "$qa\data" | Out-Null
if (-not (Test-Path "$qa\node_modules")) { cmd /c mklink /J "$qa\node_modules" "$root\node_modules" | Out-Null }

if ($Before) {
  # `Get-Content`/`Set-Content` in PowerShell 5.1 default to the ANSI code page, which turns the
  # em dashes in these sources into bytes Turbopack refuses ("invalid utf-8 sequence") — the run
  # then fails at compile time, which looks like a probe failure and is not one.
  $utf8 = New-Object System.Text.UTF8Encoding($false)

  $path = Join-Path $qa "src\components\database\place-cell.tsx"
  $text = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)

  # 1. The card: the surface never becomes a map, so a picked place shows the list and nothing else.
  $text = [regex]::Replace($text, 'const card = open \? placeCard\(value, picked, draft\) : null;', 'const card = null;')

  # 2. The pick: the surface closes on every pick, as it did before the map existed.
  $text = [regex]::Replace($text, '(?s)if \(stored\.point === null\) setOpen\(false\);', 'setOpen(false);')

  # Both rewrites are checked before the app is started, and that check is not ceremony: this runner
  # first looked for `held.point !== null && query === held.address`, which was the card's shape
  # *before* the rule moved into `placeCard()`. The rewrite then matched nothing, and only the check
  # said so — instead of reporting a clean 34/34 of the fixed tree as a failure of the fix.
  if ($text -match 'placeCard\(value, picked, draft\)') { throw "the card condition was not removed -- the pre-fix tree is not what this run thinks it is" }
  if ($text -notmatch 'const card = null;') { throw "the card condition is still in the copy" }
  [System.IO.File]::WriteAllText($path, $text, $utf8)
  Write-Output "--- tree rebuilt as it was BEFORE this turn: no card, the list closes on a pick -- the probe must fail here ---"
}

$env:PORT = "3109"
$env:DATABASE_URL = "file:./data/qa.sqlite"
$env:RASPBERRY_AUTH_MODE = "local"
$env:RASPBERRY_LOCAL_DEV = "1"
$env:APP_ORIGIN = "http://127.0.0.1:3109"
$env:RASPBERRY_PLACES_URL = "http://127.0.0.1:3118/"
$env:RASPBERRY_TILES_URL = "http://127.0.0.1:3119/"
$server = Start-Process -FilePath $node -ArgumentList "node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", "3109" -WorkingDirectory $qa -PassThru -NoNewWindow -RedirectStandardOutput "$qa\qa.out.log" -RedirectStandardError "$qa\qa.err.log"

try {
  $ready = $false
  for ($i = 0; $i -lt 45; $i++) {
    Start-Sleep -Seconds 2
    try {
      $health = (Invoke-WebRequest -Uri "http://127.0.0.1:3109/api/health" -UseBasicParsing -TimeoutSec 8).Content
      if ($health -match "ok") { $ready = $true; break }
    } catch { }
  }
  if (-not $ready) { Get-Content "$qa\qa.err.log" -Tail 20; throw "the disposable instance never became healthy" }

  $env:BASE = "http://127.0.0.1:3109"
  $env:FIXTURE_PORT = "3118"
  $env:TILE_PORT = "3119"

  $code = 0
  foreach ($size in @(@(1400, 900), @(390, 844))) {
    # A fresh page per resolution: the probe picks places and writes cells, and a shared seed would
    # make the second width start from the first one's leftovers.
    $seed = (node scripts\seed-qa-places.mjs) -join ""
    $pageId = ([regex]'"pageId": "([0-9a-f-]{36})"').Match($seed).Groups[1].Value
    $databaseId = ([regex]'"databaseId": "([0-9a-f-]{36})"').Match($seed).Groups[1].Value
    $placeId = ([regex]'"placeId": "([0-9a-f-]{36})"').Match($seed).Groups[1].Value
    if (-not $pageId -or -not $databaseId -or -not $placeId) { throw "the seed printed no ids: $seed" }

    $env:PAGE = $pageId
    $env:DB = $databaseId
    $env:PLACE = $placeId
    Write-Output "--- $($size[0])x$($size[1]) ---"
    node scripts\verify-db-place-map.mjs $($size[0]) $($size[1])
    if ($LASTEXITCODE -ne 0) { $code = $LASTEXITCODE }
  }
} finally {
  try { Stop-Process -Id $server.Id -Force } catch { }
  Remove-Item -Recurse -Force $qa -ErrorAction SilentlyContinue
}

if ($Before) {
  if ($code -eq 0) {
    Write-Output "FAIL: the probe passed on the pre-fix tree -- it does not test what it claims"
    exit 1
  }
  Write-Output "OK: the probe fails on the pre-fix tree, as it must (exit $code)"
  exit 0
}
exit $code
