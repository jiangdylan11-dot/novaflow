const assert = require('node:assert/strict')
const path = require('node:path')
const { spawn } = require('node:child_process')
const test = require('node:test')

test('art canvas owns native right-drag, retains zoom and draws at the panned image coordinates', { timeout: 90000 }, async () => {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(require('electron'), [path.join(__dirname, 'art-canvas-pan-ui.cjs')], {
    env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
  })
  let output = ''
  child.stdout.on('data', data => { output += data })
  child.stderr.on('data', data => { output += data })
  const timer = setTimeout(() => child.kill(), 80000)
  try {
    const code = await new Promise((resolve, reject) => {
      child.on('error', reject)
      child.on('exit', resolve)
    })
    assert.equal(code, 0, output)
    assert.match(output, /"ok":true/)
    console.log(output.trim())
  } finally {
    clearTimeout(timer)
    if (child.exitCode === null) child.kill()
  }
})
