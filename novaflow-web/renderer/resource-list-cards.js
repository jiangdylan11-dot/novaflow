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
  const AUDIO_ATTR = 'data-nf-card-audio';
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

  // an audio result from 音频 is published as a "video" resource (a web-audio token):
  // its card <video> has a duration but no picture
  function isAudioOnly(media) {
    return media instanceof HTMLAudioElement || (media instanceof HTMLVideoElement && media.readyState >= 1 && !media.videoWidth && Number.isFinite(media.duration) && media.duration > 0);
  }
  function mediaFacts(media) {
    if (media instanceof HTMLVideoElement) {
      if (isAudioOnly(media)) return '音频 ' + media.duration.toFixed(1) + 's';
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
    // an audio card is for dragging onto a track; the board (视频) has nothing to show for it
    const audio = isAudioOnly(media);
    if (audio && card.getAttribute(AUDIO_ATTR) !== '1') card.setAttribute(AUDIO_ATTR, '1');
    else if (!audio && card.hasAttribute(AUDIO_ATTR)) card.removeAttribute(AUDIO_ATTR);
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
  // a click on an audio card must not load it onto the board (React would play its
  // sound behind an empty picture); its × and dragging still work
  function blockAudioCardLoad(event) {
    const target = event.target instanceof Element ? event.target : null;
    const card = target && target.closest('[' + AUDIO_ATTR + '="1"]');
    if (!card || target.closest('[data-novaflow-ai-resource-action-kind]')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  function start() {
    installStyle();
    annotateAll();
    for (const type of ['pointerdown', 'mousedown', 'click', 'dblclick']) document.addEventListener(type, blockAudioCardLoad, true);
    // new cards and relabelled lines; our own writes are attributes on nodes already marked, so the pass converges
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-novaflow-ai-resource-card'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.NovaFlowResourceListCards = { annotate: annotateAll };
})();
