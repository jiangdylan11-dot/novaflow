// Execute with Electron. Exercise the built page with an ephemeral session and fixture auth only.
const { app, BrowserWindow, session } = require('electron');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', '1');
const root = path.resolve(__dirname, '../../web-dist');
const out = path.resolve(__dirname, '../../../work/login-design');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.wasm': 'application/wasm' };
const server = http.createServer(async (req, res) => {
  try {
    const requested = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(root, '.' + (requested === '/' ? '/index.html' : requested));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    const bytes = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(bytes);
  } catch { res.writeHead(404).end(); }
});

app.whenReady().then(async () => {
  await fs.mkdir(out, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const isolated = session.fromPartition('login-design-verification');
  // No external account/control-plane calls, even if the compiled app tries to poll.
  isolated.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) && !details.url.startsWith(`http://127.0.0.1:${port}/`) }));
  const win = new BrowserWindow({ show: false, width: 1672, height: 941, useContentSize: true,
    webPreferences: { session: isolated, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  const run = code => win.webContents.executeJavaScript(code);
  await win.loadURL(`http://127.0.0.1:${port}/`);
  await run(`new Promise((resolve, reject) => {
    const limit = Date.now() + 15000;
    const timer = setInterval(() => {
      const gate = document.getElementById('novaflow-web-login-gate');
      const logo = document.querySelector('.nf-login-logo');
      if (gate && logo?.complete && logo.naturalWidth && document.querySelector('.nf-login-liquid') && !document.getElementById('novaflow-boot-splash')) { clearInterval(timer); resolve(); }
      else if (Date.now() > limit) { clearInterval(timer); reject(new Error('login surface not ready')); }
    }, 50);
  })`);
  for (const [width, height] of [[1672, 941], [1440, 900], [1280, 580], [390, 844], [320, 640]]) {
    win.setContentSize(width, height);
    await run(`new Promise(resolve => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(resolve)), 250))`);
    const metrics = await run(`(() => {
      const gate = document.getElementById('novaflow-web-login-gate');
      const card = document.querySelector('.nf-login-card');
      const input = document.querySelector('.nf-login-input');
      const tags = document.querySelector('.nf-login-tags');
      const headline = document.querySelector('.nf-login-headline');
      return { width: innerWidth, overflow: gate.scrollWidth > gate.clientWidth,
        editorOverflow: getComputedStyle(document.body).overflow,
        card: { left: card.getBoundingClientRect().left, right: card.getBoundingClientRect().right },
        fieldBackground: getComputedStyle(input).backgroundColor,
        headlineSize: parseFloat(getComputedStyle(headline).fontSize),
        logoWidth: document.querySelector('.nf-login-logo').getBoundingClientRect().width,
        columnGap: parseFloat(getComputedStyle(document.querySelector('.nf-login-main')).gap),
        capabilities: { count: tags.children.length, controls: tags.querySelectorAll('button, a, [role="button"]').length,
          belowTitle: tags.getBoundingClientRect().top > headline.getBoundingClientRect().bottom },
        renderer: document.querySelector('.nf-login-atmosphere').getAttribute('data-renderer'),
        hardLightStrokes: document.querySelectorAll('.nf-login-flow, .nf-login-ribbon').length,
        font: getComputedStyle(document.querySelector('.nf-login-card-title')).fontFamily,
        help: document.querySelector('.nf-login-help').textContent };
    })()`);
    assert.equal(metrics.overflow, false, `horizontal overflow at ${width}`);
    assert.equal(metrics.editorOverflow, 'hidden', 'covered editor cannot add another scrollbar');
    assert(metrics.card.left >= 0 && metrics.card.right <= width, `form clipped at ${width}`);
    assert(['rgb(26, 32, 30)', 'rgb(28, 37, 33)'].includes(metrics.fieldBackground));
    assert(metrics.headlineSize <= 42, 'headline remains restrained');
    assert.deepEqual(metrics.capabilities, { count: 6, controls: 0, belowTitle: true });
    assert(metrics.logoWidth >= (width > 700 ? 180 : 140), 'logo is visibly larger');
    assert(metrics.columnGap <= 84, 'story and form remain a compact group');
    assert(['webgl', 'css'].includes(metrics.renderer));
    assert.equal(metrics.hardLightStrokes, 0, 'no highlights running around rigid lines');
    assert.equal(metrics.help, '账号由管理员开通');
    console.log(JSON.stringify({ size: [width, height], ...metrics }));
    if (width < 901) await run(`document.querySelector('.nf-login-submit').scrollIntoView({ block: 'end' })`);
    await fs.writeFile(path.join(out, `login-${width}x${height}.png`), (await win.webContents.capturePage()).toPNG());
  }
  const motion = await run(`(async () => {
    function sample() {
      const host = document.querySelector('.nf-login-atmosphere');
      if (host.getAttribute('data-renderer') === 'webgl') {
        const gl = host.querySelector('canvas').getContext('webgl');
        const program = gl.getParameter(gl.CURRENT_PROGRAM);
        return gl.getUniform(program, gl.getUniformLocation(program, 'time'));
      }
      const style = getComputedStyle(host.querySelector('.nf-login-fog'));
      return style.transform + style.filter;
    }
    const before = sample();
    await new Promise(resolve => setTimeout(resolve, 120));
    return { before, after: sample() };
  })()`);
  assert.notEqual(motion.before, motion.after, 'light field deforms and changes color');
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  const reduced = await run(`(async () => {
    await new Promise(resolve => setTimeout(resolve, 80));
    const host = document.querySelector('.nf-login-atmosphere');
    const gl = host.getAttribute('data-renderer') === 'webgl' && host.querySelector('canvas').getContext('webgl');
    const program = gl && gl.getParameter(gl.CURRENT_PROGRAM);
    const sample = () => gl ? gl.getUniform(program, gl.getUniformLocation(program, 'time')) : 0;
    const before = sample();
    await new Promise(resolve => setTimeout(resolve, 120));
    return { animations: [...host.querySelectorAll('.nf-login-fog')].map(node => getComputedStyle(node).animationName), before, after: sample() };
  })()`);
  assert.deepEqual(reduced.animations, ['none', 'none']);
  assert.equal(reduced.before, reduced.after, 'reduced motion freezes the light field');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] });
  win.webContents.debugger.detach();
  const result = await run(`(async () => {
    const account = document.getElementById('novaflow-web-login-account');
    const password = document.getElementById('novaflow-web-login-password');
    const submit = document.querySelector('.nf-login-submit');
    const reveal = document.querySelector('.nf-login-reveal');
    let calls = 0, submitted, rejectRequest;
    window.electronAPI.clientAuthLogin = data => { calls++; submitted = data; return new Promise((_r, reject) => { rejectRequest = reject; }); };
    submit.click();
    const empty = document.querySelector('.nf-login-note').textContent;
    account.value = ' fixture-account '; password.value = 'fixture-password';
    reveal.click(); const visible = password.type === 'text' && reveal.getAttribute('aria-pressed') === 'true';
    reveal.click(); const hidden = password.type === 'password';
    password.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    password.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const during = { disabled: submit.disabled, label: submit.textContent, calls };
    rejectRequest(new Error('测试登录失败'));
    await new Promise(resolve => setTimeout(resolve, 50));
    return { empty, visible, hidden, during, submitted, after: { disabled: submit.disabled, label: submit.textContent, message: document.querySelector('.nf-login-note').textContent } };
  })()`);
  assert.equal(result.empty, '请填账号和密码。');
  assert.equal(result.visible, true);
  assert.equal(result.hidden, true);
  assert.deepEqual(result.during, { disabled: true, label: '登录中…', calls: 1 });
  assert.deepEqual(result.submitted, { account: 'fixture-account', password: 'fixture-password' });
  assert.deepEqual(result.after, { disabled: false, label: '进入工作台', message: '测试登录失败' });
  console.log('PASS: compact login at 5 sizes; larger logo, deforming/color-shifting field and reduced motion, validation, reveal, Enter, duplicate prevention and failed-auth recovery (fixture API)');
  win.destroy();
  server.close();
  app.exit(0);
}).catch(err => { console.error(err); server.close(); app.exit(1); });
