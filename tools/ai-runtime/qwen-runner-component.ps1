# Helpers for the optional, pinned Qwen runner component. The calling build
# must pin the digest of the reviewed manifest; do not trust a caller's JSON.
function Get-QwenRunnerFileHash {
  param([Parameter(Mandatory=$true)][string] $Path)
  $stream = [IO.File]::OpenRead($Path)
  $hash = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($hash.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
  finally { $hash.Dispose(); $stream.Dispose() }
}

function Get-QwenRunnerFile {
  param([string] $Root, [string] $Relative)
  if (-not $Relative -or $Relative -notmatch '^[A-Za-z0-9._+/-]+$' -or
      @($Relative.Split('/') | Where-Object { -not $_ -or $_ -eq '.' -or $_ -eq '..' }).Count) {
    throw 'Qwen runner manifest contains an invalid relative path.'
  }
  $path = [IO.Path]::GetFullPath($Root)
  $item = Get-Item -LiteralPath $path -Force -ErrorAction Stop
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or -not $item.PSIsContainer) {
    throw 'Qwen runner root must be a real directory.'
  }
  foreach ($part in $Relative.Split('/')) {
    $path = Join-Path $path $part
    $item = Get-Item -LiteralPath $path -Force -ErrorAction Stop
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Qwen runner links are not accepted.' }
  }
  if ($item.PSIsContainer) { throw 'Qwen runner entry is not a file.' }
  return $item
}

# Inspect the pinned upstream inventory without granting permission to package
# or execute it. The inventory records source identity only; redistribution
# notices and the runtime's GPU ownership checks are separate release gates.
function Test-QwenRunnerOfficialInventory {
  param(
    [Parameter(Mandatory=$true)][string] $Root,
    [Parameter(Mandatory=$true)][string] $InventoryPath,
    [Parameter(Mandatory=$true)][string] $TrustedInventorySHA256,
    [ValidateSet('cpu','cuda12')][string] $Profile = 'cpu'
  )
  if ($TrustedInventorySHA256 -notmatch '^[a-f0-9]{64}$' -or
      -not (Test-Path -LiteralPath $InventoryPath -PathType Leaf) -or
      (Get-QwenRunnerFileHash $InventoryPath) -ne $TrustedInventorySHA256) {
    throw 'Qwen runner inventory is missing or does not match its pinned digest.'
  }
  $inventory = Get-Content -Raw -LiteralPath $InventoryPath | ConvertFrom-Json
  if ($inventory.schema -ne 'nf.qwen-runner.official-inventory.v1' -or
      $inventory.component -ne 'ollama-v0.40.13' -or $inventory.target -ne 'windows-x86_64' -or
      $inventory.sourceURL -ne 'https://github.com/ollama/ollama/releases/download/v0.40.13/ollama-windows-amd64.zip' -or
      $inventory.archiveSHA256 -ne '7afa38624fa62ee5d8293422d0ab084c1bb4603134c7f4dafce11a033b57cc19' -or
      $inventory.includesModels -ne $false -or $inventory.redistributionApproved -ne $false -or
      $inventory.gpuExecutionApproved -ne $false -or -not $inventory.files) {
    throw 'Qwen runner inventory metadata is invalid.'
  }
  $seen = @{}
  $selected = @()
  foreach ($entry in @($inventory.files)) {
    $name = [string]$entry.path
    $key = $name.ToLowerInvariant()
    if ($seen.ContainsKey($key) -or $entry.group -notin @('cpu','cuda12') -or
        $entry.sha256 -notmatch '^[a-f0-9]{64}$' -or $null -eq $entry.bytes -or [long]$entry.bytes -le 0 -or
        ($entry.group -eq 'cpu' -and $name -notmatch '^lib/ollama/[A-Za-z0-9._+-]+$') -or
        ($entry.group -eq 'cuda12' -and $name -notmatch '^lib/ollama/cuda_v12/[A-Za-z0-9._+-]+\.dll$') -or
        $name -match '\.(gguf|safetensors|ckpt|onnx|pth|pt|bin)$') {
      throw 'Qwen runner inventory contains an invalid or duplicate entry.'
    }
    $seen[$key] = $true
    if ($entry.group -eq 'cuda12' -and $Profile -ne 'cuda12') { continue }
    $file = Get-QwenRunnerFile -Root $Root -Relative $name
    if ($file.Length -ne [long]$entry.bytes -or (Get-QwenRunnerFileHash $file.FullName) -ne $entry.sha256) {
      throw "Qwen runner inventory file failed verification: $name"
    }
    $selected += $entry
  }
  if (-not $seen.ContainsKey('lib/ollama/llama-server.exe')) { throw 'Qwen runner executable is missing from inventory.' }
  if ($Profile -eq 'cuda12' -and -not @($selected | Where-Object { $_.group -eq 'cuda12' }).Count) {
    throw 'Qwen runner CUDA inventory is missing.'
  }
  return [pscustomobject]@{Profile=$Profile;Files=$selected;RedistributionApproved=$false;GpuExecutionApproved=$false}
}

