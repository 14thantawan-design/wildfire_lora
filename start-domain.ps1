param(
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$DashboardDir = Join-Path $RootDir 'wildfire-dashboard'
$StartLiveScript = Join-Path $RootDir 'start-live.ps1'
$HealthUrl = 'http://localhost:4000/api/health'

Write-Host ''
Write-Host 'ForestGuard domain startup' -ForegroundColor Green
Write-Host '--------------------------'

if (-not $SkipBuild) {
  Write-Host 'Building the public/admin dashboard...'
  Push-Location $DashboardDir
  try {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) {
      throw "Dashboard build failed with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

& $StartLiveScript -BackendOnly
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

try {
  $health = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 5
} catch {
  Write-Host 'Backend health check failed.' -ForegroundColor Red
  exit 1
}

if (-not $health.dashboard_served) {
  Write-Host ''
  Write-Host 'The backend was already running before the dashboard build was loaded.' -ForegroundColor Yellow
  Write-Host 'Close the backend window, then run this script again.'
  exit 1
}

Write-Host ''
Write-Host 'Local production view: http://localhost:4000' -ForegroundColor Green
Write-Host 'Public route: https://wildfire.nattaphat.me'
Write-Host 'Admin route:  https://admin.nattaphat.me'
Write-Host 'Cloudflare Tunnel must remain Healthy for domain access.'
