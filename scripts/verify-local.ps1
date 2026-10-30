$ErrorActionPreference = "Continue"
$node = (Resolve-Path ".tools\node-v24.22.1-win-x64\node.exe").Path
$port = 3999
$out = Join-Path $env:TEMP "rasp-probe-out.log"
$err = Join-Path $env:TEMP "rasp-probe-err.log"
Remove-Item $out, $err -ErrorAction SilentlyContinue

$env:RASPBERRY_AUTH_MODE = "local"
$env:RASPBERRY_LOCAL_DEV = "1"
$env:PORT = "$port"
$env:APP_ORIGIN = "http://localhost:$port"
$env:DATABASE_URL = ""

$p = Start-Process -FilePath $node -ArgumentList "scripts/serve.mjs" -NoNewWindow -PassThru `
  -RedirectStandardOutput $out -RedirectStandardError $err

# wait for the port to answer
$up = $false
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $r = Invoke-WebRequest "http://127.0.0.1:$port/api/health" -UseBasicParsing -TimeoutSec 2
    $up = $true
    break
  } catch {
    if ($p.HasExited) { break }
  }
}

echo "=== server started: $up (pid $($p.Id)) ==="
if (-not $up) {
  echo "--- STDOUT ---"; Get-Content $out -ErrorAction SilentlyContinue
  echo "--- STDERR ---"; Get-Content $err -ErrorAction SilentlyContinue
  if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force }
  exit 1
}

function Probe($label, $url, $method = "GET") {
  try {
    $req = [System.Net.HttpWebRequest]::Create($url)
    $req.Method = $method
    $req.Timeout = 8000
    $req.AllowAutoRedirect = $false
    $resp = $req.GetResponse()
    $code = [int]$resp.StatusCode
    $loc = $resp.Headers["Location"]
    $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
    $body = $reader.ReadToEnd()
    $reader.Close(); $resp.Close()
  } catch [System.Net.WebException] {
    if ($_.Exception.Response) {
      $resp = $_.Exception.Response
      $code = [int]$resp.StatusCode
      $loc = $resp.Headers["Location"]
      $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
      $body = $reader.ReadToEnd()
      $reader.Close(); $resp.Close()
    } else {
      echo "[$label] $method $url -> EXCEPTION: $($_.Exception.Message)"
      return
    }
  } catch {
    echo "[$label] $method $url -> EXCEPTION: $($_.Exception.Message)"
    return
  }
  if ($body.Length -gt 240) { $body = $body.Substring(0, 240) + "..." }
  echo "[$label] $method $url -> HTTP $code"
  if ($loc) { echo "    location: $loc" }
  echo "    body: $body"
}

echo ""
echo "=== LIVE PROBES (local mode) ==="
Probe "health" "http://127.0.0.1:$port/api/health"
Probe "pages"  "http://127.0.0.1:$port/api/pages"
Probe "root"   "http://127.0.0.1:$port/"
Probe "login"  "http://127.0.0.1:$port/login"
Probe "authstart" "http://127.0.0.1:$port/api/auth/google/start"

echo ""
echo "=== server log tail ==="
Get-Content $err -Tail 5 -ErrorAction SilentlyContinue

Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
Remove-Item Env:\RASPBERRY_AUTH_MODE, Env:\RASPBERRY_LOCAL_DEV, Env:\PORT, Env:\APP_ORIGIN, Env:\DATABASE_URL -ErrorAction SilentlyContinue
echo ""
echo "=== stopped ==="
