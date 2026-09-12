[CmdletBinding()]
param([switch]$Install, [switch]$RetireModels)
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$manifestPath = Join-Path $repoRoot 'docs\qwen-rapid-install-manifest-2026-09-12.json'
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
$installerPath = Join-Path $repoRoot 'particle-editor-desktop\dist\NovaFlow Setup 2.3.214.exe'
$installedRoot = 'C:\Program Files\NovaFlowPortable\resources\app'
if ((Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash -ne $manifest.installerSha256) {
  throw 'Installer changed since validation. Revalidate before installing or removing models.'
}
if ($Install) {
  $running = @(Get-CimInstance Win32_Process | Where-Object {
    $_.Name -in @('NovaFlowPortable.exe', 'NovaFlow.exe') -and $_.ExecutablePath -like 'C:\Program Files\NovaFlowPortable\*'
  })
  if ($running.Count) { throw 'Close the installed NovaFlow application before upgrading. No models were removed.' }
  $process = Start-Process -FilePath $installerPath -ArgumentList '/S' -Verb RunAs -WindowStyle Hidden -PassThru -Wait
  if ($process.ExitCode -ne 0) { throw "Installer exited with $($process.ExitCode). No models were removed." }
}
foreach ($file in $manifest.files) {
  $installedFile = Join-Path $installedRoot $file.path
  if (!(Test-Path -LiteralPath $installedFile -PathType Leaf) -or (Get-FileHash -LiteralPath $installedFile -Algorithm SHA256).Hash -ne $file.sha256) {
    throw "Installed file differs from the validated Rapid build: $installedFile. No models were removed."
  }
}
Write-Output 'Installed Rapid files match the validated package.'
if (!$RetireModels) { return }
$queue = Invoke-RestMethod -Uri 'http://127.0.0.1:8188/queue' -TimeoutSec 10
if ($queue.queue_running.Count -or $queue.queue_pending.Count) { throw 'Runtime has queued work. No models were removed.' }
$rapid = Get-Item -LiteralPath 'E:\NovaFlow\models\checkpoints\Qwen-Rapid-AIO-NSFW-v20.safetensors'
if ($rapid.Length -ne 28431840903) { throw 'Rapid checkpoint size differs from the validated model.' }
$targets = @(
  [pscustomobject]@{ path = 'E:\NovaFlow\models\diffusion_models\qwen_image_edit_2511_bf16.safetensors'; bytes = 40861031560 },
  [pscustomobject]@{ path = 'E:\NovaFlow\models\unet\qwen_image_edit_2511_fp8mixed.safetensors'; bytes = 20533762817 }
)
# Check every exact target before removing any file; no recursive or wildcard deletion.
foreach ($target in $targets) {
  if (!(Test-Path -LiteralPath $target.path)) { continue }
  $item = Get-Item -LiteralPath $target.path
  if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.FullName -ne $target.path -or $item.Length -ne $target.bytes) {
    throw "Unexpected model target: $($target.path). No models were removed."
  }
}
Invoke-RestMethod -Uri 'http://127.0.0.1:8188/free' -Method Post -ContentType 'application/json' -Body '{"unload_models":true,"free_memory":true}' -TimeoutSec 15 | Out-Null
$retired = @()
foreach ($target in $targets) {
  if (Test-Path -LiteralPath $target.path) {
    Remove-Item -LiteralPath $target.path -Force
    if (Test-Path -LiteralPath $target.path) { throw "Model removal did not complete: $($target.path)" }
    $retired += $target
  }
}
$report = [pscustomobject]@{ installedVerified = $true; retiredAt = (Get-Date).ToUniversalTime().ToString('o'); removed = $retired; releasedBytes = ($retired | Measure-Object -Property bytes -Sum).Sum }
$report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $repoRoot 'docs\qwen-rapid-retired-models-2026-09-12.json') -Encoding utf8
$report | ConvertTo-Json -Depth 5
