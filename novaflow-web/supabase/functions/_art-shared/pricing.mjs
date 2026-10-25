// GENERATED COPY - source: packages/shared/src/pricing.mjs
// NovaFlow Web - credit pricing.
//
// Spec 17: the trusted backend decides the cost. Neither the browser nor the
// worker may supply, influence or negotiate a number.
//
// WHAT COSTS CREDITS: only what a third party bills for - Grok, GPT, Google.
// Generation that runs on this pool's own GPUs is free, however many machines
// are in it and whoever owns them. Charging for someone's own hardware would
// be inventing a fee, not recovering one.
//
// The Desktop line settles ComfyUI usage with a client-reported
// `comfy_api_exact_price_v1` amount. That is a reasonable trust assumption for
// a signed desktop build talking to a ComfyUI on the same machine; it is NOT
// acceptable for a browser we do not control, so where the Web line does
// charge, it derives every cost here from validated business parameters only.
//
// Cost is expressed in credits with 6 decimals, matching the precision the
// existing settle_comfy_usage RPC enforces.

import { TASK_TYPE, isMetered } from './protocol.mjs';

// Base rates. Deliberately simple and auditable: a rate card, not a formula
// nobody can reproduce by hand.
export const PRICE_TABLE = Object.freeze({
  [TASK_TYPE.QWEN_T2I]: {
    // per megapixel of output, per 20 sampling steps
    perMegapixelPer20Steps: 1.2,
    minimum: 0.6
  },
  [TASK_TYPE.QWEN_EDIT]: {
    perMegapixelPer20Steps: 1.5,
    minimum: 0.8
  },
  [TASK_TYPE.H3_I2V]: {
    // per second of generated video at 720p-equivalent
    perSecondAt720p: 6.0,
    minimum: 12.0
  }
});

function round6(value) {
  return Math.round(Number(value) * 1e6) / 1e6;
}

function clampInt(value, min, max, fallback) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Derive the credit cost of a task from its business parameters.
 * Returns { creditCost, breakdown, source } - never throws for odd input; it
 * clamps instead, so a hostile browser gets a sane (and never cheaper) price.
 */
export function priceTask(taskType, parameters = {}) {
  const type = String(taskType || '');

  // Work that runs on this pool's own GPUs is free. Credits meter what a third
  // party bills for - Grok, GPT, Google - not somebody's own graphics card.
  if (!isMetered(type)) {
    return {
      creditCost: 0,
      source: 'novaflow_web_self_hosted_v1',
      breakdown: { billing: 'self_hosted', reason: '在自有算力上运行，不计积分' }
    };
  }
  return priceFromRateCard(type, parameters);
}

/**
 * The rate card itself, independent of who pays.
 *
 * Exported so it stays under test: every task type today is self-hosted and
 * therefore free, and a rate card nothing exercises is a rate card that has
 * quietly rotted by the time a provider-backed task type needs it.
 */
export function priceFromRateCard(taskType, parameters = {}) {
  const type = String(taskType || '');
  const params = parameters && typeof parameters === 'object' ? parameters : {};

  if (type === TASK_TYPE.QWEN_T2I || type === TASK_TYPE.QWEN_EDIT) {
    const rate = PRICE_TABLE[type];
    const width = clampInt(params.width, 256, 4096, 1024);
    const height = clampInt(params.height, 256, 4096, 1024);
    const steps = clampInt(params.steps, 1, 100, 20);
    const count = clampInt(params.count, 1, 10, 1);
    const megapixels = (width * height) / 1_000_000;
    const perImage = Math.max(
      rate.minimum,
      rate.perMegapixelPer20Steps * megapixels * (steps / 20)
    );
    const creditCost = round6(perImage * count);
    return {
      creditCost,
      source: 'novaflow_web_rate_card_v1',
      breakdown: { width, height, steps, count, megapixels: round6(megapixels), perImage: round6(perImage) }
    };
  }

  if (type === TASK_TYPE.H3_I2V) {
    const rate = PRICE_TABLE[type];
    const width = clampInt(params.width, 256, 2048, 1280);
    const height = clampInt(params.height, 256, 2048, 720);
    const duration = Math.min(30, Math.max(1, Number(params.duration_seconds) || 5));
    // 720p reference area; a bigger frame costs proportionally more.
    const areaRatio = (width * height) / (1280 * 720);
    const creditCost = round6(Math.max(rate.minimum, rate.perSecondAt720p * duration * areaRatio));
    return {
      creditCost,
      source: 'novaflow_web_rate_card_v1',
      breakdown: { width, height, duration, areaRatio: round6(areaRatio) }
    };
  }

  return { creditCost: 0, source: 'novaflow_web_rate_card_v1', breakdown: { unknownTaskType: type } };
}

/**
 * What the user is quoted before the task runs. Identical to the settled cost
 * in this version - we quote what we charge, so there is no surprise delta.
 */
export function estimateTask(taskType, parameters) {
  return priceTask(taskType, parameters);
}
