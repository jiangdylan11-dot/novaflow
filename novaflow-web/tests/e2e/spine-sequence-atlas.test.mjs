import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import vm from 'node:vm';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import '../../renderer/spine-sequence-atlas.js';
const pack = globalThis.NovaFlowSequenceAtlas;
const frame = (w, h, x, y, color = [180, 90, 30, 128]) => {
  const pixels = new Uint8Array(w * h * 4);
  if (x >= 0) pixels.set(color, (y * w + x) * 4);
  return pixels;
};
function png(bytes) {
  const buffer = Buffer.from(bytes), width = buffer.readUInt32BE(16), height = buffer.readUInt32BE(20), chunks = [];
  assert.equal(buffer.subarray(1, 4).toString(), 'PNG');
  for (let i = 8; i < buffer.length;) {
    const size = buffer.readUInt32BE(i), name = buffer.subarray(i + 4, i + 8).toString();
    if (name === 'IDAT') chunks.push(buffer.subarray(i + 8, i + 8 + size));
    i += 12 + size;
  }
  const rows = inflateSync(Buffer.concat(chunks)), rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) { assert.equal(rows[y * (width * 4 + 1)], 0); rgba.set(rows.subarray(y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1)), y * width * 4); }
  return { width, height, rgba };
}
async function output(options, frames) {
  const files = new Map(), writer = pack.createWriter({ ...options, write: async (name, data) => files.set(name, data) });
  for (const f of frames) await writer.addRgba(...f);
  const result = await writer.finish(options.json);
  return { files, result, json: JSON.parse(files.get(`${result.baseName}.json`)) };
}
async function runtime(version, atlasText, files) {
  const context = vm.createContext({ console, navigator: { userAgent: 'node' } });
  vm.runInContext(await readFile(new URL(`../../renderer/vendor/spine/spine-webgl-${version}.js`, import.meta.url), 'utf8'), context);
  const spine = context.spine;
  const atlas = new spine.TextureAtlas(atlasText, path => { const image = png(files.get(path)); return new spine.FakeTexture(image); });
  return { spine, atlas };
}

test('default exports only named JSON and original rectangular images, including blank frames', async () => {
  const rgba = frame(17, 9, 3, 5);
  const { files, json } = await output({ baseName: '三角烟雾', version: '3.8', fps: 12 }, [[rgba, 17, 9], [frame(17, 9, -1), 17, 9]]);
  assert.deepEqual([...files.keys()], ['images/三角烟雾_0000.png', 'images/三角烟雾_0001.png', '三角烟雾.json']);
  assert.deepEqual(png(files.get('images/三角烟雾_0000.png')).rgba, rgba);
  assert.equal(json.skins[0].attachments.slot['三角烟雾_0000'].height, 9);
  assert.equal(json.skeleton.images, 'images/');
  assert.equal(json.animations.animation.slots.slot.attachment[1].time, 1 / 12);
});

test('trim offsets reconstruct every pixel and the official 3.8 runtime keeps world positions', async () => {
  const sources = [[frame(17, 9, 3, 5), 17, 9], [frame(17, 9, 12, 2, [50, 80, 100, 1]), 17, 9], [frame(17, 9, -1), 17, 9]];
  const { files, json } = await output({ baseName: 'smoke', version: '3.8', fps: 10, packed: true, settings: { maxWidth: 64, maxHeight: 64 } }, sources);
  assert.equal([...files.keys()].some(name => name.startsWith('images/')), false);
  const { spine, atlas } = await runtime('3.8', files.get('smoke.atlas'), files);
  for (let i = 0; i < sources.length; i++) {
    const region = atlas.findRegion(`smoke_000${i}`), page = png(files.get(region.page.name)), reconstructed = new Uint8Array(17 * 9 * 4);
    for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) {
      const target = ((9 - region.offsetY - region.height + y) * 17 + region.offsetX + x) * 4;
      reconstructed.set(page.rgba.subarray(((region.y + y) * page.width + region.x + x) * 4, ((region.y + y) * page.width + region.x + x) * 4 + 4), target);
    }
    assert.deepEqual(reconstructed, sources[i][0]);
  }
  const data = new spine.SkeletonJson(new spine.AtlasAttachmentLoader(atlas)).readSkeletonData(json), skeleton = new spine.Skeleton(data), state = new spine.AnimationState(new spine.AnimationStateData(data));
  state.setAnimation(0, 'animation', false); state.update(0.11); state.apply(skeleton); skeleton.updateWorldTransform();
  const attachment = skeleton.slots[0].getAttachment();
  assert.equal(attachment.name, 'smoke_0001'); assert.equal(attachment.width, 17); assert.equal(attachment.height, 9);
  assert.equal(attachment.region.offsetX, 12); assert.equal(attachment.region.offsetY, 6);
});

