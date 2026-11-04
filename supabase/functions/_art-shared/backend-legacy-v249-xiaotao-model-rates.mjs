// GENERATED COPY - source: packages/shared/src/backend-legacy-v249-xiaotao-model-rates.mjs
// RunningHub standard LLM catalogue snapshot, checked 2026-10-31.
// USD per million tokens. These rates estimate charges from usage: they are
// not a provider invoice. DeepSeek is intentionally excluded because the
// catalogue does not specify peak/off-peak boundaries or timezone.
const RATES = Object.freeze({
  'glm/glm-5.3-flash': Object.freeze({ input: 0.12, output: 0.4, cached: 0.024 }),
  'openai/gpt-6.1-sol-saver': Object.freeze({ input: 0.7, output: 3.5, cached: 0.035,
    highInput: 1.4, highOutput: 5.25, highAbove: 272000 })
});

export function hasXiaotaoModelRate(model) {
  return Object.hasOwn(RATES, String(model || '').trim());
}

function count(value) {
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) value = Number(value);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function ratesFor(model, config) {
  const defaults = RATES[model];
  if (!defaults) return null;
  const entry = config?.xiaotao_online?.model_rates?.[model];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return {...defaults, snapshot:'runninghub-2026-10-31'};
  const resolved = {...defaults};
  for (const key of ['input','output','cached','highInput','highOutput']) {
    if (!(key in defaults) || entry[key] == null || entry[key] === '' || typeof entry[key] === 'boolean') continue;
    const n = Number(entry[key]);
    if (Number.isFinite(n) && n >= 0 && n <= 1000) resolved[key] = n;
  }
  // A changed tier threshold must be a non-negative safe integer.
  if ('highAbove' in defaults && Number.isSafeInteger(entry.highAbove) && entry.highAbove >= 0) resolved.highAbove = entry.highAbove;
  return {...resolved, snapshot:typeof entry.snapshot === 'string' && entry.snapshot.trim() ? entry.snapshot.trim().slice(0,80) : 'configured-rates'};
}

// A safe public price policy for the client estimator; no credentials.
export function xiaotaoModelRatePolicy(input) {
  const config = {xiaotao_online:{model_rates:input}};
  return Object.fromEntries(Object.keys(RATES).map(model => [model, ratesFor(model, config)]));
}

// A price tier applies per provider request, not to the sum of several calls.
// Missing cache details mean no known hits, and are explicitly marked unknown.
export function estimateXiaotaoModelUsage(model, record, config) {
  const rates = ratesFor(String(model || '').trim(), config);
  if (!rates || !record || typeof record !== 'object') return null;
  const input = count(record.input_tokens ?? record.prompt_tokens);
  const output = count(record.output_tokens ?? record.completion_tokens);
  const total = record.total_tokens == null ? null : count(record.total_tokens);
  if (input == null || output == null || input + output <= 0 ||
      (record.total_tokens != null && (total == null || total !== input + output))) return null;
  const details = record.input_tokens_details ?? record.prompt_tokens_details;
  const cachedRaw = details && typeof details === 'object' ? details.cached_tokens : undefined;
  const cached = cachedRaw == null ? 0 : count(cachedRaw);
  if (cached == null || cached > input) return null;
  const high = rates.highAbove != null && input > rates.highAbove;
  const inputRate = high ? rates.highInput : rates.input;
  const outputRate = high ? rates.highOutput : rates.output;
  return { usd: ((input - cached) * inputRate + cached * rates.cached + output * outputRate) / 1e6,
    inputTokens: input, outputTokens: output, cachedTokens: cached, cacheKnown: cachedRaw != null,
    inputRate, outputRate, cachedRate: rates.cached, rateSnapshot: rates.snapshot };
}

export function estimateXiaotaoModelBudget(model, input, output, config) {
  return estimateXiaotaoModelUsage(model, {input_tokens: input, output_tokens: output}, config);
}
