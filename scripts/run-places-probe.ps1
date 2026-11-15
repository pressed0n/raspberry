# Runs the Place-cell probe against a disposable copy of the app, end to end.
#
# WHY A COPY
# The probe picks places, which commits cell values — a database write. The rule in
# docs/TESTING.md is that no probe points its gestures at the owner's instance, and a copy is
# the only way to be sure. Port 3108: the groups runner owns 3103, dates 3104, checkbox 3105,
# row-open 3106, url 3107.
#
# WHY THE FIXTURE POINT
# `RASPBERRY_PLACES_URL` is set to a loopback fixture that `scripts/verify-db-places.mjs`
# starts itself. Without it this run would send the words this probe types to a public
# geocoder on every keystroke of every run — non-deterministic, dependent on the internet, and
# somebody else's server paying for our test suite. The env var exists for exactly this reason;
# `off` is the other end of it.
#
# -Before
# Rebuilds the tree as it was *before this turn* inside the copy — the ranker neutered, so a
# provider's answer is drawn in the order the provider sent it and every row is headed by the
# place's own name, and the composition gone, so a house number no row carries has nothing to
# stand on — and expects the probe to fail. A probe that has never been run against the
# behaviour it describes is a paragraph with a shebang.
#
# Three edits, and they are exactly this turn's three changes: the ordering (score, then
# provider order), the bold line (`labelOf` choosing the field that answered the query), and
# the composition (`composedHits`, which keeps the typed house number when no result carries
# it). Each is replaced by what the column did before, which is: keep the provider's order,
# always print the place's own name, and answer a missing door with the bare street.
#
# Superseded: the previous `-Before` removed the Place branch from `cell-editor.tsx` entirely,
# which was the right check for the turn that built the feature and the wrong one for a turn
# about ranking — it fails for reasons that have nothing to do with ranking.
param([switch]$Before)
$ErrorActionPreference = "Stop"
$root = $PWD.Path
$qa = Join-Path $root "artifacts\qa-run-places"
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

  $path = Join-Path $qa "src\lib\database\property-types\place.ts"
  $text = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)

  # 1. The order: keep the provider's, instead of ranking by how well each row answers.
  $pattern = '(?s)const floor = plan\.address && bestWords >= 0\.85;.*?\.sort\(\(a, b\) => b\.score - a\.score \|\| a\.index - b\.index\);'
  $text = [regex]::Replace($text, $pattern, 'const ordered = ranked.sort((a, b) => a.index - b.index);')

  # 2. The bold line: always the place's own name, whatever was typed.
  $pattern = '(?s)function labelOf\(parts: PlaceParts, words: string, numberLast: boolean\): string \{.*?\r?\n\}'
  $text = [regex]::Replace($text, $pattern, 'function labelOf(parts: PlaceParts, words: string, numberLast: boolean): string { return nameOf(parts, numberLast); }')

  # 3. The composition: a house number no row carries is dropped again, and the rows go back to
  #    being the bare streets the number would be on.
  $pattern = '(?s)\r?\n  if \(!matchedNumber\) \{\r?\n    const composed = composedHits\(ordered, plan, limit\);\r?\n    if \(composed\.length > 0\) return \{ hits: composed, matchedNumber: false \};\r?\n  \}'
  $text = [regex]::Replace($text, $pattern, '')

  if ($text -notmatch 'const ordered = ranked\.sort') { throw "the ranker was not neutered -- the pre-fix tree is not what this run thinks it is" }
  if ($text -match 'const composed = composedHits\(') { throw "the composition was not removed -- the pre-fix tree is not what this run thinks it is" }
  [System.IO.File]::WriteAllText($path, $text, $utf8)
  Write-Output "--- tree rebuilt as it was BEFORE this turn: provider order, own names, no composition -- the probe must fail here ---"
}

$env:PORT = "3108"
$env:DATABASE_URL = "file:./data/qa.sqlite"
$env:RASPBERRY_AUTH_MODE = "local"
$env:RASPBERRY_LOCAL_DEV = "1"
$env:APP_ORIGIN = "http://127.0.0.1:3108"
$env:RASPBERRY_PLACES_URL = "http://127.0.0.1:3117/"
# The picked-place card draws a map, and this probe opens cells that hold a point. Tiles are
# switched off here so that this run stays a test of the *search*: with tiles on, every open would
# fetch four squares of OpenStreetMap from somebody else's server. The card itself, and its map,
# are `run-place-map-probe.ps1`'s subject.
$env:RASPBERRY_TILES_URL = "off"
$server = Start-Process -FilePath $node -ArgumentList "node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", "3108" -WorkingDirectory $qa -PassThru -NoNewWindow -RedirectStandardOutput "$qa\qa.out.log" -RedirectStandardError "$qa\qa.err.log"

try {
  $ready = $false
  for ($i = 0; $i -lt 45; $i++) {
    Start-Sleep -Seconds 2
    try {
      $health = (Invoke-WebRequest -Uri "http://127.0.0.1:3108/api/health" -UseBasicParsing -TimeoutSec 8).Content
      if ($health -match "ok") { $ready = $true; break }
    } catch { }
  }
  if (-not $ready) { Get-Content "$qa\qa.err.log" -Tail 20; throw "the disposable instance never became healthy" }

  $env:BASE = "http://127.0.0.1:3108"
  $env:FIXTURE_PORT = "3117"

  $code = 0
  foreach ($size in @(@(1400, 900), @(390, 844))) {
    # A fresh page per resolution: the probe commits a place and stores a typed address, and a
    # shared seed would make the second width start somewhere else.
    $seed = (node scripts\seed-qa-places.mjs) -join ""
    $pageId = ([regex]'"pageId": "([0-9a-f-]{36})"').Match($seed).Groups[1].Value
    $databaseId = ([regex]'"databaseId": "([0-9a-f-]{36})"').Match($seed).Groups[1].Value
    $placeId = ([regex]'"placeId": "([0-9a-f-]{36})"').Match($seed).Groups[1].Value
    if (-not $pageId -or -not $databaseId -or -not $placeId) { throw "the seed printed no ids: $seed" }

    $env:PAGE = $pageId
    $env:DB = $databaseId
    $env:PLACE = $placeId
    Write-Output "--- $($size[0])x$($size[1]) ---"
    node scripts\verify-db-places.mjs $($size[0]) $($size[1])
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
