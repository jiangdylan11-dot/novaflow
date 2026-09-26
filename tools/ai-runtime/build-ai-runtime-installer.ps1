[CmdletBinding()]
param(
  [string] $RuntimeSourcePath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "../../_exports/NovaFlow-AI-Runtime/package/AI-Runtime")),
  [string] $OutputRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "../../_exports/NovaFlow-AI-Runtime-Installer")),
  [string] $Version = "0.4.0",
  [string] $CustomNodesSource = ""
)

$ErrorActionPreference = "Stop"
trap {
  Write-Host $_.Exception.Message
  exit 1
}

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

function Get-DirectorySize {
  param([Parameter(Mandatory=$true)][string] $Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    return 0
  }
  $sum = (Get-ChildItem -LiteralPath $Path -Recurse -Force -File | Measure-Object -Property Length -Sum).Sum
  if ($null -eq $sum) {
    return 0
  }
  return [int64]$sum
}

function Format-Bytes {
  param([Parameter(Mandatory=$true)][int64] $Bytes)
  if ($Bytes -ge 1GB) {
    return ("{0:N2} GiB" -f ($Bytes / 1GB))
  }
  if ($Bytes -ge 1MB) {
    return ("{0:N2} MiB" -f ($Bytes / 1MB))
  }
  if ($Bytes -ge 1KB) {
    return ("{0:N2} KiB" -f ($Bytes / 1KB))
  }
  return ("{0} bytes" -f $Bytes)
}

function Find-CSharpCompiler {
  $candidates = @(
    "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe",
    "C:\Windows\Microsoft.NET\Framework64\v3.5\csc.exe",
    "C:\Windows\Microsoft.NET\Framework\v3.5\csc.exe"
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
      return $candidate
    }
  }
  throw "C# compiler was not found. Expected .NET Framework csc.exe under C:\Windows\Microsoft.NET."
}

