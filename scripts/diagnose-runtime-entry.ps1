[CmdletBinding()]
param(
  [string]$ProgramFilesPath = "C:\Program Files\NovaFlowPortable",
  [switch]$HashExe,
  [switch]$RunCheckEntry
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

function Write-Section {
  param([Parameter(Mandatory = $true)][string]$Title)

  Write-Host ""
  Write-Host "== $Title =="
}

function Write-PathState {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string]$Path
  )

  if (Test-Path -LiteralPath $Path) {
    $item = Get-Item -LiteralPath $Path
    Write-Host "[OK] ${Label}: $Path"
    Write-Host "     LastWriteTimeUtc: $($item.LastWriteTimeUtc.ToString("yyyy-MM-dd HH:mm:ss"))"
    if (-not $item.PSIsContainer) {
      Write-Host "     Length: $($item.Length)"
      if ($HashExe) {
        $hash = Get-FileHash -Algorithm SHA256 -LiteralPath $Path
        Write-Host "     SHA256: $($hash.Hash)"
      }
    }
  } else {
    Write-Host "[MISSING] ${Label}: $Path"
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

function Test-HttpEntry {
  param([Parameter(Mandatory = $true)][string]$Url)

  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
    Write-Host "[OK] $Url responded with HTTP $($response.StatusCode)"
  } catch {
    Write-Host "[WARN] $Url is not reachable: $($_.Exception.Message)"
  }
}

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$repoDist = Join-Path $repoRoot "particle-editor-desktop\dist\win-unpacked"
$rendererRoot = Join-Path $repoDist "resources\app\renderer"
$rendererIndex = Join-Path $rendererRoot "index.html"
$programFilesRoot = Get-FullPathOrInput -Path $ProgramFilesPath
$repoExe = Get-NovaFlowLaunchExe -RootPath $repoDist
$programFilesExe = Get-NovaFlowLaunchExe -RootPath $programFilesRoot

Write-Host "NovaFlow runtime entry diagnosis"
Write-Host "Repo root: $repoRoot"

Write-Section "Accepted development entries"
Test-HttpEntry -Url "http://127.0.0.1:4783/"
Write-PathState -Label "Repo dist root" -Path $repoDist
Write-PathState -Label "Repo dist renderer index" -Path $rendererIndex
Write-PathState -Label "Repo dist executable" -Path $repoExe

Write-Section "Installed build entry (not development validation)"
Write-PathState -Label "Program Files root" -Path $programFilesRoot
Write-PathState -Label "Program Files executable" -Path $programFilesExe

Write-Section "Listening ports"
try {
  $listeners = @(Get-NetTCPConnection -LocalPort 4783 -State Listen -ErrorAction Stop)
  if ($listeners.Count -eq 0) {
    Write-Host "[WARN] No listener found on local port 4783"
  } else {
    foreach ($listener in $listeners) {
      Write-Host "[OK] 4783 listener: LocalAddress=$($listener.LocalAddress) OwningProcess=$($listener.OwningProcess)"
    }
  }
} catch {
  Write-Host "[WARN] Unable to inspect port 4783 listener: $($_.Exception.Message)"
}

Write-Section "Running NovaFlow processes"
$processes = Get-NovaFlowProcesses
if ($processes.Count -eq 0) {
  Write-Host "[OK] No NovaFlow process is currently running"
} else {
  foreach ($process in $processes) {
    $path = [string]$process.ExecutablePath
    $bucket = "other"
    if (Test-IsUnderPath -ChildPath $path -ParentPath $repoDist) {
      $bucket = "repo dist"
    } elseif (Test-IsUnderPath -ChildPath $path -ParentPath $programFilesRoot) {
      $bucket = "Program Files"
    }
    Write-Host "[INFO] PID=$($process.ProcessId) Source=$bucket Path=$path"
  }
}

Write-Section "Policy"
Write-Host "Development verification: use http://127.0.0.1:4783/ and repo dist/win-unpacked."
Write-Host "Program Files is only for post-package validation, release-candidate validation, and formal installed use."
Write-Host "Do not manually copy runtime files into Program Files to prove a development fix."
Write-Host "deploy-to-program-files.ps1 is a legacy emergency deployment helper, not part of normal development workflow."

if ($RunCheckEntry) {
  Write-Section "npm run check:entry"
  Push-Location $repoRoot
  try {
    & npm run check:entry
    exit $LASTEXITCODE
  } finally {
    Pop-Location
  }
}
