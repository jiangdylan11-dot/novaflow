const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const source = fs.readFileSync(path.resolve(__dirname, '../preload.js'), 'utf8')

assert.match(
  source,
  /smartAiStoryboardUnifiedNineShots:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\("smart-ai-storyboard-unified-nine-shots",\s*\{[\s\S]*?token:\s*String\(clientAuthSessionToken\s*\|\|\s*""\)\.trim\(\)[\s\S]*?\}\)/,
  'preload should inject its in-memory client session token into AI director storyboard IPC'
)
assert.doesNotMatch(
  source,
  /smartAiStoryboardUnifiedNineShots:[^\n]*ipcRenderer\.invoke\("smart-ai-storyboard-unified-nine-shots",\s*payload\)/,
  'AI director storyboard IPC must not forward an unauthenticated payload unchanged'
)
assert.match(
  source,
  /smartAiImageReverse:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\("smart-ai-image-reverse",\s*\{[\s\S]*?token:\s*String\(clientAuthSessionToken\s*\|\|\s*payload\?\.token\s*\|\|\s*payload\?\.sessionToken\s*\|\|\s*payload\?\.accessToken\s*\|\|\s*""\)\.trim\(\)[\s\S]*?\}\)/,
  'preload should prefer its in-memory token and recover the current renderer session token after restart'
)
assert.doesNotMatch(
  source,
  /smartAiImageReverse:[^\n]*ipcRenderer\.invoke\("smart-ai-image-reverse",\s*payload\)/,
  'AI director Grok image reverse IPC must not forward an unauthenticated payload unchanged'
)

console.log('preload storyboard AI director auth tests passed')
