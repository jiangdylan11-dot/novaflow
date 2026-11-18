// 美工 → UI → 拆图 panel in the real packaged page (web-dist): what the user sees and does.
// Run: node_modules/.bin/electron tests/e2e/ui-split-panel.electron.cjs   (not part of run-tests.mjs)
//
// Only the account check, the online recognition and the node request are replaced; the panel,
// the board, the boxes and the working dialog are the real ones.
//
// Note: tests/e2e/control-appearance.electron.cjs has been stale in many places since 2026-10-30
// (it waits on the site root for the editor's logo, checks a notice that was removed on purpose,
// and more) and does not run through. Do not rely on it as a gate for this panel; this file is.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs/promises'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const root = process.env.FOART_TEST_ROOT || path.resolve(__dirname, '../..');
const out = path.resolve(process.env.FOART_UI_SPLIT_OUTPUT || path.join(root, '../work/ui-split-panel'));
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
app.commandLine.appendSwitch('force-device-scale-factor', '1');
const delay = ms => new Promise(r => setTimeout(r, ms));
let server;

async function main() {
  await fs.mkdir(out, { recursive: true });
  await app.whenReady();
  const webRoot = process.env.FOART_WEB_ROOT || path.join(root, 'web-dist');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
  server = http.createServer(async (req, res) => {
    try {
      const p = new URL(req.url, 'http://localhost').pathname, file = path.resolve(webRoot, '.' + (p === '/' ? '/index.html' : p));
      if (!file.startsWith(webRoot + path.sep)) return res.writeHead(403).end();
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }).end(await fs.readFile(file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const isolated = session.fromPartition('foart-ui-split-panel');
  isolated.webRequest.onBeforeRequest((d, cb) => cb({ cancel: /^https?:/.test(d.url) && !d.url.startsWith(base) && !d.url.startsWith('https://cdnjs.cloudflare.com/') }));
  const win = new BrowserWindow({ show: false, width: 1600, height: 900, webPreferences: { session: isolated, offscreen: true, backgroundThrottling: false, contextIsolation: true, nodeIntegration: false } });
  const ev = code => win.webContents.executeJavaScript(code, true);
  const wait = async (code, label, ms = 30000) => { const end = Date.now() + ms; for (;;) { if (await ev(`(()=>{try{return !!(${code})}catch{return false}})()`)) return; if (Date.now() > end) throw new Error('timeout: ' + label); await delay(150); } };
  const shot = async name => fs.writeFile(path.join(out, name + '.png'), (await win.webContents.capturePage()).toPNG());
  const mouse = async (type, x, y, extra = {}) => { win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, ...extra }); await delay(40); };
  const drag = async (x0, y0, x1, y1, modifiers = []) => {
    await mouse('mouseMove', x0, y0, { modifiers });
    await mouse('mouseDown', x0, y0, { modifiers });
    for (let i = 1; i <= 4; i++) await mouse('mouseMove', x0 + (x1 - x0) * i / 4, y0 + (y1 - y0) * i / 4, { modifiers: [...modifiers, 'leftButtonDown'] });
    await mouse('mouseUp', x1, y1, { modifiers });
    await delay(150);
  };
  const click = async (x, y) => { await mouse('mouseMove', x, y); await mouse('mouseDown', x, y); await mouse('mouseUp', x, y); await delay(150); };

  // the editor (the site root is the home page), signed in with a fixture account
  await win.loadURL(base + '/editor.html?surface=drawing');
  await wait(`typeof NovaFlowWebAccount==='object'&&typeof electronAPI==='object'`, 'editor scripts');
  await ev(`(async()=>{const who={authenticated:true,user:{display_name:'拆图面板验收'},credits:{balance:100}};electronAPI.clientAuthStatus=async()=>({ok:true,result:who});electronAPI.clientAuthAccountDetails=async()=>({ok:true,result:who});await NovaFlowWebAccount.guard();await NovaFlowWebAccount.refresh()})()`);
  await wait(`!document.getElementById('novaflow-web-login-gate')&&!document.getElementById('novaflow-boot-splash')&&window.NovaFlowSpineSplitBridge`, 'editor ready');

  // 美工 → UI, one picture on the board
  await wait(`[...document.querySelectorAll('button')].some(n=>n.innerText.trim()==='UI'&&n.checkVisibility())`, 'UI tab');
  await ev(`[...document.querySelectorAll('button')].find(n=>n.innerText.trim()==='UI'&&n.checkVisibility()).click()`);
  await delay(800);
  await ev(`(async()=>{const c=document.createElement('canvas');c.width=1024;c.height=768;const g=c.getContext('2d');g.fillStyle='#d9d2c5';g.fillRect(0,0,1024,768);g.fillStyle='#7a9cc6';g.fillRect(120,120,300,300);g.fillStyle='#c96f5a';g.beginPath();g.arc(700,400,180,0,7);g.fill();await NovaFlowSpineSplitBridge.importSourceDataUrl('ui-split-fixture.png',c.toDataURL('image/png'),{silent:true})})()`);
  await wait(`NovaFlowSpineSplitBridge.getState().source?.dataUrl&&document.querySelector('[data-novaflow-ui-smart-split]')?.checkVisibility()`, 'picture on the board and 拆图 panel');

  // recognition and the node request are fixtures
  await ev(`(()=>{
    electronAPI.promptAssistantDescribeArtStyle=({signal})=>new Promise((resolve,reject)=>{const t=setTimeout(()=>resolve({ok:true,proposal:{schema:'nf.ui.split.v1',regions:[
      {id:'a',name:'蓝色面板',kind:'panel',box:[120,160,410,700]},{id:'b',name:'红色圆',kind:'object',box:[510,290,860,750]},
      ...Array.from({length:8},(_,i)=>({id:'c'+i,name:'小图标 '+(i+1),kind:'icon',box:[140+i*30,780,165+i*30,830]}))]}}),2500);signal?.addEventListener('abort',()=>{clearTimeout(t);reject(new Error('已取消'))})});
    electronAPI.promptAssistantReverseImagePrompt=async()=>({ok:false,errorCode:'ui-split-node-unavailable',error:'当前算力池没有可以拆图的节点'});
    const a=window.NovaFlowXiaotaoArtAgent=window.NovaFlowXiaotaoArtAgent||{};a.panel=a.panel||{};const c=a.panel.controller=a.panel.controller||{};
    c.businessModelSnapshot=()=>({provider:'api',modelId:'fixture',epoch:1});c.onlineBusinessUi=()=>({});
  })()`);

  // open the panel: plain buttons, no 添加选区 / 删除选区
  await ev(`document.querySelector('[data-novaflow-ui-smart-split] .nf-panel-header').click()`);
  await delay(600);
  const buttons = await ev(`[...document.querySelectorAll('[data-novaflow-ui-smart-split] .nf-panel-body button')].filter(n=>n.checkVisibility()).map(n=>({text:n.textContent.trim(),bg:getComputedStyle(n).backgroundColor,role:n.getAttribute('data-foart-action')}))`);
  await fs.writeFile(path.join(out, 'buttons.json'), JSON.stringify(buttons, null, 2));
  const names = buttons.map(b => b.text);
  assert.deepEqual(names, ['对象识别', '确认拆图', '取消'], 'the panel has exactly these buttons (no 添加选区 / 删除选区)');
  const neutral = buttons.find(b => b.text === '取消').bg;
  for (const text of ['对象识别', '确认拆图']) {
    const b = buttons.find(n => n.text === text);
    assert.equal(b.role, 'neutral', text + ' is a plain action');
    assert.equal(b.bg, neutral, text + ' has the same fill as the other plain buttons, not green');
  }

  // 对象识别: the shared working dialog shows while it runs, and goes away afterwards
  await ev(`[...document.querySelectorAll('[data-novaflow-ui-smart-split] button')].find(n=>n.textContent.trim()==='对象识别').click()`);
  await wait(`document.getElementById('novaflow-spine-split-busy-overlay')?.checkVisibility()`, 'working dialog while recognising', 8000);
  const busy = await ev(`(()=>{const o=document.getElementById('novaflow-spine-split-busy-overlay');return {message:o.querySelector('[data-novaflow-spine-split-busy-message]')?.textContent||'',elapsed:o.querySelector('[data-novaflow-spine-split-busy-elapsed]')?.textContent||'',stop:getComputedStyle(o.querySelector('[data-novaflow-spine-split-busy-stop]')).display}})()`);
  assert.equal(busy.message, '正在识别对象...'); assert.match(busy.elapsed, /已用时/); assert.notEqual(busy.stop, 'none', 'the dialog offers a stop button');
  await shot('recognising');
  await wait(`!document.getElementById('novaflow-spine-split-busy-overlay')&&document.querySelectorAll('[data-novaflow-ui-split-preview] svg g').length===10`, 'recognition result on the board');
  const boxes = () => ev(`document.querySelectorAll('[data-novaflow-ui-split-preview] svg g').length`);
  const crosses = () => ev(`[...document.querySelectorAll('[data-ui-split-delete]')].filter(n=>n.checkVisibility()).map(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return {id:n.getAttribute('data-ui-split-delete'),x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,bg:s.backgroundColor}})`);
  const frame = await ev(`(()=>{const r=document.querySelector('[data-novaflow-ui-split-preview] svg').getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height}})()`);
  const at = (fx, fy) => [frame.left + frame.width * fx / 1000, frame.top + frame.height * fy / 1000];
  assert.deepEqual(await crosses(), [], 'nothing is selected yet, so no delete cross');

  // a press on blank board drags out a new box
  await drag(...at(450, 60), ...at(700, 200));
  assert.equal(await boxes(), 11, 'dragging on blank board adds a box');
  // Ctrl drags one anywhere, also over an existing box
  await drag(...at(560, 350), ...at(760, 600), ['control']);
  assert.equal(await boxes(), 12, 'Ctrl + drag over an existing box adds a box');
  // a plain drag on an existing box moves it instead of adding one
  await drag(...at(200, 300), ...at(230, 320));
  assert.equal(await boxes(), 12, 'dragging an existing box does not add one');

  // click a box: a cross at its top-right corner; the cross removes it
  await click(...at(640, 720));
  const shown = await crosses();
  assert.equal(shown.length, 1, 'one selected box shows one delete cross');
  assert.equal(shown[0].id, 'b'); assert.equal(Math.round(shown[0].w), 18); assert.notEqual(shown[0].bg, 'rgba(0, 0, 0, 0)', 'the cross is drawn, not transparent');
  const corner = at(860, 290);
  assert(Math.abs(shown[0].x - corner[0]) <= 24 && Math.abs(shown[0].y - corner[1]) <= 24, 'the cross sits at the top-right corner of the box');
  await shot('selected-with-cross');
  await click(shown[0].x, shown[0].y);
  assert.equal(await boxes(), 11, 'the cross removes the box');
  assert.deepEqual(await crosses(), [], 'and nothing stays selected');

  // 确认拆图 with no node that can split: boxes are cropped and the note says 未补全 (no red error)
  await ev(`[...document.querySelectorAll('[data-novaflow-ui-smart-split] button')].find(n=>n.textContent.trim()==='确认拆图').click()`);
  let fallback = '';
  {
    await wait(`/未补全/.test(document.querySelector('[data-novaflow-ui-smart-split] .nf-panel-body')?.innerText||'')&&!document.getElementById('novaflow-spine-split-busy-overlay')`, 'fallback note', 40000);
    fallback = await ev(`(document.querySelector('[data-novaflow-ui-smart-split] .nf-panel-body').innerText.split('\\n').find(line=>/未补全/.test(line))||'')`);
    assert.match(fallback, /当前没有可用的拆图节点.*未补全/, 'the note says why and that the result is not filled in');
    assert.equal(await ev(`NovaFlowSpineSplitBridge.getState().parts.length>0`), true, 'the cropped layers are on the board');
  }
  await shot('after-split');
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify({ ok: true, buttons, busy, fallback }, null, 2));
  console.log('PASS: plain buttons, no 添加选区 / 删除选区, working dialog while recognising, blank drag and Ctrl drag add boxes, corner cross removes one; fallback note: ' + String(fallback).replace(/\s+/g, ' ').slice(0, 120));
  server.close(); app.exit(0);
}
main().catch(e => { console.error(e); server?.close(); app.exit(1); });
