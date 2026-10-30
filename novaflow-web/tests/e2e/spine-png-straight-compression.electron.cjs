// Actual PNG tool component and WebAssembly encoder, with isolated generated media.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const http = require('node:http'), acorn = require('acorn');
const root = path.resolve(__dirname, '../..');
const renderer = path.resolve(process.env.NF_PNG_RENDERER || path.join(root, 'renderer'));
const output = path.resolve(process.env.NF_PNG_OUTPUT || path.join(root, '.artifacts/png-straight-ui'));
fs.mkdirSync(output, { recursive: true });
app.disableHardwareAcceleration(); app.setPath('userData', path.join(output, 'profile'));
const bundle = fs.readFileSync(path.join(renderer, 'assets/index-BbIa-2NM.js'), 'utf8');
let component, toggle, reactName, jsxName, toggleName;
const declarations = new Map();
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(child => walk(child, visit));
    else if (value && typeof value === 'object') walk(value, visit);
  }
}
const ast = acorn.parse(bundle, { ecmaVersion: 'latest', sourceType: 'module' });
walk(ast, node => {
  if (node.type !== 'FunctionDeclaration') return;
  declarations.set(node.id?.name, node);
  if (bundle.slice(node.start, node.end).includes('compressSpineAtlasSafe')) component = node;
});
assert(component);
// Release minification renames helpers and inlines plans; locate the real
// component and Alpha control by their API/properties rather than local names.
walk(component, node => {
  if (node.type === 'MemberExpression' && node.object.type === 'Identifier') {
    if (node.property.name === 'useState') reactName = node.object.name;
    if (node.property.name === 'jsx') jsxName = node.object.name;
  }
  if (node.type === 'CallExpression' && node.arguments[0]?.type === 'Identifier' && node.arguments[1]?.type === 'ObjectExpression') {
    const options = node.arguments[1].properties.find(property => property.key?.name === 'options');
    if (options && /(?:`pma`|"pma")/.test(bundle.slice(options.start, options.end))) toggleName = node.arguments[0].name;
  }
});
assert(reactName && jsxName && toggleName);
const toggleNode = declarations.get(toggleName); assert(toggleNode);
toggle = bundle.slice(toggleNode.start, toggleNode.end);
const helpers = ast.body.filter(node => node.type === 'VariableDeclaration' && node.end <= component.start).at(-1);
assert(helpers);
const start = helpers.start;
const toolSource = bundle.slice(start, component.end);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let server, win;
function pngInfo(bytes) {
  const data = Buffer.from(bytes); let offset = 8, colors = 0, alpha = [];
  assert.equal(data.subarray(1, 4).toString(), 'PNG');
  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset), type = data.toString('ascii', offset + 4, offset + 8);
    if (type === 'PLTE') colors = length / 3;
    if (type === 'tRNS') alpha = [...data.subarray(offset + 8, offset + 8 + length)];
    offset += 12 + length;
  }
  return { bytes: data.length, width: data.readUInt32BE(16), height: data.readUInt32BE(20), type: data[25], colors,
    translucent: alpha.some(a => a > 0 && a < 255), transparent: alpha.includes(0) };
}
app.whenReady().then(async () => {
  const timeout = setTimeout(() => { console.error('PNG UI test timed out'); app.exit(2); }, 60000);
  try {
    const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#171717;color:#eee;font:12px system-ui}#fixture{height:850px;padding:12px;box-sizing:border-box}</style><div id="fixture"></div>
<script>window.electronAPI={};window.NovaFlowWebRuntime={};</script>
<script src="/renderer/novaflow-web-capabilities.js"></script>
<script>
const React=require(${JSON.stringify(path.join(root, 'node_modules/react'))}),DOM=require(${JSON.stringify(path.join(root, 'node_modules/react-dom/client'))}),X=require(${JSON.stringify(path.join(root, 'node_modules/react/jsx-runtime'))});
const toggle=new Function(${JSON.stringify(reactName)},${JSON.stringify(jsxName)},${JSON.stringify(toggle + ';return ' + toggleName + ';')})(React,X);
const Tool=new Function(${JSON.stringify(reactName)},${JSON.stringify(jsxName)},${JSON.stringify(toggleName)},${JSON.stringify(toolSource + ';return ' + component.id.name + ';')})(React,X,toggle);
window.calls=[];for(const key of ['compressPngStrong','compressSpineAtlasSafe']){const original=electronAPI[key];electronAPI[key]=async payload=>{const result=await original(payload);calls.push({key,payload:{...payload,dataUrl:undefined},result});return result;};}
DOM.createRoot(document.getElementById('fixture')).render(React.createElement(Tool,{toolMode:'png_compress',showToolSelector:false}));
</script>`;
    server = http.createServer((req, res) => {
      const name = decodeURIComponent(new URL(req.url, 'http://local').pathname);
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      if (name === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); return; }
      const file = path.resolve(renderer, name.replace(/^\/renderer\//, ''));
      if (!name.startsWith('/renderer/') || !file.startsWith(renderer + path.sep) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
      res.setHeader('Content-Type', ({ '.js': 'application/javascript', '.wasm': 'application/wasm' })[path.extname(file)] || 'application/octet-stream');
      fs.createReadStream(file).pipe(res);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    win = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false, offscreen: true } });
    const errors = []; win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message); });
    await win.loadURL('http://127.0.0.1:' + server.address().port);
    const run = source => win.webContents.executeJavaScript(source);
    async function until(source) { for (let i = 0; i < 400; i++) { if (await run(source)) return; await wait(25); } throw Error('Timed out: ' + source + '\n' + errors.join('\n')); }
    const click = text => run(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`);
    await until(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Spine 图集')`);
    await click('Spine 图集'); await wait(50); await click('未开启'); await wait(50);
    await run(`(()=>{const c=document.createElement('canvas');c.width=256;c.height=192;const g=c.getContext('2d'),im=g.createImageData(c.width,c.height);for(let y=8;y<c.height-8;y++)for(let x=8;x<c.width-8;x++){const p=(y*c.width+x)*4;im.data[p]=x;im.data[p+1]=y;im.data[p+2]=(x*13+y*7)%256;im.data[p+3]=(x+y)%256;}g.putImageData(im,0,0);const bytes=Uint8Array.from(atob(c.toDataURL().split(',')[1]),c=>c.charCodeAt(0)),dt=new DataTransfer();dt.items.add(new File([bytes],'straight-fixture.png',{type:'image/png'}));window.originalBytes=bytes.length;const input=document.querySelector('input[type=file]');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await until(`document.body.innerText.includes('straight-fixture.png')`);
    async function compress(strength) {
      const count = await run('calls.length');
      await run(`(()=>{const input=document.querySelector('input[type=range]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${strength});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await wait(50); await click('开始压缩');
      await until(`calls.length>${count}&&[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='开始压缩'&&!b.disabled)`);
      const call = await run('calls.at(-1)'); assert.equal(call.result.ok, true, call.result.error); return call;
    }
    const low = await compress(20), middle = await compress(66), high = await compress(94);
    for (const call of [low, middle, high]) {
      assert.equal(call.key, 'compressPngStrong'); assert.equal(call.payload.profile, undefined);
      const info = pngInfo(call.result.bytes); assert.equal(info.type, 3); assert.equal(info.width, 256); assert.equal(info.height, 192);
      assert(info.colors <= call.payload.colors); assert(info.translucent && info.transparent);
    }
    assert(low.payload.quality > middle.payload.quality && middle.payload.quality > high.payload.quality);
    assert(low.payload.colors > middle.payload.colors && middle.payload.colors > high.payload.colors);
    assert(high.result.bytes.length < low.result.bytes.length); assert(middle.result.bytes.length < await run('originalBytes'));
    await run(`window.safeEncoder=electronAPI.compressSpineAtlasSafe;delete electronAPI.compressSpineAtlasSafe`); await compress(64);
    assert(await run(`document.body.innerText.includes('直通 Alpha 减色压缩')`));
    assert(await run(`document.body.innerText.includes('批量 Spine 图集直通 Alpha 减色压缩完成。')`));
    await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    fs.writeFileSync(path.join(output, 'straight.png'), (await win.webContents.capturePage()).toPNG());
    // PMA enhanced handling must still send its explicit profile and reject this obvious straight source.
    await run(`void(electronAPI.compressSpineAtlasSafe=window.safeEncoder)`);
    await click('已开启（PMA）'); await wait(50);
    const safe = await compress(42); assert.equal(safe.key, 'compressSpineAtlasSafe');
    const pma = await compress(66); assert.equal(pma.payload.profile, 'spine-atlas-pma'); assert.equal(pma.result.spineAtlasProtection.safeFallback, true);
    assert.deepEqual(errors, []);
    const report = { ok: true, originalBytes: await run('originalBytes'), modes: [low, middle, high].map(call => ({ payload: call.payload, output: pngInfo(call.result.bytes) })),
      straightIndependentOfSafeAPI: true, pmaSafeRangePreserved: true, pmaGuardPreserved: true };
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
    clearTimeout(timeout); server.closeAllConnections(); server.close(); win.destroy(); app.exit(0);
  } catch (error) {
    fs.writeFileSync(path.join(output, 'error.txt'), error.stack); console.error(error); clearTimeout(timeout); server?.closeAllConnections(); server?.close(); app.exit(1);
  }
});
