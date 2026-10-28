// Browser copy of the online credit card. The node module
// packages/shared/src/feature-credits.mjs is the charge-path source.
// tests/e2e/feature-credits.test.mjs fails if these quotes diverge.
(function (root) {
  var DEFAULT_PRICES = {
    xiaotao_vision: 4,
    online_chat_turn: 4,
    prompt_optimize: 4,
    image_reverse: 4,
    lean_research: 14,
    gpt_image_2_5_economy: 22,
    gpt_image_2_official: 4,
    grok_image_g42: 6,
    local: 0
  };
  var PER_IMAGE = {
    gpt_image_2_5_economy: 1,
    gpt_image_2_official: 1,
    grok_image_g42: 1,
    gpt_image_2_5_token: 1
  };
  var ALIASES = {
    'xiaotao-vision': 'xiaotao_vision',
    'xiaotao-text': 'online_chat_turn',
    'online-chat-turn': 'online_chat_turn',
    'prompt-optimize': 'prompt_optimize',
    'image-reverse': 'image_reverse',
    'video-reverse': 'image_reverse',
    'ui-catalog': 'lean_research',
    'lean-research': 'lean_research',
    'gpt-image-2.5': 'gpt_image_2_5_economy',
    'gpt-image-2.5-economy': 'gpt_image_2_5_economy',
    gpt_image_2_5: 'gpt_image_2_5_economy',
    'gpt-image-2': 'gpt_image_2_official',
    gpt_image_2: 'gpt_image_2_official',
    'g-4.2': 'grok_image_g42',
    'grok-image-g42': 'grok_image_g42',
    local: 'local'
  };
  var config = null;

  function canonical(feature) {
    var raw = String(feature || '').trim();
    if (!raw) return '';
    if (raw === 'local' || raw.indexOf('local_') === 0 || raw.indexOf('local-') === 0) return 'local';
    if (Object.prototype.hasOwnProperty.call(ALIASES, raw)) return ALIASES[raw];
    var underscored = raw.replace(/-/g, '_');
    if (Object.prototype.hasOwnProperty.call(ALIASES, underscored)) return ALIASES[underscored];
    return underscored;
  }

  function prices() {
    var table = {};
    var key;
    for (key in DEFAULT_PRICES) table[key] = DEFAULT_PRICES[key];
    var stored = config && config.prices && typeof config.prices === 'object' ? config.prices : {};
    for (key in stored) {
      var name = canonical(key);
      var amount = Math.round(Number(stored[key]));
      if (name && amount >= 0) table[name] = amount;
    }
    table.local = 0;
    return table;
  }

  function quoteFeature(input) {
    var spec = input || {};
    var key = canonical(spec.feature);
    var table = prices();
    var perImage = !!PER_IMAGE[key];
    var count = perImage ? Math.max(1, Math.min(100, Math.round(Number(spec.units)) || 1)) : 1;
    if (!key || key === 'local') return { feature: 'local', units: count, credits: 0, local: true };
    if (!Object.prototype.hasOwnProperty.call(table, key) || table[key] == null) {
      return { feature: key, units: count, credits: null, unpriced: true, local: false };
    }
    var unit = Math.max(0, Math.round(Number(table[key])));
    return { feature: key, units: count, unitPrice: unit, credits: unit * count, local: unit === 0, perImage: perImage };
  }

  root.NovaFlowFeatureCreditPrices = {
    quoteFeature: quoteFeature,
    applyConfig: function (next) { config = next && typeof next === 'object' ? next : null; },
    defaults: DEFAULT_PRICES
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
