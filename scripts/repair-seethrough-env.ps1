[CmdletBinding()]
param(
  [string]$ComfyRoot = "",
  [string]$PythonPath = "",
  [string]$ComfyBaseUrl = "http://127.0.0.1:8188",
  [switch]$Repair
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$requiredNodes = @(
  "SeeThrough_LoadLayerDiffModel",
  "SeeThrough_LoadDepthModel",
  "SeeThrough_GenerateLayers",
  "SeeThrough_GenerateDepth",
  "SeeThrough_PostProcess",
  "SeeThrough_SavePSD"
)

$shimBlock = @'
import sys as _sys

def _install_diffusers_compat_shims():
    try:
        import transformers.utils as _transformers_utils
        if not hasattr(_transformers_utils, "FLAX_WEIGHTS_NAME"):
            _transformers_utils.FLAX_WEIGHTS_NAME = "flax_model.msgpack"
    except Exception:
        pass

    try:
        import huggingface_hub as _huggingface_hub
        if not hasattr(_huggingface_hub, "cached_download") and hasattr(_huggingface_hub, "hf_hub_download"):
            _huggingface_hub.cached_download = _huggingface_hub.hf_hub_download
    except Exception:
        pass

_install_diffusers_compat_shims()
'@

function Write-Section {
  param([Parameter(Mandatory = $true)][string]$Title)

  Write-Host ""
  Write-Host "== $Title =="
}

function New-Backup {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Cannot back up missing file: $Path"
  }

  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $backup = "$Path.bak-$stamp"
  Copy-Item -LiteralPath $Path -Destination $backup -Force
  Write-Host "[BACKUP] $backup"
  return $backup
}

function Get-TextUtf8 {
  param([Parameter(Mandatory = $true)][string]$Path)

  return [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
}

function Set-TextUtf8NoBom {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Text
  )

  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Text, $encoding)
}

function Invoke-ComfyJson {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [int]$TimeoutSec = 10
  )

  $url = "$($ComfyBaseUrl.TrimEnd('/'))/$($Path.TrimStart('/'))"
  $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec $TimeoutSec
  return $response.Content
}

function Test-ComfyQueueEmpty {
  try {
    $raw = Invoke-ComfyJson -Path "queue" -TimeoutSec 8
    $queue = $raw | ConvertFrom-Json
    $running = @($queue.queue_running)
    $pending = @($queue.queue_pending)
    return @{
      ok = $true
      empty = ($running.Count -eq 0 -and $pending.Count -eq 0)
      running = $running.Count
      pending = $pending.Count
    }
  } catch {
    return @{
      ok = $false
      empty = $false
      error = $_.Exception.Message
    }
  }
}

