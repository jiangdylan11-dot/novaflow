#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync("particle-editor/primary-entry-transition.bridge.js", "utf8");
const window = Object.create(null);
const context = vm.createContext({ window, globalThis: window, Object, Number });
vm.runInContext(source, context, {
  filename: "particle-editor/primary-entry-transition.bridge.js"
});

const bridgeFactory = window.NovaFlowPrimaryEntryTransitionBridge;
assert.equal(typeof bridgeFactory?.create, "function", "Bridge must expose create()");

const transaction = bridgeFactory.create();
assert.deepEqual(
  JSON.parse(JSON.stringify(transaction.snapshot())),
  { phase: "idle", sourceIndex: -1, targetIndex: -1, token: -1, reason: "init" },
  "A new transaction must start idle"
);

assert.equal(transaction.begin({ sourceIndex: 2, targetIndex: 1 }), true, "Art must begin a transaction");
assert.equal(transaction.begin({ sourceIndex: 2, targetIndex: 1 }), false, "Repeated Art intent must be idempotent");
assert.equal(transaction.isPending(), true, "Unbound intent must remain pending");
assert.equal(transaction.resolvePublishedIndex(1), 2, "Pending Animation publication must preserve Art");
assert.equal(transaction.resolvePublishedIndex(0), 0, "Unrelated requested indexes must pass through");
assert.equal(transaction.bind(17), true, "Post activation must bind the route token");
assert.equal(transaction.bind(18), false, "A bound transaction must reject token replacement");
assert.equal(transaction.claimCommit(18), false, "A stale token must not claim publication");
assert.equal(transaction.claimCommit(17), true, "The owning token must claim publication once");
assert.equal(transaction.claimCommit(17), false, "A claimed publication must not re-enter");
assert.equal(transaction.complete(17, "mounted"), true, "The claimed mounted publication must complete");
assert.equal(transaction.complete(17, "duplicate"), false, "Completion must be exactly once");
assert.equal(transaction.isPending(), false, "Completed transactions must not remain pending");
assert.equal(transaction.resolvePublishedIndex(1), 1, "Completed transactions must release Animation publication");

assert.equal(transaction.begin({ sourceIndex: 2, targetIndex: 1 }), true, "A fresh capture may begin unbound");
assert.equal(
  transaction.cancel({ expectedToken: 17, reason: "old-settle" }),
  false,
  "An old bound settle must not cancel a newer unbound capture"
);
assert.equal(transaction.isPending(), true, "The newer unbound capture must survive stale token cleanup");
assert.equal(
  transaction.cancel({ reason: "explicit-unbound-cancel" }),
  true,
  "Capture-time route exit must still cancel explicitly without a token"
);

assert.equal(transaction.begin({ sourceIndex: 0, targetIndex: 1 }), true, "Particle must use the same transaction");
assert.equal(transaction.bind(21), true, "Particle transaction must bind normally");
assert.equal(transaction.cancel({ expectedToken: 22, reason: "stale-cancel" }), false, "A stale cleanup must not cancel the owner");
assert.equal(transaction.cancel({ expectedToken: 21, reason: "route-exit" }), true, "The owner must cancel on route exit");
assert.deepEqual(
  JSON.parse(JSON.stringify(transaction.snapshot())),
  { phase: "idle", sourceIndex: -1, targetIndex: -1, token: -1, reason: "route-exit" },
  "Cancellation must clear every pending field"
);

assert.equal(transaction.begin({ sourceIndex: 3, targetIndex: 1 }), true, "Tools must not require a separate path");
assert.equal(transaction.bind(31), true, "Tools transaction must bind normally");
assert.equal(transaction.cancel({ expectedToken: 31, reason: "mount-timeout" }), true, "Watchdog timeout must clear the owner");
assert.equal(transaction.isPending(), false, "Watchdog cleanup must not leave a permanent lock");

assert.equal(transaction.begin({ sourceIndex: 1, targetIndex: 1 }), false, "Animation-to-Animation must not create a transaction");
assert.equal(transaction.begin({ sourceIndex: -1, targetIndex: 1 }), false, "Unknown sources must not create a transaction");

const runtimeSource = readFileSync("particle-editor/novaflow-brand-runtime.js", "utf8");

function extractFunctionSource(sourceText, functionName) {
  const start = sourceText.indexOf(`function ${functionName}(`);
  assert.ok(start >= 0, `${functionName} must exist in Brand Runtime`);
  let index = sourceText.indexOf("(", start);
  let parameterDepth = 0;
  for (; index < sourceText.length; index += 1) {
    const char = sourceText[index];
    if (char === "(") parameterDepth += 1;
    else if (char === ")") {
      parameterDepth -= 1;
      if (parameterDepth === 0) break;
    }
  }
  index = sourceText.indexOf("{", index);
  let bodyDepth = 0;
  for (; index < sourceText.length; index += 1) {
    const char = sourceText[index];
    if (char === "{") bodyDepth += 1;
    else if (char === "}") {
      bodyDepth -= 1;
      if (bodyDepth === 0) return sourceText.slice(start, index + 1);
    }
  }
  assert.fail(`${functionName} must have a complete body`);
}

