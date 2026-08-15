const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { after, test } = require('node:test')

const root = path.resolve(__dirname, '..', '..')
const patcherPath = path.join(root, 'tools', 'ai-runtime', 'apply-runtime-int8-tensorwise-patch.ps1')
const patchRoot = path.join(root, 'tools', 'ai-runtime', 'patches', 'comfy-int8-tensorwise-v1')
const manifestPath = path.join(patchRoot, 'manifest.json')
const payloadPath = path.join(patchRoot, 'comfy-int8-tensorwise-v1.patch')
const fixtureRuntimeRoot = path.join(root, 'particle-editor-desktop', 'tests', 'fixtures', 'ai-runtime-int8-tensorwise-base')
const packageScriptPath = path.join(root, 'tools', 'ai-runtime', 'build-ai-runtime-package.ps1')
const installerScriptPath = path.join(root, 'tools', 'ai-runtime', 'build-ai-runtime-installer.ps1')
const temporaryRoots = []

after(() => {
  temporaryRoots.forEach((temporaryRoot) => {
    const resolved = path.resolve(temporaryRoot)
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir())))
    fs.rmSync(resolved, { recursive: true, force: true })
  })
})

function createFixtureRuntime() {
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'novaflow-int8-patch-'))
  temporaryRoots.push(destination)
  const files = [
    'engine/ComfyUI/comfy/ops.py',
    'engine/ComfyUI/comfy/quant_ops.py',
    'engine/ComfyUI/requirements.txt',
  ]
  files.forEach((relativePath) => {
    const source = path.join(fixtureRuntimeRoot, relativePath)
    const target = path.join(destination, relativePath)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(source, target)
  })
  return destination
}

function runPatcher(runtimeRoot) {
  return spawnSync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', patcherPath,
    '-RuntimeRoot', runtimeRoot,
    '-PythonExecutable', 'python',
    '-SkipDependencyInstall',
  ], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  })
}

function output(result) {
  return `${result.stdout || ''}\n${result.stderr || ''}`
}

test('INT8 TensorWise patch pins the approved upstream payload and hashes', () => {
  assert.equal(fs.existsSync(patcherPath), true)
  assert.equal(fs.existsSync(manifestPath), true)
  assert.equal(fs.existsSync(payloadPath), true)
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  assert.equal(manifest.patchId, 'comfy-int8-tensorwise-v1')
  assert.equal(manifest.upstreamCommit, '1a510f04234e5a213d3985a1a54f65652623f4bc')
  assert.deepEqual(manifest.dependency, {
    name: 'comfy-kitchen',
    baseVersion: '0.2.10',
    patchedVersion: '0.2.11',
  })
  assert.equal(manifest.files.length, 3)
  manifest.files.forEach((entry) => {
    assert.match(entry.baseSha256, /^[A-F0-9]{64}$/)
    assert.match(entry.patchedSha256, /^[A-F0-9]{64}$/)
  })
  const payload = fs.readFileSync(payloadPath, 'utf8')
  assert.match(payload, /int8_tensorwise/)
  assert.match(payload, /TensorWiseINT8Layout/)
  assert.match(payload, /convrot_groupsize/)
  assert.match(payload, /comfy-kitchen==0\.2\.11/)
  const patcherSource = fs.readFileSync(patcherPath, 'utf8')
  assert.match(patcherSource, /\$verifyCode\s*\|\s*&\s*\$python\s+-/)
})

test('known staged Runtime applies once, verifies exact hashes, and remains idempotent', () => {
  const runtimeRoot = createFixtureRuntime()
  const first = runPatcher(runtimeRoot)
  assert.equal(first.status, 0, output(first))
  const evidencePath = path.join(runtimeRoot, 'novaflow-runtime-int8-tensorwise-v1.json')
  assert.equal(fs.existsSync(evidencePath), true)
  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'))
  assert.equal(evidence.patchId, 'comfy-int8-tensorwise-v1')
  assert.equal(evidence.dependency.installed, false)
  assert.equal(fs.readFileSync(path.join(runtimeRoot, 'engine/ComfyUI/comfy/quant_ops.py'), 'utf8').includes('int8_tensorwise'), true)
  assert.equal(fs.readFileSync(path.join(runtimeRoot, 'engine/ComfyUI/requirements.txt'), 'utf8').includes('comfy-kitchen==0.2.11'), true)

  const second = runPatcher(runtimeRoot)
  assert.equal(second.status, 0, output(second))
})

test('unknown drift and the installed ProgramData Runtime fail closed', () => {
  const runtimeRoot = createFixtureRuntime()
  const target = path.join(runtimeRoot, 'engine/ComfyUI/comfy/ops.py')
  fs.appendFileSync(target, '\n# drift\n', 'utf8')
  const drifted = runPatcher(runtimeRoot)
  assert.notEqual(drifted.status, 0)
  assert.match(output(drifted), /unknown base hash/i)

  if (fs.existsSync('C:\\ProgramData\\NovaFlow\\AI-Runtime')) {
    const live = runPatcher('C:\\ProgramData\\NovaFlow\\AI-Runtime')
    assert.notEqual(live.status, 0)
    assert.match(output(live), /refusing.*installed.*ProgramData/i)
  }
})

test('both Runtime builders apply the INT8 patch and publish version 0.2.5', () => {
  const packageSource = fs.readFileSync(packageScriptPath, 'utf8')
  const installerSource = fs.readFileSync(installerScriptPath, 'utf8')
  for (const source of [packageSource, installerSource]) {
    assert.match(source, /apply-runtime-int8-tensorwise-patch\.ps1/)
    assert.match(source, /\[string\]\s+\$Version\s*=\s*"0\.2\.5"/)
  }
  const pythonExcludes = packageSource.match(/\$pythonExcludeDirs\s*=\s*@\(([\s\S]*?)\r?\n\)/)?.[1] || ''
  assert.match(pythonExcludes, /Join-Path\s+\$SourcePythonRoot\s+"caches"/)
  assert.doesNotMatch(pythonExcludes, /^\s*"caches",?\s*$/m)
})
