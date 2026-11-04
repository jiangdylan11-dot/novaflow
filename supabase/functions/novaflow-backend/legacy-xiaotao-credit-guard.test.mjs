import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { legacyXiaotaoCreditGuard } from './legacy-xiaotao-credit-guard.mjs';

const require = createRequire(new URL('../../../novaflow-web/package.json', import.meta.url));
const ts = require('typescript');
const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
const start = source.indexOf('async function legacyCreditGate(');
const end = source.indexOf('async function handleGrokImageReverse(', start);
assert.ok(start >= 0 && end > start, 'actual handler must be found');
const code = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
}).outputText;

const oldXiaotao = { surface: 'art', purpose: 'optimize', targetEngine: 'gpt-image-2.5', completeVisualBrief: true, prompt: 'synthetic' };
const base = { prices: { prompt_optimize: 4, image_reverse: 4 }, credits_per_usd: 211,
  token_billing: { markup: 2, round: 'ceil', min_credits_per_image: 1, settle_cap_credits: 40, estimate_credits: { synthetic: 1 } } };
const decimal = { ...base, xiaotao_online: { credit_amount_policy: 'decimal-v1', credit_precision: 6, credit_rounding: 'ceil', minimum_positive_credits: 0 } };

function fixture(configResult) {
  const calls = { config: 0, reserve: 0, provider: 0 };
  const adminClient = () => ({ from(name) {
    assert.equal(name, 'system_settings');
    return { select(field) { assert.equal(field, 'value'); return { eq(key, val) {
      assert.equal(key, 'key'); assert.equal(val, 'feature_credit_config');
      return { async maybeSingle() { calls.config++; if (configResult instanceof Error) throw configResult; return configResult; } };
    } }; } };
  } });
  const deps = {
    legacyXiaotaoCreditGuard, adminClient, env: () => '', MAX_GROK_IMAGE_BODY_BYTES: 1024 * 1024,
    parseJsonBody: async req => req.payload,
    jsonResponse: (_req, status, body) => ({ status, body }),
    buildGrokPromptOptimizeRequest: () => ({ resultOptions: {}, body: {}, inputMeta: {} }),
    grokModel: () => 'synthetic',
    chargeOnlineAi: async (_user, { run }) => {
      calls.reserve++;
      const result = await run({ amount: 1 });
      return { value: result.value, quota: {} };
    },
    callGrokResponse: async () => { calls.provider++; return { data: { output_text: 'synthetic output' } }; },
    publicUser: () => ({}), creditQuotaPayload: () => ({}),
    errorHttpStatus: (_error, fallback) => fallback, sanitizeError: error => String(error.message),
    miniMaxH3FailureEnvelope: () => ({}), readProviderQuota: async () => ({}),
    publicCreditError: x => x,
  };
  const factory = new Function(...Object.keys(deps), `${code}\nreturn handleGrokPromptOptimize;`);
  const handle = factory(...Object.values(deps));
  return { calls, invoke: payload => handle({ payload }, { user: { id: 'synthetic-user' } }) };
}

test('decimal policy stops the identified old XiaoTao path before reservation and provider', async () => {
  const f = fixture({ data: { value: decimal }, error: null });
  const response = await f.invoke(oldXiaotao);
  assert.equal(response.status, 409);
  assert.equal(response.body.errorCode, 'xiaotao_client_refresh_required');
  assert.deepEqual(f.calls, { config: 1, reserve: 0, provider: 0 });
});

test('old policy continues the old path once; direct drawing does not query or get blocked', async () => {
  const old = fixture({ data: { value: { ...base, xiaotao_online: { minimum_positive_credits: 1 } } }, error: null });
  assert.equal((await old.invoke(oldXiaotao)).status, 200);
  assert.deepEqual(old.calls, { config: 1, reserve: 1, provider: 1 });
  const direct = fixture({ data: { value: decimal }, error: null });
  assert.equal((await direct.invoke({ ...oldXiaotao, completeVisualBrief: undefined })).status, 200);
  assert.deepEqual(direct.calls, { config: 0, reserve: 1, provider: 1 });
});

test('missing or failed config and malformed policy fail safely before dispatch', async () => {
  for (const result of [new Error('database down'), { data: null, error: null }, { data: { value: [] }, error: null }, { data: { value: { xiaotao_online: [] } }, error: null }]) {
    const f = fixture(result);
    const response = await f.invoke(oldXiaotao);
    assert.equal(response.status, 503);
    assert.equal(response.body.errorCode, 'xiaotao_credit_policy_unavailable');
    assert.equal(f.calls.reserve, 0);
    assert.equal(f.calls.provider, 0);
  }
});

test('incomplete policy fails closed and nested full decimal stops old pricing', async () => {
  for (const [value, expected] of [[{ ...base, xiaotao_online: { credit_precision: 6 } }, 503], [{ ...base, token_billing: { ...base.token_billing, xiaotao_online: decimal.xiaotao_online } }, 409]]) {
    const f = fixture({ data: { value }, error: null });
    assert.equal((await f.invoke(oldXiaotao)).status, expected);
    assert.equal(f.calls.reserve, 0);
    assert.equal(f.calls.provider, 0);
  }
});
