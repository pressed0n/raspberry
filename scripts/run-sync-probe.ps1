# Runs the live-sync probe against a disposable copy of the app, end to end.
#
# WHY A COPY
# The probe creates a page and retitles it, twice. The rule in docs/TESTING.md is that no
# probe points its gestures at the owner's instance, and a copy is the only way to be sure.
# Port 3112: groups 3103, dates 3104, checkbox 3105, row-open 3106, url 3107, places 3108,
# place card 3109, files 3110, formula 3111 — and two runners sharing a port is a probe
# talking to another feature's server.
#
# WHY TWO BROWSERS MAKE THIS SLOW AND ARE STILL WORTH IT
# Two dev-server compiles, two Chrome instances and ~15 seconds of waiting per resolution.
# The alternative is asserting inside one page that a change *would* propagate, which is the
# same class of claim as a comment: it cannot fail.
#
# -Before
# Deletes the sync endpoint from the copy, so the second client polls a 404 and nothing ever
# arrives — the app as it was before this turn. The probe must fail there, or it is a
# paragraph with a shebang. A missing endpoint rather than a removed client call because the
# surgery has to leave the copy *compiling*: an unused import is a type error in some
# configurations, and a probe that fails to build proves nothing about the feature.
param([switch]$Before)
$ErrorActionPreference = "Stop"
$root = $PWD.Path
$qa = Join-Path $root "artifacts\qa-run-live-sync"
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
  Remove-Item -Recurse -Force "$qa\src\app\api\sync" -ErrorAction SilentlyContinue
  Write-Output "--- tree rebuilt as it was BEFORE this turn (no /api/sync): the probe must fail here ---"
}

$env:PORT = "3112"
$env:DATABASE_URL = "file:./data/qa.sqlite"
$env:RASPBERRY_AUTH_MODE = "local"
$env:RASPBERRY_LOCAL_DEV = "1"
$env:APP_ORIGIN = "http://127.0.0.1:3112"
$server = Start-Process -FilePath $node -ArgumentList "node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", "3112" -WorkingDirectory $qa -PassThru -NoNewWindow -RedirectStandardOutput "$qa\qa.out.log" -RedirectStandardError "$qa\qa.err.log"

try {
  $ready = $false
  for ($i = 0; $i -lt 45; $i++) {
    Start-Sleep -Seconds 2
    try {
      $health = (Invoke-WebRequest -Uri "http://127.0.0.1:3112/api/health" -UseBasicParsing -TimeoutSec 8).Content
      if ($health -match "ok") { $ready = $true; break }
    } catch { }
  }
  if (-not $ready) { Get-Content "$qa\qa.err.log" -Tail 20; throw "the disposable instance never became healthy" }

  $env:BASE = "http://127.0.0.1:3112"

  $code = 0
  foreach ($size in @(@(1400, 900), @(390, 844))) {
    Write-Output "--- $($size[0])x$($size[1]) ---"
    node scripts\verify-live-sync.mjs $($size[0]) $($size[1])
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
