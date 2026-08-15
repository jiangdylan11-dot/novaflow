@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "RUNTIME_DIR=%%~fI"
set "RUNTIME_JSON=%RUNTIME_DIR%\runtime.json"
set "COMFY_DIR=%RUNTIME_DIR%\engine\ComfyUI"
set "COMFY_MAIN=%COMFY_DIR%\main.py"
set "PYTHON_EXE=%RUNTIME_DIR%\engine\python\python.exe"
set "GENERATED_DIR=%NOVAFLOW_AI_RUNTIME_GENERATED_DIR%"
if not defined GENERATED_DIR set "GENERATED_DIR=%TEMP%\NovaFlow\AI-Runtime\runtime-generated"
if not defined GENERATED_DIR set "GENERATED_DIR=%TMP%\NovaFlow\AI-Runtime\runtime-generated"
set "MODEL_CONFIG=%GENERATED_DIR%\extra_model_paths.yaml"
set "PID_FILE=%GENERATED_DIR%\runtime.pid"
set "LOG_DIR=%RUNTIME_DIR%\logs"
set "PYTHONIOENCODING=utf-8:replace"
set "PYTHONUNBUFFERED=1"

if not exist "%RUNTIME_JSON%" (
  echo NovaFlow AI Runtime runtime.json was not found: "%RUNTIME_JSON%"
  exit /b 1
)

if not exist "%PYTHON_EXE%" (
  echo NovaFlow AI Runtime python.exe was not found: "%PYTHON_EXE%"
  exit /b 1
)

