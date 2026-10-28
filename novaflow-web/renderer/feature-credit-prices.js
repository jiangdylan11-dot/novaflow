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
    gpt_image_2_5_economy: 20,
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
    'aifx-material': 'image_reverse',
    aifx_material: 'image_reverse',
    'ui-catalog': 'lean_research',
    'lean-research': 'lean_research',
    'gpt-image-2.5': 'gpt_image_2_5_economy',
    'gpt-image-2.5-economy': 'gpt_image_2_5_economy',
    gpt_image_2_5: 'gpt_image_2_5_economy',
    'gpt-image-2.5-token': 'gpt_image_2_5_token',
    gpt_image_2_5_token: 'gpt_image_2_5_token',
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

  function previewText(feature, units) {
    var quoted = quoteFeature({ feature: feature, units: units });
    if (!quoted || quoted.local || quoted.credits === 0) return '本地处理不扣积分';
    if (quoted.credits == null) return '本次将扣积分';
    return '本次将扣 ' + quoted.credits + ' 积分';
  }

  var ESTIMATE = {
    '1k': { low: 3, medium: 6, high: 23 },
    '2k': { low: 6, medium: 12, high: 40 },
    '4k': { low: 12, medium: 24, high: 40 }
  };
  var TEXT_ENDPOINT = '/openapi/v2/rhart-image-g-2.5-official-token/sunburst/text-to-image';
  var IMAGE_ENDPOINT = '/openapi/v2/rhart-image-g-2.5/sunburst/image-to-image';

  function billingConfig() {
    var stored = config && config.token_billing && typeof config.token_billing === 'object' ? config.token_billing : {};
    var cap = Math.round(Number(stored.settle_cap_credits));
    if (!isFinite(cap) || cap < 1) cap = 40;
    var table = {};
    var resolution;
    var quality;
    for (resolution in ESTIMATE) {
      table[resolution] = {};
      var row = stored.estimate_credits && stored.estimate_credits[resolution] ? stored.estimate_credits[resolution] : {};
      for (quality in ESTIMATE[resolution]) {
        var amount = Math.round(Number(row[quality]));
        var chosen = isFinite(amount) && amount >= 0 ? amount : ESTIMATE[resolution][quality];
        table[resolution][quality] = Math.min(cap, chosen);
      }
    }
    var routes = config && config.gpt_image && typeof config.gpt_image === 'object' ? config.gpt_image : {};
    var perUsd = Number(config && config.credits_per_usd);
    var markup = Number(stored.markup);
    return {
      cap: cap,
      table: table,
      perUsd: isFinite(perUsd) && perUsd > 0 ? perUsd : 211,
      markup: isFinite(markup) && markup > 0 ? markup : 2,
      textEndpoint: routes.text_endpoint || TEXT_ENDPOINT,
      imageEndpoint: routes.image_endpoint || IMAGE_ENDPOINT,
      markers: routes.token_markers && routes.token_markers.length ? routes.token_markers : ['official-token']
    };
  }

  function shapeOf(settings) {
    var source = settings && typeof settings === 'object' ? settings : {};
    var quality = source.quality === 'low' || source.quality === 'high' ? source.quality : 'medium';
    var resolution = String(source.resolution || '').toLowerCase();
    if (resolution === '1k' || resolution === '2k' || resolution === '4k') return { resolution: resolution, quality: quality };
    var size = String(source.size || source.gptSize || '');
    if (size === '2048x2048' || size === '2048x1152' || size === '1152x2048') return { resolution: '2k', quality: quality };
    if (size === '3840x2160' || size === '2160x3840') return { resolution: '4k', quality: quality };
    var width = Math.round(Number(source.customWidth || source.gptCustomWidth || 1024));
    var height = Math.round(Number(source.customHeight || source.gptCustomHeight || 1024));
    var longEdge = Math.max(width, height);
    return { resolution: longEdge >= 3000 ? '4k' : longEdge >= 1600 ? '2k' : '1k', quality: quality };
  }

  function quoteGptImage(input) {
    var spec = input || {};
    var mode = spec.mode === 'img2img' ? 'img2img' : 'txt2img';
    var count = Math.max(1, Math.min(10, Math.round(Number(spec.count || spec.units) || 1)));
    var billing = billingConfig();
    var path = mode === 'img2img' ? (spec.imageEndpoint || billing.imageEndpoint) : (spec.endpoint || billing.textEndpoint);
    var feature = 'gpt_image_2_official';
    if (mode === 'img2img' || String(path).indexOf('image-to-image') >= 0) {
      feature = String(path).indexOf('2.5') >= 0 ? 'gpt_image_2_5_economy' : 'gpt_image_2_official';
    } else if (billing.markers.some(function (marker) { return marker && String(path).indexOf(marker) >= 0; })) {
      feature = 'gpt_image_2_5_token';
    } else if (String(path).indexOf('2.5') >= 0) {
      feature = 'gpt_image_2_5_economy';
    }
    if (feature === 'gpt_image_2_5_token') {
      var shape = shapeOf(spec.settings);
      var perImage = billing.table[shape.resolution][shape.quality];
      return {
        feature: feature,
        billingMode: 'token',
        perImage: perImage,
        credits: perImage * count,
        count: count,
        estimatedCreditsIsCap: true,
        settleCap: billing.cap,
        mayFallback: true,
        resolution: shape.resolution,
        quality: shape.quality,
        endpoint: path
      };
    }
    var quoted = quoteFeature({ feature: feature, units: count });
    return {
      feature: quoted.feature,
      billingMode: 'fixed',
      perImage: quoted.unitPrice,
      credits: quoted.credits,
      count: count,
      estimatedCreditsIsCap: false,
      mayFallback: String(path).indexOf('2.5') >= 0,
      endpoint: path
    };
  }

  function settlementText(quota) {
    if (!quota || quota.local) return '';
    var charged = quota.charged_credits != null ? quota.charged_credits : quota.settled_credits;
    if (charged == null || charged === '' || Number(charged) <= 0) return '';
    var remain = quota.balance_after;
    return '实扣 ' + charged + ' 积分' + (remain == null || remain === '' ? '' : '，剩余 ' + remain);
  }

  root.NovaFlowFeatureCreditPrices = {
    quoteFeature: quoteFeature,
    quoteGptImage: quoteGptImage,
    previewText: previewText,
    settlementText: settlementText,
    applyConfig: function (next) { config = next && typeof next === 'object' ? next : null; },
    defaults: DEFAULT_PRICES
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
