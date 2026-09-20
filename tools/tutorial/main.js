/* NovaFlow tutorial recorder.
 *
 * Drives the live 4783 runtime inside a real Electron window, captures every
 * painted frame through CDP Page.startScreencast, and hands the frames to
 * encode.js for muxing. Each feature is a scenario module under scenarios/.
 *
 *   electron tools/tutorial --scenario=local-edit
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const argOf = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const SCENARIO = argOf('scenario', '');
const BASE_URL = argOf('url', 'http://127.0.0.1:4783/');
const WIDTH = Number(argOf('width', 1440));
const HEIGHT = Number(argOf('height', 900));
const OUT_DIR = path.resolve(argOf('out', path.join(__dirname, '..', '..', 'docs', 'tutorials')));
const KEEP_FRAMES = process.argv.includes('--keep-frames');
const NO_ENCODE = process.argv.includes('--no-encode');

if (!SCENARIO) {
  console.error('usage: electron tools/tutorial --scenario=<name>');
  process.exit(2);
}

const scenario = require(path.join(__dirname, 'scenarios', SCENARIO + '.js'));
const workDir = path.join(OUT_DIR, '.frames', SCENARIO);
const overlaySource = fs.readFileSync(path.join(__dirname, 'overlay.js'), 'utf8');

app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

const log = (...a) => console.log('[tut]', ...a);

function makeDriver(win, state) {
  const wc = win.webContents;
  const dbg = wc.debugger;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const js = async (code) => {
    try {
      return await wc.executeJavaScript(code, true);
    } catch (err) {
      throw new Error('page script failed: ' + err.message + '\n---\n' + String(code).slice(0, 400));
    }
  };

  const mouse = (type, x, y, extra) =>
    dbg.sendCommand('Input.dispatchMouseEvent', Object.assign({
      type, x: Math.round(x), y: Math.round(y), button: 'none', buttons: 0, clickCount: 0
    }, extra || {}));

  const t = {
    state,
    sleep,
    js,

    async say(text, sub) {
      await js('window.__tut.say(' + JSON.stringify(text || '') + ',' + JSON.stringify(sub || '') + ')');
    },
    async step(text) {
      await js('window.__tut.step(' + JSON.stringify(text || '') + ')');
    },
    async title(kicker, name, desc) {
      await js('window.__tut.title(' + [kicker, name, desc].map((s) => JSON.stringify(s || '')).join(',') + ')');
    },
    async hideTitle() { await js('window.__tut.hideTitle()'); },
    async wait(ms) { await sleep(ms); },

    async spot(rect) {
      if (!rect) { await js('window.__tut.spot(null)'); return; }
      await js('window.__tut.spot(' + [rect.x, rect.y, rect.w, rect.h].join(',') + ')');
    },

    async rect(sel) { return js('window.__tut.rect(' + JSON.stringify(sel) + ')'); },
    async rectOfText(text, opts) {
      return js('window.__tut.rectOfText(' + JSON.stringify(text) + ',' + JSON.stringify(opts || {}) + ')');
    },

    async move(x, y, ms) {
      const dur = ms == null ? 560 : ms;
      await js('window.__tut.moveTo(' + Math.round(x) + ',' + Math.round(y) + ',' + dur + ')');
      await mouse('mouseMoved', x, y);
      await sleep(Math.max(60, dur * 0.12));
    },

    async click(x, y, opts) {
      const o = opts || {};
      if (o.move !== false) await t.move(x, y, o.moveMs);
      await js('window.__tut.ripple()');
      await mouse('mousePressed', x, y, { button: 'left', buttons: 1, clickCount: 1 });
      await sleep(70);
      await mouse('mouseReleased', x, y, { button: 'left', buttons: 0, clickCount: 1 });
      await sleep(o.settle == null ? 420 : o.settle);
    },

    async clickRect(rect, opts) {
      if (!rect) throw new Error('clickRect got no rect');
      const o = opts || {};
      const x = rect.cx + (o.dx || 0);
      const y = rect.cy + (o.dy || 0);
      if (o.spot !== false) await t.spot(rect);
      await t.click(x, y, o);
      if (o.spot !== false && o.keepSpot !== true) await t.spot(null);
      return { x, y };
    },

    async clickText(text, opts) {
      const o = opts || {};
      const rect = await t.rectOfText(text, o);
      if (!rect) throw new Error('clickText: no element for ' + JSON.stringify(text));
      return t.clickRect(rect, o);
    },

    async clickSel(sel, opts) {
      const rect = await t.rect(sel);
      if (!rect) throw new Error('clickSel: no element for ' + sel);
      return t.clickRect(rect, opts);
    },

    /* Press, sweep through the points, release - used for painting masks. */
    async drag(points, opts) {
      const o = opts || {};
      const first = points[0];
      await t.move(first.x, first.y, o.approachMs == null ? 500 : o.approachMs);
      await mouse('mousePressed', first.x, first.y, { button: 'left', buttons: 1, clickCount: 1 });
      await js('window.__tut.ripple()');
      for (let i = 1; i < points.length; i += 1) {
        const p = points[i];
        await js('window.__tut.jump(' + Math.round(p.x) + ',' + Math.round(p.y) + ')');
        await mouse('mouseMoved', p.x, p.y, { button: 'left', buttons: 1 });
        await sleep(o.stepMs == null ? 22 : o.stepMs);
      }
      const last = points[points.length - 1];
      await mouse('mouseReleased', last.x, last.y, { button: 'left', buttons: 0, clickCount: 1 });
      await sleep(o.settle == null ? 400 : o.settle);
    },

    async key(name, opts) {
      const o = opts || {};
      const map = {
        Enter: { windowsVirtualKeyCode: 13, key: 'Enter', code: 'Enter', text: '\r' },
        Escape: { windowsVirtualKeyCode: 27, key: 'Escape', code: 'Escape' },
        Tab: { windowsVirtualKeyCode: 9, key: 'Tab', code: 'Tab' }
      };
      const spec = map[name] || (/^[a-zA-Z]$/.test(name)
        ? {
          windowsVirtualKeyCode: name.toUpperCase().charCodeAt(0),
          key: name,
          code: 'Key' + name.toUpperCase(),
          text: name
        }
        : null);
      if (!spec) throw new Error('unmapped key: ' + name);
      await dbg.sendCommand('Input.dispatchKeyEvent', Object.assign({ type: 'keyDown' }, spec));
      await sleep(40);
      await dbg.sendCommand('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, spec, { text: undefined }));
      await sleep(o.settle == null ? 500 : o.settle);
    },

    async type(text, opts) {
      const o = opts || {};
      const per = o.perCharMs == null ? 45 : o.perCharMs;
      for (const ch of [...text]) {
        await dbg.sendCommand('Input.insertText', { text: ch });
        await sleep(per);
      }
      await sleep(o.settle == null ? 260 : o.settle);
    },

    async waitFor(expr, opts) {
      const o = opts || {};
      const timeout = o.timeout == null ? 20000 : o.timeout;
      const started = Date.now();
      let last = null;
      while (Date.now() - started < timeout) {
        try {
          last = await js('(function(){try{return (' + expr + ')}catch(e){return null}})()');
        } catch (err) {
          last = null;
        }
        if (last) return last;
        await sleep(o.pollMs == null ? 280 : o.pollMs);
      }
      if (o.optional) return null;
      throw new Error('waitFor timed out after ' + timeout + 'ms: ' + expr);
    },

    /* Mark a span the encoder squeezes down to a fixed number of seconds,
       however long the real wait turned out to be. */
    async ffStart(label) {
      await js('window.__tut.ff(true)');
      state.ffOpen = { from: Date.now(), label: label || '' };
    },
    async ffEnd(targetSeconds) {
      await js('window.__tut.ff(false)');
      if (state.ffOpen) {
        state.ffSpans.push(Object.assign({}, state.ffOpen, {
          to: Date.now(), target: targetSeconds == null ? 5 : targetSeconds
        }));
        state.ffOpen = null;
      }
    },

    /* Drop a served image onto a drop target, exactly like a real drag from Explorer. */
    async loadImage(url, name, selector) {
      const code = [
        '(async function(){',
        '  const blob = await (await fetch(' + JSON.stringify(url) + ')).blob();',
        '  const file = new File([blob], ' + JSON.stringify(name) + ', {type:"image/png"});',
        '  const dt = new DataTransfer(); dt.items.add(file);',
        '  const el = document.querySelector(' + JSON.stringify(selector || '#novaflow-spine-split-workspace-content') + ');',
        '  if(!el) return "no-target";',
        '  const r = el.getBoundingClientRect();',
        '  const base = {bubbles:true,cancelable:true,composed:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2};',
        '  for (const type of ["dragenter","dragover","drop"]) {',
        '    el.dispatchEvent(new DragEvent(type, Object.assign({}, base, {dataTransfer:dt})));',
        '    await new Promise(r=>setTimeout(r,110));',
        '  }',
        '  return "dropped";',
        '})()'
      ].join('\n');
      const res = await js(code);
      if (res !== 'dropped') throw new Error('loadImage failed: ' + res);
      return res;
    }
  };
  return t;
}