function Test-QwenRunnerCpuNotices {
  param([Parameter(Mandatory=$true)][string] $NoticesRoot)
  $notices = @{
    'OLLAMA-MIT.txt'='5934ed2ce0d15154bcdb9c85203210abac0da4314af34081e36df4599f90b226'
    'LLVM-18.1.8-LICENSE.txt'='8d85c1057d742e597985c7d4e6320b015a9139385cff4cbae06ffc0ebe89afee'
    'WINPTHREADS-COPYING.txt'='63263614cdd29f2f93cba85e992f041b31f9fc7b4033692f31269489a8a1b177'
    'LLVM-MINGW-LICENSE.txt'='8e5db0129069005be2a07be3297e198888fd72fad62a13a611504660c6b7e3c7'
  }
  foreach ($name in $notices.Keys) {
    $item = Get-QwenRunnerFile -Root $NoticesRoot -Relative $name
    if ((Get-QwenRunnerFileHash $item.FullName) -ne $notices[$name]) { throw "Qwen notice failed verification: $name" }
  }
  return $notices
}

# Produce only an isolated CPU candidate. This helper never changes an
# installed runtime or enables the managed-runner gate. The caller must pass
# the repository-pinned inventory digest, not a downloaded manifest digest.
function Copy-QwenRunnerCpuCandidate {
  param(
    [Parameter(Mandatory=$true)][string] $Root,
    [Parameter(Mandatory=$true)][string] $InventoryPath,
    [Parameter(Mandatory=$true)][string] $TrustedInventorySHA256,
    [Parameter(Mandatory=$true)][string] $NoticesRoot,
    [Parameter(Mandatory=$true)][string] $Destination
  )
  if (Test-Path -LiteralPath $Destination) { throw 'Qwen CPU candidate destination already exists.' }
  $layout = Test-QwenRunnerOfficialInventory -Root $Root -InventoryPath $InventoryPath `
    -TrustedInventorySHA256 $TrustedInventorySHA256 -Profile cpu
  $notices = Test-QwenRunnerCpuNotices -NoticesRoot $NoticesRoot
  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  foreach ($entry in $layout.Files) {
    $source = Get-QwenRunnerFile -Root $Root -Relative $entry.path
    $target = Join-Path $Destination $entry.path
    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
    Copy-Item -LiteralPath $source.FullName -Destination $target
    if ((Get-QwenRunnerFileHash $target) -ne $entry.sha256) { throw "Qwen CPU copied file failed verification: $($entry.path)" }
  }
  $noticeDestination = Join-Path $Destination 'third-party-notices'
  New-Item -ItemType Directory -Path $noticeDestination -Force | Out-Null
  foreach ($name in $notices.Keys) {
    $source = Get-QwenRunnerFile -Root $NoticesRoot -Relative $name
    $target = Join-Path $noticeDestination $name
    Copy-Item -LiteralPath $source.FullName -Destination $target
    if ((Get-QwenRunnerFileHash $target) -ne $notices[$name]) { throw "Qwen copied notice failed verification: $name" }
  }
  Copy-Item -LiteralPath $InventoryPath -Destination (Join-Path $Destination 'QWEN-RUNNER-INVENTORY.json')
  if ((Get-QwenRunnerFileHash (Join-Path $Destination 'QWEN-RUNNER-INVENTORY.json')) -ne $TrustedInventorySHA256) {
    throw 'Qwen copied CPU inventory failed verification.'
  }
  return [pscustomobject]@{Files=$layout.Files.Count;Profile='cpu';RedistributionApproved=$false;GpuExecutionApproved=$false}
}

function Get-QwenRunnerLayout {
  param(
    [Parameter(Mandatory=$true)][string] $Root,
    [Parameter(Mandatory=$true)][string] $ManifestPath,
    [Parameter(Mandatory=$true)][string] $TrustedManifestSHA256,
    [Parameter(Mandatory=$true)][string] $ExpectedExeSHA256
  )
  if ($TrustedManifestSHA256 -notmatch '^[a-f0-9]{64}$' -or $ExpectedExeSHA256 -notmatch '^[a-f0-9]{64}$') {
    throw 'Qwen runner distribution manifest has not been reviewed and pinned.'
  }
  if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf) -or
      (Get-QwenRunnerFileHash $ManifestPath) -ne $TrustedManifestSHA256) {
    throw 'Qwen runner pinned manifest is missing or does not match.'
  }
  $manifest = Get-Content -Raw -LiteralPath $ManifestPath | ConvertFrom-Json
  if ($manifest.schema -ne 'nf.qwen-runner.bundle.v1' -or $manifest.component -ne 'ollama-v0.40.13' -or
      $manifest.target -ne 'windows-x86_64' -or $manifest.includesModels -ne $false -or
      $manifest.sourceURL -notmatch '^https://' -or -not $manifest.notices -or -not $manifest.files) {
    throw 'Qwen runner manifest metadata or licensing evidence is incomplete.'
  }
  $seen = @{}
  foreach ($entry in @($manifest.files)) {
    $name = [string]$entry.path
    if ($seen.ContainsKey($name.ToLowerInvariant()) -or $entry.sha256 -notmatch '^[a-f0-9]{64}$' -or
        $null -eq $entry.bytes -or [long]$entry.bytes -le 0 -or
        $name -notmatch '^(ollama\.exe|lib/ollama/[A-Za-z0-9._+/-]+|notices/[A-Za-z0-9._+/-]+)$' -or
        $name -match '\.(gguf|safetensors|ckpt|onnx|pth|pt|bin)$') {
      throw 'Qwen runner manifest has a duplicate, unpinned or forbidden entry.'
    }
    $seen[$name.ToLowerInvariant()] = $entry
    $file = Get-QwenRunnerFile -Root $Root -Relative $name
    if ($file.Length -ne [long]$entry.bytes -or (Get-QwenRunnerFileHash $file.FullName) -ne $entry.sha256) {
      throw "Qwen runner file failed verification: $name"
    }
  }
  $exe = $seen['lib/ollama/llama-server.exe']
  if (-not $exe -or $exe.sha256 -ne $ExpectedExeSHA256) { throw 'Qwen runner executable identity mismatch.' }
  $rootDlls = @('libllama.dll','libllama-server-impl.dll','libllama-common.dll','libmtmd.dll',
    'ggml.dll','ggml-base.dll','libc++.dll','libomp.dll','libunwind.dll','libwinpthread-1.dll',
    'ggml-cpu-alderlake.dll','ggml-cpu-cannonlake.dll','ggml-cpu-cascadelake.dll',
    'ggml-cpu-cooperlake.dll','ggml-cpu-haswell.dll','ggml-cpu-icelake.dll','ggml-cpu-ivybridge.dll',
    'ggml-cpu-piledriver.dll','ggml-cpu-sandybridge.dll','ggml-cpu-sapphirerapids.dll',
    'ggml-cpu-skylakex.dll','ggml-cpu-sse42.dll','ggml-cpu-x64.dll','ggml-cpu-zen4.dll',
    'LLAMA_CPP_LICENSE','CPP_HTTPLIB_LICENSE','LLAMA_CPP_VENDORS_LICENSE','GO_LICENSE')
  $cudaDlls = @('concrt140.dll','cublas64_12.dll','cublasLt64_12.dll','cudart64_12.dll','ggml-cuda.dll',
    'msvcp140_1.dll','msvcp140_2.dll','msvcp140_atomic_wait.dll','msvcp140_codecvt_ids.dll',
    'msvcp140.dll','vccorlib140.dll','vcruntime140_1.dll','vcruntime140_threads.dll','vcruntime140.dll')
  $requiredFiles = @($rootDlls | ForEach-Object { 'lib/ollama/' + $_ }) + @($cudaDlls | ForEach-Object { 'lib/ollama/cuda_v12/' + $_ })
  foreach ($required in $requiredFiles) {
    if (-not $seen.ContainsKey($required)) { throw "Qwen runner required CPU/CUDA component is missing: $required" }
  }
  $noticeComponents = @{}
  foreach ($notice in @($manifest.notices)) {
    if (-not $notice.component -or $notice.sourceURL -notmatch '^https://' -or
        -not $notice.path -or -not $seen.ContainsKey(([string]$notice.path).ToLowerInvariant())) {
      throw 'Qwen runner licensing evidence is incomplete.'
    }
    $noticeComponents[([string]$notice.component).ToLowerInvariant()] = $true
  }
  foreach ($component in @('llama.cpp', 'cpp-httplib', 'llama.cpp-vendors', 'go', 'nvidia-cuda-12', 'microsoft-vc-runtime')) {
    if (-not $noticeComponents.ContainsKey($component)) { throw "Qwen runner licensing evidence is missing for: $component" }
  }
  return [pscustomobject]@{Root=[IO.Path]::GetFullPath($Root);Files=@($manifest.files);ManifestPath=$ManifestPath;ManifestSHA256=$TrustedManifestSHA256}
}

function Copy-QwenRunnerComponent {
  param([Parameter(Mandatory=$true)] $Layout, [Parameter(Mandatory=$true)][string] $Destination)
  if (Test-Path -LiteralPath $Destination) { throw 'Qwen runner destination already exists.' }
  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  foreach ($entry in $Layout.Files) {
    $source = Get-QwenRunnerFile -Root $Layout.Root -Relative $entry.path
    $target = Join-Path $Destination $entry.path
    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
    Copy-Item -LiteralPath $source.FullName -Destination $target
    if ((Get-QwenRunnerFileHash $target) -ne $entry.sha256) { throw "Qwen runner copied file failed verification: $($entry.path)" }
  }
  Copy-Item -LiteralPath $Layout.ManifestPath -Destination (Join-Path $Destination 'QWEN-RUNNER-MANIFEST.json')
  if ((Get-QwenRunnerFileHash (Join-Path $Destination 'QWEN-RUNNER-MANIFEST.json')) -ne $Layout.ManifestSHA256) {
    throw 'Qwen runner copied manifest failed verification.'
  }
}
