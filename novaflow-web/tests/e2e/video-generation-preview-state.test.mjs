import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const bundle = await readFile(new URL('../../renderer/assets/index-BbIa-2NM.js', import.meta.url), 'utf8');
const setterStart = bundle.indexOf('aiSeqJob:De,setAiSeqJob:') + 'aiSeqJob:De,setAiSeqJob:'.length;
const setterSource = bundle.slice(setterStart, bundle.indexOf(',aiSeqComfyProgress:ke', setterStart));
const runStart = bundle.indexOf('j=async nfH3SubmitOptions=>') + 2;
const runSource = bundle.slice(runStart, bundle.indexOf(',M=async e=>', runStart));

test('preview loading cannot replace an active generation job, including delayed React updates', () => {
  const Fe = { generationActive: true };
  let job = { state: 'running', message: 'sampling', promptId: 'current-task' };
  const updates = [];
  const setPreviewJob = new Function('Fe', 'Oe', `return (${setterSource})`)(Fe, update => updates.push(update));
  for (const state of ['running', 'done', 'error']) setPreviewJob({ state, message: 'preview' });
  assert.equal(updates.length, 0);
  assert.equal(job.promptId, 'current-task');
  Fe.generationActive = false;
  setPreviewJob({ state: 'done', message: 'preview loaded' });
  Fe.generationActive = true;
  assert.equal(updates.shift()(job), job);
  Fe.generationActive = false;
  setPreviewJob({ state: 'done', message: 'preview loaded' });
  job = updates.shift()(job);
  assert.equal(job.message, 'preview loaded');
});

test('a second video submit cannot replace the first run token; failed preparation releases the guard', async () => {
  let resolveCheck;
  let checks = 0;
  const jobs = [];
  const e = {
    aiSeqMode: 'minimax_h3_local', aiSeqRunTokenRef: { current: 0 },
    aiSeqComfyWsRef: { current: null }, setAiSeqComfyProgress() {},
    setAiSeqJob(job) { jobs.push(job); }
  };
  const run = new Function('e', 'O', 'fetch', 'window', `return (${runSource})`)(e, () => {
    checks++;
    return new Promise(resolve => { resolveCheck = resolve; });
  }, async () => ({}), { electronAPI: {} });
  const first = run();
  await new Promise(resolve => setImmediate(resolve));
  await run();
  assert.equal(checks, 1);
  assert.equal(e.aiSeqRunTokenRef.current, 1);
  assert.equal(e.aiSeqRunTokenRef.generationActive, true);
  resolveCheck({ ok: false, message: 'runtime unavailable' });
  await first;
  assert.equal(e.aiSeqRunTokenRef.generationActive, false);
  assert.equal(jobs.at(-1).state, 'error');
  const retry = run();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(checks, 2);
  assert.equal(e.aiSeqRunTokenRef.current, 2);
  resolveCheck({ ok: false });
  await retry;
  assert.equal(e.aiSeqRunTokenRef.generationActive, false);
});
