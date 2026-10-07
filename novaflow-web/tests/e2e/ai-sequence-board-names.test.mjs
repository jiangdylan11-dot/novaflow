import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import '../../renderer/ai-sequence-board-names.js';
import '../../renderer/spine-sequence-atlas.js';

const names = globalThis.NovaFlowAiSequenceBoardNames;
const pack = globalThis.NovaFlowSequenceAtlas;
const moduleSource = await readFile(new URL('../../renderer/ai-sequence-board-names.js', import.meta.url), 'utf8');
const bundle = await readFile(new URL('../../renderer/assets/index-BbIa-2NM.js', import.meta.url), 'utf8');
const actionStart = bundle.indexOf('ni=async n=>') + 3;
const actionSource = bundle.slice(actionStart, bundle.indexOf('},ri=', actionStart) + 1);
const board = (id, animationName, extra = {}) => ({ id, label: id.slice(1), animationName, w: 17, h: 25, ...extra });

test('renames preserve numeric navigation, media and geometry; blank input keeps the current name', () => {
  const media = { objectUrl: 'blob:video' }, original = [board('b1', undefined, { loadedVideo: media, panX: 9 }), board('b2', '攻击')];
  const renamed = names.renameBoard(original, 'b1', '  中文 待机  ');
  assert.equal(renamed[0].animationName, '中文 待机');
  assert.equal(renamed[0].label, '1');
  assert.equal(renamed[0].loadedVideo, media);
  assert.equal(renamed[0].panX, 9);
  assert.equal(original[0].animationName, undefined);
  assert.equal(names.renameBoard(renamed, 'b1', ' \t\n ').at(0).animationName, '中文 待机');
  assert.equal(names.renameBoard(renamed, 'b1', '攻击').at(0).animationName, '攻击_2');
});

test('duplicate and imported names resolve case, Unicode and sanitized collisions without overwriting animations', () => {
  const current = names.normalizeBoards([board('b1', 'Run'), board('b2', 'run'), board('b3', 'e\u0301'), board('b4', 'é'), board('b5', 'a/b'), board('b6', 'a\\b')]);
  assert.deepEqual(current.map(entry => entry.animationName), ['Run', 'run_2', 'é', 'é_2', 'a_b', 'a_b_2']);
  const media = { objectUrl: 'blob:shared' }, source = [board('b1', '行走', { loadedVideo: media })];
  const copies = names.duplicateBoard(names.duplicateBoard(source, 'b1', 'b2'), 'b1', 'b3');
  assert.deepEqual(copies.map(entry => entry.animationName), ['行走', '行走_2', '行走_3']);
  assert.equal(copies[1].loadedVideo, media);
  assert.throws(() => names.duplicateBoard(source, 'b1', 'b1'), /新的画板 ID/);
});

