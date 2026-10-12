/* Animation calculation controls. Native project/player are supplied by the tool bridge. */
(() => {
  'use strict';
  window.NovaFlowMotionPanel={mount(host,bridge){
  const floating=document.createElement('div');floating.dataset.novaflowMotionCurve='1';
  floating.style.cssText='position:fixed;z-index:60;visibility:hidden;pointer-events:none';document.body.append(floating);
  const curveRoot=floating.attachShadow({mode:'open'});
  // The wheel steps a value only once its box is selected (focused) and the cursor is on
  // it; anywhere else it scrolls the block. The runtime's stage zoom skips this panel.
  const wheelStep=event=>{
    const input=event.composedPath()[0];
    if(!(input instanceof HTMLInputElement)||!['number','range'].includes(input.type)||input.disabled||curveRoot.activeElement!==input)return;
    event.preventDefault();event.stopPropagation();
    const before=input.value;
    try{if(event.deltaY<0)input.stepUp();else input.stepDown();}catch{return;}
    if(input.value!==before)input.dispatchEvent(new Event('input',{bubbles:true}));
  };
  curveRoot.addEventListener('wheel',wheelStep,{passive:false});
  const interval=document.createElement('div');interval.dataset.novaflowMotionInterval='1';interval.setAttribute('role','img');
  interval.style.cssText='position:fixed;z-index:61;height:3px;border-radius:2px;background:#59a8ed;pointer-events:none;display:none';document.body.append(interval);
  let bonePlayback=false;
  const playbackMode=document.createElement('div');playbackMode.dataset.novaflowMotionPlaybackMode='1';playbackMode.setAttribute('role','button');playbackMode.tabIndex=0;
  playbackMode.style.cssText='display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;box-sizing:border-box;height:26px;padding:0 8px;border:1px solid #343434;border-radius:6px;background:#272727;color:#d4d4d4;font:11px "Microsoft YaHei",sans-serif;cursor:pointer;user-select:none';
  function syncPlaybackMode(){playbackMode.textContent=bonePlayback?'骨骼片段':'完整动画';playbackMode.setAttribute('aria-label','播放范围：'+playbackMode.textContent);playbackMode.setAttribute('aria-pressed',String(bonePlayback));playbackMode.title=bonePlayback?'仅循环播放当前骨骼时段；点击切换完整动画':'播放完整动画总时长；点击仅播放骨骼时段';playbackMode.style.color=bonePlayback?'#6ed3a7':'#d4d4d4';bridge.playbackRange?.(bonePlayback?[timing.animationDelay,timing.animationDelay+timing.boneDuration]:null);}
  playbackMode.onclick=()=>{bonePlayback=!bonePlayback;syncPlaybackMode();};
  playbackMode.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();playbackMode.click();}};
  const E=window.NovaFlowMotionEngine,$=id=>curveRoot.getElementById(id);
  let stylesReady=false;
  const style=document.createElement('link');style.rel='stylesheet';style.href=new URL('motion-calculation.css?v=20261012-compact-8',document.baseURI).href;
  style.onload=()=>{stylesReady=true;positionCurve();if(!ribbon||(ribbonShown&&ribbonSettled)){floating.style.visibility='visible';playbackMode.style.visibility='visible';window.NovaFlowSkeletonEditor?.timelineCompactNow?.();};};
  const body=document.createElement('article');body.id='editor';body.setAttribute('aria-label','动画工具编辑器');
  body.innerHTML=`
    <header class="editor-header"><div class="editor-title"><strong id="editorTitle"></strong></div>
      <div class="editor-presets"><div id="presetSection"><div id="presets" class="presets"></div></div><div id="opacityPresets" class="presets" hidden></div><div id="ribbonPresets" class="presets"></div></div>
      <button id="editorToggle" class="editor-close" title="关闭动画工具" aria-label="关闭动画工具">×</button>
    </header>
    <div id="editorContent">
      <div class="timing-row"><div id="globalTiming" class="global-timing"></div><div id="effectTiming"></div></div>
      <div class="timing-row" id="ribbonTimingRow"><div id="ribbonGlobalTiming" class="global-timing"></div><div id="ribbonEffectTiming"></div></div>
      <div class="editor-workspace">
        <div class="effect-parameters" aria-label="当前功能参数">
          <div class="effect-scroll">
          <div id="bounceHeightSection"><div id="bounceHeightControls"></div><div id="impactControl"></div><p id="groundRuleHint" class="help"></p></div>
          <section id="opacityDetails" class="controlsection" hidden><h2>透明变化 <span id="opacitySummary"></span></h2><div id="opacityControls"></div></section>
          <section id="mainControls" class="controlsection"><div id="primaryAxes"></div><div id="params"></div><div id="advancedParams"></div>
            <p id="modeHelp" class="help"></p>
          </section>
            <div id="scaleOptions"><div class="effect-switches"><label id="linkOption" class="check"><input id="link" type="checkbox">缩放联动</label><label class="check"><input id="loop" type="checkbox"><span id="directionLabel">循环</span></label></div><p id="linkHelp" class="help"></p></div>
          </div>
        </div>
        <section id="curveDetails" class="curvepanel" aria-label="曲线微调">
          <div class="curvebar"><div id="curveTabs" class="segmented"></div><div class="row"><span id="curveState" class="dim" hidden></span><label class="dim curvevalue">值 <input id="pointValue" type="number" step=".01" aria-label="所选控制点数值"></label><span id="curveUnit">px</span><button id="resetCurve">重置</button></div></div>
          <div class="curvewrap"><canvas id="curve" aria-label="贝塞尔曲线，点击曲线加点，双击节点删点，拖动节点或方向手柄调整"></canvas></div>
        </section>
      </div>
      <div id="ribbonDock"></div>
      <footer class="editor-footer"><div class="editor-context"><p id="selection"></p><p id="curveHint" class="dim">点击曲线加点 · 双击节点删点 · 拖动手柄调弧度</p><p id="status" role="status" hidden></p></div><div class="save-action"><button id="resetAll">恢复初始值</button><button id="save" class="primary">保存动画</button><button id="ribbonRestore">还原动画</button><button id="ribbonWrite" class="primary">写入动画</button></div></footer>
    </div>
    <div id="ribbonPreviewCard" hidden><span id="ribbonPreviewHost"></span><span id="ribbonPreviewLabel"></span></div>`;
  curveRoot.append(style,body);
  // the label column hugs the widest label the panel shows (user 2026-10-12: 滑条和标题间距太大):
  // measured as text (a range), since a label's own box is the column
  // measured in the mutation's own microtask (before paint): a frame later the first 飘带 / tool
  // frame drew its sliders at the previous tool's label width (user 2026-10-12: 首帧不一致)
  const fitLabelColumn=()=>{let w=0;const range=document.createRange();body.querySelectorAll('.paramhead>label,.axis-label,.axisrow>.check').forEach(l=>{if(!l.getClientRects().length)return;range.selectNodeContents(l);w=Math.max(w,range.getBoundingClientRect().width);});body.style.setProperty('--labelw',(w?Math.ceil(w)+2:58)+'px');};
  new MutationObserver(fitLabelColumn).observe(body,{childList:true,subtree:true});
  // outside the editor box, which clips: the preset preview opens above the header
  curveRoot.append(curveRoot.getElementById('ribbonPreviewCard'));
  let ribbon=false,ribbonPrepared=false,ribbonBarKey='',ribbonShown=false,ribbonFooterAt=0,ribbonFitHeight=0,ribbonSettled=false,ribbonStable=0,ribbonStableAt=0,ribbonLiveRect=null,collapsed=false,lastLayout='',previewLayer=null,previewStage=null,previousBlockSize='',previousBlockPriority='',lastInterval='';
  function resizePreviewCanvas(layer){
    const proxy=window.__NovaFlowSkeletonTimelineOfficialProxy,canvas=layer?.querySelector('canvas');
    if(!canvas||proxy?.canvas!==canvas)return;
    const r=canvas.getBoundingClientRect(),dpr=Math.max(1,Math.min(3,devicePixelRatio||1));
    const width=Math.max(1,Math.round(r.width*dpr)),height=Math.max(1,Math.round(r.height*dpr));
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;proxy.player?.renderCurrentPose?.();}
  }
  function releasePreviewSpace(){
    window.NovaFlowSkeletonEditor?.reserveForMotion?.(0);
    previewStage?.removeAttribute('data-novaflow-motion-preview-height');previewStage=null;
    if(previewLayer){if(previousBlockSize)previewLayer.style.setProperty('block-size',previousBlockSize,previousBlockPriority);else previewLayer.style.removeProperty('block-size');resizePreviewCanvas(previewLayer);}
    previewLayer=null;
  }
  function reservePreviewSpace(){
    // 飘带计算 not on screen yet (prepared, measuring): the stage keeps its size until the box shows,
    // or an empty band stood where the box would be (user 2026-10-12: 展开动画工具闪一下)
    if(ribbon&&!ribbonSettled)return;
    const editorTimeline=window.NovaFlowSkeletonEditor?.timeline?.();
    if(editorTimeline){
      const pixels=Math.max(0,Math.round(editorTimeline.getBoundingClientRect().top-floating.getBoundingClientRect().top-2));
      window.NovaFlowSkeletonEditor.reserveForMotion(floating.style.display==='none'?0:pixels);
      return;
    }
    const stage=document.querySelector('[data-novaflow-skeleton-preview-stage="1"]');
    let layer=stage?.querySelector('canvas');
    while(layer&&layer.parentElement!==stage)layer=layer.parentElement;
    if(!layer)return;
    if(layer!==previewLayer){releasePreviewSpace();previewLayer=layer;previousBlockSize=layer.style.getPropertyValue('block-size');previousBlockPriority=layer.style.getPropertyPriority('block-size');}
    previewStage=stage;
    const pixels=Math.max(80,Math.round(floating.getBoundingClientRect().top-stage.getBoundingClientRect().top-8)),height=pixels+'px';
    if(stage.getAttribute('data-novaflow-motion-preview-height')!==String(pixels))stage.setAttribute('data-novaflow-motion-preview-height',String(pixels));
    // The player fits to its own container, leaving the model above the editor.
    // Logical block-size avoids fighting the native shell's physical height rule.
    if(layer.style.getPropertyValue('block-size')!==height)layer.style.setProperty('block-size',height,'important');
    resizePreviewCanvas(layer);
  }
  function positionCurve(){
    if(!stylesReady)return;
    const bar=window.NovaFlowSkeletonEditor?.timeline?.()||document.querySelector('[data-novaflow-skeleton-bottom-playbar="1"]'),r=bar?.getBoundingClientRect();
    if(!r||r.width<1||!host.host.isConnected){floating.style.display='none';bridge.dock?.(null);return;}
    const playButton=bar.querySelector('[data-novaflow-skeleton-playback-button="1"]'),editorBar=window.NovaFlowSkeletonEditor?.timeline?.();
    if(playButton&&playbackMode.previousElementSibling!==playButton)playButton.after(playbackMode);
    // the 骨骼动画 editor keeps its full dopesheet: the 完整动画 / 骨骼片段 switch rides in the
    // editor's header next to its × (user 2026-10-12: 回到早期的位置)
    else if(!playButton&&playbackMode.parentNode!==body.querySelector('.editor-header')){playbackMode.style.position='';playbackMode.style.left='';playbackMode.style.top='';playbackMode.style.zIndex='';playbackMode.style.visibility='';delete playbackMode.dataset.place;body.querySelector('.editor-header')?.insertBefore(playbackMode,body.querySelector('#editorToggle'));}
    // 飘带计算 shows the same 完整动画 / 骨骼片段 switch and bone span, from its own timing row
    const ts=ribbon&&ribbonTiming?ribbonTiming:timing;
    bridge.playbackRange?.(bonePlayback?[ts.animationDelay,ts.animationDelay+ts.boneDuration]:null);
    // Use the real central timeline bounds, never the window or the right sidebar.
    const left=Math.max(0,r.left),width=Math.max(0,Math.min(innerWidth,r.right)-left);
    body.classList.toggle('compact',width<850);body.classList.toggle('narrow',width<620);
    floating.style.width=width+'px';floating.style.display='block';
    // at most 2/3 of the stage above the playbar: the preview keeps the rest (on a narrow,
    // stacked page the stage does not start at 80 and the editor ate the whole preview)
    const stageTop=document.querySelector('[data-novaflow-skeleton-preview-stage="1"]')?.getBoundingClientRect().top;
    // a stacked (small) page keeps half of it for the preview: the main view was left tiny
    const share=document.body.getAttribute('data-novaflow-layout-tier')==='stack'?.5:.66;
    const available=Math.max(160,Number.isFinite(stageTop)?Math.floor((r.top-stageTop)*share):r.top-80);
    let desired=Math.min(400,Math.max(360,innerHeight*.4));
    // 飘带计算: as tall as its content (header, timing row, footer and the docked panel); until
    // its panel is ready the previous tool stays on screen at its own height (user 2026-10-12:
    // 切换飘带会先闪一个空框)
    if(ribbon&&!collapsed&&ribbonSettled&&ribbonFitHeight)desired=ribbonFitHeight;
    else if(!collapsed){
      // the box is as tall as its content (user 2026-10-12: no empty band under the sliders);
      // the content's height depends on the width only, so the layout does not oscillate
      const chrome=['.editor-header','.timing-row','.editor-footer'].reduce((sum,selector)=>sum+body.querySelector(selector).getBoundingClientRect().height,0);
      // (scrollHeight is at least the box's own height, so it would never let the box shrink:
      // measure the rows themselves — the sections and groups are display:contents, so walk through them)
      const content=(el)=>{const top=el.getBoundingClientRect().top;let bottom=top;const walk=(c)=>{if(getComputedStyle(c).display==='contents'){for(const n of c.children)walk(n);return;}const r=c.getBoundingClientRect();if(r.height>0&&r.bottom>bottom)bottom=r.bottom;};for(const c of el.children)walk(c);return bottom-top;};
      desired=chrome+Math.max(content(body.querySelector('.effect-scroll')),content(body.querySelector('.curvepanel')))+12;
    }
    const height=Math.min(desired,available);
    const signature=[left,width,r.top,height].join(',');
    floating.style.display='block';
    if(signature!==lastLayout){
      lastLayout=signature;floating.style.left=left+'px';floating.style.width=width+'px';
      floating.style.bottom=Math.max(0,innerHeight-r.top+8)+'px';
      floating.style.setProperty('--editor-height',height+'px');
    }
    reservePreviewSpace();
    // 飘带计算 is the left column's own panel laid over this box (the runtime's
    // spec reads these): the whole inner box, the header's height kept clear
    // the 飘带 layout only once its panel is open and mounted (prepared off screen): until
    // then the previous tool stays on screen
    if(ribbon&&!collapsed&&!ribbonShown&&!ribbonPrepared&&bridge.prepareRibbon?.())ribbonPrepared=true;
    if(ribbon&&!collapsed&&ribbonPrepared){
      const e=body.getBoundingClientRect(),d=$('ribbonDock').getBoundingClientRect();
      const rect={left:e.left+1,top:e.top+1,width:e.width-2,height:e.height-2,inset:d.top-e.top-1,insetBottom:e.bottom-1-d.bottom};
      // until the box has its final height the docked panel sits far below the screen (same
      // width, so it measures the same): the panel, the box and the timeline then appear in
      // one frame instead of the panel's rows showing first
      ribbonLiveRect=rect;
      const dockRect=ribbonSettled?rect:{...rect,top:rect.top+100000};
      // the editor turns into 飘带计算 only once the panel is really in place (the
      // runtime's pass runs in the mutation callback, before this microtask): until
      // then the previous tool stays on screen, so no frame shows an empty box
      if(bridge.dock?.(dockRect))showRibbon();
      else if(!ribbonShown)queueMicrotask(()=>{if(ribbon&&!ribbonShown&&bridge.dock?.(dockRect))showRibbon();});
    }
    else if(!ribbon||collapsed)bridge.dock?.(null);
    if(ribbon){
      // the footer's label walks React's tree: a few times a second, not every frame (a
      // slider drag paid that walk on each frame)
      if(ribbonShown&&(!ribbonSettled||!ribbonFooterAt||performance.now()-ribbonFooterAt>300)){
        const content=bridge.ribbonContentHeight?.()||0;
        // the docked panel still laying out (its height keeps changing for a few frames): measure
        // every frame and show the box only once two frames in a row agree, at that height
        if(content){ribbonFooterAt=performance.now();const chrome=['.editor-header','#ribbonTimingRow','.editor-footer'].reduce((sum,selector)=>sum+(body.querySelector(selector)?.getBoundingClientRect().height||0),0);const fit=Math.round(chrome+content+2);
        // shown at the first reading (revealRibbon re-measures with the timing row it unhides): the
        // panel's height no longer moves after mounting, and waiting for repeated readings left the
        // previous tool on screen while 飘带's chain selection and preview keys were already in the
        // dopesheet (user 2026-10-12: 进入飘带还是会闪)
        // the bar the box sits on must hold still too: the host's anchor over the editor's timeline
        // trails the dopesheet unfolding by a frame, and a reveal on that frame drew the box low
        // and a frame later high (user 2026-10-12: 展开飘带必闪)
        const barKey=Math.round(r.top)+','+Math.round(r.height)+','+Math.round(r.left)+','+Math.round(r.width);
        if(fit!==ribbonFitHeight||barKey!==ribbonBarKey){ribbonFitHeight=fit;ribbonBarKey=barKey;lastLayout='';ribbonStable=0;ribbonStableAt=performance.now();}else ribbonStable++;if(!ribbonSettled){ribbonSettled=true;revealRibbon();if(stylesReady){floating.style.visibility='visible';playbackMode.style.visibility='visible';window.NovaFlowSkeletonEditor?.timelineCompactNow?.();};reservePreviewSpace();}}const label=bridge.ribbonLabel?.()||'';if($('selection').textContent!==label)$('selection').textContent=label;const off=!!bridge.ribbonWriteDisabled?.();if($('ribbonWrite').disabled!==off)$('ribbonWrite').disabled=off;
        const active=bridge.ribbonActivePreset?.()||'';$('ribbonPresets').querySelectorAll('button').forEach(button=>{const on=button.dataset.id===active;if(button.classList.contains('active')!==on)button.classList.toggle('active',on);});}
    }
    const track=bar.querySelector('[data-novaflow-skeleton-timeline-range="1"]'),tr=track?.getBoundingClientRect();
    if(tr&&ts&&[tr.left,tr.top,tr.width,ts.animationDuration,ts.boneDuration,ts.animationDelay].join(',')!==lastInterval){lastInterval=[tr.left,tr.top,tr.width,ts.animationDuration,ts.boneDuration,ts.animationDelay].join(',');const total=ts.animationDuration,span=Math.max(0,tr.width-12);interval.style.display='block';interval.style.left=(tr.left+6+span*ts.animationDelay/total)+'px';interval.style.width=(span*ts.boneDuration/total)+'px';interval.style.top=(tr.top-8)+'px';interval.setAttribute('aria-label',`本骨骼时段 ${frames(ts.animationDelay)}–${frames(ts.animationDelay+ts.boneDuration)} 帧，动画总时长 ${frames(total)} 帧`);}
  }
  const names = { bounce: '弹跳计算', expand: '缩放计算', shuttle: '移动计算', rotate: '旋转计算', opacity: '透明度计算' };
  function renderPresetButtons(target,items,apply){
    if(!items.length){target.replaceChildren();return;}
    const key=target.id==='opacityPresets'?'opacity':mode;
    target.setAttribute('aria-label',names[key]+'预设');
    target.replaceChildren(...items.map(item=>{const button=document.createElement('button');button.textContent=item[0];button.onclick=()=>{hideRibbonPreview();apply(item);};button.onmouseenter=()=>showPresetCard(button,item[0],host=>mountMotionPreview(host,presetPreviewStack(key,item),key));button.onmouseleave=hideRibbonPreview;return button;}));
  }
  const labels = { x: '位移 X', y: '位移 Y', sx: '缩放 X', sy: '缩放 Y', r: '旋转角度', alpha: '透明度' };
  const channelEnabled = () => channel === 'alpha' ? p.opacity.on : p.enabled && p.axes[channel].on;
  const pointEditable = () => channelEnabled();
  const swinging = () => (mode==='shuttle'||mode==='rotate')&&!p.oneWay&&!p.spring;
  const channelLoops = () => !p.oneWay&&(swinging()||(p.loop&&(mode==='expand'||channel==='alpha')));
  const displayValue = v => channel === 'alpha' ? v * 100 : v;

  const initial=bridge.initial(); const sessions = initial?.stack || E.freshStack();
  // Configs saved before the rotation mode existed have no rotate session.
  sessions.rotate ??= E.freshStack().rotate; for (const state of Object.values(sessions)) state.axes.r ??= { on: false, amp: 0 }, state.corrections.r ??= Array(17).fill(0);
  const timing=E.fitTiming({...bridge.timing(),...initial?.timing}); let restoring=false,historyAt=0;const history=[],redo=[];let lastSeek=0;
  function shareOpacity(source) { for (const session of Object.values(sessions)) { session.opacity = source.opacity; session.corrections.alpha = source.corrections.alpha; } }
  for(const state of Object.values(sessions))state.loop??=state.mode==='shuttle'||(state.mode==='opacity'&&state.opacity.behavior==='pulse');shareOpacity(sessions.opacity);
  function shareDuration(value) { for (const session of Object.values(sessions)) { session.delay = (session.delay || 0) / session.duration * value; session.duration = value; } }
  shareDuration(timing.boneDuration); let lastSnapshot=JSON.stringify({stack:sessions,timing});
  let mode = 'bounce', p = sessions[mode], channel = 'y', time = 0, playing = false, last = 0, point = 0, pointSelected = false, picture = null, pictureURL = null, drag = null, curveBounds = null;
  let stageDrag = null, stageGeometry = null, peakCache = [];
  const presetSets = {
    opacity: [],
    bounce: [
      ['橡胶球', { restitution: .64, count: 4, contact: .09, impact: .3 }, { x: 110, y: 190 }],
      ['软果冻', { restitution: .42, count: 3, contact: .28, impact: .7 }, { x: 60, y: 160 }],
      ['重物落地', { restitution: .10, count: 2, contact: .10, impact: .5 }, { x: 30, y: 190 }]
    ],
    expand: [
      ['弹性放大', { attack: .20, frequency: 2.5, damping: 5 }, { x: 0, y: 0, sx: .55, sy: .55 }],
      ['受击压扁', { attack: .12, frequency: 3.5, damping: 8 }, { x: 0, y: 0, sx: .42, sy: -.35 }],
      ['柔和呼吸', { attack: .48, frequency: .25, damping: 1.3 }, { x: 0, y: 0, sx: .12, sy: .18 }],
      ['匀速放大', { oneWay:'linear',easing:0,hold:0 }, { sx:.55,sy:.55 }],
      ['柔和放大', { oneWay:'smooth',easing:1,hold:0 }, { sx:.55,sy:.55 }],
      ['渐停放大', { oneWay:'out',easing:1,hold:0 }, { sx:.55,sy:.55 }]
    ],
    shuttle: [
      ['左右往返', { easing: 1, hold: .06 }, { x: 145, y: 0, sx: .12, sy: -.12 }],
      ['上下浮动', { easing: 1, hold: 0 }, { x: 0, y: 95, sx: .10, sy: -.10 }],
      ['椭圆运动', { easing: 1, hold: 0 }, { x: 140, y: 80, sx: .12, sy: -.12 }],
      ['向左移动', { oneWay:'smooth',easing:1,hold:0 }, { x:-145,y:0 }],
      ['向上移动', { oneWay:'smooth',easing:1,hold:0 }, { x:0,y:95 }],
      ['斜向移动', { oneWay:'smooth',easing:1,hold:0 }, { x:140,y:80 }]
    ],
    rotate: [
      ['左右摇摆', { loop:true, easing:1, hold:.06 }, { r: 25 }],
      ['匀速旋转', { oneWay:'linear', easing:0, hold:0 }, { r: 360 }],
      ['单向旋转', { oneWay:'smooth', easing:1, hold:0 }, { r: 90 }],
      ['受击回正', { spring:true, loop:false, attack:.15, frequency:3, damping:6 }, { r: 40 }]
    ]
  };
  const schema = {
    loopCount: ['循环次数',1,8,1,'',1],
    cycles: ['次数', 1, 10, 1, '次', 1],
    duration: ['骨骼时长', 1/30, 30, 1/30, '帧', 30],
    delay: ['骨骼延迟', 0, 1, 1/30, '帧', 30],
    restitution: ['反弹高度', 0, .9, .01, '%', 100],
    count: ['反弹次数', 0, 6, 1, '次', 1],
    contact: ['落地停留', .04, .4, .01, '%', 100],
    impact: ['冲击力度', 0, 1, .01, '%', 100],
    stretch: ['腾空拉伸', 0, .8, .01, '%', 100],
    attack: ['到峰时间', .05, .6, .01, '%', 100],
    frequency: ['振荡次数', .25, 6, .25, '次', 1],
    damping: ['回弹衰减', .5, 12, .1, '', 1],
    easing: ['两端缓动', 0, 1, .01, '%', 100],
    hold: ['两端停留', 0, .35, .01, '%', 100]
  };
  const modeKeys = { bounce: ['duration', 'restitution', 'count', 'contact'], expand: ['duration', 'attack', 'frequency', 'damping'], shuttle: ['duration', 'easing', 'hold'], rotate: ['duration', 'easing', 'hold'], opacity: ['duration'] };
  const commonKeys = { bounce: ['restitution', 'count'], expand: ['attack'], shuttle: [], rotate: [], opacity: [] };
  const primaryChannels = { bounce: ['y', 'x'], expand: ['sx', 'sy'], shuttle: ['x', 'y'], rotate: ['r'], opacity: [] };
  const fmt = (n, d = 2) => Number(n.toFixed(d)).toString();
  // the timing rows show frames (30 a second); the values stay seconds underneath
  const FPS=30,FRAME=1/FPS,frames=seconds=>Math.round(seconds*FPS),onFrame=seconds=>Math.max(0,Math.round(seconds*FPS))/FPS;
  let previewError='';
  const status = (message,isError=false) => { const text=previewError||(isError?message:''),node=$('status');if(node.textContent!==text)node.textContent=text;if(node.hidden!==!text)node.hidden=!text; };
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
    /* composition summary */ const summary = Object.keys(names).filter(m => m === 'opacity' ? sessions.opacity.opacity.on : sessions[m].enabled).map(m => names[m].replace('计算', '')).join(' + ') || '初始姿态 · 选择预设或调整参数';
  }
  function parameterChanged(activate = true) { if (activate && mode !== 'opacity') p.enabled = true; syncEnabled(); time = Math.min(time, p.duration); refreshEvents(); syncBounceHeights(); curveBounds = null; draw(); syncPoint(); }
  function syncBounceHeights() {
    $('bounceHeightSection').hidden = mode !== 'bounce';
    if (mode !== 'bounce') { peakCache = []; return; }
    const ground = p.groundY || 0, peak = ground + p.axes.y.amp;
    $('groundRuleHint').textContent = '冲击为 0 时不下沉；力度越大，下冲越深，再回弹。地面仅作参考。';
    for (const [key, value] of [['ground', ground], ['peak', peak]]) {
      if ($('height-num-' + key) && curveRoot.activeElement !== $('height-num-' + key)) $('height-num-' + key).value = fmt(value, 1);
      if ($('height-range-' + key)) $('height-range-' + key).value = value;
    }
    peakCache = E.peaks(p);
  }
  function setBounceHeight(kind, value) {
    if (mode !== 'bounce' || !Number.isFinite(value)) return;
    pointSelected=false;const oldGround = p.groundY || 0, oldPeak = oldGround + p.axes.y.amp;
    if (kind === 'ground') {
      p.groundY = E.clamp(value, Math.max(-200, oldPeak - 600), Math.min(200, oldPeak));
      p.axes.y.amp = oldPeak - p.groundY;
    } else p.axes.y.amp = E.clamp(value - oldGround, 0, 600);
    p.axes.y.on = true;
    // A new height constraint regenerates only the Y trajectory; preserve all other channels.
    p.corrections.y.fill(0); if(p.curves)delete p.curves.y;
    $('axis-num-y').value = fmt(p.axes.y.amp); $('axis-range-y').value = p.axes.y.amp;
    $('axis-num-y').disabled = $('axis-range-y').disabled = false;
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
    const [label, min, schemaMax, schemaStep, unit, schemaFactor] = schema[key], factor = schemaFactor, step = schemaStep, max = key === 'delay' ? p.duration : key === 'duration' ? timing.animationDuration : schemaMax, div = document.createElement('div'); div.className = 'param';
    div.innerHTML = `<div class="paramhead"><label for="range-${key}">${label}</label><span class="numberwrap"><input id="num-${key}" type="number" aria-label="${label}数值" min="${min * factor}" max="${max * factor}" step="${step * factor}" value="${fmt(p[key] * factor)}"><span>${unit}</span></span></div><input id="range-${key}" aria-label="${label}" type="range" min="${min}" max="${max}" step="${step}" value="${p[key]}">`;
    const number = div.querySelector('input[type=number]'), range = div.querySelector('input[type=range]');
    range.oninput = () => { if(key==='duration')p.delay=p.delay/p.duration*Number(range.value);p[key] = Number(range.value); if (key === 'duration') {timing.boneDuration=p[key];shareDuration(p[key]);renderEffectTiming();} number.value = fmt(p[key] * factor); parameterChanged(key !== 'duration'); };
    number.oninput = () => { if (number.value === '') return; const oldDuration=p.duration;p[key] = validInput(number, min * factor, max * factor, p[key] * factor) / factor; if(key==='duration')p.delay=p.delay/oldDuration*p.duration; if (key === 'count' || key === 'cycles') p[key] = Math.round(p[key]); if (key === 'duration') {timing.boneDuration=p[key];shareDuration(p[key]);renderEffectTiming();} range.value = p[key]; parameterChanged(key !== 'duration'); };
    number.onblur = () => { number.value = fmt(p[key] * factor); };
    return div;
  }
  function axisSpec(k) { return k[0] === 's' ? [-.85, 10, .01, 100, '%'] : k === 'r' ? [-720, 720, 1, 1, '°'] : mode === 'shuttle' ? [-1000, 1000, 1, 1, 'px'] : k === 'y' && mode === 'bounce' ? [0, 600, 1, 1, 'px'] : [-200, 200, 1, 1, 'px']; }
  function setAmplitude(k, v) {
    if(pointSelected){
      const selected=E.curveFor(p,channel)[point],knots=JSON.parse(JSON.stringify(E.curveFor(p,k)));
      let index=knots.findIndex(n=>Math.abs(n.u-selected.u)<.0001);if(index<0)index=E.insertCurvePoint(knots,selected.u);
      if(index>=0){const oldChannel=channel;channel=k;moveKnot(knots,index,selected.u,v+(k.startsWith('s')?1:0));E.storeLinkedCurve(p,k,knots);channel=oldChannel;p.enabled=true;draw();syncPoint();}return;
    }
    const old = p.axes[k].amp; p.axes[k].amp = v;
    if (p.link && k.startsWith('s')) {
      const other = k === 'sx' ? 'sy' : 'sx';
      // Preserve the current signed X:Y ratio, so squash and uniform expansion share one control.
      const ratio = Math.abs(old) > .0001 ? p.axes[other].amp / old : mode === 'bounce' ? -1 : 1;
      p.axes[other].amp = E.clamp(v * ratio, ...axisSpec(other).slice(0,2));
      $('axis-range-' + other).value = p.axes[other].amp;
      $('axis-num-' + other).value = fmt(p.axes[other].amp * 100);
    }
    parameterChanged();
  }
  function makeAxis(k) {
    const a = p.axes[k];a.on=true;const [min, max, step, factor, unit] = axisSpec(k), div = document.createElement('div'); div.className = 'axiscontrol';
    div.innerHTML = `<div class="axisrow"><label class="axis-label" for="axis-range-${k}">${labels[k]}</label><div class="row"><input id="axis-num-${k}" class="axisnumber" type="number" aria-label="${labels[k]}幅度数值" min="${min * factor}" max="${max * factor}" step="${step * factor}" value="${fmt(a.amp * factor)}"><span class="axisunit">${unit}</span></div></div><input id="axis-range-${k}" type="range" aria-label="${labels[k]}幅度" min="${min}" max="${max}" step="${step}" value="${a.amp}">`;
    const number = div.querySelector('input[type=number]'), range = div.querySelector('input[type=range]');
    div.querySelector('.axis-label').textContent=labels[k];
    number.disabled = range.disabled = !a.on;
    range.oninput = () => { number.value = fmt(Number(range.value) * factor); setAmplitude(k, Number(range.value)); };
    number.oninput = () => { if (number.value === '') return; const val = validInput(number, Number(number.min), Number(number.max), a.amp * factor) / factor; range.value = val; setAmplitude(k, val); };
    number.onblur = syncAxisControls;

    if (mode === 'shuttle' && !p.oneWay && p.loop) {
      const extra = document.createElement('div'); extra.className = 'axisextra';
      extra.innerHTML = `<label><span>次数</span><input type="number" min="1" max="6" step="1" value="${a.cycles}" aria-label="${labels[k]}次数"></label>`;
      const nums = extra.querySelectorAll('input'); nums.forEach(n => n.disabled = !a.on);
      nums[0].oninput = () => { if (!nums[0].value) return; a.cycles = Math.round(validInput(nums[0], 1, 6, a.cycles)); parameterChanged(); };
      nums[0].onblur = () => nums[0].value = a.cycles;
      div.append(extra);
    }
    return div;
  }
  const opacitySchema = {
    from: ['起始透明', 0, 1, .01, '%', 100], to: ['目标透明', 0, 1, .01, '%', 100],
    begin: ['开始时间', 0, .99, .01, '%', 100], finish: ['结束时间', .01, 1, .01, '%', 100],
    cycles: ['往返次数', 1, 8, 1, '次', 1], phase: ['相位', 0, 360, 5, '°', 1],
    easing: ['缓动', 0, 1, .01, '%', 100], hold: ['两端停留', 0, .35, .01, '%', 100]
  };
  function renderOpacity() {
    const o = p.opacity;
    $('opacitySummary').textContent = o.on ? (o.behavior === 'pulse' ? '循环变化' : `${fmt(o.from * 100)}% → ${fmt(o.to * 100)}%`) : '未启用';
    renderPresetButtons($('opacityPresets'),[
      ['透明到实心', { behavior: 'once', from: 0, to: 1, easing: 1, hold: 0 }],
      ['实心到透明', { behavior: 'once', from: 1, to: 0, easing: 1, hold: 0 }],
      ['呼吸闪烁', { behavior: 'pulse', from: .15, to: 1, cycles: 3, phase: 0, easing: 1, hold: .08 }]
    ],([name, values]) => {
      p.initialized=true;Object.assign(o, values, { on: true, begin: 0, finish: 1 });p.loop=o.behavior==='pulse';$('loop').checked=p.loop; p.corrections.alpha.fill(0); if(p.curves)delete p.curves.alpha; channel = 'alpha'; point = 0; pointSelected=false; curveBounds = null; syncEnabled(); renderOpacity(); renderTabs(); syncPoint(); restart(true); status(`已应用「${name}」，动作参数保留；可在透明度曲线上继续调节。`);
    });
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
    $('opacityControls').replaceChildren(...controls.filter((_, i) => ['from','to'].includes(keys[i])), ...controls.filter((_, i) => !['from','to'].includes(keys[i])), note);
    $('opacityControls').hidden = !o.on;
  }

  function renderTiming(){
    const fields=[['animationDuration','动画时长',Math.max(FRAME,Math.ceil((timing.minimumDuration||FRAME)*FPS)/FPS),120,FRAME,'帧',FPS],['animationDelay','动画延迟',0,Math.max(0,timing.animationDuration-timing.boneDuration),FRAME,'帧',FPS]];
    const nodes=fields.map(([key,label,min,max,step,unit,factor])=>{
      const div=document.createElement('div');div.className='param animation-timing';
      div.innerHTML=`<div class="paramhead"><label for="outer-${key}">${label}</label><span class="numberwrap"><input aria-label="${label}数值" type="number" min="${min*factor}" max="${max*factor}" step="${step*factor}" value="${fmt(timing[key]*factor)}"><span>${unit}</span></span></div><input id="outer-${key}" aria-label="${label}" type="range" min="${min}" max="${max}" step="${step}" value="${timing[key]}">`;
      const range=div.querySelector('[type=range]'),num=div.querySelector('[type=number]');
      const currentFactor=()=>FPS;
      const update=value=>{timing[key]=value;E.fitTiming(timing);shareDuration(timing.boneDuration);syncTimingControls();draw();};
      range.oninput=()=>{num.value=fmt(Number(range.value)*currentFactor());update(Number(range.value));};
      num.oninput=()=>{if(num.value==='')return;const f=currentFactor();update(validInput(num,min*f,Number(range.max)*f,timing[key]*f)/f);range.value=timing[key];};
      num.onblur=()=>{num.value=fmt(timing[key]*currentFactor());};
      return div;
    });
    const help=document.createElement('p');help.className='timing-hint';help.id='timingHint';help.title='只调整本骨骼在整体动画中的开始时间。';nodes[1].append(help);
    $('globalTiming').replaceChildren(nodes[0],nodes[1],makeParam('duration'));
    renderEffectTiming();
  }
  function syncTimingControls(){
    const delay=$('outer-animationDelay'),number=delay?.parentElement.querySelector('[type=number]');
    if(delay){delay.max=Math.max(0,timing.animationDuration-timing.boneDuration);delay.value=timing.animationDelay;number.max=frames(Number(delay.max));if(curveRoot.activeElement!==number)number.value=fmt(timing.animationDelay*FPS);}
    if($('range-duration')){$('range-duration').max=timing.animationDuration;$('range-duration').value=timing.boneDuration;$('num-duration').max=frames(timing.animationDuration);if(curveRoot.activeElement!==$('num-duration'))$('num-duration').value=fmt(timing.boneDuration*FPS);}
    if($('range-delay')){$('range-delay').max=p.duration;$('range-delay').value=p.delay;}
  }
  function renderEffectTiming(){
    $('effectTiming').replaceChildren(makeParam('delay'));
    const delayHint=document.createElement('p');delayHint.className='help';delayHint.id='delayHint';delayHint.title='在本骨骼自然循环内向后偏移，周期不变。0 帧与整个周期是相同起点。';delayHint.textContent=`偏移 ${frames(p.delay)} 帧 · ${frames(p.duration)} 帧周期内`;$('effectTiming').append(delayHint);
  }
  function renderPanel() {
    body.classList.toggle('expand-mode',mode==='expand');
    // every tool keeps its check boxes in the same row: under the parameters, a rule above
    const optionsParent=body.querySelector('.effect-parameters');
    if($('scaleOptions').parentElement!==optionsParent)optionsParent.append($('scaleOptions'));
    $('selection').textContent=bridge.label()+' · Ctrl+Z 撤销 · Ctrl+Y 重做';$('editorTitle').textContent=names[mode];
    renderTiming();
    $('mainControls').hidden = mode === 'opacity';
    const singleExpansion=mode==='expand'&&p.oneWay;
    $('params').replaceChildren(...(singleExpansion?[]:commonKeys[mode]).map(makeParam));
    const rotateKeys=['cycles',...(p.spring?['attack','frequency','damping']:p.oneWay==='linear'?['hold']:['easing','hold'])];
    $('advancedParams').replaceChildren(...(singleExpansion?(p.oneWay==='linear'?['hold']:['easing','hold']):mode==='rotate'?rotateKeys:modeKeys[mode].filter(k => k !== 'duration' && !commonKeys[mode].includes(k))).map(makeParam));
    $('primaryAxes').replaceChildren(...primaryChannels[mode].map(makeAxis));
    $('presetSection').hidden = mode === 'opacity';$('opacityPresets').hidden=mode!=='opacity'; $('opacityDetails').hidden = mode !== 'opacity'; $('scaleOptions').hidden = mode === 'bounce';$('linkOption').hidden=mode!=='expand';$('directionLabel').textContent=mode==='opacity'?'循环':'反向';$('loop').checked=mode==='opacity'?!!p.loop:!!p.reverse;
    renderPresetButtons($('presets'),presetSets[mode],([name, vals, axes]) => {
      pointSelected=false;const reverse=p.reverse,loop=p.loop,loopCount=p.loopCount,duration = p.duration, delay = p.delay, opacity = p.opacity, alpha = p.corrections.alpha, groundY = p.groundY, ground = p.ground; p = sessions[mode] = E.freshStack()[mode];p.initialized=true; p.duration = duration; p.delay = delay;p.reverse=!!reverse;p.loop=loop;p.loopCount=loopCount; p.opacity = opacity; p.corrections.alpha = alpha; p.enabled = true; if (mode === 'bounce') { p.groundY = groundY || 0; p.ground = ground !== false; } Object.assign(p, vals); for (const k of E.ownedChannels[mode]) p.axes[k].amp = axes[k]; renderPanel(); restart(true); status(`已应用「${name}」，其他分项调整保留并继续叠加。`);
    });
    $('link').checked = p.link;
    $('linkHelp').textContent = p.link ? '锁定当前 X:Y 比例，滑条和曲线同步调整；取消勾选可独立调节。' : '缩放 X / Y 独立调节；原始尺寸为 100%。';
    $('modeHelp').textContent = {
      bounce: '只控制弹跳位移，移动计算在此基础上叠加。',
      expand: '围绕骨骼原点缩放，与已有位移动画同时生效。',
      shuttle: 'X/Y 独立调整。反向交换当前动作的起点和终点，保留曲线微调。',
      rotate: '围绕骨骼原点旋转，叠加在已有旋转关键帧上；次数是一个周期内摆动/击打/步进的次数，反向改变转向。',
      opacity: '独立调整透明度，也可叠加到其他动作。'
    }[mode];
    syncEnabled();
    curveBounds = null; refreshEvents(); renderBounceHeights(); renderOpacity(); renderTabs(); syncPoint(); draw();
  }
  function renderTabs() {
    // A single channel needs no tab bar; the curve is that channel.
    $('curveTabs').hidden=E.ownedChannels[mode].length<2;
    $('curveTabs').replaceChildren(...E.ownedChannels[mode].map(k => { const b = document.createElement('button'); b.textContent = labels[k]; b.classList.toggle('selected', k === channel); b.setAttribute('aria-pressed', k === channel); b.onclick = () => { channel = k; pointSelected=false; curveBounds = null; renderTabs(); syncPoint(); drawCurve(); }; return b; }));
  }
  function setPointValue(value) {
    if (!pointEditable() || !Number.isFinite(value)) return;
    pointSelected=true;
    const knots=editableKnots(); moveKnot(knots,point,knots[point].u,value); E.storeLinkedCurve(p,channel,knots);
    time = E.timelineTime(p, knots[point].u); setPlaying(false);
    syncBounceHeights(); draw(); syncPoint();
  }
  const editableKnots=()=>JSON.parse(JSON.stringify(E.curveFor(p,channel)));
  function limitValue(value){return E.clamp(value,channel==='alpha'?0:channel.startsWith('s')?.08:channel==='r'?-3600:-1000,channel==='alpha'?1:channel.startsWith('s')?11:channel==='r'?3600:1000);}
  function moveKnot(knots,index,u,value){
    const n=knots[index],end=knots.length-1;
    u=index===0?0:index===end?1:E.clamp(u,knots[index-1].u+.0001,knots[index+1].u-.0001);
    const du=u-n.u,dv=limitValue(value)-n.v;
    n.u=u;n.v+=dv;n.in.u+=du;n.in.v+=dv;n.out.u+=du;n.out.v+=dv;
    n.in.u=E.clamp(n.in.u,index?knots[index-1].u:0,u);
    n.out.u=E.clamp(n.out.u,u,index<end?knots[index+1].u:1);
    if(index)knots[index-1].out.u=Math.min(knots[index-1].out.u,n.in.u);
    if(index<end)knots[index+1].in.u=Math.max(knots[index+1].in.u,n.out.u);
    if(channelLoops()&&(index===0||index===end)){
      const other=knots[index===0?end:0],delta=n.v-other.v;other.v=n.v;other.in.v+=delta;other.out.v+=delta;
    }
  }
  function syncPoint() {
    const knots=E.curveFor(p,channel); point=E.clamp(point,0,knots.length-1);
    if (curveRoot.activeElement !== $('pointValue')) $('pointValue').value = fmt(displayValue(knots[point].v), channel.startsWith('s') ? 3 : 1); $('pointValue').disabled = !pointEditable();
    $('pointValue').step = channel.startsWith('s') ? '.01' : '1'; $('curveUnit').textContent = channel === 'alpha' ? '%' : channel.startsWith('s') ? '倍' : channel === 'r' ? '°' : 'px';
    syncAxisControls();
    $('curveState').textContent = !channelEnabled() ? '通道关闭' : '贝塞尔曲线';
  }
  function syncAxisControls(){
    if(mode==='opacity')for(const k of ['from','to']){const range=$('opacity-range-'+k),number=$('opacity-num-'+k);if(range){range.value=p.opacity[k];if(curveRoot.activeElement!==number)number.value=fmt(p.opacity[k]*100);range.style.setProperty('--fill',`${p.opacity[k]*100}%`);}}
    const u=E.curveFor(p,channel)[point]?.u||0;
    for(const k of E.ownedChannels[mode]){
      if(k==='alpha')continue;
      const range=$('axis-range-'+k),number=$('axis-num-'+k);if(!range||!number)continue;
      const value=pointSelected?E.sample(p,u)[k]-(k.startsWith('s')?1:0):p.axes[k].amp,factor=k.startsWith('s')?100:1;
      const spec=axisSpec(k);range.min=Math.min(spec[0],value);range.max=Math.max(spec[1],value);number.min=Number(range.min)*factor;number.max=Number(range.max)*factor;
      range.value=value;if(curveRoot.activeElement!==number)number.value=fmt(value*factor);
      range.style.setProperty('--fill',`${100*(value-Number(range.min))/(Number(range.max)-Number(range.min))}%`);
      range.title=number.title=pointSelected?'所选节点的通道数值':'通道幅度';
    }
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
    const ySteps=g.bottom-g.top<70?2:4;
    for (let i = 0; i <= ySteps; i++) {
      const val = g.min + (g.max - g.min) * i / ySteps, y = yp(val);
      ctx.strokeStyle = '#343c36'; ctx.beginPath(); ctx.moveTo(g.left, y); ctx.lineTo(g.right, y); ctx.stroke(); ctx.fillStyle = '#a3aaa8'; ctx.fillText(fmt(displayValue(val), channel.startsWith('s') ? 2 : 0) + (channel === 'alpha' ? '%' : ''), g.left - 8, y);
    }
    ctx.textAlign = 'center';
    for (let i = 0; i <= 4; i++) { ctx.fillStyle = '#a3aaa8'; ctx.fillText(`${fmt(E.timelineTime(p, i / 4))}s`, xp(i / 4), h - 10); }
    ctx.save(); ctx.beginPath(); ctx.rect(g.left, g.top - 6, g.right - g.left, g.bottom - g.top + 12); ctx.clip();
    const knots=E.curveFor(p,channel);point=E.clamp(point,0,knots.length-1);
    ctx.strokeStyle = '#51c795'; ctx.lineWidth = 2; ctx.beginPath();
    ctx.moveTo(xp(knots[0].u),yp(knots[0].v));
    for(let i=1;i<knots.length;i++){const a=knots[i-1],b=knots[i];ctx.bezierCurveTo(xp(a.out.u),yp(a.out.v),xp(b.in.u),yp(b.in.v),xp(b.u),yp(b.v));}ctx.stroke();
    ctx.strokeStyle = '#e9c668'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(xp(E.effectTime(p, time / p.duration)), g.top); ctx.lineTo(xp(E.effectTime(p, time / p.duration)), g.bottom); ctx.stroke();
    if(channelEnabled()){
      const n=knots[point];ctx.strokeStyle='#b69d60';ctx.fillStyle='#e9c668';ctx.lineWidth=1;
      if(pointSelected)for(const side of ['in','out'])if(side==='in'?point>0:point<knots.length-1){const q=n[side];ctx.beginPath();ctx.moveTo(xp(n.u),yp(n.v));ctx.lineTo(xp(q.u),yp(q.v));ctx.stroke();ctx.fillRect(xp(q.u)-3,yp(q.v)-3,6,6);}
      for (let i = 0; i < knots.length; i++) {
      const n=knots[i],y = yp(n.v); ctx.fillStyle = i === point && pointSelected ? '#e9c668' : '#1e2220'; ctx.strokeStyle = i === point && pointSelected ? '#e9c668' : '#6ed3a7'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(xp(n.u), y, i === point && pointSelected ? 4.6 : 3.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    }
    $('curve').dataset.knotCount=String(knots.length);
    ctx.restore();
  }
  // the preview writes the animation into the project and the whole app renders it: once per
  // frame with the latest values (every slider input did it, a drag ran at ~16 fps)
  let previewFrame=0;
  function runPreview(){
    previewFrame=0;
    try { bridge.preview(sessions,timing); previewError='';if($('save').disabled)$('save').disabled=false; status(''); }
    catch(error){previewError=error.message;if(!$('save').disabled)$('save').disabled=true;status(error.message);}
  }
  function schedulePreview(){if(!previewFrame)previewFrame=requestAnimationFrame(runPreview);}
  function flushPreview(){if(previewFrame){cancelAnimationFrame(previewFrame);runPreview();}}
  function draw() {
    E.fitTiming(timing);shareDuration(timing.boneDuration);syncTimingControls();
    if($('timingHint'))$('timingHint').textContent=`偏移 ${frames(timing.animationDelay)} 帧 · ${frames(timing.animationDuration)} 帧时间轴内`;
    curveRoot.querySelectorAll('input[type=range]').forEach(input=>{input.style.setProperty('--fill',`${Number(input.max)>Number(input.min)?100*(Number(input.value)-Number(input.min))/(Number(input.max)-Number(input.min)):0}%`);});
    if($('delayHint'))$('delayHint').textContent=`偏移 ${frames(p.delay)} 帧 · ${frames(p.duration)} 帧周期内`;
    drawCurve();
    const snapshot = JSON.stringify({stack:sessions,timing});
    if(snapshot!==lastSnapshot){
      if(!restoring){if(Date.now()-historyAt>400){history.push(lastSnapshot);if(history.length>40)history.shift();}historyAt=Date.now();redo.length=0;}
      lastSnapshot=snapshot;
      schedulePreview();
    }
    const seekTime=timing.animationDelay+time;
    if(seekTime!==lastSeek){lastSeek=seekTime;bridge.seek(seekTime);}
  }
  function curvePosition(event) { const r = $('curve').getBoundingClientRect(); return { x: event.clientX - r.left, y: event.clientY - r.top }; }
  function nearestPoint(pos, g) {
    let nearest = -1, distance = 13;
    E.curveFor(p,channel).forEach((n,i)=>{const q=screenPoint(n,g),d=Math.hypot(q.x-pos.x,q.y-pos.y);if(d<distance){distance=d;nearest=i;}});
    return nearest;
  }
  function screenPoint(n,g){return {x:g.left+n.u*(g.right-g.left),y:g.bottom-(n.v-g.min)/(g.max-g.min)*(g.bottom-g.top)};}
  $('curve').onpointerdown = e => {
    if(e.button!==0)return;
    const pos=curvePosition(e),g=curveGeometry(),knots=editableKnots(),u=E.clamp((pos.x-g.left)/(g.right-g.left),0,1);
    let index=nearestPoint(pos,g),side=null;setPlaying(false);
    if(index<0&&channelEnabled())for(const key of ['in','out']){
      if(key==='in'?point===0:point===knots.length-1)continue;
      const q=screenPoint(knots[point][key],g);if(Math.hypot(q.x-pos.x,q.y-pos.y)<10){index=point;side=key;break;}
    }
    if(index<0&&channelEnabled()&&e.detail<2){
      const q=screenPoint({u,v:E.evaluateCurve(knots,u)},g);
      if(Math.abs(q.y-pos.y)<10){index=E.insertCurvePoint(knots,u);if(index>=0)E.storeLinkedCurve(p,channel,knots);}
    }
    if(index>=0&&channelEnabled()){
      point=index;pointSelected=true;time=E.timelineTime(p,knots[point].u);
      drag={bounds:{min:g.min,max:g.max},side,start:pos,knots:editableKnots()};
      $('curve').setPointerCapture(e.pointerId);syncPoint();draw();
    }else{time=E.timelineTime(p,u);draw();}
  };
  $('curve').onpointermove = e => {
    if(!drag)return;const pos=curvePosition(e),g=curveGeometry();
    if(Math.hypot(pos.x-drag.start.x,pos.y-drag.start.y)<2)return;
    const knots=JSON.parse(JSON.stringify(drag.knots)),n=knots[point],du=(pos.x-drag.start.x)/(g.right-g.left),dv=(drag.start.y-pos.y)/(g.bottom-g.top)*(g.max-g.min);
    if(drag.side){const q=n[drag.side];q.u=E.clamp(q.u+du,drag.side==='in'?knots[point-1].out.u:n.u,drag.side==='in'?n.u:knots[point+1].in.u);q.v=limitValue(q.v+dv);}
    else moveKnot(knots,point,n.u+du,n.v+dv);
    E.storeLinkedCurve(p,channel,knots);time=E.timelineTime(p,n.u);syncBounceHeights();draw();syncPoint();
  };
  const endDrag = () => { if (!drag) return; drag = null; curveBounds = null; drawCurve(); };
  $('curve').onpointerup = endDrag; $('curve').onpointercancel = endDrag; $('curve').onlostpointercapture = endDrag;
  $('curve').ondblclick = e => { if(!channelEnabled())return;const index=nearestPoint(curvePosition(e),curveGeometry()),knots=editableKnots();if(E.removeCurvePoint(knots,index)){E.storeLinkedCurve(p,channel,knots);point=Math.min(index,knots.length-1);curveBounds=null;syncBounceHeights();draw();syncPoint();} };
  $('pointValue').oninput = () => { if ($('pointValue').value === '') return; setPointValue(Number($('pointValue').value) / (channel === 'alpha' ? 100 : 1)); curveBounds = null; drawCurve(); };
  $('pointValue').onblur = syncPoint;
  $('resetCurve').onclick = () => { pointSelected=false;p.corrections[channel].fill(0);if(p.curves)delete p.curves[channel];if(mode==='expand'&&p.link){const other=channel==='sx'?'sy':'sx';p.corrections[other].fill(0);if(p.curves)delete p.curves[other];}point=0; curveBounds = null; syncBounceHeights(); syncPoint(); draw(); status(`已恢复${labels[channel]}的计算曲线。`); };
  function setCollapsed(value){collapsed=value;$('editorContent').hidden=value;body.classList.toggle('collapsed',value);curveBounds=null;drawCurve();
    // the docked 飘带 leaves / returns in the same task as the box it fills
    if(ribbon&&stylesReady){if(value)bridge.dock?.(null);else positionCurve();}}
  // ---- 飘带计算: the header's built-in presets (hover = the dropdown's preview), its
  // own timing row (骨骼延迟 is the panel's 整体偏移) and the footer's two actions
  let stopRibbonPreview=null,ribbonTiming=null;
  function hideRibbonPreview(){try{stopRibbonPreview?.();}catch{}stopRibbonPreview=null;$('ribbonPreviewCard').hidden=true;$('ribbonPreviewHost').replaceChildren();floating.style.zIndex='60';}
  function showRibbonPreview(button,item){
    showPresetCard(button,item.label,host=>bridge.ribbonPreview?.($('ribbonPreviewCard'),host,item.id)||null);
  }
  // the preset's own motion: a fresh stack with only that preset in it, sampled the way
  // the calculation samples it
  function presetPreviewStack(key,item){
    const stack=E.freshStack();
    if(key==='opacity'){const values=item[1]||{};Object.assign(stack.opacity.opacity,values,{on:true,begin:0,finish:1});stack.opacity.loop=values.behavior==='pulse';return stack;}
    const q=stack[key],vals=item[1]||{},axes=item[2]||{};
    q.enabled=true;q.initialized=true;q.duration=p?.duration||q.duration;Object.assign(q,vals);
    for(const k of E.ownedChannels[key]||[])if(q.axes[k]&&axes[k]!==undefined)q.axes[k].amp=axes[k];
    if(key==='bounce'){q.ground=true;q.groundY=0;}
    return stack;
  }
  function mountMotionPreview(host,stack,key){
    const canvas=document.createElement('canvas');canvas.width=256;canvas.height=192;canvas.className='motion-preview';host.append(canvas);
    const ctx=canvas.getContext('2d'),duration=Math.max(.2,stack[key]?.duration||2);
    const samples=Array.from({length:48},(_,i)=>E.sampleStack(stack,i/47));
    const reach=(k,base)=>Math.max(1e-6,...samples.map(v=>Math.abs(v[k]-base)));
    const kx=Math.min(1,70/reach('x',0)),ky=Math.min(1,(key==='bounce'?120:60)/reach('y',0));
    const groundY=key==='bounce'?160:96;
    let frame=0,origin=performance.now();
    const draw=now=>{
      const u=(((now-origin)/1000)%duration)/duration,v=E.sampleStack(stack,u);
      ctx.clearRect(0,0,256,192);
      if(key==='bounce'){ctx.strokeStyle='#3a3a3a';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(40,groundY+1);ctx.lineTo(216,groundY+1);ctx.stroke();}
      const size=36,cx=128+v.x*kx,cy=(key==='bounce'?groundY-size/2:96)-v.y*ky;
      ctx.save();ctx.translate(cx,cy);ctx.rotate(-(v.r||0)*Math.PI/180);ctx.scale(Math.max(.05,v.sx),Math.max(.05,v.sy));
      ctx.globalAlpha=Math.max(0,Math.min(1,v.alpha));ctx.fillStyle='#5fcdb0';
      ctx.beginPath();ctx.roundRect?ctx.roundRect(-size/2,-size/2,size,size,6):ctx.rect(-size/2,-size/2,size,size);ctx.fill();ctx.restore();
      frame=requestAnimationFrame(draw);
    };
    frame=requestAnimationFrame(draw);
    return ()=>cancelAnimationFrame(frame);
  }
  function showPresetCard(button,label,mount){
    hideRibbonPreview();
    const card=$('ribbonPreviewCard');$('ribbonPreviewLabel').textContent=label;card.hidden=false;
    // over everything while it shows, the rig overlay included (2147483100); back to 60 on hide
    floating.style.zIndex='2147483300';
    // above the button, over the stage (the editor box clips anything that leaves it)
    const f=floating.getBoundingClientRect(),r=button.getBoundingClientRect();
    card.style.left=Math.max(6,Math.min(f.width-card.offsetWidth-6,r.left-f.left))+'px';card.style.top=(r.top-f.top-card.offsetHeight-6)+'px';
    stopRibbonPreview=mount($('ribbonPreviewHost'))||null;
  }
  function renderRibbonPresets(){
    const builtins=(bridge.ribbonPresets?.()||[]).filter(item=>!item.custom),wrap=$('ribbonPresets'),key=builtins.map(item=>item.id+item.label).join('|');
    if(wrap.dataset.key===key)return;wrap.dataset.key=key;
    wrap.replaceChildren(...builtins.map(item=>{
      const button=document.createElement('button');button.textContent=item.label;button.dataset.id=item.id;
      button.onclick=()=>{hideRibbonPreview();bridge.applyRibbonPreset?.(item.id);};
      button.onmouseenter=()=>showRibbonPreview(button,item);button.onmouseleave=hideRibbonPreview;
      return button;
    }));
  }
  function ribbonField(key,label,min,max,step,unit,factor,blue){
    const t=ribbonTiming,div=document.createElement('div');div.className='param'+(blue?'':' animation-timing');if(blue)div.style.setProperty('--accent','#59a8ed');
    div.innerHTML=`<div class="paramhead"><label>${label}</label><span class="numberwrap"><input aria-label="${label}数值" type="number" step="${step*factor}" value="${fmt(t[key]*factor)}"><span>${unit}</span></span></div><input aria-label="${label}" type="range" min="${min}" max="${max}" step="${step}" value="${t[key]}">`;
    const range=div.querySelector('[type=range]'),num=div.querySelector('[type=number]');div.dataset.key=key;
    const update=value=>{t[key]=onFrame(value);settleRibbonTiming(key);bridge.setRibbonTiming?.({...t});syncRibbonTiming();};
    range.oninput=()=>update(Number(range.value));
    num.oninput=()=>{if(num.value==='')return;const f=Number(num.dataset.factor||1);update(validInput(num,Number(range.min)*f,Number(range.max)*f,t[key]*f)/f);};
    num.onblur=()=>syncRibbonTiming();
    return div;
  }
  function settleRibbonTiming(changed){
    const t=ribbonTiming;
    t.animationDuration=Math.max(FRAME,Math.min(120,t.animationDuration));
    if(changed==='animationDuration'&&t.boneDuration>t.animationDuration)t.boneDuration=t.animationDuration;
    t.boneDuration=Math.max(FRAME,Math.min(t.animationDuration,t.boneDuration));
    t.animationDelay=Math.max(0,Math.min(t.animationDuration-t.boneDuration,t.animationDelay));
    t.boneDelay=Math.max(0,Math.min(t.boneDuration,t.boneDelay));
  }
  function syncRibbonTiming(){
    const t=ribbonTiming;if(!t)return;
    const limits={animationDuration:[FRAME,120,FPS],animationDelay:[0,Math.max(0,t.animationDuration-t.boneDuration),FPS],boneDuration:[FRAME,t.animationDuration,FPS],boneDelay:[0,t.boneDuration,FPS]};
    curveRoot.querySelectorAll('#ribbonTimingRow .param').forEach(div=>{
      const key=div.dataset.key,[min,max,factor]=limits[key],range=div.querySelector('[type=range]'),num=div.querySelector('[type=number]');
      range.min=min;range.max=max;range.value=t[key];range.style.setProperty('--fill',`${max>min?100*(t[key]-min)/(max-min):0}%`);
      num.dataset.factor=factor;num.min=min*factor;num.max=max*factor;if(curveRoot.activeElement!==num)num.value=fmt(t[key]*factor);
    });
    $('ribbonTimingHint').textContent=`偏移 ${frames(t.animationDelay)} 帧 · ${frames(t.animationDuration)} 帧时间轴内`;
    $('ribbonDelayHint').textContent=`偏移 ${frames(t.boneDelay)} 帧 · ${frames(t.boneDuration)} 帧周期内`;
  }
  function renderRibbonTiming(){
    ribbonTiming={animationDuration:2,animationDelay:0,boneDuration:2,boneDelay:0,...(bridge.ribbonTiming?.()||{})};settleRibbonTiming('');
    const a=ribbonField('animationDuration','动画时长',FRAME,120,FRAME,'帧',FPS),b=ribbonField('animationDelay','动画延迟',0,1,FRAME,'帧',FPS),c=ribbonField('boneDuration','骨骼时长',FRAME,2,FRAME,'帧',FPS,true),d=ribbonField('boneDelay','骨骼延迟',0,2,FRAME,'帧',FPS,true);
    const hint=document.createElement('p');hint.className='timing-hint';hint.id='ribbonTimingHint';b.append(hint);
    const delayHint=document.createElement('p');delayHint.className='help';delayHint.id='ribbonDelayHint';
    $('ribbonGlobalTiming').replaceChildren(a,b,c);$('ribbonEffectTiming').replaceChildren(d,delayHint);
    syncRibbonTiming();
  }
  $('ribbonRestore').onclick=()=>bridge.ribbonAction?.('restore');
  $('ribbonWrite').onclick=()=>{bridge.ribbonAction?.('write');window.NovaFlowSkeletonEditor?.toast?.('已写入动画：关键帧已更新到摄影表');};
  function showRibbon(){
    if(ribbonShown||!ribbon)return;
    $('selection').textContent=(bridge.ribbonLabel?.()||'')+' · Ctrl+Z 撤销 · Ctrl+Y 重做';
    ribbonShown=true;status('');ribbonFooterAt=0;ribbonSettled=false;ribbonStable=0;
    // the box turns into 飘带计算 once the panel's height is measured (revealRibbon from
    // positionCurve): until then the previous tool stays on screen, never an empty box
  }
  function revealRibbon(){
    body.classList.add('ribbon-mode','ribbon-layout');$('editorTitle').textContent='飘带计算';
    // the box's final height, the panel's place in it and the layout switch land in one frame
    const chrome=['.editor-header','#ribbonTimingRow','.editor-footer'].reduce((sum,selector)=>sum+(body.querySelector(selector)?.getBoundingClientRect().height||0),0);
    const content=bridge.ribbonContentHeight?.()||0;if(content)ribbonFitHeight=Math.round(chrome+content+2);
    const r=(window.NovaFlowSkeletonEditor?.timeline?.()||document.querySelector('[data-novaflow-skeleton-bottom-playbar="1"]'))?.getBoundingClientRect();
    const stageTop=document.querySelector('[data-novaflow-skeleton-preview-stage="1"]')?.getBoundingClientRect().top;
    const share=document.body.getAttribute('data-novaflow-layout-tier')==='stack'?.5:.66;
    const available=r?Math.max(160,Number.isFinite(stageTop)?Math.floor((r.top-stageTop)*share):r.top-80):ribbonFitHeight;
    floating.style.setProperty('--editor-height',Math.min(ribbonFitHeight,available)+'px');lastLayout='';
    const e=body.getBoundingClientRect(),d=$('ribbonDock').getBoundingClientRect();
    ribbonLiveRect={left:e.left+1,top:e.top+1,width:e.width-2,height:e.height-2,inset:d.top-e.top-1,insetBottom:e.bottom-1-d.bottom};
    bridge.dock?.(ribbonLiveRect);
    // the footer in the same frame (its regular update runs a few times a second)
    const label=bridge.ribbonLabel?.()||'';if($('selection').textContent!==label)$('selection').textContent=label;
    const off=!!bridge.ribbonWriteDisabled?.();if($('ribbonWrite').disabled!==off)$('ribbonWrite').disabled=off;ribbonFooterAt=performance.now();
  }
  // a tool switch drops the adjustment that was never saved: the bone goes back to its saved
  // animation and the tools to their saved (or initial) values
  function discardUnsaved(){
    if(previewFrame){cancelAnimationFrame(previewFrame);previewFrame=0;}
    if(!bridge.dirty?.())return;
    bridge.discard();
    reloadValues();
  }
  // the bone's saved values (or the initial ones) into the tools
  function reloadValues(){
    if(previewFrame){cancelAnimationFrame(previewFrame);previewFrame=0;}
    const saved=bridge.initial();Object.assign(sessions,saved?.stack||E.freshStack());
    sessions.rotate??=E.freshStack().rotate;for(const state of Object.values(sessions))state.axes.r??={on:false,amp:0},state.corrections.r??=Array(17).fill(0);
    Object.assign(timing,E.fitTiming({...bridge.timing(),...saved?.timing}));shareOpacity(sessions.opacity);shareDuration(timing.boneDuration);
    history.length=0;redo.length=0;lastSnapshot=JSON.stringify({stack:sessions,timing});previewError='';time=0;
  }
  // another bone in the same editor: its values in, the tool kept as it is
  function rebind(next){
    reloadValues();
    if(next&&next!==(ribbon?'ribbon':mode)){selectMode(next);return;}
    if(!ribbon){p=sessions[mode];drag=null;pointSelected=false;renderPanel();}
    status('');
  }
  function selectMode(next){
    if(next!==(ribbon?'ribbon':mode))discardUnsaved();
    ribbon=next==='ribbon';
    // the 飘带 layout is set at once (the dock box is measured off it); the box turns
    // see-through only once the panel sits in it (showRibbon)
    if(ribbon){if(!ribbonShown){renderRibbonPresets();renderRibbonTiming();setCollapsed(false);positionCurve();}return;}
    // leaving 飘带: undock (its preview and chain selection go) in this task, with the new tool's
    // box - on the next pass the new box showed a frame with 飘带's keys still in the dopesheet
    const leavingRibbon=ribbonShown||ribbonPrepared;
    ribbonShown=false;ribbonPrepared=false;ribbonFitHeight=0;ribbonSettled=false;ribbonStable=0;body.classList.remove('ribbon-mode','ribbon-layout');hideRibbonPreview();
    if(leavingRibbon)bridge.dock?.(null);
    setCollapsed(false);mode=next;p=sessions[mode];channel=mode==='opacity'?'alpha':mode==='expand'?'sx':mode==='bounce'?'y':mode==='rotate'?'r':'x';drag=null;pointSelected=false;renderPanel();status('未保存的调整在切换功能时丢弃 · 仅操作当前骨骼');}
  $('resetAll').onclick = () => {
    bridge.restore(); Object.assign(sessions,E.freshStack()); Object.assign(timing,bridge.timing()); shareDuration(timing.boneDuration); shareOpacity(sessions.opacity);p=sessions[mode];
    history.push(lastSnapshot);lastSnapshot=JSON.stringify({stack:sessions,timing});redo.length=0;previewError='';time=0;renderPanel();$('save').disabled=false;status('已恢复本骨骼计算前的动画；其他骨骼保留。');
  };
  $('loop').onchange=()=>{pointSelected=false;if(mode==='opacity'){p.loop=$('loop').checked;p.opacity.behavior=p.loop?'pulse':'once';p.corrections.alpha.fill(0);if(p.curves)delete p.curves.alpha;}else p.reverse=$('loop').checked;parameterChanged();renderPanel();};
  $('link').onchange = () => { p.link = $('link').checked; parameterChanged(false); };
  // × closes 动画工具 itself (the group folds, the editor goes); no collapsed half-state (user)
  $('editorToggle').onclick=()=>{if(window.NovaFlowMotionEditing?.collapse)window.NovaFlowMotionEditing.collapse();else setCollapsed(!collapsed);};
  $('save').onclick = () => { flushPreview(); try{bridge.save(sessions,timing);status('');window.NovaFlowSkeletonEditor?.toast?.('已写入动画：关键帧已更新到摄影表');}catch(error){status(error.message,true);} };
  function restoreSnapshot(value){restoring=true;const v=JSON.parse(value);Object.assign(sessions,v.stack);Object.assign(timing,v.timing);p=sessions[mode];renderPanel();restoring=false;}
  function undo(forward){const from=forward?redo:history,to=forward?history:redo;if(from.length){to.push(lastSnapshot);restoreSnapshot(from.pop());status(forward?'已重做本骨骼参数。':'已撤销本骨骼参数。');}}
  const observer=new ResizeObserver(()=>{curveBounds=null;drawCurve();});observer.observe($('curve'));
  let frameId;
  function frame(){if(host.host.isConnected){positionCurve();if(!collapsed){const currentTime=bridge.time();time=E.clamp(currentTime-timing.animationDelay,0,p.duration);lastSeek=currentTime;drawCurve();}frameId=requestAnimationFrame(frame);}else {floating.style.display='none';interval.style.display='none';}}
  syncPlaybackMode();positionCurve();
  // the calculation tools are always set up underneath 飘带计算 (the frame loop draws them)
  selectMode(bridge.mode&&bridge.mode!=='ribbon'?bridge.mode:'bounce');if(bridge.mode==='ribbon')selectMode('ribbon');
  frameId=requestAnimationFrame(frame);
  return {destroy(){if(previewFrame)cancelAnimationFrame(previewFrame);bridge.dock?.(null);observer.disconnect();cancelAnimationFrame(frameId);bridge.playbackRange?.(null);playbackMode.remove();releasePreviewSpace();floating.remove();interval.remove();},ownsEvent:event=>event.composedPath().includes(floating),selectMode,rebind,status:message=>status(message,true),undo};
}};
})();
