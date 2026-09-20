/* Shared steps every 美工 · 绘图 tutorial opens with. */

const LEFT_PANEL = { x0: 60, x1: 360 };
const DEMO_SCENE = '/tutorial-assets/demo-scene.png';
const DEMO_OBJECT = '/tutorial-assets/demo-object.png';

/* The runtime tags every tool button with its action id - far steadier than
   matching the label, which changes as the tool enters and leaves its mode. */
const ACTION_ATTR = 'data-novaflow-spine-split-control-action';
const actionSel = (action) => 'button[' + ACTION_ATTR + '="' + action + '"]';

/* Whatever the stage is showing right now: an <img> in 原图 view, a <canvas>
   once a paint tool is live. */
const STAGE_PROBE = [
  '(function(){',
  '  const nodes=[...document.querySelectorAll("canvas,img")]',
  '    .map(function(n){return {n:n,r:n.getBoundingClientRect()}})',
  '    .filter(function(o){return o.r.width>200&&o.r.height>200&&o.r.left>300})',
  '    .sort(function(a,b){return b.r.width*b.r.height-a.r.width*a.r.height});',
  '  if(!nodes.length) return null;',
  '  const r=nodes[0].r;',
  '  return {tag:nodes[0].n.tagName,x:r.x,y:r.y,w:r.width,h:r.height};',
  '})()'
].join('\n');

/* Left rail -> 美工, then make sure the 绘图 tab is the active one. */
async function enterArtDraw(t) {
  await t.step('① 进入 美工 · 绘图');
  await t.say('左侧导航切到「美工」，上方选「绘图」。', '这里是所有静态图处理功能的入口');
  await t.wait(900);
  await t.clickText('美工', { within: { x0: 0, x1: 70 }, settle: 900 });
  const draw = await t.rectOfText('绘图', { within: { x0: 60, x1: 360, y0: 0, y1: 120 } });
  if (draw) await t.clickRect(draw, { settle: 700 });
  await t.wait(500);
}

/* Open one of the four accordion groups in the left panel. */
async function openGroup(t, name) {
  const header = await t.rectOfText(name, { within: LEFT_PANEL });
  if (!header) throw new Error('group header not found: ' + name);
  await t.clickRect(header, { settle: 700 });
  return header;
}

/* Drag the demo picture onto the canvas, the way a user drops a file. */
async function loadDemo(t, opts) {
  const o = opts || {};
  await t.step(o.step || '② 载入原图');
  await t.say(o.say || '把图片拖进画板即可载入。', o.sub || '支持 PNG / JPG，右上角会显示原图分辨率');
  await t.wait(800);
  await t.loadImage(o.url || DEMO_SCENE, o.name || 'demo-scene.png');
  await t.waitFor(STAGE_PROBE, { timeout: 20000 });
  await t.wait(1100);
}

/* Map normalised image coordinates (0..1) onto the picture as displayed. */
async function canvasMapper(t) {
  const box = await t.js(STAGE_PROBE);
  if (!box) throw new Error('nothing on the stage to map');
  return {
    box,
    at: (u, v) => ({ x: box.x + u * box.w, y: box.y + v * box.h })
  };
}

/* A brush stroke described in normalised image space. */
function stroke(map, pts, opts) {
  const o = opts || {};
  const out = [];
  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = map.at(pts[i][0], pts[i][1]);
    const b = map.at(pts[i + 1][0], pts[i + 1][1]);
    const steps = o.steps || 14;
    for (let s = 0; s <= steps; s += 1) {
      out.push({ x: a.x + (b.x - a.x) * (s / steps), y: a.y + (b.y - a.y) * (s / steps) });
    }
  }
  return out;
}

/* Type into the 编辑要求 / prompt field currently on screen. */
async function fillPrompt(t, text, opts) {
  const o = opts || {};
  const sel = o.selector || 'input[type=text]';
  const rect = await t.js([
    '(function(){',
    '  const el=[...document.querySelectorAll(' + JSON.stringify(sel) + ')]',
    '    .filter(e=>{const r=e.getBoundingClientRect();return r.width>120&&r.height>8});',
    '  const pick=' + (o.placeholder ? 'el.find(e=>(e.placeholder||"").indexOf(' + JSON.stringify(o.placeholder) + ')>=0)||el[0]' : 'el[0]') + ';',
    '  if(!pick) return null;',
    '  const r=pick.getBoundingClientRect();',
    '  return {x:r.x,y:r.y,w:r.width,h:r.height,cx:r.x+r.width/2,cy:r.y+r.height/2};',
    '})()'
  ].join('\n'));
  if (!rect) throw new Error('prompt field not found');
  await t.clickRect(rect, { settle: 320, keepSpot: true });
  await t.type(text, { perCharMs: o.perCharMs == null ? 62 : o.perCharMs });
  await t.spot(null);
  return rect;
}

