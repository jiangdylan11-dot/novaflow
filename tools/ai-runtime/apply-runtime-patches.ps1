[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string] $RuntimeRoot,
  [string] $PythonExecutable
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Convert-ToFullPath {
  param([Parameter(Mandatory=$true)][string] $Path)
  return [System.IO.Path]::GetFullPath($Path)
}

function Assert-UnderPath {
  param(
    [Parameter(Mandatory=$true)][string] $Child,
    [Parameter(Mandatory=$true)][string] $Parent
  )
  $childFull = Convert-ToFullPath $Child
  $parentFull = Convert-ToFullPath $Parent
  if (-not $parentFull.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
    $parentFull += [System.IO.Path]::DirectorySeparatorChar
  }
  if (-not $childFull.StartsWith($parentFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Patch target escapes RuntimeRoot. Target: $childFull RuntimeRoot: $parentFull"
  }
}

function Get-FileSha256 {
  param([Parameter(Mandatory=$true)][string] $Path)
  return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToUpperInvariant()
}

function Get-ContentSha256 {
  param([Parameter(Mandatory=$true)][string] $Content)
  $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($Content)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    return ([System.BitConverter]::ToString($sha.ComputeHash($bytes))).Replace("-", "")
  } finally {
    $sha.Dispose()
  }
}

function Get-ExactOccurrenceCount {
  param(
    [Parameter(Mandatory=$true)][string] $Content,
    [Parameter(Mandatory=$true)][string] $Value
  )
  if (-not $Value) { throw "Patch anchor must not be empty." }
  $count = 0
  $offset = 0
  while ($offset -lt $Content.Length) {
    $index = $Content.IndexOf($Value, $offset, [System.StringComparison]::Ordinal)
    if ($index -lt 0) { break }
    $count += 1
    $offset = $index + $Value.Length
  }
  return $count
}

function Get-PatchedContent {
  param(
    [Parameter(Mandatory=$true)] $Definition,
    [Parameter(Mandatory=$true)][string] $Content
  )
  $newline = if ($Content.Contains("`r`n")) { "`r`n" } else { "`n" }
  switch ([string]$Definition.kind) {
    "gpt-image-2-pricing" {
      $replacement = @(
        '    usage = getattr(response, "usage", None)',
        '    details = getattr(usage, "input_tokens_details", None)',
        '    input_tokens = getattr(usage, "input_tokens", None)',
        '    output_tokens = getattr(usage, "output_tokens", None)',
        '    image_tokens = getattr(details, "image_tokens", None)',
        '    text_tokens = getattr(details, "text_tokens", None)',
        '    values = (input_tokens, output_tokens, image_tokens, text_tokens)',
        '    if any(value is None or isinstance(value, bool) or not isinstance(value, (int, float)) for value in values):',
        '        return None',
        '    if any(value < 0 for value in values):',
        '        return None',
        '    if image_tokens + text_tokens != input_tokens:',
        '        return None',
        '    return ((image_tokens * 8.0) + (text_tokens * 5.0) + (output_tokens * 30.0)) / 1_000_000.0'
      ) -join $newline
      return $Content.Replace([string]$Definition.anchors[0], $replacement)
    }
    "exact-credit-marker" {
      $withDecimalImport = @(
        'import contextlib',
        'from decimal import Decimal, ROUND_HALF_UP'
      ) -join $newline
      $withExactMarker = @(
        '            display_lines.append(f"Price: {p} credits")',
        '        exact_credits = (Decimal(str(price)) * Decimal("211")).quantize(',
        '            Decimal("0.01"),',
        '            rounding=ROUND_HALF_UP,',
        '        )',
        '        if exact_credits != Decimal("0"):',
        '            display_lines.append(f"NovaFlow-Price-Exact: {exact_credits:.6f} credits")'
      ) -join $newline
      $patched = $Content.Replace([string]$Definition.anchors[0], $withDecimalImport)
      return $patched.Replace([string]$Definition.anchors[1], $withExactMarker)
    }
    default {
      throw "Unsupported Runtime patch kind: $($Definition.kind)"
    }
  }
}

function Resolve-PythonExecutable {
  param(
    [string] $Requested,
    [Parameter(Mandatory=$true)][string] $Root
  )
  if ($Requested) {
    if (Test-Path -LiteralPath $Requested -PathType Leaf) {
      return Convert-ToFullPath $Requested
    }
    $command = Get-Command $Requested -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) { return $command.Source }
    throw "Python executable was not found: $Requested"
  }
  $bundled = Join-Path $Root "engine\python\python.exe"
  if (Test-Path -LiteralPath $bundled -PathType Leaf) { return $bundled }
  $fallback = Get-Command python -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($fallback) { return $fallback.Source }
  throw "Python executable was not found in the Runtime or PATH."
}

$RuntimeRoot = Convert-ToFullPath $RuntimeRoot
if (-not (Test-Path -LiteralPath $RuntimeRoot -PathType Container)) {
  throw "RuntimeRoot is missing or is not a directory: $RuntimeRoot"
}

