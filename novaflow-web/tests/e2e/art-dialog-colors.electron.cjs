// Render production dialog functions and native React controls without running a model.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), acorn = require('acorn'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const output = path.resolve(process.env.FOART_DIALOG_OUTPUT || path.join(root, '../work/art-dialog-colors'));
const renderer = path.join(root, 'renderer');
const source = fs.readFileSync(path.join(renderer, 'spine-split-runtime.js'), 'utf8');
const brand = fs.readFileSync(path.join(renderer, 'novaflow-brand-runtime.js'), 'utf8');
const bundle = fs.readFileSync(path.join(renderer, 'assets/index-BbIa-2NM.js'), 'utf8');
const functions = {}, constants = {}, native = {};
const literal = node => node?.type === 'TemplateLiteral' && !node.expressions.length ? node.quasis[0].value.cooked : node?.value;
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'start' || key === 'end') continue;
    if (Array.isArray(value)) value.forEach(child => walk(child, visit));
    else if (value && typeof value === 'object') walk(value, visit);
  }
}
for (const code of [source, brand]) walk(acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module' }), node => {
  if (node.type === 'FunctionDeclaration' && node.id) functions[node.id.name] = code.slice(node.start, node.end);
  if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' && node.init && /^[A-Z][A-Z0-9_]+$/.test(node.id.name)) constants[node.id.name] = code.slice(node.init.start, node.init.end);
});
walk(acorn.parse(bundle, { ecmaVersion: 'latest', sourceType: 'module' }), node => {
  if (node.type !== 'CallExpression' || literal(node.arguments[0]) !== 'button') return;
  const props = node.arguments[1];
  if (props?.type !== 'ObjectExpression') return;
  const attr = key => props.properties.find(p => (p.key?.value || p.key?.name) === key);
  if (literal(attr('data-nf-cutout-panel-action')?.value) === 'save') native.save = bundle.slice(node.start, node.end);
  if (attr('data-novaflow-shadow-preserve')) native.shadow = bundle.slice(node.start, node.end);
});
const poseSource=fs.readFileSync(path.join(renderer,'pose-reference.tool.js'),'utf8');
walk(acorn.parse(poseSource,{ecmaVersion:'latest',sourceType:'module'}),node=>{
  if(node.type==='FunctionDeclaration'&&node.id?.name==='element')native.poseElement=poseSource.slice(node.start,node.end);
  if(node.type==='VariableDeclarator'&&node.id?.name==='button')native.poseButton=poseSource.slice(node.init.start,node.init.end);
  if(node.type==='AssignmentExpression'&&node.left?.name==='libraryButton'&&node.right.type==='CallExpression')native.poseOpen=poseSource.slice(node.right.start,node.right.end);
});
assert(native.save && native.shadow, 'Find the actual cutout save and shadow switch JSX');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  fs.mkdirSync(output, { recursive: true });
  const win = new BrowserWindow({ show: false, width: 900, height: 760, webPreferences: { nodeIntegration: true, contextIsolation: false, offscreen: true } });
  const css = fs.readFileSync(path.join(renderer, 'foart-button-theme.css'), 'utf8');
  const js = fs.readFileSync(path.join(renderer, 'foart-button-theme.js'), 'utf8');
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<style>' + css + '</style><style>body{margin:0;background:#222;color:#ddd;font:12px Arial}</style><div id="native"></div>'));
  await win.webContents.executeJavaScript(js);
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 2) console.error(message); });
  await win.webContents.executeJavaScript(`(() => {
    const functions=${JSON.stringify(functions)}, constants=${JSON.stringify(constants)}, native=${JSON.stringify(native)};
    const values={root:window};
    const scope=new Proxy(values,{has:()=>true,get:(t,k)=>{
      if(k===Symbol.unscopables)return;
      if(k in t)return t[k];
      if(k in window)return ['setTimeout','clearTimeout','requestAnimationFrame','getComputedStyle'].includes(k)?window[k].bind(window):window[k];
      if(functions[k])return t[k]=new Function('scope','with(scope){return ('+functions[k]+')}')(scope);
      if(constants[k])return t[k]=new Function('scope','with(scope){return ('+constants[k]+')}')(scope);
      throw Error('Missing dialog dependency '+String(k));
    }});
    window.openDialog=kind=>{const size={width:1024,height:1536};if(kind==='upscale')void scope.showImageUpscaleDialog(size);else if(kind==='transfer')void scope.showObjectTransferUploadDialog();else void scope.showCanvasResizeDialog(size,{title:'无限扩图'});};
    window.closeDialog=()=>document.querySelector('[role="dialog"] [data-nf-dialog="close"], [role="dialog"] button[aria-label="关闭"]')?.click();
    window.paintBrush=(id,active)=>scope.writeAiAnimationBrushPill(document.getElementById(id),active,false);
    const React=require(${JSON.stringify(path.join(root, 'node_modules/react'))}),ReactDOM=require(${JSON.stringify(path.join(root, 'node_modules/react-dom/client'))}),X=require(${JSON.stringify(path.join(root, 'node_modules/react/jsx-runtime'))});
    const or=false,nfPreserveShadow=true,nfSetPreserveShadow=()=>{},wi=()=>{},Xn=()=>{};
    const controls=[native.save,native.shadow].map(code=>eval(code));
    const element=new Function('root','return ('+native.poseElement+')')(window),button=new Function('element','return ('+native.poseButton+')')(element);
    const pose=new Function('button','run','showLibrary','return ('+native.poseOpen+')')(button,()=>{},()=>{});document.body.appendChild(pose);
    ReactDOM.createRoot(document.getElementById('native')).render(React.createElement('div',null,...controls));
  })()`);
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const results = {};
  for (const kind of ['upscale', 'transfer', 'outpaint']) {
    await win.webContents.executeJavaScript(`window.openDialog(${JSON.stringify(kind)})`); await pause(80);
    const state = await win.webContents.executeJavaScript(`(()=>{const n=[...document.querySelectorAll('[role="dialog"] button')].find(n=>['确认','开始放大','执行扩展'].includes(n.textContent)),s=getComputedStyle(n);return {background:s.backgroundColor,border:s.borderTopWidth,text:n.textContent}})()`);
    assert.equal(state.background, kind==='transfer'?'rgb(30, 166, 114)':'rgb(33, 173, 120)', kind); assert.equal(state.border, '0px');
    results[kind] = state;
    if (kind === 'upscale') {
      await win.webContents.executeJavaScript(`[...document.querySelectorAll('[data-foart-selection]')].find(n=>n.textContent==='4x').click()`);
      const selected = await win.webContents.executeJavaScript(`[...document.querySelectorAll('[data-foart-selection]')].map(n=>({text:n.textContent,pressed:n.getAttribute('aria-pressed'),bg:getComputedStyle(n).backgroundColor}))`);
      assert(selected.some(n => n.text === '4x' && n.pressed === 'true' && n.bg === 'rgb(28, 65, 54)'));
    }
    await fs.promises.writeFile(path.join(output, kind + '.png'), (await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript(`document.querySelector('[role="dialog"]')?.remove()`);
  }
  const cutout = await win.webContents.executeJavaScript(`(()=>{const save=document.querySelector('[data-nf-cutout-panel-action="save"]'),shadow=document.querySelector('[data-novaflow-shadow-preserve]');return {save:getComputedStyle(save).backgroundColor,shadow:getComputedStyle(shadow.querySelector('span[aria-hidden]')).backgroundColor}})()`);
  assert.equal(await win.webContents.executeJavaScript(`getComputedStyle(document.querySelector('[data-novaflow-pose-library-open]')).backgroundColor`),'rgb(39, 39, 39)');
  assert.equal(cutout.save, 'rgb(39, 39, 39)'); assert.equal(cutout.shadow, 'rgb(30, 166, 114)'); results.cutout = cutout;
  await win.webContents.executeJavaScript(`(()=>{for(const tag of ['button','label']){const n=document.createElement(tag);n.id='brush-'+tag;n.textContent=tag;document.body.append(n);window.paintBrush(n.id,true)}})()`);
  const brush = await win.webContents.executeJavaScript(`['brush-button','brush-label'].map(id=>{const s=getComputedStyle(document.getElementById(id));return {border:s.borderTopWidth,shadow:s.boxShadow}})`);
  assert(brush.every(n => n.border === '0px' && n.shadow === 'none')); results.brush = brush;
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(results, null, 2));
  console.log('PASS: production dialogs preserve their original solid confirms, selected scales use deep green, native cutout save is grey, shadow switch stays solid, brush buttons have no outline');
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
setTimeout(() => app.exit(2), 30000);