function Copy-DirectoryContents {
  param(
    [Parameter(Mandatory=$true)][string] $Source,
    [Parameter(Mandatory=$true)][string] $Destination
  )
  if (-not (Test-Path -LiteralPath $Source)) {
    throw "Source directory was not found: $Source"
  }
  if (Test-Path -LiteralPath $Destination) {
    Remove-Item -LiteralPath $Destination -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $Destination -Recurse -Force
  }
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

function ConvertTo-JsonPath {
  param([Parameter(Mandatory=$true)][string] $Path)
  return $Path.Replace('\', '\\')
}

function Write-RuntimeJson {
  param(
    [Parameter(Mandatory=$true)][string] $Path,
    [Parameter(Mandatory=$true)][string] $RuntimeVersion
  )
  $installPath = "C:\ProgramData\NovaFlow\AI-Runtime"
  $assetsPath = if (Test-Path -LiteralPath "D:\") { "D:\NovaFlow" } else { "C:\ProgramData\NovaFlow" }
  $modelsPath = Join-Path $assetsPath "models"
  $customNodesPath = Join-Path $assetsPath "custom_nodes"
  $json = @(
    "{",
    '  "name": "NovaFlow AI Runtime",',
    ('  "version": "{0}",' -f $RuntimeVersion),
    '  "engine": "comfyui-core",',
    '  "port": 8188,',
    ('  "installPath": "{0}",' -f (ConvertTo-JsonPath $installPath)),
    ('  "assetsPath": "{0}",' -f (ConvertTo-JsonPath $assetsPath)),
    ('  "modelsPath": "{0}",' -f (ConvertTo-JsonPath $modelsPath)),
    ('  "customNodesPath": "{0}"' -f (ConvertTo-JsonPath $customNodesPath)),
    "}"
  )
  Set-Content -LiteralPath $Path -Value $json -Encoding UTF8
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
      $children = @(Get-ChildItem -LiteralPath $SourceDirectory -Force | Select-Object -ExpandProperty Name)
      & $tar.Source -a -cf $DestinationZip @children
      if ($LASTEXITCODE -ne 0) {
        throw "tar failed with exit code $LASTEXITCODE"
      }
    } finally {
      Pop-Location
    }
    return
  }

  throw "No large-archive zip tool was found. Install 7-Zip or use Windows tar.exe. Compress-Archive is intentionally not used for this Runtime package."
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$setupSource = Join-Path $scriptRoot "installer\setup\NovaFlowRuntimeSetup.cs"
$readmeTemplate = Join-Path $scriptRoot "templates\README-AI-Runtime.txt"

if (-not (Test-Path -LiteralPath $setupSource)) {
  throw "Setup source was not found: $setupSource"
}
if (-not (Test-Path -LiteralPath $readmeTemplate)) {
  throw "README template was not found: $readmeTemplate"
}

$RuntimeSourcePath = Convert-ToFullPath $RuntimeSourcePath
$OutputRoot = Convert-ToFullPath $OutputRoot
$unpackedRoot = Join-Path $OutputRoot "unpacked"
$releaseRoot = Join-Path $unpackedRoot "NovaFlow-AI-Runtime"
$releaseRuntimeRoot = Join-Path $releaseRoot "Runtime"
$runtimeDest = Join-Path $releaseRuntimeRoot "AI-Runtime"
$setupExe = Join-Path $releaseRoot "setup.exe"
$readmeDest = Join-Path $releaseRoot "README.txt"
$zipPath = Join-Path $OutputRoot ("NovaFlow-AI-Runtime-{0}.zip" -f $Version)

Assert-UnderPath -Child $unpackedRoot -Parent $OutputRoot
Assert-UnderPath -Child $releaseRoot -Parent $OutputRoot
Assert-UnderPath -Child $zipPath -Parent $OutputRoot

if (-not (Test-Path -LiteralPath (Join-Path $RuntimeSourcePath "scripts\start-runtime.bat"))) {
  throw "Runtime source is incomplete. Missing scripts\start-runtime.bat under $RuntimeSourcePath"
}
if (-not (Test-Path -LiteralPath (Join-Path $RuntimeSourcePath "runtime.json"))) {
  throw "Runtime source is incomplete. Missing runtime.json under $RuntimeSourcePath"
}

New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
if (Test-Path -LiteralPath $unpackedRoot) {
  Remove-Item -LiteralPath $unpackedRoot -Recurse -Force
}
if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null
New-Item -ItemType Directory -Force -Path $releaseRuntimeRoot | Out-Null

Write-Host "Copying Runtime package..."
Copy-DirectoryContents -Source $RuntimeSourcePath -Destination $runtimeDest
# The two NovaFlow patches are pinned to ComfyUI 0.24.1 file hashes (and the INT8 one to
# comfy-kitchen 0.2.11); ComfyUI 0.37 carries INT8 TensorWise itself, so its engine ships as built.
$comfyVersion = $null
$comfyVersionFile = Join-Path $runtimeDest "engine\ComfyUI\comfyui_version.py"
if (Test-Path -LiteralPath $comfyVersionFile -PathType Leaf) {
  $versionMatch = Select-String -LiteralPath $comfyVersionFile -Pattern '__version__\s*=\s*"([0-9]+(?:\.[0-9]+){1,3})"' | Select-Object -First 1
  if ($versionMatch) { $comfyVersion = [version] $versionMatch.Matches[0].Groups[1].Value }
}
if ($comfyVersion -and $comfyVersion -ge [version] "0.37.0") {
  Write-Host "ComfyUI $comfyVersion carries INT8 TensorWise natively; the 0.24.1 Runtime patches are not applied."
} else {
  $runtimePatcher = Join-Path $scriptRoot "apply-runtime-patches.ps1"
  if (-not (Test-Path -LiteralPath $runtimePatcher -PathType Leaf)) {
    throw "Runtime patcher was not found: $runtimePatcher"
  }
  Write-Host "Applying verified NovaFlow Runtime patches..."
  & $runtimePatcher -RuntimeRoot $runtimeDest -PythonExecutable (Join-Path $runtimeDest "engine\python\python.exe")
  $int8RuntimePatcher = Join-Path $scriptRoot "apply-runtime-int8-tensorwise-patch.ps1"
  if (-not (Test-Path -LiteralPath $int8RuntimePatcher -PathType Leaf)) {
    throw "INT8 TensorWise Runtime patcher was not found: $int8RuntimePatcher"
  }
  Write-Host "Applying verified INT8 TensorWise Runtime patch..."
  & $int8RuntimePatcher -RuntimeRoot $runtimeDest -PythonExecutable (Join-Path $runtimeDest "engine\python\python.exe")
}
Write-RuntimeJson -Path (Join-Path $runtimeDest "runtime.json") -RuntimeVersion $Version
Write-RuntimeScriptShim -RuntimeRoot $runtimeDest -ScriptName "start-runtime.bat"
Write-RuntimeScriptShim -RuntimeRoot $runtimeDest -ScriptName "stop-runtime.bat"
Write-RuntimeScriptShim -RuntimeRoot $runtimeDest -ScriptName "check-runtime.bat"

# Every custom node NovaFlow's graphs name ships with the Runtime (setup.exe copies them into the
# assets folder's custom_nodes); the models are delivered separately (MODELS.txt). The H3 video nodes
# come from this repository, the rest from the build machine's working Runtime.
$releaseCustomNodes = Join-Path $releaseRuntimeRoot "custom_nodes"
New-Item -ItemType Directory -Force -Path $releaseCustomNodes | Out-Null
if (-not $CustomNodesSource) {
  $installedRuntimeJson = Join-Path $env:ProgramData "NovaFlow\AI-Runtime\runtime.json"
  if (Test-Path -LiteralPath $installedRuntimeJson) {
    $CustomNodesSource = [string]((Get-Content -Raw -LiteralPath $installedRuntimeJson | ConvertFrom-Json).customNodesPath)
  }
}
if (-not $CustomNodesSource -or -not (Test-Path -LiteralPath $CustomNodesSource)) {
  throw "Custom nodes source was not found. Pass -CustomNodesSource <assets>\custom_nodes."
}
Write-Host "Copying custom nodes from $CustomNodesSource..."
& robocopy $CustomNodesSource $releaseCustomNodes /E /R:2 /W:1 /NFL /NDL /NJH /NJS /NP /XD __pycache__ .git /XF *.pyc *.log | Out-Null
if ($LASTEXITCODE -gt 7) { throw "Copying custom nodes failed with robocopy exit code $LASTEXITCODE" }
$h3Nodes = Convert-ToFullPath (Join-Path $scriptRoot "..\ai-runtime-h3\nodes")
foreach ($node in Get-ChildItem -LiteralPath $h3Nodes -Directory) {
  & robocopy $node.FullName (Join-Path $releaseCustomNodes $node.Name) /E /R:2 /W:1 /NFL /NDL /NJH /NJS /NP /XD __pycache__ /XF *.pyc | Out-Null
  if ($LASTEXITCODE -gt 7) { throw "Copying $($node.Name) failed with robocopy exit code $LASTEXITCODE" }
}
foreach ($required in @('ComfyUI-GGUF-leejet', 'ComfyUI-RMBG', 'ComfyUI-See-through', 'seedvr2_videoupscaler', 'novaflow_h3_attention', 'novaflow_h3_reference', 'novaflow_h3_refstrength', 'novaflow_h3_v2v')) {
  if (-not (Test-Path -LiteralPath (Join-Path $releaseCustomNodes $required))) { throw "Required custom node missing from the package: $required" }
}
# SageAttention / Triton (the H3 attention node imports them) must be in the shipped Python.
# Through cmd: PowerShell 5.1 with ErrorActionPreference Stop turns torch's pynvml FutureWarning on
# stderr into a terminating error.
& cmd /c ('"' + (Join-Path $runtimeDest "engine\python\python.exe") + '" -W ignore -c "import sageattention, triton, scipy" 2>nul')
if ($LASTEXITCODE -ne 0) { throw "The Runtime's Python lacks sageattention/triton; run tools\ai-runtime-h3\install-sage-acceleration.py on the source Runtime first." }

Write-Host "Writing README and MODELS..."
Copy-Item -LiteralPath $readmeTemplate -Destination $readmeDest -Force
Copy-Item -LiteralPath (Join-Path $scriptRoot "templates\MODELS-AI-Runtime.txt") -Destination (Join-Path $releaseRoot "MODELS.txt") -Force

Write-Host "Compiling WinForms setup.exe..."
$csc = Find-CSharpCompiler
& $csc /nologo /target:winexe /optimize+ /out:$setupExe /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll $setupSource
if ($LASTEXITCODE -ne 0) {
  throw "csc failed with exit code $LASTEXITCODE"
}
if (-not (Test-Path -LiteralPath $setupExe)) {
  throw "setup.exe was not created: $setupExe"
}

Write-Host "Creating release zip..."
New-ZipArchiveFromChildren -SourceDirectory $unpackedRoot -DestinationZip $zipPath
if (-not (Test-Path -LiteralPath $zipPath)) {
  throw "Release zip was not created: $zipPath"
}

$unpackedSize = Get-DirectorySize -Path $releaseRoot
$zipSize = (Get-Item -LiteralPath $zipPath).Length

Write-Host "NovaFlow AI Runtime offline package created."
Write-Host "Unpacked: $releaseRoot"
Write-Host "Zip: $zipPath"
Write-Host ("Unpacked size: {0}" -f (Format-Bytes $unpackedSize))
Write-Host ("Zip size: {0}" -f (Format-Bytes $zipSize))