test('multiple pages never overlap, fit bounds and parse in official 4.0 runtime', async () => {
  const sources = Array.from({ length: 70 }, (_, i) => { const w = 9 + i % 18, h = 8 + i % 13; const rgba = new Uint8Array(w * h * 4).fill(255); return [rgba, w, h]; });
  const { files, result, json } = await output({ baseName: 'multi', version: '4.0', packed: true, settings: { maxWidth: 64, maxHeight: 64, trim: false } }, sources);
  assert(result.pages > 1);
  const { spine, atlas } = await runtime('4.0', files.get('multi.atlas'), files);
  assert.equal(atlas.regions.length, 70);
  for (let i = 0; i < atlas.regions.length; i++) {
    const a = atlas.regions[i]; assert(a.x >= 1 && a.y >= 1); assert(a.x + a.width < a.page.width); assert(a.y + a.height < a.page.height); assert(a.page.width <= 64 && a.page.height <= 64);
    for (const b of atlas.regions.slice(i + 1)) if (a.page === b.page) assert(a.x + a.width + 1 <= b.x - 1 || b.x + b.width + 1 <= a.x - 1 || a.y + a.height + 1 <= b.y - 1 || b.y + b.height + 1 <= a.y - 1);
  }
  const data = new spine.SkeletonJson(new spine.AtlasAttachmentLoader(atlas)).readSkeletonData(json);
  assert.equal(data.skins[0].getAttachments().length, 70);
});

test('PMA is encoded into bytes exactly once and declares the matching atlas flag', async () => {
  const { files } = await output({ baseName: 'pma', version: '4.2', packed: true, settings: { premultiplyAlpha: true } }, [[frame(1, 1, 0, 0), 1, 1]]);
  const rgba = png(files.get('pma.png')).rgba;
  assert.deepEqual([...rgba.subarray(0, 4)], [90, 45, 15, 128]);
  assert.match(files.get('pma.atlas'), /pma: true/);
});

test('native Sequence references and AI multi-board timings survive packing', async () => {
  for (const version of ['4.1', '4.2']) {
    const { json, files } = await output({ baseName: 'native', version, packed: true, loop: false }, [[frame(3, 7, 1, 2), 3, 7], [frame(3, 7, -1), 3, 7]]);
    assert.equal(json.skins[0].attachments.slot.native_seq.sequence.count, 2);
    assert.equal(json.animations.animation.attachments.default.slot.native_seq.sequence[0].mode, 'once');
    assert.match(files.get('native.atlas'), /native_0001/);
  }
  const original = { skeleton: { spine: '3.8.99' }, skins: { default: { a: { first: { path: 'board_1_0000', width: 100, height: 100 } } } }, animations: { custom: { slots: { a: { attachment: [{ time: 0.123, name: 'first' }] } } } } };
  const { json } = await output({ baseName: 'boards', version: '3.8', packed: true, json: original }, [[frame(5, 9, 1, 2), 5, 9, 'board_1_0000']]);
  assert.deepEqual(json.animations, original.animations); assert.equal(json.skins[0].attachments.a.first.height, 9); assert.equal(json.skeleton.images, './');
});

