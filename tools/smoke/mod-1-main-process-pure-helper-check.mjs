import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')
const rel = (file) => path.relative(repoRoot, file).replace(/\\/g, '/')
const read = (file) => fs.readFileSync(file, 'utf8')

const allowedStatusPaths = [
  'particle-editor-desktop/main.js',
  'particle-editor-desktop/main/buffer-helpers.js',
  'particle-editor-desktop/main/compression-helpers.js',
  'particle-editor-desktop/main/path-helpers.js',
  'particle-editor-desktop/main/url-helpers.js',
  'tools/smoke/mod-1-main-process-pure-helper-check.mjs',
  'logs/mod-1-main-process-pure-helper-extraction-2026-05-19.md'
]

const forbiddenPaths = [
  'particle-editor/spine-split-runtime.js',
  'particle-editor/novaflow-brand-runtime.js',
  'particle-editor/aifx-repaint-runtime.js',
  'particle-editor/index.html',
  'particle-editor-desktop/preload.js',
  'particle-editor-desktop/renderer/index.html',
  'particle-editor-desktop/renderer/spine-split-runtime.js',
  'particle-editor-desktop/renderer/novaflow-brand-runtime.js',
  'particle-editor-desktop/renderer/aifx-repaint-runtime.js',
  'particle-editor-desktop/dist/win-unpacked/resources/app/renderer/index.html',
  'particle-editor-desktop/dist/win-unpacked/resources/app/renderer/spine-split-runtime.js',
  'particle-editor-desktop/dist/win-unpacked/resources/app/renderer/novaflow-brand-runtime.js',
  'particle-editor-desktop/dist/win-unpacked/resources/app/renderer/aifx-repaint-runtime.js'
]

const expectedRuntimeRefs = [
  'ui-render-trace.js',
  'runtime-fetch-proxy.js',
  'proxy-electron-api.js',
  'runtime-detect-stabilizer.js',
  'spine-official-runtime.js',
  'ai-background-removal-runtime.js',
  'aifx-repaint-runtime.js',
  'spine-split-runtime.js',
  'novaflow-brand-runtime.js',
  'ribbon-event-markers.js',
  'assets/index-g5_V6IX0.css',
  'assets/index-Bqc1waVn.js'
]

function runGit(args) {
  return spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', windowsHide: true })
}

function assert(checks, ok, code, details = {}) {
  checks.push({ ok: !!ok, code, ...details })
}

function extractStatusPath(line) {
  const raw = String(line || '').slice(3).trim()
  if (!raw) return ''
  const renameArrow = raw.lastIndexOf(' -> ')
  return (renameArrow >= 0 ? raw.slice(renameArrow + 4) : raw).replace(/\\/g, '/').replace(/^"|"$/g, '')
}

function extractElectronApiKeys(source) {
  const marker = 'contextBridge.exposeInMainWorld("electronAPI",'
  const markerAt = source.indexOf(marker)
  if (markerAt < 0) return []
  const openAt = source.indexOf('{', markerAt)
  if (openAt < 0) return []
  let depth = 0
  let current = ''
  const lines = []
  for (let i = openAt; i < source.length; i += 1) {
    const ch = source[i]
    current += ch
    if (ch === '{') depth += 1
    if (ch === '}') depth -= 1
    if (ch === '\n') {
      lines.push(current)
      current = ''
    }
    if (depth === 0) {
      if (current) lines.push(current)
      break
    }
  }
  return lines
    .map((line) => (/^\s*([A-Za-z_$][\w$]*)\s*:/.exec(line) || [])[1])
    .filter(Boolean)
}

