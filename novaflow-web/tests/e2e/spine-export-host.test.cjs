const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
require('../../renderer/spine-version-convert.js')
const V = globalThis.NovaFlowSpineVersion
const source = fs.readFileSync(process.env.NOVAFLOW_SPINE_HOST_SOURCE || path.resolve(__dirname, '../../renderer/spine-skeleton-editor.host.js'), 'utf8')
const begin = source.indexOf("  const PACK_KEY = 'nf-skel-export'")
const end = source.indexOf('  /** The Spine tab gets', begin)
const section = source.slice(begin, end)

function fixture(own = '3.8') {
  const project = { skeleton: { spine: '3.8.99' }, bones: [{ name: 'root' }], slots: [{ name: 'slot', bone: 'root', attachment: 'picture' }],
    skins: [{ name: 'default', attachments: { slot: { picture: { width: 16, height: 16 } } } }], animations: { animation: {} } }
  const initial = JSON.stringify(project), versions = [], bridges = []
  const root = { closest: () => root, getAttribute: () => 'skeleton', querySelector: s => s === '[data-nf-skeleton-pack]' ? {} : null, querySelectorAll: () => [button] }
  class Button {
    constructor() { this.textContent = '导出动画工程'; this.disabled = false; this.attrs = new Map([['data-novaflow-skeleton-spine-export', '1']]) }
    closest(s) { return s === '[data-nf-skeleton-pack]' ? null : root }
    getAttribute(k) { return this.attrs.get(k) ?? null }
    hasAttribute(k) { return this.attrs.has(k) }
    setAttribute(k, v) { this.attrs.set(k, v) }
    removeAttribute(k) { this.attrs.delete(k) }
  }
  const button = new Button(), cache = {}
  const api = { loaded: () => true, json: () => project, ownVersion: () => own,
    packForApp: async ({ version }) => { versions.push(version); return { source: { json: { text: JSON.stringify(V.fromSpine38(project, version)) }, atlas: {}, images: [] } } } }
  const ctx = vm.createContext({ console, api, ready: async () => api, HTMLButtonElement: Button,
    localStorage: { getItem: () => '{}' }, document: { querySelector: () => root },
    window: { NovaFlowSkeletonEditor: { active: () => true }, __NovaFlowSpineImportInlineBridgeCache: cache,
      __NovaFlowSpineImportInlineBridge: { start: async () => { const j = JSON.parse(cache.json.text); j.skins.map(s => s.name); bridges.push(j); return true } } },
  })
  vm.runInContext(section, ctx)
  return { ctx, api, project, initial, versions, bridges, button, root,
    select: v => vm.runInContext(`wantVersion='spine';setExportVersion(${JSON.stringify(v)})`, ctx),
    sync: () => vm.runInContext('syncApp()', ctx),
    isSpineRun: () => vm.runInContext('isSpineExportRun(document.querySelector().querySelectorAll()[0])', ctx),
    pending: () => vm.runInContext('syncPromise', ctx),
  }
}

for (const own of ['3.8', '4.2']) test(`${own} project: selecting 3.7 never feeds map skins to the live import bridge`, async () => {
  const f = fixture(own)
  f.select('3.7'); await f.sync()
  assert.deepEqual(f.versions, ['3.8'])
  assert(Array.isArray(f.bridges[0].skins))
  assert.equal(f.bridges[0].skeleton.spine, '3.8.99')
  assert.equal(JSON.stringify(f.project), f.initial)
  assert.equal(vm.runInContext('appVersion', f.ctx), '3.7')
  f.select('3.8'); await f.sync(); f.select('3.7'); await f.sync()
  assert.equal(f.bridges.length, 1, 'version-only toggles reuse the compatible preview project')
  f.select('4.1'); await f.sync()
  assert.equal(f.bridges[1].skeleton.spine, '4.1.24')
})

test('a new project recovers from preparation without losing its export controls', async () => {
  const f = fixture()
  f.select('3.7')
  vm.runInContext('presync()', f.ctx)
  assert.equal(f.button.textContent, '准备工程…')
  assert.equal(f.button.disabled, true)
  assert.equal(f.isSpineRun(), true, 'the waiting label must still identify the animation project action')
  await f.pending()
  vm.runInContext('presync()', f.ctx)
  assert.equal(f.button.textContent, '导出动画工程')
  assert.equal(f.button.disabled, false)
  assert.equal(f.button.hasAttribute('data-nf-skeleton-wait'), false)
})

test('an export bridge refresh preserves the version selected while preparation runs', () => {
  const start = source.indexOf('  function syncSource()'), end = source.indexOf('\n  /**', start)
  let loads = 0, dialogOpen = true
  const src = { skeleton: { text: 'normalized preview' } }
  const ctx = vm.createContext({ window: { __NOVA_SPINE_LAST_SOURCE: src }, api: { loadSource: () => { loads++; return Promise.resolve() } },
    lastSource: null, lastKey: null, ownText: 'original preview', bridgeImporting: true, chosenVersion: '3.7', appJson: {},
    document: { querySelector: () => dialogOpen ? {} : null }, sourceKey: s => s.skeleton.text, forgetReact() {}, durations: new Map(), console })
  vm.runInContext(source.slice(start, end), ctx)
  vm.runInContext('syncSource()', ctx)
  assert.equal(ctx.chosenVersion, '3.7')
  assert.equal(loads, 0)
  ctx.bridgeImporting = false
  ctx.window.__NOVA_SPINE_LAST_SOURCE = { skeleton: { text: 'preview settled after the bridge returned' } }
  vm.runInContext('syncSource()', ctx)
  assert.equal(ctx.chosenVersion, '3.7')
  assert.equal(loads, 1)
  dialogOpen = false
  ctx.window.__NOVA_SPINE_LAST_SOURCE = { skeleton: { text: 'user imported another project' } }
  vm.runInContext('syncSource()', ctx)
  assert.equal(ctx.chosenVersion, '3.7')
  assert.equal(loads, 2)
})
