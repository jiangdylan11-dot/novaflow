import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function toRepoPath(value) {
  return value.replaceAll(path.sep, '/')
}

function runGit(args) {
  try {
    return execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim()
  } catch (error) {
    return `ERROR: ${String(error?.message || error)}`
  }
}

function exists(relPath) {
  return fs.existsSync(path.join(repoRoot, relPath))
}

function readText(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8')
}

function lineCount(relPath) {
  const text = readText(relPath)
  if (!text) return 0
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const value = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized
  return value ? value.split('\n').length : 0
}

function printCheck(label, status, detail = '') {
  const suffix = detail ? ` - ${detail}` : ''
  console.log(`[${status}] ${label}${suffix}`)
}

const results = []

function pass(label, detail) {
  results.push('PASS')
  printCheck(label, 'PASS', detail)
}

function warning(label, detail) {
  results.push('WARNING')
  printCheck(label, 'WARNING', detail)
}

function fail(label, detail) {
  results.push('FAIL')
  printCheck(label, 'FAIL', detail)
}

console.log('NovaFlow Phase 0 read-only check')
console.log('')

const branch = runGit(['branch', '--show-current'])
const head = runGit(['log', '-1', '--format=%h %s'])
const status = runGit(['status', '--short'])

console.log(`Branch: ${branch || '(unknown)'}`)
console.log(`HEAD: ${head || '(unknown)'}`)
console.log(`Git status: ${status ? '\n' + status : 'clean'}`)
console.log('')

if (status) warning('working tree status', 'not clean; review before Phase 0 acceptance')
else pass('working tree status', 'clean')

const coreFiles = [
  'particle-editor/novaflow-brand-runtime.js',
  'particle-editor/spine-split-runtime.js',
  'particle-editor/aifx-repaint-runtime.js',
  'particle-editor-desktop/main.js',
  'particle-editor-desktop/prompt-assistant-service.py'
]

console.log('')
console.log('Core file line counts:')
for (const relPath of coreFiles) {
  if (!exists(relPath)) {
    fail(`core file exists: ${relPath}`, 'missing')
    continue
  }
  pass(`core file exists: ${relPath}`, `${lineCount(relPath).toLocaleString('en-US')} lines`)
}

const formalIndex = 'particle-editor-desktop/dist/win-unpacked/resources/app/renderer/index.html'
console.log('')
if (!exists(formalIndex)) {
  fail('formal renderer index', `${formalIndex} missing`)
} else {
  const html = readText(formalIndex)
  const requiredRuntimeScripts = [
    'aifx-repaint-runtime.js',
    'spine-split-runtime.js',
    'novaflow-brand-runtime.js'
  ]
  for (const script of requiredRuntimeScripts) {
    if (html.includes(script)) pass(`formal index loads ${script}`)
    else fail(`formal index loads ${script}`, 'not found')
  }
}

const mirroredRuntimeGroups = [
  {
    name: 'novaflow-brand-runtime.js',
    files: [
      'particle-editor/novaflow-brand-runtime.js',
      'particle-editor-desktop/renderer/novaflow-brand-runtime.js',
      'particle-editor-desktop/dist/win-unpacked/resources/app/renderer/novaflow-brand-runtime.js'
    ]
  },
  {
    name: 'spine-split-runtime.js',
    files: [
      'particle-editor/spine-split-runtime.js',
      'particle-editor-desktop/renderer/spine-split-runtime.js',
      'particle-editor-desktop/dist/win-unpacked/resources/app/renderer/spine-split-runtime.js'
    ]
  },
  {
    name: 'aifx-repaint-runtime.js',
    files: [
      'particle-editor/aifx-repaint-runtime.js',
      'particle-editor-desktop/renderer/aifx-repaint-runtime.js',
      'particle-editor-desktop/dist/win-unpacked/resources/app/renderer/aifx-repaint-runtime.js'
    ]
  }
]

console.log('')
console.log('Runtime mirror existence:')
for (const group of mirroredRuntimeGroups) {
  const missing = group.files.filter((relPath) => !exists(relPath))
  if (missing.length) fail(`${group.name} mirrors`, `missing ${missing.map(toRepoPath).join(', ')}`)
  else pass(`${group.name} mirrors`, 'source, renderer, and win-unpacked exist')
}

const requiredDocs = [
  'docs/NOVAFLOW_RUNTIME_SINGLE_SOURCE.md',
  'docs/NOVAFLOW_REFACTOR_BASELINE_PHASE0.md',
  'docs/NOVAFLOW_PHASE0_MANUAL_ACCEPTANCE.md'
]

console.log('')
console.log('Required documents:')
for (const relPath of requiredDocs) {
  if (exists(relPath)) pass(`document exists: ${relPath}`)
  else fail(`document exists: ${relPath}`, 'missing')
}

console.log('')
const hasFail = results.includes('FAIL')
const hasWarning = results.includes('WARNING')
const overall = hasFail ? 'FAIL' : hasWarning ? 'WARNING' : 'PASS'
console.log(`Overall: ${overall}`)

if (hasFail) process.exitCode = 1
