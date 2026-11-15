# Runs the Files & Media probe against a disposable copy of the app, end to end.
#
# WHY A COPY
# The probe uploads files and writes cell values — real bytes into `data/uploads`, real rows into
# sqlite. docs/TESTING.md's rule is that no probe points its gestures at the owner's instance, and
# a copy is the only way to be sure. Port 3110: the groups runner owns 3103, dates 3104, checkbox
# 3105, row-open 3106, url 3107, places 3108, the place card 3109.
#
# WHY NO FIXTURE SERVER
# Every other probe in this folder stands something up on loopback because the feature talks to a
# stranger (a geocoder, a tile server). This one talks to `/api/files`, which is *ours* — the
# uploads land in the copy's own `data/uploads` and are deleted with it. A fixture here would only
# be a second implementation of the thing under test.
#
# -Before
# Reverts *this* turn: the download link goes back to plain `fileHref` (so a picture is served
# `inline` and the save check fails by name), and both `<FilePeek>` renders become `{null}` (so
# the hover checks fail by name). B53's own before-tree — the Files column falling through to
# the shared text field — was measured last turn and is recorded in docs/STATE.md; reverting it
# again here would make §1 fail and skip the hover section entirely, which is the opposite of
# useful. Every rewrite is checked before the app starts.
param([switch]$Before)
$ErrorActionPreference = "Stop"
$root = $PWD.Path
$qa = Join-Path $root "artifacts\qa-run-files"
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
  $path = Join-Path $qa "src\components\database\files-cell.tsx"
  $text = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)

  # The two things this turn added. `.Replace` is an exact string swap, so a rewrite that matches
  # nothing leaves the source alone and the guards below say so — a silently-unchanged copy would
  # report a clean run of the *fixed* tree as a failure of the fix.
  $text = $text.Replace('href={fileDownloadHref(file.id)}', 'href={fileHref(file.id)}')
  $text = $text.Replace('<FilePeek peek={preview} />', '{null}')
  $text = $text.Replace('<FilePeek peek={peek.peek} />', '{null}')

  if ($text -match 'fileDownloadHref\(file\.id\)') { throw "the download link was not reverted -- the pre-fix tree is not what this run thinks it is" }
  if ($text -match '<FilePeek') { throw "the peek was not removed -- the pre-fix tree is not what this run thinks it is" }
  if ($text -notmatch '<FilesSummary value=\{value\} />') { throw "the cell is not the Files cell at all -- the copy is not the tree under test" }
  [System.IO.File]::WriteAllText($path, $text, $utf8)
  Write-Output "--- tree rebuilt as it was BEFORE this turn: no save link, no hover preview -- the probe must fail here ---"
}

$env:PORT = "3110"
$env:DATABASE_URL = "file:./data/qa.sqlite"
$env:RASPBERRY_AUTH_MODE = "local"
$env:RASPBERRY_LOCAL_DEV = "1"
$env:APP_ORIGIN = "http://127.0.0.1:3110"
$server = Start-Process -FilePath $node -ArgumentList "node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", "3110" -WorkingDirectory $qa -PassThru -NoNewWindow -RedirectStandardOutput "$qa\qa.out.log" -RedirectStandardError "$qa\qa.err.log"

try {
  $ready = $false
  for ($i = 0; $i -lt 45; $i++) {
    Start-Sleep -Seconds 2
    try {
      $health = (Invoke-WebRequest -Uri "http://127.0.0.1:3110/api/health" -UseBasicParsing -TimeoutSec 8).Content
      if ($health -match "ok") { $ready = $true; break }
    } catch { }
  }
  if (-not $ready) { Get-Content "$qa\qa.err.log" -Tail 20; throw "the disposable instance never became healthy" }

  $env:BASE = "http://127.0.0.1:3110"

  $code = 0
  foreach ($size in @(@(1400, 900), @(390, 844))) {
    # A fresh page per resolution: the probe uploads files and removes one, and a shared seed
    # would make the second width start from the first one's leftovers.
    $seed = (node scripts\seed-qa-files.mjs) -join ""
    $pageId = ([regex]'"pageId": "([0-9a-f-]{36})"').Match($seed).Groups[1].Value
    $databaseId = ([regex]'"databaseId": "([0-9a-f-]{36})"').Match($seed).Groups[1].Value
    $filesId = ([regex]'"filesId": "([0-9a-f-]{36})"').Match($seed).Groups[1].Value
    if (-not $pageId -or -not $databaseId -or -not $filesId) { throw "the seed printed no ids: $seed" }

    $env:PAGE = $pageId
    $env:DB = $databaseId
    $env:FILES = $filesId
    Write-Output "--- $($size[0])x$($size[1]) ---"
    node scripts\verify-db-files.mjs $($size[0]) $($size[1])
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
