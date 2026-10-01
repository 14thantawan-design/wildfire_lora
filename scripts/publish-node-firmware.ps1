<#
.SYNOPSIS
Publish a verified merged ESP32 node binary and self-hosted ESP Web Tools 10.4.0.
.DESCRIPTION
Does not compile, download, flash, or deploy. Only accepts an existing merged
FG1 build and the dist/web directory from the pinned official npm package.
Existing files are backed up inside public/firmware/releases before overwrite.
.PARAMETER MergedFirmware
Absolute path to the verified FG1 LILYGO LoRa32 433 merged binary.
.PARAMETER WebToolsWebDirectory
Absolute path to esp-web-tools@10.4.0/dist/web from the official package.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$MergedFirmware,
  [Parameter(Mandatory = $true)][string]$WebToolsWebDirectory
)
$ErrorActionPreference = 'Stop'
$firmwareSource = (Resolve-Path -LiteralPath $MergedFirmware).Path
$webToolsSource = (Resolve-Path -LiteralPath $WebToolsWebDirectory).Path
$sourceItem = Get-Item -LiteralPath $firmwareSource
if ($sourceItem.PSIsContainer -or $sourceItem.Length -lt 65536 -or $sourceItem.Length -gt 4194304) {
  throw 'Expected a merged ESP32 FG1 binary between 64 KiB and 4 MiB.'
}
$bytes = [IO.File]::ReadAllBytes($firmwareSource)
if ($bytes[4096] -ne 0xE9) { throw 'Missing ESP32 bootloader header at 0x1000. Do not use an application-only .bin.' }
$packagePath = [IO.Path]::GetFullPath((Join-Path $webToolsSource '..\..\package.json'))
$package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
if ($package.name -ne 'esp-web-tools' -or $package.version -ne '10.4.0') {
  throw 'Use the official esp-web-tools@10.4.0 dist/web directory.'
}
if (-not (Test-Path -LiteralPath (Join-Path $webToolsSource 'install-button.js') -PathType Leaf)) {
  throw 'Missing install-button.js.'
}
$sourceFiles = @(Get-ChildItem -LiteralPath $webToolsSource -Recurse -Force)
if ((Get-Item -LiteralPath $webToolsSource).Attributes -band [IO.FileAttributes]::ReparsePoint) {
  throw 'Symbolic links and junctions are not accepted.'
}
foreach ($entry in $sourceFiles) {
  if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Symbolic links and junctions are not accepted.' }
}
$repoDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$destination = Join-Path $repoDirectory 'wildfire-dashboard\public\firmware'
$vendorDirectory = Join-Path $destination 'vendor'
$backupDirectory = Join-Path $destination ('releases\FG1-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))

function Assert-PublicationPath([string]$Path) {
  $absolute = [IO.Path]::GetFullPath($Path)
  if (-not $absolute.StartsWith($repoDirectory + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Publication path is outside the repository.'
  }
  $inspect = $absolute
  while ($inspect.Length -ge $repoDirectory.Length) {
    if (Test-Path -LiteralPath $inspect) {
      if ((Get-Item -LiteralPath $inspect -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw 'Publication paths must not contain symbolic links or junctions.'
      }
    }
    if ($inspect -eq $repoDirectory) { break }
    $inspect = Split-Path -Parent $inspect
  }
}
Assert-PublicationPath $backupDirectory
New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null

function Copy-PublishedFile([string]$Source, [string]$Target) {
  $absoluteTarget = [IO.Path]::GetFullPath($Target)
  if (-not $absoluteTarget.StartsWith($destination + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Publication target is outside the firmware directory.'
  }
  Assert-PublicationPath $absoluteTarget
  if (Test-Path -LiteralPath $absoluteTarget) {
    $relative = $absoluteTarget.Substring($destination.Length + 1)
    $backupTarget = Join-Path $backupDirectory $relative
    Assert-PublicationPath $backupTarget
    New-Item -ItemType Directory -Path (Split-Path -Parent $backupTarget) -Force | Out-Null
    Copy-Item -LiteralPath $absoluteTarget -Destination $backupTarget
  }
  New-Item -ItemType Directory -Path (Split-Path -Parent $absoluteTarget) -Force | Out-Null
  Copy-Item -LiteralPath $Source -Destination $absoluteTarget
}

foreach ($entry in $sourceFiles | Where-Object { -not $_.PSIsContainer }) {
  $relative = $entry.FullName.Substring($webToolsSource.TrimEnd('\').Length + 1)
  Copy-PublishedFile $entry.FullName (Join-Path $vendorDirectory $relative)
}
Copy-PublishedFile $firmwareSource (Join-Path $destination 'node-merged.bin')
$manifestPath = Join-Path $destination 'manifest.json'
Assert-PublicationPath $manifestPath
if (Test-Path -LiteralPath $manifestPath) {
  Copy-Item -LiteralPath $manifestPath -Destination (Join-Path $backupDirectory 'manifest.json')
}
$manifest = @{
  name = 'ForestGuard FG1 LILYGO LoRa32 433'; version = '1.0.0'
  new_install_prompt_erase = $true; new_install_improv_wait_time = 0
  sha256 = (Get-FileHash -LiteralPath $firmwareSource -Algorithm SHA256).Hash.ToLowerInvariant()
  builds = @(@{ chipFamily = 'ESP32'; parts = @(@{ path = 'node-merged.bin'; offset = 0 }) })
}
[IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
Write-Output 'Published local node installer assets. No VM deployment or board flashing performed.'
