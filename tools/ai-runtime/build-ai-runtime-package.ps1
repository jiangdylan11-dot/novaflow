[CmdletBinding()]
param(
  [string] $SourceComfyRoot,
  [string] $SourcePythonRoot,
  [string] $OutputRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "../../_exports/NovaFlow-AI-Runtime")),
  [string] $InstallPath = "C:\ProgramData\NovaFlow\AI-Runtime",
  [string] $AssetsPath,
  [string] $ModelsPath,
  [string] $CustomNodesPath,
  [string] $Version = "0.2.5",
  [switch] $NoZip
)

$ErrorActionPreference = "Stop"

function Convert-ToFullPath {
  param([Parameter(Mandatory=$true)][string] $Path)
  return [System.IO.Path]::GetFullPath($Path)
}

function Assert-UnderPath {
  param(
    [Parameter(Mandatory=$true)][string] $Child,
    [Parameter(Mandatory=$true)][string] $Parent
  )
  $childFull = Convert-ToFullPath $Child
  $parentFull = Convert-ToFullPath $Parent
  if (-not $parentFull.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
    $parentFull += [System.IO.Path]::DirectorySeparatorChar
  }
  if (-not $childFull.StartsWith($parentFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to modify path outside output root. Path: $childFull Root: $parentFull"
  }
}

function Get-DefaultAssetsPath {
  if (Test-Path -LiteralPath "D:\") {
    return "D:\NovaFlow"
  }
  return "C:\ProgramData\NovaFlow"
}

function Find-PythonForComfyRoot {
  param([Parameter(Mandatory=$true)][string] $ComfyRoot)
  $parent = Split-Path -Parent $ComfyRoot
  $candidates = @(
    (Join-Path $ComfyRoot "python_embeded\python.exe"),
    (Join-Path $ComfyRoot "python\python.exe"),
    (Join-Path $ComfyRoot ".venv\Scripts\python.exe"),
    (Join-Path $ComfyRoot "venv\Scripts\python.exe"),
    (Join-Path $parent "python_embeded\python.exe"),
    (Join-Path $parent "python\python.exe"),
    (Join-Path $parent ".venv\Scripts\python.exe"),
    (Join-Path $parent "venv\Scripts\python.exe")
  )
  return $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}

function Test-ComfyRoot {
  param([Parameter(Mandatory=$true)][string] $ComfyRoot)
  $python = Find-PythonForComfyRoot $ComfyRoot
  return [pscustomobject]@{
    Root = $ComfyRoot
    HasMainPy = Test-Path -LiteralPath (Join-Path $ComfyRoot "main.py")
    HasModels = Test-Path -LiteralPath (Join-Path $ComfyRoot "models")
    HasCustomNodes = Test-Path -LiteralPath (Join-Path $ComfyRoot "custom_nodes")
    Python = $python
    Usable = [bool]((Test-Path -LiteralPath (Join-Path $ComfyRoot "main.py")) -and (Test-Path -LiteralPath (Join-Path $ComfyRoot "models")) -and (Test-Path -LiteralPath (Join-Path $ComfyRoot "custom_nodes")) -and $python)
  }
}

function Find-ComfyCandidates {
  $roots = @("D:\", "E:\", "C:\") | Where-Object { Test-Path -LiteralPath $_ }
  $skip = @('$Recycle.Bin', 'System Volume Information', 'Windows', 'Program Files', 'Program Files (x86)', 'ProgramData', 'node_modules', '.git', 'AppData')
  $maxDepth = 5
  $namedDirs = New-Object System.Collections.Generic.HashSet[string]([System.StringComparer]::OrdinalIgnoreCase)

  foreach ($root in $roots) {
    $queue = New-Object System.Collections.Queue
    $queue.Enqueue([pscustomobject]@{ Path = $root; Depth = 0 })
    while ($queue.Count -gt 0) {
      $item = $queue.Dequeue()
      if ($item.Depth -gt $maxDepth) { continue }
      try {
        $dirs = Get-ChildItem -LiteralPath $item.Path -Directory -ErrorAction SilentlyContinue
      } catch {
        continue
      }
      foreach ($dir in $dirs) {
        if ($skip -contains $dir.Name) { continue }
        if ($dir.Name -like "*Comfy*") {
          [void] $namedDirs.Add($dir.FullName)
        }
        if ($item.Depth -lt $maxDepth) {
          $queue.Enqueue([pscustomobject]@{ Path = $dir.FullName; Depth = $item.Depth + 1 })
        }
      }
    }
  }

  $mainRoots = New-Object System.Collections.Generic.HashSet[string]([System.StringComparer]::OrdinalIgnoreCase)
  foreach ($dir in $namedDirs) {
    if (Test-Path -LiteralPath (Join-Path $dir "main.py")) {
      [void] $mainRoots.Add($dir)
    }
    $child = Join-Path $dir "ComfyUI"
    if (Test-Path -LiteralPath (Join-Path $child "main.py")) {
      [void] $mainRoots.Add($child)
    }
  }

  return $mainRoots | ForEach-Object { Test-ComfyRoot $_ } | Where-Object { $_.Usable } | Sort-Object Root
}

function Get-ComfyVersion {
  param([Parameter(Mandatory=$true)][string] $ComfyRoot)
  $file = Join-Path $ComfyRoot "comfyui_version.py"
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { return $null }
  $match = Select-String -LiteralPath $file -Pattern '__version__\s*=\s*"([0-9]+(?:\.[0-9]+){1,3})"' | Select-Object -First 1
  if (-not $match) { return $null }
  return [version] $match.Matches[0].Groups[1].Value
}

function Invoke-RobocopyChecked {
  param(
    [Parameter(Mandatory=$true)][string] $Source,
    [Parameter(Mandatory=$true)][string] $Destination,
    [string[]] $ExcludeDirs = @(),
    [string[]] $ExcludeFiles = @()
  )

  New-Item -ItemType Directory -Force -Path $Destination | Out-Null

  $args = @(
    $Source,
    $Destination,
    "/E",
    "/XJ",
    "/R:1",
    "/W:1",
    "/NP",
    "/NFL",
    "/NDL",
    "/NJH",
    "/NJS"
  )
  if ($ExcludeDirs.Count -gt 0) {
    $args += "/XD"
    $args += $ExcludeDirs
  }
  if ($ExcludeFiles.Count -gt 0) {
    $args += "/XF"
    $args += $ExcludeFiles
  }

  & robocopy @args
  $code = $LASTEXITCODE
  if ($code -gt 7) {
    throw "Robocopy failed with exit code $code from $Source to $Destination"
  }
}

function Copy-Template {
  param(
    [Parameter(Mandatory=$true)][string] $TemplatePath,
    [Parameter(Mandatory=$true)][string] $DestinationPath,
    [hashtable] $Tokens = @{}
  )
  $content = Get-Content -Raw -LiteralPath $TemplatePath
  foreach ($key in $Tokens.Keys) {
    $content = $content.Replace("{{$key}}", [string]$Tokens[$key])
  }
  Set-Content -LiteralPath $DestinationPath -Value $content -Encoding UTF8
}

function Write-RuntimeScriptShim {
  param(
    [Parameter(Mandatory=$true)][string] $RuntimeRoot,
    [Parameter(Mandatory=$true)][string] $ScriptName
  )

  $shim = @(
    "@echo off",
    "setlocal",
    "set ""SCRIPT_DIR=%~dp0""",
    "call ""%SCRIPT_DIR%scripts\$ScriptName"" %*",
    "exit /b %ERRORLEVEL%"
  )
  Set-Content -LiteralPath (Join-Path $RuntimeRoot $ScriptName) -Value $shim -Encoding ASCII
}

function Remove-TorchStaticLibraries {
  param([Parameter(Mandatory=$true)][string] $PythonRoot)

  $torchLibRoot = Join-Path $PythonRoot "Lib\site-packages\torch\lib"
  if (-not (Test-Path -LiteralPath $torchLibRoot)) {
    Write-Host "Torch lib directory was not found; skipping static library cleanup."
    return
  }

  Assert-UnderPath -Child $torchLibRoot -Parent $PythonRoot
  $staticLibraries = @(Get-ChildItem -LiteralPath $torchLibRoot -File -Filter "*.lib" -ErrorAction SilentlyContinue)
  if ($staticLibraries.Count -eq 0) {
    Write-Host "No torch static libraries found to remove."
    return
  }

  $bytes = ($staticLibraries | Measure-Object -Property Length -Sum).Sum
  foreach ($file in $staticLibraries) {
    Assert-UnderPath -Child $file.FullName -Parent $torchLibRoot
    Remove-Item -LiteralPath $file.FullName -Force
  }
  Write-Host ("Removed {0} torch static libraries from package ({1:N2} MiB)." -f $staticLibraries.Count, ($bytes / 1MB))
}

function New-ZipArchiveFromChildren {
  param(
    [Parameter(Mandatory=$true)][string] $SourceDirectory,
    [Parameter(Mandatory=$true)][string] $DestinationZip
  )

  $sevenZip = Get-Command 7z -ErrorAction SilentlyContinue
  if (-not $sevenZip) {
    $sevenZip = Get-Command 7za -ErrorAction SilentlyContinue
  }

  if ($sevenZip) {
    $sourcePattern = Join-Path $SourceDirectory "*"
    & $sevenZip.Source a -tzip -mx=1 $DestinationZip $sourcePattern
    if ($LASTEXITCODE -ne 0) {
      throw "7z failed with exit code $LASTEXITCODE"
    }
    return
  }

  $tar = Get-Command tar -ErrorAction SilentlyContinue
  if ($tar) {
    Push-Location $SourceDirectory
    try {
      $children = Get-ChildItem -LiteralPath $SourceDirectory -Force | Select-Object -ExpandProperty Name
      & $tar.Source -a -cf $DestinationZip @children
      if ($LASTEXITCODE -ne 0) {
        throw "tar failed with exit code $LASTEXITCODE"
      }
    } finally {
      Pop-Location
    }
    return
  }

  Compress-Archive -Path (Join-Path $SourceDirectory "*") -DestinationPath $DestinationZip -Force
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$templateRoot = Join-Path $scriptRoot "templates"

if (-not $AssetsPath) {
  $AssetsPath = Get-DefaultAssetsPath
}
if (-not $ModelsPath) {
  $ModelsPath = Join-Path $AssetsPath "models"
}
if (-not $CustomNodesPath) {
  $CustomNodesPath = Join-Path $AssetsPath "custom_nodes"
}

if (-not $SourceComfyRoot) {
  $candidates = @(Find-ComfyCandidates)
  if ($candidates.Count -eq 0) {
    throw "No usable ComfyUI candidate found on D:\, E:\, or C:\."
  }
  if ($candidates.Count -gt 1) {
    $summary = $candidates | ForEach-Object { "- $($_.Root) | python: $($_.Python)" }
    throw "Multiple usable ComfyUI candidates found. Re-run with -SourceComfyRoot. Candidates:`n$($summary -join [Environment]::NewLine)"
  }
  $SourceComfyRoot = $candidates[0].Root
  $SourcePythonRoot = Split-Path -Parent $candidates[0].Python
  if ($SourcePythonRoot.EndsWith("\Scripts", [System.StringComparison]::OrdinalIgnoreCase)) {
    $SourcePythonRoot = Split-Path -Parent (Split-Path -Parent $candidates[0].Python)
  }
}

$SourceComfyRoot = Convert-ToFullPath $SourceComfyRoot
if (-not (Test-Path -LiteralPath (Join-Path $SourceComfyRoot "main.py"))) {
  throw "SourceComfyRoot does not contain main.py: $SourceComfyRoot"
}
if (-not (Test-Path -LiteralPath (Join-Path $SourceComfyRoot "custom_nodes"))) {
  throw "SourceComfyRoot does not contain custom_nodes: $SourceComfyRoot"
}

if (-not $SourcePythonRoot) {
  $pythonExe = Find-PythonForComfyRoot $SourceComfyRoot
  if (-not $pythonExe) {
    throw "No Python runtime found for ComfyUI root: $SourceComfyRoot"
  }
  $SourcePythonRoot = Split-Path -Parent $pythonExe
  if ($SourcePythonRoot.EndsWith("\Scripts", [System.StringComparison]::OrdinalIgnoreCase)) {
    $SourcePythonRoot = Split-Path -Parent (Split-Path -Parent $pythonExe)
  }
}
$SourcePythonRoot = Convert-ToFullPath $SourcePythonRoot
if (-not (Test-Path -LiteralPath (Join-Path $SourcePythonRoot "python.exe"))) {
  throw "SourcePythonRoot does not contain python.exe: $SourcePythonRoot"
}

$OutputRoot = Convert-ToFullPath $OutputRoot
$packageRoot = Join-Path $OutputRoot "package"
$runtimePackageRoot = Join-Path $packageRoot "AI-Runtime"
$assetsPackageRoot = Join-Path $packageRoot "AI-Assets"
$engineRoot = Join-Path $runtimePackageRoot "engine"
$comfyDest = Join-Path $engineRoot "ComfyUI"
$pythonDest = Join-Path $engineRoot "python"
$scriptsDest = Join-Path $runtimePackageRoot "scripts"
$zipPath = Join-Path $OutputRoot ("NovaFlow-AI-Runtime-{0}.zip" -f $Version)

New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
Assert-UnderPath -Child $packageRoot -Parent $OutputRoot
Assert-UnderPath -Child $zipPath -Parent $OutputRoot

if (Test-Path -LiteralPath $packageRoot) {
  Remove-Item -LiteralPath $packageRoot -Recurse -Force
}
if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

New-Item -ItemType Directory -Force -Path $engineRoot,$scriptsDest,(Join-Path $runtimePackageRoot "logs") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $assetsPackageRoot "models\checkpoints"),(Join-Path $assetsPackageRoot "models\loras"),(Join-Path $assetsPackageRoot "models\vae"),(Join-Path $assetsPackageRoot "models\controlnet"),(Join-Path $assetsPackageRoot "models\rembg"),(Join-Path $assetsPackageRoot "custom_nodes") | Out-Null

$comfyExcludeDirs = @(
  (Join-Path $SourceComfyRoot ".git"),
  (Join-Path $SourceComfyRoot ".github"),
  (Join-Path $SourceComfyRoot ".ci"),
  (Join-Path $SourceComfyRoot ".cache"),
  (Join-Path $SourceComfyRoot "models"),
  (Join-Path $SourceComfyRoot "custom_nodes"),
  (Join-Path $SourceComfyRoot "input"),
  (Join-Path $SourceComfyRoot "output"),
  (Join-Path $SourceComfyRoot "temp"),
  (Join-Path $SourceComfyRoot "cache"),
  (Join-Path $SourceComfyRoot "workflows"),
  (Join-Path $SourceComfyRoot "user"),
  (Join-Path $SourceComfyRoot "tests"),
  (Join-Path $SourceComfyRoot "tests-unit"),
  (Join-Path $SourceComfyRoot "script_examples"),
  ".git",
  ".cache",
  ".pytest_cache",
  "__pycache__",
  "cache",
  "caches",
  "pip-cache",
  "wheel-cache",
  "wheels",
  "wheelhouse",
  "download",
  "downloads",
  "temp",
  "tmp",
  "test",
  "tests",
  "example",
  "examples",
  "sample",
  "samples",
  "benchmark",
  "benchmarks"
)
$pythonExcludeDirs = @(
  (Join-Path $SourcePythonRoot "cache"),
  (Join-Path $SourcePythonRoot "caches"),
  ".git",
  ".cache",
  ".pytest_cache",
  "__pycache__",
  "pip-cache",
  "wheel-cache",
  "wheels",
  "wheelhouse",
  "download",
  "downloads",
  "temp",
  "tmp",
  "test",
  "tests",
  "example",
  "examples",
  "sample",
  "samples",
  "benchmark",
  "benchmarks"
)
$excludeFiles = @("*.pyc", "*.pyo", "*.log", "*.tmp", "*.temp", "bilibili@*.txt")

Write-Host "Copying ComfyUI engine from $SourceComfyRoot"
Invoke-RobocopyChecked -Source $SourceComfyRoot -Destination $comfyDest -ExcludeDirs $comfyExcludeDirs -ExcludeFiles $excludeFiles

New-Item -ItemType Directory -Force -Path (Join-Path $comfyDest "custom_nodes") | Out-Null

Write-Host "Copying Python runtime from $SourcePythonRoot"
Invoke-RobocopyChecked -Source $SourcePythonRoot -Destination $pythonDest -ExcludeDirs $pythonExcludeDirs -ExcludeFiles $excludeFiles
Remove-TorchStaticLibraries -PythonRoot $pythonDest

# The two NovaFlow patches are pinned to ComfyUI 0.24.1 file hashes (and the INT8 one to
# comfy-kitchen 0.2.11). ComfyUI 0.37 ships INT8 TensorWise itself and no longer has the lines the
# price patch anchors on, so an engine from 0.37 on is packed as it is; its NOVAFLOW-ENGINE.json
# manifest (version, commit, pip changes) goes into the package with it.
$comfyVersion = Get-ComfyVersion $SourceComfyRoot
if ($comfyVersion -and $comfyVersion -ge [version] "0.37.0") {
  Write-Host "ComfyUI $comfyVersion carries INT8 TensorWise natively; the 0.24.1 Runtime patches are not applied."
} else {
  $runtimePatcher = Join-Path $scriptRoot "apply-runtime-patches.ps1"
  if (-not (Test-Path -LiteralPath $runtimePatcher -PathType Leaf)) {
    throw "Runtime patcher was not found: $runtimePatcher"
  }
  Write-Host "Applying verified NovaFlow Runtime patches..."
  & $runtimePatcher -RuntimeRoot $runtimePackageRoot -PythonExecutable (Join-Path $pythonDest "python.exe")
  $int8RuntimePatcher = Join-Path $scriptRoot "apply-runtime-int8-tensorwise-patch.ps1"
  if (-not (Test-Path -LiteralPath $int8RuntimePatcher -PathType Leaf)) {
    throw "INT8 TensorWise Runtime patcher was not found: $int8RuntimePatcher"
  }
  Write-Host "Applying verified INT8 TensorWise Runtime patch..."
  & $int8RuntimePatcher -RuntimeRoot $runtimePackageRoot -PythonExecutable (Join-Path $pythonDest "python.exe")
}
$engineManifest = Join-Path (Split-Path -Parent $SourceComfyRoot) "NOVAFLOW-ENGINE.json"
if (Test-Path -LiteralPath $engineManifest -PathType Leaf) {
  Copy-Item -LiteralPath $engineManifest -Destination (Join-Path $engineRoot "NOVAFLOW-ENGINE.json") -Force
}

$tokens = @{
  VERSION = $Version
  INSTALL_PATH = $InstallPath.Replace("\", "\\")
  ASSETS_PATH = $AssetsPath.Replace("\", "\\")
  MODELS_PATH = $ModelsPath.Replace("\", "\\")
  CUSTOM_NODES_PATH = $CustomNodesPath.Replace("\", "\\")
}

Copy-Template -TemplatePath (Join-Path $templateRoot "runtime.json") -DestinationPath (Join-Path $runtimePackageRoot "runtime.json") -Tokens $tokens
Copy-Item -LiteralPath (Join-Path $templateRoot "start-runtime.bat") -Destination (Join-Path $scriptsDest "start-runtime.bat") -Force
Copy-Item -LiteralPath (Join-Path $templateRoot "stop-runtime.bat") -Destination (Join-Path $scriptsDest "stop-runtime.bat") -Force
Copy-Item -LiteralPath (Join-Path $templateRoot "check-runtime.bat") -Destination (Join-Path $scriptsDest "check-runtime.bat") -Force
Write-RuntimeScriptShim -RuntimeRoot $runtimePackageRoot -ScriptName "start-runtime.bat"
Write-RuntimeScriptShim -RuntimeRoot $runtimePackageRoot -ScriptName "stop-runtime.bat"
Write-RuntimeScriptShim -RuntimeRoot $runtimePackageRoot -ScriptName "check-runtime.bat"

if (-not $NoZip) {
  Write-Host "Creating zip $zipPath"
  New-ZipArchiveFromChildren -SourceDirectory $packageRoot -DestinationZip $zipPath
}

Write-Host "NovaFlow AI Runtime package created."
Write-Host "Runtime package root: $runtimePackageRoot"
Write-Host "AI assets template root: $assetsPackageRoot"
if (-not $NoZip) {
  Write-Host "Zip: $zipPath"
}
