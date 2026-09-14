@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "RUNTIME_DIR=%%~fI"
if exist "%SCRIPT_DIR%runtime.json" set "RUNTIME_DIR=%SCRIPT_DIR%"
set "RUNTIME_JSON=%RUNTIME_DIR%\runtime.json"
set "COMFY_DIR=%RUNTIME_DIR%\engine\ComfyUI"
set "COMFY_MAIN=%COMFY_DIR%\main.py"
set "PYTHON_EXE=%RUNTIME_DIR%\engine\python\python.exe"
set "GENERATED_DIR=%NOVAFLOW_AI_RUNTIME_H3_GENERATED_DIR%"
set "H3_PROGRAM_DATA=%ProgramData%"
if not defined H3_PROGRAM_DATA set "H3_PROGRAM_DATA=C:\ProgramData"
if not defined GENERATED_DIR set "GENERATED_DIR=%H3_PROGRAM_DATA%\NovaFlow\AI-Runtime-H3\generated"
set "MODEL_CONFIG=%GENERATED_DIR%\extra_model_paths.yaml"
set "PID_FILE=%GENERATED_DIR%\runtime.pid"
set "LOG_DIR=%RUNTIME_DIR%\logs"
set "PYTHONIOENCODING=utf-8:replace"
set "PYTHONUNBUFFERED=1"

