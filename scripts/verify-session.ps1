$ErrorActionPreference = "Continue"
$node = (Resolve-Path ".tools\node-v24.22.1-win-x64\node.exe").Path
$port = 4001
$out = Join-Path $env:TEMP "rasp-sess-out.log"
$err = Join-Path $env:TEMP "rasp-sess-err.log"
Remove-Item $out, $err -ErrorAction SilentlyContinue

# throwaway database so the real ./data/raspberry.sqlite is never touched
$db = Join-Path $env:TEMP "rasp-probe-session.sqlite"
Remove-Item $db, "$db-shm", "$db-wal" -ErrorAction SilentlyContinue

$env:RASPBERRY_AUTH_MODE     = "session"
$env:GOOGLE_CLIENT_ID        = "probe.apps.googleusercontent.com"
$env:GOOGLE_CLIENT_SECRET    = "probe-secret"
$env:RASPBERRY_PUBLIC_ORIGIN = "https://raspberry.example.com"
$env:RASPBERRY_ALLOWED_EMAILS = "preston@example.com"
$env:RASPBERRY_MAIL_FROM     = "login@example.com"
$env:RASPBERRY_MAIL_ALLOW_CONSOLE = "1"
$env:PORT = "$port"
$env:DATABASE_URL = "file:$($db -replace '\\','/')"

$p = Start-Process -FilePath $node -ArgumentList "scripts/serve.mjs" -NoNewWindow -PassThru `
  -RedirectStandardOutput $out -RedirectStandardError $err

$up = $false
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $t = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:$port/api/health")
    $t.Host = "raspberry.example.com"
    $t.Timeout = 2000
    $t.GetResponse().Close()
    $up = $true; break
  } catch {
    if ($_.Exception.Response) { $up = $true; break }
    if ($p.HasExited) { break }
  }
}

echo "=== session-mode server started: $up (pid $($p.Id)) ==="
if (-not $up) {
  echo "--- STDOUT ---"; Get-Content $out -ErrorAction SilentlyContinue
  echo "--- STDERR ---"; Get-Content $err -ErrorAction SilentlyContinue
  if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force }
  exit 1
}

function Probe($label, $path, $method = "GET", $hostHeader = "raspberry.example.com", $origin = $null, $cookie = $null, $body = $null, $proto = "https") {
  $url = "http://127.0.0.1:$port$path"
  $loc = ""; $code = 0; $text = ""
  try {
    $req = [System.Net.HttpWebRequest]::Create($url)
    $req.Method = $method
    $req.Host = $hostHeader
    $req.Timeout = 8000
    $req.AllowAutoRedirect = $false
    $req.UserAgent = "raspberry-probe"
    if ($proto) { $req.Headers.Add("X-Forwarded-Proto", $proto) }
    if ($origin) { $req.Headers.Add("Origin", $origin) }
    if ($cookie) { $req.Headers.Add("Cookie", $cookie) }
    if ($body) {
      $req.ContentType = "application/json"
      $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
      $req.ContentLength = $bytes.Length
      $s = $req.GetRequestStream(); $s.Write($bytes, 0, $bytes.Length); $s.Close()
    }
    $resp = $req.GetResponse()
    $code = [int]$resp.StatusCode; $loc = $resp.Headers["Location"]
    $text = (New-Object System.IO.StreamReader($resp.GetResponseStream())).ReadToEnd()
    $resp.Close()
  } catch [System.Net.WebException] {
    if ($_.Exception.Response) {
      $resp = $_.Exception.Response
      $code = [int]$resp.StatusCode; $loc = $resp.Headers["Location"]
      $text = (New-Object System.IO.StreamReader($resp.GetResponseStream())).ReadToEnd()
      $resp.Close()
    } else {
      echo "[$label] -> EXCEPTION: $($_.Exception.Message)"; return
    }
  } catch {
    echo "[$label] -> EXCEPTION: $($_.Exception.Message)"; return
  }
  if ($text.Length -gt 200) { $text = $text.Substring(0, 200) + "..." }
  echo "[$label] $method $path -> HTTP $code"
  if ($loc) { echo "    location: $loc" }
  echo "    body: $text"
}

echo ""
echo "=== THE AUTHORIZATION GATE ==="
Probe "0 plaintext, no TLS proxy" "/api/pages"          "GET"  "raspberry.example.com" $null $null $null $null
Probe "1 no cookie, api"        "/api/pages"            "GET"
Probe "2 no cookie, html"       "/"                     "GET"
Probe "3 wrong Host header"     "/api/pages"            "GET"  "evil.example.com"
Probe "4 forged cookie"         "/api/pages"            "GET"  "raspberry.example.com" $null "raspberry_session=forged-token-value"
Probe "5 POST without Origin"   "/api/auth/verify-code" "POST" "raspberry.example.com" $null $null '{"code":"123456"}'
Probe "6 POST cross-site Origin" "/api/auth/verify-code" "POST" "raspberry.example.com" "https://evil.example.com" $null '{"code":"123456"}'

echo ""
echo "=== THE SIGN-IN ENTRY POINT ==="
Probe "7 start sign-in"  "/api/auth/google/start" "GET"
Probe "8 callback, no state/code" "/api/auth/google/callback" "GET"
Probe "9 callback, forged state"  "/api/auth/google/callback?code=abc&state=forged" "GET" "raspberry.example.com" $null "raspberry_oauth=forged.1.forged-state"
Probe "10 login page"    "/login" "GET"

echo ""
echo "=== mail backend output (console) ==="
Get-Content $err -Tail 6 -ErrorAction SilentlyContinue

Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
Remove-Item $db, "$db-shm", "$db-wal" -ErrorAction SilentlyContinue
Remove-Item Env:\RASPBERRY_AUTH_MODE, Env:\GOOGLE_CLIENT_ID, Env:\GOOGLE_CLIENT_SECRET, Env:\RASPBERRY_PUBLIC_ORIGIN, Env:\RASPBERRY_ALLOWED_EMAILS, Env:\RASPBERRY_MAIL_FROM, Env:\RASPBERRY_MAIL_ALLOW_CONSOLE, Env:\PORT, Env:\DATABASE_URL -ErrorAction SilentlyContinue
echo ""
echo "=== stopped, temp db removed ==="
