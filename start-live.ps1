param(
  [switch]$BackendOnly
)

$ErrorActionPreference = 'Stop'
$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Join-Path $RootDir 'wildfire-backend'
$DashboardDir = Join-Path $RootDir 'wildfire-dashboard'
$HealthUrl = 'http://localhost:4000/api/health'
$DashboardUrl = 'http://localhost:5173'

function Convert-ToPowerShellLiteral([string]$Value) {
  return "'" + $Value.Replace("'", "''") + "'"
}

function Test-ApiHealth {
  try {
    $response = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 2
    if ($response.service -ne 'wildfire-backend') {
      return $null
    }
    return $response
  } catch {
    return $null
  }
}

function Wait-ApiHealth([int]$Seconds = 30) {
  $deadline = (Get-Date).AddSeconds($Seconds)

  do {
    $health = Test-ApiHealth
    if ($health) {
      return $health
    }

    Start-Sleep -Seconds 1
  } while ((Get-Date) -lt $deadline)

  return $null
}

Write-Host ''
Write-Host 'ForestGuard live startup' -ForegroundColor Green
Write-Host '------------------------'

$health = Test-ApiHealth
if ($health) {
  Write-Host 'Backend is already running on http://localhost:4000'
} else {
  $backendLiteral = Convert-ToPowerShellLiteral $BackendDir
  Write-Host 'Starting backend on http://localhost:4000 ...'
  Start-Process powershell.exe -ArgumentList @(
    '-NoExit',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    "Set-Location -LiteralPath $backendLiteral; node src/server.js"
  )

  $health = Wait-ApiHealth 30
}

if (-not $health) {
  Write-Host ''
  Write-Host 'Backend did not become ready.' -ForegroundColor Red
  Write-Host 'Check that MongoDB is running and port 4000 is available.'
  exit 1
}

Write-Host ''
Write-Host 'Backend ready.' -ForegroundColor Green
Write-Host "Mongo state: $($health.mongo_state)"
Write-Host "Gateway: connected=$($health.gateway.connected) transport=$($health.gateway.transport)"

if ($BackendOnly) {
  exit 0
}

$dashboardLiteral = Convert-ToPowerShellLiteral $DashboardDir
Write-Host ''
Write-Host "Starting dashboard on $DashboardUrl ..."
Start-Process powershell.exe -ArgumentList @(
  '-NoExit',
  '-ExecutionPolicy',
  'Bypass',
  '-Command',
  "Set-Location -LiteralPath $dashboardLiteral; npm.cmd run dev"
)

Write-Host ''
Write-Host "Open $DashboardUrl"
Write-Host 'If the page says live data is unavailable, check the backend, Gateway, and Sensor Node connections.'