const replayFunctionSource = extractFunctionSource(runtimeSource, "replayPrimaryAnimationEntryIntent");
const nativeReplayFunctionSource = extractFunctionSource(runtimeSource, "executePrimaryAnimationEntryNativeReplay");

function createReplayPathHarness({ bypassPreview = false } = {}) {
  return Function(
    "bypassPreview",
    `"use strict";
      class HTMLElement {
        constructor() {
          this.isConnected = true;
          this.clickCount = 0;
        }
        click() {
          this.clickCount += 1;
        }
      }

      let PRIMARY_SWITCH_TOKEN = 17;
      let PRIMARY_ANIMATION_ENTRY_TRANSACTION_SERIAL = 7;
      let PRIMARY_ANIMATION_ENTRY_REPLAY_PROMISE = null;
      let PRIMARY_ANIMATION_ENTRY_REPLAY_TOKEN = -1;
      let PRIMARY_ANIMATION_ENTRY_REPLAY_SERIAL = -1;
      const PRIMARY_ANIMATION_ENTRY_REPLAY_BUTTONS = new WeakSet();
      const PRIMARY_ANIMATION_ENTRY_PREVIEW = { isSupported: () => true };
      const cancelCalls = [];
      const releaseCalls = [];
      const activationCalls = [];
      let captureCalls = 0;
      let prepareCalls = 0;
      let transactionPending = true;
      let resolveCapture;
      const captureGate = new Promise((resolve) => { resolveCapture = resolve; });

      async function capturePrimaryAnimationEntryPreview() {
        captureCalls += 1;
        return captureGate;
      }
      function isPrimaryAnimationEntryTransactionPending(expectedToken = null) {
        if (arguments.length > 0) return false;
        return transactionPending;
      }
      function cancelPrimaryAnimationEntryTransaction(expectedToken = null, reason = "cancel", options = {}) {
        cancelCalls.push({ expectedToken, reason, options });
        transactionPending = false;
        return true;
      }
      function releasePrimaryAnimationEntryPreviewAfterPaint(reason) {
        releaseCalls.push(reason);
        return true;
      }
      function holdPrimaryAnimationEntryGeometrySurface() {}
      function releasePrimaryAnimationEntryGeometrySurfaceHold() {
        return true;
      }
      function nfAnimationPerfCountCallsite() {}
      function preparePrimaryAnimationEntryReplayIntent() {
        prepareCalls += 1;
      }
      function handlePrimaryEntryPostActivation(label) {
        activationCalls.push(label);
      }

      ${nativeReplayFunctionSource}
      ${replayFunctionSource}

      return async function run() {
        const button = new HTMLElement();
        const accepted = replayPrimaryAnimationEntryIntent(button, { bypassPreview });
        const immediate = {
          captureCalls,
          prepareCalls,
          clickCount: button.clickCount,
          hasReplayPromise: Boolean(PRIMARY_ANIMATION_ENTRY_REPLAY_PROMISE)
        };
        resolveCapture(true);
        const replayPromise = PRIMARY_ANIMATION_ENTRY_REPLAY_PROMISE;
        if (replayPromise) await replayPromise;
        await Promise.resolve();
        return {
          accepted,
          immediate,
          captureCalls,
          prepareCalls,
          clickCount: button.clickCount,
          activationCalls,
          cancelCalls,
          releaseCalls,
          hasReplayPromise: Boolean(PRIMARY_ANIMATION_ENTRY_REPLAY_PROMISE)
        };
      };
    `
  )(bypassPreview);
}

const artReplay = await createReplayPathHarness({ bypassPreview: true })();
assert.equal(artReplay.accepted, true, "Art no-Preview replay must accept the original click");
assert.deepEqual(
  artReplay.immediate,
  { captureCalls: 0, prepareCalls: 1, clickCount: 1, hasReplayPromise: false },
  "Art no-Preview replay must synchronously prepare and click exactly once without capture or Promise ownership"
);
assert.equal(artReplay.captureCalls, 0, "Art no-Preview replay must never call compositor capture");
assert.equal(artReplay.clickCount, 1, "Art no-Preview replay must issue exactly one native click");
assert.deepEqual(artReplay.activationCalls, ["\u52a8\u753b"], "Art no-Preview replay must run normal post activation once");
assert.equal(artReplay.cancelCalls.length, 0, "A healthy Art no-Preview replay must preserve the pending transaction");
assert.equal(artReplay.releaseCalls.length, 0, "Art no-Preview replay must not release a Preview it never acquired");
assert.equal(artReplay.hasReplayPromise, false, "Art no-Preview replay must leave no asynchronous replay owner");

