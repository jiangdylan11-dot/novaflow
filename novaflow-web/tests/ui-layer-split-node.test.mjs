// The node side of UI 拆图: one process per split, its answer read from a file, and a node that only reports the
// capability when everything the split needs is on disk. Python is stood in for by small node scripts here; the
// real run is tests/e2e/ui-layer-split-node.verify.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runUiLayerSplit, uiLayerSplitFiles, UI_LAYER_SPLIT_CAPABILITY, UI_LAYER_SPLIT_SCOPE } from '../worker/src/ui-layer-split-node.mjs';

const dir = await mkdtemp(join(tmpdir(), 'foart-ui-split-node-'));
test.after(() => rm(dir, { recursive: true, force: true }));
// A stand-in for "python -B -m prompt_assistant.ui_layer_split_cli": same stdin contract, behaviour from the script body.
const standIn = body => (_python, _args, options) => spawn(process.execPath, ['-e',
  "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const request=JSON.parse(s),fs=require('fs');" + body + '})'], options);
const run = (body, extra = {}) => runUiLayerSplit({ python: 'python', serviceScript: join(dir, 'prompt-assistant-service.py'), runtimeJson: join(dir, 'runtime.json'),
  payload: { visualSchema: 'nf.ui.layers.v1', regions: [{ id: 'r1' }] }, spawnProcess: standIn(body), ...extra });

test('names stay off the retired prefixes', () => {
  assert.equal(UI_LAYER_SPLIT_CAPABILITY, 'foart-ui-layer-split-v1');
  assert.equal(UI_LAYER_SPLIT_SCOPE, 'layer-split-v1');
});

test('a finished split comes back as layers, with its stages reported on the way', async () => {
  const stages = [];
  const result = await run("console.error('progress 切出选区');console.error('noise');console.error('progress 补全背景');"
    + "fs.writeFileSync(request.result,JSON.stringify({ok:true,data:{visualSchema:'nf.ui.layers.v1',layers:[{id:'background'},{id:request.payload.regions[0].id}]}}));", { onProgress: stage => stages.push(stage) });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.layers.map(layer => layer.id), ['background', 'r1'], 'the request reached the process and its answer came back');
  assert.deepEqual(stages, ['切出选区', '补全背景']);
});

test('the reason the split gave is what the user reads', async () => {
  const result = await run("fs.writeFileSync(request.result,JSON.stringify({ok:false,error:'当前算力节点缺少拆图所需的分割模型'}));");
  assert.deepEqual([result.ok, result.errorCode], [false, 'ui-layer-split-failed']);
  assert.equal(result.error, '拆图失败：当前算力节点缺少拆图所需的分割模型');
});

test('a process that dies without an answer is a failure, not a hang or an empty success', async () => {
  const result = await run("console.error('CUDA out of memory');process.exit(3);");
  assert.equal(result.ok, false);
  assert.match(result.error, /拆图进程异常结束（3）：.*CUDA out of memory/);
  const wrong = await run("fs.writeFileSync(request.result,JSON.stringify({ok:true,data:{visualSchema:'something-else',layers:[]}}));");
  assert.equal(wrong.ok, false, 'an answer in another protocol is not accepted as layers');
});

test('cancelling and running out of time both end the process', async () => {
  let cancelled = false; setTimeout(() => { cancelled = true; }, 300);
  const started = Date.now();
  const stopped = await run('setInterval(()=>{},1000);', { isCancelled: () => cancelled });
  assert.deepEqual([stopped.ok, stopped.errorCode], [false, 'ui-layer-split-cancelled']);
  assert.ok(Date.now() - started < 5000);
  const late = await run('setInterval(()=>{},1000);', { timeoutMs: 300 });
  assert.deepEqual([late.ok, late.errorCode], [false, 'ui-layer-split-timeout']);
});

test('the capability is reported only when every piece is on disk', async () => {
  const install = join(dir, 'runtime'), models = join(dir, 'models'), scripts = join(dir, 'app');
  const runtimeJson = join(install, 'runtime.json'), python = join(install, 'engine', 'python', 'python.exe'), serviceScript = join(scripts, 'prompt-assistant-service.py');
  const probe = () => uiLayerSplitFiles({ python, serviceScript, runtimeJson });
  assert.deepEqual(probe(), { ok: false, missing: 'runtime' });
  await mkdir(join(install, 'engine', 'python'), { recursive: true });
  await writeFile(runtimeJson, '﻿' + JSON.stringify({ installPath: install, modelsPath: models }));
  assert.equal(probe().missing, 'python');
  await writeFile(python, 'x');
  assert.equal(probe().missing, 'split-script');
  await mkdir(join(scripts, 'prompt_assistant'), { recursive: true });
  await writeFile(join(scripts, 'prompt_assistant', 'ui_layer_split.py'), 'x');
  await writeFile(join(scripts, 'prompt_assistant', 'ui_layer_split_cli.py'), 'x');
  assert.equal(probe().missing, 'segment-component');
  await mkdir(join(install, 'engine', 'ComfyUI', 'custom_nodes', 'ComfyUI-RMBG', 'sam3'), { recursive: true });
  assert.equal(probe().missing, 'segment-model');
});
