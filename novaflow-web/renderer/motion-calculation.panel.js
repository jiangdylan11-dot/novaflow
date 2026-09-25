/* Animation calculation controls. Native project/player are supplied by the tool bridge. */
(() => {
  'use strict';
  window.NovaFlowMotionPanel={mount(host,bridge){
  const E=window.NovaFlowMotionEngine,$=id=>host.getElementById(id);
  const style=document.createElement('link');style.rel='stylesheet';style.href=new URL('motion-calculation.css',document.baseURI).href;host.append(style);
  const body=document.createElement('div');body.innerHTML="\n    <p class=\"help\" id=\"selection\"></p>\n    <div id=\"globalTiming\" class=\"global-timing\"></div>\n    <nav id=\"modes\" class=\"segmented\"><button data-mode=\"bounce\" class=\"selected\">弹跳</button><button data-mode=\"expand\">扩张</button><button data-mode=\"shuttle\">往返</button><button data-mode=\"opacity\">透明度</button></nav>\n    <section id=\"presetSection\" class=\"controlsection\"><h2>动作预设</h2><div id=\"presets\" class=\"presets\"></div></section>\n    <div id=\"bounceHeightSection\"><div id=\"bounceHeightControls\"></div><div id=\"impactControl\"></div><p id=\"groundRuleHint\" class=\"help\"></p></div>\n    <section id=\"opacityDetails\" class=\"controlsection\" hidden><h2>透明变化 <span id=\"opacitySummary\">100% → 100%</span></h2><div id=\"opacityPresets\" class=\"presets\"></div><div id=\"opacityControls\"></div><p class=\"help\">默认实心，调整后直接与其他动作叠加。</p></section>\n    <section id=\"mainControls\" class=\"controlsection main-controls\"><div id=\"primaryAxes\"></div><div id=\"params\"></div><div id=\"advancedParams\"></div><div id=\"scaleOptions\"><label class=\"check\"><input id=\"link\" type=\"checkbox\">缩放联动</label><p id=\"linkHelp\" class=\"help\"></p><div id=\"anchorSection\" class=\"anchor-picker\"><div>缩放中心 <span id=\"anchorName\"></span></div><div id=\"anchorGrid\" class=\"anchor-grid\" role=\"group\" aria-label=\"缩放中心\"></div></div></div><p id=\"modeHelp\" class=\"help\"></p></section>\n    <div id=\"effectTiming\"></div>\n    <details id=\"curveDetails\" class=\"curvepanel\"><summary>曲线微调 <span>位移 · 缩放 · 透明度</span></summary><div class=\"curvebar\"><div id=\"curveTabs\" class=\"segmented\"></div><div class=\"row\"><span id=\"curveState\" class=\"dim\">计算曲线</span><button id=\"resetCurve\">恢复本通道</button></div></div><div class=\"curvewrap\"><canvas id=\"curve\" aria-label=\"可编辑通道曲线，拖动圆点上下调整数值\"></canvas></div><div class=\"curvefooter\"><span>拖点调整 · 双击点还原</span><div class=\"row\"><label>控制点 <select id=\"pointSelect\" aria-label=\"曲线控制点\"></select></label><label>值 <input id=\"pointValue\" type=\"number\" step=\".01\" aria-label=\"所选控制点数值\"></label><span id=\"curveUnit\">px</span></div></div></details><p id=\"status\" role=\"status\" class=\"help\"></p><div class=\"save-action\"><button id=\"save\" class=\"primary\">保存动画</button><button id=\"resetAll\">恢复初始值</button></div>\n  ";host.append(body);
  const names = { bounce: '弹跳计算', expand: '扩张计算', shuttle: '往返计算', opacity: '透明度计算' };
  const labels = { x: '位移 X', y: '位移 Y', sx: '缩放 X', sy: '缩放 Y', alpha: '透明度' };
  const anchorNames = { 'top-left': '左上', top: '上方', 'top-right': '右上', left: '左侧', center: '中心', right: '右侧', 'bottom-left': '左下', bottom: '底部', 'bottom-right': '右下' };
  const channelEnabled = () => channel === 'alpha' ? p.opacity.on : p.enabled && p.axes[channel].on;
  const pointEditable = () => channelEnabled() && !(mode === 'bounce' && channel === 'y' && (point === 0 || point === 16));
  const channelLoops = () => channel === 'alpha' ? p.opacity.behavior === 'pulse' : mode === 'shuttle';
  const displayValue = v => channel === 'alpha' ? v * 100 : v;

  const initial=bridge.initial(); const sessions = initial?.stack || E.freshStack();
  const timing=initial?.timing || bridge.timing(); let restoring=false,historyAt=0;const history=[],redo=[];let lastSeek=0;
  function shareOpacity(source) { for (const session of Object.values(sessions)) { session.opacity = source.opacity; session.corrections.alpha = source.corrections.alpha; } }
  shareOpacity(sessions.opacity);
  function shareDuration(value) { for (const session of Object.values(sessions)) { session.delay = (session.delay || 0) / session.duration * value; session.duration = value; } }
  shareDuration(timing.boneDuration); let lastSnapshot=JSON.stringify({stack:sessions,timing});
  let mode = 'bounce', p = sessions[mode], channel = 'y', time = 0, playing = false, last = 0, point = 0, picture = null, pictureURL = null, drag = null, curveBounds = null;
  let stageDrag = null, stageGeometry = null, peakCache = [];
  const presetSets = {
    opacity: [],
    bounce: [
      ['橡胶球', { restitution: .64, count: 4, contact: .09, impact: .3 }, { x: 110, y: 190 }],
      ['软果冻', { restitution: .42, count: 3, contact: .28, impact: .7 }, { x: 60, y: 160 }],
      ['重物落地', { restitution: .10, count: 2, contact: .10, impact: .5 }, { x: 30, y: 190 }]
    ],
    expand: [
      ['弹性放大', { attack: .20, frequency: 2.5, damping: 5, anchor: 'center' }, { x: 0, y: 0, sx: .55, sy: .55 }],
      ['受击压扁', { attack: .12, frequency: 3.5, damping: 8, anchor: 'bottom' }, { x: 0, y: 0, sx: .42, sy: -.35 }],
      ['柔和呼吸', { attack: .48, frequency: .25, damping: 1.3, anchor: 'center' }, { x: 0, y: 0, sx: .12, sy: .18 }]
    ],
    shuttle: [
      ['左右往返', { easing: 1, hold: .06 }, { x: 145, y: 0, sx: .12, sy: -.12 }],
      ['上下浮动', { easing: 1, hold: 0 }, { x: 0, y: 95, sx: .10, sy: -.10 }],
      ['椭圆运动', { easing: 1, hold: 0 }, { x: 140, y: 80, sx: .12, sy: -.12 }]
    ]
  };
  const schema = {
    duration: ['骨骼总时长', .05, 30, .05, 's', 1],
    delay: ['骨骼延迟', 0, 1, .01, '%', 1],
    restitution: ['反弹高度保留', 0, .9, .01, '%', 100],
    count: ['反弹次数', 0, 6, 1, '次', 1],
    contact: ['落地停留', .04, .4, .01, '%', 100],
    impact: ['冲击力度', 0, 1, .01, '%', 100],
    stretch: ['腾空拉伸', 0, .8, .01, '%', 100],
    attack: ['扩张到峰值时间', .05, .6, .01, '%', 100],
    frequency: ['回弹振荡次数', .25, 6, .25, '次', 1],
    damping: ['回弹衰减', .5, 12, .1, '', 1],
    easing: ['两端缓动', 0, 1, .01, '%', 100],
    hold: ['两端停留', 0, .35, .01, '%', 100]
  };
  const modeKeys = { bounce: ['duration', 'restitution', 'count', 'contact'], expand: ['duration', 'attack', 'frequency', 'damping'], shuttle: ['duration', 'easing', 'hold'], opacity: ['duration'] };
  const commonKeys = { bounce: ['restitution', 'count'], expand: ['attack'], shuttle: [], opacity: [] };
  const primaryChannels = { bounce: ['y', 'x'], expand: ['sx', 'sy'], shuttle: ['x', 'y'], opacity: [] };
  const fmt = (n, d = 2) => Number(n.toFixed(d)).toString();
  let previewError='';
  const status = s => { $('status').textContent = previewError || s; };
  function validInput(input, lo, hi, fallback) {
    const n = input.value === '' ? NaN : Number(input.value);
    return Number.isFinite(n) ? E.clamp(n, lo, hi) : fallback;
  }
  function setPlaying(v) { playing = v; }
  function restart() { time = Math.min(p.duration*.25,p.duration); draw(); }
  function refreshEvents() {}
  function syncEnabled() {
    const opacity = sessions.opacity.opacity;
    $('opacitySummary').textContent = opacity.on ? opacity.behavior === 'pulse' ? '循环变化' : `${fmt(opacity.from * 100)}% → ${fmt(opacity.to * 100)}%` : '未启用';
    $('modes').querySelectorAll('button').forEach(b => b.classList.toggle('has-effect', b.dataset.mode === 'opacity' ? sessions.opacity.opacity.on : !!sessions[b.dataset.mode].enabled));
    /* composition summary */ const summary = Object.keys(names).filter(m => m === 'opacity' ? sessions.opacity.opacity.on : sessions[m].enabled).map(m => names[m].replace('计算', '')).join(' + ') || '初始姿态 · 选择预设或调整参数';
  }
  function parameterChanged(activate = true) { if (activate && mode !== 'opacity') p.enabled = true; syncEnabled(); time = Math.min(time, p.duration); refreshEvents(); syncBounceHeights(); curveBounds = null; draw(); syncPoint(); }
  function syncBounceHeights() {
    $('bounceHeightSection').hidden = mode !== 'bounce';
    if (mode !== 'bounce') { peakCache = []; return; }
    const ground = p.groundY || 0, peak = ground + p.axes.y.amp;
    $('groundRuleHint').textContent = '冲击为 0 时不下沉；力度越大，下冲越深，再回弹。地面仅作参考。';
    for (const [key, value] of [['ground', ground], ['peak', peak]]) {
      if ($('height-num-' + key) && host.activeElement !== $('height-num-' + key)) $('height-num-' + key).value = fmt(value, 1);
      if ($('height-range-' + key)) $('height-range-' + key).value = value;
    }
    peakCache = E.peaks(p);
  }
  function setBounceHeight(kind, value) {
    if (mode !== 'bounce' || !Number.isFinite(value)) return;
    const oldGround = p.groundY || 0, oldPeak = oldGround + p.axes.y.amp;
    if (kind === 'ground') {
      p.groundY = E.clamp(value, Math.max(-200, oldPeak - 600), Math.min(200, oldPeak));
      p.axes.y.amp = oldPeak - p.groundY;
    } else p.axes.y.amp = E.clamp(value - oldGround, 0, 600);
    p.axes.y.on = true;
    // A new height constraint regenerates only the Y trajectory; preserve all other channels.
    p.corrections.y.fill(0);
    $('axis-num-y').value = fmt(p.axes.y.amp); $('axis-range-y').value = p.axes.y.amp;
    $('axis-num-y').disabled = $('axis-range-y').disabled = false; $('enable-y').checked = true;
    time = kind === 'ground' ? 0 : E.timelineTime(p, E.peaks(p)[0]?.u || 0);
    setPlaying(false); parameterChanged();
    status('已更新高点／地面并重新计算 Y 轨迹；其他通道保留。');
  }
  function renderBounceHeights() {
    $('impactControl').replaceChildren(...(mode === 'bounce' ? [makeParam('impact')] : []));
    $('bounceHeightControls').replaceChildren(...['ground', 'peak'].map(key => {
      const label = key === 'peak' ? '最高点 Y' : '地面高度 Y', min = -200, max = key === 'peak' ? 800 : 200;
      const div = document.createElement('div'); div.className = 'param';
      div.innerHTML = `<div class="paramhead"><label for="height-range-${key}">${label}</label><span class="numberwrap"><input id="height-num-${key}" aria-label="${label}数值" type="number" min="${min}" max="${max}" step="1"><span>px</span></span></div><input id="height-range-${key}" aria-label="${label}" type="range" min="${min}" max="${max}" step="1">`;
      const number = div.querySelector('input[type=number]'), range = div.querySelector('input[type=range]');
      range.oninput = () => setBounceHeight(key, Number(range.value));
      number.oninput = () => { if (number.value !== '') setBounceHeight(key, Number(number.value)); };
      number.onblur = () => { number.value = fmt((p.groundY || 0) + (key === 'peak' ? p.axes.y.amp : 0), 1); };
      return div;
    }));
    syncBounceHeights();
  }
  function makeParam(key) {
    const [label, min, schemaMax, schemaStep, unit, schemaFactor] = schema[key], factor = key === 'delay' ? 100 / p.duration : schemaFactor, step = key === 'delay' ? p.duration / 100 : schemaStep, max = key === 'delay' ? p.duration : schemaMax, div = document.createElement('div'); div.className = 'param';
    div.innerHTML = `<div class="paramhead"><label for="range-${key}">${label}</label><span class="numberwrap"><input id="num-${key}" type="number" aria-label="${label}数值" min="${min * factor}" max="${max * factor}" step="${step * factor}" value="${fmt(p[key] * factor)}"><span>${unit}</span></span></div><input id="range-${key}" aria-label="${label}" type="range" min="${min}" max="${max}" step="${step}" value="${p[key]}">`;
    const number = div.querySelector('input[type=number]'), range = div.querySelector('input[type=range]');
    range.oninput = () => { if(key==='duration')p.delay=p.delay/p.duration*Number(range.value);p[key] = Number(range.value); if (key === 'duration') {timing.boneDuration=p[key];shareDuration(p[key]);renderTiming();} number.value = fmt(p[key] * factor); parameterChanged(key !== 'duration'); };
    number.oninput = () => { if (number.value === '') return; const oldDuration=p.duration;p[key] = validInput(number, min * factor, max * factor, p[key] * factor) / factor; if(key==='duration')p.delay=p.delay/oldDuration*p.duration; if (key === 'count') p[key] = Math.round(p[key]); if (key === 'duration') {timing.boneDuration=p[key];shareDuration(p[key]);renderTiming();} range.value = p[key]; parameterChanged(key !== 'duration'); };
    number.onblur = () => { number.value = fmt(p[key] * factor); };
    return div;
  }
  function axisSpec(k) { return k[0] === 's' ? [-.85, 1.8, .01, 100, '%'] : k === 'y' && mode === 'bounce' ? [0, 600, 1, 1, 'px'] : [-200, 200, 1, 1, 'px']; }
  function setAmplitude(k, v) {
    const old = p.axes[k].amp; p.axes[k].amp = v;
    if (p.link && k.startsWith('s')) {
      const other = k === 'sx' ? 'sy' : 'sx';
      // Preserve the current signed X:Y ratio, so squash and uniform expansion share one control.
      const ratio = Math.abs(old) > .0001 ? p.axes[other].amp / old : mode === 'bounce' ? -1 : 1;
      p.axes[other].amp = E.clamp(v * ratio, -.85, 1.8);
      $('axis-range-' + other).value = p.axes[other].amp;
      $('axis-num-' + other).value = fmt(p.axes[other].amp * 100);
    }
    parameterChanged();
  }
  function makeAxis(k) {
    const a = p.axes[k], [min, max, step, factor, unit] = axisSpec(k), div = document.createElement('div'); div.className = 'axiscontrol';
    div.innerHTML = `<div class="axisrow"><label class="check"><input id="enable-${k}" type="checkbox" ${a.on ? 'checked' : ''}>${labels[k]}</label><div class="row"><input id="axis-num-${k}" class="axisnumber" type="number" aria-label="${labels[k]}幅度数值" min="${min * factor}" max="${max * factor}" step="${step * factor}" value="${fmt(a.amp * factor)}"><span class="axisunit">${unit}</span></div></div><input id="axis-range-${k}" type="range" aria-label="${labels[k]}幅度" min="${min}" max="${max}" step="${step}" value="${a.amp}">`;
    const number = div.querySelector('input[type=number]'), range = div.querySelector('input[type=range]'), check = div.querySelector('input[type=checkbox]');
    const visibleLabel = mode === 'bounce' ? (k === 'y' ? '起跳高度' : k === 'x' ? '横向移动' : labels[k]) : labels[k];
    div.querySelector('.check').lastChild.textContent = visibleLabel;
    number.disabled = range.disabled = !a.on;
    range.oninput = () => { number.value = fmt(Number(range.value) * factor); setAmplitude(k, Number(range.value)); };
    number.oninput = () => { if (number.value === '') return; const val = validInput(number, min * factor, max * factor, a.amp * factor) / factor; range.value = val; setAmplitude(k, val); };
    number.onblur = () => { number.value = fmt(a.amp * factor); };
    check.onchange = () => { a.on = check.checked; div.querySelectorAll('input:not([type=checkbox])').forEach(n => n.disabled = !a.on); parameterChanged(); };
    if (mode === 'shuttle') {
      const extra = document.createElement('div'); extra.className = 'axisextra';
      extra.innerHTML = `<label>次数 <input type="number" min="1" max="6" step="1" value="${a.cycles}" aria-label="${labels[k]}次数"></label>`;
      const nums = extra.querySelectorAll('input'); nums.forEach(n => n.disabled = !a.on);
      nums[0].oninput = () => { if (!nums[0].value) return; a.cycles = Math.round(validInput(nums[0], 1, 6, a.cycles)); parameterChanged(); };
      nums[0].onblur = () => nums[0].value = a.cycles;
      div.append(extra);
    }
    return div;
  }
  const opacitySchema = {
    from: ['起始不透明度', 0, 1, .01, '%', 100], to: ['目标不透明度', 0, 1, .01, '%', 100],
    begin: ['开始时间', 0, .99, .01, '%', 100], finish: ['结束时间', .01, 1, .01, '%', 100],
    cycles: ['透明往返次数', 1, 8, 1, '次', 1], phase: ['透明相位', 0, 360, 5, '°', 1],
    easing: ['透明缓动', 0, 1, .01, '%', 100], hold: ['透明两端停留', 0, .35, .01, '%', 100]
  };
  function renderOpacity() {
    const o = p.opacity;
    $('opacitySummary').textContent = o.on ? (o.behavior === 'pulse' ? '循环变化' : `${fmt(o.from * 100)}% → ${fmt(o.to * 100)}%`) : '未启用';
    $('opacityPresets').replaceChildren(...[
      ['透明到实心', { behavior: 'once', from: 0, to: 1, easing: 1, hold: 0 }],
      ['实心到透明', { behavior: 'once', from: 1, to: 0, easing: 1, hold: 0 }],
      ['呼吸闪烁', { behavior: 'pulse', from: .15, to: 1, cycles: 3, phase: 0, easing: 1, hold: .08 }]
    ].map(([name, values]) => {
      const b = document.createElement('button'); b.textContent = name;
      b.onclick = () => { Object.assign(o, values, { on: true, begin: 0, finish: 1 }); p.corrections.alpha.fill(0); channel = 'alpha'; point = 0; curveBounds = null; syncEnabled(); renderOpacity(); renderTabs(); syncPoint(); restart(true); status(`已启用「${name}」，动作参数保留；可在透明度曲线上继续调节。`); }; return b;
    }));
    const selector = document.createElement('label'); selector.className = 'line';
    selector.innerHTML = '<span>变化方式</span><select aria-label="透明变化方式"><option value="once">单次渐变</option><option value="pulse">循环往返</option></select>';
    const select = selector.querySelector('select'); select.value = o.behavior; select.disabled = !o.on;
    select.onchange = () => { o.behavior = select.value; p.corrections.alpha.fill(0); renderOpacity(); parameterChanged(); status('透明变化方式已切换，透明度曲线微调已重置。'); };
    const keys = ['from', 'to', 'finish', ...(o.behavior === 'pulse' ? ['cycles', 'hold'] : []), 'easing'];
    const controls = keys.map(key => {
      const [label, min, max, step, unit, factor] = opacitySchema[key], div = document.createElement('div'); div.className = 'param';
      div.innerHTML = `<div class="paramhead"><label for="opacity-range-${key}">${label}</label><span class="numberwrap"><input type="number" id="opacity-num-${key}" aria-label="${label}数值" min="${min * factor}" max="${max * factor}" step="${step * factor}" value="${fmt(o[key] * factor)}"><span>${unit}</span></span></div><input id="opacity-range-${key}" type="range" aria-label="${label}" min="${min}" max="${max}" step="${step}" value="${o[key]}">`;
      const number = div.querySelector('input[type=number]'), range = div.querySelector('input[type=range]'); number.disabled = range.disabled = !o.on;
      const update = value => {
        if (key === 'cycles') value = Math.round(value);
        if (key === 'begin') value = Math.min(value, o.finish - .01);
        if (key === 'finish') value = Math.max(value, o.begin + .01);
        o[key] = E.clamp(value, min, max); range.value = o[key]; parameterChanged();
      };
      range.oninput = () => { update(Number(range.value)); number.value = fmt(o[key] * factor); };
      number.oninput = () => { if (number.value !== '') update(validInput(number, min * factor, max * factor, o[key] * factor) / factor); };
      number.onblur = () => { number.value = fmt(o[key] * factor); };
      return div;
    });
    const note = document.createElement('p'); note.className = 'help'; note.textContent = '结束时间相对本骨骼的完整周期；骨骼延迟平移循环位置，不压缩渐变。';
    $('opacityControls').replaceChildren(...controls.filter((_, i) => ['from','to'].includes(keys[i])), selector, ...controls.filter((_, i) => !['from','to'].includes(keys[i])), note);
    $('opacityControls').hidden = !o.on;
  }

  function renderTiming(){
    const fields=[['animationDuration','动画总时长',.05,120,.05,'s',1],['animationDelay','动画延迟',0,timing.animationDuration,.01,'%',100/timing.animationDuration]];
    const nodes=fields.map(([key,label,min,max,step,unit,factor])=>{
      const div=document.createElement('div');div.className='param';
      div.innerHTML=`<div class="paramhead"><label for="outer-${key}">${label}</label><span class="numberwrap"><input aria-label="${label}数值" type="number" min="${min*factor}" max="${max*factor}" step="${step*factor}" value="${fmt(timing[key]*factor)}"><span>${unit}</span></span></div><input id="outer-${key}" aria-label="${label}" type="range" min="${min}" max="${max}" step="${step}" value="${timing[key]}">`;
      const range=div.querySelector('[type=range]'),num=div.querySelector('[type=number]');
      const update=value=>{const ratio=timing.animationDelay/timing.animationDuration;timing[key]=value;if(key==='animationDuration')timing.animationDelay=ratio*value;draw();};
      range.oninput=()=>{num.value=fmt(Number(range.value)*factor);update(Number(range.value));};
      num.oninput=()=>{if(num.value==='')return;update(validInput(num,min*factor,max*factor,timing[key]*factor)/factor);range.value=timing[key];};
      num.onblur=renderTiming;
      range.onchange=renderTiming;return div;
    });
    const help=document.createElement('p');help.className='help';help.textContent=`本骨骼：${fmt(timing.animationDelay)}–${fmt(timing.animationDelay+timing.boneDuration)} 秒`;help.title='动画延迟只调整本骨骼在整段时间轴的位置。';
    $('globalTiming').replaceChildren(nodes[0],makeParam('duration'),nodes[1],help);
  }
  function renderPanel() {
    $('selection').textContent=bridge.label(); $('modes').querySelectorAll('button').forEach(b => { b.classList.toggle('selected', b.dataset.mode === mode); b.setAttribute('aria-pressed', b.dataset.mode === mode); });
    renderTiming();
    $('effectTiming').replaceChildren(makeParam('delay'));
    const delayHint = document.createElement('p'); delayHint.className = 'help'; delayHint.id='delayHint';delayHint.title='在本骨骼自然循环内向后偏移，周期不变。0% 与 100% 是相同起点。'; $('effectTiming').append(delayHint);
    $('mainControls').hidden = mode === 'opacity';
    $('params').replaceChildren(...commonKeys[mode].map(makeParam));
    $('advancedParams').replaceChildren(...modeKeys[mode].filter(k => k !== 'duration' && !commonKeys[mode].includes(k)).map(makeParam));
    $('primaryAxes').replaceChildren(...primaryChannels[mode].map(makeAxis));
    $('presetSection').hidden = mode === 'opacity'; $('opacityDetails').hidden = mode !== 'opacity'; $('scaleOptions').hidden = mode !== 'expand';
    $('presets').replaceChildren(...presetSets[mode].map(([name, vals, axes]) => {
      const b = document.createElement('button'); b.textContent = name;
      b.onclick = () => { const duration = p.duration, delay = p.delay, opacity = p.opacity, alpha = p.corrections.alpha, groundY = p.groundY, ground = p.ground; p = sessions[mode] = E.freshStack()[mode]; p.duration = duration; p.delay = delay; p.opacity = opacity; p.corrections.alpha = alpha; p.enabled = true; if (mode === 'bounce') { p.groundY = groundY || 0; p.ground = ground !== false; } Object.assign(p, vals); for (const k of E.ownedChannels[mode]) p.axes[k].amp = axes[k]; renderPanel(); restart(true); status(`已应用「${name}」，其他分项调整保留并继续叠加。`); };
      return b;
    }));
    $('link').checked = p.link;
    $('anchorName').textContent = anchorNames[p.anchor];
    $('anchorGrid').replaceChildren(...Object.keys(E.anchors).map(key => {
      const button = document.createElement('button'); button.type = 'button'; button.title = anchorNames[key];
      button.setAttribute('aria-label', '缩放中心：' + anchorNames[key]); button.setAttribute('aria-pressed', p.anchor === key);
      button.classList.toggle('selected', p.anchor === key); button.textContent = '·';
      button.onclick = () => { p.anchor = key; parameterChanged(); renderPanel(); }; return button;
    }));
    $('anchorSection').hidden = mode !== 'expand';
    $('linkHelp').textContent = p.link ? '缩放幅度保持当前 X:Y 比例；取消勾选可独立调节。曲线始终可分别微调。' : '缩放 X / Y 独立调节；原始尺寸为 100%。';
    $('modeHelp').textContent = {
      bounce: '只控制弹跳位移，往返位移在此基础上叠加。',
      expand: '点击格子选择缩放中心；与已有位移动画同时生效。',
      shuttle: '只控制往返位移，叠加在已有弹跳上。X/Y 的幅度与次数分别调整。',
      opacity: '独立调整透明度，也可叠加到其他动作。'
    }[mode];
    syncEnabled();
    curveBounds = null; refreshEvents(); renderBounceHeights(); renderOpacity(); renderTabs(); syncPoint(); draw();
  }
  function renderTabs() {
    $('curveDetails').querySelector('summary span').textContent = names[mode].replace('计算', '') + '分项 · 预览叠加';
    $('curveTabs').replaceChildren(...E.ownedChannels[mode].map(k => { const b = document.createElement('button'); b.textContent = labels[k]; b.classList.toggle('selected', k === channel); b.setAttribute('aria-pressed', k === channel); b.onclick = () => { channel = k; curveBounds = null; renderTabs(); syncPoint(); drawCurve(); }; return b; }));
  }
  function setPointValue(value) {
    if (!pointEditable() || !Number.isFinite(value)) return;
    const scale = channel.startsWith('s');
    value = E.clamp(value, channel === 'alpha' ? 0 : scale ? .08 : channel === 'y' && mode === 'bounce' && p.ground !== false ? p.groundY || 0 : -1000, channel === 'alpha' ? 1 : scale ? 4 : 1000);
    const baseline = E.sample(p, point / 16, true, true)[channel];
    p.corrections[channel][point] = value - baseline;
    // A periodic curve has one seam; edit both ends together.
    if (channelLoops() && (point === 0 || point === 16)) p.corrections[channel][point === 0 ? 16 : 0] = value - E.sample(p, point === 0 ? 1 : 0, true, true)[channel];
    time = E.timelineTime(p, point / 16); setPlaying(false);
    syncBounceHeights(); draw(); syncPoint();
  }
  function syncPoint() {
    if (host.activeElement !== $('pointValue')) $('pointValue').value = fmt(displayValue(E.sample(p, point / 16)[channel]), channel.startsWith('s') ? 3 : 1); $('pointValue').disabled = !pointEditable();
    $('pointValue').step = channel.startsWith('s') ? '.01' : '1'; $('curveUnit').textContent = channel === 'alpha' ? '%' : channel.startsWith('s') ? '倍' : 'px';
    $('pointSelect').value = point;
    const custom = p.corrections[channel].some(v => Math.abs(v) > .00001);
    $('curveState').textContent = !channelEnabled() ? '通道关闭' : !pointEditable() ? '起止点固定在地面' : custom ? '已微调 · 参数仍可调整' : '计算曲线';
  }
  function canvasContext(id) {
    const canvas = $(id), r = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, r.width, r.height);
    return [ctx, r.width, r.height];
  }
  function getCurveBounds() {
    if (channel === 'alpha') return { min: 0, max: 1 };
    const values = Array.from({ length: 361 }, (_, i) => E.sample(p, i / 360)[channel]);
    const scale = channel.startsWith('s'), baseline = scale ? 1 : 0;
    let min = Math.min(baseline, ...values), max = Math.max(baseline, ...values), pad = Math.max((max - min) * .17, scale ? .1 : 20);
    return { min: min - pad, max: max + pad };
  }
  function curveGeometry() {
    const r = $('curve').getBoundingClientRect(), b = drag ? drag.bounds : (curveBounds || (curveBounds = getCurveBounds()));
    return { width: r.width, height: r.height, left: 51, right: r.width - 16, top: 15, bottom: r.height - 29, ...b };
  }
  function drawCurve() {
    const [ctx, w, h] = canvasContext('curve'); if (!w || !h) return;
    const g = curveGeometry(), xp = u => g.left + u * (g.right - g.left), yp = v => g.bottom - (v - g.min) / (g.max - g.min) * (g.bottom - g.top);
    ctx.font = '11px Segoe UI'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
      const val = g.min + (g.max - g.min) * i / 4, y = yp(val);
      ctx.strokeStyle = '#343c36'; ctx.beginPath(); ctx.moveTo(g.left, y); ctx.lineTo(g.right, y); ctx.stroke(); ctx.fillStyle = '#a3aaa8'; ctx.fillText(fmt(displayValue(val), channel.startsWith('s') ? 2 : 0) + (channel === 'alpha' ? '%' : ''), g.left - 8, y);
    }
    ctx.textAlign = 'center';
    for (let i = 0; i <= 4; i++) { ctx.fillStyle = '#a3aaa8'; ctx.fillText(`${fmt(E.timelineTime(p, i / 4))}s`, xp(i / 4), h - 10); }
    ctx.save(); ctx.beginPath(); ctx.rect(g.left, g.top - 6, g.right - g.left, g.bottom - g.top + 12); ctx.clip();
    ctx.setLineDash([3, 4]); ctx.strokeStyle = '#69776e'; ctx.beginPath();
    for (let i = 0; i <= 360; i++) { const x = xp(i / 360), y = yp(E.sample(p, i / 360, true)[channel]); if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = '#51c795'; ctx.lineWidth = 2; ctx.beginPath();
    for (let i = 0; i <= 360; i++) { const x = xp(i / 360), y = yp(E.sample(p, i / 360)[channel]); if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.stroke();
    ctx.strokeStyle = '#e9c668'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(xp(E.effectTime(p, time / p.duration)), g.top); ctx.lineTo(xp(E.effectTime(p, time / p.duration)), g.bottom); ctx.stroke();
    if (channelEnabled()) for (let i = 0; i <= 16; i++) {
      const y = yp(E.sample(p, i / 16)[channel]); ctx.fillStyle = i === point ? '#e9c668' : '#1e2220'; ctx.strokeStyle = i === point ? '#e9c668' : '#6ed3a7'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(xp(i / 16), y, i === point ? 4.6 : 3.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }
  function draw() {
    host.querySelectorAll('input[type=range]').forEach(input=>{input.style.setProperty('--fill',`${100*(Number(input.value)-Number(input.min))/(Number(input.max)-Number(input.min))}%`);});
    if($('delayHint'))$('delayHint').textContent=`偏移 ${fmt(p.delay)} 秒 · ${fmt(p.duration)} 秒周期内`;
    drawCurve();
    const snapshot = JSON.stringify({stack:sessions,timing});
    if(snapshot!==lastSnapshot){
      if(!restoring){if(Date.now()-historyAt>400){history.push(lastSnapshot);if(history.length>40)history.shift();}historyAt=Date.now();redo.length=0;}
      lastSnapshot=snapshot;
      try { bridge.preview(sessions,timing); previewError='';$('save').disabled=false; status('已预览当前骨骼，点击保存动画写入。'); }
      catch(error){previewError=error.message;$('save').disabled=true;status(error.message);}
    }
    if(time!==lastSeek){lastSeek=time;bridge.seek(timing.animationDelay+time);}
  }
  function curvePosition(event) { const r = $('curve').getBoundingClientRect(); return { x: event.clientX - r.left, y: event.clientY - r.top }; }
  function nearestPoint(pos, g) {
    let nearest = -1, distance = 13;
    for (let i = 0; i <= 16; i++) { const x = g.left + i / 16 * (g.right - g.left), y = g.bottom - (E.sample(p, i / 16)[channel] - g.min) / (g.max - g.min) * (g.bottom - g.top), d = Math.hypot(x - pos.x, y - pos.y); if (d < distance) { distance = d; nearest = i; } }
    return nearest;
  }
  $('curve').onpointerdown = e => {
    const pos = curvePosition(e), g = curveGeometry(), index = nearestPoint(pos, g); setPlaying(false);
    if (index >= 0 && channelEnabled()) { point = index; time = E.timelineTime(p, point / 16); drag = { bounds: { min: g.min, max: g.max } }; $('curve').setPointerCapture(e.pointerId); syncPoint(); draw(); }
    else { time = E.timelineTime(p, E.clamp((pos.x - g.left) / (g.right - g.left), 0, 1)); draw(); }
  };
  $('curve').onpointermove = e => { if (!drag) return; const pos = curvePosition(e), g = curveGeometry(); setPointValue(g.min + (g.bottom - pos.y) / (g.bottom - g.top) * (g.max - g.min)); };
  const endDrag = () => { if (!drag) return; drag = null; curveBounds = null; drawCurve(); };
  $('curve').onpointerup = endDrag; $('curve').onpointercancel = endDrag; $('curve').onlostpointercapture = endDrag;
  $('curve').ondblclick = e => { const index = nearestPoint(curvePosition(e), curveGeometry()); if (index >= 0) { point = index; p.corrections[channel][index] = 0; if (channelLoops() && (index === 0 || index === 16)) p.corrections[channel][index === 0 ? 16 : 0] = 0; curveBounds = null; syncBounceHeights(); draw(); syncPoint(); } };
  $('pointSelect').replaceChildren(...Array.from({ length: 17 }, (_, i) => { const o = document.createElement('option'); o.value = i; o.textContent = `${i + 1} · ${fmt(i / 16 * 100, 1)}%`; return o; }));
  $('pointSelect').onchange = () => { point = Number($('pointSelect').value); time = E.timelineTime(p, point / 16); setPlaying(false); syncPoint(); draw(); };
  $('pointValue').oninput = () => { if ($('pointValue').value === '') return; setPointValue(Number($('pointValue').value) / (channel === 'alpha' ? 100 : 1)); curveBounds = null; drawCurve(); };
  $('pointValue').onblur = () => { $('pointValue').value = fmt(displayValue(E.sample(p, point / 16)[channel]), channel.startsWith('s') ? 3 : 1); };
  $('resetCurve').onclick = () => { p.corrections[channel].fill(0); curveBounds = null; syncBounceHeights(); syncPoint(); draw(); status(`已恢复${labels[channel]}的计算曲线。`); };
  $('modes').querySelectorAll('button').forEach(b => b.onclick = () => { mode = b.dataset.mode; p = sessions[mode]; channel = mode === 'opacity' ? 'alpha' : mode === 'expand' ? 'sx' : mode === 'bounce' ? 'y' : 'x'; drag = null; renderPanel(); status('已切换调整项；已有动画持续叠加，播放进度保留。'); });
  $('resetAll').onclick = () => {
    bridge.restore(); Object.assign(sessions,E.freshStack()); Object.assign(timing,bridge.timing()); shareDuration(timing.boneDuration); shareOpacity(sessions.opacity);p=sessions[mode];
    history.push(lastSnapshot);lastSnapshot=JSON.stringify({stack:sessions,timing});redo.length=0;previewError='';time=0;renderPanel();$('save').disabled=false;status('已恢复本骨骼计算前的动画；其他骨骼保留。');
  };
  $('link').onchange = () => { p.link = $('link').checked; parameterChanged(false); };
  $('curveDetails').ontoggle = () => { curveBounds=null;drawCurve(); };
  $('save').onclick = () => { try{bridge.save(sessions,timing);status('已保存到当前动画；可使用原有动画导出。');}catch(error){status(error.message);} };
  function restoreSnapshot(value){restoring=true;const v=JSON.parse(value);Object.assign(sessions,v.stack);Object.assign(timing,v.timing);p=sessions[mode];renderPanel();restoring=false;}
  function undo(forward){const from=forward?redo:history,to=forward?history:redo;if(from.length){to.push(lastSnapshot);restoreSnapshot(from.pop());status(forward?'已重做本骨骼参数。':'已撤销本骨骼参数。');}}
  const observer=new ResizeObserver(()=>{curveBounds=null;drawCurve();});observer.observe($('curve'));
  let frameId;
  function frame(){if(host.host.isConnected){if($('curveDetails').open){time=E.clamp(bridge.time()-timing.animationDelay,0,p.duration);lastSeek=time;drawCurve();}frameId=requestAnimationFrame(frame);}}
  renderPanel();frameId=requestAnimationFrame(frame);
  return {destroy(){observer.disconnect();cancelAnimationFrame(frameId);},status,undo};
}};
})();
