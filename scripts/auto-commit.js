#!/usr/bin/env node
'use strict'

const { spawnSync } = require('node:child_process')

function runGit(args, options = {}) {
  const result = spawnSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: options.stdio || 'pipe',
  })

  return {
    ok: result.status === 0,
    status: result.status,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
  }
}

function hasWorktreeChanges() {
  const result = runGit(['status', '--porcelain'])
  if (!result.ok) {
    throw new Error(result.stderr.trim() || 'Unable to inspect git status.')
  }
  return result.stdout.trim().length > 0
}

function hasStagedChanges() {
  const result = runGit(['diff', '--cached', '--quiet', '--exit-code'])
  if (result.status === 0) return false
  if (result.status === 1) return true
  throw new Error(result.stderr.trim() || 'Unable to inspect staged changes.')
}

function timestamp() {
  const date = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    ' ',
    pad(date.getHours()),
    ':',
    pad(date.getMinutes()),
    ':',
    pad(date.getSeconds()),
  ].join('')
}

function main() {
  try {
    if (!hasWorktreeChanges()) {
      console.log('auto-commit: no changes detected; skipping commit.')
      return 0
    }

    const add = runGit(['add', '-A'], { stdio: 'inherit' })
    if (!add.ok) {
      throw new Error('git add -A failed.')
    }

    if (!hasStagedChanges()) {
      console.log('auto-commit: no staged changes after git add; skipping commit.')
      return 0
    }

    const message = `auto-save: ${timestamp()}`
    const commit = runGit(['commit', '-m', message], { stdio: 'inherit' })
    if (!commit.ok) {
      throw new Error('git commit failed.')
    }

    console.log(`auto-commit: created "${message}"`)
    return 0
  } catch (error) {
    console.error(`auto-commit: ${error && error.message ? error.message : error}`)
    return 1
  }
}

process.exitCode = main()
