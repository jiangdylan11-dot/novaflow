[CmdletBinding()]
param(
  [string]$SourcePath,
  [string]$TargetPath = "C:\Program Files\NovaFlowPortable",
  [switch]$ConfirmDeploy
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-FullPathOrInput {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (Test-Path -LiteralPath $Path) {
    return (Resolve-Path -LiteralPath $Path).Path
  }

  return [System.IO.Path]::GetFullPath($Path)
}

function Test-IsUnderPath {
  param(
    [string]$ChildPath,
    [string]$ParentPath
  )

  if ([string]::IsNullOrWhiteSpace($ChildPath) -or [string]::IsNullOrWhiteSpace($ParentPath)) {
    return $false
  }

  $child = [System.IO.Path]::GetFullPath($ChildPath).TrimEnd("\")
  $parent = [System.IO.Path]::GetFullPath($ParentPath).TrimEnd("\") + "\"
  return $child.StartsWith($parent, [System.StringComparison]::OrdinalIgnoreCase)
}

function Assert-DeployTarget {
  param([Parameter(Mandatory = $true)][string]$Path)

  $fullPath = [System.IO.Path]::GetFullPath($Path).TrimEnd("\")
  $root = [System.IO.Path]::GetPathRoot($fullPath).TrimEnd("\")
  if ($fullPath -eq $root) {
    throw "Refusing to deploy to drive root: $fullPath"
  }

  $leaf = Split-Path -Path $fullPath -Leaf
  if ([string]::IsNullOrWhiteSpace($leaf)) {
    throw "Refusing to deploy to an empty target leaf: $fullPath"
  }
}

function Get-NovaFlowLaunchExe {
  param([Parameter(Mandatory = $true)][string]$RootPath)

  $candidates = @(
    (Join-Path $RootPath "NovaFlowPortable.exe"),
    (Join-Path $RootPath "NovaFlow.exe")
  )

  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
      return $candidate
    }
  }

  return $candidates[0]
}

function Get-NovaFlowProcesses {
  try {
    return @(
      Get-CimInstance Win32_Process -ErrorAction Stop |
        Where-Object { $_.Name -eq "NovaFlow.exe" -or $_.Name -eq "NovaFlowPortable.exe" }
    )
  } catch {
    Write-Host "[WARN] Unable to query NovaFlow processes: $($_.Exception.Message)"
    return @()
  }
}

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
if ([string]::IsNullOrWhiteSpace($SourcePath)) {
  $SourcePath = Join-Path $repoRoot "particle-editor-desktop\dist\win-unpacked"
}

$sourceFull = (Resolve-Path -LiteralPath $SourcePath).Path
$targetFull = Get-FullPathOrInput -Path $TargetPath
$sourceExe = Get-NovaFlowLaunchExe -RootPath $sourceFull
$sourceRendererIndex = Join-Path $sourceFull "resources\app\renderer\index.html"
$excludedTopLevelNames = @("user-data")

Assert-DeployTarget -Path $targetFull

if (-not (Test-Path -LiteralPath $sourceExe)) {
  throw "Source does not look like a NovaFlow win-unpacked directory. Missing launch executable: $sourceExe"
}

if (-not (Test-Path -LiteralPath $sourceRendererIndex)) {
  throw "Source renderer index is missing: $sourceRendererIndex"
}

if ($sourceFull.TrimEnd("\").Equals($targetFull.TrimEnd("\"), [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Source and target are the same path: $sourceFull"
}

function Test-IsExcludedSourcePath {
  param([Parameter(Mandatory = $true)][string]$Path)

  $relativePath = $Path.Substring($sourceFull.Length).TrimStart("\")
  if ([string]::IsNullOrWhiteSpace($relativePath)) {
    return $false
  }

  $topLevelName = $relativePath.Split("\")[0]
  return $excludedTopLevelNames -contains $topLevelName
}

$files = @(
  Get-ChildItem -LiteralPath $sourceFull -Recurse -Force -File |
    Where-Object { -not (Test-IsExcludedSourcePath -Path $_.FullName) }
)
$dirs = @(
  Get-ChildItem -LiteralPath $sourceFull -Recurse -Force -Directory |
    Where-Object { -not (Test-IsExcludedSourcePath -Path $_.FullName) }
)
$bytes = ($files | Measure-Object -Property Length -Sum).Sum
if ($null -eq $bytes) {
  $bytes = 0
}

$mode = "DRY-RUN"
if ($ConfirmDeploy) {
  $mode = "CONFIRMED COPY"
}

Write-Host "NovaFlow Program Files deploy"
Write-Host "Mode: $mode"
Write-Host "Source: $sourceFull"
Write-Host "Target: $targetFull"
Write-Host "Files: $($files.Count)"
Write-Host "Directories: $($dirs.Count)"
Write-Host "Bytes: $bytes"
Write-Host "Target-only files will not be deleted."
Write-Host "Skipped top-level directories: $($excludedTopLevelNames -join ', ')"
Write-Host "This script does not rebuild or package NovaFlow."

$runningTargetProcesses = @(
  Get-NovaFlowProcesses | Where-Object {
    Test-IsUnderPath -ChildPath ([string]$_.ExecutablePath) -ParentPath $targetFull
  }
)

if ($runningTargetProcesses.Count -gt 0) {
  $pids = ($runningTargetProcesses | ForEach-Object { $_.ProcessId }) -join ", "
  $message = "NovaFlow is running from the target path. Close it before confirmed deploy. PIDs: $pids"
  if ($ConfirmDeploy) {
    throw $message
  }
  Write-Host "[WARN] $message"
}

if (-not $ConfirmDeploy) {
  Write-Host ""
  Write-Host "Dry-run complete. No files were copied."
  Write-Host "Run npm run deploy:program-files:confirm to copy repo dist into Program Files."
  exit 0
}

if (-not (Test-Path -LiteralPath $targetFull)) {
  New-Item -ItemType Directory -Path $targetFull -Force | Out-Null
}

foreach ($item in Get-ChildItem -LiteralPath $sourceFull -Force) {
  if ($excludedTopLevelNames -contains $item.Name) {
    Write-Host "Skipping protected top-level directory: $($item.Name)"
    continue
  }

  Copy-Item -LiteralPath $item.FullName -Destination $targetFull -Recurse -Force
}

Write-Host ""
Write-Host "Deploy complete. Program Files was updated from repo dist."
