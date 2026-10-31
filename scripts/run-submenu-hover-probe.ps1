# Runs the submenu-hover probe end to end, at both widths, against a disposable copy.
#
# WHY A COPY, EVEN THOUGH THE PROBE IS READ-ONLY
# The probe opens a real property menu in a real browser. Read-only is a property of the
# probe's *code*, not of the app: a stray click, a focus ring, an autosave that fires while
# a menu is open — any of those would land in the owner's file, and the rule is that a probe
# never touches it. So the app it drives is a throwaway: a copy of `src/` on port 3100,
# pointed at `artifacts/qa-run/data/qa.sqlite`, seeded with one sortable database.
#
# Two widths, deliberately. At 390px the submenu flips to the *left* of its row, which is a
# different gap in a different direction; a fix that only bridged the right-hand side would
# pass the wide run and fail on a phone.
$ErrorActionPreference = "Stop"
$root = $PWD.Path
$qa = Join-Path $root "artifacts\qa-run"
$node = Join-Path $root ".tools\node-v24.22.1-win-x64\node.exe"
$env:Path = (Join-Path $root ".tools\node-v24.22.1-win-x64") + ";" + $env:Path

# A killed run leaves the copy behind, because `finally` never ran. Starting on top of it
# mixes an old `src/` into a "fresh" sandbox — which is how a probe ends up verifying code
# that is not on disk.
if (Test-Path $qa) { Remove-Item -Recurse -Force $qa -ErrorAction SilentlyContinue }

New-Item -ItemType Directory -Force -Path $qa | Out-Null
Copy-Item package.json, tsconfig.json, next.config.ts, next-env.d.ts -Destination $qa -Force
robocopy src "$qa\src" /E /NFL /NDL /NJH /NJS /NP | Out-Null
robocopy scripts "$qa\scripts" /E /XF "*.log" /NFL /NDL /NJH /NJS /NP | Out-Null
New-Item -ItemType Directory -Force -Path "$qa\data" | Out-Null
if (-not (Test-Path "$qa\node_modules")) { cmd /c mklink /J "$qa\node_modules" "$root\node_modules" | Out-Null }

$env:PORT = "3100"
$env:DATABASE_URL = "file:./data/qa.sqlite"
$env:RASPBERRY_AUTH_MODE = "local"
$env:RASPBERRY_LOCAL_DEV = "1"
$env:APP_ORIGIN = "http://127.0.0.1:3100"
$server = Start-Process -FilePath $node -ArgumentList "node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", "3100" -WorkingDirectory $qa -PassThru -NoNewWindow -RedirectStandardOutput "$qa\qa.out.log" -RedirectStandardError "$qa\qa.err.log"

$code = 1
try {
  $ready = $false
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 2
    try {
      $health = (Invoke-WebRequest -Uri "http://127.0.0.1:3100/api/health" -UseBasicParsing -TimeoutSec 8).Content
      if ($health -match "ok") { $ready = $true; break }
    } catch { }
  }
  if (-not $ready) { Get-Content "$qa\qa.err.log" -Tail 15; throw "the disposable instance never became healthy" }

  $env:BASE = "http://127.0.0.1:3100"
  $seed = (node scripts\seed-qa-number.mjs) -join ""
  Write-Output $seed
  $pageId = ([regex]'"pageId": "([0-9a-f-]{36})"').Match($seed).Groups[1].Value
  if (-not $pageId) { throw "the seed printed no page id" }

  $env:PAGE = $pageId
  Write-Output "--- 1400x900 ---"
  node scripts\verify-db-submenu-hover.mjs 1400 900
  $code = $LASTEXITCODE
  # 640 is where the submenu flips to the *left* of its row and still leaves a real gap.
  # At 390 the flip is clamped to the 8px gutter and the surface covers its row instead —
  # no gap, no bug, and the probe says so rather than inventing a failure.
  Write-Output "--- 640x844 ---"
  node scripts\verify-db-submenu-hover.mjs 640 844
  if ($LASTEXITCODE -ne 0) { $code = $LASTEXITCODE }
} finally {
  try { Stop-Process -Id $server.Id -Force } catch { }
  # The copy is a build artefact, not evidence. Leaving it behind is what put 232 files and a
  # second, stale database in `artifacts/` for the next session to trip over.
  Remove-Item -Recurse -Force $qa -ErrorAction SilentlyContinue
}
exit $code