/* Wait out a real ComfyUI run, with the video sped up while it works.
 *
 * Every progress modal in this runtime prints an elapsed clock ("已用时 00:13"),
 * and every busy tool button ends in "…中". Matching the individual wordings
 * ("处理中" / "正在执行万物迁移...") is a trap: they differ per tool. */
const BUSY_PROBE = [
  '(function(){',
  '  const text = document.body.innerText || "";',
  '  if (/已用时/.test(text)) return true;',
  '  return [...document.querySelectorAll("button")].some(function(b){',
  '    return /中(\\u2026|\\.\\.\\.)$/.test((b.textContent || "").trim());',
  '  });',
  '})()'
].join('');

async function waitForRun(t, opts) {
  const o = opts || {};
  const busy = BUSY_PROBE;
  await t.waitFor(busy, { timeout: o.startTimeout || 12000, optional: true });
  await t.say(o.say || '正在调用本地模型出图…', o.sub || '真实生成过程，视频里已加速');
  await t.ffStart('generate');
  const started = Date.now();
  const limit = o.timeout || 300000;
  while (Date.now() - started < limit) {
    const stillBusy = await t.js('(function(){try{return ' + busy + '}catch(e){return false}})()');
    if (!stillBusy) break;
    await t.wait(1500);
  }
  await t.ffEnd(o.target == null ? 5 : o.target);
  await t.wait(700);
  return Date.now() - started;
}

/* Modal dialogs all share one backdrop id and are told apart by aria-label. */
const dialogSel = (label) => '[role="dialog"][aria-label="' + label + '"]';

async function waitDialog(t, label, opts) {
  await t.waitFor('!!document.querySelector(' + JSON.stringify(dialogSel(label)) + ')', opts || { timeout: 15000 });
  return t.rect(dialogSel(label));
}

/* Some tools refuse to start until a layer is selected. Switching to 图层 view
   materialises the source as one, and the first row is it. */
async function selectSourceLayer(t) {
  const tab = await t.rectOfText('图层', { within: { x0: 340, x1: 1100, y0: 40, y1: 120 } });
  if (tab) await t.clickRect(tab, { settle: 1200 });
  await t.wait(500);
  const row = await t.rectOfText('原图', { contains: true, within: { x0: 1100, y0: 140 } });
  if (row) await t.clickRect(row, { settle: 900 });
  return row;
}

/* Type into a numeric field of the currently open dialog. */
async function setDialogNumber(t, label, index, value) {
  const rect = await t.js([
    '(function(){',
    '  const d=document.querySelector(' + JSON.stringify(dialogSel(label)) + ');',
    '  if(!d) return null;',
    '  const el=[...d.querySelectorAll("input")][' + index + '];',
    '  if(!el) return null;',
    '  const r=el.getBoundingClientRect();',
    '  return {x:r.x,y:r.y,w:r.width,h:r.height,cx:r.x+r.width/2,cy:r.y+r.height/2};',
    '})()'
  ].join('\n'));
  if (!rect) throw new Error('dialog field ' + index + ' not found in ' + label);
  await t.clickRect(rect, { settle: 260, keepSpot: true });
  await t.js('(function(){const d=document.querySelector(' + JSON.stringify(dialogSel(label)) + ');'
    + 'const el=[...d.querySelectorAll("input")][' + index + '];el.select&&el.select();})()');
  await t.type(String(value), { perCharMs: 90 });
  await t.spot(null);
  return rect;
}

/* Click a tool button by its action id, and read back the label it now shows. */
async function clickAction(t, action, opts) {
  return t.clickSel(actionSel(action), opts);
}

async function actionLabel(t, action) {
  return t.js('(function(){const b=document.querySelector(' + JSON.stringify(actionSel(action)) + ');return b?b.textContent.trim():null})()');
}

/* Wait until a tool button settles on an expected label, e.g. 执行抠图. */
async function waitLabel(t, action, label, opts) {
  const expr = '(function(){const b=document.querySelector(' + JSON.stringify(actionSel(action)) + ');'
    + 'return !!b && b.textContent.trim().indexOf(' + JSON.stringify(label) + ')>=0})()';
  return t.waitFor(expr, opts || { timeout: 12000 });
}

module.exports = {
  LEFT_PANEL,
  DEMO_SCENE,
  DEMO_OBJECT,
  ACTION_ATTR,
  actionSel,
  STAGE_PROBE,
  BUSY_PROBE,
  enterArtDraw,
  openGroup,
  loadDemo,
  canvasMapper,
  stroke,
  fillPrompt,
  waitForRun,
  clickAction,
  actionLabel,
  waitLabel,
  dialogSel,
  waitDialog,
  selectSourceLayer,
  setDialogNumber
};
