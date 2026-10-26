const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const renderer = path.resolve(__dirname, '../../renderer')
const bundle = fs.readFileSync(path.join(renderer, 'assets/index-BbIa-2NM.js'), 'utf8')
const names = vm.runInNewContext('const ' + bundle.slice(bundle.indexOf('zi=e=>'), bundle.indexOf(',Gi=', bundle.indexOf('zi=e=>'))) + '; ({zi,Bi,Vi,Hi,Ui,Wi})')
const uniqueStart = bundle.indexOf('Ki=', bundle.indexOf('zi=e=>'))
const unique = vm.runInNewContext('(' + bundle.slice(uniqueStart + 3, bundle.indexOf(',qi=', uniqueStart)) + ')')

test('all PNG compression modes preserve original atlas names, extensions and characters', () => {
  for (const source of ['zhongjifan.png', 'zunxiangfan_1.png', 'skeleton_2.png', '中级房 图集.PNG']) {
    for (const mode of ['Vi','Hi','Ui','Wi']) assert.equal(names[mode](source), source)
  }
  assert.equal(names.Ui(''), 'image.png')
})

test('JPG compression preserves JPG/JPEG names; conversion changes only the extension', () => {
  for (const source of ['photo.jpg','原图.JPEG','图集 1.jpeg']) assert.equal(names.Bi(source), source)
  assert.equal(names.Bi('原图.png'), '原图.jpg')
  assert.equal(names.zi('原图.png'), '原图.jpg')
})

test('batch suffixes apply only when output names actually collide', () => {
  const used = new Set()
  assert.equal(unique(names.Ui('one.png'), used), 'one.png')
  assert.equal(unique(names.Ui('two.png'), used), 'two.png')
  assert.equal(unique(names.Ui('one.png'), used), 'one-2.png')
  assert.equal(unique(names.Ui('one_2.png'), used), 'one_2.png')
})

test('PNG remove-black and both MP4 routes preserve the original filename', () => {
  const outputName = file => vm.runInNewContext('(' + fs.readFileSync(path.join(renderer,file),'utf8').match(/^  const outputName = (.+)$/m)[1] + ')')
  const png = outputName('png-remove-black.tool.js'), mp4 = outputName('mp4-compress.tool.js')
  const native = require('../../../particle-editor-desktop/main/mp4-compressor.js')
  for (const name of ['扫光 01.PNG', 'skeleton_2.png']) assert.equal(png(name),name)
  for (const name of ['入场动画.MP4','video_01.mp4']) {
    assert.equal(mp4(name),name)
    assert.equal(native.mp4CompressOutputFileName(name),name)
  }
  const source = fs.readFileSync(path.join(renderer,'novaflow-web-capabilities.js'),'utf8')
  const declarations = ['sanitizeVideoName','videoStem','mp4OutputFileName'].map(name => source.match(new RegExp('^  const '+name+' = .+$','m'))[0]).join('\n')
  const webName = vm.runInNewContext(declarations+'\nmp4OutputFileName')
  assert.equal(webName('入场动画.MP4'),'入场动画.MP4')
})

test('video and Spine format conversion change only the extension', () => {
  const video = fs.readFileSync(path.join(renderer,'video-format-convert.tool.js'),'utf8')
  const convert = vm.runInNewContext(video.match(/^  const fileStem = .+$/m)[0]+'\n'+video.match(/^  const outputName = .+$/m)[0]+'\noutputName')
  assert.equal(convert('入场动画 01.mov','webm'),'入场动画 01.webm')
  const source = fs.readFileSync(path.join(renderer,'novaflow-web-capabilities.js'),'utf8')
  const begin = source.indexOf('    function sanitizeFileName(name)',source.indexOf('// ---- names'))
  const end = source.indexOf('    function clampInt(',begin)
  const spine = vm.runInNewContext(source.slice(begin,end)+'\n({outputFileNameForFormat,atlasOutputFileName})')
  assert.equal(spine.outputFileNameForFormat('中级房_1.png','webp'),'中级房_1.webp')
  assert.equal(spine.atlasOutputFileName('中级房.atlas'),'中级房.atlas')
})

test('folder export writes the original names and bytes through the production Web API', async () => {
  const written = new Map(), requests = []
  const folder = { name: 'exports', getFileHandle: async (name, options) => {
    requests.push(name)
    if (!options?.create && !written.has(name)) throw new Error('NotFoundError')
    return { createWritable: async () => ({ write: async blob => written.set(name, Buffer.from(await blob.arrayBuffer())), close: async () => {} }) }
  } }
  const ctx = vm.createContext({ console, atob, Blob, Response, CompressionStream, DecompressionStream, electronAPI: {}, NovaFlowWebRuntime: {}, showDirectoryPicker: async () => folder })
  ctx.document = { getElementById: () => ({}), querySelector: () => null }
  ctx.window = ctx
  vm.runInContext(fs.readFileSync(path.join(renderer,'novaflow-web-capabilities.js'),'utf8'),ctx)
  const picked = await ctx.electronAPI.pickDirectory()
  const sourceNames = ['zhongjifan.png','zunxiangfan_1.png','skeleton_2.png']
  for (const source of sourceNames) {
    const result = await ctx.electronAPI.writeBinaryFile({ dir: picked.dir, fileName: names.Ui(source), bytes: [1,2,3] })
    assert.equal(result.ok, true)
  }
  assert.deepEqual([...written.keys()], sourceNames)
  assert.ok(requests.every(name => sourceNames.includes(name)))
  for (const bytes of written.values()) assert.deepEqual(bytes, Buffer.from([1,2,3]))
})
