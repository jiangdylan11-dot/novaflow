/* Preserve transparent controls. Normalize only existing painted button fills. */
(function () {
  'use strict';
  const excluded = '[role="switch"], [aria-checked], [data-novaflow-toggle-switch], [data-novaflow-ai-state-toggle], .novaflow-art-generate-ref, [data-nf-upload-dropzone], .nf-upload-dropzone, [data-novaflow-art-generate-state-toggle], [data-color], [data-color-value], [data-foart-button-theme="off"], [class*="swatch"], [class*="Swatch"]';
  function isButton(node) {
    return node instanceof HTMLElement && node.matches('button, [role="button"], input[type="button"], input[type="submit"]') && !node.matches(excluded);
  }
  function normalize(node, property, value) {
    if (!isButton(node)) return value;
    const generation = node.matches('[data-novaflow-ai-generate-button], [data-novaflow-art-generate-submit], .nf-as-go, .aifx-primary, .nf-vfe-apply');
    if (generation && property === 'color') return '#fff';
    if (property === 'border' || property === 'outline' || /border.*width$/.test(property)) return '0';
    if (/border.*color$/.test(property)) return 'transparent';
    if (property === 'box-shadow') return node.matches('.nf-xiaotao-robot') ? value : 'none';
    if (property !== 'background' && property !== 'background-color') return value;
    if (node.matches('[data-nf-cutout-panel-action], [data-novaflow-ai-cutout-save-bound], [data-novaflow-ai-sequence-save-button], #ve-save')) return '#272727';
    if (generation) return 'var(--foart-generation-green, #1ea672)';
    const text = String(value).trim().toLowerCase();
    // Variables and transparent/none are intentional: never add a plate to them.
    if (text.includes('var(') || /^(transparent|none)$/.test(text)) return value;
    let rgb, alpha = 1;
    const hex = text.match(/^#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i);
    if (hex) {
      let h = hex[1];
      if (h.length === 3) h = h.split('').map(c => c+c).join('');
      rgb = [0,2,4].map(i => parseInt(h.slice(i,i+2),16));
      if (h.length === 8) alpha = parseInt(h.slice(6,8),16)/255;
    } else {
      const m = text.match(/^rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/);
      if (m) { rgb=m.slice(1,4).map(Number); if (m[4]!==undefined) alpha=Number(m[4]); }
    }
    if (!rgb || alpha===0) return value;
    const [r,g,b]=rgb;
    if (g>r*1.2 && g>b*1.12) return Math.max(r,g,b)<100 || alpha<.5 ? '#1c4136' : 'var(--foart-action-green, rgba(30,166,114,.24))';
    if (Math.max(...rgb)-Math.min(...rgb)<=18) return '#272727';
    return value;
  }
  function compactUsageNotes(root = document) {
    // Explicit instructional copy only: shared "hint/note" classes also carry
    // filenames, prices, task progress and errors, which must remain visible.
    const instructions = /^(?:选择\s*PS\s*导出的图层工程文件夹|骨骼直接在画面里编辑|快捷键[：:]|滚轮缩放\s*[·•]|固定所选锚点)/;
    root.querySelectorAll('[data-novaflow-left-content-root] :is(div,p,small)').forEach(node => {
      if (node.childElementCount || node.hasAttribute('data-foart-usage-note')) return;
      const text = node.textContent.trim();
      if (!instructions.test(text)) return;
      const parent = node.parentElement;
      if (parent && !parent.title) parent.title = text;
      node.setAttribute('data-foart-usage-note', '1');
    });
  }
  window.FoartButtonTheme = Object.freeze({ normalize, isButton, compactUsageNotes });
})();
