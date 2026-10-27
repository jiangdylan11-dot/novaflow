// Native renderer navigation acceptance; never submits chat, inference or generation.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const project = path.resolve(__dirname, '../..');
const renderer = path.resolve(process.env.NF_SHELL_RENDERER || path.join(project, 'renderer'));
const output = path.resolve(process.env.NF_SHELL_OUTPUT || path.join(project, '../work/workspace-shell-verification'));
fs.mkdirSync(output, { recursive: true });
app.disableHardwareAcceleration();
app.setPath('userData', path.join(output, 'profile'));
const changed = ['index.html', 'novaflow-brand-runtime.js', 'spine-split-runtime.js', 'novaflow-ui-theme.css', 'xiaotao-art-agent.js', 'xiaotao-art-agent.css'];
const server = http.createServer((request, response) => {
  const name = decodeURIComponent(new URL(request.url, 'http://local').pathname).slice(1) || 'index.html';
  const base = process.env.NF_SHELL_OVERLAY && changed.includes(name) ? path.resolve(process.env.NF_SHELL_OVERLAY) : renderer;
  const file = path.resolve(base, name);
  if (!file.startsWith(base + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404); response.end(); return; }
  response.setHeader('Content-Type', ({ '.js': 'application/javascript', '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json' })[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(response);
});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const win = new BrowserWindow({ show: false, width: 1480, height: 950, webPreferences: { backgroundThrottling: false } });
    const origin = 'http://127.0.0.1:' + server.address().port;
    win.webContents.session.webRequest.onBeforeRequest((request, done) => done({ cancel: /^https?:/.test(request.url) && !request.url.startsWith(origin + '/') }));
    await win.loadURL(origin + '/index.html');
    await pause(3000);
    const cases = ['动画', '工具', 'JPG 压缩', 'PNG 去黑', 'MP4 压缩', '视频格式转换', 'SPINE 图集转换', '美工', '音视', '音频', '特效', '工具'];
    const results = [];
    for (const name of cases) {
      const clicked = await win.webContents.executeJavaScript(`(() => {
        const selector = ${JSON.stringify(name)} === '音频' ? '#novaflow-av-sub-toggle button' : '[data-novaflow-primary-entry], [data-novaflow-audio-entry], [data-novaflow-tools-entry]';
        const compact = value => String(value || '').trim().replaceAll(' ','');
        const button = [...document.querySelectorAll(selector)].find(b => b.dataset.novaflowPrimaryLabel === ${JSON.stringify(name)} || b.getAttribute('aria-label') === ${JSON.stringify(name)} || compact(b.textContent).startsWith(compact(${JSON.stringify(name)})));
        if (!button) return false; button.click(); return true;
      })()`);
      assert(clicked, 'Missing navigation entry: ' + name);
      await pause(1400);
      win.webContents.sendInputEvent({ type: 'mouseMove', x: 0, y: 0 });
      await pause(40);
      const state = await win.webContents.executeJavaScript(`(() => {
        const rect = e => { const r = e.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height }; };
        const styles = e => Object.fromEntries(['width','height','padding','border','border-radius','background-color','color','font-size','box-shadow'].map(k => [k,getComputedStyle(e).getPropertyValue(k)]));
        const visible = e => { const r=e.getBoundingClientRect(); return r.width>0 && r.height>0 && getComputedStyle(e).visibility!=='hidden'; };
        const bot = document.querySelector('.nf-xiaotao-robot'), box = bot.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);
        const selector = '.nf-topbar, [data-novaflow-primary-surface], [data-novaflow-tools-left-panel], [data-novaflow-tools-preview-card], [data-novaflow-tools-preview-card-body], .nf-prb-panel, .nf-prb-preview, .nf-mp4-panel, .nf-mp4-preview, .nf-vfc-panel, .nf-vfc-preview, .nf-saw-panel, .nf-saw-preview, #novaflow-spine-split-right-workspace, [data-novaflow-art-generate-bottom], [data-novaflow-ai-resource-sidebar-host], [data-novaflow-ai-generation-panel], [data-novaflow-ai-bottom-workspace] > *, [data-novaflow-bottom-controls], #novaflow-aifx-mvp .aifx-timeline, #novaflow-audio-studio :is(.nf-as-left,.nf-as-sidebar,.nf-as-dock,.nf-as-transport,.nf-as-timeline,.nf-as-ref)';
        const surfaces = [...document.querySelectorAll(selector)].filter(visible).map(e => {
          const s=getComputedStyle(e), sides=['Top','Right','Bottom','Left'];
          return {id:e.id,classes:e.className,border:sides.map(side=>s['border'+side+'Width']+' '+s['border'+side+'Style']+' '+s['border'+side+'Color']),visibleBorder:sides.some(side=>parseFloat(s['border'+side+'Width'])>0 && s['border'+side+'Style']!=='none' && !['transparent','rgba(0, 0, 0, 0)'].includes(s['border'+side+'Color']))};
        });
        const tools=[...document.querySelectorAll('[data-novaflow-tools-entry]')].filter(visible).map(button=>({label:button.textContent,shadow:getComputedStyle(button).boxShadow,divider:getComputedStyle(button,'::after').content}));
        const models=[...document.querySelectorAll('select')].filter(select=>visible(select)&&[...select.options].some(option=>option.value==='beta5_int8')).map(select=>({value:select.value,label:select.selectedOptions[0]?.textContent}));
        const lora=[...document.querySelectorAll('[data-novaflow-ai-lora-empty]')].map(node=>({text:node.textContent,visible:visible(node)}));
        return {body:document.body.className,box:rect(bot),style:styles(bot),hit:bot.contains(hit),surfaces,tools,models,lora};
      })()`);
      fs.writeFileSync(path.join(output, 'current.json'), JSON.stringify({name,...state}, null, 2));
      assert(state.hit, name + ': the mascot is covered by another surface');
      assert.equal(state.box.width, 68); assert.equal(state.box.height, 88);
      assert.deepEqual(state.surfaces.filter(surface => surface.visibleBorder), [], name + ': panel outlines must be absent');
      assert(state.tools.every(tool=>tool.shadow==='none'&&tool.divider==='""'), name + ': tool navigation keeps its row separators without an outer outline');
      if (name === '音视') {
        assert(state.models.length > 0 && state.models.every(model=>model.label==='本地模型' && model.value==='beta5_int8'), 'Local model label changes without changing the selected profile');
        assert(state.lora.every(row=>!row.visible), 'LoRA catalogue errors must not occupy the sidebar');
      }
      if (results.length) assert.deepEqual(state.style, results[0].style, name + ': mascot appearance must be stable across navigation');
      const x = Math.round(state.box.x + state.box.width / 2), y = Math.round(state.box.y + state.box.height / 2);
      win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
      win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
      await pause(150);
      const opened = await win.webContents.executeJavaScript(`(() => {const panel=document.querySelector('.nf-xiaotao-panel'),input=panel.querySelector('textarea');return {open:!panel.hidden,width:panel.getBoundingClientRect().width,input:!input.disabled};})()`);
      assert(opened.open && opened.width > 0 && opened.input, name + ': native click must open usable chat');
      await win.webContents.executeJavaScript(`document.querySelector('[aria-label="关闭对话"]').click()`);
      win.webContents.sendInputEvent({ type: 'mouseMove', x: 0, y: 0 });
      await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      fs.writeFileSync(path.join(output, results.length + '-' + name + '.png'), (await win.webContents.capturePage()).toPNG());
      results.push({ name, ...state, opened });
      fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(results, null, 2));
      console.log(name, 'surfaces:', state.surfaces.length, 'native chat click: passed');
    }
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
  finally { server.close(); }
});
setTimeout(() => app.exit(2), 120000);
