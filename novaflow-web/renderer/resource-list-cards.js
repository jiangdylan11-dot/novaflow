// 资源列表 cards: the text side of the list form. The brand runtime lays the
// card out as a row (thumbnail left, text right, × at the right edge); this
// adds what the layout rules cannot: the file name on one line, the creation
// time hidden, and a facts line read off the card's own media
// ("448×448 2.4s", "图片 512×512", "音频 7.2s"), plus the ×'s hover reveal.
(function () {
  'use strict';
  if (window.NovaFlowResourceListCards) return;

  const CARD = '[data-novaflow-ai-resource-card="1"]';
  const STYLE_ID = 'novaflow-resource-list-cards-style';
  const META_ATTR = 'data-nf-card-meta';
  const CSS = `
    ${CARD} [data-novaflow-ai-resource-action-kind="close"]{opacity:0;transition:opacity .12s}
    ${CARD}:hover [data-novaflow-ai-resource-action-kind="close"]{opacity:1}
    ${CARD} [${META_ATTR}]{display:block;color:#8d8d8d;font-size:10px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    ${CARD} [data-nf-card-name="1"]{font-size:11px;font-weight:500;color:#e5ebf2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.3}
    ${CARD} [data-nf-card-time="1"]{display:none!important}
  `;

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.setAttribute('data-novaflow-runtime-ignore', '1');
    style.textContent = CSS;
    document.head.appendChild(style);
  }
  const textOf = (node) => (node && node.textContent || '').trim();
  const isTimeText = (t) => /^\d{1,2}:\d{2}(:\d{2})?$/.test(t);

  function mediaFacts(media) {
    if (media instanceof HTMLVideoElement) {
      if (!media.videoWidth) return '';
      const d = Number.isFinite(media.duration) ? media.duration.toFixed(1) + 's' : '';
      return media.videoWidth + '×' + media.videoHeight + (d ? ' ' + d : '');
    }
    if (media instanceof HTMLImageElement) return media.naturalWidth ? '图片 ' + media.naturalWidth + '×' + media.naturalHeight : '';
    if (media instanceof HTMLAudioElement) return Number.isFinite(media.duration) ? '音频 ' + media.duration.toFixed(1) + 's' : '音频';
    return '';
  }

  function annotate(card) {
    const thumbWrap = card.firstElementChild;
    const metaWrap = thumbWrap && thumbWrap.nextElementSibling;
    if (!(thumbWrap instanceof HTMLElement) || !(metaWrap instanceof HTMLElement)) return;
    const media = thumbWrap.querySelector('img, video, audio');
    const row = metaWrap.firstElementChild;
    const textBlock = row && row.lastElementChild;
    if (!(textBlock instanceof HTMLElement) || textBlock === row.firstElementChild) return;
    // the status dot before the text block and the creation time are inline-styled by
    // the bundle, so they are hidden inline too (nothing else writes these two nodes)
    const dot = row.firstElementChild;
    if (dot instanceof HTMLElement && dot !== textBlock && dot.style.getPropertyValue('display') !== 'none') dot.style.setProperty('display', 'none', 'important');
    Array.from(textBlock.children).forEach((line, index) => {
      if (!(line instanceof HTMLElement) || line.hasAttribute(META_ATTR)) return;
      if (index === 0 && !isTimeText(textOf(line))) { if (!line.hasAttribute('data-nf-card-name')) line.setAttribute('data-nf-card-name', '1'); }
      else if (isTimeText(textOf(line)) || line.hasAttribute('data-novaflow-ai-resource-timestamp')) {
        if (!line.hasAttribute('data-nf-card-time')) line.setAttribute('data-nf-card-time', '1');
        if (line.style.getPropertyValue('display') !== 'none') line.style.setProperty('display', 'none', 'important');
      }
    });
    let meta = textBlock.querySelector('[' + META_ATTR + ']');
    if (!meta) { meta = document.createElement('div'); meta.setAttribute(META_ATTR, '1'); meta.setAttribute('data-novaflow-runtime-ignore', '1'); textBlock.appendChild(meta); }
    const facts = mediaFacts(media);
    if (facts && meta.textContent !== facts) meta.textContent = facts;
    if (!facts && media instanceof HTMLElement && !media.hasAttribute('data-nf-card-meta-bound')) {
      media.setAttribute('data-nf-card-meta-bound', '1');
      media.addEventListener(media instanceof HTMLImageElement ? 'load' : 'loadedmetadata', () => annotate(card), { once: true });
    }
  }

  function annotateAll() { document.querySelectorAll(CARD).forEach(annotate); }
  let queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(() => { queued = false; annotateAll(); });
  }
  function start() {
    installStyle();
    annotateAll();
    // new cards and relabelled lines; our own writes are attributes on nodes already marked, so the pass converges
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-novaflow-ai-resource-card'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.NovaFlowResourceListCards = { annotate: annotateAll };
})();
