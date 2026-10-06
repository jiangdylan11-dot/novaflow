// 音频 (game background music loops + sound effects): the task contract, the
// worker templates and the page overlay. Runs without ComfyUI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';

import { TASK_TYPE, TASK_TYPE_WORKFLOW, TASK_TYPE_REQUIREMENTS, AUDIO_LIMITS, isKnownTaskType } from '../../packages/shared/src/protocol.mjs';
import { validateTaskParameters } from '../../packages/shared/src/control-plane.mjs';
import { findModel } from '../../packages/shared/src/model-manifest.mjs';
import { loadWorkflow, buildGraph, audioGraphExtras } from '../../worker/src/comfy/workflow-runner.mjs';
import { audioRepromptPrompt } from '../../worker/src/comfy/audio-reprompt.mjs';
import { collectOutputs } from '../../worker/src/comfy/comfy-client.mjs';
import { createDomSandbox } from '../../worker/src/comfy/dom-shim.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WORKFLOW_DIR = ROOT + 'worker/workflows';

test('audio task types are known, audio-kind, self-hosted and name their models', () => {
  for (const type of [TASK_TYPE.AUDIO_MUSIC, TASK_TYPE.AUDIO_SFX]) {
    assert.ok(isKnownTaskType(type), type);
    const req = TASK_TYPE_REQUIREMENTS[type];
    assert.equal(req.kind, 'audio');
    assert.equal(req.billing, 'self_hosted');
    assert.ok(findModel(req.modelId), 'manifest model ' + req.modelId);
    assert.ok(findModel(req.modelId).compatible_workflows.includes(TASK_TYPE_WORKFLOW[type]));
  }
});

test('music parameters: caption, length, loop settings; references never', () => {
  const p = validateTaskParameters(TASK_TYPE.AUDIO_MUSIC, {
    prompt: 'Chiptune loop', duration_seconds: 24, bpm: 140, loop: true, crossfade_ms: 50, references: [{ name: 'x.png', bytes: 10 }]
  });
  assert.equal(p.prompt, 'Chiptune loop');
  assert.equal(p.duration_seconds, 24);
  assert.equal(p.bpm, 140);
  assert.equal(p.loop, true);
  assert.equal(p.reprompt, true);
  assert.equal(p.crossfade_ms, AUDIO_LIMITS.minCrossfadeMs, 'crossfade is clamped up');
  assert.deepEqual(p.references, []);
  assert.equal(validateTaskParameters(TASK_TYPE.AUDIO_MUSIC, { prompt: 'x', duration_seconds: 9999 }).duration_seconds, AUDIO_LIMITS.music.maxSeconds);
  assert.equal(validateTaskParameters(TASK_TYPE.AUDIO_MUSIC, { prompt: 'x', loop: false, reprompt: false }).loop, false);
  assert.equal(validateTaskParameters(TASK_TYPE.AUDIO_MUSIC, { prompt: 'x', loop: false, reprompt: false }).reprompt, false);
  assert.throws(() => validateTaskParameters(TASK_TYPE.AUDIO_MUSIC, { prompt: '' }), /description/);
});

test('effect parameters: short, never looped', () => {
  const p = validateTaskParameters(TASK_TYPE.AUDIO_SFX, { prompt: 'coin', duration_seconds: 99, loop: true, bpm: 120 });
  assert.equal(p.duration_seconds, AUDIO_LIMITS.sfx.maxSeconds);
  assert.equal(p.loop, false);
  assert.equal(p.bpm, 0);
});

test('the worker renders a loop longer than the loop and writes the length into the caption', () => {
  const music = audioGraphExtras(TASK_TYPE.AUDIO_MUSIC, { prompt: 'Chiptune loop. Length: 99 seconds', duration_seconds: 30, crossfade_ms: 800, bpm: 140, loop: true });
  assert.equal(music.generate_seconds, 33);
  assert.equal(music.caption_seconds, 33);
  assert.equal(music.caption_bpm, 140);
  assert.match(music.caption_fallback, /^Chiptune loop\. Length: 33 seconds$/);
  assert.equal(music.reprompt, true);
  assert.match(music.reprompt_prompt, /Input: Chiptune loop\nTarget audio length: 33 seconds\.\nOutput:$/);
  const straight = audioGraphExtras(TASK_TYPE.AUDIO_MUSIC, { prompt: 'x', duration_seconds: 30, loop: false });
  assert.equal(straight.generate_seconds, 30);
  const sfx = audioGraphExtras(TASK_TYPE.AUDIO_SFX, { prompt: 'coin pickup,', duration_seconds: 1, reprompt: false });
  assert.equal(sfx.generate_seconds, 1);
  assert.equal(sfx.caption_fallback, 'coin pickup. Length: 1 seconds');
  assert.equal(sfx.reprompt, false);
  assert.match(audioRepromptPrompt('sfx', '  打开木门  ', 3.4), /sound design expert[\s\S]*Input: 打开木门\nTarget audio length: 3 seconds\./);
});

