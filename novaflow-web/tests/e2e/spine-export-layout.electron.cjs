// Actual React export dialog plus the production DOM normalizers and project controls.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), acorn = require('acorn');
const project = path.resolve(__dirname, '../..');
const output = path.resolve(process.env.NF_EXPORT_LAYOUT_OUTPUT || path.join(project, '../work/export-dialog-layout-20261027'));
const renderer = process.env.NF_EXPORT_LAYOUT_RENDERER || path.join(project, 'renderer');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
const bundle = fs.readFileSync(path.join(renderer, 'assets/index-BbIa-2NM.js'), 'utf8');
const brand = fs.readFileSync(path.join(renderer, 'novaflow-brand-runtime.js'), 'utf8');
const host = fs.readFileSync(path.join(renderer, 'spine-skeleton-editor.host.js'), 'utf8');
const views = {}, functions = {}, constants = {};
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'start' || key === 'end') continue;
    if (Array.isArray(value)) value.forEach(child => walk(child, visit));
    else if (value && typeof value === 'object') walk(value, visit);
  }
}
for (const [source, target] of [[bundle, views], [brand, functions]]) {
  walk(acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' }), node => {
    if (node.type === 'FunctionDeclaration' && node.id) target[node.id.name] = source.slice(node.start, node.end);
    if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' && node.init) {
      if (source === bundle && ['ArrowFunctionExpression', 'FunctionExpression'].includes(node.init.type)) target[node.id.name] = source.slice(node.init.start, node.init.end);
      if (source === brand && /^[A-Z][A-Z0-9_]+$/.test(node.id.name)) constants[node.id.name] = source.slice(node.init.start, node.init.end);
    }
  });
}
assert(views.Ei, 'Native export modal component must exist');
const section = host.slice(host.indexOf("  const PACK_KEY = 'nf-skel-export'"), host.indexOf('  /** The Spine tab gets'));
app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ show: false, width: 800, height: 720, webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false } });
    const html = path.join(output, 'dialog.html');
    const index = fs.readFileSync(path.join(renderer, 'index.html'), 'utf8');
    const styles = [...index.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="(\.\/[^"?]+)[^"]*"[^>]*>/gi)].map(match => '<link rel="stylesheet" href="file:///' + path.resolve(renderer, match[1]).replaceAll('\\', '/') + '">').join('');
    fs.writeFileSync(html, '<!doctype html><meta charset="utf-8">' + styles + '<style>html,body{display:block!important;margin:0;background:#252525;color:#ddd;font:12px Arial}*{box-sizing:border-box}</style><div id="fixture"></div>');
    await win.loadFile(html);
    await win.webContents.executeJavaScript(`(() => {
      const React = require(${JSON.stringify(path.join(project, 'node_modules/react'))});
      const ReactDOM = require(${JSON.stringify(path.join(project, 'node_modules/react-dom/client'))});
      const X = require(${JSON.stringify(path.join(project, 'node_modules/react/jsx-runtime'))});
      const views = ${JSON.stringify(views)}, functions = ${JSON.stringify(functions)}, constants = ${JSON.stringify(constants)};
      const viewValues = { _: React, X };
      const viewScope = new Proxy(viewValues, { has: () => true, get: (t, k) => {
        if (k === Symbol.unscopables) return;
        if (k in t) return t[k];
        if (k in window) return window[k];
        if (views[k]) return t[k] = new Function('scope', 'with(scope){return (' + views[k] + ')}')(viewScope);
        throw Error('Missing native view dependency ' + String(k));
      }});
      const noop = () => {};
      function App() {
        const [tab, setTab] = React.useState('seq'), [name, setName] = React.useState(''), [scale, setScale] = React.useState(100), [format, setFormat] = React.useState('mp4');
        window.setTab = setTab;
        return React.createElement(viewScope.Ei, { exportTab: tab, setExportTab: setTab, exportName: name, setExportName: setName, activeSystemName: 'room', spineSubEditor: 'skeleton', seqScalePct: scale, setSeqScalePct: setScale, setSeqExportMode: noop, setVideoExportMode: noop, setSeqIncludeBg: noop, setSeqExportSpineProject: noop, setAiSeqExportSpineProject: noop, setAiSeqExportScalePct: setScale, aiSeqExportScalePct: scale, seqSpineVer: '3.8', spineVer: '3.8', setSpineVer: noop, videoExportFormat: format, setVideoExportFormat: setFormat });
      }
      ReactDOM.createRoot(document.getElementById('fixture')).render(React.createElement(App));
      const values = { normalizeText: x => String(x || '').trim(), nfAnimationPerfCount: noop,
        getNovaflowExportContextKind: () => 'skeleton', styleNovaflowExportDialogIfPresent: noop,
        syncSkeletonSpineExportModalButtons: noop, applyNovaflowExportModalRestoreState: noop,
        isNovaflowExportModalDropdownTrigger: () => false,
        isNovaflowExportModalContentReady: () => true };
      const scope = new Proxy(values, { has: () => true, get: (t, k) => {
        if (k === Symbol.unscopables) return;
        if (k in t) return t[k];
        if (k in window) return typeof window[k] === 'function' && ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'getComputedStyle'].includes(k) ? window[k].bind(window) : window[k];
        if (functions[k]) return t[k] = new Function('scope', 'with(scope){return (' + functions[k] + ')}')(scope);
        if (constants[k]) return t[k] = new Function('scope', 'with(scope){return (' + constants[k] + ')}')(scope);
        throw Error('Missing runtime dependency ' + String(k));
      }, set: (t, k, v) => (t[k] = v, true) });
      const api = { projectExportInfo: () => [{ name: 'room', exported: true }], exportSelectedProjects: noop };
      const projectControls = new Function('api', ${JSON.stringify(section + '\nreturn syncNativeProjectExport;')})(api);
      window.NovaFlowSkeletonEditor = { syncExportDialog: projectControls };
      window.syncLayout = (order = 'host-first') => {
        const root = document.querySelector('[data-preview-ui="1"]');
        root.setAttribute('data-novaflow-export-modal-root', '1'); root.setAttribute('data-novaflow-export-context-kind', 'skeleton');
        root.firstElementChild.setAttribute('data-novaflow-export-modal-dialog', '1');
        if (order === 'host-first') projectControls(root);
        scope.syncNovaflowExportModalRuntime(root);
        projectControls(root);
        return root;
      };
      window.layoutSnapshot = () => {
        const root = document.querySelector('[data-preview-ui="1"]'), row = root.querySelector('[data-nf-project-media]');
        const buttons = [...row.querySelectorAll('button')], rect = e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
        return { row: rect(row), buttons: buttons.map(rect), gap: buttons[1].getBoundingClientRect().left - buttons[0].getBoundingClientRect().right, actions: [...root.querySelectorAll('button')].filter(b => /^导出/.test(b.textContent) && b.getBoundingClientRect().height > 0).map(b => b.textContent), order: [...row.parentElement.children].map(e => e === row ? 'project' : e.querySelector('input[type="range"]') ? 'scale' : e.hasAttribute('data-novaflow-export-background-stable-host') ? 'background' : e.textContent.trim().slice(0,40)), nestedInButton: !!row.closest('button'), rows: root.querySelectorAll('[data-nf-project-media]').length };
      };
    })()`);
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    await pause(80);
    const states = {};
    for (const [name, tab, order] of [['first', 'seq', 'host-first'], ['video', 'video', 'brand-first'], ['sequence-return', 'seq', 'brand-first'], ['video-return', 'video', 'host-first']]) {
      if (name !== 'first') { await win.webContents.executeJavaScript(`window.setTab(${JSON.stringify(tab)})`); await pause(30); }
      await win.webContents.executeJavaScript(`void syncLayout(${JSON.stringify(order)})`);
      await pause(30);
      await win.webContents.executeJavaScript(`void syncLayout(${JSON.stringify(order)})`);
      states[name] = await win.webContents.executeJavaScript('layoutSnapshot()');
      await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG());
    }
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(states, null, 2));
    for (const state of Object.values(states)) {
      assert.equal(state.rows, 1); assert(!state.nestedInButton);
      assert.equal(state.actions.length, 1, 'Only the final export action is visible; project switches stay hidden');
      assert(state.gap >= 4 && state.gap <= 10, 'Project output buttons must remain adjacent');
      assert(state.order.indexOf('project') < state.order.indexOf('scale'), 'Project mode must stay above format/scale options');
    }
    assert.equal(states.first.row.y, states['sequence-return'].row.y, 'First-open and return layout must match');
    assert.equal(states.video.row.y, states['video-return'].row.y, 'Video layout must not depend on preceding tab');
    console.log(JSON.stringify(states)); app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
setTimeout(() => app.exit(2), 30000);
