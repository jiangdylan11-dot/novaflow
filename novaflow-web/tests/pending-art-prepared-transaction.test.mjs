import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Exercise the native implementation and its existing public stage/clear methods,
// using the exact source, with only the surrounding DOM and generation body stubbed.
function setup() {
  const source = readFileSync(new URL('../renderer/novaflow-brand-runtime.js', import.meta.url), 'utf8');
  const begin = source.indexOf('  let pendingArtAgentPreparation = null;');
  const runBody = source.indexOf('    const ui = window.NovaFlowUiDesignDrawing;', begin);
  const apiBegin = source.indexOf('      stageAgentPrepared(prepared) {', runBody);
  const apiEnd = source.indexOf('\n    };', apiBegin);
  assert.ok(begin >= 0 && runBody > begin && apiBegin > runBody && apiEnd > apiBegin);
  const prelude = source.slice(begin, runBody);
  const api = source.slice(apiBegin, apiEnd);
  const context = vm.createContext({ window: {} });
  vm.runInContext(`
    let ART_GENERATE_STATE = { running: false };
    let errors = [];
    function setArtGenerateStatus(message) { errors.push(message); }
    ${prelude}
      return 'generation-body-stub';
    }
    globalThis.nativeApi = { ${api} };
    globalThis.current = () => pendingArtAgentPreparation;
    globalThis.setRunning = value => { ART_GENERATE_STATE.running = value; };
    globalThis.run = runArtGenerate;
    globalThis.errors = errors;
  `, context);
  return context;
}
function prepared(fn = () => {}) { return { assertCurrent: fn, marker: () => 'preserved' }; }

test('reversible replacement keeps the original object, functions and one-use opaque handles', () => {
  const c = setup(); const old = prepared(); const next = prepared();
  c.nativeApi.stageAgentPrepared(old);
  const snapshot = c.nativeApi.captureAgentPreparedSnapshot();
  assert.deepEqual(Reflect.ownKeys(snapshot), []);
  const undo = c.nativeApi.replaceAgentPrepared(snapshot, next);
  assert.deepEqual(Reflect.ownKeys(undo), []);
  assert.equal(c.current(), next);
  assert.throws(() => c.nativeApi.replaceAgentPrepared(snapshot, next));
  assert.equal(c.nativeApi.restoreAgentPrepared(undo), true);
  assert.equal(c.current(), old); assert.equal(c.current().marker(), 'preserved');
  assert.throws(() => c.nativeApi.restoreAgentPrepared(undo));
});

test('stage, clear, including ABA and empty clear, invalidate old snapshots or undo', () => {
  const c = setup(); const a = prepared(); const b = prepared();
  const emptySnapshot = c.nativeApi.captureAgentPreparedSnapshot();
  c.nativeApi.clearAgentPrepared();
  assert.throws(() => c.nativeApi.replaceAgentPrepared(emptySnapshot, a));
  c.nativeApi.stageAgentPrepared(a);
  const snapshot = c.nativeApi.captureAgentPreparedSnapshot();
  c.nativeApi.stageAgentPrepared(b); c.nativeApi.stageAgentPrepared(a);
  assert.throws(() => c.nativeApi.replaceAgentPrepared(snapshot, b));
  const undo = c.nativeApi.replaceAgentPrepared(c.nativeApi.captureAgentPreparedSnapshot(), b);
  c.nativeApi.stageAgentPrepared(a); c.nativeApi.stageAgentPrepared(b);
  assert.throws(() => c.nativeApi.restoreAgentPrepared(undo));
  assert.equal(c.current(), b);
});

