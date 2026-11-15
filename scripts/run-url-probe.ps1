# Runs the URL-cell probe against a disposable copy of the app, end to end.
#
# WHY A COPY
# The probe types a link into a cell and toggles a column setting — both are database writes.
# The rule in docs/TESTING.md is that no probe points its gestures at the owner's instance, and
# a copy is the only way to be sure. Port 3107: the groups runner owns 3103, dates 3104,
# checkbox 3105, row-open 3106.
#
# -Before
# Rebuilds the tree *as it was before this turn* inside the copy — `format` returning the
# address as stored, and `.db-url-open` always visible and always clickable — and expects the
# probe to fail. A probe that has never been run against the behaviour it describes is a
# paragraph with a shebang.
param([switch]$Before)
$ErrorActionPreference = "Stop"
$root = $PWD.Path
$qa = Join-Path $root "artifacts\qa-run-url"
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

  $linkPath = Join-Path $qa "src\lib\database\property-types\link.ts"
  $link = [System.IO.File]::ReadAllText($linkPath, [System.Text.Encoding]::UTF8)
  $link = $link.Replace(
    "    if (text === `"`" || urlConfigOf(config).fullUrl) return text;`n    return shortUrl(text);",
    "    return text;")
  [System.IO.File]::WriteAllText($linkPath, $link, $utf8)

  $cssPath = Join-Path $qa "src\app\database.css"
  $css = [System.IO.File]::ReadAllText($cssPath, [System.Text.Encoding]::UTF8)
  # Appended, so it wins by source order at the same specificity: the mark is always on screen
  # and always takes clicks, which is exactly the behaviour the probe refuses.
  $css = $css + "`n.db-url-open { opacity: 1; pointer-events: auto; }`n"
  # And the hover state this turn fixed: the `background` shorthand replaced the mark's opaque
  # surface with a 7% white wash, so the address underneath read through the box. Both openers,
  # because the probe measures both.
  $css = $css + ".db-url-open:hover { background: var(--hover-strong); }`n"
  $css = $css + ".db-open:hover { background: var(--hover-strong); }`n"
  [System.IO.File]::WriteAllText($cssPath, $css, $utf8)
  Write-Output "--- tree rebuilt as it was BEFORE this turn: the probe must fail here ---"
}

$env:PORT = "3107"
$env:DATABASE_URL = "file:./data/qa.sqlite"
$env:RASPBERRY_AUTH_MODE = "local"
$env:RASPBERRY_LOCAL_DEV = "1"
$env:APP_ORIGIN = "http://127.0.0.1:3107"
$server = Start-Process -FilePath $node -ArgumentList "node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", "3107" -WorkingDirectory $qa -PassThru -NoNewWindow -RedirectStandardOutput "$qa\qa.out.log" -RedirectStandardError "$qa\qa.err.log"

try {
  $ready = $false
  for ($i = 0; $i -lt 45; $i++) {
    Start-Sleep -Seconds 2
    try {
      $health = (Invoke-WebRequest -Uri "http://127.0.0.1:3107/api/health" -UseBasicParsing -TimeoutSec 8).Content
      if ($health -match "ok") { $ready = $true; break }
    } catch { }
  }
  if (-not $ready) { Get-Content "$qa\qa.err.log" -Tail 20; throw "the disposable instance never became healthy" }

  $env:BASE = "http://127.0.0.1:3107"

  $code = 0
  foreach ($size in @(@(1400, 900), @(390, 844))) {
    # A fresh page per resolution: the probe leaves a column setting toggled and a cell
    # rewritten, and a shared seed would make the second width start somewhere else.
    $seed = (node scripts\seed-qa-url.mjs) -join ""
    $pageId = ([regex]'"pageId": "([0-9a-f-]{36})"').Match($seed).Groups[1].Value
    $databaseId = ([regex]'"databaseId": "([0-9a-f-]{36})"').Match($seed).Groups[1].Value
    $linkId = ([regex]'"linkId": "([0-9a-f-]{36})"').Match($seed).Groups[1].Value
    if (-not $pageId -or -not $databaseId -or -not $linkId) { throw "the seed printed no ids: $seed" }

    $env:PAGE = $pageId
    $env:DB = $databaseId
    $env:LINK = $linkId
    Write-Output "--- $($size[0])x$($size[1]) ---"
    node scripts\verify-db-url.mjs $($size[0]) $($size[1])
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
