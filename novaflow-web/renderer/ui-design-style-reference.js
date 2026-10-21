(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.NovaFlowUiDesignStyleReference = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';
  // A deterministic appearance sample: small circular crops in a new irregular
  // arrangement. It removes the original page arrangement; individual patches
  // can still contain text or object fragments.
  // This is conditioning preprocessing; it does not change the uploaded original.
  const KIND = 'local-style-samples-v1';
  const POSITIONS = [[.13,.17,.25,.22,76],[.50,.31,.61,.18,82],[.85,.48,.83,.44,70],
    [.18,.60,.25,.57,85],[.54,.78,.60,.78,92],[.84,.86,.84,.84,61]];
  function plan(width, height) {
    if (!(width > 0 && height > 0)) throw new Error('风格参考尺寸无效');
    const edge = Math.max(16, Math.round(Math.min(width, height) * .14));
    return POSITIONS.map(([sx, sy, dx, dy, radius]) => ({
      x: Math.max(0, Math.min(width - edge, Math.round(sx * width - edge / 2))),
      y: Math.max(0, Math.min(height - edge, Math.round(sy * height - edge / 2))),
      width: edge, height: edge, cx: Math.round(dx * 512), cy: Math.round(dy * 512), radius,
    }));
  }
  async function hash(dataUrl) {
    if (!root.crypto?.subtle) throw new Error('无法记录风格采样来源，生成未提交');
    const bytes = Uint8Array.from(root.atob(dataUrl.split(',')[1]), char => char.charCodeAt(0));
    return Array.from(new Uint8Array(await root.crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  function loader(options) {
    return options.loadImage || (url => new Promise((resolve, reject) => {
      const image = new root.Image(); image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('风格参考无法读取，生成未提交')); image.src = url;
    }));
  }
  async function sample(reference, options = {}) {
    const image = options.image || await loader(options)(reference.dataUrl), width = Number(image.naturalWidth || image.width), height = Number(image.naturalHeight || image.height);
    const canvas = options.createCanvas ? options.createCanvas(512, 512) : root.document.createElement('canvas');
    canvas.width = canvas.height = 512;
    const ctx = canvas.getContext('2d'), samples = plan(width, height);
    ctx.fillStyle = '#eeeeec'; ctx.fillRect(0, 0, 512, 512);
    for (const patch of samples) {
      ctx.save(); ctx.beginPath(); ctx.arc(patch.cx, patch.cy, patch.radius, 0, Math.PI * 2); ctx.clip();
      ctx.drawImage(image, patch.x, patch.y, patch.width, patch.height,
        patch.cx - patch.radius, patch.cy - patch.radius, patch.radius * 2, patch.radius * 2); ctx.restore();
    }
    const dataUrl = canvas.toDataURL('image/png');
    return { ...reference, originalDataUrl: reference.dataUrl, mimeType: 'image/png', dataUrl, width: 512, height: 512,
      uiReferenceTreatment: {kind: KIND, sourceId: reference.id, sourceSHA256: await hash(reference.dataUrl),
        conditioningSHA256: await hash(dataUrl), originalSize: [width, height], conditioningSize: [512, 512], samples} };
  }
  async function prepare(references, modelPlan, options = {}) {
    // Explicit component construction needs the full authored design language.
    const eligible = options.preservePageDesignLanguage !== true && modelPlan?.visualMode === 'theme-redesign' && modelPlan?.layoutMode === 'preserve';
    const output = [];
    for (let i = 0; i < references.length; i++) {
      const reference = references[i], explicitStyle = reference.role === 'style';
      // Leave local material cutouts alone. Only large, page-shaped references
      // need their competing spatial arrangement removed. Inferred roles do not
      // authorize transforming an undeclared image.
      if (!eligible || !explicitStyle || i + 1 === modelPlan.layoutReference) { output.push(reference); continue; }
      // Uploaded slots need not carry dimensions. Inspect the actual image,
      // rather than relying on runner metadata or a stale caller-supplied size.
      const image = await loader(options)(reference.dataUrl);
      const width = Number(image.naturalWidth || image.width), height = Number(image.naturalHeight || image.height);
      const ratio = Math.max(width / height, height / width);
      const pageSized = width * height >= 250000 && ratio >= 1.4;
      output.push(pageSized ? await sample(reference, {...options, image}) : reference);
    }
    return output;
  }
  function show(references, documentRef = root.document) {
    const grid = documentRef?.querySelector?.('[data-novaflow-art-generate-reference-column]');
    if (!grid?.appendChild || !documentRef?.createElement) return;
    grid.querySelector?.('[data-ui-style-samples]')?.remove();
    const transformed = references.filter(ref => ref.uiReferenceTreatment);
    if (!transformed.length) return;
    const row = documentRef.createElement('div'); row.setAttribute('data-ui-style-samples', '1');
    row.style.cssText = 'grid-column:1/-1;display:flex;gap:8px;flex-wrap:wrap;font-size:11px;color:#bbb;';
    transformed.forEach(ref => {
      const card = documentRef.createElement('div'), image = documentRef.createElement('img'), label = documentRef.createElement('div');
      image.src = ref.dataUrl; image.alt = '实际送入模型的风格采样'; image.style.cssText = 'width:64px;height:64px;object-fit:contain;border-radius:6px';
      label.textContent = `${ref.name || ref.id} · 风格采样（原图保留）`;
      card.title = '只采样局部材质与配色，降低整页布局干扰；原上传图未修改。'; card.append(image, label); row.appendChild(card);
    });
    grid.appendChild(row);
  }
  return Object.freeze({KIND, plan, sample, prepare, show});
});
