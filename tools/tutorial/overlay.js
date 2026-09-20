/* Tutorial overlay: synthetic cursor, caption bar, step badge, highlight ring, title card.
   Injected into the running NovaFlow page; it only draws, it never intercepts input. */
(function () {
  if (window.__tut && window.__tut.ready) return 'already';
  const Z = 2147483600;
  const root = document.createElement('div');
  root.id = 'novaflow-tutorial-overlay';
  root.style.cssText = [
    'position:fixed', 'inset:0', 'pointer-events:none', 'z-index:' + Z,
    'font-family:"Microsoft YaHei","PingFang SC","Segoe UI",system-ui,sans-serif'
  ].join(';');

  const style = document.createElement('style');
  style.textContent = [
    '#novaflow-tutorial-overlay .nf-cursor{position:absolute;left:0;top:0;width:26px;height:26px;',
    '  will-change:transform;opacity:0;filter:drop-shadow(0 2px 4px rgba(0,0,0,.6))}',
    '#novaflow-tutorial-overlay .nf-ripple{position:absolute;left:0;top:0;width:14px;height:14px;',
    '  margin:-7px 0 0 -7px;border-radius:50%;background:rgba(56,224,168,.5);',
    '  box-shadow:0 0 0 2px rgba(56,224,168,.9);opacity:0}',
    '#novaflow-tutorial-overlay .nf-ring{position:absolute;border:2px solid rgba(56,224,168,.95);',
    '  border-radius:10px;box-shadow:0 0 18px rgba(56,224,168,.5);opacity:0;',
    '  transition:opacity .25s ease,left .3s ease,top .3s ease,width .3s ease,height .3s ease}',
    '#novaflow-tutorial-overlay .nf-caption{position:absolute;left:50%;bottom:34px;',
    '  transform:translateX(-50%);max-width:78%;padding:13px 22px;border-radius:13px;',
    '  background:rgba(10,14,19,.9);border:1px solid rgba(255,255,255,.1);',
    '  box-shadow:0 10px 34px rgba(0,0,0,.5);color:#f2f5f7;font-size:20px;line-height:1.5;',
    '  letter-spacing:.3px;text-align:center;opacity:0;transition:opacity .22s ease}',
    '#novaflow-tutorial-overlay .nf-caption .nf-sub{display:block;margin-top:5px;font-size:15px;',
    '  color:#9fb0bd;letter-spacing:.2px}',
    '#novaflow-tutorial-overlay .nf-badge{position:absolute;left:26px;top:22px;padding:8px 15px;',
    '  border-radius:999px;background:rgba(10,14,19,.86);border:1px solid rgba(56,224,168,.35);',
    '  color:#38e0a8;font-size:15px;letter-spacing:.5px;opacity:0;transition:opacity .22s ease}',
    '#novaflow-tutorial-overlay .nf-title{position:absolute;inset:0;display:flex;',
    '  flex-direction:column;align-items:center;justify-content:center;background:rgba(6,9,12,.94);',
    '  opacity:0;transition:opacity .4s ease}',
    '#novaflow-tutorial-overlay .nf-title h1{margin:0;color:#fff;font-size:46px;font-weight:600;',
    '  letter-spacing:2px}',
    '#novaflow-tutorial-overlay .nf-title .nf-desc{margin:16px 0 0;color:#8fa2b0;font-size:19px;',
    '  letter-spacing:1px}',
    '#novaflow-tutorial-overlay .nf-title .nf-kicker{margin:0 0 20px;color:#38e0a8;font-size:15px;',
    '  letter-spacing:6px}',
    '#novaflow-tutorial-overlay .nf-ff{position:absolute;right:26px;top:22px;padding:7px 14px;',
    '  border-radius:999px;background:rgba(10,14,19,.86);border:1px solid rgba(255,255,255,.14);',
    '  color:#cfd9e0;font-size:14px;letter-spacing:1px;opacity:0;transition:opacity .22s ease}'
  ].join('\n');

  root.innerHTML = [
    '<div class="nf-ring"></div>',
    '<div class="nf-ripple"></div>',
    '<svg class="nf-cursor" viewBox="0 0 26 26">',
    '  <path d="M4 2 L4 20 L9 15.4 L12.2 22.6 L15.6 21.1 L12.4 14.1 L19 13.9 Z"',
    '        fill="#ffffff" stroke="#0d1216" stroke-width="1.6" stroke-linejoin="round"/>',
    '</svg>',
    '<div class="nf-badge"></div>',
    '<div class="nf-ff">&#9654;&#9654; 生成过程已加速</div>',
    '<div class="nf-caption"><span class="nf-main"></span><span class="nf-sub"></span></div>',
    '<div class="nf-title"><p class="nf-kicker"></p><h1></h1><p class="nf-desc"></p></div>'
  ].join('');

  document.documentElement.appendChild(style);
  document.documentElement.appendChild(root);

  const pick = (s) => root.querySelector(s);
  const cursor = pick('.nf-cursor');
  const ripple = pick('.nf-ripple');
  const ring = pick('.nf-ring');
  const cap = pick('.nf-caption');
  const capMain = pick('.nf-main');
  const capSub = pick('.nf-sub');
  const badge = pick('.nf-badge');
  const titleCard = pick('.nf-title');
  const ffBadge = pick('.nf-ff');

  let pos = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const draw = () => {
    cursor.style.transform = 'translate(' + (pos.x - 3) + 'px,' + (pos.y - 2) + 'px)';
  };
  draw();

  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  const api = {
    ready: true,
    pos: () => ({ x: pos.x, y: pos.y }),
    showCursor(on) { cursor.style.opacity = on ? '1' : '0'; },
    jump(x, y) { pos = { x: x, y: y }; draw(); cursor.style.opacity = '1'; },
    moveTo(x, y, ms) {
      return new Promise((resolve) => {
        cursor.style.opacity = '1';
        const from = { x: pos.x, y: pos.y };
        const dur = Math.max(1, ms || 520);
        const t0 = performance.now();
        const step = (now) => {
          const k = Math.min(1, (now - t0) / dur);
          const e = easeInOut(k);
          pos = { x: from.x + (x - from.x) * e, y: from.y + (y - from.y) * e };
          draw();
          if (k < 1) requestAnimationFrame(step); else resolve(true);
        };
        requestAnimationFrame(step);
      });
    },
    ripple() {
      ripple.style.transition = 'none';
      ripple.style.left = pos.x + 'px';
      ripple.style.top = pos.y + 'px';
      ripple.style.transform = 'scale(.5)';
      ripple.style.opacity = '1';
      requestAnimationFrame(() => {
        ripple.style.transition = 'transform .45s ease-out, opacity .45s ease-out';
        ripple.style.transform = 'scale(2.6)';
        ripple.style.opacity = '0';
      });
    },
    spot(x, y, w, h) {
      if (x === null || x === undefined) { ring.style.opacity = '0'; return; }
      ring.style.left = (x - 6) + 'px';
      ring.style.top = (y - 6) + 'px';
      ring.style.width = (w + 12) + 'px';
      ring.style.height = (h + 12) + 'px';
      ring.style.opacity = '1';
    },
    say(text, sub) {
      if (!text) { cap.style.opacity = '0'; return; }
      capMain.textContent = text;
      capSub.textContent = sub || '';
      capSub.style.display = sub ? 'block' : 'none';
      cap.style.opacity = '1';
    },
    step(text) {
      if (!text) { badge.style.opacity = '0'; return; }
      badge.textContent = text;
      badge.style.opacity = '1';
    },
    ff(on) { ffBadge.style.opacity = on ? '1' : '0'; },
    title(kicker, name, desc) {
      titleCard.querySelector('.nf-kicker').textContent = kicker || '';
      titleCard.querySelector('h1').textContent = name || '';
      titleCard.querySelector('.nf-desc').textContent = desc || '';
      titleCard.style.opacity = '1';
    },
    hideTitle() { titleCard.style.opacity = '0'; },
    rect(sel) {
      const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
    },
    rectOfText(text, opts) {
      const o = opts || {};
      const tags = o.tags || 'button,[role=button],a,label,li,div,span';
      const wanted = o.contains ? null : text;
      const box = o.within || null;
      const list = [...document.querySelectorAll(tags)].filter((el) => {
        const t = (el.textContent || '').trim();
        const hit = wanted === null ? t.indexOf(text) >= 0 : t === wanted;
        if (!hit) return false;
        const r = el.getBoundingClientRect();
        if (r.width < 3 || r.height < 3) return false;
        if (r.bottom < 0 || r.top > window.innerHeight) return false;
        if (box) {
          const cx = r.x + r.width / 2;
          const cy = r.y + r.height / 2;
          if (box.x0 != null && cx < box.x0) return false;
          if (box.x1 != null && cx > box.x1) return false;
          if (box.y0 != null && cy < box.y0) return false;
          if (box.y1 != null && cy > box.y1) return false;
        }
        const cs = getComputedStyle(el);
        return cs.visibility !== 'hidden' && cs.display !== 'none';
      });
      if (!list.length) return null;
      const area = (el) => {
        const r = el.getBoundingClientRect();
        return r.width * r.height;
      };
      const el = list.sort((a, b) => area(a) - area(b))[0];
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
    }
  };
  window.__tut = api;
  return 'ok';
})();
