<#
.SYNOPSIS
Publish compiled FG1 ESP32 images for one-button USB installation.
.DESCRIPTION
Does not compile, flash, or deploy. Separate images preserve NVS/counters.
Checks the recorded board profile and all inputs before publishing the manifest.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$BuildDirectory,
  [Parameter(Mandatory = $true)][string]$BootAppFirmware
)
$ErrorActionPreference = 'Stop'
$repoDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$destination = Join-Path $repoDirectory 'wildfire-dashboard\public\firmware'
$buildSource = (Resolve-Path -LiteralPath $BuildDirectory).Path
$options = Get-Content -LiteralPath (Join-Path $buildSource 'build.options.json') -Raw | ConvertFrom-Json
if ($options.fqbn -ne 'esp32:esp32:ttgo-lora32:FlashFreq=40') {
  throw 'Compile FG1 for ESP32, DIO, 40 MHz and 4 MB before publishing.'
}
$sources = @(
  @{ source = Join-Path $buildSource 'provisioned_sensor.ino.bootloader.bin'; path = 'node-bootloader.bin'; offset = 0x1000; min = 4096; max = 0x7000 },
  @{ source = Join-Path $buildSource 'provisioned_sensor.ino.partitions.bin'; path = 'node-partitions.bin'; offset = 0x8000; min = 3072; max = 4096 },
  @{ source = (Resolve-Path -LiteralPath $BootAppFirmware).Path; path = 'node-boot-app.bin'; offset = 0xe000; min = 8192; max = 8192 },
  @{ source = Join-Path $buildSource 'provisioned_sensor.ino.bin'; path = 'node-app.bin'; offset = 0x10000; min = 65536; max = 0x140000 }
)
function Assert-NoReparse([string]$Path) {
  $inspect = [IO.Path]::GetFullPath($Path)
  while ($inspect) {
    if ((Test-Path -LiteralPath $inspect) -and
        ((Get-Item -LiteralPath $inspect -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
      throw 'Symbolic links and junctions are not accepted.'
    }
    $inspect = Split-Path -Parent $inspect
  }
}
Assert-NoReparse $destination
$parts = foreach ($part in $sources) {
  Assert-NoReparse $part.source
  $file = Get-Item -LiteralPath $part.source
  if ($file.PSIsContainer -or $file.Length -lt $part.min -or $file.Length -gt $part.max -or $file.Length % 4) {
    throw ('Invalid firmware size: ' + $part.path)
  }
  $bytes = [IO.File]::ReadAllBytes($file.FullName)
  if (($part.offset -eq 0x1000 -or $part.offset -eq 0x10000) -and $bytes[0] -ne 0xe9) {
    throw 'Missing ESP32 image header.'
  }
  if ($part.offset -eq 0x1000 -and ($bytes[2] -ne 2 -or $bytes[3] -ne 0x20)) {
    throw 'Bootloader must use DIO / 40 MHz / 4 MB.'
  }
  @{
    path = $part.path; offset = $part.offset; size = $file.Length
    sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    md5 = (Get-FileHash -LiteralPath $file.FullName -Algorithm MD5).Hash.ToLowerInvariant()
  }
}
# Validate the compiled partition table rather than silently overwriting NVS.
$table = [IO.File]::ReadAllBytes($sources[1].source)
$expectedPartitions = @(
  @(1, 2, 0x9000, 0x5000), @(1, 0, 0xe000, 0x2000),
  @(0, 0x10, 0x10000, 0x140000), @(0, 0x11, 0x150000, 0x140000)
)
for ($index = 0; $index -lt $expectedPartitions.Count; $index++) {
  $start = $index * 32
  $expected = $expectedPartitions[$index]
  if ([BitConverter]::ToUInt16($table, $start) -ne 0x50aa -or
      $table[$start + 2] -ne $expected[0] -or $table[$start + 3] -ne $expected[1] -or
      [BitConverter]::ToUInt32($table, $start + 4) -ne $expected[2] -or
      [BitConverter]::ToUInt32($table, $start + 8) -ne $expected[3]) {
    throw 'Use the default ESP32 partition table matching FG1 NVS and app offsets.'
  }
}
$backupDirectory = Join-Path $repoDirectory ('.codex-build\firmware-releases\FG1-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
Assert-NoReparse $backupDirectory
New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
foreach ($path in @($parts.path) + @('manifest.json')) {
  $target = Join-Path $destination $path
  Assert-NoReparse $target
  if (Test-Path -LiteralPath $target) { Copy-Item -LiteralPath $target -Destination (Join-Path $backupDirectory $path) }
}
foreach ($part in $sources) { Copy-Item -LiteralPath $part.source -Destination (Join-Path $destination $part.path) }
$manifest = @{
  name = 'ForestGuard FG1 LILYGO LoRa32 433'; version = '1.1.1'; protocol = 'FG1'
  board_fqbn = $options.fqbn; builds = @(@{ chipFamily = 'ESP32'; parts = @($parts) })
}
[IO.File]::WriteAllText((Join-Path $destination 'manifest.json'), ($manifest | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
Write-Output 'Published compiled FG1 node images. No VM deployment or board flashing performed.'
