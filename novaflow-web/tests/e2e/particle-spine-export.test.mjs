import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { exportSpinePackage } from '../../renderer/assets/particle-spine-export.js';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/wcAAgAB/6X2XQAAAABJRU5ErkJggg==';
const cfg = {
  enabled: true, systemName: 'edited triangle', mode: 'burst', burstCount: 50,
  lifetimeMin: 1, lifetimeMax: 1, systemX: 0, systemY: 0,
  shape: { type: 'custom_path', x: 0, y: 0 }, pathEnabled: false,
  pathClosed: true, pathEmitSampleCount: 50,
  pathPoints: [{ x: -120, y: -120 }, { x: 150, y: 0 }, { x: -120, y: 120 }],
  sizeStart: 32, sizeEnd: 32, opacityStart: 1, opacityEnd: 1,
  sprites: [{ id: 'old-id', name: 'old_template', dataUrl: png, mode: 'single', weight: 1 }]
};

test('the loaded Web export action saves the current edited system with the typed name', async () => {
  const html = await readFile(new URL('../../renderer/index.html', import.meta.url), 'utf8');
  const bundlePath = html.match(/src="\.\/(assets\/index-[^"]+\.js)\?/)[1];
  const bundle = await readFile(new URL(`../../renderer/${bundlePath}`, import.meta.url), 'utf8');
  const start = bundle.indexOf('handleExportSpinePackage:async()=>') + 'handleExportSpinePackage:'.length;
  const end = bundle.indexOf(',onProjectJsonPicked:', start);
  assert(start > 0 && end > start);
  let saved;
  const context = vm.createContext({
    n: [cfg], t: cfg, Te: '三角烟雾', T: '3.8',
    ze: value => value, we: () => {}, Je: () => 0,
    novaflowExportSpinePackage: exportSpinePackage,
    window: { electronAPI: { saveSpinePackage: async payload => { saved = payload; return { ok: true }; } } },
    alert: () => {}, console
  });
  assert.equal(await vm.runInContext(`(${bundle.slice(start, end)})()`, context), true);
  assert.equal(saved.baseName, '三角烟雾');
  assert.equal(saved.images[0].fileName, '三角烟雾.png');
  assert.equal(saved.particleNamedExport, true);
  const json = JSON.parse(saved.json);
  assert.equal(json.slots[0].attachment, '三角烟雾');
  const first = json.animations.animation.bones.sys_0_p_0.translate[0];
  assert.equal(first.x, -120);
  assert.equal(first.y, 120);
  assert.equal(cfg.sprites[0].name, 'old_template');

  const brand = await readFile(new URL('../../renderer/novaflow-brand-runtime.js', import.meta.url), 'utf8');
  const guardStart = brand.indexOf('  function prepareNovaflowSaveSpinePackagePayloadForManualExport(');
  const guardEnd = brand.indexOf('\n  function hexToNovaflowExportRgb', guardStart);
  const guarded = vm.runInNewContext(`${brand.slice(guardStart, guardEnd)}\nprepareNovaflowSaveSpinePackagePayloadForManualExport(payload)`, {
    payload: saved, getNovaflowManualExportStateForPayload: () => ({ name: '三角烟雾' })
  });
  assert.equal(guarded.json, saved.json);
  assert.equal(guarded.images[0].fileName, '三角烟雾.png');
  assert.equal(guarded.atlas, saved.atlas);
});

test('Spine 3.8 official runtime resolves all 50 attachments and retains the edited path', async () => {
  const pkg = await exportSpinePackage([cfg], '3.8', { exportName: '三角烟雾' });
  const code = await readFile(new URL('../../renderer/vendor/spine/spine-webgl-3.8.js', import.meta.url), 'utf8');
  const context = vm.createContext({ console, navigator: { userAgent: 'node' } });
  vm.runInContext(code, context);
  const { spine } = context;
  const atlas = new spine.TextureAtlas(pkg.atlas, () => new spine.FakeTexture({ width: 1, height: 1 }));
  const reader = new spine.SkeletonJson(new spine.AtlasAttachmentLoader(atlas));
  const data = reader.readSkeletonData(pkg.json);
  const skeleton = new spine.Skeleton(data);
  const state = new spine.AnimationState(new spine.AnimationStateData(data));
  state.setAnimation(0, 'animation', false);
  state.update(0.25);
  state.apply(skeleton);
  skeleton.updateWorldTransform();
  assert.equal(skeleton.slots.length, 50);
  assert(skeleton.slots.every(slot => slot.getAttachment()?.name === '三角烟雾'));
  assert(Math.abs(skeleton.slots[0].bone.worldX + 120) < 0.01);
  assert(Math.abs(skeleton.slots[0].bone.worldY - 120) < 0.01);
});
