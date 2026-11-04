// Isolated rail regression: product layout/extra-cell functions in a real DOM.
// No Foart account, network, models, or production state is used.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const brand = fs.readFileSync(path.join(root, 'renderer/novaflow-brand-runtime.js'), 'utf8');
const audio = fs.readFileSync(path.join(root, 'renderer/audio-studio.tool.js'), 'utf8');
const slice = (text, start, end) => {
  const a = text.indexOf(start), b = text.indexOf(end, a);
  assert(a >= 0 && b > a, `missing source fragment ${start}`);
  return text.slice(a, b);
};
const layout = slice(brand, '  const PRIMARY_RAIL_ORDER =', '  function stopPrimaryOutputShortcutEvent');
const extra = slice(audio, '  function railEntry(label)', "  // The rail's own pressed / idle look");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'foart-rail-regression-'));
app.setPath('userData', profile);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-background-networking');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1100, height: 800, webPreferences: { backgroundThrottling: false } });
  win.webContents.on('console-message', (_event, _level, message) => console.error('renderer:', message));
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/i.test(details.url) }));
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><style>html,body{margin:0} button{cursor:pointer} #novaflow-primary-audio-cell{position:fixed} #novaflow-primary-audio-cell button{width:100%;height:100%}</style><body><div id="rail"></div></body>'));
    const setup = `(() => {
      const PRIMARY_ENTRY_LABELS=['特效','动画','美工','工具'];
      const PRIMARY_PANEL_TOP_GAP=8, PRIMARY_RAIL_INNER_PAD=10, PRIMARY_RAIL_ITEM_PITCH=70;
      const PRIMARY_SIDEBAR_LEFT=8, PRIMARY_SIDEBAR_ITEM_INSET=6, PRIMARY_SIDEBAR_ITEM_WIDTH=40, PRIMARY_SIDEBAR_ITEM_HEIGHT=65;
      const DROPDOWN_UNDERLAY_Z_INDEX='5', NOVAFLOW_MEDIUM_FONT_WEIGHT='500', TOPBAR_HEIGHT=54;
      const LEFT_COLUMN_BACKGROUND_IMAGE='none', LEFT_LAYOUT_BACKGROUND='transparent', PRIMARY_SIDEBAR_ID='sidebar', LEFT_SEAM_BACKDROP_ID='seam';
      const ensurePrimarySidebarBackdrop=()=>{}, removeRuntimeNode=()=>{}, findLeftWorkspaceColumn=()=>null, ensurePrimaryOutputShortcut=()=>{};
      const getTopbarBottom=()=>54, isPrimaryEntryCellCandidate=()=>false;
      const nfSetAttrIfChanged=(e,k,v)=>{if(e.getAttribute(k)!==v)e.setAttribute(k,v)};
      const nfSetStyleIfChanged=(e,k,v,p)=>{if(e.style.getPropertyValue(k)!==v)e.style.setProperty(k,v,p)};
      const findPrimaryEntryButton=(label)=>document.querySelector('[data-label="'+label+'"]');
      const findCommonParent=()=>document.getElementById('rail');
      const rail=document.getElementById('rail');
      for(const label of PRIMARY_ENTRY_LABELS){const b=document.createElement('button');b.textContent=label;b.dataset.label=label;b.dataset.novaflowPrimaryEntry='1';b.dataset.novaflowPrimaryLabel=label;b.addEventListener('click',()=>window.clicked=label);rail.appendChild(b)}
      ${layout.replace('function updatePrimarySidebarLayout(buttons, rail) {', 'function updatePrimarySidebarLayout(buttons, rail) { window.layoutCount=(window.layoutCount||0)+1;')}
      const CELL_ID='novaflow-primary-audio-cell', RAIL_AFTER='特效', RAIL_PITCH=70, LABEL='音视', ICON='none';
      const state={active:false}; const copyCellLook=()=>{}; const activate=()=>{window.clicked='音视'};
      ${extra}
      observePrimaryExtraRail();
      updatePrimarySidebarLayout(PRIMARY_ENTRY_LABELS.map(findPrimaryEntryButton),rail);
      window.railFixture={ensureCell,layout:()=>updatePrimarySidebarLayout(PRIMARY_ENTRY_LABELS.map(findPrimaryEntryButton),rail)};
    })()`;
    await win.webContents.executeJavaScript(setup);
    const state = () => win.webContents.executeJavaScript(`(()=>{const pick=(s)=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect(), hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {x:r.x,y:r.y,w:r.width,h:r.height,hit:hit===e||e.contains(hit)}};return {art:pick('[data-label="美工"]'),audio:pick('[data-novaflow-audio-entry]'),count:window.layoutCount,outer:document.documentElement.scrollHeight>innerHeight}})()`);
    for (const [width, height] of [[1100,800],[900,650],[380,640]]) {
      win.setSize(width,height); await wait(100);
      await win.webContents.executeJavaScript('window.railFixture.ensureCell()');
      await wait(80);
      const s=await state();
      assert(s.art.hit && s.audio.hit, 'both entries must receive pointer input');
      assert(s.art.y>=s.audio.y+s.audio.h, 'audio must not cover art');
      assert(!s.outer, 'rail must not cause outer scrolling');
      for(const [name,r] of [['美工',s.art],['音视',s.audio]]){
        const x=Math.round(r.x+r.w/2),y=Math.round(r.y+r.h/2);
        win.webContents.sendInputEvent({type:'mouseDown',x,y,button:'left',clickCount:1});
        win.webContents.sendInputEvent({type:'mouseUp',x,y,button:'left',clickCount:1});
        await wait(30); assert.equal(await win.webContents.executeJavaScript('window.clicked'),name);
      }
      const count=(await state()).count; await wait(300); assert.equal((await state()).count,count,'layout must settle without mutation loop');
      await win.webContents.executeJavaScript("document.getElementById('novaflow-primary-audio-cell').remove()");
      await wait(50); const without=await state(); assert.equal(without.audio,null); assert(without.art.hit); assert.equal(without.art.y,s.audio.y,'art fills vacated slot');
    }
    console.log('PASS: delayed insertion, removal, real clicks, no layout loop at 1100x800, 900x650, 380x640');
    win.destroy(); app.exit(0);
  } catch (error) { console.error(error); win.destroy(); app.exit(1); }
});
setTimeout(() => app.exit(2), 20000);
