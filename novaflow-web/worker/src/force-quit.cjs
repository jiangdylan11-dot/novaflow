// The command a detached PowerShell runs when the assistant's orderly stop did not finish.
// It ends the image runtime the assistant started (the process recorded in owned-runtimes.json, and only
// while that process is still a ComfyUI main.py: a recycled process id must not take down something
// else) and then the assistant's whole process tree, which includes the tunnel tool.
function forceQuitCommand() {
  return [
    "$ErrorActionPreference='SilentlyContinue'",
    "try { $owned = Get-Content -Raw $env:FOART_QUIT_RUNTIMES | ConvertFrom-Json } catch { $owned = $null }",
    "if ($owned) { foreach ($item in $owned.PSObject.Properties) { $id = [int]$item.Value.pid; if ($id -gt 0) {" +
      " $p = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $id);" +
      " if ($p -and ([string]$p.CommandLine).ToLowerInvariant().Replace('/','\\').Contains('comfyui\\main.py')) { taskkill.exe /PID $id /T /F | Out-Null } } } }",
    "if ($owned) { Set-Content -Path $env:FOART_QUIT_RUNTIMES -Value '{}' -Encoding ASCII }",
    "taskkill.exe /PID $env:FOART_QUIT_PID /T /F | Out-Null",
    "exit 0"
  ].join('; ');
}
module.exports = { forceQuitCommand };
