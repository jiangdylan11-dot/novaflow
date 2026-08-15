@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "RUNTIME_DIR=%%~fI"
set "RUNTIME_JSON=%RUNTIME_DIR%\runtime.json"

if not exist "%RUNTIME_JSON%" (
  echo NovaFlow AI Runtime runtime.json was not found: "%RUNTIME_JSON%"
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$runtime=Get-Content -Raw -LiteralPath $env:RUNTIME_JSON | ConvertFrom-Json;" ^
  "$port=if ($runtime.port) { [int]$runtime.port } else { 8188 };" ^
  "$uri='http://127.0.0.1:' + $port + '/system_stats';" ^
  "try { Invoke-RestMethod -Uri $uri -TimeoutSec 5 | Out-Null; Write-Host ('NovaFlow AI Runtime healthy: ' + $uri); exit 0 } catch { Write-Host ('NovaFlow AI Runtime health check failed: ' + $uri); Write-Host $_.Exception.Message; exit 1 }"

exit /b %ERRORLEVEL%
