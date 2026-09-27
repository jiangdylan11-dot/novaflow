// Cards and 原图 across several source pictures in the 美工 split runtime. The real functions run in a
// vm against stubs. The user's case (2026-09-27): a.png (1016x1018) grew by 无限扩图 into a_outpaint
// (1504x1024); its card moved onto the new picture while its 原图 layer kept a.png's id. Clicking a.png
// again and starting 去除物体 adopted that card and drew its 1504-wide composite squeezed into a.png's
// frame (aspect 0.68). A card edited while another 原图 was on screen (a layer eye after clicking
// another tile) had the same squeeze when it was shown again.
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { checkEqual, section, finish } from '../helpers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const source = await readFile(join(ROOT, 'novaflow-web/renderer/spine-split-runtime.js'), 'utf8');
const fn = (head) => {
  const match = source.match(new RegExp(`^  ${head}\\([\\s\\S]*?^  \\}\\r?$`, 'm'));
  if (!match) throw new Error(`not found: ${head}`);
  return match[0];
};
const REAL = [
  'function splitSetById', 'function activeSplitSet', 'function sourceToolSplitSetForCurrentResource',
  'function adoptSplitSetForParts', 'function sourceEditableLayerForCurrentResource',
  'function sourceEditableLayerTargetForCurrentResource', 'async function ensureSourceAsEditableLayer',
  'function prepareSourceOriginSplitSet', 'async function addManualPart', 'function registerSplitSet',
  'function splitPreviewPixelSize', 'function splitPreviewDrawnForOtherFrame', 'async function refreshSplitPreview',
  'function toggleSplitSet', 'function selectSplitPart', 'function shiftPartForCanvasResize',
  'async function commitImageOutpaintResult', 'function pruneEmptySplitSets', 'function activateSetAfterLayerMove'
];

// A PNG data URL whose header carries the size; '#…' after it names the picture and layers drawn.
const png = (width, height, label) => {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'latin1');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return `data:image/png;base64,${bytes.toString('base64')}#${label}`;
};
const label = (url) => String(url || '').split('#')[1] || String(url || '');
const SIZES = { A: [1016, 1018], B: [715, 911], A2: [1504, 1024], J: [626, 1360] };