async function record() {
  fs.mkdirSync(workDir, { recursive: true });
  for (const f of fs.readdirSync(workDir)) fs.unlinkSync(path.join(workDir, f));
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    useContentSize: true,
    show: false,
    frame: false,
    backgroundColor: '#0b0f14',
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      zoomFactor: 1
    }
  });

  win.once('ready-to-show', () => win.showInactive());

  const wc = win.webContents;
  log('loading', BASE_URL);
  await wc.loadURL(BASE_URL);
  await new Promise((r) => setTimeout(r, 2600));

  const injected = await wc.executeJavaScript(overlaySource, true);
  log('overlay:', injected);

  const state = { ffSpans: [], ffOpen: null };
  const frames = [];
  const dbg = wc.debugger;
  dbg.attach('1.3');

  dbg.on('message', (_event, method, params) => {
    if (method !== 'Page.screencastFrame') return;
    const idx = frames.length;
    const file = String(idx).padStart(6, '0') + '.jpg';
    fs.writeFileSync(path.join(workDir, file), Buffer.from(params.data, 'base64'));
    frames.push({ file, t: Date.now() });
    dbg.sendCommand('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => {});
  });

  await dbg.sendCommand('Page.enable');
  await dbg.sendCommand('Page.startScreencast', {
    format: 'jpeg', quality: 92, maxWidth: WIDTH, maxHeight: HEIGHT, everyNthFrame: 1
  });

  const t = makeDriver(win, state);
  const startedAt = Date.now();
  let failure = null;

  try {
    await t.title('NOVAFLOW 美工 · 绘图', scenario.name, scenario.desc || '');
    await t.wait(1900);
    await t.hideTitle();
    await t.wait(600);
    await scenario.run(t);
    await t.say('');
    await t.step('');
    await t.spot(null);
    await t.wait(500);
    await t.title('', scenario.name, scenario.outro || '完成');
    await t.wait(1500);
  } catch (err) {
    failure = err;
    log('scenario failed:', err.message);
    try {
      await t.say('录制中断：' + err.message.slice(0, 80));
      await t.wait(1200);
    } catch (_) { /* page may be gone */ }
  }

  if (state.ffOpen) state.ffSpans.push(Object.assign({}, state.ffOpen, { to: Date.now(), target: 5 }));

  try { await dbg.sendCommand('Page.stopScreencast'); } catch (_) {}
  await new Promise((r) => setTimeout(r, 400));
  try { dbg.detach(); } catch (_) {}

  const manifest = {
    scenario: SCENARIO,
    name: scenario.name,
    width: WIDTH,
    height: HEIGHT,
    startedAt,
    endedAt: Date.now(),
    ffSpans: state.ffSpans,
    frames
  };
  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(path.join(workDir, 'frames.json'), JSON.stringify(manifest, null, 1));
  log('captured', frames.length, 'frames over', ((Date.now() - startedAt) / 1000).toFixed(1) + 's');

  win.destroy();

  if (!NO_ENCODE && frames.length > 4) {
    await new Promise((resolve) => {
      const child = spawn(process.execPath, [
        path.join(__dirname, 'encode.js'),
        '--dir=' + workDir,
        '--out=' + path.join(OUT_DIR, SCENARIO + '.mp4'),
        KEEP_FRAMES ? '--keep-frames' : '--clean'
      ], { stdio: 'inherit', env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' }) });
      child.on('exit', resolve);
    });
  }

  if (failure) process.exitCode = 1;
  app.quit();
}

app.whenReady().then(record).catch((err) => {
  console.error('[tut] fatal', err);
  process.exitCode = 1;
  app.quit();
});

app.on('window-all-closed', () => {});