if not exist "%COMFY_MAIN%" (
  echo NovaFlow AI Runtime engine main.py was not found: "%COMFY_MAIN%"
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "function Quote-Arg([string]$value) { $dq=[string][char]34; $bs=[string][char]92; return $dq + $value.Replace($dq, ($bs + $dq)) + $dq }" ^
  "function Get-CompactLogTail([string]$path) { try { if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return '' }; $text=(@(Get-Content -LiteralPath $path -Tail 12 -ErrorAction Stop) -join ' | ').Trim(); if ($text.Length -gt 1600) { return $text.Substring($text.Length - 1600) }; return $text } catch { return '' } }" ^
  "function Assert-RuntimeLauncherAlive($process, [string]$stdoutPath, [string]$stderrPath) { $process.Refresh(); if (-not $process.HasExited) { return }; $exitCode=try { [int]$process.ExitCode } catch { -1 }; try { if (Test-Path -LiteralPath $env:PID_FILE -PathType Leaf) { $recordedPid=(Get-Content -Raw -LiteralPath $env:PID_FILE -ErrorAction Stop).Trim(); if ($recordedPid -eq [string]$process.Id) { Remove-Item -LiteralPath $env:PID_FILE -Force -ErrorAction SilentlyContinue } } } catch {}; $stderrTail=Get-CompactLogTail $stderrPath; $stdoutTail=Get-CompactLogTail $stdoutPath; $details=@(); if ($stderrTail) { $details += ('stderr: ' + $stderrTail) }; if ($stdoutTail) { $details += ('stdout: ' + $stdoutTail) }; $message='NovaFlow AI Runtime launcher exited during early startup. PID: ' + $process.Id + ' ExitCode: ' + $exitCode; if ($details.Count -gt 0) { $message += '. ' + ($details -join ' | ') }; try { Add-Content -LiteralPath $stderrPath -Value ('[NovaFlow Runtime launcher] ' + $message) -Encoding UTF8 } catch {}; throw $message }" ^
  "$runtime=Get-Content -Raw -LiteralPath $env:RUNTIME_JSON | ConvertFrom-Json;" ^
  "$port=if ($runtime.port) { [int]$runtime.port } else { 8188 };" ^
  "$assets=[string]$runtime.assetsPath;" ^
  "$models=[string]$runtime.modelsPath;" ^
  "$customNodes=[string]$runtime.customNodesPath;" ^
  "if ([string]::IsNullOrWhiteSpace($assets)) { throw 'runtime.json assetsPath is empty.' }" ^
  "if ([string]::IsNullOrWhiteSpace($models)) { throw 'runtime.json modelsPath is empty.' }" ^
  "if ([string]::IsNullOrWhiteSpace($customNodes)) { throw 'runtime.json customNodesPath is empty.' }" ^
  "New-Item -ItemType Directory -Force -Path $env:GENERATED_DIR,$env:LOG_DIR,$assets,$models,$customNodes,(Join-Path $env:COMFY_DIR 'custom_nodes') | Out-Null;" ^
  "$inputDir=Join-Path $env:GENERATED_DIR 'input'; $outputDir=Join-Path $env:GENERATED_DIR 'output'; $tempRoot=Join-Path $env:GENERATED_DIR 'temp-root'; $userDir=Join-Path $env:GENERATED_DIR 'user';" ^
  "New-Item -ItemType Directory -Force -Path $inputDir,$outputDir,$tempRoot,$userDir | Out-Null;" ^
  "$modelDirs=@('checkpoints','loras','vae','controlnet','rembg','RMBG','diffusion_models','unet','text_encoders','clip','clip_vision','ipadapter','insightface','sam','grounding-dino','upscale_models','animatediff_models','animatediff_motion_lora','SeeThrough');" ^
  "foreach ($name in $modelDirs) { New-Item -ItemType Directory -Force -Path (Join-Path $models $name) | Out-Null }" ^
  "$assetsBase=$assets.Replace('\','/');" ^
  "$modelsBase=$models.Replace('\','/');" ^
  "$customNodesBase=$customNodes.Replace('\','/');" ^
  "$yaml=@('novaflow_models:', ('  base_path: ' + $modelsBase), '  is_default: true', '  checkpoints: checkpoints', '  loras: loras', '  vae: vae', '  controlnet: controlnet', '  rmbg: rembg', '  RMBG: RMBG', '  diffusion_models: diffusion_models', '  unet: unet', '  text_encoders: text_encoders', '  clip: clip', '  clip_vision: clip_vision', '  ipadapter: ipadapter', '  insightface: insightface', '  sam: sam', '  grounding-dino: grounding-dino', '  upscale_models: upscale_models', '  animatediff_models: animatediff_models', '  animatediff_motion_lora: animatediff_motion_lora', '  SeeThrough: SeeThrough', 'novaflow_custom_nodes:', ('  base_path: ' + $customNodesBase), '  is_default: true', '  custom_nodes: .');" ^
  "Set-Content -LiteralPath $env:MODEL_CONFIG -Value ($yaml -join [Environment]::NewLine) -Encoding UTF8;" ^
  "$mainFull=(Resolve-Path -LiteralPath $env:COMFY_MAIN).Path;" ^
  "$mainNeedle=$mainFull.ToLowerInvariant();" ^
  "$mainNeedleAlt=$mainNeedle.Replace('\','/');" ^
  "$listeners=Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue;" ^
  "if ($listeners) { $owners=$listeners | Select-Object -ExpandProperty OwningProcess -Unique; foreach ($owner in $owners) { $proc=Get-CimInstance Win32_Process -Filter ('ProcessId=' + $owner) -ErrorAction SilentlyContinue; $cmd=if ($proc) { [string]$proc.CommandLine } else { '' }; $cmdLower=$cmd.ToLowerInvariant(); if (($cmdLower.Contains($mainNeedle) -or $cmdLower.Contains($mainNeedleAlt)) -and ($cmd -match ('--port\s+' + $port + '(\s|$)'))) { Set-Content -LiteralPath $env:PID_FILE -Value $owner -Encoding ASCII; Write-Host ('NovaFlow AI Runtime already running. PID: ' + $owner); exit 0 } }; throw ('Port ' + $port + ' is already in use by another process.') }" ^
  "$stdout=Join-Path $env:LOG_DIR 'runtime.out.log'; $stderr=Join-Path $env:LOG_DIR 'runtime.err.log';" ^
  "$arguments=@((Quote-Arg $mainFull),'--listen','127.0.0.1','--port',[string]$port,'--base-directory',(Quote-Arg $assetsBase),'--extra-model-paths-config',(Quote-Arg $env:MODEL_CONFIG),'--input-directory',(Quote-Arg $inputDir),'--output-directory',(Quote-Arg $outputDir),'--temp-directory',(Quote-Arg $tempRoot),'--user-directory',(Quote-Arg $userDir)) -join ' ';" ^
  "$dq=[string][char]34;" ^
  "$cmdLine=$dq + $env:PYTHON_EXE + $dq + ' ' + $arguments + ' 1>> ' + $dq + $stdout + $dq + ' 2>> ' + $dq + $stderr + $dq;" ^
  "$cmdArgs='/d /c ' + $dq + $cmdLine + $dq;" ^
  "$proc=Start-Process -FilePath $env:ComSpec -ArgumentList $cmdArgs -WorkingDirectory $env:COMFY_DIR -WindowStyle Hidden -PassThru;" ^
  "Set-Content -LiteralPath $env:PID_FILE -Value $proc.Id -Encoding ASCII;" ^
  "$baseInputDir=Join-Path $assets 'input'; $baseInputReady=$false; $minimumAliveChecks=16; for ($i=0; $i -lt 40; $i++) { Assert-RuntimeLauncherAlive $proc $stdout $stderr; if (-not $baseInputReady -and (Test-Path -LiteralPath $baseInputDir -PathType Container)) { $hasChildren=@(Get-ChildItem -LiteralPath $baseInputDir -Force -ErrorAction SilentlyContinue).Count -gt 0; if ($hasChildren) { $baseInputReady=$true } else { Remove-Item -LiteralPath $baseInputDir -Force -ErrorAction SilentlyContinue } }; if ($baseInputReady -and $i -ge ($minimumAliveChecks - 1)) { break }; Start-Sleep -Milliseconds 250 }; Assert-RuntimeLauncherAlive $proc $stdout $stderr;" ^
  "Write-Host ('NovaFlow AI Runtime started. PID: ' + $proc.Id + ' Port: ' + $port);"

exit /b %ERRORLEVEL%