test('oversized frames, duplicates and failed disk writes cannot report success', async () => {
  const writer = pack.createWriter({ baseName: 'limit', packed: true, settings: { maxWidth: 64, maxHeight: 64, trim: false }, write: async () => {} });
  await assert.rejects(writer.addRgba(frame(64, 64, 0, 0), 64, 64), /超出图集尺寸/);
  await writer.addRgba(frame(3, 3, 0, 0), 3, 3, 'duplicate'); await assert.rejects(writer.addRgba(frame(3, 3, 0, 0), 3, 3, 'duplicate'), /重复/);
  const write = pack.createFileWriter({ api: { writeBinaryFile: async () => ({ ok: false, error: 'disk full' }) }, dir: 'D:/test' });
  await assert.rejects(write('test.json', '{}'), /disk full/); await assert.rejects(write('../test.png', new Uint8Array()), /路径无效/);
});

test('loaded particle action uses actual rendered frames; ordinary PNG stays separate', async () => {
  const html = await readFile(new URL('../../renderer/index.html', import.meta.url), 'utf8'), path = html.match(/src="\.\/(assets\/index-[^"]+\.js)\?/)[1], bundle = await readFile(new URL(`../../renderer/${path}`, import.meta.url), 'utf8');
  const start = bundle.indexOf('Ms=async(') + 3, end = bundle.indexOf('},Ns=async', start) + 1;
  for (const mode of ['packed', 'loose', 'plain']) {
    const saved = new Map(); let steps = 0;
    const context2d = { clearRect() {}, drawImage() {}, getImageData: (_, __, w, h) => ({ data: frame(w, h, steps % w, 2) }) };
    const context = vm.createContext({ window: { NovaFlowSequenceAtlas: pack, electronAPI: { writeBinaryFile: async p => { saved.set(`${p.dir}/${p.fileName}`, p.bytes); if (mode !== 'plain') assert.equal(p.spineSequenceNamed, true); return { ok: true }; } } }, document: { createElement: () => ({ getContext: () => context2d }) }, TextEncoder, Blob,
      Ds: async () => 'original-name', As: async () => [], fi: class { setSprites() {} reset() {} step() { steps++; } }, js: async () => new Blob(['ordinary']), console });
    const action = vm.runInContext(`(${bundle.slice(start, end)})`, context);
    await action({ activeConfig: { systemName: 'edited', loopAnimation: false }, seqFps: 10, seqDurationSec: 0.2, seqW: 17, seqH: 25, seqScalePct: 100, seqExportSpineProject: mode !== 'plain', seqSpineVer: '3.8', exportBaseName: '用户命名', atlasPack: mode === 'packed', makeExportBaseName: x => x, getSystemSpriteDataUrlsForExport: () => [], framesOutDir: 'out/images', spineOutDir: 'out' });
    assert.equal(steps, 2);
    if (mode === 'plain') { assert.equal(saved.size, 3); assert([...saved.keys()].every(path => path.includes('frames_original-name_'))); }
    else { const json = JSON.parse(new TextDecoder().decode(saved.get('out/用户命名.json'))); assert.equal(json.skeleton.height, 25); assert.equal(saved.has('out/用户命名.atlas'), mode === 'packed'); assert.equal(json.skins[0].attachments.slot['用户命名_0000'].width, 17); }
  }
  const ni = bundle.slice(bundle.indexOf('ni=async n=>'), bundle.indexOf('},ri=', bundle.indexOf('ni=async n=>')));
  assert.equal((ni.match(/await nfSequenceWriter.addCanvas\(U,/g) || []).length, 3); assert.match(ni, /k&&!n\?\.noSpine\?window.NovaFlowSequenceAtlas/); assert.match(ni, /nfSequenceWriter.finish\(C\)/);
  const brand = await readFile(new URL('../../renderer/novaflow-brand-runtime.js', import.meta.url), 'utf8');
  const guard = brand.slice(brand.indexOf('async function prepareNovaflowWriteBinaryPayloadForManualExport'), brand.indexOf('async function prepareNovaflowWriteBinaryPayloadForManualExport') + 180);
  assert.match(guard, /if \(payload\?\.spineSequenceNamed === true\) return payload/);
});