test('both templates bind every parameter to a real node input and end in the WAV saver', async () => {
  for (const [type, kind] of [[TASK_TYPE.AUDIO_MUSIC, 'music'], [TASK_TYPE.AUDIO_SFX, 'sfx']]) {
    const template = await loadWorkflow(WORKFLOW_DIR, type);
    assert.equal(template.comfy, 'image');
    for (const [key, binding] of Object.entries(template.bindings)) {
      const node = template.graph[binding.node];
      assert.ok(node, type + ' binding ' + key + ' -> node ' + binding.node);
      assert.ok(binding.input in node.inputs, type + ' binding ' + key + ' -> ' + node.class_type + '.' + binding.input);
    }
    const classes = Object.values(template.graph).map((n) => n.class_type);
    assert.ok(classes.includes('NovaFlowSaveAudioWav'));
    assert.ok(classes.includes('NovaFlowAudioCaption'));
    assert.ok(classes.includes('TextGenerate'), 'the rewrite runs on the node');
    assert.ok(classes.includes(kind === 'music' ? 'NovaFlowAudioSeamlessLoop' : 'NovaFlowAudioSfxClean'));
    const parameters = validateTaskParameters(type, { prompt: '森林关卡', duration_seconds: 30, bpm: 90 });
    const graph = buildGraph(template, parameters, audioGraphExtras(type, parameters));
    const encode = Object.values(graph).find((n) => n.class_type === 'CLIPTextEncode' && Array.isArray(n.inputs.text));
    assert.ok(encode, 'the positive text comes from the caption node');
    const caption = graph[encode.inputs.text[0]];
    assert.equal(caption.class_type, 'NovaFlowAudioCaption');
    assert.match(caption.inputs.fallback, /森林关卡\. Length: \d+ seconds$/);
    const rewrite = Object.values(graph).find((n) => n.class_type === 'TextGenerate');
    assert.match(rewrite.inputs.prompt, /Input: 森林关卡/);
    const sw = Object.values(graph).find((n) => n.class_type === 'ComfySwitchNode');
    assert.equal(sw.inputs.switch, true);
    if (kind === 'music') {
      const loop = Object.values(graph).find((n) => n.class_type === 'NovaFlowAudioSeamlessLoop');
      assert.equal(loop.inputs.loop_seconds, 30);
      assert.equal(loop.inputs.bpm, 90);
      assert.equal(loop.inputs.enabled, true);
      assert.equal(graph['4'].inputs.seconds, 33);
    }
    const seed = Object.values(graph).find((n) => n.class_type === 'KSampler').inputs.seed;
    assert.ok(Number.isInteger(seed) && seed >= 0, 'a surprise seed is resolved on the worker');
  }
});

test('an audio output entry is collected with its caption', () => {
  const outputs = collectOutputs({ outputs: { 9: { audio: [{ filename: 'novaflow_music_00001_.wav', subfolder: 'audio', type: 'output', caption: 'Chiptune loop. Length: 33 seconds' }] } } });
  assert.deepEqual(outputs, [{ filename: 'novaflow_music_00001_.wav', subfolder: 'audio', type: 'output', nodeId: '9', caption: 'Chiptune loop. Length: 33 seconds' }]);
});

test('the overlay and the timeline editor are registered, ship without ComfyUI topology and compose English captions', async () => {
  const html = await readFile(ROOT + 'renderer/index.html', 'utf8');
  assert.ok(html.indexOf('audio-timeline.editor.js') < html.indexOf('audio-studio.tool.js'), 'the editor loads before the section');
  const editorSource = await readFile(ROOT + 'renderer/audio-timeline.editor.js', 'utf8');
  const source = await readFile(ROOT + 'renderer/audio-studio.tool.js', 'utf8');
  for (const marker of ['class_type', 'CheckpointLoaderSimple', 'KSampler', 'safetensors', 'stable_audio', 'Stable Audio']) {
    assert.ok(!source.includes(marker) && !editorSource.includes(marker), 'overlay must not mention ' + marker);
  }
  const sandbox = createDomSandbox({});
  const context = createContext(sandbox);
  runInContext(editorSource, context, { filename: 'audio-timeline.editor.js' });
  runInContext(source, context, { filename: 'audio-studio.tool.js' });
  assert.ok(sandbox.NovaFlowAudioTimeline && typeof sandbox.NovaFlowAudioTimeline.create === 'function');
  const api = sandbox.NovaFlowAudioStudio;
  assert.ok(api && typeof api.open === 'function');
  assert.equal(api.captions.translate('森林 雨 金币'), 'forest rain coin');
  assert.match(api.captions.music(), /Game background music.*seamless loop\. BPM: \d+$/);
  assert.match(api.captions.sfx(), /game sound effect, clean, no music$/);
});

test('the mixdown writer produces a 16-bit PCM WAV of the right length', () => {
  // The shim's Blob is a stub; the writer needs the real one to measure.
  const source = createDomSandbox({ Blob: globalThis.Blob });
  const context = createContext(source);
  runInContext(readFileSyncSafe(ROOT + 'renderer/audio-timeline.editor.js'), context, { filename: 'audio-timeline.editor.js' });
  const sr = 8000, n = 400;
  const left = new Float32Array(n).fill(0.5), right = new Float32Array(n).fill(-0.5);
  const fake = { numberOfChannels: 2, length: n, sampleRate: sr, getChannelData: (c) => (c === 0 ? left : right) };
  const blob = source.NovaFlowAudioTimeline.encodeWav(fake);
  assert.equal(blob.size, 44 + n * 2 * 2);
  assert.equal(blob.type, 'audio/wav');
});

import { readFileSync } from 'node:fs';
function readFileSyncSafe(path) { return readFileSync(path, 'utf8'); }
