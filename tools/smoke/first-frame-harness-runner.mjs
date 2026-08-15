import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')

const args = new Map()
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index]
  if (!arg.startsWith('--')) continue
  const key = arg.slice(2)
  const value = process.argv[index + 1] && !process.argv[index + 1].startsWith('--') ? process.argv[++index] : '1'
  args.set(key, value)
}

const sessionId = args.get('session') || `g3-first-frame-${Date.now()}`
const tempRoot = path.resolve(repoRoot, args.get('temp-root') || path.join('debug-output', 'first-frame-harness-2026-05-17'))
const smokeProfile = path.resolve(tempRoot, 'smoke-profile', sessionId)
const packagedAppRoot = path.resolve(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app')
const rendererEntry = path.resolve(args.get('renderer') || path.join(packagedAppRoot, 'renderer', 'index.html'))
const zeroShiftSeed = args.get('zero-shift-seed') === '1'
const electronCmd = process.platform === 'win32'
  ? path.resolve(repoRoot, 'particle-editor-desktop', 'node_modules', 'electron', 'dist', 'electron.exe')
  : path.resolve(repoRoot, 'particle-editor-desktop', 'node_modules', '.bin', 'electron')
const harnessApp = path.join(__dirname, 'first-frame-harness-app.cjs')

for (const [name, file] of Object.entries({ electronCmd, rendererEntry, harnessApp })) {
  if (!existsSync(file)) {
    console.error(`${name} not found: ${file}`)
    process.exit(1)
  }
}

mkdirSync(smokeProfile, { recursive: true })

const child = spawn(electronCmd, [harnessApp], {
  cwd: repoRoot,
  windowsHide: true,
  env: {
    ...process.env,
    NOVAFLOW_FIRST_FRAME_HARNESS: '1',
    NOVAFLOW_TOOLS_SMOKE: '1',
    NOVAFLOW_DISABLE_LEGACY_WRITE: '1',
    NOVAFLOW_SMOKE_REPO_ROOT: repoRoot,
    NOVAFLOW_FIRST_FRAME_TEMP_ROOT: tempRoot,
    NOVAFLOW_FIRST_FRAME_PROFILE: smokeProfile,
    NOVAFLOW_FIRST_FRAME_RENDERER_ENTRY: rendererEntry,
    NOVAFLOW_FIRST_FRAME_SESSION: sessionId,
    NOVAFLOW_PACKAGED_APP_ROOT: packagedAppRoot,
    NOVAFLOW_FIRST_FRAME_ZERO_SHIFT_SEED: zeroShiftSeed ? '1' : '0'
  },
  stdio: ['ignore', 'pipe', 'pipe']
})

let stdout = ''
let stderr = ''
child.stdout.on('data', (chunk) => {
  const text = String(chunk || '')
  stdout += text
  process.stdout.write(text)
})
child.stderr.on('data', (chunk) => {
  const text = String(chunk || '')
  stderr += text
  process.stderr.write(text)
})

const timeoutMs = Number(args.get('timeout-ms') || 90000)
const timeout = setTimeout(() => {
  try { child.kill() } catch {}
}, timeoutMs)

child.on('close', (code) => {
  clearTimeout(timeout)
  const match = stdout.match(/__NOVAFLOW_G3_FIRST_FRAME_RESULT__(.*)__END_NOVAFLOW_G3_FIRST_FRAME_RESULT__/s)
  if (!match) {
    console.error(JSON.stringify({
      ok: false,
      code: 'FIRST_FRAME_HARNESS_RESULT_MISSING',
      exitCode: code,
      stderr: stderr.slice(-4000)
    }, null, 2))
    process.exit(code || 1)
    return
  }

  let result
  try {
    result = JSON.parse(match[1])
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      code: 'FIRST_FRAME_HARNESS_RESULT_PARSE_FAILED',
      error: error instanceof Error ? error.message : String(error)
    }, null, 2))
    process.exit(1)
    return
  }

  console.log(JSON.stringify({
    ok: !!result.ok,
    code: result.ok ? 'FIRST_FRAME_HARNESS_COMPLETED' : 'FIRST_FRAME_HARNESS_FAILED',
    sessionId,
    sampleCount: result.trace && Array.isArray(result.trace.samples) ? result.trace.samples.length : 0,
    receiptCount: Array.isArray(result.measurementReceipts) ? result.measurementReceipts.length : 0,
    consoleErrorCount: result.consoleErrorCount,
    runtimeChainStable: result.runtimeChainStable
  }, null, 2))

  process.exit(result.ok ? 0 : 1)
})