test('loaded AI cutout action exports the edited alpha frames and preserves the raw video writer', async () => {
  const bundle = await readFile(new URL('../../renderer/assets/index-BbIa-2NM.js', import.meta.url), 'utf8');
  const start = bundle.indexOf('ni=async n=>') + 3, end = bundle.indexOf('},ri=', start) + 1;
  for (const mode of ['packed', 'loose', 'video']) {
    const saved = new Map(), rawFrames = [], rgba = frame(17, 25, 3, 5), media = { currentTime: 0, videoWidth: 17, videoHeight: 25, duration: 0.2, pause() {} };
    const document = { createElement: () => {
      const canvas = { width: 1, height: 1 }; let data;
      canvas.getContext = () => ({ clearRect() {}, drawImage(image) { if (image.rgba) data = image.rgba; }, putImageData(image) { data = image.data; }, getImageData: () => ({ data: data || new Uint8Array(canvas.width * canvas.height * 4) }) });
      return canvas;
    } };
    const ref = current => ({ current }), api = { pickDirectory: async () => ({ dir: 'AI' }), writeBinaryFile: async p => { saved.set(`${p.dir}/${p.fileName}`.replaceAll('\\', '/'), p.bytes); return { ok: true }; } };
    const context = vm.createContext({ console, window: {}, document, Blob, TextEncoder, CompressionStream, Response,
      createImageBitmap: async blob => ({ ...png(new Uint8Array(await blob.arrayBuffer())), close() {} }), HTMLImageElement: class {},
      e: { sourceFps: 10 }, t: ref(media), l: 10, N: true, V: true, M: api, k: true, A: '3.8', w: 10, E: 10, T: false, R: 'ai', ce: null,
      c: 100, o: 17, s: 25, r: 'edited.png', a: 0.2, u: false, d: 0, f: 1,
      G: ref({ fps: 10, times: [0, 0.1] }), U: ref(new Map()), En: ref(false), Sn: ref(0), ln: ref({ token: 0 }), Yn() {}, nfPauseCutoutPlayback() {},
      nfCreateCutoutExportReader: async media => ({ media, release() {} }), Rt: async () => {}, wt: async () => {},
      rr: async () => ({ width: 17, height: 25, imageData: { data: rgba } }),
      It: async canvas => new Blob([await pack.encodePng(canvas.getContext().getImageData().data, canvas.width, canvas.height)]),
      Z: (value, min, max) => Math.max(min, Math.min(max, value)), Q: value => Math.max(0, Math.min(1, value)),
      yr: '', Zt: ref(new Map()), ye: '#00ff00', _e: [], De: 0, ke: 1, je: 0, Ne: 0, Y: 0, Be: 0, Ie: 0, Re: 1, Kt: ref(null), Ut: new Map(), alert(message) { throw new Error(message); }
    });
    vm.runInContext(await readFile(new URL('../../renderer/spine-sequence-atlas.js', import.meta.url), 'utf8'), context);
    context.window.NovaFlowSequenceAtlas = context.NovaFlowSequenceAtlas;
    const action = vm.runInContext(`(${bundle.slice(start, end)})`, context);
    const result = await action({ baseName: 'AI烟雾', atlasPack: mode === 'packed', silent: true, throwOnError: true, ...(mode === 'video' ? { noSpine: true, rawDir: true, rawFrameWriter: async payload => rawFrames.push(payload) } : {}) });
    assert.equal(result.height, 25);
    if (mode === 'video') { assert.equal(saved.size, 0); assert.equal(rawFrames.length, 2); assert.deepEqual(rawFrames[0].bytes, rgba); }
    else {
      assert.equal(saved.has('AI/NovaFlow/AI烟雾.atlas'), mode === 'packed');
      const json = JSON.parse(new TextDecoder().decode(saved.get('AI/NovaFlow/AI烟雾.json')));
      assert.equal(json.skins[0].attachments.slot_1['AI烟雾_0000'].height, 25);
      if (mode === 'loose') assert.deepEqual(png(saved.get('AI/NovaFlow/images/AI烟雾_0000.png')).rgba, rgba);
      else { const { atlas } = await runtime('3.8', new TextDecoder().decode(saved.get('AI/NovaFlow/AI烟雾.atlas')), new Map([...saved].map(([name, bytes]) => [name.split('/').pop(), bytes]))); assert.equal(atlas.regions[0].offsetX, 3); assert.equal(atlas.regions[0].offsetY, 19); }
    }
  }
});