function Test-SeeThroughNodes {
  try {
    $raw = Invoke-ComfyJson -Path "object_info" -TimeoutSec 30
    $missing = @($requiredNodes | Where-Object { -not $raw.Contains("`"$_`"") })
    return @{
      ok = ($missing.Count -eq 0)
      available = $true
      missing = $missing
    }
  } catch {
    return @{
      ok = $false
      available = $false
      missing = $requiredNodes
      error = $_.Exception.Message
    }
  }
}

function Get-PipShowField {
  param(
    [Parameter(Mandatory = $true)][string]$PythonPath,
    [Parameter(Mandatory = $true)][string]$PackageName,
    [Parameter(Mandatory = $true)][string]$FieldName
  )

  $lines = @(& $PythonPath -m pip show $PackageName 2>$null)
  if ($LASTEXITCODE -ne 0) {
    return ""
  }

  $prefix = "$FieldName`:"
  foreach ($line in $lines) {
    if ($line.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
      return $line.Substring($prefix.Length).Trim()
    }
  }
  return ""
}

function Invoke-PythonCompile {
  param(
    [Parameter(Mandatory = $true)][string]$PythonPath,
    [Parameter(Mandatory = $true)][string[]]$Paths
  )

  & $PythonPath -m py_compile @Paths
  return ($LASTEXITCODE -eq 0)
}

function Test-PipelineContaminated {
  param(
    [Parameter(Mandatory = $true)][string]$PythonPath,
    [Parameter(Mandatory = $true)][string]$PipelineFile
  )

  if (-not (Test-Path -LiteralPath $PipelineFile)) {
    return @{ contaminated = $true; reason = "missing file" }
  }

  $lines = @(Get-Content -LiteralPath $PipelineFile -TotalCount 180)
  $nestedTryCount = @(
    $lines | Where-Object { $_ -match "^\s{20,}try:\s*$" }
  ).Count
  if ($nestedTryCount -gt 4) {
    return @{ contaminated = $true; reason = "nested try count in file head: $nestedTryCount" }
  }

  if (-not (Invoke-PythonCompile -PythonPath $PythonPath -Paths @($PipelineFile))) {
    return @{ contaminated = $true; reason = "py_compile failed" }
  }

  return @{ contaminated = $false; reason = "" }
}

function Get-PluginState {
  param([Parameter(Mandatory = $true)][string]$PluginFile)

  if (-not (Test-Path -LiteralPath $PluginFile)) {
    return @{ exists = $false; shim = $false; destructivePatch = $false }
  }

  $text = Get-TextUtf8 -Path $PluginFile
  $hasShim = (
    $text.Contains("_install_diffusers_compat_shims") -and
    $text.Contains("FLAX_WEIGHTS_NAME") -and
    $text.Contains("cached_download")
  )
  $hasDestructivePatch = (
    $text.Contains("_patch_diffusers") -or
    $text.Contains("open(_p2") -or
    $text.Contains("writelines(_new)")
  )

  return @{ exists = $true; shim = $hasShim; destructivePatch = $hasDestructivePatch }
}

function Test-PluginSchedulerLocalFallback {
  param([Parameter(Mandatory = $true)][string]$PluginFile)

  if (-not (Test-Path -LiteralPath $PluginFile)) {
    return $false
  }

  $text = Get-TextUtf8 -Path $PluginFile
  return (
    $text.Contains("local_scheduler_model") -and
    $text.Contains("models" + '"' + ", " + '"' + "SeeThrough") -and
    $text.Contains("frankjoshua/juggernautXL_version6Rundiffusion")
  )
}

function Repair-SchedulerLocalFallback {
  param([Parameter(Mandatory = $true)][string]$PluginFile)

  if (-not (Test-Path -LiteralPath $PluginFile)) {
    throw "See-through plugin file is missing: $PluginFile"
  }

  if (Test-PluginSchedulerLocalFallback -PluginFile $PluginFile) {
    return $false
  }

  $text = Get-TextUtf8 -Path $PluginFile
  $old = @'
            model_id = "frankjoshua/juggernautXL_version6Rundiffusion"
            scheduler_name = "DPMPP_2M_SDE"
'@
  $new = @'
            local_scheduler_model = None
            try:
                import os as _os
                _current = _os.path.abspath(__file__)
                _marker = _os.sep + "custom_nodes" + _os.sep + "ComfyUI-See-through" + _os.sep
                _parts = _current.split(_marker, 1)
                if len(_parts) == 2:
                    _asset_root = _parts[0]
                    _candidate = _os.path.join(_asset_root, "models", "SeeThrough", "seethroughv0.0.2_layerdiff3d")
                    _config = _os.path.join(_candidate, "scheduler", "scheduler_config.json")
                    if _os.path.isfile(_config) and _os.path.getsize(_config) > 0:
                        local_scheduler_model = _candidate
            except Exception:
                local_scheduler_model = None
            model_id = local_scheduler_model or "frankjoshua/juggernautXL_version6Rundiffusion"
            scheduler_name = "DPMPP_2M_SDE"
'@

  if (-not $text.Contains($old)) {
    throw "Unable to locate scheduler model_id block in See-through plugin file: $PluginFile"
  }

  New-Backup -Path $PluginFile | Out-Null
  Set-TextUtf8NoBom -Path $PluginFile -Text ($text.Replace($old, $new))
  Write-Host "[REPAIR] Installed local scheduler fallback for See-through."
  return $true
}

function Repair-PluginShim {
  param([Parameter(Mandatory = $true)][string]$PluginFile)

  if (-not (Test-Path -LiteralPath $PluginFile)) {
    throw "See-through plugin file is missing: $PluginFile"
  }

  $text = Get-TextUtf8 -Path $PluginFile
  $newText = $null

  if ($text.Contains("_patch_diffusers")) {
    $pattern = "(?s)\A.*?_patch_diffusers\(\)\s*"
    $newText = [regex]::Replace($text, $pattern, $shimBlock.TrimEnd() + "`r`n`r`n", 1)
  } elseif (-not $text.Contains("_install_diffusers_compat_shims")) {
    $newText = $shimBlock.TrimEnd() + "`r`n`r`n" + $text.TrimStart()
  } elseif ($text.Contains("open(_p2") -or $text.Contains("writelines(_new)")) {
    throw "Plugin contains unexpected destructive patch remnants; refusing automatic edit: $PluginFile"
  } else {
    return $false
  }

  if ([string]::IsNullOrWhiteSpace($newText)) {
    throw "Failed to build repaired plugin content."
  }

  New-Backup -Path $PluginFile | Out-Null
  Set-TextUtf8NoBom -Path $PluginFile -Text $newText
  Write-Host "[REPAIR] Reinstalled See-through runtime shim."
  return $true
}

function Restore-DiffusersCurrentVersion {
  param(
    [Parameter(Mandatory = $true)][string]$PythonPath,
    [Parameter(Mandatory = $true)][string]$DiffusersVersion,
    [Parameter(Mandatory = $true)][string]$PipelineFile
  )

  if ([string]::IsNullOrWhiteSpace($DiffusersVersion)) {
    throw "Cannot restore diffusers because current version could not be detected."
  }

  if (Test-Path -LiteralPath $PipelineFile) {
    New-Backup -Path $PipelineFile | Out-Null
  }

  Write-Host "[REPAIR] Reinstalling current diffusers version: $DiffusersVersion"
  & $PythonPath -m pip install --force-reinstall --no-deps "diffusers==$DiffusersVersion"
  if ($LASTEXITCODE -ne 0) {
    throw "pip reinstall failed for diffusers==$DiffusersVersion"
  }
}

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$programDataRoot = if ([string]::IsNullOrWhiteSpace($env:ProgramData)) { "C:\ProgramData" } else { $env:ProgramData }
$runtimeJsonPath = Join-Path $programDataRoot "NovaFlow\AI-Runtime\runtime.json"
$runtimeConfig = $null
if (Test-Path -LiteralPath $runtimeJsonPath) {
  try {
    $runtimeConfig = Get-Content -LiteralPath $runtimeJsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    throw "NovaFlow AI Runtime runtime.json is invalid: $runtimeJsonPath"
  }
}
if ($runtimeConfig -ne $null) {
  if ([string]::IsNullOrWhiteSpace($ComfyRoot)) {
    if (-not [string]::IsNullOrWhiteSpace([string]$runtimeConfig.assetsPath)) {
      $ComfyRoot = [string]$runtimeConfig.assetsPath
    } elseif (-not [string]::IsNullOrWhiteSpace([string]$runtimeConfig.customNodesPath)) {
      $ComfyRoot = Split-Path -Parent ([string]$runtimeConfig.customNodesPath)
    }
  }
  if ([string]::IsNullOrWhiteSpace($PythonPath) -and -not [string]::IsNullOrWhiteSpace([string]$runtimeConfig.installPath)) {
    $PythonPath = Join-Path ([string]$runtimeConfig.installPath) "engine\python\python.exe"
  }
  if (-not [string]::IsNullOrWhiteSpace([string]$runtimeConfig.baseUrl) -and ($ComfyBaseUrl -eq "http://127.0.0.1:8188" -or [string]::IsNullOrWhiteSpace($ComfyBaseUrl))) {
    $ComfyBaseUrl = [string]$runtimeConfig.baseUrl
  }
}
if ([string]::IsNullOrWhiteSpace($ComfyRoot)) {
  throw "NovaFlow AI Runtime assets path is missing. Install Runtime or pass -ComfyRoot explicitly."
}
if ([string]::IsNullOrWhiteSpace($PythonPath)) {
  throw "NovaFlow AI Runtime python path is missing. Install Runtime or pass -PythonPath explicitly."
}
$comfyRootFull = if (Test-Path -LiteralPath $ComfyRoot) { (Resolve-Path -LiteralPath $ComfyRoot).Path } else { [System.IO.Path]::GetFullPath($ComfyRoot) }
$pythonPath = if (-not [string]::IsNullOrWhiteSpace($PythonPath)) {
  if (Test-Path -LiteralPath $PythonPath) { (Resolve-Path -LiteralPath $PythonPath).Path } else { [System.IO.Path]::GetFullPath($PythonPath) }
} else {
  ""
}
$pluginFile = Join-Path $comfyRootFull "custom_nodes\ComfyUI-See-through\see-through\common\modules\layerdiffuse\diffusers_kdiffusion_sdxl.py"

Write-Host "NovaFlow See-through environment check"
Write-Host "Repo root: $repoRoot"
Write-Host "Mode: $(if ($Repair) { 'repair' } else { 'check' })"
Write-Host "Runtime assets root: $comfyRootFull"
Write-Host "Runtime base URL: $ComfyBaseUrl"

if (-not (Test-Path -LiteralPath $pythonPath)) {
  throw "NovaFlow AI Runtime python is missing: $pythonPath"
}

$diffusersVersion = Get-PipShowField -PythonPath $pythonPath -PackageName "diffusers" -FieldName "Version"
$sitePackages = Get-PipShowField -PythonPath $pythonPath -PackageName "diffusers" -FieldName "Location"
if ([string]::IsNullOrWhiteSpace($sitePackages)) {
  throw "Unable to locate diffusers site-packages path."
}

$pipelineFile = Join-Path $sitePackages "diffusers\pipelines\pipeline_loading_utils.py"
$changed = $false
$failures = New-Object System.Collections.Generic.List[string]

Write-Section "File state"
Write-Host "diffusers version: $diffusersVersion"
Write-Host "plugin file: $pluginFile"
Write-Host "pipeline file: $pipelineFile"

$pluginState = Get-PluginState -PluginFile $pluginFile
Write-Host "plugin exists: $($pluginState.exists)"
Write-Host "plugin shim: $($pluginState.shim)"
Write-Host "plugin destructive patch: $($pluginState.destructivePatch)"
$schedulerLocalFallback = Test-PluginSchedulerLocalFallback -PluginFile $pluginFile
Write-Host "plugin local scheduler fallback: $schedulerLocalFallback"
if (-not $pluginState.exists) {
  $failures.Add("See-through plugin file is missing.")
} elseif (-not $pluginState.shim -or $pluginState.destructivePatch) {
  if ($Repair) {
    $changed = (Repair-PluginShim -PluginFile $pluginFile) -or $changed
  } else {
    $failures.Add("See-through plugin shim is missing or destructive patch returned.")
  }
}
if ($pluginState.exists -and -not $schedulerLocalFallback) {
  if ($Repair) {
    $changed = (Repair-SchedulerLocalFallback -PluginFile $pluginFile) -or $changed
  } else {
    $failures.Add("See-through plugin does not prefer the local scheduler config and may block on HuggingFace.")
  }
}

$pipelineState = Test-PipelineContaminated -PythonPath $pythonPath -PipelineFile $pipelineFile
Write-Host "pipeline contaminated: $($pipelineState.contaminated)"
if ($pipelineState.contaminated) {
  Write-Host "pipeline reason: $($pipelineState.reason)"
  if ($Repair) {
    Restore-DiffusersCurrentVersion -PythonPath $pythonPath -DiffusersVersion $diffusersVersion -PipelineFile $pipelineFile
    $changed = $true
  } else {
    $failures.Add("diffusers pipeline file looks contaminated: $($pipelineState.reason)")
  }
}

Write-Section "Runtime state"
$queue = Test-ComfyQueueEmpty
if ($queue.ok) {
  Write-Host "queue running: $($queue.running)"
  Write-Host "queue pending: $($queue.pending)"
} else {
  Write-Host "[WARN] Unable to read Runtime queue: $($queue.error)"
}

$nodesBefore = Test-SeeThroughNodes
Write-Host "see-through nodes available: $($nodesBefore.ok)"
if (-not $nodesBefore.ok) {
  Write-Host "missing nodes: $($nodesBefore.missing -join ', ')"
  if ($Repair) {
    $failures.Add("See-through nodes are missing from Runtime object_info. Restart Runtime from Runtime Manager after repair, then rerun this check.")
  } else {
    $failures.Add("See-through nodes are missing from Runtime object_info.")
  }
}

if ($Repair) {
  Write-Section "Post-repair validation"
  $null = Invoke-PythonCompile -PythonPath $pythonPath -Paths @($pluginFile, $pipelineFile)
  $nodesAfter = Test-SeeThroughNodes
  Write-Host "see-through nodes available: $($nodesAfter.ok)"
  if (-not $nodesAfter.ok) {
    throw "Repair finished but See-through nodes are still missing: $($nodesAfter.missing -join ', ')"
  }
}

if ($failures.Count -gt 0) {
  Write-Section "Result"
  foreach ($failure in $failures) {
    Write-Host "[FAIL] $failure"
  }
  exit 1
}

Write-Section "Result"
if ($Repair -and $changed) {
  Write-Host "[OK] See-through environment repaired."
} else {
  Write-Host "[OK] See-through environment is healthy."
}