if not exist "%RUNTIME_JSON%" (
  echo NovaFlow AI Runtime H3 runtime.json was not found: "%RUNTIME_JSON%"
  exit /b 1
)
if not exist "%PYTHON_EXE%" (
  echo NovaFlow AI Runtime H3 python.exe was not found: "%PYTHON_EXE%"
  exit /b 1
)
if not exist "%COMFY_MAIN%" (
  echo NovaFlow AI Runtime H3 engine main.py was not found: "%COMFY_MAIN%"
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "function Quote-Arg([string]$value) { $dq=[string][char]34; $bs=[string][char]92; return $dq + $value.Replace($dq, ($bs + $dq)) + $dq }" ^
  "$runtime=Get-Content -Raw -LiteralPath $env:RUNTIME_JSON | ConvertFrom-Json;" ^
  "$port=[int]$runtime.port; if ($port -ne 8189) { throw 'NovaFlow AI Runtime H3 must use port 8189.' };" ^
  "$hostValue=[string]$runtime.host; if ([string]::IsNullOrWhiteSpace($hostValue)) { $hostValue='127.0.0.1' }; if ($hostValue -ne '127.0.0.1') { throw 'NovaFlow AI Runtime H3 must bind 127.0.0.1.' };" ^
  "$assets=[string]$runtime.assetsPath; $models=[string]$runtime.modelsPath; $customNodes=[string]$runtime.customNodesPath;" ^
  "if ([string]::IsNullOrWhiteSpace($assets)) { throw 'runtime.json assetsPath is empty.' }; if ([string]::IsNullOrWhiteSpace($models)) { throw 'runtime.json modelsPath is empty.' }; if ([string]::IsNullOrWhiteSpace($customNodes)) { throw 'runtime.json customNodesPath is empty.' };" ^
  "New-Item -ItemType Directory -Force -Path $env:GENERATED_DIR,$env:LOG_DIR,$assets,$models,$customNodes,(Join-Path $assets 'custom_nodes'),(Join-Path $env:COMFY_DIR 'custom_nodes'),(Join-Path $env:COMFY_DIR 'user') | Out-Null;" ^
  "$inputDir=Join-Path $env:GENERATED_DIR 'input'; $outputDir=Join-Path $env:GENERATED_DIR 'output'; $tempRoot=Join-Path $env:GENERATED_DIR 'temp-root'; $userDir=Join-Path $env:GENERATED_DIR 'user'; New-Item -ItemType Directory -Force -Path $inputDir,$outputDir,$tempRoot,$userDir | Out-Null;" ^
  "$modelDirs=@('checkpoints','loras','vae','diffusion_models','unet','text_encoders','clip','clip_vision'); foreach ($name in $modelDirs) { New-Item -ItemType Directory -Force -Path (Join-Path $models $name) | Out-Null };" ^
  "$modelsBase=$models.Replace('\','/'); $customNodesBase=$customNodes.Replace('\','/');" ^
  "$yaml=@('novaflow_h3_models:',('  base_path: ' + $modelsBase),'  is_default: true','  checkpoints: checkpoints','  loras: loras','  vae: vae','  diffusion_models: diffusion_models','  unet: unet','  text_encoders: text_encoders','  clip: clip','  clip_vision: clip_vision','novaflow_h3_custom_nodes:',('  base_path: ' + $customNodesBase),'  is_default: true','  custom_nodes: .'); Set-Content -LiteralPath $env:MODEL_CONFIG -Value ($yaml -join [Environment]::NewLine) -Encoding UTF8;" ^
  "$mainFull=(Resolve-Path -LiteralPath $env:COMFY_MAIN).Path; $mainNeedle=$mainFull.ToLowerInvariant(); $mainNeedleAlt=$mainNeedle.Replace('\','/');" ^
  "$listeners=Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue; if ($listeners) { $owners=$listeners | Select-Object -ExpandProperty OwningProcess -Unique; foreach ($owner in $owners) { $proc=Get-CimInstance Win32_Process -Filter ('ProcessId=' + $owner) -ErrorAction SilentlyContinue; $cmd=if ($proc) { [string]$proc.CommandLine } else { '' }; $cmdLower=$cmd.ToLowerInvariant(); if (($cmdLower.Contains($mainNeedle) -or $cmdLower.Contains($mainNeedleAlt)) -and ($cmd -match ('--port\s+' + $port + '(\s|$)')) -and $cmdLower.Contains('--disable-api-nodes')) { Set-Content -LiteralPath $env:PID_FILE -Value $owner -Encoding ASCII; Write-Host ('NovaFlow AI Runtime H3 already running. PID: ' + $owner); exit 0 } }; throw ('Port ' + $port + ' is already in use by another process.') };" ^
  "$starting=Get-CimInstance Win32_Process -Filter ('Name=' + [char]39 + 'python.exe' + [char]39) -ErrorAction SilentlyContinue | Where-Object { $line=([string]$_.CommandLine).ToLowerInvariant(); ($line.Contains($mainNeedle) -or $line.Contains($mainNeedleAlt)) -and ($line -match ('--port\s+' + $port + '(\s|$)')) -and $line.Contains('--disable-api-nodes') } | Select-Object -First 1; if ($starting) { Set-Content -LiteralPath $env:PID_FILE -Value $starting.ProcessId -Encoding ASCII; Write-Host ('NovaFlow AI Runtime H3 is still starting. PID: ' + $starting.ProcessId); exit 0 };" ^
  "$stdout=Join-Path $env:LOG_DIR 'runtime.out.log'; $stderr=Join-Path $env:LOG_DIR 'runtime.err.log';" ^
  "$archiveDir=Join-Path $env:LOG_DIR 'archive'; New-Item -ItemType Directory -Force -Path $archiveDir | Out-Null; $runId=(Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss-fff');" ^
  "function Archive-PreviousLog([string]$source) { if (-not (Test-Path -LiteralPath $source)) { return $source }; $leaf=[IO.Path]::GetFileNameWithoutExtension($source); $extension=[IO.Path]::GetExtension($source); $destination=Join-Path $archiveDir ($leaf + '.' + $runId + '.' + [guid]::NewGuid().ToString('N') + $extension); try { Move-Item -LiteralPath $source -Destination $destination -ErrorAction Stop; return $source } catch { return (Join-Path $env:LOG_DIR ($leaf + '.' + $runId + '.' + [guid]::NewGuid().ToString('N') + $extension)) } }; $stdout=Archive-PreviousLog $stdout; $stderr=Archive-PreviousLog $stderr;" ^
  "$arguments=@((Quote-Arg $mainFull),'--listen','127.0.0.1','--port',[string]$port,'--disable-api-nodes','--enable-cors-header',(Quote-Arg '*'),'--base-directory',(Quote-Arg $assets),'--extra-model-paths-config',(Quote-Arg $env:MODEL_CONFIG),'--input-directory',(Quote-Arg $inputDir),'--output-directory',(Quote-Arg $outputDir),'--temp-directory',(Quote-Arg $tempRoot),'--user-directory',(Quote-Arg $userDir)) -join ' ';" ^
  "$proc=Start-Process -FilePath $env:PYTHON_EXE -ArgumentList $arguments -WorkingDirectory $env:COMFY_DIR -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru; Start-Sleep -Milliseconds 750; if ($proc.HasExited) { $tail=''; try { $tail=(Get-Content -LiteralPath $stderr -Tail 20 -ErrorAction Stop) -join [Environment]::NewLine } catch { $tail='' }; throw ('NovaFlow AI Runtime H3 exited during launch. ExitCode=' + $proc.ExitCode + ' ' + $tail) }; Set-Content -LiteralPath $env:PID_FILE -Value $proc.Id -Encoding ASCII;" ^
  "Write-Host ('NovaFlow AI Runtime H3 started. PID: ' + $proc.Id + ' Port: ' + $port);"

exit /b %ERRORLEVEL%
