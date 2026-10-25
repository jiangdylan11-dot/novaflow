$ErrorActionPreference = 'Stop'
$builder = Join-Path $PSScriptRoot '../../../tools/ai-runtime/build-ai-runtime-package.ps1'
$tokens = $null; $parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($builder, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw "Runtime builder has PowerShell syntax errors." }
# Load only pure validation/copy functions; never execute the real build, model,
# Python interpreter or service, and never touch an existing package output.
$names = @('Convert-ToFullPath', 'Assert-UnderPath', 'Invoke-RobocopyChecked', 'Get-StrataFileSHA256', 'Assert-StrataComponentFiles', 'Get-StrataRuntimeLayout', 'Get-StrataNoticeLayout', 'Copy-StrataRuntime')
foreach ($name in $names) {
  $fn = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
  if (-not $fn) { throw "Missing packaging function $name" }
  . ([scriptblock]::Create($fn.Extent.Text))
}
function Check($condition, $message) { if (-not $condition) { throw $message }; $script:checks += 1 }
function Rejects([scriptblock]$run, $pattern) {
  try { & $run | Out-Null } catch { Check ($_.Exception.Message -match $pattern) "Wrong rejection: $($_.Exception.Message)"; return }
  throw "Expected rejection matching $pattern"
}
function Put($root, $name, $text) {
  $file = Join-Path $root $name
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $file) | Out-Null
  [System.IO.File]::WriteAllText($file, $text)
}
$checks = 0
$fixture = Join-Path ([System.IO.Path]::GetTempPath()) ('nf-flash-package-' + [guid]::NewGuid().ToString('N'))
try {
  New-Item -ItemType Directory -Path $fixture | Out-Null
  $controlName = 'control-0.1.49.2'; $engineName = 'engine-0.1.48-windows-cuda13'
  $source = Join-Path $fixture 'source'; $destination = Join-Path $fixture 'portable/AI-Runtime/engine/strata'
  $control = Join-Path $source $controlName; $engine = Join-Path $source $engineName
  foreach ($name in @('python/python.exe','python/Lib/site-packages/psutil/__init__.py','serve/server.py','data/expert-profile.bin')) { Put $control $name 'cpu-fixture-control' }
  foreach ($name in @('python/LICENSE.txt','python/Lib/site-packages/requests.dist-info/licenses/LICENSE','python/Lib/site-packages/requests.dist-info/licenses/NOTICE')) { Put $control $name ('original-dependency-notice-' + $name) }
  foreach ($name in @('strata.exe','strata-vision.exe','strata_kq.dll','cublas64_13.dll','cublasLt64_13.dll')) { Put $engine $name ('cpu-fixture-' + $name) }
  Put $control 'models/unrelated.gguf' 'must-not-package'
  Put $control 'strata-pack-resident/experts.bin' 'must-not-package'
  Put $control 'tokenizer/vocab.json' 'must-not-package'
  Put $control 'mtp/rt/experts.bin' 'must-not-package'
  Put $control 'logs/native.log' 'must-not-package'
  Put $control 'server.json' 'machine-specific-paths-must-not-package'
  Put $control 'loose-weights.safetensors' 'must-not-package'
  Put $source 'old-version/private.txt' 'must-not-package'
  $engineFiles = @(Get-ChildItem -LiteralPath $engine -File | ForEach-Object { @{path=$_.Name;bytes=$_.Length;sha256=(Get-StrataFileSHA256 -Path $_.FullName)} })
  $layout = [pscustomobject]@{
    ControlName=$controlName; EngineName=$engineName; ControlSource=$control; EngineSource=$engine
    ControlFiles=@(@{path='python/python.exe'},@{path='python/Lib/site-packages/psutil/__init__.py'},@{path='serve/server.py'},@{path='data/expert-profile.bin'})
    EngineFiles=$engineFiles
    Manifests=@(@{path="$controlName/BUNDLE.json";sha256='fixture-manifest'})
  }
  # Only five small source notice files are copied; no real runtime binary.
  $noticeSource = Join-Path (Split-Path -Parent $builder) 'notices/strata'
  $noticeAttributes = Get-Content -Raw -LiteralPath (Join-Path $noticeSource '.gitattributes')
  Check ($noticeAttributes -match '(?m)^\* -text\s*$') 'Original notice bytes may be rewritten on checkout'
  Check ($noticeAttributes -match '(?m)^\*\.txt -diff\s*$' -and $noticeAttributes -match '(?m)^\*\.html -diff\s*$') 'Original vendor notices must use binary diff to preserve upstream whitespace'
  Check ($noticeAttributes -notmatch '(?m)^(\*|\*\.json|manifest\.json)\s+.*-diff') 'Notice manifest must remain available for text review'
  Check ($noticeAttributes -match '(?m)^manifest\.json whitespace=cr-at-eol\s*$') 'Pinned manifest CRLF must be accepted without rewriting its bytes'
  $originalNotices = Get-StrataNoticeLayout -Root $noticeSource
  $noticeFixture = Join-Path $fixture 'notices'
  New-Item -ItemType Directory -Path $noticeFixture | Out-Null
  foreach ($entry in $originalNotices.Files) {
    Copy-Item -LiteralPath (Join-Path $noticeSource $entry.path) -Destination (Join-Path $noticeFixture $entry.path)
  }
  $notices = Get-StrataNoticeLayout -Root $noticeFixture
  Copy-StrataRuntime -Layout $layout -Destination $destination -Notices $notices | Out-Null
  foreach ($name in @('strata.exe','strata-vision.exe','strata_kq.dll','cublas64_13.dll','cublasLt64_13.dll')) {
    Check ((Get-StrataFileSHA256 -Path (Join-Path $destination "$engineName/$name")) -eq (Get-StrataFileSHA256 -Path (Join-Path $engine $name))) "Lost engine dependency $name"
  }
  Check (Test-Path -LiteralPath (Join-Path $destination "$controlName/python/Lib/site-packages/psutil/__init__.py")) 'Lost bundled Python transitive dependency'
  Check (Test-Path -LiteralPath (Join-Path $destination "$controlName/data/expert-profile.bin")) 'Dropped required expert profile as model weights'
  foreach ($name in @('python/LICENSE.txt','python/Lib/site-packages/requests.dist-info/licenses/LICENSE','python/Lib/site-packages/requests.dist-info/licenses/NOTICE')) {
    Check ((Get-StrataFileSHA256 -Path (Join-Path $control $name)) -eq (Get-StrataFileSHA256 -Path (Join-Path $destination "$controlName/$name"))) "Changed original Python dependency notice $name"
  }
  foreach ($entry in $notices.Files) {
    Check ((Get-StrataFileSHA256 -Path (Join-Path $destination "third-party-notices/$($entry.path)")) -eq $entry.sha256) "Lost or changed component notice $($entry.path)"
  }
  Check (-not (Test-Path -LiteralPath (Join-Path $destination 'third-party-notices/.gitattributes'))) 'Copied repository metadata into runtime notices'
  foreach ($name in @('models','strata-pack-resident','tokenizer','mtp','logs','server.json','loose-weights.safetensors')) {
    Check (-not (Test-Path -LiteralPath (Join-Path $destination "$controlName/$name"))) "Packaged model cache or machine state: $name"
  }
  Check (-not (Test-Path -LiteralPath (Join-Path $destination 'old-version'))) 'Copied unrelated Strata versions'
  $receiptText = Get-Content -Raw -LiteralPath (Join-Path $destination 'STRATA-RUNTIME.json')
  $receipt = $receiptText | ConvertFrom-Json
  Check ($receipt.portable -and -not $receipt.includesModels -and -not $receipt.includesModelCaches) 'Wrong portable receipt scope'
  Check ($receipt.noticeManifest.path -eq 'third-party-notices/manifest.json' -and $receipt.noticeManifest.sha256 -eq $notices.ManifestSHA256) 'Receipt did not bind the original notice manifest'
  Check ($receipt.noticeFiles.Count -eq 5) 'Receipt omitted component notice hashes'
  Check (-not $receiptText.Contains($fixture) -and -not $receiptText.Contains('C:\')) 'Receipt contains absolute source/install paths'
  Rejects { Assert-StrataComponentFiles -Root $engine -Files @(@{path='strata.exe';bytes=1}) } 'byte length'
  Rejects { Assert-StrataComponentFiles -Root $engine -Files @(@{path='strata.exe';sha256=('0' * 64)}) } 'SHA256'
  Rejects { Assert-StrataComponentFiles -Root $engine -Files @(@{path='missing.dll'}) } 'incomplete'
  Rejects { Assert-StrataComponentFiles -Root $engine -Files @(@{path='../escaped.bin'}) } 'outside output root'
  Rejects { Get-StrataRuntimeLayout -SourceRoot (Join-Path $fixture 'missing-source') } 'incomplete'
  # Missing Strata must fail before the existing output/package deletion path.
  $sourceText = Get-Content -Raw -LiteralPath $builder
  Check ($sourceText.IndexOf('$strataLayout = Get-StrataRuntimeLayout') -lt $sourceText.IndexOf('Remove-Item -LiteralPath $packageRoot')) 'Validation occurs after package removal'
  Check ($sourceText.IndexOf('$strataNotices = Get-StrataNoticeLayout') -lt $sourceText.IndexOf('Remove-Item -LiteralPath $packageRoot')) 'Notice validation occurs after package removal'
  Check ($sourceText.Contains('Join-Path (Split-Path -Parent $SourceComfyRoot) "strata"')) 'Strata default is tied to a developer drive instead of sibling engine path'
  $missingNotice = 'STRATA-CONTROL-LICENSE.txt'
  Remove-Item -LiteralPath (Join-Path $noticeFixture $missingNotice)
  Rejects { Get-StrataNoticeLayout -Root $noticeFixture } 'incomplete'
  Copy-Item -LiteralPath (Join-Path $noticeSource $missingNotice) -Destination (Join-Path $noticeFixture $missingNotice)
  Put $noticeFixture $missingNotice 'altered-original-notice'
  Rejects { Get-StrataNoticeLayout -Root $noticeFixture } 'byte length|SHA256'
  Copy-Item -LiteralPath (Join-Path $noticeSource $missingNotice) -Destination (Join-Path $noticeFixture $missingNotice) -Force
  Put $noticeFixture 'manifest.json' '{}'
  Rejects { Get-StrataNoticeLayout -Root $noticeFixture } 'SHA256'
  @{ok=$true;checks=$checks;scope='CPU fake-directory package path, integrity and exclusions; no real build'} | ConvertTo-Json -Compress
} finally {
  if (Test-Path -LiteralPath $fixture) {
    Assert-UnderPath -Child $fixture -Parent ([System.IO.Path]::GetTempPath())
    Remove-Item -LiteralPath $fixture -Recurse -Force
  }
}
