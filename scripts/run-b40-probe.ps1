# Runs the B40/B41 browser probe against a disposable copy of the app, end to end.
#
# WHY A COPY
# The probe has to prove a *write* (the 409 refusal and the "clear 2 cells" answer), and the
# rule is that no write lands in the owner's database. So this starts a second dev server
# from a copy of the project on port 3100, pointed at `artifacts/qa-run/data/qa.sqlite`.
# The copy shares `node_modules` through a junction, so it costs a few hundred KB.
#
# The server is started, used and stopped inside *one* command, because a background child
# of a finished shell does not reliably outlive it on this machine.
$ErrorActionPreference = "Stop"
$root = $PWD.Path
$qa = Join-Path $root "artifacts\qa-run"
$node = Join-Path $root ".tools\node-v24.22.1-win-x64\node.exe"
$env:Path = (Join-Path $root ".tools\node-v24.22.1-win-x64") + ";" + $env:Path

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
# The next binary is called directly, from the copy, because a project's directory is the
# process's working directory: going through `scripts/local.mjs` made it ambiguous which tree
# was being served, and a server rooted at the repo while the probe looked for the copy's page
# is exactly how this ran green once, then failed twice.
$server = Start-Process -FilePath $node -ArgumentList "node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", "3100" -WorkingDirectory $qa -PassThru -NoNewWindow -RedirectStandardOutput "$qa\qa.out.log" -RedirectStandardError "$qa\qa.err.log"

try {
  $ready = $false
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Seconds 2
    try {
      $health = (Invoke-WebRequest -Uri "http://127.0.0.1:3100/api/health" -UseBasicParsing -TimeoutSec 8).Content
      if ($health -match "ok") { $ready = $true; break }
    } catch { }
  }
  if (-not $ready) { Get-Content "$qa\qa.err.log" -Tail 15; throw "the disposable instance never became healthy" }

  $env:BASE = "http://127.0.0.1:3100"
  $seed = (node scripts\seed-qa.mjs) -join ""
  Write-Output $seed
  $pageId = ([regex]'"pageId": "([0-9a-f-]{36})"').Match($seed).Groups[1].Value
  if (-not $pageId) { throw "the seed printed no page id" }

  $env:PAGE_ID = $pageId
  $env:ALLOW_WRITES = "1"
  Write-Output "--- 1400x900 ---"
  $env:W = "1400"; $env:H = "900"
  node scripts\verify-database-b40.mjs
  $code = $LASTEXITCODE
  Write-Output "--- 390x844 ---"
  $env:W = "390"; $env:H = "844"
  node scripts\verify-database-b40.mjs
  if ($LASTEXITCODE -ne 0) { $code = $LASTEXITCODE }
} finally {
  try { Stop-Process -Id $server.Id -Force } catch { }
}
exit $code
