[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string] $RuntimeRoot,
  [string] $PythonExecutable,
  [switch] $SkipDependencyInstall
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Convert-ToFullPath {
  param([Parameter(Mandatory=$true)][string] $Path)
  return [System.IO.Path]::GetFullPath($Path)
}

function Get-FileSha256 {
  param([Parameter(Mandatory=$true)][string] $Path)
  return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToUpperInvariant()
}

function Resolve-PythonExecutable {
  param(
    [string] $Requested,
    [Parameter(Mandatory=$true)][string] $Root
  )
  if ($Requested) {
    if (Test-Path -LiteralPath $Requested -PathType Leaf) {
      return Convert-ToFullPath $Requested
    }
    $command = Get-Command $Requested -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) { return $command.Source }
    throw "Python executable was not found: $Requested"
  }
  $bundled = Join-Path $Root "engine\python\python.exe"
  if (Test-Path -LiteralPath $bundled -PathType Leaf) { return $bundled }
  $fallback = Get-Command python -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($fallback) { return $fallback.Source }
  throw "Python executable was not found in the Runtime or PATH."
}

$RuntimeRoot = Convert-ToFullPath $RuntimeRoot
if (-not (Test-Path -LiteralPath $RuntimeRoot -PathType Container)) {
  throw "RuntimeRoot is missing or is not a directory: $RuntimeRoot"
}

$liveRuntimeRoot = Convert-ToFullPath "C:\ProgramData\NovaFlow\AI-Runtime"
$liveRuntimePrefix = $liveRuntimeRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (
  $RuntimeRoot.Equals($liveRuntimeRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
  $RuntimeRoot.StartsWith($liveRuntimePrefix, [System.StringComparison]::OrdinalIgnoreCase)
) {
  throw "Refusing to patch the installed ProgramData Runtime. Patch a staged destination and atomically swap it after validation: $RuntimeRoot"
}

$patchRoot = Join-Path $PSScriptRoot "patches\comfy-int8-tensorwise-v1"
$manifestPath = Join-Path $patchRoot "manifest.json"
$patchPath = Join-Path $patchRoot "comfy-int8-tensorwise-v1.patch"
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
  throw "INT8 TensorWise patch manifest is missing: $manifestPath"
}
if (-not (Test-Path -LiteralPath $patchPath -PathType Leaf)) {
  throw "INT8 TensorWise patch payload is missing: $patchPath"
}

$manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $manifestPath | ConvertFrom-Json
if ([string]$manifest.patchId -ne "comfy-int8-tensorwise-v1") {
  throw "Unexpected Runtime patch id: $($manifest.patchId)"
}
if (-not $manifest.files -or @($manifest.files).Count -ne 3) {
  throw "INT8 TensorWise patch manifest must register exactly three files."
}

$states = @()
foreach ($definition in @($manifest.files)) {
  $relativePath = ([string]$definition.path).Replace('/', [System.IO.Path]::DirectorySeparatorChar)
  $targetPath = Join-Path $RuntimeRoot $relativePath
  if (-not (Test-Path -LiteralPath $targetPath -PathType Leaf)) {
    throw "Required INT8 TensorWise patch target is missing: $targetPath"
  }
  $hash = Get-FileSha256 $targetPath
  $baseHash = ([string]$definition.baseSha256).ToUpperInvariant()
  $patchedHash = ([string]$definition.patchedSha256).ToUpperInvariant()
  if ($hash -ne $baseHash -and $hash -ne $patchedHash) {
    throw "Unknown base hash for $relativePath. Found $hash"
  }
  $states += [pscustomobject]@{
    RelativePath = $relativePath
    TargetPath = $targetPath
    Hash = $hash
    BaseHash = $baseHash
    PatchedHash = $patchedHash
  }
}

$baseCount = @($states | Where-Object { $_.Hash -eq $_.BaseHash }).Count
$patchedCount = @($states | Where-Object { $_.Hash -eq $_.PatchedHash }).Count
if ($baseCount -gt 0 -and $patchedCount -gt 0) {
  throw "INT8 TensorWise patch targets are in a mixed state; refusing a partial patch."
}

if ($baseCount -eq $states.Count) {
  $git = Get-Command git -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $git) { throw "git is required to apply the pinned INT8 TensorWise upstream patch." }
  & $git.Source -C $RuntimeRoot apply --check --whitespace=nowarn $patchPath
  if ($LASTEXITCODE -ne 0) {
    throw "INT8 TensorWise patch failed its dry-run check with exit code $LASTEXITCODE"
  }
  & $git.Source -C $RuntimeRoot apply --whitespace=nowarn $patchPath
  if ($LASTEXITCODE -ne 0) {
    throw "INT8 TensorWise patch failed with exit code $LASTEXITCODE"
  }
}

foreach ($state in $states) {
  $actualHash = Get-FileSha256 $state.TargetPath
  if ($actualHash -ne $state.PatchedHash) {
    throw "Patched hash mismatch for $($state.RelativePath). Expected $($state.PatchedHash), found $actualHash"
  }
}

$python = Resolve-PythonExecutable -Requested $PythonExecutable -Root $RuntimeRoot
$pythonTargets = @(
  (Join-Path $RuntimeRoot "engine\ComfyUI\comfy\ops.py"),
  (Join-Path $RuntimeRoot "engine\ComfyUI\comfy\quant_ops.py")
)
& $python -m py_compile @pythonTargets
if ($LASTEXITCODE -ne 0) {
  throw "Patched INT8 TensorWise Runtime Python failed py_compile with exit code $LASTEXITCODE"
}

if (-not $SkipDependencyInstall) {
  $patchedVersion = [string]$manifest.dependency.patchedVersion
  & $python -m pip install --disable-pip-version-check --no-deps --upgrade ("comfy-kitchen=={0}" -f $patchedVersion)
  if ($LASTEXITCODE -ne 0) {
    throw "Installing comfy-kitchen $patchedVersion failed with exit code $LASTEXITCODE"
  }
  $verifyCode = @'
import importlib.metadata as metadata
from comfy_kitchen.tensor import TensorWiseINT8Layout
assert metadata.version("comfy-kitchen") == "0.2.11"
assert TensorWiseINT8Layout is not None
'@
  $verifyCode | & $python -
  if ($LASTEXITCODE -ne 0) {
    throw "comfy-kitchen INT8 TensorWise verification failed with exit code $LASTEXITCODE"
  }
}

$evidence = [ordered]@{
  schemaVersion = 1
  patchId = [string]$manifest.patchId
  upstreamCommit = [string]$manifest.upstreamCommit
  dependency = [ordered]@{
    name = [string]$manifest.dependency.name
    version = [string]$manifest.dependency.patchedVersion
    installed = -not [bool]$SkipDependencyInstall
  }
  files = @($states | ForEach-Object {
    [ordered]@{
      path = $_.RelativePath.Replace([System.IO.Path]::DirectorySeparatorChar, '/')
      sha256 = $_.PatchedHash
    }
  })
}
$evidencePath = Join-Path $RuntimeRoot "novaflow-runtime-int8-tensorwise-v1.json"
$evidenceJson = $evidence | ConvertTo-Json -Depth 8
[System.IO.File]::WriteAllText($evidencePath, $evidenceJson + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))

Write-Host "Applied comfy-int8-tensorwise-v1 to $RuntimeRoot"
Write-Host "Evidence: $evidencePath"
