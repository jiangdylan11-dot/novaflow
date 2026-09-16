const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");

// The particle template library used to run one requestAnimationFrame loop per card, each stepping and
// redrawing its particle systems on an up-to-1024px offscreen canvas every frame, and every card hover
// re-rendered the whole editor through the app-level hoverDeleteTarget state. These contracts pin the
// shared budgeted scheduler and the library-local hover state that replaced that.
const repoRoot = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8").replace(/\r\n?/g, "\n");

const BUNDLE_CACHE_VERSION = "20260916-template-preview-2";
const STEP = 1 / 60;

test("template previews share one budgeted scheduler instead of a rAF loop per card", () => {
  const bundle = read("particle-editor/assets/index-BbIa-2NM.js");
  const patch = read("scripts/patch-ai-seq-cutout-edit.mjs");
  assert.match(patch, /import \{ patchTemplatePreviewPerf \} from '\.\/patch-template-preview-perf\.mjs';/);
  assert.match(patch, /source = patchTemplatePreviewPerf\(source\);/);
  assert.equal((bundle.match(/var nfTplPreviewSched=\(\(\)=>\{/g) || []).length, 1);
  // One rAF for every card: at most 2 fixed 1/60 steps per frame with no accumulated debt, an 8ms draw
  // budget shared round-robin, and each card redrawn at most 24 times per second.
  assert.match(bundle, /STEP=1\/60,MAX_STEPS=2,BUDGET_MS=8,DRAW_INTERVAL_MS=1e3\/24/);
  assert.match(bundle, /entry\.acc>STEP&&\(entry\.acc=STEP\)/);
  // The budget covers the draw pass only (measured after the lazy init and the step phase) and never
  // skips the first eligible card: with the bundled templates the stepping alone exceeded 8ms, and v1
  // (deadline taken at the top of the frame) left every card blank.
  assert.doesNotMatch(bundle, /if\(!list\.length\)return;let deadline=/);
  assert.match(bundle, /entry\.acc>STEP&&\(entry\.acc=STEP\)\}let deadline=performance\.now\(\)\+BUDGET_MS,count=list\.length,start=cursor%count,drawn=0;/);
  assert.match(bundle, /if\(drawn>0&&performance\.now\(\)>deadline\)\{cursor=index;break\}entry\.draw\(\),entry\.lastDraw=now,drawn\+\+/);
  // Cards initialize lazily (one per frame, once visible) and pause while scrolled out of view.
  assert.match(bundle, /for\(let entry of list\)if\(!entry\.ready&&entry\.visible\)\{entry\.init\(\);break\}/);
  assert.match(bundle, /observer=new IntersectionObserver\(records=>\{for\(let record of records\)entry\.visible=!!record\.isIntersecting\}\);observer\.observe\(canvas\)/);
  assert.match(bundle, /return nfTplPreviewSched\.add\(entry\),\(\)=>\{observer&&observer\.disconnect\(\),nfTplPreviewSched\.remove\(entry\);for\(let engine of engines\)engine\.stop\(\)/);
  // The offscreen canvas is capped at 384px; a context scale keeps the particle world size for the engine.
  assert.match(bundle, /scale=Math\.min\(1,384\/world\),offscreen=document\.createElement\(`canvas`\);offscreen\.width=offscreen\.height=Math\.max\(1,Math\.round\(world\*scale\)\)/);
  assert.match(bundle, /octx\.setTransform\(scale,0,0,scale,0,0\)/);
  assert.match(bundle, /engine\.width=world,engine\.height=world,engine\.reset\(local,\{draw:!1\}\)/);
  // The per-card loop is gone.
  assert.doesNotMatch(bundle, /for\(let e=0;e<30;e\+\+\)for\(let e of o\.current\)e\.step\(1\/60\)/);
  assert.doesNotMatch(bundle, /u\.current=requestAnimationFrame\(S\)/);
  // The card still renders the same canvas element.
  assert.match(bundle, /\(0,X\.jsx\)\(`canvas`,\{ref:i,width:n,height:r,style:\{width:`100%`,height:`100%`,display:`block`,borderRadius:6,background:`#151515`\}\}\)\}/);
});

test("template card hover stays inside the library and Delete still removes the hovered card", () => {
  const bundle = read("particle-editor/assets/index-BbIa-2NM.js");
  assert.equal((bundle.match(/;var nfTemplateHoverId=null,nfTplUseHover=\(enabled,open\)=>\{let\[hover,setHover\]=\(0,_\.useState\)\(null\);return\(0,_\.useEffect\)\(\(\)=>\{if\(!enabled\|\|!open\)nfTemplateHoverId=null,setHover\(null\)\},\[enabled,open\]\),\(0,_\.useEffect\)\(\(\)=>\(\)=>\{nfTemplateHoverId=null\},\[\]\),\[hover,setHover\]\};function Wa\(e\)\{/g) || []).length, 1);
  // `Wa` shadows the React namespace `_` with its saveTemplate prop, so the hooks must not be called through `_` inside it.
  assert.doesNotMatch(bundle, /saveTemplateGroup:v\}=e,\[nfTplHover,nfSetTplHover\]=\(0,_\.useState\)/);
  assert.match(bundle, /saveTemplateGroup:v\}=e,\[nfTplHover,nfSetTplHover\]=nfTplUseHover\(t,r\);return t\?/);
  assert.match(bundle, /className:nfTplHover===String\(e\.id\|\|``\)\?`nf-delete-hover`:void 0,onMouseEnter:\(\)=>\{let t=String\(e\.id\|\|``\);nfTemplateHoverId=t,nfSetTplHover\(t\)\},onMouseLeave:\(\)=>\{let t=String\(e\.id\|\|``\);nfTemplateHoverId===t&&\(nfTemplateHoverId=null\),nfSetTplHover\(e=>e===t\?null:e\)\}/);
  assert.doesNotMatch(bundle, /onMouseEnter:\(\)=>d\(\{kind:`template`/);
  assert.match(bundle, /let s=m\.current;if\(!s\?\.id&&nfTemplateHoverId\)\{let t=nfTemplateHoverId;e\.preventDefault\(\),r\(e=>e\.filter\(e=>String\(e\?\.id\|\|``\)!==t\)\),nfTemplateHoverId=null;return\}if\(s\?\.id\)\{/);
});

test("template preview scheduler paces steps, budgets draws round-robin and pauses hidden cards", () => {
  const bundle = read("particle-editor/assets/index-BbIa-2NM.js");
  const iife = bundle.match(/var nfTplPreviewSched=(\(\(\)=>\{[\s\S]*?\}\)\(\)),Ua=\(\{system:e/)?.[1];
  assert.ok(iife, "scheduler IIFE must be extractable");

  let rafCallback = null;
  let nowMs = 0;
  const sandbox = {
    requestAnimationFrame: (callback) => { rafCallback = callback; return 1; },
    cancelAnimationFrame: () => { rafCallback = null; },
    performance: { now: () => nowMs },
    document: { hidden: false },
  };
  const scheduler = vm.runInNewContext(`(${iife})`, sandbox);
  const tick = (timestamp) => {
    const callback = rafCallback;
    assert.ok(callback, "scheduler must keep a frame scheduled while entries exist");
    rafCallback = null;
    nowMs = timestamp;
    callback(timestamp);
  };
  const makeEntry = (drawCostMs) => {
    const entry = { visible: true, ready: false, acc: 0, lastDraw: 0, inits: 0, steps: 0, draws: 0 };
    entry.init = () => { entry.inits += 1; entry.ready = true; };
    entry.step = (dt) => { assert.equal(dt, STEP); entry.steps += 1; };
    entry.draw = () => { entry.draws += 1; nowMs += drawCostMs; };
    return entry;
  };

  // Lazy init: one card per frame, and no frame is scheduled without entries.
  assert.equal(rafCallback, null);
  const cards = [makeEntry(5), makeEntry(5), makeEntry(5), makeEntry(5)];
  for (const card of cards) scheduler.add(card);
  tick(1000);
  assert.deepEqual(cards.map((card) => card.inits), [1, 0, 0, 0]);
  tick(1000 + 1000 / 60);
  tick(1000 + 2000 / 60);
  tick(1000 + 3000 / 60);
  assert.deepEqual(cards.map((card) => card.inits), [1, 1, 1, 1]);

  // Draw budget: 5ms cards on an 8ms budget → two draws per frame, the cursor rotates so every card
  // gets its turn (after three frames each card has drawn at least once and none is ahead by >1).
  for (const card of cards) { card.draws = 0; card.lastDraw = 0; }
  tick(2000);
  tick(2050);
  tick(2100);
  const draws = cards.map((card) => card.draws);
  assert.ok(draws.every((count) => count >= 1), `every card draws (${draws})`);
  assert.equal(Math.max(...draws) - Math.min(...draws), 1, `draws stay balanced (${draws})`);
  assert.equal(draws.reduce((sum, count) => sum + count, 0), 6);

  // Step pacing: a long gap yields at most 2 fixed steps and no carried-over debt.
  for (const card of cards) { card.steps = 0; card.acc = 0; }
  tick(2600);
  assert.ok(cards.every((card) => card.steps === 2), `two steps after a long gap (${cards.map((c) => c.steps)})`);
  assert.ok(cards.every((card) => card.acc <= STEP + 1e-9));
  for (const card of cards) card.steps = 0;
  tick(2600 + 1000 / 60);
  assert.ok(cards.every((card) => card.steps === 1), `one step per 60fps frame (${cards.map((c) => c.steps)})`);

  // Hidden cards neither step nor draw; visible again resumes.
  cards[1].visible = false;
  cards[1].steps = 0;
  cards[1].draws = 0;
  tick(2700);
  tick(2750);
  assert.equal(cards[1].steps, 0);
  assert.equal(cards[1].draws, 0);
  cards[1].visible = true;
  tick(2800);
  // The card did not accumulate debt while hidden: the 50ms gap since the last frame is capped at 2 steps.
  assert.equal(cards[1].steps, 2);
  tick(2800 + 1000 / 60);
  assert.equal(cards[1].steps, 3);

  // A hidden document keeps the frame alive but does no work.
  sandbox.document.hidden = true;
  for (const card of cards) { card.steps = 0; card.draws = 0; }
  tick(2900);
  assert.ok(cards.every((card) => card.steps === 0 && card.draws === 0));
  assert.ok(rafCallback);
  sandbox.document.hidden = false;

  // Removing the last entry cancels the frame; adding again restarts it.
  for (const card of cards) scheduler.remove(card);
  assert.equal(rafCallback, null);
  scheduler.add(cards[0]);
  assert.ok(rafCallback);
  scheduler.remove(cards[0]);
  assert.equal(rafCallback, null);
});

test("index.html cache-busts the bundle for the template preview fix", () => {
  const html = read("particle-editor/index.html");
  assert.ok(html.includes(`assets/index-BbIa-2NM.js?v=${BUNDLE_CACHE_VERSION}`), "bundle cache key must move with the template preview patch");
  const check = read("scripts/check-ai-seq-local-model-option.mjs");
  assert.ok(check.includes(`index-BbIa-2NM.js?v=${BUNDLE_CACHE_VERSION}`), "local model option check must pin the same bundle cache key");
});

test("heavy stepping or slow draws never starve the draw pass (2026-09-16 blank template library)", () => {
  const bundle = read("particle-editor/assets/index-BbIa-2NM.js");
  const iife = bundle.match(/var nfTplPreviewSched=(\(\(\)=>\{[\s\S]*?\}\)\(\)),Ua=\(\{system:e/)?.[1];
  assert.ok(iife, "scheduler IIFE must be extractable");
  let rafCallback = null;
  let nowMs = 0;
  const sandbox = {
    requestAnimationFrame: (callback) => { rafCallback = callback; return 1; },
    cancelAnimationFrame: () => { rafCallback = null; },
    performance: { now: () => nowMs },
    document: { hidden: false },
  };
  const scheduler = vm.runInNewContext(`(${iife})`, sandbox);
  const tick = (timestamp) => {
    const callback = rafCallback;
    assert.ok(callback, "scheduler must keep a frame scheduled while entries exist");
    rafCallback = null;
    nowMs = timestamp;
    callback(timestamp);
  };
  const makeEntry = (stepCostMs, drawCostMs) => {
    const entry = { visible: true, ready: true, acc: 0, lastDraw: 0, steps: 0, draws: 0 };
    entry.init = () => { entry.ready = true; };
    entry.step = () => { entry.steps += 1; nowMs += stepCostMs; };
    entry.draw = () => { entry.draws += 1; nowMs += drawCostMs; };
    return entry;
  };

  // 17 open templates whose stepping alone costs ~34ms per 50ms frame (2 fixed steps x 1ms each):
  // the deadline must be taken after the step phase, and the first eligible card must draw regardless.
  const cards = Array.from({ length: 17 }, () => makeEntry(1, 5));
  for (const card of cards) scheduler.add(card);
  tick(1000);
  for (let frame = 1; frame <= 40; frame++) tick(1000 + frame * 50);
  const draws = cards.map((card) => card.draws);
  assert.ok(cards.every((card) => card.steps >= 40), `cards keep stepping (${cards.map((card) => card.steps)})`);
  assert.ok(draws.every((count) => count >= 1), `every card is drawn even though stepping exceeds the budget (${draws})`);
  assert.ok(Math.max(...draws) - Math.min(...draws) <= 1, `draws rotate fairly (${draws})`);
  assert.ok(draws.reduce((sum, count) => sum + count, 0) <= 2 * 41, `the budget still caps the draw pass (${draws})`);

  // A card whose single draw exceeds the budget still redraws every frame.
  for (const card of cards) scheduler.remove(card);
  const slow = makeEntry(0, 30);
  scheduler.add(slow);
  tick(5000);
  tick(5050);
  tick(5100);
  assert.equal(slow.draws, 3);
  scheduler.remove(slow);
});