$liveRuntimeRoot = Convert-ToFullPath "C:\ProgramData\NovaFlow\AI-Runtime"
$liveRuntimePrefix = $liveRuntimeRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (
  $RuntimeRoot.Equals($liveRuntimeRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
  $RuntimeRoot.StartsWith($liveRuntimePrefix, [System.StringComparison]::OrdinalIgnoreCase)
) {
  throw "Refusing to patch the installed ProgramData Runtime. Patch a staged destination copy instead: $RuntimeRoot"
}

$patchDefinitionPath = Join-Path $PSScriptRoot "patches\comfy-partner-price-v1\manifest.json"
if (-not (Test-Path -LiteralPath $patchDefinitionPath -PathType Leaf)) {
  throw "Runtime patch definition is missing: $patchDefinitionPath"
}
$patchDefinition = Get-Content -Raw -Encoding UTF8 -LiteralPath $patchDefinitionPath | ConvertFrom-Json
if ([string]$patchDefinition.patchId -ne "comfy-partner-price-v1") {
  throw "Unexpected Runtime patch id: $($patchDefinition.patchId)"
}
if (-not $patchDefinition.files -or @($patchDefinition.files).Count -ne 2) {
  throw "Runtime patch definition must register exactly two files."
}

$states = @()
foreach ($definition in @($patchDefinition.files)) {
  $relativePath = ([string]$definition.path).Replace('/', [System.IO.Path]::DirectorySeparatorChar)
  $targetPath = Join-Path $RuntimeRoot $relativePath
  Assert-UnderPath -Child $targetPath -Parent $RuntimeRoot
  if (-not (Test-Path -LiteralPath $targetPath -PathType Leaf)) {
    throw "Required Runtime patch target is missing: $targetPath"
  }

  $content = [System.IO.File]::ReadAllText($targetPath)
  $currentHash = Get-FileSha256 $targetPath
  $patchedHash = ([string]$definition.patchedSha256).ToUpperInvariant()
  if ($currentHash -eq $patchedHash) {
    $states += [pscustomobject]@{
      Definition = $definition
      TargetPath = $targetPath
      OriginalContent = $content
      PatchedContent = $content
      NeedsWrite = $false
    }
    continue
  }

  foreach ($anchor in @($definition.anchors)) {
    $occurrences = Get-ExactOccurrenceCount -Content $content -Value ([string]$anchor)
    if ($occurrences -ne 1) {
      throw "Patch anchor must appear exactly once in $relativePath; found $occurrences."
    }
  }

  $allowedBaseHashes = @($definition.baseSha256 | ForEach-Object { ([string]$_).ToUpperInvariant() })
  if ($allowedBaseHashes -notcontains $currentHash) {
    throw "Unknown base hash for $relativePath. Found $currentHash"
  }

  $patchedContent = Get-PatchedContent -Definition $definition -Content $content
  if ($patchedContent -eq $content) {
    throw "Runtime patch produced no change for $relativePath"
  }
  $candidateHash = Get-ContentSha256 $patchedContent
  if ($candidateHash -ne $patchedHash) {
    throw "Patched hash mismatch for $relativePath. Expected $patchedHash, calculated $candidateHash"
  }
  $states += [pscustomobject]@{
    Definition = $definition
    TargetPath = $targetPath
    OriginalContent = $content
    PatchedContent = $patchedContent
    NeedsWrite = $true
  }
}

$python = Resolve-PythonExecutable -Requested $PythonExecutable -Root $RuntimeRoot
$stagingRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("novaflow-runtime-patch-" + [System.Guid]::NewGuid().ToString("N"))
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
try {
  New-Item -ItemType Directory -Force -Path $stagingRoot | Out-Null
  $stagedPaths = @()
  foreach ($state in $states) {
    $relativePath = ([string]$state.Definition.path).Replace('/', [System.IO.Path]::DirectorySeparatorChar)
    $stagedPath = Join-Path $stagingRoot $relativePath
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $stagedPath) | Out-Null
    [System.IO.File]::WriteAllText($stagedPath, [string]$state.PatchedContent, $utf8NoBom)
    $stagedPaths += $stagedPath
  }
  & $python -m py_compile @stagedPaths
  if ($LASTEXITCODE -ne 0) {
    throw "Patched Runtime Python failed py_compile with exit code $LASTEXITCODE"
  }
} finally {
  if (Test-Path -LiteralPath $stagingRoot) {
    Remove-Item -LiteralPath $stagingRoot -Recurse -Force
  }
}

$writtenStates = @()
try {
  foreach ($state in $states) {
    if (-not $state.NeedsWrite) { continue }
    [System.IO.File]::WriteAllText($state.TargetPath, [string]$state.PatchedContent, $utf8NoBom)
    $writtenStates += $state
  }
  foreach ($state in $states) {
    $actualHash = Get-FileSha256 $state.TargetPath
    $expectedHash = ([string]$state.Definition.patchedSha256).ToUpperInvariant()
    if ($actualHash -ne $expectedHash) {
      throw "Post-write hash mismatch for $($state.Definition.path). Expected $expectedHash, found $actualHash"
    }
  }
} catch {
  foreach ($state in $writtenStates) {
    [System.IO.File]::WriteAllText($state.TargetPath, [string]$state.OriginalContent, $utf8NoBom)
  }
  throw
}

$evidenceFiles = @($states | ForEach-Object {
  [ordered]@{
    path = [string]$_.Definition.path
    baseSha256 = [string]$_.Definition.baseSha256[0]
    patchedSha256 = [string]$_.Definition.patchedSha256
  }
})
$evidence = [ordered]@{
  schemaVersion = 1
  patches = @(
    [ordered]@{
      patchId = [string]$patchDefinition.patchId
      version = [int]$patchDefinition.version
      files = $evidenceFiles
    }
  )
}
$evidencePath = Join-Path $RuntimeRoot "novaflow-runtime-patches.json"
Assert-UnderPath -Child $evidencePath -Parent $RuntimeRoot
$evidenceJson = $evidence | ConvertTo-Json -Depth 8
[System.IO.File]::WriteAllText($evidencePath, $evidenceJson + [System.Environment]::NewLine, $utf8NoBom)

Write-Host "NovaFlow Runtime patch verified: $($patchDefinition.patchId)"
Write-Host "Runtime patch evidence: $evidencePath"
