# Runs the row-open probe against a disposable copy of the app, end to end.
#
# WHY A COPY
# The probe opens a page and types into a cell. Neither is a database write, but the rule in
# docs/TESTING.md is that no probe points its gestures at the owner's instance, and a copy is
# the only way to be sure. Port 3106: the groups runner owns 3103, dates 3104, checkbox 3105,
# and two runners sharing a port is a probe talking to another feature's server.
#
# -Before
# Rebuilds the tree *as it was before this turn* inside the copy -- the `<tr onDoubleClick>`,
# the `db-row-open` class and the `.db-row-open { cursor: pointer }` rule -- and expects the
# probe to fail. A probe that has never been run against the bug it describes is a paragraph
# with a shebang.
param([switch]$Before)
$ErrorActionPreference = "Stop"
$root = $PWD.Path
$qa = Join-Path $root "artifacts\qa-run-row-open"
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
  # `Set-Content` / `Get-Content` in PowerShell 5.1 default to the ANSI code page, which turns
  # the em dashes in these sources into bytes Turbopack refuses ("invalid utf-8 sequence"), and
  # the run then fails at compile time — a green-looking failure that has nothing to do with
  # the probe. Read and write UTF-8 explicitly.
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  $view = Join-Path $qa "src\components\database\table-view.tsx"
  $src = [System.IO.File]::ReadAllText($view, [System.Text.Encoding]::UTF8)
  $src = $src.Replace(
    'className={["db-row", selected.has(row.id)',
    'className={["db-row", onOpenRow ? "db-row-open" : "", selected.has(row.id)')
  $src = $src.Replace(
    '"is-drop-over" : ""].filter(Boolean).join(" ")}',
    '"is-drop-over" : ""].filter(Boolean).join(" ")}' + "`n              onDoubleClick={() => onOpenRow?.(row.id)}")
  [System.IO.File]::WriteAllText($view, $src, $utf8)

  $cssPath = Join-Path $qa "src\app\database.css"
  $css = [System.IO.File]::ReadAllText($cssPath, [System.Text.Encoding]::UTF8)
  $css = $css.Replace(
    '.db-row:hover .db-cell:not(.db-gutter):not(.db-cell-add):not(.db-cell-filler) { background: var(--hover); }',
    '.db-row:hover .db-cell:not(.db-gutter):not(.db-cell-add):not(.db-cell-filler) { background: var(--hover); }' + "`n.db-row-open { cursor: pointer; }")
  [System.IO.File]::WriteAllText($cssPath, $css, $utf8)
  Write-Output "--- tree rebuilt as it was BEFORE this turn: the probe must fail here ---"
}

$env:PORT = "3106"
$env:DATABASE_URL = "file:./data/qa.sqlite"
$env:RASPBERRY_AUTH_MODE = "local"
$env:RASPBERRY_LOCAL_DEV = "1"
$env:APP_ORIGIN = "http://127.0.0.1:3106"
$server = Start-Process -FilePath $node -ArgumentList "node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", "3106" -WorkingDirectory $qa -PassThru -NoNewWindow -RedirectStandardOutput "$qa\qa.out.log" -RedirectStandardError "$qa\qa.err.log"

try {
  $ready = $false
  for ($i = 0; $i -lt 45; $i++) {
    Start-Sleep -Seconds 2
    try {
      $health = (Invoke-WebRequest -Uri "http://127.0.0.1:3106/api/health" -UseBasicParsing -TimeoutSec 8).Content
      if ($health -match "ok") { $ready = $true; break }
    } catch { }
  }
  if (-not $ready) { Get-Content "$qa\qa.err.log" -Tail 20; throw "the disposable instance never became healthy" }

  $env:BASE = "http://127.0.0.1:3106"

  $code = 0
  foreach ($size in @(@(1400, 900), @(390, 844))) {
    # A fresh page per resolution: the probe leaves the browser on a row's own page, and a
    # shared seed would make the second width start somewhere other than the table.
    $seed = (node scripts\seed-qa-checkbox.mjs) -join ""
    $pageId = ([regex]'"pageId": "([0-9a-f-]{36})"').Match($seed).Groups[1].Value
    if (-not $pageId) { throw "the seed printed no page id" }

    $env:PAGE = $pageId
    Write-Output "--- $($size[0])x$($size[1]) ---"
    node scripts\verify-db-row-open.mjs $($size[0]) $($size[1])
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
