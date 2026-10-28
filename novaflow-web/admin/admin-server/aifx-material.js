// Cloud AIFX material recognition. Same material{} shape as local
// describe-art-style purpose=aifx-material. Callers stay outside the
// style-transfer implementation files.
const MATERIAL_FIELDS = Object.freeze(['name', 'material', 'elements', 'colours', 'breakup']);

function clip(value, max) {
  return String(value || '').trim().slice(0, max);
}

function parseAifxMaterialText(text) {
  const raw = String(text || '').trim().replace(/^```(?:json)?\s*|\s*```$/gi, '');
  let value;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const material = clip(value.material, 1000);
  if (!material) return null;
  const parsed = {
    name: clip(value.name, 60),
    material,
    elements: clip(value.elements, 600),
    colours: clip(value.colours || value.colors, 160),
    breakup: clip(value.breakup, 300)
  };
  return MATERIAL_FIELDS.every((key) => Object.prototype.hasOwnProperty.call(parsed, key)) ? parsed : null;
}

function buildAifxMaterialReverseRequest(payload, model) {
  const images = Array.isArray(payload?.images) ? payload.images : [];
  const image = images[0] && typeof images[0] === 'object' ? images[0] : {};
  const dataUrl = String(image.dataUrl || image.imageUrl || image.url || '');
  if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(dataUrl)) {
    const error = new Error('请先选择可分析的图片');
    error.statusCode = 400;
    throw error;
  }
  const instruction = [
    '你是材质识别器。只根据这张参考图输出一个 JSON 对象，不要解释，不要使用 Markdown。',
    '字段必须且只能是 name, material, elements, colours, breakup。',
    'name 是短英文材质名；material 是英文材质句；elements 是组成；colours 是可见颜色；breakup 是破碎、脱落或运动方式。',
    '看不清的字段用空字符串，不要编造画面里没有的东西。'
  ].join('\n');
  return {
    body: {
      model: String(model || ''),
      store: false,
      temperature: 0.2,
      max_output_tokens: 800,
      input: [{
        role: 'user',
        content: [
          { type: 'input_text', text: instruction },
          { type: 'input_image', image_url: dataUrl }
        ]
      }]
    },
    inputMeta: {
      mode: 'image_reverse',
      charCount: instruction.length,
      imageCount: 1,
      sourceImageCount: 1,
      scenario: 'aifx_material',
      targetIndex: 0,
      hasNegativePrompt: false,
      supportsNegativePrompt: false,
      visualIrSchema: ''
    },
    resultOptions: { aifxMaterial: true, requiredProviderCalls: 1 }
  };
}

module.exports = { MATERIAL_FIELDS, parseAifxMaterialText, buildAifxMaterialReverseRequest };