async function main() {
  const checks = []

  const status = runGit(['status', '--short', '--untracked-files=all'])
  assert(checks, status.status === 0, 'GIT_STATUS_READABLE', { stderr: status.stderr.trim() })
  const statusPaths = String(status.stdout || '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(extractStatusPath)
    .filter(Boolean)
  const disallowedStatusPaths = statusPaths.filter((p) => !allowedStatusPaths.includes(p))
  assert(checks, disallowedStatusPaths.length === 0, 'MOD1_ONLY_ALLOWED_PATHS_CHANGED', { statusPaths, disallowedStatusPaths })

  for (const forbiddenPath of forbiddenPaths) {
    const diff = runGit(['diff', '--quiet', '--', forbiddenPath])
    const stagedDiff = runGit(['diff', '--cached', '--quiet', '--', forbiddenPath])
    assert(checks, diff.status === 0 && stagedDiff.status === 0, 'MOD1_FORBIDDEN_FILE_UNCHANGED', { path: forbiddenPath })
  }

  const preloadPath = path.join(repoRoot, 'particle-editor-desktop', 'preload.js')
  const preloadCurrent = read(preloadPath)
  const preloadHead = runGit(['show', 'HEAD:particle-editor-desktop/preload.js'])
  assert(checks, preloadHead.status === 0, 'MOD1_PRELOAD_HEAD_READABLE', { stderr: preloadHead.stderr.trim() })
  const currentApiKeys = extractElectronApiKeys(preloadCurrent)
  const headApiKeys = extractElectronApiKeys(preloadHead.stdout || '')
  assert(
    checks,
    JSON.stringify(currentApiKeys) === JSON.stringify(headApiKeys),
    'MOD1_PRELOAD_API_NAMES_UNCHANGED',
    { currentApiKeys, headApiKeys }
  )

  const runtimeEntry = path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'index.html')
  const runtimeEntrySource = read(runtimeEntry)
  const missingRuntimeRefs = expectedRuntimeRefs.filter((ref) => !runtimeEntrySource.includes(ref))
  assert(checks, missingRuntimeRefs.length === 0, 'MOD1_RUNTIME_CHAIN_REFS_PRESENT', { missingRuntimeRefs })

  const pathHelpers = require(path.join(repoRoot, 'particle-editor-desktop', 'main', 'path-helpers.js'))
  const bufferHelpers = require(path.join(repoRoot, 'particle-editor-desktop', 'main', 'buffer-helpers.js'))
  const urlHelpers = require(path.join(repoRoot, 'particle-editor-desktop', 'main', 'url-helpers.js'))
  const { createPngCompressor } = require(path.join(repoRoot, 'particle-editor-desktop', 'main', 'compression-helpers.js'))

  assert(checks, pathHelpers.sanitizeFileName('bad:name?.png ') === 'bad_name_.png', 'MOD1_SANITIZE_FILE_NAME_EQUIVALENT')
  assert(checks, pathHelpers.sanitizeFileStem('bad:name?.png', 'fallback') === 'bad_name_', 'MOD1_SANITIZE_FILE_STEM_EQUIVALENT')
  assert(checks, pathHelpers.ensurePngFileName('bad:name?.jpg', 'part') === 'bad_name_.png', 'MOD1_ENSURE_PNG_FILE_NAME_EQUIVALENT')
  assert(checks, pathHelpers.guessMimeFromPath('x.webm') === 'video/webm', 'MOD1_GUESS_MIME_EQUIVALENT')
  assert(
    checks,
    pathHelpers.isPathInside(path.join(repoRoot, 'a', 'b'), path.join(repoRoot, 'a')) === true
      && pathHelpers.isPathInside(path.join(repoRoot, 'a'), path.join(repoRoot, 'a')) === false,
    'MOD1_PATH_INSIDE_EQUIVALENT'
  )

  const textData = bufferHelpers.dataUrlToBuffer('data:text/plain;base64,SGk=')
  assert(checks, Buffer.isBuffer(textData) && textData.toString('utf8') === 'Hi', 'MOD1_DATA_URL_TO_BUFFER_EQUIVALENT')
  assert(checks, bufferHelpers.dataUrlToBuffer('data:text/plain;base64,SGk=', { requirePng: true }) === null, 'MOD1_DATA_URL_PNG_REQUIREMENT_EQUIVALENT')
  assert(checks, Buffer.isBuffer(bufferHelpers.safeBufferFromBytes([1, 2, 3])), 'MOD1_SAFE_BUFFER_FROM_BYTES_EQUIVALENT')
  assert(checks, bufferHelpers.clampNumber(99, 0, 9, 5) === 9 && bufferHelpers.clampManifestNumber('x', 0, 9, 5) === 5, 'MOD1_CLAMP_EQUIVALENT')

  assert(checks, urlHelpers.isHttpUrl('https://example.com/a') === true && urlHelpers.isHttpUrl('file:///x') === false, 'MOD1_HTTP_URL_EQUIVALENT')
  assert(checks, urlHelpers.sanitizeRuntimeBaseUrl('http://127.0.0.1:8188/foo?q=1') === 'http://127.0.0.1:8188', 'MOD1_RUNTIME_BASE_URL_EQUIVALENT')
  assert(checks, urlHelpers.isAllowedAppUrl('file:///tmp/x', new Set()) === true, 'MOD1_ALLOWED_APP_URL_EQUIVALENT')

  const fakeFs = {
    existsSync: () => false,
    readFileSync: () => Buffer.alloc(0)
  }
  const sharpCalls = []
  const fakeSharp = (input, options) => ({
    png(pngOptions) {
      sharpCalls.push({ input: Array.from(input), options, pngOptions })
      return {
        async toBuffer() {
          return { data: Buffer.from([7, 8, 9]), info: { width: 4, height: 5 } }
        }
      }
    }
  })
  const compress = createPngCompressor({ fs: fakeFs, sharp: fakeSharp })
  const compressed = await compress({ bytes: [1, 2, 3], compressionLevel: 99, effort: 0, quality: 500, colors: 999 }, { palette: true })
  assert(
    checks,
    compressed.ok === true
      && compressed.width === 4
      && compressed.height === 5
      && compressed.size === 3
      && sharpCalls[0]?.pngOptions?.compressionLevel === 9
      && sharpCalls[0]?.pngOptions?.effort === 1
      && sharpCalls[0]?.pngOptions?.quality === 100
      && sharpCalls[0]?.pngOptions?.colours === 256,
    'MOD1_COMPRESSION_WRAPPER_EQUIVALENT',
    { compressed, sharpCalls }
  )

  const mainSource = read(path.join(repoRoot, 'particle-editor-desktop', 'main.js'))
  assert(checks, mainSource.includes('ipcMain.handle("write-binary-file"'), 'MOD1_WRITE_BINARY_IPC_NAME_UNCHANGED')
  assert(checks, mainSource.includes('ipcMain.handle("compress-png-lossless"'), 'MOD1_COMPRESSION_IPC_NAME_UNCHANGED')
  assert(checks, mainSource.includes('ipcMain.handle("system-mouse-position"'), 'MOD1_MOUSE_IPC_NAME_UNCHANGED')

  const failures = checks.filter((check) => !check.ok)
  const output = {
    ok: failures.length === 0,
    code: failures.length === 0 ? 'MOD1_MAIN_PROCESS_PURE_HELPER_OK' : 'MOD1_MAIN_PROCESS_PURE_HELPER_FAILED',
    checkedFiles: {
      main: 'particle-editor-desktop/main.js',
      helpers: [
        'particle-editor-desktop/main/path-helpers.js',
        'particle-editor-desktop/main/buffer-helpers.js',
        'particle-editor-desktop/main/url-helpers.js',
        'particle-editor-desktop/main/compression-helpers.js'
      ],
      preload: 'particle-editor-desktop/preload.js',
      runtimeEntry: rel(runtimeEntry)
    },
    policy: {
      preloadApiNamesChanged: false,
      runtimeChainChanged: false,
      protectedIslandMutationAllowed: false,
      overwriteEnabled: false,
      productionMigrationAllowed: false
    },
    totalChecks: checks.length,
    failures
  }

  console.log(JSON.stringify(output, null, 2))
  process.exit(output.ok ? 0 : 1)
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    code: 'MOD1_MAIN_PROCESS_PURE_HELPER_EXCEPTION',
    error: String(error?.stack || error?.message || error)
  }, null, 2))
  process.exit(1)
})