// Sources A (a.png), B (3.png); the outpaint adds A2.
const world = () => {
  const cards = {
    a: { id: 'a', originKind: 'source-tool', sourceResourceId: 'A', previewDataUrl: png(1016, 1018, 'A:src'),
      parts: [{ id: 'src', name: '原图', dataUrl: 'data:a', autoSourceLayer: true, sourceResourceId: 'A', x: 0, y: 0 }] },
    b: { id: 'b', originKind: 'source-tool', sourceResourceId: 'B', previewDataUrl: png(715, 911, 'B:leg'),
      parts: [{ id: 'leg', name: 'leg', dataUrl: 'data:leg', x: 0, y: 0 }] }
  };
  const resources = [{ id: 'A', fileName: 'a.png' }, { id: 'B', fileName: '3.png' }];
  const ctx = {
    Math, Date, String, Number, Error, JSON, atob,
    log: [],
    SPLIT_SET_SOURCE_ORIGIN: 'source-tool',
    state: {
      activeSourceResourceId: 'A', activeSplitSetId: 'a', source: { id: 'A', dataUrl: 'data:a', fileName: 'a.png' },
      sourceSize: { width: 1016, height: 1018 }, splitSets: Object.values(cards), parts: cards.a.parts.map((p) => ({ ...p })),
      splitPreviewDataUrl: cards.a.previewDataUrl, splitPreviewStale: false, activePartId: '', selectedPartIds: [], viewMode: 'source',
      busy: false, splitRunCounter: 0, layerScrollTop: 0
    },
    sourceResourceList: () => resources,
    activateSourceResource: (id) => {
      const r = resources.find((item) => item.id === id);
      if (!r) return false;
      ctx.state.activeSourceResourceId = id;
      ctx.state.source = { id, dataUrl: `data:${id}`, fileName: r.fileName };
      ctx.state.sourceSize = { width: SIZES[id][0], height: SIZES[id][1] };
      ctx.state.viewMode = 'source';
      ctx.log.push(`activate ${id}`);
      return true;
    },
    previewDataUrl: async () => png(ctx.state.sourceSize.width, ctx.state.sourceSize.height, `${ctx.state.activeSourceResourceId}:${ctx.state.parts.map((p) => p.id).join('+')}`),
    syncActiveSplitSet: () => {
      const active = ctx.state.splitSets.find((set) => set.id === ctx.state.activeSplitSetId) || ctx.state.splitSets[ctx.state.splitSets.length - 1];
      if (!active) return;
      active.parts = ctx.state.parts.map((p) => ({ ...p }));
      active.previewDataUrlStale = !!ctx.state.splitPreviewStale;
      if (!ctx.state.splitPreviewStale) active.previewDataUrl = ctx.state.splitPreviewDataUrl;
    },
    scheduleSplitPreviewRefresh: () => { ctx.log.push('schedule refresh') },
    nextSplitSetName: (base) => `${base} 1`,
    normalizeLayerRecord: (p) => ({ ...p }), normalizeSpineLayerOrder: (parts) => parts, normalizeSelection() {},
    isSourceTargetSelected: () => ctx.state.viewMode === 'source', currentEditableLayerPart: () => null,
    uniqueManualPartId: (base) => `${base}_new`, presetFor: () => ({}), sourceOffsetSync: () => ({ x: 0, y: 0 }),
    cropEditorLayer: async (dataUrl) => ({ dataUrl, x: 0, y: 0, width: 1016, height: 1018 }),
    isSplitEditToolActive: () => false, isMaskStencilActive: () => false, resetMaskStencil() {}, resetMaskEditor() {},
    isMountedCardVisible: () => false, patchCurrentSplitSetExpansionInRightPanel: () => false,
    imageOutpaintStateSnapshot: () => null, restoreImageOutpaintStateSnapshot() {},
    addSourceDataUrlResource: async () => { resources.push({ id: 'A2', fileName: 'a_outpaint.png' }); ctx.activateSourceResource('A2'); return true },
    cacheTempSplitPackage: async () => {}, resetSelectionTool() {}, resetPenTool() {}, resetSplitCanvasViewport() {},
    setMessage() {}, render() {}, updatePreviewOverlay() {}, syncSplitWorkspace() {}
  };
  runInContext(REAL.map(fn).join('\n'), Object.assign(createContext(ctx), ctx));
  return { ctx, cards, resources };
};
const outpaintA = (ctx) => runInContext('commitImageOutpaintResult("a_outpaint.png", "data:x", { left: 244, top: 3, right: 244, bottom: 3 }, { width: 1504, height: 1024 })', ctx);
const openCard = (ctx, cards, id) => { ctx.state.activeSplitSetId = id; ctx.state.parts = cards[id].parts.map((p) => ({ ...p })); ctx.state.splitPreviewDataUrl = cards[id].previewDataUrl };
const removal = (ctx) => runInContext("ensureSourceAsEditableLayer('AI修图')", ctx);
// A layer edit on the open card while 3.png is on screen: the composite is rebuilt in 3.png's frame.
const editWhileOnB = async (ctx) => { ctx.activateSourceResource('B'); await runInContext('(async () => { await refreshSplitPreview(); syncActiveSplitSet() })()', ctx) };
const cardFor = (ctx, sourceId) => ctx.state.splitSets.filter((set) => set.sourceResourceId === sourceId);

section('the composite size is read from the PNG header');
{
  const { ctx } = world();
  checkEqual('1016x1018', JSON.parse(JSON.stringify(runInContext(`splitPreviewPixelSize(${JSON.stringify(png(1016, 1018, 'x'))})`, ctx))), { width: 1016, height: 1018 });
  checkEqual('not a PNG: unknown', runInContext("splitPreviewPixelSize('data:image/webp;base64,AAAA')", ctx), null);
  checkEqual('a composite of this picture\'s size is fine', runInContext('splitPreviewDrawnForOtherFrame()', ctx), false);
  ctx.state.splitPreviewDataUrl = png(715, 911, 'B:src');
  checkEqual('one of another picture\'s size is not', runInContext('splitPreviewDrawnForOtherFrame()', ctx), true);
}

