@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "RUNTIME_DIR=%%~fI"
set "RUNTIME_JSON=%RUNTIME_DIR%\runtime.json"
set "COMFY_MAIN=%RUNTIME_DIR%\engine\ComfyUI\main.py"
set "GENERATED_DIR=%NOVAFLOW_AI_RUNTIME_GENERATED_DIR%"
if not defined GENERATED_DIR set "GENERATED_DIR=%TEMP%\NovaFlow\AI-Runtime\runtime-generated"
if not defined GENERATED_DIR set "GENERATED_DIR=%TMP%\NovaFlow\AI-Runtime\runtime-generated"
set "PID_FILE=%GENERATED_DIR%\runtime.pid"

if not exist "%RUNTIME_JSON%" (
  echo NovaFlow AI Runtime runtime.json was not found: "%RUNTIME_JSON%"
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$runtime=Get-Content -Raw -LiteralPath $env:RUNTIME_JSON | ConvertFrom-Json;" ^
  "$port=if ($runtime.port) { [int]$runtime.port } else { 8188 };" ^
  "$mainFull=(Resolve-Path -LiteralPath $env:COMFY_MAIN).Path;" ^
  "$mainNeedle=$mainFull.ToLowerInvariant();" ^
  "$mainNeedleAlt=$mainNeedle.Replace('\','/');" ^
  "function Test-RuntimeCommand([string]$cmd) { $cmdLower=$cmd.ToLowerInvariant(); return (($cmdLower.Contains($mainNeedle) -or $cmdLower.Contains($mainNeedleAlt)) -and ($cmd -match ('--port\s+' + $port + '(\s|$)'))) }" ^
  "$listeners=Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue;" ^
  "$owners=@($listeners | Select-Object -ExpandProperty OwningProcess -Unique);" ^
  "$pidValue=0;" ^
  "if (Test-Path -LiteralPath $env:PID_FILE) { $pidText=(Get-Content -Raw -LiteralPath $env:PID_FILE).Trim(); if ($pidText -match '^\d+$') { $pidValue=[int]$pidText } else { Remove-Item -LiteralPath $env:PID_FILE -Force -ErrorAction SilentlyContinue; Write-Host ('Removed malformed NovaFlow AI Runtime pid file: ' + $env:PID_FILE) } }" ^
  "$targetPid=0;" ^
  "if ($pidValue -gt 0) { $proc=Get-CimInstance Win32_Process -Filter ('ProcessId=' + $pidValue) -ErrorAction SilentlyContinue; $cmd=if ($proc) { [string]$proc.CommandLine } else { '' }; if ((Test-RuntimeCommand $cmd) -and ($owners -contains $pidValue)) { $targetPid=$pidValue } }" ^
  "if (-not $targetPid) { foreach ($owner in $owners) { $ownerProc=Get-CimInstance Win32_Process -Filter ('ProcessId=' + $owner) -ErrorAction SilentlyContinue; $ownerCmd=if ($ownerProc) { [string]$ownerProc.CommandLine } else { '' }; if (Test-RuntimeCommand $ownerCmd) { $targetPid=[int]$owner; break } } }" ^
  "if (-not $targetPid) { Remove-Item -LiteralPath $env:PID_FILE -Force -ErrorAction SilentlyContinue; Write-Host ('NovaFlow AI Runtime has no verified listener; stale PID removed: ' + $pidValue); exit 0 }" ^
  "& taskkill.exe /PID $targetPid /T /F | Out-Null;" ^
  "Remove-Item -LiteralPath $env:PID_FILE -Force -ErrorAction SilentlyContinue;" ^
  "Write-Host ('NovaFlow AI Runtime stopped. PID: ' + $targetPid);"

exit /b %ERRORLEVEL%