test('replacement asserts synchronously, rejects reentrancy and consumes failed handles', () => {
  const c = setup(); const a = prepared(); c.nativeApi.stageAgentPrepared(a);
  const snapshot = c.nativeApi.captureAgentPreparedSnapshot();
  assert.throws(() => c.nativeApi.replaceAgentPrepared(snapshot, prepared(() => { c.nativeApi.clearAgentPrepared(); })));
  assert.equal(c.current(), null);
  assert.throws(() => c.nativeApi.replaceAgentPrepared(snapshot, a));
  const snapshot2 = c.nativeApi.captureAgentPreparedSnapshot();
  assert.throws(() => c.nativeApi.replaceAgentPrepared(snapshot2, prepared(() => ({ then() {} }))));
  assert.equal(c.current(), null);
  const snapshot3 = c.nativeApi.captureAgentPreparedSnapshot();
  assert.throws(() => c.nativeApi.replaceAgentPrepared(snapshot3, prepared(() => { throw new Error('stale'); })));
  assert.equal(c.current(), null);
});

test('running state blocks capture, replace and restore without changing preparation', () => {
  const c = setup(); const a = prepared(); const b = prepared(); c.nativeApi.stageAgentPrepared(a);
  const snapshot = c.nativeApi.captureAgentPreparedSnapshot(); c.setRunning(true);
  assert.throws(() => c.nativeApi.captureAgentPreparedSnapshot());
  assert.throws(() => c.nativeApi.replaceAgentPrepared(snapshot, b));
  c.setRunning(false); assert.equal(c.current(), a);
  const undo = c.nativeApi.replaceAgentPrepared(c.nativeApi.captureAgentPreparedSnapshot(), b);
  c.setRunning(true); assert.throws(() => c.nativeApi.restoreAgentPrepared(undo));
  c.setRunning(false); assert.equal(c.current(), b);
  assert.throws(() => c.nativeApi.restoreAgentPrepared(undo));
});

test('both direct and pending generation attempts invalidate undo; consumption checks current first', async () => {
  const c = setup(); const a = prepared(); const b = prepared(); c.nativeApi.stageAgentPrepared(a);
  let undo = c.nativeApi.replaceAgentPrepared(c.nativeApi.captureAgentPreparedSnapshot(), b);
  await c.run({ drawingPrepared: b });
  assert.throws(() => c.nativeApi.restoreAgentPrepared(undo)); assert.equal(c.current(), b);
  let valid = true;
  const becomesStale = prepared(() => { if (!valid) throw new Error('stale'); });
  undo = c.nativeApi.replaceAgentPrepared(c.nativeApi.captureAgentPreparedSnapshot(), becomesStale);
  valid = false;
  await c.run();
  assert.equal(c.current(), null); assert.equal(c.errors.length, 1);
  assert.throws(() => c.nativeApi.restoreAgentPrepared(undo));
});


test('read-only post-render check detects reentrant replacement and never consumes undo', () => {
  const c = setup(), old = prepared(), next = prepared();
  c.nativeApi.stageAgentPrepared(old);
  const undo = c.nativeApi.replaceAgentPrepared(c.nativeApi.captureAgentPreparedSnapshot(), next);
  assert.equal(c.nativeApi.isAgentPreparedReplacementCurrent(undo), true);
  assert.equal(c.nativeApi.isAgentPreparedReplacementCurrent(undo), true);
  c.setRunning(true); assert.equal(c.nativeApi.isAgentPreparedReplacementCurrent(undo), false);
  c.setRunning(false); assert.equal(c.nativeApi.isAgentPreparedReplacementCurrent(undo), true);
  // Simulate render synchronously staging a different preparation and restoring
  // the same object; identity alone cannot detect this ABA change.
  c.nativeApi.stageAgentPrepared(prepared()); c.nativeApi.stageAgentPrepared(next);
  assert.equal(c.nativeApi.isAgentPreparedReplacementCurrent(undo), false);
  assert.throws(() => c.nativeApi.restoreAgentPrepared(undo));
  assert.equal(c.nativeApi.isAgentPreparedReplacementCurrent(undo), false);
  assert.equal(c.nativeApi.isAgentPreparedReplacementCurrent({}), false);
  const fresh = c.nativeApi.replaceAgentPrepared(c.nativeApi.captureAgentPreparedSnapshot(), old);
  assert.equal(c.nativeApi.isAgentPreparedReplacementCurrent(fresh), true);
  assert.equal(c.nativeApi.restoreAgentPrepared(fresh), true);
  assert.equal(c.nativeApi.isAgentPreparedReplacementCurrent(fresh), false);
});
