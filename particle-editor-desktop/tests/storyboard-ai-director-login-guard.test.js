const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const sourcePath = path.resolve(__dirname, '../../particle-editor/spine-split-runtime.js')
const source = fs.readFileSync(sourcePath, 'utf8')

const dialogStart = source.indexOf('function showStoryboardPromptDialog()')
const dialogEnd = source.indexOf('\n  function normalizeStoryboardStoryDirection', dialogStart)
assert.ok(dialogStart >= 0 && dialogEnd > dialogStart, 'storyboard prompt dialog should be extractable')

const dialogSource = source.slice(dialogStart, dialogEnd)
assert.match(
  dialogSource,
  /window\.NovaFlowClientAuth[\s\S]*?window\.NovaFlowClientAuth\.state\(\)/,
  'AI director submission should read the authoritative client account state'
)
assert.match(
  dialogSource,
  /if \(grokEnabled && !\(clientAuthState && clientAuthState\.loggedIn\)\) \{[\s\S]*?return\s*\}/,
  'AI director submission should stop before closing the dialog when the account is logged out'
)
assert.match(
  dialogSource,
  /AI导演需要登录 NovaFlow 账号，请先前往账号区域登录后再生成/,
  'the logged-out guard should give the user a direct login instruction'
)
assert.match(
  dialogSource,
  /directorProvider:\s*grokEnabled \? 'grok' : 'local'/,
  'the existing AI director and local director routing should remain intact'
)

console.log('storyboard AI director login guard tests passed')
