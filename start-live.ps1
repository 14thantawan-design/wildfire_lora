param(
  [switch]$BackendOnly,
  [switch]$KeepSerialMonitor
)

$ErrorActionPreference = 'Stop'
$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Join-Path $RootDir 'wildfire-backend'
$DashboardDir = Join-Path $RootDir 'wildfire-dashboard'
$BackendEnvPath = Join-Path $BackendDir '.env'
$HealthUrl = 'http://localhost:4000/api/health'
$DashboardUrl = 'http://localhost:5173'

function Convert-ToPowerShellLiteral([string]$Value) {
  return "'" + $Value.Replace("'", "''") + "'"
}

function Test-ApiHealth {
  try {
    return Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 2
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

$serialPort = ''
if (Test-Path -LiteralPath $BackendEnvPath) {
  $serialLine = Get-Content -LiteralPath $BackendEnvPath |
    Where-Object { $_ -match '^\s*SERIAL_PORT\s*=' } |
    Select-Object -First 1

  if ($serialLine) {
    $serialPort = ($serialLine -replace '^\s*SERIAL_PORT\s*=\s*', '').Trim()
  }
}

if ($serialPort -and -not $KeepSerialMonitor) {
  $serialMonitors = Get-Process serial-monitor -ErrorAction SilentlyContinue
  if ($serialMonitors) {
    Write-Host "Closing Arduino Serial Monitor so backend can use $serialPort..."
    $serialMonitors | Stop-Process -Force
  }
} elseif (-not $serialPort) {
  Write-Host 'SERIAL_PORT is empty; backend will receive packets by HTTP /api/packets.'
}

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
  Write-Host 'Check that MongoDB is running and COM3 is not open in Arduino Serial Monitor.'
  exit 1
}

Write-Host ''
Write-Host 'Backend ready.' -ForegroundColor Green
Write-Host "Mongo state: $($health.mongo_state)"
Write-Host "Serial: $($health.serial.path) open=$($health.serial.is_open) error=$($health.serial.open_error)"

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
Write-Host 'If the page still says demo data, wait for packet saved in the backend window and refresh.'