test('names are safe path segments and JSON keys, preserve Chinese and dots, and stay bounded after deduplication', () => {
  assert.equal(names.cleanName('../走路:*?"<>|\\\x00. '), '.._走路_________');
  assert.equal(names.cleanName('..'), '');
  assert.equal(names.cleanName('CON.txt'), '_CON.txt');
  assert.equal(names.cleanName('__proto__'), '___proto__');
  assert.equal(names.cleanName('待机.v2'), '待机.v2');
  const long = '动画'.repeat(60);
  const current = names.normalizeBoards([board('b1', long), board('b2', long)]);
  assert.equal(Array.from(current[1].animationName).length, 80);
  assert.match(current[1].animationName, /_2$/);
  for (const entry of current) assert.doesNotMatch(entry.animationName, /[<>:"/\\|?*\x00-\x1f\x7f]/);
});

test('project metadata round trips by stable ID across reordering; old projects retain existing data and defaults', () => {
  const boards = [board('b7', '中文 待机'), board('b2', '攻击')], original = { systems: [{ systemName: 'existing particle' }], arbitrary: { keep: true } };
  const saved = names.withProjectNames(original, boards, 'b2');
  assert.equal(Object.hasOwn(original, names.projectKey), false);
  const reopened = names.restoreProjectNames(JSON.parse(JSON.stringify(saved)), [board('b2'), board('b7')]);
  assert.deepEqual(reopened.boards.map(entry => entry.animationName), ['攻击', '中文 待机']);
  assert.equal(reopened.activeBoardId, 'b2');
  assert.deepEqual(saved.systems, original.systems);
  assert.deepEqual(saved.arbitrary, original.arbitrary);
  assert.deepEqual(names.restoreProjectNames(original, [board('b1'), board('b2')]).boards.map(entry => entry.animationName), ['animation_1', 'animation_2']);
});

function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
}
function persistentApi(store, media, unavailable = false) {
  const context = vm.createContext({ Uint8Array, crypto: webcrypto, localStorage: store, fetch: async url => {
    if (unavailable) throw Error('source is unavailable');
    assert(media.has(url), `unexpected source ${url}`);
    return new Response(media.get(url));
  } });
  vm.runInContext(moduleSource, context);
  return context.NovaFlowAiSequenceBoardNames;
}
test('a fresh runtime restores names only when both board ID and media SHA256 match', async () => {
  const store = storage(), media = new Map([['blob:first', 'same video bytes'], ['blob:reopened', 'same video bytes'], ['blob:another', 'different video bytes']]);
  const initial = persistentApi(store, media);
  assert.equal(await initial.saveNames([board('b1', '我的动画', { loadedVideo: { objectUrl: 'blob:first' } })], 'b1'), true);
  const fresh = persistentApi(store, media);
  const restored = await fresh.restoreSavedNames([board('b1', undefined, { loadedVideo: { objectUrl: 'blob:reopened' } })]);
  assert.equal(restored[0].animationName, '我的动画');
  for (const candidate of [board('b1'), board('b1', undefined, { loadedVideo: { objectUrl: 'blob:another' } }), board('b2', undefined, { loadedVideo: { objectUrl: 'blob:reopened' } })]) {
    const current = [candidate];
    assert.equal(await fresh.restoreSavedNames(current), current, 'empty/new media/new board must not inherit cached names');
  }
  const manuallyRenamed = [board('b1', '当前手动名字', { loadedVideo: { objectUrl: 'blob:reopened' } })];
  assert.equal(await fresh.restoreSavedNames(manuallyRenamed), manuallyRenamed);
  const record = JSON.parse(store.getItem(names.storageKey));
  assert.match(record.boards[0].fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(record).includes('blob:'), false);
  assert.equal(JSON.stringify(record).includes('video bytes'), false);
});

test('unavailable media or storage never applies an unrelated name or blocks renaming', async () => {
  const store = storage(), current = [board('b1', '命名', { loadedVideo: { objectUrl: 'blob:missing' } })];
  const api = persistentApi(store, new Map(), true);
  assert.equal(await api.saveNames(current, 'b1'), false);
  assert.equal(store.getItem(names.storageKey), null);
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
  const workingMedia = persistentApi(blocked, new Map([['blob:missing', 'valid media']]));
  assert.equal(await workingMedia.saveNames(current, 'b1'), false);
  assert.equal(workingMedia.renameBoard(current, 'b1', '新名称')[0].animationName, '新名称');
});

test('the integrated persistence hook restores matching media and does not overwrite a concurrent manual rename', async () => {
  const store = storage(), media = new Map([['blob:original', 'persistent content'], ['blob:fresh', 'persistent content']]);
  const api = persistentApi(store, media);
  await api.saveNames([board('b1', '已保存名称', { loadedVideo: { objectUrl: 'blob:original' } })], 'b1');
  let current = [board('b1', undefined, { loadedVideo: { objectUrl: 'blob:fresh' } })];
  const effects = [], React = { useEffect: callback => effects.push(callback) };
  api.usePersistence(React, current, updater => { current = updater(current); }, 'b1');
  effects[0]();
  await api.fingerprint(current[0]);
  await new Promise(setImmediate);
  assert.equal(current[0].animationName, '已保存名称');
  current = [board('b1', undefined, { loadedVideo: { objectUrl: 'blob:fresh' } })];
  effects.length = 0;
  api.usePersistence(React, current, updater => { current = updater(current); }, 'b1');
  effects[0]();
  current = names.renameBoard(current, 'b1', '用户刚输入的名字');
  await new Promise(setImmediate);
  assert.equal(current[0].animationName, '用户刚输入的名字');
});

test('named board keys and frame prefixes agree even when an unnamed legacy prefix collides', () => {
  const result = names.exportNames([board('b1'), board('b2', 'NF_1'), board('b3', 'NF_1')], 'NF');
  assert.equal(result[0].regionPrefix, 'NF_1_3');
  assert.equal(result[1].regionPrefix, result[1].animationName);
  assert.equal(result[2].regionPrefix, result[2].animationName);
  assert.deepEqual(names.exportNames([board('b1')], '老文件名')[0], { id: 'b1', animationName: 'animation_1', regionPrefix: '老文件名' });
});

const pixels = () => { const rgba = new Uint8Array(17 * 25 * 4); rgba.set([180, 90, 30, 128], (5 * 17 + 3) * 4); return rgba; };
async function exportAction(boards, version, packed, rawVideo = false) {
  const saved = new Map(), rawFrames = [], rgba = pixels();
  const makeVideo = src => ({ src, currentSrc: src, currentTime: 0, videoWidth: 17, videoHeight: 25, duration: 0.2, pause() {} });
  const media = makeVideo(boards?.[0]?.loadedVideo?.objectUrl || 'blob:source');
  const document = { createElement: type => {
    if (type === 'video') return makeVideo('');
    const canvas = { width: 1, height: 1 }; let data;
    canvas.getContext = () => ({ clearRect() {}, drawImage(image) { if (image.rgba) data = image.rgba; }, putImageData(image) { data = image.data; }, getImageData: () => ({ data: data || new Uint8Array(canvas.width * canvas.height * 4) }) });
    return canvas;
  } };
  const ref = current => ({ current }), api = { pickDirectory: async () => ({ dir: 'AI' }), writeBinaryFile: async payload => { saved.set(`${payload.dir}/${payload.fileName}`.replaceAll('\\', '/'), payload.bytes); return { ok: true }; } };
  const context = vm.createContext({ console, window: { NovaFlowSequenceAtlas: pack, NovaFlowAiSequenceBoardNames: names }, document, Blob, TextEncoder, CompressionStream, Response, HTMLImageElement: class {},
    e: { sourceFps: 10, boards }, t: ref(media), l: 10, N: true, V: true, M: api, k: true, A: version, w: 10, E: 10, T: false, R: 'ai', ce: null,
    c: 100, o: 17, s: 25, r: 'edited.png', a: 0.2, u: false, d: 0, f: 1,
    G: ref({ fps: 10, times: [0, 0.1] }), U: ref(new Map()), En: ref(false), Sn: ref(0), ln: ref({ token: 0 }), Yn() {}, nfPauseCutoutPlayback() {},
    nfCreateCutoutExportReader: async video => ({ media: video, release() {} }), Rt: async () => {}, wt: async () => {},
    rr: async () => ({ width: 17, height: 25, imageData: { data: rgba } }),
    It: async canvas => new Blob([await pack.encodePng(canvas.getContext().getImageData().data, canvas.width, canvas.height)]),
    Z: (value, min, max) => Math.max(min, Math.min(max, value)), Q: value => Math.max(0, Math.min(1, value)),
    yr: '', Zt: ref(new Map()), ye: '#00ff00', _e: [], De: 0, ke: 1, je: 0, Ne: 0, Y: 0, Be: 0, Ie: 0, Re: 1, Kt: ref(null), Ut: new Map(), alert(message) { throw Error(message); }
  });
  const action = vm.runInContext(`(${actionSource})`, context);
  await action({ baseName: '动画合集', atlasPack: packed, silent: true, throwOnError: true, ...(rawVideo ? { noSpine: true, rawDir: true, rawFrameWriter: async payload => rawFrames.push(payload) } : {}) });
  return { saved, rawFrames, json: rawVideo ? null : JSON.parse(new TextDecoder().decode(saved.get('AI/NovaFlow/动画合集.json'))) };
}

test('the loaded AI export action carries renamed multi-board animations into loose and packed Spine 3.8/4.0/4.1/4.2', async () => {
  const boards = names.normalizeBoards([board('b1', '中文 待机', { loadedVideo: { objectUrl: 'blob:one', sourceKind: 'compose_sequence', sourceFps: 10, sourceFrames: 2 } }),
    board('b2', '攻击/动作', { loadedVideo: { objectUrl: 'blob:two', sourceKind: 'compose_sequence', sourceFps: 10, sourceFrames: 2 } }), board('b3', '空白板')]);
  for (const version of ['3.8', '4.0', '4.1', '4.2']) for (const packed of [false, true]) {
    const { saved, json } = await exportAction(boards, version, packed);
    assert.deepEqual(Object.keys(json.animations), ['中文 待机', '攻击_动作', '空白板']);
    assert.equal(Object.hasOwn(json.animations['中文 待机'].slots, 'slot_2'), true, 'other boards remain hidden');
    assert.equal(json.skeleton.height, 25);
    const attachments = json.skins[0].attachments;
    for (const [index, name] of ['中文 待机', '攻击_动作'].entries()) {
      const slot = `slot_${index + 1}`;
      if (version === '3.8' || version === '4.0') {
        assert(Object.hasOwn(attachments[slot], `${name}_0000`));
        assert.equal(json.animations[name].slots[slot].attachment[0].name, `${name}_0000`);
      } else {
        assert.equal(attachments[slot][`${name}_seq`].path, `${name}_`);
        assert(json.animations[name].attachments.default[slot][`${name}_seq`].sequence.length > 0);
      }
      if (packed) assert(new TextDecoder().decode(saved.get('AI/NovaFlow/动画合集.atlas')).includes(`${name}_0000`));
      else assert(saved.has(`AI/NovaFlow/images/${name}_0000.png`));
    }
    assert.equal(saved.has('AI/NovaFlow/动画合集.atlas'), packed);
    assert([...saved.keys()].every(path => !path.includes('攻击/动作') && !path.includes('..')));
  }
});

test('single-board rename changes the actual Spine key and PNG prefix; old boards and raw edited-video export remain compatible', async () => {
  const { saved, json } = await exportAction([board('b1', '待机.v2')], '3.8', false);
  assert.deepEqual(Object.keys(json.animations), ['待机.v2']);
  assert(saved.has('AI/NovaFlow/images/待机.v2_0000.png'));
  const old = await exportAction([board('b1')], '3.8', false);
  assert.deepEqual(Object.keys(old.json.animations), ['animation_1']);
  assert(old.saved.has('AI/NovaFlow/images/动画合集_0000.png'));
  const video = await exportAction([board('b1', '新名字')], '4.1', false, true);
  assert.equal(video.saved.size, 0);
  assert.equal(video.rawFrames.length, 2);
  assert.deepEqual(video.rawFrames[0].bytes, pixels());
});

test('the inline input commits on blur/Enter, handles IME, cancels on Escape, and mounts without a new panel', () => {
  let slots = [], cursor = 0, effects = [], currentBoards = [board('b1', '待机')], input;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState: initial => { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => { slots[index] = value; }]; },
    useRef: initial => { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useEffect: (fn, dependencies) => { const index = cursor++, previous = effects[index]; if (!previous || dependencies.some((value, position) => value !== previous[position])) { effects[index] = dependencies; fn(); } }
  };
  const commits = [], render = () => {
    cursor = 0;
    const mount = names.controls(React, { boards: currentBoards, activeBoardId: 'b1', onRename: (id, name) => { commits.push(name); currentBoards = names.renameBoard(currentBoards, id, name); } });
    const tree = mount.type(mount.props);
    input = tree.props.children[0];
    assert.equal(tree.type, 'span');
    assert.equal(input.props['aria-label'], '当前画板动画名');
    return input;
  };
  render(); input.props.onChange({ target: { value: '行走' } }); render();
  let blurred = false;
  input.props.onKeyDown({ key: 'Enter', isComposing: true, currentTarget: { blur() { blurred = true; } } });
  assert.equal(blurred, false);
  input.props.onKeyDown({ key: 'Enter', preventDefault() {}, stopPropagation() {}, currentTarget: { blur() { input.props.onBlur(); } } });
  assert.deepEqual(commits, ['行走']);
  render(); input.props.onChange({ target: { value: '放弃修改' } }); render();
  input.props.onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {}, currentTarget: { blur() { input.props.onBlur(); } } });
  assert.deepEqual(commits, ['行走']);
  render(); assert.equal(input.props.value, '行走');
});