const previewReplay = await createReplayPathHarness({ bypassPreview: false })();
assert.equal(previewReplay.accepted, true, "Particle and Tools Preview replay must still accept the original click");
assert.deepEqual(
  previewReplay.immediate,
  { captureCalls: 1, prepareCalls: 0, clickCount: 0, hasReplayPromise: true },
  "Particle and Tools must still wait for compositor capture before route replay"
);
assert.equal(previewReplay.captureCalls, 1, "Particle and Tools replay must retain exactly one compositor capture");
assert.equal(previewReplay.prepareCalls, 1, "Particle and Tools replay must prepare once after capture");
assert.equal(previewReplay.clickCount, 1, "Particle and Tools replay must still issue exactly one native click");
assert.deepEqual(previewReplay.activationCalls, ["\u52a8\u753b"], "Particle and Tools replay must run normal post activation once");
assert.equal(previewReplay.cancelCalls.length, 0, "A healthy Preview replay must preserve the pending transaction");

function createStaleReplayHarness({
  afterSerial = 7,
  afterToken = 17,
  stillPending = true,
  buttonConnected = false
} = {}) {
  return Function(
    "afterSerial",
    "afterToken",
    "stillPending",
    "buttonConnected",
    `"use strict";
      class HTMLElement {
        constructor(connected) {
          this.isConnected = connected;
          this.clickCount = 0;
        }
        click() {
          this.clickCount += 1;
        }
      }

      let PRIMARY_SWITCH_TOKEN = 17;
      let PRIMARY_ANIMATION_ENTRY_TRANSACTION_SERIAL = 7;
      let PRIMARY_ANIMATION_ENTRY_REPLAY_PROMISE = null;
      let PRIMARY_ANIMATION_ENTRY_REPLAY_TOKEN = -1;
      let PRIMARY_ANIMATION_ENTRY_REPLAY_SERIAL = -1;
      const PRIMARY_ANIMATION_ENTRY_REPLAY_BUTTONS = new WeakSet();
      const PRIMARY_ANIMATION_ENTRY_PREVIEW = { isSupported: () => true };
      const cancelCalls = [];
      const releaseCalls = [];
      const activationCalls = [];
      let transactionPending = true;
      let resolveCapture;
      const captureGate = new Promise((resolve) => { resolveCapture = resolve; });

      async function capturePrimaryAnimationEntryPreview() {
        return captureGate;
      }
      function isPrimaryAnimationEntryTransactionPending(expectedToken = null) {
        if (arguments.length > 0) return false;
        return transactionPending;
      }
      function cancelPrimaryAnimationEntryTransaction(expectedToken = null, reason = "cancel", options = {}) {
        cancelCalls.push({ expectedToken, reason, options });
        transactionPending = false;
        return true;
      }
      function releasePrimaryAnimationEntryPreviewAfterPaint(reason) {
        releaseCalls.push(reason);
        return true;
      }
      function holdPrimaryAnimationEntryGeometrySurface() {}
      function releasePrimaryAnimationEntryGeometrySurfaceHold() {
        return true;
      }
      function nfAnimationPerfCountCallsite() {}
      function preparePrimaryAnimationEntryReplayIntent() {}
      function handlePrimaryEntryPostActivation(label) {
        activationCalls.push(label);
      }

      ${nativeReplayFunctionSource}
      ${replayFunctionSource}

      return async function run() {
        const button = new HTMLElement(buttonConnected);
        const accepted = replayPrimaryAnimationEntryIntent(button);
        PRIMARY_ANIMATION_ENTRY_TRANSACTION_SERIAL = afterSerial;
        PRIMARY_SWITCH_TOKEN = afterToken;
        transactionPending = stillPending;
        resolveCapture(true);
        const replayPromise = PRIMARY_ANIMATION_ENTRY_REPLAY_PROMISE;
        if (replayPromise) await replayPromise;
        await Promise.resolve();
        return { accepted, cancelCalls, releaseCalls, activationCalls, clickCount: button.clickCount };
      };
    `
  )(afterSerial, afterToken, stillPending, buttonConnected);
}

const disconnectedOwner = await createStaleReplayHarness()();
assert.deepEqual(
  disconnectedOwner.cancelCalls,
  [{ expectedToken: null, reason: "stale-replay", options: {} }],
  "A disconnected replay button must cancel only its still-pending serial and route-token owner"
);

for (const [label, options] of [
  ["newer serial", { afterSerial: 8 }],
  ["newer route token", { afterToken: 18 }],
  ["settled transaction", { stillPending: false }],
  ["connected replay owner", { buttonConnected: true }]
]) {
  const result = await createStaleReplayHarness(options)();
  assert.equal(result.cancelCalls.length, 0, `${label} must not be canceled by stale replay cleanup`);
}

console.log("PASS primary Animation entry transaction contract");
