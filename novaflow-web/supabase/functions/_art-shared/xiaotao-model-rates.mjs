// GENERATED COPY - source: packages/shared/src/xiaotao-model-rates.mjs
// RunningHub standard LLM catalogue snapshot, checked 2026-10-31.
// USD per million tokens. These rates determine Foart credits from usage and
// are not a provider invoice. DeepSeek uses the approved fixed peak user rate.
// Qwen and GLM use the higher (non-discount) listed rate, checked 2026-11-04.
// Source: https://www.runninghub.ai/call-api/llm/models (busy-time selection).
const RATES = Object.freeze({
  'deepseek/deepseek-v4.1-flash': Object.freeze({ input: 0.177, output: 0.7062, cached: 0.0036 }),
  'qwen/qwen3.8-flash-next': Object.freeze({ input: 0.118, output: 0.398, cached: 0.015 }),
  'glm/glm-5.3-flash': Object.freeze({ input: 0.15, output: 0.5, cached: 0.024 }),
  'bytedance/doubao-seed-2.1-lite': Object.freeze({ input: 0.0826, output: 0.2786, cached: 0.0168 }),
  'openai/gpt-6-luna-saver': Object.freeze({ input: 0.035, output: 0.175, cached: 0.0035 }),
  'openai/gpt-6.1-sol-saver': Object.freeze({ input: 0.7, output: 3.5, cached: 0.035,
    highInput: 1.4, highOutput: 5.25, highAbove: 272000 })
});

const SNAPSHOTS = Object.freeze({
  'deepseek/deepseek-v4.1-flash': 'runninghub-fixed-peak-2026-11-01',
  'qwen/qwen3.8-flash-next': 'runninghub-2026-11-04',
  'glm/glm-5.3-flash': 'runninghub-peak-2026-11-04',
  'bytedance/doubao-seed-2.1-lite': 'runninghub-2026-11-05',
  'openai/gpt-6-luna-saver': 'runninghub-2026-11-05'
});

export function hasXiaotaoModelRate(model) {
  return Object.hasOwn(RATES, String(model || '').trim());
}

function count(value) {
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) value = Number(value);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

// Preserve and cross-check provider counters before any alias flattening.
export function invalidXiaotaoTokenUsage(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record) || record.tokenUsage != null || record.token_usage != null) return true;
  for (const keys of [['input_tokens','prompt_tokens'],['output_tokens','completion_tokens'],['total_tokens']]) {
    const aliases=keys.map(key=>record[key]).filter(value=>value!=null).map(count);
    if (aliases.some(value=>value==null) || new Set(aliases).size>1) return true;
  }
  const details=['input_tokens_details','prompt_tokens_details'].map(key=>record[key]).filter(value=>value!=null);
  if (details.some(value=>!value || typeof value!=='object' || Array.isArray(value))) return true;
  const hits=details.map(value=>value.cached_tokens).filter(value=>value!=null).map(count);
  if (hits.some(value=>value==null) || new Set(hits).size>1) return true;
  const input=count(record.input_tokens ?? record.prompt_tokens);
  const topHit=record.prompt_cache_hit_tokens==null ? undefined : count(record.prompt_cache_hit_tokens);
  const topMiss=record.prompt_cache_miss_tokens==null ? undefined : count(record.prompt_cache_miss_tokens);
  if (topHit===null || topMiss===null || (topHit!==undefined && hits.length && topHit!==hits[0])) return true;
  const knownHit=hits[0] ?? topHit;
  if (knownHit!==undefined && (input==null || knownHit>input)) return true;
  if (topMiss!==undefined && (input==null || knownHit===undefined || knownHit+topMiss!==input)) return true;
  return false;
}

function ratesFor(model, config) {
  const defaults = RATES[model];
  if (!defaults) return null;
  const entry = config?.xiaotao_online?.model_rates?.[model];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return {...defaults, snapshot:SNAPSHOTS[model] || 'runninghub-2026-10-31'};
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
  if (!rates || invalidXiaotaoTokenUsage(record)) return null;
  const input = count(record.input_tokens ?? record.prompt_tokens);
  const output = count(record.output_tokens ?? record.completion_tokens);
  const total = record.total_tokens == null ? null : count(record.total_tokens);
  if (input == null || output == null || !Number.isSafeInteger(input + output) || input + output <= 0 ||
      (record.total_tokens != null && (total == null || total !== input + output))) return null;
  const cachedRaw = [record.input_tokens_details,record.prompt_tokens_details]
    .map(details=>details?.cached_tokens).find(value=>value!=null) ?? record.prompt_cache_hit_tokens;
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
