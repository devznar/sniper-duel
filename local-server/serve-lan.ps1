# 어택서든 게임서버 (같은 와이파이/사내망용)
# 이 폴더의 HTML 게임을 내 PC의 네트워크 주소로 열어 줍니다.
# 다른 PC/휴대폰은 QR 코드나 링크(http://내IP:포트/)로 접속할 수 있습니다.
# 사용법: 같은 폴더의 [게임서버_실행.bat] 더블클릭. 종료: 이 창 닫기 또는 Ctrl+C
param([int]$Port = 8080, [switch]$Loopback, [switch]$NoBrowser)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
# local-server 폴더 안에 있으면 상위(프로젝트) 폴더의 index.html 을 서비스
if (-not (Get-ChildItem -LiteralPath $root -Filter *.html | Where-Object { $_.Length -gt 1000 })) { $root = Split-Path -Parent $root }
$page = Get-ChildItem -LiteralPath $root -Filter *.html | Where-Object { $_.Length -gt 1000 } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $page) { Write-Host '이 폴더에서 HTML 게임 파일을 찾을 수 없습니다.' -ForegroundColor Red; exit 1 }

function Get-LanIp {
  try {
    $cfg = Get-NetIPConfiguration -ErrorAction Stop |
      Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } | Select-Object -First 1
    if ($cfg) { return @($cfg.IPv4Address)[0].IPAddress }
  } catch {}
  $a = [Net.Dns]::GetHostAddresses([Net.Dns]::GetHostName()) |
    Where-Object { $_.AddressFamily -eq 'InterNetwork' -and -not $_.ToString().StartsWith('127.') -and -not $_.ToString().StartsWith('169.254.') } |
    Select-Object -First 1
  if ($a) { return $a.ToString() }
  return '127.0.0.1'
}

if ($Loopback) { $ip = '127.0.0.1'; $bind = [Net.IPAddress]::Loopback } else { $ip = Get-LanIp; $bind = [Net.IPAddress]::Any }

$listener = $null
for ($p = $Port; $p -lt $Port + 20; $p++) {
  try { $listener = New-Object Net.Sockets.TcpListener($bind, $p); $listener.Start(); $Port = $p; break }
  catch { $listener = $null }
}
if (-not $listener) { Write-Host '사용 가능한 포트를 찾지 못했습니다.' -ForegroundColor Red; exit 1 }

$url = "http://${ip}:$Port/"
Write-Host ''
Write-Host '  ===== 어택서든 게임서버 실행 중 =====' -ForegroundColor Yellow
Write-Host "  게임 파일 : $($page.Name)"
Write-Host "  접속 주소 : $url" -ForegroundColor Green
Write-Host ''
Write-Host '  1) 열린 브라우저에서 [방 만들기] → 대기실에 QR 코드가 나타납니다.'
Write-Host '  2) 같은 와이파이/사내망의 PC·휴대폰으로 QR을 찍거나 위 주소를 입력하세요.'
Write-Host '  3) Windows 방화벽 창이 뜨면 [개인 네트워크] 허용을 눌러야 다른 PC가 접속됩니다.'
Write-Host '  이 창을 닫으면 서버가 종료됩니다 (이미 시작한 게임은 계속 진행됩니다).'
Write-Host ''
if (-not $NoBrowser) { Start-Process $url }

$types = @{
  '.html' = 'text/html; charset=utf-8'; '.htm' = 'text/html; charset=utf-8'
  '.js' = 'application/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
  '.json' = 'application/json'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'
  '.gif' = 'image/gif'; '.svg' = 'image/svg+xml'; '.ico' = 'image/x-icon'; '.mp3' = 'audio/mpeg'; '.wav' = 'audio/wav'
}

function Send-Response($client) {
  $method = $null
  try {
    $client.ReceiveTimeout = 3000
    $stream = $client.GetStream()
    $reader = New-Object IO.StreamReader($stream, [Text.Encoding]::ASCII, $false, 4096, $true)
    $line = $reader.ReadLine()
    while ((($h = $reader.ReadLine()) -ne $null) -and $h -ne '') {}
    $status = '200 OK'; $ctype = 'text/plain; charset=utf-8'; $body = $null
    if ($line -match '^(GET|HEAD) (\S+)') {
      $method = $Matches[1]
      $path = ($Matches[2] -split '\?')[0]
      $name = [IO.Path]::GetFileName([Uri]::UnescapeDataString($path))
      if ([string]::IsNullOrEmpty($name)) { $file = $page.FullName } else { $file = Join-Path $root $name }
      $ext = [IO.Path]::GetExtension($file).ToLower()
      if ($types.ContainsKey($ext) -and (Test-Path -LiteralPath $file -PathType Leaf)) {
        $body = [IO.File]::ReadAllBytes($file); $ctype = $types[$ext]
        if ($ext -like '.htm*') { Write-Host ("  [{0}] 접속: {1}" -f (Get-Date -Format 'HH:mm:ss'), $client.Client.RemoteEndPoint.Address) }
      } else { $status = '404 Not Found'; $body = [Text.Encoding]::UTF8.GetBytes('Not found') }
    } else { $status = '400 Bad Request'; $body = [Text.Encoding]::UTF8.GetBytes('Bad request') }
    $hdr = "HTTP/1.1 $status`r`nContent-Type: $ctype`r`nContent-Length: $($body.Length)`r`nCache-Control: no-cache`r`nConnection: close`r`n`r`n"
    $hb = [Text.Encoding]::ASCII.GetBytes($hdr)
    $stream.Write($hb, 0, $hb.Length)
    if ($method -ne 'HEAD') { $stream.Write($body, 0, $body.Length) }
    $stream.Flush()
  } catch {} finally { $client.Close() }
}

# 브라우저가 미리 열어 두는 빈 연결 때문에 멈추지 않도록, 데이터가 도착한 연결만 처리
$waiting = New-Object System.Collections.ArrayList
try {
  while ($true) {
    while ($listener.Pending()) { [void]$waiting.Add(@{ c = $listener.AcceptTcpClient(); t = [DateTime]::Now }) }
    foreach ($e in @($waiting)) {
      $c = $e.c
      if ($c.Available -gt 0) { [void]$waiting.Remove($e); Send-Response $c }
      elseif (([DateTime]::Now - $e.t).TotalSeconds -gt 20) { [void]$waiting.Remove($e); $c.Close() }
    }
    Start-Sleep -Milliseconds 15
  }
} finally { $listener.Stop() }
