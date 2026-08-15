import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')

const files = {
  launcher: path.join(__dirname, 'packaged-tools-smoke-launcher.mjs'),
  app: path.join(__dirname, 'packaged-tools-smoke-app.cjs'),
  preload: path.join(__dirname, 'tools-smoke-preload.cjs'),
  bridge: path.join(__dirname, 'tools-smoke-bridge.cjs')
}

const read = (file) => fs.readFileSync(file, 'utf8')

function includes(source, literal) {
  return source.includes(literal)
}

function assertLiteral(checks, fileKey, literal, description) {
  const source = checks.sources[fileKey]
  checks.results.push({
    ok: includes(source, literal),
    file: path.relative(repoRoot, files[fileKey]).replace(/\\/g, '/'),
    description,
    literal
  })
}

function assertRegexAbsent(checks, fileKey, pattern, description) {
  const source = checks.sources[fileKey]
  checks.results.push({
    ok: !pattern.test(source),
    file: path.relative(repoRoot, files[fileKey]).replace(/\\/g, '/'),
    description,
    pattern: String(pattern)
  })
}

function main() {
  const missing = Object.entries(files).filter(([, file]) => !fs.existsSync(file))
  if (missing.length) {
    console.error(JSON.stringify({
      ok: false,
      code: 'SMOKE_CONTRACT_FILES_MISSING',
      missing: missing.map(([key, file]) => ({ key, file: path.relative(repoRoot, file).replace(/\\/g, '/') }))
    }, null, 2))
    process.exit(1)
  }

  const checks = {
    sources: Object.fromEntries(Object.entries(files).map(([key, file]) => [key, read(file)])),
    results: []
  }

  assertLiteral(checks, 'launcher', "NOVAFLOW_TOOLS_SMOKE: '1'", 'launcher forces smoke mode')
  assertLiteral(checks, 'launcher', "NOVAFLOW_DISABLE_LEGACY_WRITE: '1'", 'launcher disables legacy write path')
  assertLiteral(checks, 'launcher', "debug-output', 'temp-tools-bridge-test-2026-05-16", 'launcher defaults to temp whitelist root')
  assertLiteral(checks, 'launcher', "node_modules', 'electron'", 'launcher uses external Electron binary instead of packaged app exe')

  assertLiteral(checks, 'preload', 'contextBridge.exposeInMainWorld("novaflowToolsBridge"', 'preload exposes namespaced tools bridge')
  assertLiteral(checks, 'preload', 'writeBinaryFile: (payload) => invoke("tools:legacy-write-blocked", payload)', 'legacy writeBinaryFile is visible but smoke-blocked')
  assertLiteral(checks, 'preload', 'pickDirectory: () => invoke("tools:pick-directory-blocked")', 'pickDirectory is smoke-blocked')
  assertLiteral(checks, 'preload', 'legacyWritePolicy: "block"', 'preload advertises legacy write block policy')
  assertLiteral(checks, 'preload', 'pickDirectoryPolicy: "block"', 'preload advertises pickDirectory block policy')
  assertRegexAbsent(checks, 'preload', /ipcRenderer\.invoke\(["'`](write-binary-file|pick-directory)["'`]/, 'preload does not invoke production write/pick IPC channels')

  assertLiteral(checks, 'app', 'ipcMain.handle("tools:legacy-write-blocked"', 'app handles blocked legacy write telemetry')
  assertLiteral(checks, 'app', 'ipcMain.handle("tools:pick-directory-blocked"', 'app handles blocked pickDirectory telemetry')
  assertLiteral(checks, 'app', 'ipcMain.handle("tools:temp-export"', 'app exposes temp-export tools IPC')
  assertLiteral(checks, 'app', 'ipcMain.handle("tools:get-capabilities"', 'app exposes capabilities tools IPC')
  assertLiteral(checks, 'app', 'app.setPath("userData", smokeProfile)', 'app isolates smoke userData')
  assertLiteral(checks, 'app', 'writeBinaryFileCallable: false', 'capabilities report legacy write as not callable')
  assertLiteral(checks, 'app', 'overwriteAllowed: false', 'capabilities report overwrite disabled')
  assertLiteral(checks, 'app', 'userFileWriteAllowed: false', 'capabilities report user file writes disabled')
  assertLiteral(checks, 'app', 'rendererDirectoryPolicy: "renderer_provided_forbidden"', 'capabilities forbid renderer-provided output dirs')
  assertRegexAbsent(checks, 'app', /ipcMain\.handle\(["'`](write-binary-file|pick-directory)["'`]/, 'app does not register production write/pick IPC channels')

  assertLiteral(checks, 'bridge', 'const FORBIDDEN_RENDERER_FIELDS = ["dir", "absolutePath", "targetPath", "overwriteTarget", "sourcePathAsOutput"]', 'bridge blocks renderer-controlled output fields')
  assertLiteral(checks, 'bridge', 'TEMP_ROOT_RELATIVE = path.join("debug-output", "temp-tools-bridge-test-2026-05-16")', 'bridge defaults to temp whitelist root')
  assertLiteral(checks, 'bridge', 'OVERWRITE_BLOCKED', 'bridge blocks overwrite')
  assertLiteral(checks, 'bridge', 'RENDERER_DIR_FORBIDDEN', 'bridge blocks renderer output directory')
  assertLiteral(checks, 'bridge', 'request.tool !== "png_compress"', 'bridge only allows PNG compress tool')
  assertLiteral(checks, 'bridge', 'compression !== "lossless"', 'bridge only allows lossless compression')
  assertLiteral(checks, 'bridge', '.tmp', 'bridge uses atomic .tmp path')
  assertLiteral(checks, 'bridge', 'HASH_MISMATCH', 'bridge validates written hash')

  const failures = checks.results.filter((result) => !result.ok)
  const output = {
    ok: failures.length === 0,
    code: failures.length === 0 ? 'TOOLS_SMOKE_CONTRACT_OK' : 'TOOLS_SMOKE_CONTRACT_FAILED',
    checkedFiles: Object.fromEntries(Object.entries(files).map(([key, file]) => [key, path.relative(repoRoot, file).replace(/\\/g, '/')])),
    totalChecks: checks.results.length,
    failures,
    policy: {
      phase5OverwriteExecutionAllowed: false,
      productionLegacyWriteAllowed: false,
      rendererProvidedOutputDirectoryAllowed: false,
      userFileWriteAllowed: false,
      tempWhitelistRoot: 'debug-output/temp-tools-bridge-test-2026-05-16/**'
    }
  }

  console.log(JSON.stringify(output, null, 2))
  process.exit(output.ok ? 0 : 1)
}

main()
