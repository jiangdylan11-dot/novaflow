// Isolated ten-bone thumbnails. The caller supplies the production ribbon solver;
// thumbnails never read or write the user's current project or animation.
(() => {
  "use strict";
  const cache = new Map();
  const svgNS = "http://www.w3.org/2000/svg";
  // Use the whip thumbnail's compact scale for every preset, including saved ones.
  // A quiet motion must not be magnified just because it has smaller bounds.
  const previewChainLength = 64;
  let stopActive = () => {};

  function sample(curve, time, duration) {
    const t = ((time % duration) + duration) % duration;
    let lo = 0, hi = curve.length - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (curve[mid].time <= t) lo = mid;
      else hi = mid;
    }
    const a = curve[lo], b = curve[hi];
    const u = Math.max(0, Math.min(1, (t - a.time) / Math.max(0.000001, b.time - a.time)));
    return a.angle + (b.angle - a.angle) * u;
  }

  function pose(data, time) {
    let x = 0, y = 0, angle = 0;
    const points = [[0, 0]];
    for (const curve of data.curves) {
      angle += sample(curve, time, data.duration) * Math.PI / 180;
      x += Math.cos(angle) * data.segmentLength;
      y += Math.sin(angle) * data.segmentLength;
      points.push([x, y]);
    }
    return points;
  }

  function prepare(values, solve) {
    const key = JSON.stringify(values);
    if (cache.has(key)) return cache.get(key);
    const data = solve(values);
    if (!data || data.curves?.length !== 10) throw new Error("Invalid ribbon thumbnail");
    const bounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    for (let frame = 0; frame <= 120; frame++) {
      for (const [x, y] of pose(data, frame * data.duration / 120)) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("Invalid ribbon pose");
        bounds.minX = Math.min(bounds.minX, x); bounds.maxX = Math.max(bounds.maxX, x);
        bounds.minY = Math.min(bounds.minY, y); bounds.maxY = Math.max(bounds.maxY, y);
      }
    }
    const model = { ...data, bounds };
    if (cache.size >= 40) cache.delete(cache.keys().next().value);
    cache.set(key, model);
    return model;
  }

  function node(tag, attributes, parent) {
    const element = document.createElementNS(svgNS, tag);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
    parent.appendChild(element);
    return element;
  }

  function paint(entry, time) {
    const { data } = entry;
    if (!data) return;
    const b = data.bounds, width = 128, height = 96;
    const scale = previewChainLength / (data.boneCount * data.segmentLength);
    const ox = (width - (b.maxX - b.minX) * scale) / 2 - b.minX * scale;
    const oy = (height - (b.maxY - b.minY) * scale) / 2 + b.maxY * scale;
    const points = pose(data, time).map(([x, y]) => [ox + x * scale, oy - y * scale]);
    const upper = [], lower = [];
    points.forEach((p, index) => {
      const a = points[Math.max(0, index - 1)], c = points[Math.min(10, index + 1)];
      const length = Math.max(0.00001, Math.hypot(c[0] - a[0], c[1] - a[1]));
      const halfWidth = Math.max(1.6, (12 - 7 * index / 10) * scale);
      const nx = -(c[1] - a[1]) / length * halfWidth, ny = (c[0] - a[0]) / length * halfWidth;
      upper.push([p[0] + nx, p[1] + ny]); lower.push([p[0] - nx, p[1] - ny]);
    });
    const xy = p => p.map(n => n.toFixed(2)).join(" ");
    entry.ribbon.setAttribute("d", "M " + [...upper, ...lower.reverse()].map(xy).join(" L ") + " Z");
    entry.bones.forEach((bone, i) => bone.setAttribute("d", `M ${xy(points[i])} L ${xy(points[i + 1])}`));
    entry.joints.forEach((joint, i) => { joint.setAttribute("cx", points[i][0]); joint.setAttribute("cy", points[i][1]); });
    entry.tip.setAttribute("cx", points[10][0]); entry.tip.setAttribute("cy", points[10][1]);
    entry.svg.dataset.previewTime = time.toFixed(3);
  }

  function mount(panel, entries, solve) {
    stopActive();
    let stopped = false, animation = 0, pending = 0, lastPaint = 0;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const origin = performance.now();
    const visible = new Set();
    const previews = entries.map(({ host, values, label }) => {
      const svg = node("svg", { viewBox: "0 0 128 96", "data-novaflow-ribbon-preset-preview": "1", "data-bone-count": 10, role: "img", "aria-label": `${label}，10 根骨骼动态预览` }, host);
      const ribbon = node("path", { "data-ribbon-shape": "1" }, svg);
      const bones = Array.from({ length: 10 }, () => node("path", { "data-ribbon-bone": "1" }, svg));
      const joints = Array.from({ length: 10 }, () => node("circle", { "data-ribbon-joint": "1", r: 1.1 }, svg));
      const tip = node("circle", { "data-ribbon-tip": "1", r: 1.8 }, svg);
      return { host, values, svg, ribbon, bones, joints, tip, data: null, failed: false };
    });
    const valid = () => !stopped && panel.isConnected;
    const observer = typeof IntersectionObserver === "function" ? new IntersectionObserver(records => {
      for (const record of records) {
        if (record.isIntersecting) visible.add(record.target);
        else visible.delete(record.target);
      }
      queuePrepare();
    }, { root: panel }) : null;
    function stop() {
      stopped = true;
      cancelAnimationFrame(animation); clearTimeout(pending); observer?.disconnect();
      document.removeEventListener("visibilitychange", resume);
    }
    stopActive = stop;
    function queuePrepare() {
      if (!valid() || pending || document.hidden) return;
      pending = window.setTimeout(() => {
        pending = 0;
        if (!valid()) return;
        const entry = previews.find(p => visible.has(p.host) && !p.data && !p.failed);
        if (!entry) return;
        try {
          entry.data = prepare(entry.values, solve);
          paint(entry, .3);
          entry.svg.dataset.ready = "1";
        } catch (_) {
          entry.failed = true;
          entry.svg.setAttribute("aria-label", "预览暂不可用");
        }
        queuePrepare();
      }, 0);
    }
    function frame(now) {
      if (!valid()) { stop(); return; }
      if (!document.hidden && !reducedMotion?.matches && now - lastPaint >= 1000 / 30) {
        lastPaint = now;
        const time = ((now - origin) / 1000) % 2;
        for (const entry of previews) if (visible.has(entry.host)) paint(entry, time);
      }
      animation = requestAnimationFrame(frame);
    }
    function resume() { if (!document.hidden) queuePrepare(); }
    document.addEventListener("visibilitychange", resume);
    previews.forEach(entry => { if (observer) observer.observe(entry.host); else visible.add(entry.host); });
    queuePrepare(); animation = requestAnimationFrame(frame);
    return stop;
  }

  window.NovaFlowRibbonPresetPreview = Object.freeze({ mount, stop: () => stopActive() });
})();