section('去除物体 on the old 原图 after 无限扩图 gets a card of its own');
for (const [name, expanded] of [['3.png\'s card open', 'b'], ['the moved card still open', 'a']]) {
  const { ctx, cards } = world();
  await outpaintA(ctx);
  checkEqual(`${name}: the card moved onto the outpainted picture, its 原图 layer still names a.png`, [cards.a.sourceResourceId, cards.a.parts[0].sourceResourceId, cards.a.parts[0].x], ['A2', 'A', 244]);
  const moved = JSON.stringify({ ...cards.a, expanded: undefined });
  ctx.activateSourceResource('B');
  openCard(ctx, cards, expanded);
  ctx.activateSourceResource('A');
  await removal(ctx);
  const own = cardFor(ctx, 'A');
  checkEqual(`${name}: a.png gets a new card holding a fresh 原图 layer`, own.map((set) => set.parts.map((p) => [p.id, p.sourceResourceId])), [[['source_layer_new', 'A']]]);
  checkEqual(`${name}: its composite is drawn in a.png's own frame from that layer`, [label(own[0] && own[0].previewDataUrl), label(ctx.state.splitPreviewDataUrl)], ['A:source_layer_new', 'A:source_layer_new']);
  checkEqual(`${name}: the moved card is left as it was (only collapsed)`, JSON.stringify({ ...cards.a, expanded: undefined }), moved);
  checkEqual(`${name}: 3.png's card is untouched`, [label(cards.b.previewDataUrl), !!cards.b.previewDataUrlStale], ['B:leg', false]);
}

section('the lookups still find the right cards');
{
  const { ctx, cards } = world();
  checkEqual('a.png active: its own card and 原图 layer', runInContext('sourceEditableLayerTargetForCurrentResource().part.id', ctx), 'src');
  openCard(ctx, cards, 'b');
  checkEqual('another card expanded: a.png still finds its own card', runInContext('sourceEditableLayerTargetForCurrentResource().set.id', ctx), 'a');
  cards.a.originKind = undefined;
  cards.a.sourceResourceId = undefined;
  checkEqual('a card from before multiple sources (no origin, no 原图 id) is still adopted by the 原图 layer it holds', runInContext('sourceToolSplitSetForCurrentResource().id', ctx), 'a');
  cards.a.sourceResourceId = 'A2';
  checkEqual('a legacy card that names another picture is not', runInContext('sourceToolSplitSetForCurrentResource()', ctx), null);
}

section('a card shown again after another 原图 was on screen is redrawn in its own frame');
{
  const { ctx, cards } = world();
  await editWhileOnB(ctx);
  checkEqual('the edit drew card a in 3.png\'s frame', label(cards.a.previewDataUrl), 'B:src');
  ctx.activateSourceResource('A');
  await removal(ctx);
  checkEqual('clicking a.png and starting 去除物体 redraws it in a.png\'s frame first', [label(ctx.state.splitPreviewDataUrl), label(cards.a.previewDataUrl)], ['A:src', 'A:src']);
  const same = world();
  same.ctx.log.length = 0;
  await removal(same.ctx);
  checkEqual('a composite already in the right frame is not rebuilt on tool entry', [label(same.ctx.state.splitPreviewDataUrl), same.ctx.log], ['A:src', []]);
  const adopt = world();
  await editWhileOnB(adopt.ctx);
  openCard(adopt.ctx, adopt.cards, 'b');
  adopt.ctx.activateSourceResource('A');
  await removal(adopt.ctx);
  checkEqual('the same when 去除物体 has to adopt the card', [adopt.ctx.state.activeSplitSetId, label(adopt.ctx.state.splitPreviewDataUrl)], ['a', 'A:src']);
  const back = world();
  await editWhileOnB(back.ctx);
  back.ctx.log.length = 0;
  runInContext("toggleSplitSet('a')", back.ctx);
  checkEqual('opening the card switches to its 原图 and schedules a redraw', back.ctx.log, ['activate A', 'schedule refresh']);
  const fine = world();
  fine.ctx.activateSourceResource('B');
  fine.ctx.log.length = 0;
  runInContext("toggleSplitSet('a')", fine.ctx);
  checkEqual('a card whose composite is fine is not redrawn', fine.ctx.log, ['activate A']);
  const orphan = world();
  await editWhileOnB(orphan.ctx);
  orphan.resources.splice(0, 1);  // a.png deleted: its card has no frame of its own any more
  orphan.ctx.log.length = 0;
  runInContext("toggleSplitSet('a')", orphan.ctx);
  checkEqual('a card whose 原图 was deleted is not redrawn in the picture on screen', orphan.ctx.log, []);
}

