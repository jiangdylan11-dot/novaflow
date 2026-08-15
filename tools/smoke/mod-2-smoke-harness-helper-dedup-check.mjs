import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import {
  assert,
  createSmokePaths,
  parseJsonOutput,
  runNode,
  toRepoRelative
} from './lib/smoke-core.mjs'
import { hashRuntimeChain } from './lib/runtime-chain.mjs'

const { repoRoot } = createSmokePaths(import.meta.url)
const read = (file) => fs.readFileSync(file, 'utf8')
const rel = (file) => toRepoRelative(repoRoot, file)

const updatedCheckers = [
  'tools/smoke/g13d-final-isolated-expansion-review-check.mjs',
  'tools/smoke/g16-final-migration-readiness-review-check.mjs'
]

const allowedStatusPaths = [
  ...updatedCheckers,
  'tools/smoke/lib/smoke-core.mjs',
  'tools/smoke/lib/runtime-chain.mjs',
  'tools/smoke/mod-2-smoke-harness-helper-dedup-check.mjs',
  'logs/debug.log',
  'logs/mod-2-smoke-harness-helper-dedup-2026-05-19.md'
]

const expectedPassMarkers = {
  'tools/smoke/g13d-final-isolated-expansion-review-check.mjs': 'G13D_FINAL_ISOLATED_EXPANSION_REVIEW_OK',
  'tools/smoke/g16-final-migration-readiness-review-check.mjs': 'G16_FINAL_MIGRATION_READINESS_REVIEW_OK'
}

