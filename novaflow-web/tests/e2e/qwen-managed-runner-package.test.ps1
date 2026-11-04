$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../../../tools/ai-runtime/qwen-runner-component.ps1')
$root = Join-Path ([IO.Path]::GetTempPath()) ('foart-qwen-package-' + [guid]::NewGuid().ToString('N'))
$source = Join-Path $root 'source'
$dest = Join-Path $root 'destination'
$manifestPath = Join-Path $root 'manifest.json'
$script:checks = 0
function Check($condition, [string] $name) {
  if (-not $condition) { throw "FAIL: $name" }
  $script:checks++
  Write-Host "PASS: $name"
}
function Fails([scriptblock] $block) { try { & $block | Out-Null; return $false } catch { return $true } }
try {
  New-Item -ItemType Directory -Path $source -Force | Out-Null
  $rootNames = @('llama-server.exe','libllama.dll','libllama-server-impl.dll','libllama-common.dll','libmtmd.dll',
    'ggml.dll','ggml-base.dll','libc++.dll','libomp.dll','libunwind.dll','libwinpthread-1.dll',
    'ggml-cpu-alderlake.dll','ggml-cpu-cannonlake.dll','ggml-cpu-cascadelake.dll','ggml-cpu-cooperlake.dll',
    'ggml-cpu-haswell.dll','ggml-cpu-icelake.dll','ggml-cpu-ivybridge.dll','ggml-cpu-piledriver.dll',
    'ggml-cpu-sandybridge.dll','ggml-cpu-sapphirerapids.dll','ggml-cpu-skylakex.dll','ggml-cpu-sse42.dll',
    'ggml-cpu-x64.dll','ggml-cpu-zen4.dll','LLAMA_CPP_LICENSE','CPP_HTTPLIB_LICENSE','LLAMA_CPP_VENDORS_LICENSE','GO_LICENSE')
  $cudaNames = @('concrt140.dll','cublas64_12.dll','cublasLt64_12.dll','cudart64_12.dll','ggml-cuda.dll',
    'msvcp140_1.dll','msvcp140_2.dll','msvcp140_atomic_wait.dll','msvcp140_codecvt_ids.dll','msvcp140.dll',
    'vccorlib140.dll','vcruntime140_1.dll','vcruntime140_threads.dll','vcruntime140.dll')
  $names = @($rootNames | ForEach-Object { 'lib/ollama/' + $_ }) + @($cudaNames | ForEach-Object { 'lib/ollama/cuda_v12/' + $_ }) + @('notices/CUDA.txt','notices/MSVC.txt')
  $files = @()
  foreach ($name in $names) {
    $path = Join-Path $source $name
    New-Item -ItemType Directory -Path (Split-Path -Parent $path) -Force | Out-Null
    [IO.File]::WriteAllText($path, "fixture $name")
    $files += @{path=$name;bytes=(Get-Item -LiteralPath $path).Length;sha256=(Get-QwenRunnerFileHash $path)}
  }
  $notices = @(
    @{component='llama.cpp';path='lib/ollama/LLAMA_CPP_LICENSE';sourceURL='https://example.invalid/fixture'},
    @{component='cpp-httplib';path='lib/ollama/CPP_HTTPLIB_LICENSE';sourceURL='https://example.invalid/fixture'},
    @{component='llama.cpp-vendors';path='lib/ollama/LLAMA_CPP_VENDORS_LICENSE';sourceURL='https://example.invalid/fixture'},
    @{component='go';path='lib/ollama/GO_LICENSE';sourceURL='https://example.invalid/fixture'},
    @{component='nvidia-cuda-12';path='notices/CUDA.txt';sourceURL='https://example.invalid/fixture'},
    @{component='microsoft-vc-runtime';path='notices/MSVC.txt';sourceURL='https://example.invalid/fixture'}
  )
  $manifest = @{schema='nf.qwen-runner.bundle.v1';component='ollama-v0.40.13';target='windows-x86_64';includesModels=$false;
    sourceURL='https://example.invalid/fixture';files=$files;notices=$notices}
  function Write-FixtureManifest { $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding UTF8 }
  function Layout { Get-QwenRunnerLayout -Root $source -ManifestPath $manifestPath -TrustedManifestSHA256 (Get-QwenRunnerFileHash $manifestPath) -ExpectedExeSHA256 $files[0].sha256 }
  Write-FixtureManifest
  Check (Fails { Get-QwenRunnerLayout -Root $source -ManifestPath $manifestPath -TrustedManifestSHA256 'bad' -ExpectedExeSHA256 $files[0].sha256 }) 'unreviewed manifest disabled'
  Check (Fails { Get-QwenRunnerLayout -Root $source -ManifestPath $manifestPath -TrustedManifestSHA256 ('0' * 64) -ExpectedExeSHA256 $files[0].sha256 }) 'wrong manifest digest rejected'
  [IO.File]::WriteAllText((Join-Path $source 'lib/ollama/unlisted-model.gguf'), 'fixture model')
  $layout = Layout
  Copy-QwenRunnerComponent -Layout $layout -Destination $dest
  Check (Test-Path -LiteralPath (Join-Path $dest 'lib/ollama/cuda_v12/ggml-cuda.dll') -PathType Leaf) 'CUDA directory preserved'
  Check (Test-Path -LiteralPath (Join-Path $dest 'QWEN-RUNNER-MANIFEST.json') -PathType Leaf) 'manifest retained'
  Check (-not (Test-Path -LiteralPath (Join-Path $dest 'lib/ollama/unlisted-model.gguf'))) 'unlisted model is not packaged'
  Check (Fails { Copy-QwenRunnerComponent -Layout $layout -Destination $dest }) 'existing destination not overwritten'
  [IO.File]::WriteAllText((Join-Path $source 'lib/ollama/libllama.dll'), 'tampered')
  Check (Fails { Layout }) 'changed dependency rejected'
  [IO.File]::WriteAllText((Join-Path $source 'lib/ollama/libllama.dll'), 'fixture lib/ollama/libllama.dll')
  $manifest.notices = @($notices | Where-Object { $_.component -ne 'nvidia-cuda-12' }); Write-FixtureManifest
  Check (Fails { Layout }) 'missing CUDA licence evidence rejected'
  $manifest.notices = $notices
  $manifest.files = @($files | Where-Object { $_.path -ne 'lib/ollama/cuda_v12/cublas64_12.dll' }); Write-FixtureManifest
  Check (Fails { Layout }) 'incomplete CUDA component rejected'
  $manifest.files = $files
  $manifest.files += @{path='lib/ollama/unlisted-model.gguf';bytes=13;sha256=('0' * 64)}; Write-FixtureManifest
  Check (Fails { Layout }) 'model entry rejected even when listed'
  $manifest.files = $files
  $manifest.files += @{path='lib/ollama/../escape.dll';bytes=1;sha256=('0' * 64)}; Write-FixtureManifest
  Check (Fails { Layout }) 'path traversal rejected'
  Write-Host "$script:checks checks passed"
} finally {
  if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
}