section('back from the 原图 view into the layer view, the composite is redrawn');
{
  const { ctx } = world();
  await editWhileOnB(ctx);
  ctx.activateSourceResource('A');
  ctx.log.length = 0;
  runInContext("selectSplitPart('', 'parts')", ctx);
  checkEqual('the 图层 button from a.png\'s 原图 view schedules a redraw', ctx.log, ['schedule refresh']);
  const fine = world();
  fine.ctx.log.length = 0;
  runInContext("selectSplitPart('', 'parts')", fine.ctx);
  checkEqual('not when the composite is already in this frame', fine.ctx.log, []);
  const layerRow = fn('function setLayerSelection');
  checkEqual('a layer row does the same', /else if \(ownerSet && ownerSet\.id === state\.activeSplitSetId && splitPreviewDrawnForOtherFrame\(\)\) \{[\s\S]*?scheduleSplitPreviewRefresh/.test(layerRow), true);
}

section('蒙版编辑 cancelled after it opened this picture\'s own card returns to that card');
{
  const start = fn('async function startMaskEditor');
  // Only when another card was open before: with none, cancelling empties and drops the new card.
  checkEqual('the restore point is retaken once the 原图 layer\'s card is open, if another card was open before',
    /const setBefore = state\.activeSplitSetId\s+part = await ensureSourceAsEditableLayer\('蒙版编辑'\)[\s\S]*?if \(setBefore && state\.activeSplitSetId !== setBefore\) entrySnapshot = splitLayerHistorySnapshot\(/.test(start), true);
}

section('a new card for a second picture is drawn from its own layers');
{
  // 拆图 on 3.png while a.png's card is still the open one: the new layers are in state.parts.
  const { ctx } = world();
  ctx.activateSourceResource('B');
  ctx.state.parts = [{ id: 'arm' }, { id: 'body' }];
  await runInContext('refreshSplitPreview()', ctx);
  checkEqual('refreshSplitPreview draws the layers it is given in the picture on screen', label(ctx.state.splitPreviewDataUrl), 'B:arm+body');
}

section('deleting the last layer of a card never opens another picture\'s card');
{
  // The user's case: jimeng (J) on screen, its only card emptied by deleting its 原图 layer, a.png's
  // card last in the list. The last card used to open in jimeng's frame (a.png squeezed to 0.46).
  const setup = (extra = []) => {
    const w = world();
    w.resources.push({ id: 'J', fileName: 'jimeng.png' });
    w.ctx.state.splitSets.push({ id: 'j', originKind: 'source-tool', sourceResourceId: 'J', parts: [], previewDataUrl: '' }, ...extra);
    w.ctx.activateSourceResource('J');
    w.ctx.state.activeSplitSetId = 'j';
    w.ctx.state.parts = [];
    w.ctx.state.viewMode = 'parts';
    return w;
  };
  const alone = setup();
  runInContext("pruneEmptySplitSets('j')", alone.ctx);
  const expanded = (w) => w.ctx.state.splitSets.filter((set) => set.expanded).map((set) => set.id);
  checkEqual('no other card of jimeng: the last card stays current but closed, jimeng\'s 原图 shows',
    [alone.ctx.state.activeSplitSetId, expanded(alone), alone.ctx.state.viewMode, alone.ctx.state.activeSourceResourceId], ['b', [], 'source', 'J']);
  checkEqual('with none of its hidden layers selected (a Delete key cannot reach them)', [alone.ctx.state.activePartId, alone.ctx.state.selectedPartIds], ['', []]);
  // There is always a current card while cards exist: syncActiveSplitSet writes state.parts into it.
  runInContext('syncActiveSplitSet()', alone.ctx);
  checkEqual('and the current card keeps its own layers (nothing is emptied)', [alone.cards.a.parts.map((p) => p.id), alone.cards.b.parts.map((p) => p.id)], [['src'], ['leg']]);
  const sibling = setup([{ id: 'j2', originKind: 'split', sourceResourceId: 'J', parts: [{ id: 'arm' }], previewDataUrl: png(626, 1360, 'J:arm') }]);
  sibling.ctx.log.length = 0;
  runInContext("pruneEmptySplitSets('j')", sibling.ctx);
  checkEqual('another card of jimeng: that one opens', [sibling.ctx.state.activeSplitSetId, expanded(sibling), sibling.ctx.state.parts.map((p) => p.id), sibling.ctx.log], ['j2', ['j2'], ['arm'], []]);
  const stale = setup([{ id: 'j2', originKind: 'split', sourceResourceId: 'J', parts: [{ id: 'arm' }], previewDataUrl: png(1016, 1018, 'A:arm') }]);
  stale.ctx.log.length = 0;
  runInContext("pruneEmptySplitSets('j')", stale.ctx);
  checkEqual('its composite drawn while a.png was on screen is redrawn', stale.ctx.log, ['schedule refresh']);
  const legacy = setup([{ id: 'old', parts: [{ id: 'o1' }], previewDataUrl: '' }]);
  runInContext("pruneEmptySplitSets('j')", legacy.ctx);
  checkEqual('a card from before multiple sources still counts as this picture\'s', legacy.ctx.state.activeSplitSetId, 'old');
}

section('a layer moved into another picture\'s card opens that picture');
{
  // 3.png's card open with 3.png on screen; a layer moved into a.png's card.
  const { ctx, cards } = world();
  ctx.activateSourceResource('B');
  openCard(ctx, cards, 'b');
  cards.a.previewDataUrl = png(715, 911, 'B:src');   // rebuilt before the switch, in 3.png's frame
  ctx.log.length = 0;
  runInContext("activateSetAfterLayerMove(splitSetById('a'), 'src')", ctx);
  checkEqual('switches to a.png and redraws the card there', [ctx.log, ctx.state.activeSplitSetId, ctx.state.viewMode], [['activate A', 'schedule refresh'], 'a', 'parts']);
  const same = world();
  same.ctx.log.length = 0;
  runInContext("activateSetAfterLayerMove(splitSetById('a'), 'src')", same.ctx);
  checkEqual('a card of the picture on screen: nothing to switch or redraw', [same.ctx.log, same.ctx.state.viewMode], [[], 'parts']);
  // a.png's card still open after clicking 3.png's tile, rows reordered inside it: callers may only
  // patch the rows, so the picture is not switched and 3.png's 原图 stays on screen.
  const reorder = world();
  reorder.ctx.activateSourceResource('B');
  reorder.ctx.log.length = 0;
  runInContext("activateSetAfterLayerMove(splitSetById('a'), 'src')", reorder.ctx);
  checkEqual('reordering inside the open card of another picture keeps this picture\'s 原图 view', [reorder.ctx.log, reorder.ctx.state.activeSourceResourceId, reorder.ctx.state.viewMode], [[], 'B', 'source']);
  // a.png deleted: its cards have no picture to switch to, so they behave as before.
  const orphan = world();
  orphan.ctx.activateSourceResource('B');
  openCard(orphan.ctx, orphan.cards, 'b');
  orphan.resources.splice(0, 1);
  orphan.ctx.log.length = 0;
  runInContext("activateSetAfterLayerMove(splitSetById('a'), 'src')", orphan.ctx);
  checkEqual('a card whose 原图 was deleted opens as before, without a switch', [orphan.ctx.log, orphan.ctx.state.activeSplitSetId, orphan.ctx.state.viewMode], [[], 'a', 'parts']);
  const orphanReorder = world();
  orphanReorder.ctx.activateSourceResource('B');
  orphanReorder.resources.splice(0, 1);
  runInContext("activateSetAfterLayerMove(splitSetById('a'), 'src')", orphanReorder.ctx);
  checkEqual('and reordering inside it keeps the layer view', orphanReorder.ctx.state.viewMode, 'parts');
}

finish('web-split-source-cards');
