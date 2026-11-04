import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { legacyXiaotaoCreditGuard, INDEPENDENT_UI_CONTRACT } from './legacy-xiaotao-credit-guard.mjs';

const require = createRequire(new URL('../../../novaflow-web/package.json', import.meta.url));
const ts = require('typescript');
const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
function section(from, to) {
  const start = source.indexOf(`async function ${from}(`);
  const end = source.indexOf(`async function ${to}(`, start);
  assert.ok(start >= 0 && end > start, `missing handler ${from}`);
  return source.slice(start, end);
}
const parts = [section('legacyCreditGate', 'handleRunningHubGptImage'),
  section('handleGrokImageReverse', 'handleRunningHubUiCatalog'),
  section('handleRunningHubUiCatalog', 'handleGrokChat')];
const code = ts.transpileModule(parts.join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
}).outputText;

const base = {
  prices: { prompt_optimize: 4, image_reverse: 4 }, credits_per_usd: 211,
  token_billing: { round: 'ceil', markup: 2, min_credits_per_image: 1,
    settle_cap_credits: 40, estimate_credits: { synthetic: 1 } },
};
const decimal = { ...base, xiaotao_online: { credit_amount_policy: 'decimal-v1',
  credit_precision: 6, credit_rounding: 'ceil', minimum_positive_credits: 0 } };
const ui = { surface: 'ui-design', purpose: 'ui-design-reference', prompt: 'synthetic', requestId: 'synthetic-123' };
const direct = { ...ui, foartUiContract: INDEPENDENT_UI_CONTRACT };
const session = { user: { id: 'test-only' } };
const routes = ['prompt', 'reverse', 'catalog'];

function fixture(initialConfig = decimal, options = {}) {
  const state = { config: initialConfig, maintenance: false, calls: { config: 0, reserve: 0, provider: 0, settle: 0 } };
  const adminClient = () => ({ from(name) {
    assert.equal(name, 'system_settings');
    return { select() { return { eq() { return { async maybeSingle() {
      state.calls.config++;
      if (state.config instanceof Error) throw state.config;
      return state.config === null ? { data: null, error: null } : { data: { value: state.config }, error: null };
    } }; } }; } };
  } });
  const request = () => ({ body: {}, inputMeta: {}, resultOptions: {} });
  const grokResult = { data: { output_text: 'synthetic prompt' }, providerCallCount: 1 };
  const deps = {
    legacyXiaotaoCreditGuard, adminClient,
    env: name => name === 'NOVAFLOW_LEGACY_UI_CREDIT_MAINTENANCE' && state.maintenance ? 'true' : '',
    MAX_GROK_IMAGE_BODY_BYTES: 1024 * 1024,
    parseJsonBody: async req => req.payload,
    jsonResponse: (_req, status, body) => ({ status, body }),
    errorHttpStatus: (_error, fallback) => fallback, sanitizeError: error => String(error.message),
    buildGrokPromptOptimizeRequest: request, buildGrokImageReverseRequest: request,
    uiCatalogResponsesRequest: request, grokModel: () => 'synthetic', runningHubLlm: () => ({ model: 'synthetic' }),
    chargeOnlineAi: async (_user, { run, feature }) => {
      state.calls.reserve++;
      const result = await run({ amount: 3 });
      state.calls.settle++;
      return { value: result.value, quota: { feature } };
    },
    callGrokResponse: async () => { state.calls.provider++; if (options.waitProvider) await options.waitProvider; return grokResult; },
    postRunningHubResponses: async () => { state.calls.provider++; return { data: { status: 'completed', model: 'synthetic', output: [] }, requestId: 'synthetic' }; },
    responsesOutputText: () => 'synthetic catalog',
    publicUser: () => ({}), creditQuotaPayload: () => ({}), publicCreditError: x => x,
    miniMaxH3FailureEnvelope: () => ({}), miniMaxH3ReversePreflightFailure: () => null,
    readProviderQuota: async () => ({}), grokVisualFailureEnvelope: () => ({}),
  };
  const factory = new Function(...Object.keys(deps), `${code}\nreturn { prompt: handleGrokPromptOptimize, reverse: handleGrokImageReverse, catalog: handleRunningHubUiCatalog };`);
  const handlers = factory(...Object.values(deps));
  return { state, invoke: (route, payload = ui) => handlers[route]({ payload }, session) };
}

test('all three old UI requests are rejected before reserve or provider under decimal policy', async () => {
  for (const route of routes) {
    const f = fixture();
    const response = await f.invoke(route);
    assert.equal(response.status, 409, route);
    assert.equal(response.body.errorCode, 'xiaotao_client_refresh_required');
    assert.equal(f.state.calls.reserve, 0); assert.equal(f.state.calls.provider, 0);
  }
  for (const route of ['prompt', 'reverse']) {
    const f = fixture();
    assert.equal((await f.invoke(route, { purpose: 'ui-design-reference', requestId: ui.requestId })).status, 409);
    assert.equal(f.state.calls.reserve, 0);
  }
});

test('263 independent UI contract reaches existing feature charge for each route', async () => {
  for (const route of routes) {
    const f = fixture();
    const result = await f.invoke(route, direct);
    assert.equal(result.status, 200, `${route}: ${JSON.stringify(result.body)}`);
    assert.deepEqual(f.state.calls, { config: 1, reserve: 1, provider: 1, settle: 1 });
  }
});

test('real-shape legacy defaults remain usable; broken config and partial decimal fail closed', async () => {
  for (const route of routes) {
    const old = fixture(base);
    assert.equal((await old.invoke(route)).status, 200, route);
    const corrupt = fixture({ ...base, token_billing: {} });
    assert.equal((await corrupt.invoke(route, direct)).status, 503, route);
    assert.equal(corrupt.state.calls.reserve, 0);
    const partial = fixture({ ...base, xiaotao_online: { credit_precision: 6 } });
    assert.equal((await partial.invoke(route, direct)).status, 503, route);
    assert.equal(partial.state.calls.provider, 0);
    const unavailable = fixture(new Error('synthetic config unavailable'));
    assert.equal((await unavailable.invoke(route, direct)).status, 503, route);
    assert.equal(unavailable.state.calls.reserve, 0);
  }
});

test('maintenance stops the three affected entrances, not unrelated reverse', async () => {
  for (const route of routes) {
    const f = fixture(base); f.state.maintenance = true;
    const response = await f.invoke(route, direct);
    assert.equal(response.status, 503, route);
    assert.equal(response.body.errorCode, 'legacy_ui_credit_maintenance');
    assert.equal(f.state.calls.reserve, 0); assert.equal(f.state.calls.provider, 0);
  }
  const unrelated = fixture(base); unrelated.state.maintenance = true;
  assert.equal((await unrelated.invoke('reverse', { surface: 'art', purpose: 'image-reverse' })).status, 200);
  assert.equal(unrelated.state.calls.reserve, 1);
});

test('an already reserved synthetic request finishes after maintenance is enabled', async () => {
  let releaseProvider;
  const waitProvider = new Promise(resolve => { releaseProvider = resolve; });
  const f = fixture(base, { waitProvider });
  const pending = f.invoke('prompt', ui);
  for (let i = 0; i < 30 && !f.state.calls.provider; i++) await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal(f.state.calls.reserve, 1); assert.equal(f.state.calls.provider, 1);
  f.state.maintenance = true;
  releaseProvider();
  assert.equal((await pending).status, 200);
  assert.equal(f.state.calls.settle, 1);
  assert.equal((await f.invoke('prompt', ui)).status, 503);
  assert.equal(f.state.calls.reserve, 1);
});
