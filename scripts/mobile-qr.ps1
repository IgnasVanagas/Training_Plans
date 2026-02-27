param(
  [int]$FrontendPort = 3000,
  [switch]$UseTunnel
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$frontendDir = Join-Path $root "frontend"
$mobileDir = Join-Path $root "mobile-expo"

if (-not (Test-Path $frontendDir)) {
  throw "Frontend folder not found: $frontendDir"
}
if (-not (Test-Path $mobileDir)) {
  throw "Expo app folder not found: $mobileDir"
}

$ipCandidates = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object {
    $_.IPAddress -notlike "169.254.*" -and
    $_.IPAddress -notlike "127.*" -and
    $_.PrefixOrigin -ne "WellKnown"
  } |
  Sort-Object InterfaceMetric

if (-not $ipCandidates) {
  throw "Could not detect a LAN IPv4 address."
}

$localIp = $ipCandidates[0].IPAddress
$webUrl = "http://$localIp`:$FrontendPort"
$qrUrl = "https://api.qrserver.com/v1/create-qr-code/?size=360x360&data=$([uri]::EscapeDataString($webUrl))"
$mobileEnvFile = Join-Path $mobileDir ".env.local"
$lastUrlFile = Join-Path $root "mobile-last-url.txt"

Set-Content -Path $mobileEnvFile -Value "EXPO_PUBLIC_WEB_URL=$webUrl" -Encoding UTF8
Set-Content -Path $lastUrlFile -Value @("WEB_URL=$webUrl", "QR_IMAGE=$qrUrl") -Encoding UTF8

try {
  Set-Clipboard -Value $webUrl
} catch {
}

Write-Host "===========================================" -ForegroundColor DarkCyan
Write-Host " Training Plans Mobile (Expo Go)" -ForegroundColor Cyan
Write-Host "===========================================" -ForegroundColor DarkCyan
Write-Host "Web URL:        $webUrl" -ForegroundColor Green
Write-Host "URL copied to clipboard." -ForegroundColor Green
Write-Host "Fallback QR URL: $qrUrl" -ForegroundColor Green
Write-Host "Saved details:   $lastUrlFile" -ForegroundColor Green
Write-Host "Starting Vite dev server (LAN)..." -ForegroundColor Yellow

$frontendProcess = Start-Process -FilePath "npm.cmd" -ArgumentList "run","dev","--","--host","0.0.0.0","--port",$FrontendPort -WorkingDirectory $frontendDir -PassThru

Start-Sleep -Seconds 3

try {
  Write-Host "Starting Expo (scan QR with Expo Go)..." -ForegroundColor Yellow
  Set-Location $mobileDir
  $env:EXPO_PUBLIC_WEB_URL = $webUrl

  if ($UseTunnel) {
    npx expo start --tunnel
  }
  else {
    npx expo start --lan
  }
}
finally {
  if ($frontendProcess -and -not $frontendProcess.HasExited) {
    Write-Host "Stopping Vite dev server..." -ForegroundColor Yellow
    Stop-Process -Id $frontendProcess.Id -Force
  }
}
