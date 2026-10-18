(function (root) {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const channels = ['x', 'y', 'sx', 'sy', 'r'];
  const defaults = {
    opacity: { duration: 2.8, anchor: 'center', ground: false,
      axes: { x: { on: false, amp: 0 }, y: { on: false, amp: 0 }, sx: { on: false, amp: 0 }, sy: { on: false, amp: 0 }, r: { on: false, amp: 0 } } },
    bounce: { duration: 2.8, restitution: .58, count: 3, contact: .12, impact: .45, stretch: .28, anchor: 'bottom', ground: false, groundY: 0,
      axes: { x: { on: true, amp: 110 }, y: { on: true, amp: 190 }, sx: { on: true, amp: .34 }, sy: { on: true, amp: -.30 }, r: { on: false, amp: 0 } } },
    expand: { duration: 2.4, attack: .22, frequency: 3, damping: 5, anchor: 'center', ground: false,
      axes: { x: { on: true, amp: 0 }, y: { on: true, amp: 0 }, sx: { on: true, amp: .55 }, sy: { on: true, amp: .55 }, r: { on: false, amp: 0 } } },
    shuttle: { duration: 3, easing: 1, hold: 0, anchor: 'center', ground: false,
      axes: { x: { on: true, amp: 140, cycles: 1, phase: 0 }, y: { on: true, amp: 80, cycles: 1, phase: 90 }, sx: { on: false, amp: .12, cycles: 1, phase: 0 }, sy: { on: false, amp: -.12, cycles: 1, phase: 0 }, r: { on: false, amp: 0, cycles: 1, phase: 0 } } },
    // New rotation tools start with a complete constant-speed turn around the bone origin.
    rotate: { duration: 3, cycles: 1, oneWay: 'linear', easing: 0, hold: 0, attack: .15, frequency: 3, damping: 6, anchor: 'center', ground: false,
      axes: { x: { on: false, amp: 0 }, y: { on: false, amp: 0 }, sx: { on: false, amp: 0 }, sy: { on: false, amp: 0 }, r: { on: true, amp: 360, cycles: 1, phase: 90 } } }
  };
  function fresh(mode) {
    const p = JSON.parse(JSON.stringify(defaults[mode]));
    p.mode = mode; p.link = mode !== 'shuttle'; p.delay = 0; p.loop = mode === 'shuttle' || mode === 'rotate'; p.loopCount = 2; p.reverse = false;
    p.opacity = { on: false, behavior: 'once', from: 0, to: 1, begin: 0, finish: 1, cycles: 2, phase: 0, easing: 1, hold: 0 };
    p.corrections = Object.fromEntries([...channels, 'alpha'].map(k => [k, Array(17).fill(0)]));
    return p;
  }
  function bounceSchedule(p) {
    const segments = []; let t = 0;
    const add = (kind, len, height, strength) => { segments.push({ kind, start: t, end: t + len, height, strength }); t += len; };
    add('launch', p.contact, 0, 1);
    add('flight', 2, 1, 1);
    let height = 1;
    for (let i = 0; i <= p.count; i++) {
      const strength = Math.sqrt(height);
      add('contact', p.contact * Math.max(.35, strength) + (p.impact || 0) * 1.35 * strength, height, strength);
      if (i < p.count && p.restitution > 0) {
        height *= p.restitution;
        add('flight', 2 * Math.sqrt(height), height, Math.sqrt(height));
      } else break;
    }
    add('rest', .35, 0, 0);
    return { segments, total: t };
  }
  function bounceBase(p, u) {
    const sch = bounceSchedule(p), t = u * sch.total;
    const s = sch.segments.find(s => t <= s.end) || sch.segments.at(-1);
    const q = clamp((t - s.start) / (s.end - s.start), 0, 1);
    let h = 0, deformation = 0;
    if (s.kind === 'drop') { h = 1 - q * q; deformation = -p.stretch * Math.sin(Math.PI * q); }
    if (s.kind === 'flight') { h = 4 * s.height * q * (1 - q); deformation = -p.stretch * s.strength * Math.sin(Math.PI * q); }
    if (s.kind === 'contact' || s.kind === 'launch') deformation = s.strength * Math.pow(Math.sin(Math.PI * q), 2);
    // Elastic overshoot is part of the motion; the optional hard floor clips only its output.
    if (s.kind === 'contact') h = -.55 * (p.impact || 0) * s.height * Math.sin(Math.PI * q);
    const last = sch.segments.at(-2).end / sch.total;
    return { x: smooth(u / last), y: h, sx: deformation, sy: deformation, r: 0 };
  }
  const periodic = p => p.mode === 'shuttle' || p.mode === 'rotate';
  // Swing reuses the shuttle wave; the spring variant reuses the expansion overshoot.
  // `cycles` counts swings, hits, or one-way steps (turns for a 360° step) per period.
  const rotation = (p, u) => {
    const n = Math.max(1, Math.round(p.cycles || 1));
    if (p.oneWay === 'linear') return n * u;
    if (p.spring) return expansion({ ...p, loop: false }, n > 1 ? (u >= 1 ? 1 : (u * n) % 1) : u);
    if (p.oneWay) { const k = Math.min(n - 1, Math.floor(u * n)); return k + oneWayProgress(p, u * n - k); }
    return wave(p, { ...p.axes.r, cycles: n }, u);
  };
  function expansion(p, u) {
    if(p.oneWay)return oneWayProgress(p,u);
    if(p.loop)u=u>=1?1:(u*Math.max(1,p.loopCount||2))%1;
    if (u <= p.attack) return smooth(u / p.attack);
    const q = (u - p.attack) / (1 - p.attack);
    // Squared exponential time preserves zero speed at the peak; tail reaches rest exactly.
    return Math.cos(2 * Math.PI * p.frequency * q) * Math.exp(-p.damping * q * q) * (1 - smooth((q - .78) / .22));
  }
  function wave(p, axis, u) {
    if(p.oneWay&&periodic(p))return oneWayProgress(p,u);
    const cycles=periodic(p)&&p.loop===false?1:axis.cycles;
    const phase = ((u * cycles + axis.phase / 360) % 1 + 1) % 1;
    const half = phase < .5 ? phase * 2 : (1 - phase) * 2;
    const q = clamp((half - p.hold) / (1 - 2 * p.hold), 0, 1);
    const eased = q * (1 - p.easing) + ((1 - Math.cos(Math.PI * q)) / 2) * p.easing;
    return -1 + 2 * eased;
  }
  function oneWayProgress(p,u){
    const hold=p.hold||0,q=clamp((u-hold)/(1-2*hold),0,1);
    const eased=p.oneWay==='out'?1-(1-q)**3:p.oneWay==='linear'?q:smooth(q);
    return q+(eased-q)*(p.easing??1);
  }
  const reversed=(p,key)=>!!p.reverse&&((p.mode==='expand'&&(key==='sx'||key==='sy'))||(p.mode==='shuttle'&&(key==='x'||key==='y'))||(p.mode==='rotate'&&key==='r'));
  const reverseKnots=knots=>knots.slice().reverse().map(n=>({u:1-n.u,v:n.v,in:{u:1-n.out.u,v:n.out.v},out:{u:1-n.in.u,v:n.in.v}}));
  function correction(values, u, pinEnds = false) {
    const pos = clamp(u, 0, 1) * (values.length - 1), i = Math.min(values.length - 2, Math.floor(pos));
    const a = pinEnds && i === 0 ? 0 : values[i], b = pinEnds && i + 1 === values.length - 1 ? 0 : values[i + 1];
    return a + (b - a) * smooth(pos - i);
  }
  function rawSample(p, u, noCorrections = false, unclamped = false) {
    u = clamp(u, 0, 1);
    const base = p.mode === 'opacity' ? { x: 0, y: 0, sx: 0, sy: 0, r: 0 } : p.mode === 'bounce' ? bounceBase(p, u) : p.mode === 'expand' ? Object.fromEntries(channels.map(k => [k, expansion(p, reversed(p,k)?1-u:u)])) : p.mode === 'rotate' ? Object.fromEntries(channels.map(k => [k, rotation(p, reversed(p,k)?1-u:u)])) : Object.fromEntries(channels.map(k => [k, wave(p, p.axes[k], reversed(p,k)?1-u:u)]));
    const out = {};
    for (const k of channels) {
      const scale = k[0] === 's', a = p.axes[k];
      out[k] = (scale ? 1 : 0) + (a.on ? (p.mode === 'rotate' && p.oneWay === 'linear' && k === 'r' ? 360 : a.amp) * base[k] + (noCorrections ? 0 : correction(p.corrections[k], reversed(p,k)?1-u:u, p.mode === 'bounce' && k === 'y')) : 0);
      if (scale && !unclamped) out[k] = Math.max(.08, out[k]);
    }
    if (p.mode === 'bounce') {
      out.y += p.groundY || 0;
      if (p.ground !== false && !unclamped) out.y = Math.max(p.groundY || 0, out.y);
    }
    const o = p.opacity;
    out.alpha = 1;
    if (o?.on) {
      const t = clamp((u - o.begin) / Math.max(.01, o.finish - o.begin), 0, 1);
      const progress = o.behavior === 'pulse' ? (wave(o, o, t) + 1) / 2 : t * (1 - o.easing) + smooth(t) * o.easing;
      out.alpha = o.from + (o.to - o.from) * progress + (noCorrections ? 0 : correction(p.corrections.alpha, u));
      if (!unclamped) out.alpha = clamp(out.alpha, 0, 1);
    }
    return out;
  }
  // Cubic curves use time/value coordinates, not uniformly spaced correction samples.
  const curveCache = new WeakMap();
  const mixPoint = (a, b, t) => ({ u: a.u + (b.u - a.u) * t, v: a.v + (b.v - a.v) * t });
  function cubicPoint(a, b, t) {
    const q0 = mixPoint(a, a.out, t), q1 = mixPoint(a.out, b.in, t), q2 = mixPoint(b.in, b, t);
    return mixPoint(mixPoint(q0, q1, t), mixPoint(q1, q2, t), t);
  }
  function cubicTime(a, b, u) {
    let lo = 0, hi = 1;
    for (let i = 0; i < 32; i++) { const t = (lo + hi) / 2; if (cubicPoint(a, b, t).u < u) lo = t; else hi = t; }
    return (lo + hi) / 2;
  }
  function evaluateCurve(knots, u) {
    if (u <= knots[0].u) return knots[0].v;
    if (u >= knots.at(-1).u) return knots.at(-1).v;
    const i = knots.findIndex((n, j) => j && n.u >= u), a = knots[i - 1], b = knots[i];
    return cubicPoint(a, b, cubicTime(a, b, u)).v;
  }
  function fitCurve(p, key) {
    const value = u => rawSample(p, u, false, true)[key];
    const values = Array.from({ length: 361 }, (_, i) => value(i / 360));
    const tolerance = Math.max((Math.max(...values) - Math.min(...values)) * .003, key === 'alpha' || key.startsWith('s') ? .0005 : .05);
    const breaks = [0, 1];
    if (p.mode === 'bounce' && key === 'y') {
      const sch = bounceSchedule(p); for (const s of sch.segments) breaks.push(s.start / sch.total, s.end / sch.total);
    }
    // Flight/contact boundaries already describe each bounce; avoid extra sampled peak nodes.
    if (p.mode !== 'bounce') for (let i = 1; i < 360; i++) if ((values[i] - values[i - 1]) * (values[i + 1] - values[i]) < 0) breaks.push(i / 360);
    const stops = [...new Set(breaks)].sort((a, b) => a - b), pieces = [];
    function fit(lo, hi, depth) {
      const a = { u: lo, v: value(lo) }, b = { u: hi, v: value(hi) }, span = hi - lo;
      const x = 27 * value(lo + span / 3) - 8 * a.v - b.v, y = 27 * value(lo + span * 2 / 3) - a.v - 8 * b.v;
      a.out = { u: lo + span / 3, v: (2 * x - y) / 18 }; b.in = { u: lo + span * 2 / 3, v: (2 * y - x) / 18 };
      let error = 0; for (let i = 1; i < 16; i++) error = Math.max(error, Math.abs(cubicPoint(a, b, i / 16).v - value(lo + span * i / 16)));
      if (error > tolerance && depth < 8) { fit(lo, (lo + hi) / 2, depth + 1); fit((lo + hi) / 2, hi, depth + 1); }
      else pieces.push([a, b]);
    }
    for (let i = 1; i < stops.length; i++) fit(stops[i - 1], stops[i], 0);
    const knots = [pieces[0][0]];
    for (const [a, b] of pieces) { knots.at(-1).out = a.out; knots.push(b); }
    knots[0].in = { u: 0, v: knots[0].v }; knots.at(-1).out = { u: 1, v: knots.at(-1).v };
    return knots;
  }
  function curveFor(p, key) {
    const signature = JSON.stringify(p); let cache = curveCache.get(p);
    if (!cache || cache.signature !== signature) { cache = { signature, channels: {} }; curveCache.set(p, cache); }
    if (cache.channels[key]) return cache.channels[key];
    const saved = p.curves?.[key],reverse=reversed(p,key),forward=reverse?{...p,reverse:false}:p;
    const knots = saved ? saved.knots.map((n, i) => {
      // Retain manual edits while sliders change the underlying calculated motion.
      const shift = (q, baseline) => ({ u: q.u, v: q.v + rawSample(forward, q.u, false, true)[key] - baseline });
      return { ...shift(n, saved.baseline[i].v), in: shift(n.in, saved.baseline[i].in), out: shift(n.out, saved.baseline[i].out) };
    }) : fitCurve(forward, key);
    cache.channels[key] = reverse?reverseKnots(knots):knots; return cache.channels[key];
  }
  function storeCurve(p, key, knots) {
    const forward=reversed(p,key)?{...p,reverse:false}:p;
    if(reversed(p,key))knots=reverseKnots(knots);
    p.curves ??= {};
    p.curves[key] = { knots: JSON.parse(JSON.stringify(knots)), baseline: knots.map(n => ({
      v: rawSample(forward, n.u, false, true)[key], in: rawSample(forward, n.in.u, false, true)[key], out: rawSample(forward, n.out.u, false, true)[key]
    })) };
  }
  function storeLinkedCurve(p, key, knots) {
    if(key==='alpha'&&p.opacity.behavior==='once'){p.opacity.from=clamp(knots[0].v,0,1);p.opacity.to=clamp(knots.at(-1).v,0,1);}
    if (p.mode === 'expand' && p.link && (key === 'sx' || key === 'sy')) {
      const other = key === 'sx' ? 'sy' : 'sx', amplitude = p.axes[key].amp;
      const ratio = Math.abs(amplitude) > .0001 ? p.axes[other].amp / amplitude : 1;
      const scale = q => ({u:q.u,v:Math.max(.08,1+(q.v-1)*ratio)});
      storeCurve(p,other,knots.map(n=>({...scale(n),in:scale(n.in),out:scale(n.out)})));
    }
    storeCurve(p,key,knots);
  }
  function insertCurvePoint(knots, u) {
    const i = knots.findIndex((n, j) => j && n.u >= u);
    if (i < 1 || u - knots[i - 1].u < .0001 || knots[i].u - u < .0001) return -1;
    const a = knots[i - 1], b = knots[i], t = cubicTime(a, b, u);
    const q0 = mixPoint(a, a.out, t), q1 = mixPoint(a.out, b.in, t), q2 = mixPoint(b.in, b, t);
    const r0 = mixPoint(q0, q1, t), r1 = mixPoint(q1, q2, t), n = { ...mixPoint(r0, r1, t), in: r0, out: r1 };
    a.out = q0; b.in = q2; knots.splice(i, 0, n); return i;
  }
  function removeCurvePoint(knots, index) {
    if (index <= 0 || index >= knots.length - 1) return false;
    knots.splice(index, 1); return true;
  }
  function sample(p, u, noCorrections = false, unclamped = false) {
    const out = rawSample(p, u, noCorrections, unclamped);
    if (!noCorrections && p.curves) for (const key of Object.keys(p.curves)) {
      if (!(key === 'alpha' ? p.opacity.on : p.axes[key]?.on)) continue;
      out[key] = evaluateCurve(curveFor(p, key), clamp(u, 0, 1));
      if (!unclamped) {
        if (key === 'alpha') out[key] = clamp(out[key], 0, 1);
        if (key.startsWith('s')) out[key] = Math.max(.08, out[key]);
        if (key === 'y' && p.mode === 'bounce' && p.ground !== false) out[key] = Math.max(p.groundY || 0, out[key]);
      }
    }
    return out;
  }
  function events(p) {
    if (p.mode !== 'bounce') return [];
    const sch = bounceSchedule(p);
    return sch.segments.filter(s => s.kind === 'contact').map((s, i) => ({ u: s.start / sch.total, label: i ? `第 ${i} 次回落` : '首次落地' }));
  }
  function peaks(p) {
    if (p.mode !== 'bounce' || !p.axes.y.on) return [];
    const sch = bounceSchedule(p);
    return sch.segments.filter(s => s.kind === 'flight').map((s, index) => {
      let best = { u: (s.start + s.end) / (2 * sch.total), y: -Infinity };
      for (let i = 0; i <= 128; i++) {
        const u = (s.start + (s.end - s.start) * i / 128) / sch.total, y = sample(p, u).y;
        if (y > best.y) best = { u, y };
      }
      return { ...best, index, height: best.y - (p.groundY || 0) };
    });
  }
  function bake(p) {
    const fps = 60, count = Math.ceil(p.duration * fps);
    const keys = channels.filter(k => p.mode !== 'opacity' && p.axes[k].on);
    if (p.opacity.on) keys.push('alpha');
    const tracks = Object.fromEntries(keys.map(k => [k, []]));
    for (let i = 0; i <= count; i++) {
      const time = Math.min(i / fps, p.duration), value = sample(p, time / p.duration);
      for (const key of keys) tracks[key].push({ time, value: value[key] });
    }
    return { schema: 'novaflow-animation-preview-v1', mode: p.mode, duration: p.duration, fps,
      anchor: p.anchor, units: { time: 'seconds', x: 'pixels', y: 'pixels', sx: 'ratio', sy: 'ratio', r: 'degrees', alpha: 'opacity' }, tracks };
  }
  const ownedChannels = { bounce: ['x', 'y'], shuttle: ['x', 'y'], expand: ['sx', 'sy'], rotate: ['r'], opacity: ['alpha'] };
  function freshStack() {
    const stack = Object.fromEntries(Object.keys(ownedChannels).map(mode => [mode, fresh(mode)]));
    for (const p of Object.values(stack)) {
      p.duration = 2.8; p.enabled = false;
      for (const key of channels) if (!ownedChannels[p.mode].includes(key)) p.axes[key].on = false;
    }
    Object.assign(stack.opacity.opacity, { on: true, from: 1, to: 1 });
    return stack;
  }
  const anchors = { 'top-left': [0, 0], top: [.5, 0], 'top-right': [1, 0], left: [0, .5], center: [.5, .5], right: [1, .5], 'bottom-left': [0, 1], bottom: [.5, 1], 'bottom-right': [1, 1] };
  function fitTiming(timing) {
    timing.animationDuration = Math.max(.05, timing.minimumDuration || .05, Number(timing.animationDuration) || .05);
    timing.boneDuration = clamp(Number(timing.boneDuration) || .05, .05, timing.animationDuration);
    timing.animationDelay = clamp(Number(timing.animationDelay) || 0, 0, Math.max(0,timing.animationDuration-timing.boneDuration));
    return timing;
  }
  function stackAnchor(stack) { return stack.expand.enabled ? stack.expand.anchor : stack.bounce.enabled ? 'bottom' : 'center'; }
  function effectTime(p, u) {
    const offset = ((p.delay || 0) / Math.max(.05, p.duration)) % 1;
    if (!offset) return clamp(u, 0, 1);
    // Shift inside the bone's own cycle. Never squeeze it into the remaining time.
    return ((u - offset) % 1 + 1) % 1;
  }
  function timelineTime(p, u) {
    const delay = (p.delay || 0) % p.duration;
    if (!delay) return clamp(u, 0, 1) * p.duration;
    return ((u * p.duration + delay) % p.duration + p.duration) % p.duration;
  }
  function objectRect(stack, pose, width, height) {
    const [ax, ay] = anchors[stackAnchor(stack)] || anchors.center;
    return { left: pose.x - width / 2 + ax * width * (1 - pose.sx),
      bottom: pose.y + (stack.bounce.enabled ? 0 : -height / 2) + (1 - ay) * height * (1 - pose.sy),
      width: width * pose.sx, height: height * pose.sy, ax, ay };
  }
  function sampleStack(stack, u) {
    const out = { x: 0, y: 0, sx: 1, sy: 1, r: 0, alpha: 1 };
    for (const mode of ['bounce', 'shuttle', 'expand', 'rotate']) {
      if (!stack[mode].enabled) continue;
      const value = sample(stack[mode], effectTime(stack[mode], u));
      for (const key of ownedChannels[mode]) {
        if (!stack[mode].axes[key].on) continue;
        if (key.startsWith('s')) out[key] = value[key];
        else out[key] += value[key];
      }
    }
    out.alpha = sample(stack.opacity, effectTime(stack.opacity, u)).alpha;
    return out;
  }
  function bakeStack(stack) {
    const duration = stack.bounce.duration, fps = 60;
    const keys = [...new Set(Object.entries(ownedChannels).flatMap(([mode, keys]) =>
      mode === 'opacity' ? stack.opacity.opacity.on ? ['alpha'] : [] : stack[mode].enabled ? keys.filter(k => stack[mode].axes[k].on) : []))];
    const tracks = Object.fromEntries(keys.map(k => [k, []]));
    for (let i = 0; i <= Math.ceil(duration * fps); i++) {
      const time = Math.min(i / fps, duration), value = sampleStack(stack, time / duration);
      for (const key of keys) tracks[key].push({ time, value: value[key] });
    }
    return { schema: 'novaflow-animation-preview-v2', duration, fps, anchor: stackAnchor(stack), positionOrigin: stack.bounce.enabled ? 'bottom' : 'center',
      effects: Object.keys(stack).filter(mode => mode === 'opacity' ? stack.opacity.opacity.on : stack[mode].enabled),
      units: { time: 'seconds', x: 'pixels', y: 'pixels', sx: 'ratio', sy: 'ratio', r: 'degrees', alpha: 'opacity' }, tracks };
  }
  const api = { fresh, sample, bake, events, peaks, channels, clamp, defaults, ownedChannels, freshStack, sampleStack, stackAnchor, bakeStack, anchors, objectRect, effectTime, timelineTime, curveFor, storeCurve, storeLinkedCurve, evaluateCurve, insertCurvePoint, removeCurvePoint, fitTiming };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NovaFlowMotionEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