test('loaded export dialog keeps hook order and shows packing controls only under the Spine switch', async () => {
  const bundle = await readFile(new URL('../../renderer/assets/index-BbIa-2NM.js', import.meta.url), 'utf8');
  const start = bundle.indexOf('function Ei(e){let{exportTab'), end = bundle.indexOf('function ', start + 15);
  const props = { setSeqExportMode() {}, setVideoExportMode() {}, exportName: 'test', seqSpineVer: '4.1' };
  let hooks = 0;
  const context = vm.createContext({ _: { useState: () => { hooks++; return [false, () => {}]; }, useEffect: () => { hooks++; } }, X: { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'fragment' }, window: { NovaFlowSequenceAtlasUI: { controls: (_, props) => ({ packingControls: props }) } }, mn: 'scale', hn: 'toggle', gn: 'label', yn: 'select' });
  const component = vm.runInContext(`(${bundle.slice(start, end)})`, context);
  assert.equal(component(props), null); assert.equal(hooks, 2);
  for (const enabled of [false, true]) {
    hooks = 0; const tree = component({ ...props, exportTab: 'seq', seqExportSpineProject: enabled });
    assert.equal(hooks, 2); const matches = [];
    (function walk(node) { if (!node || typeof node !== 'object') return; if (node.packingControls) matches.push(node.packingControls); Object.values(node).forEach(value => { if (Array.isArray(value)) value.forEach(walk); else walk(value); }); })(tree);
    assert.equal(matches.length, enabled ? 1 : 0); if (enabled) assert.equal(matches[0].packed, false);
  }
});

// Optional official npm runtime fixtures, outside shipped application assets.
// npm pack @esotericsoftware/spine-core@4.1.24 / @4.2.19, then bundle dist/index.js to runtime.cjs.
for (const version of ['4.1', '4.2']) {
  const fixture = new URL(`../../../.artifacts/spine-runtimes/${version}/runtime.cjs`, import.meta.url);
  test(`official ${version} runtime plays every native Sequence frame with trimmed offsets`, { skip: !existsSync(fixture) && 'official runtime fixture not installed' }, async () => {
    const spine = createRequire(import.meta.url)(fixture.pathname.replace(/^\/(.:)/, '$1'));
    const { files, json } = await output({ baseName: 'native', version, packed: true, fps: 10, duration: 0.3 }, [[frame(17, 9, 3, 5), 17, 9], [frame(17, 9, 12, 2), 17, 9], [frame(17, 9, -1), 17, 9]]);
    const atlas = new spine.TextureAtlas(files.get('native.atlas'));
    for (const page of atlas.pages) page.setTexture(new spine.FakeTexture(png(files.get(page.name))));
    const data = new spine.SkeletonJson(new spine.AtlasAttachmentLoader(atlas)).readSkeletonData(json), skeleton = new spine.Skeleton(data), state = new spine.AnimationState(new spine.AnimationStateData(data));
    state.setAnimation(0, 'animation', false);
    for (let i = 0; i < 3; i++) {
      state.update(i ? 0.1 : 0); state.apply(skeleton); skeleton.updateWorldTransform(spine.Physics?.update);
      const attachment = skeleton.slots[0].getAttachment(), vertices = new Float32Array(8);
      attachment.computeWorldVertices(skeleton.slots[0], vertices, 0, 2);
      assert.equal(skeleton.slots[0].sequenceIndex, i);
      assert.equal(attachment.region.name, `native_000${i}`);
      assert.equal(attachment.width, 17); assert.equal(attachment.height, 9);
      assert([...vertices].every(Number.isFinite));
    }
    assert.equal(atlas.pages[0].pma, false);
  });
}
