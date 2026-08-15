@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "RUNTIME_DIR=%%~fI"
if exist "%SCRIPT_DIR%runtime.json" set "RUNTIME_DIR=%SCRIPT_DIR%"
set "RUNTIME_JSON=%RUNTIME_DIR%\runtime.json"
set "COMFY_MAIN=%RUNTIME_DIR%\engine\ComfyUI\main.py"
set "GENERATED_DIR=%NOVAFLOW_AI_RUNTIME_H3_GENERATED_DIR%"
set "H3_PROGRAM_DATA=%ProgramData%"
if not defined H3_PROGRAM_DATA set "H3_PROGRAM_DATA=C:\ProgramData"
if not defined GENERATED_DIR set "GENERATED_DIR=%H3_PROGRAM_DATA%\NovaFlow\AI-Runtime-H3\generated"
set "PID_FILE=%GENERATED_DIR%\runtime.pid"

if not exist "%RUNTIME_JSON%" (
  echo NovaFlow AI Runtime H3 runtime.json was not found: "%RUNTIME_JSON%"
  exit /b 1
)
if not exist "%COMFY_MAIN%" (
  echo NovaFlow AI Runtime H3 engine main.py was not found: "%COMFY_MAIN%"
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$runtime=Get-Content -Raw -LiteralPath $env:RUNTIME_JSON | ConvertFrom-Json; $port=[int]$runtime.port; if ($port -ne 8189) { throw 'NovaFlow AI Runtime H3 must use port 8189.' };" ^
  "$mainFull=(Resolve-Path -LiteralPath $env:COMFY_MAIN).Path; $mainNeedle=$mainFull.ToLowerInvariant(); $mainNeedleAlt=$mainNeedle.Replace('\','/');" ^
  "function Test-RuntimeCommand([string]$cmd) { $cmdLower=$cmd.ToLowerInvariant(); return (($cmdLower.Contains($mainNeedle) -or $cmdLower.Contains($mainNeedleAlt)) -and ($cmd -match ('--port\s+' + $port + '(\s|$)')) -and $cmdLower.Contains('--disable-api-nodes')) };" ^
  "$listeners=Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue; $owners=@($listeners | Select-Object -ExpandProperty OwningProcess -Unique);" ^
  "$pidValue=0; if (Test-Path -LiteralPath $env:PID_FILE) { $pidText=(Get-Content -Raw -LiteralPath $env:PID_FILE).Trim(); if ($pidText -match '^\d+$') { $pidValue=[int]$pidText } else { Remove-Item -LiteralPath $env:PID_FILE -Force -ErrorAction SilentlyContinue } };" ^
  "$targetPid=0; if ($pidValue -gt 0) { $proc=Get-CimInstance Win32_Process -Filter ('ProcessId=' + $pidValue) -ErrorAction SilentlyContinue; $cmd=if ($proc) { [string]$proc.CommandLine } else { '' }; if ((Test-RuntimeCommand $cmd) -and ($owners -contains $pidValue)) { $targetPid=$pidValue } };" ^
  "if (-not $targetPid) { foreach ($owner in $owners) { $ownerProc=Get-CimInstance Win32_Process -Filter ('ProcessId=' + $owner) -ErrorAction SilentlyContinue; $ownerCmd=if ($ownerProc) { [string]$ownerProc.CommandLine } else { '' }; if (Test-RuntimeCommand $ownerCmd) { $targetPid=[int]$owner; break } } };" ^
  "if (-not $targetPid) { Remove-Item -LiteralPath $env:PID_FILE -Force -ErrorAction SilentlyContinue; Write-Host ('NovaFlow AI Runtime H3 has no verified listener; stale PID removed: ' + $pidValue); exit 0 };" ^
  "& taskkill.exe /PID $targetPid /T /F | Out-Null; Remove-Item -LiteralPath $env:PID_FILE -Force -ErrorAction SilentlyContinue; Write-Host ('NovaFlow AI Runtime H3 stopped. PID: ' + $targetPid);"

exit /b %ERRORLEVEL%
