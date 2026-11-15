# Runs the Formula probe against a disposable copy of the app, end to end.
#
# WHY A COPY
# The probe edits a real formula (which is a property write into sqlite) and reads the recomputed
# column back. docs/TESTING.md's rule is that no probe points its gestures at the owner's instance.
# Port 3111: the groups runner owns 3103, dates 3104, checkbox 3105, row-open 3106, url 3107,
# places 3108, the place card 3109, files 3110.
#
# WHY NO FIXTURE SERVER
# Every other probe in this folder stands something up on loopback because the feature talks to a
# stranger (a geocoder, a tile server). This one talks to `/api/databases`, which is *ours* — the
# rows land in the copy's own sqlite and are deleted with it.
#
# -Before
# Reverts *this* turn: `applyFormulas` is taken off the read path (so nothing computes and the
# cells read empty) and the formula branch is taken out of `cell-editor.tsx` (so there is no editor
# to open). Every rewrite is checked before the app starts — a rewrite that silently matched nothing
# would report the *fixed* tree's score as a failure of the fix.
param([switch]$Before)
$ErrorActionPreference = "Stop"
$root = $PWD.Path
$qa = Join-Path $root "artifacts\qa-run-formula"
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

  $serverFile = Join-Path $qa "src\server\databases.ts"
  $serverText = [System.IO.File]::ReadAllText($serverFile, [System.Text.Encoding]::UTF8)
  $serverText = $serverText.Replace("const rows = applyFormulas(properties, await this.rows(sql, id));", "const rows = await this.rows(sql, id);")
  if ($serverText -match "applyFormulas\(properties") { throw "the read path was not reverted -- the pre-fix tree is not what this run thinks it is" }
  [System.IO.File]::WriteAllText($serverFile, $serverText, $utf8)

  $editor = Join-Path $qa "src\components\database\cell-editor.tsx"
  $editorText = [System.IO.File]::ReadAllText($editor, [System.Text.Encoding]::UTF8)
  $editorText = $editorText.Replace('if (property.type === "formula") {', 'if (property.type === "formula" && false) {')
  if ($editorText -notmatch 'property\.type === "formula" && false') { throw "the editor branch was not reverted -- the pre-fix tree is not what this run thinks it is" }
  [System.IO.File]::WriteAllText($editor, $editorText, $utf8)

  Write-Output "--- tree rebuilt as it was BEFORE this turn: no computed cells, no editor -- the probe must fail here ---"
}

$env:PORT = "3111"
$env:DATABASE_URL = "file:./data/qa.sqlite"
$env:RASPBERRY_AUTH_MODE = "local"
$env:RASPBERRY_LOCAL_DEV = "1"
$env:APP_ORIGIN = "http://127.0.0.1:3111"
$server = Start-Process -FilePath $node -ArgumentList "node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", "3111" -WorkingDirectory $qa -PassThru -NoNewWindow -RedirectStandardOutput "$qa\qa.out.log" -RedirectStandardError "$qa\qa.err.log"

try {
  $ready = $false
  for ($i = 0; $i -lt 45; $i++) {
    Start-Sleep -Seconds 2
    try {
      $health = (Invoke-WebRequest -Uri "http://127.0.0.1:3111/api/health" -UseBasicParsing -TimeoutSec 8).Content
      if ($health -match "ok") { $ready = $true; break }
    } catch { }
  }
  if (-not $ready) { Get-Content "$qa\qa.err.log" -Tail 20; throw "the disposable instance never became healthy" }

  $env:BASE = "http://127.0.0.1:3111"

  $code = 0
  foreach ($size in @(@(1400, 900), @(390, 844))) {
    # A fresh database per resolution: the probe rewrites the formula, and a shared seed would make
    # the second width start from the first one's edit.
    $seed = (node scripts\seed-qa-formula.mjs) -join ""
    $pageId = ([regex]'"pageId": "([0-9a-f-]{36})"').Match($seed).Groups[1].Value
    $databaseId = ([regex]'"databaseId": "([0-9a-f-]{36})"').Match($seed).Groups[1].Value
    $priceId = ([regex]'"priceId": "([0-9a-f-]{36})"').Match($seed).Groups[1].Value
    $totalId = ([regex]'"totalId": "([0-9a-f-]{36})"').Match($seed).Groups[1].Value
    $labelId = ([regex]'"labelId": "([0-9a-f-]{36})"').Match($seed).Groups[1].Value
    $openId = ([regex]'"openId": "([0-9a-f-]{36})"').Match($seed).Groups[1].Value
    if (-not $pageId -or -not $databaseId -or -not $priceId -or -not $totalId -or -not $labelId -or -not $openId) { throw "the seed printed no ids: $seed" }

    $env:PAGE = $pageId
    $env:DB = $databaseId
    $env:PRICE = $priceId
    $env:TOTAL = $totalId
    $env:LABEL = $labelId
    $env:OPEN = $openId
    Write-Output "--- $($size[0])x$($size[1]) ---"
    node scripts\verify-db-formula.mjs $($size[0]) $($size[1])
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
