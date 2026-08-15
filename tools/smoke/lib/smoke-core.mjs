import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function createSmokePaths(importMetaUrl) {
  const filename = fileURLToPath(importMetaUrl)
  const dirname = path.dirname(filename)
  return {
    filename,
    dirname,
    repoRoot: path.resolve(dirname, '..', '..')
  }
}

export function toRepoRelative(repoRoot, file) {
  return path.relative(repoRoot, file).replace(/\\/g, '/')
}

export function smokeError(code, details = {}) {
  const error = new Error(code)
  error.code = code
  error.details = details
  return error
}

export function assert(condition, code, details = {}) {
  if (!condition) {
    throw smokeError(code, details)
  }
}

export function parseJsonOutput(stdout) {
  const trimmed = String(stdout || '').trim()
  const start = trimmed.lastIndexOf('\n{')
  const jsonText = start >= 0 ? trimmed.slice(start + 1) : trimmed
  return JSON.parse(jsonText)
}

export function runNode(repoRoot, args, code, options = {}) {
  const run = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: options.maxBuffer || 1024 * 1024 * 64
  })
  if (run.status !== 0) {
    if (run.stdout) process.stdout.write(run.stdout)
    if (run.stderr) process.stderr.write(run.stderr)
  }
  assert(run.status === 0, code, {
    status: run.status,
    stdout: run.stdout,
    stderr: run.stderr,
    args
  })
  return run.stdout || ''
}

export function createCheckerRunner(repoRoot, options = {}) {
  return function runChecker(script, code) {
    const stdout = runNode(repoRoot, [path.join('tools', 'smoke', script)], code, options)
    return parseJsonOutput(stdout)
  }
}