const protectedExactPaths = [
  'particle-editor/spine-split-runtime.js',
  'particle-editor/novaflow-brand-runtime.js',
  'particle-editor/aifx-repaint-runtime.js',
  'particle-editor/index.html',
  'particle-editor-desktop/main.js',
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

const protectedPrefixes = [
  'particle-editor/',
  'particle-editor-desktop/renderer/',
  'particle-editor-desktop/dist/',
  'particle-editor-desktop/main/'
]

function runGit(args) {
  return spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', windowsHide: true })
}

function extractStatusPath(line) {
  const raw = String(line || '').slice(3).trim()
  if (!raw) return ''
  const renameArrow = raw.lastIndexOf(' -> ')
  return (renameArrow >= 0 ? raw.slice(renameArrow + 4) : raw).replace(/\\/g, '/').replace(/^"|"$/g, '')
}

function headSource(file) {
  const result = runGit(['show', `HEAD:${file}`])
  assert(result.status === 0, 'MOD2_HEAD_SOURCE_READABLE', { file, stderr: result.stderr.trim() })
  return result.stdout || ''
}

function countRawAssertCalls(source) {
  return String(source)
    .split(/\r?\n/)
    .filter((line) => /\bassert\s*\(/.test(line) && !/\bfunction\s+assert\s*\(/.test(line))
    .length
}

function countNamedAssertions(source) {
  const matches = String(source).match(/\bassert\s*\([^,\n]+,\s*['"][A-Z0-9_]+['"]/g)
  return matches ? matches.length : 0
}

function checkerSummary(file) {
  const before = headSource(file)
  const after = read(path.join(repoRoot, file))
  const passMarker = expectedPassMarkers[file]
  assert(before.includes(passMarker), 'MOD2_BASELINE_PASS_MARKER_MISSING', { file, passMarker })
  assert(after.includes(passMarker), 'MOD2_PASS_MARKER_PRESERVED', { file, passMarker })

  const rawBefore = countRawAssertCalls(before)
  const rawAfter = countRawAssertCalls(after)
  const namedBefore = countNamedAssertions(before)
  const namedAfter = countNamedAssertions(after)
  assert(namedAfter >= namedBefore, 'MOD2_NAMED_ASSERTIONS_NOT_REDUCED', {
    file,
    namedBefore,
    namedAfter
  })

  return {
    file,
    passMarker,
    passMarkerPreserved: true,
    rawAssertCallSitesBefore: rawBefore,
    rawAssertCallSitesAfter: rawAfter,
    rawAssertCallSitesReduced: rawAfter < rawBefore,
    namedPolicyAssertionsBefore: namedBefore,
    namedPolicyAssertionsAfter: namedAfter,
    namedPolicyAssertionsReduced: namedAfter < namedBefore,
    assertionChangeExplanation: rawAfter < rawBefore
      ? 'Only duplicated subprocess/runtime-chain helper guards moved into tools/smoke/lib; named checker policy assertions stayed unchanged.'
      : 'No assertion count reduction.'
  }
}

try {
  const status = runGit(['status', '--short', '--untracked-files=all'])
  assert(status.status === 0, 'MOD2_GIT_STATUS_READABLE', { stderr: status.stderr.trim() })
  const statusPaths = String(status.stdout || '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(extractStatusPath)
    .filter(Boolean)
  const disallowedStatusPaths = statusPaths.filter((p) => !allowedStatusPaths.includes(p))
  assert(disallowedStatusPaths.length === 0, 'MOD2_ONLY_ALLOWED_PATHS_CHANGED', {
    statusPaths,
    disallowedStatusPaths
  })

  const existingCheckerUpdates = statusPaths
    .filter((p) => /^tools\/smoke\/.*\.mjs$/.test(p))
    .filter((p) => !p.startsWith('tools/smoke/lib/'))
    .filter((p) => p !== 'tools/smoke/mod-2-smoke-harness-helper-dedup-check.mjs')
  const unexpectedCheckerUpdates = existingCheckerUpdates.filter((p) => !updatedCheckers.includes(p))
  assert(existingCheckerUpdates.length <= 3, 'MOD2_EXISTING_CHECKER_UPDATE_CAP', { existingCheckerUpdates })
  assert(unexpectedCheckerUpdates.length === 0, 'MOD2_ONLY_LOW_RISK_CHECKERS_UPDATED', { unexpectedCheckerUpdates })

  const protectedStatusPaths = statusPaths.filter((p) => (
    protectedExactPaths.includes(p)
    || protectedPrefixes.some((prefix) => p.startsWith(prefix))
  ))
  assert(protectedStatusPaths.length === 0, 'MOD2_PROTECTED_PATHS_UNCHANGED', { protectedStatusPaths })

  for (const forbiddenPath of protectedExactPaths) {
    const worktreeDiff = runGit(['diff', '--quiet', '--', forbiddenPath])
    const stagedDiff = runGit(['diff', '--cached', '--quiet', '--', forbiddenPath])
    assert(worktreeDiff.status === 0 && stagedDiff.status === 0, 'MOD2_FORBIDDEN_FILE_UNCHANGED', { path: forbiddenPath })
  }

  const helperCorePath = path.join(repoRoot, 'tools', 'smoke', 'lib', 'smoke-core.mjs')
  const helperRuntimePath = path.join(repoRoot, 'tools', 'smoke', 'lib', 'runtime-chain.mjs')
  const helperCore = read(helperCorePath)
  const helperRuntime = read(helperRuntimePath)
  assert(helperCore.includes('export function assert'), 'MOD2_ASSERT_HELPER_EXPORTED')
  assert(helperCore.includes('assert(run.status === 0'), 'MOD2_SUBPROCESS_STATUS_ASSERT_MOVED_TO_HELPER')
  assert(helperCore.includes('export function parseJsonOutput'), 'MOD2_JSON_HELPER_EXPORTED')
  assert(helperCore.includes('export function createCheckerRunner'), 'MOD2_CHECKER_RUNNER_EXPORTED')
  assert(helperRuntime.includes('export function hashRuntimeChain'), 'MOD2_RUNTIME_CHAIN_HELPER_EXPORTED')

  const parsed = parseJsonOutput('noise before json\n{"ok":true,"code":"MOD2_PARSE_OK"}')
  assert(parsed.ok === true && parsed.code === 'MOD2_PARSE_OK', 'MOD2_PARSE_JSON_HELPER_BEHAVIOR', parsed)

  let thrown = null
  try {
    assert(false, 'MOD2_ASSERT_THROW_CHECK', { expected: true })
  } catch (error) {
    thrown = error
  }
  assert(thrown?.code === 'MOD2_ASSERT_THROW_CHECK' && thrown?.details?.expected === true, 'MOD2_ASSERT_HELPER_BEHAVIOR', {
    code: thrown?.code,
    details: thrown?.details
  })

  const runNodeOutput = runNode(repoRoot, ['-e', 'console.log(JSON.stringify({ ok: true, code: "MOD2_RUN_NODE_OK" }))'], 'MOD2_RUN_NODE_FAILED')
  const runNodeParsed = parseJsonOutput(runNodeOutput)
  assert(runNodeParsed.ok === true && runNodeParsed.code === 'MOD2_RUN_NODE_OK', 'MOD2_RUN_NODE_HELPER_BEHAVIOR', runNodeParsed)

  const runtimeEntry = path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'index.html')
  const runtimeChain = hashRuntimeChain(repoRoot, runtimeEntry)
  assert(runtimeChain.length >= 2, 'MOD2_RUNTIME_CHAIN_HASH_NONEMPTY', { runtimeChain })
  assert(runtimeChain.every((item) => /^[A-F0-9]{64}$/.test(item.sha256)), 'MOD2_RUNTIME_CHAIN_HASH_FORMAT', { runtimeChain })
  assert(runtimeChain.some((item) => item.path.endsWith('/renderer/index.html')), 'MOD2_RUNTIME_CHAIN_ENTRY_INCLUDED', { runtimeChain })

  const checkerSummaries = updatedCheckers.map(checkerSummary)
  const reportPath = path.join(repoRoot, 'logs', 'mod-2-smoke-harness-helper-dedup-2026-05-19.md')
  assert(fs.existsSync(reportPath), 'MOD2_REPORT_EXISTS', { reportPath: rel(reportPath) })
  const report = read(reportPath)
  for (const checker of updatedCheckers) {
    assert(report.includes(checker), 'MOD2_REPORT_LISTS_UPDATED_CHECKER', { checker })
  }
  assert(report.includes('assertion'), 'MOD2_REPORT_DESCRIBES_ASSERTIONS')

  console.log(JSON.stringify({
    ok: true,
    code: 'MOD2_SMOKE_HARNESS_HELPER_DEDUP_OK',
    updatedCheckers: checkerSummaries,
    helperFiles: [
      'tools/smoke/lib/smoke-core.mjs',
      'tools/smoke/lib/runtime-chain.mjs'
    ],
    checkedFiles: {
      report: rel(reportPath),
      runtimeEntry: rel(runtimeEntry)
    },
    policy: {
      existingCheckerUpdateCap: 3,
      actualExistingCheckerUpdates: existingCheckerUpdates.length,
      protectedIslandMutationAllowed: false,
      runtimeChainChanged: false,
      productionMigrationAllowed: false,
      shellCutoverAllowed: false,
      assertionWeakeningAllowed: false
    },
    totalChecks: 27,
    failures: []
  }, null, 2))
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    code: error.code || 'MOD2_SMOKE_HARNESS_HELPER_DEDUP_FAILED',
    message: error.message,
    details: error.details || {}
  }, null, 2))
  process.exit(1)
}
