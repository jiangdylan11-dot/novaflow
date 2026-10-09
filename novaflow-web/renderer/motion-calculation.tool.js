/* Formal bone editor bridge. The existing React project remains the single source of truth. */
(() => {
  'use strict';
  const A=window.NovaFlowMotionAnimation,E=window.NovaFlowMotionEngine;
  const records=new WeakMap();
  const ribbonSelector='[data-panel-id="bone-ribbon"], [data-novaflow-ribbon-panel="1"]';
  let panel=null,view=null,session=null,context=null,activeMode='ribbon';
  const copy=x=>JSON.parse(JSON.stringify(x));
  // Registered before React mounts its global editing shortcuts. A shadow-root
  // input must not look like an empty canvas target to the rig editor's undo.
  window.addEventListener('keydown',event=>{
    const key=event.key.toLowerCase();
    if(!(event.ctrlKey||event.metaKey)||!['z','y'].includes(key)||!panel||!(event.composedPath().includes(panel)||view?.ownsEvent(event)))return;
    event.stopImmediatePropagation();
    const target=event.composedPath()[0];
    if(target?.matches?.('input:not([type=range]),textarea,select'))return;
    event.preventDefault();view?.undo(key==='y'||event.shiftKey);
  },true);

  function getContext(){
    const root=document.getElementById('root');
    const key=root&&Object.keys(root).find(k=>k.startsWith('__reactContainer$'));
    const container=key&&root[key];
    const current=container?.stateNode?.current;
    if(!current)return null;
    const todo=[current];let count=0;
    while(todo.length&&count++<20000){
      const fiber=todo.pop(),p=fiber.memoizedProps;
      if(p?.spineSubEditor==='bone'&&p.project?.animations&&typeof p.setProject==='function'&&'activeAnimationName' in p&&'selectedBoneName' in p)return p;
      if(fiber.sibling)todo.push(fiber.sibling);if(fiber.child)todo.push(fiber.child);
    }
    return null;
  }
  function slotNames(p,bone){return (p.slots||[]).filter(s=>s.bone===bone).map(s=>s.name);}
  function clearedAnimation(animation,s){
    const clean={...animation,bones:{...animation.bones},slots:{...animation.slots}};
    delete clean.bones[s.bone];
    for(const name of s.slots){const row={...clean.slots[name]};delete row.color;delete row.rgba;if(Object.keys(row).length)clean.slots[name]=row;else delete clean.slots[name];}
    return clean;
  }
  function calculationBaseline(current,s){
    // Keep the import intact for restore/cancel; replace only this bone's old
    // motion and animated opacity when a calculation function is selected.
    for(const key of Object.keys(s.base.bones?.[s.bone]||{}))s.channels.add(key);
    s.alpha=true;
    return patch(current,clearedAnimation(s.base,s),s);
  }
  function seek(time){
    const range=document.querySelector('[data-novaflow-skeleton-timeline-range="1"]');
    const playbar=range?.closest('[data-novaflow-skeleton-bottom-playbar="1"]');
    const button=playbar?.querySelector('[data-novaflow-skeleton-playback-button="1"]');
    if(button?.querySelector('.fa-pause'))button.click();
    if(range){
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(range,String(time));
      const key=Object.keys(range).find(k=>k.startsWith('__reactProps$'));
      range[key]?.onChange?.({target:range,currentTarget:range,type:'change'});
    }
    const proxy=window.__NovaFlowSkeletonTimelineOfficialProxy;
    proxy?.setPlaying?.(false);proxy?.renderAt?.(time);
    if(playbar){const label=playbar.querySelector('[data-novaflow-skeleton-timeline-time="1"]');if(label)label.textContent=time.toFixed(5);}
  }
  let activePlaybackRange=null;
  function playbackRange(range){activePlaybackRange=range;}
  function playbackTime(){
    // Read the displayed native clock, not the independently updated Spine
    // proxy or the selection context cached by the 350 ms refresh loop.
    const bar=document.querySelector('[data-novaflow-skeleton-bottom-playbar="1"]');
    const range=bar?.querySelector('input[type="range"]');
    const value=Number(range?.value);
    return range&&Number.isFinite(value)?value:Number(getContext()?.currentTimeSec)||0;
  }
  // Called by the native React playback clock, before its full-duration wrap.
  // Paused scrubbing never enters this path and remains unrestricted.
  window.__NovaFlowMotionPlaybackTime=(time,duration)=>{
    if(!activePlaybackRange)return null;
    const start=Math.max(0,Math.min(duration,activePlaybackRange[0]));
    const end=Math.min(duration,activePlaybackRange[1]),span=end-start;
    if(!(span>0))return null;
    return time<start?start:start+(time-start)%span;
  };
  function patch(current,source,s){
    const out={...current,bones:{...current.bones},slots:{...current.slots}};
    const b={...current.bones?.[s.bone]},original=source.bones?.[s.bone]||{};
    for(const key of s.channels){if(Object.hasOwn(original,key))b[key]=original[key];else delete b[key];}
    if(Object.keys(b).length)out.bones[s.bone]=b;else delete out.bones[s.bone];
    if(s.alpha)for(const name of s.slots){const row={...current.slots?.[name]},base=source.slots?.[name]||{};for(const k of ['color','rgba']){if(Object.hasOwn(base,k))row[k]=base[k];else delete row[k];}if(Object.keys(row).length)out.slots[name]=row;else delete out.slots[name];}
    // Duration cannot remove another bone's keys added by another tool.
    const minimum=A.duration({...out,duration:0});
    if(source.duration==null&&minimum<=A.duration(source))delete out.duration;
    else out.duration=Math.max(source.duration||0,minimum);
    return out;
  }
  function sameScope(p,s){return p&&p.project.bones===s.identity&&p.activeAnimationName===s.animation&&p.selectedBoneName===s.bone;}
  function signature(animation,s){return JSON.stringify({bone:animation?.bones?.[s.bone],slots:s.slots.map(n=>animation?.slots?.[n])},(_,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])):value);}
  function matchesExpected(animation,s){
    const current=signature(animation,s);
    if(current===signature(s.expected,s)){s.pendingSignatures?.clear();return true;}
    // React may still expose an earlier frame while our own writes are queued.
    // Only accept those exact snapshots, never an unrelated external edit.
    return s.pendingSignatures?.has(current)||false;
  }
  function write(s,animation){
    const p=getContext();if(!p||p.project.bones!==s.identity)throw Error('骨骼项目已切换，请重新选择骨骼。');
    const existing=p.project.animations[s.animation];
    if(!matchesExpected(existing,s))throw Error('本骨骼已被其他工具修改，请重新打开动画编辑。');
    s.pendingSignatures??=new Set();
    s.pendingSignatures.add(signature(existing,s));
    s.pendingSignatures.add(signature(s.expected,s));
    s.expected=animation;
    p.setProject(previous=>{
      if(previous.bones!==s.identity||!previous.animations[s.animation])return previous;
      return {...previous,animations:{...previous.animations,[s.animation]:patch(previous.animations[s.animation],animation,s)}};
    });
  }
  function createSession(p){
    const animation=p.activeAnimationName,bone=p.selectedBoneName,identity=p.project.bones;
    let group=records.get(identity);if(!group){group=new Map();records.set(identity,group);}
    const key=JSON.stringify([animation,bone]),existing=group.get(key),current=p.project.animations[animation];
    if(existing&&matchesExpected(current,existing)){
      existing.dirty=false;return existing;
    }
    const s={identity,animation,bone,slots:slotNames(p.project,bone),base:current,committed:current,expected:current,channels:new Set(),alpha:false,dirty:false,config:null,group,key,setProject:p.setProject};
    group.set(key,s);return s;
  }
  // An unsaved preview lives in the real project; leaving without 保存动画 must put
  // the bone back. Leaving the section unmounts the bone editor first, so the
  // revert goes through the project setter captured when the session opened.
  function revert(s){
    const setProject=getContext()?.setProject||s.setProject;
    setProject?.(previous=>{
      if(previous.bones!==s.identity||!previous.animations[s.animation])return previous;
      return {...previous,animations:{...previous.animations,[s.animation]:patch(previous.animations[s.animation],s.committed,s)}};
    });
    s.expected=s.committed;s.pendingSignatures?.clear();
  }
  function close(){
    if(session?.dirty){try{revert(session);}catch(error){view?.status(error.message);}}
    if(session)session.dirty=false;
    view?.destroy();view=null;session=null;
  }
  function open(){
    close();context=getContext();
    const body=panel.querySelector('.nf-motion-body');body.replaceChildren();
    if(!context?.project.animations[context.activeAnimationName]||!context.selectedBoneName){body.textContent='请先选择动画和一个骨骼。';return;}
    session=createSession(context);const s=session;
    const host=document.createElement('div');body.append(host);const shadow=host.attachShadow({mode:'open'});
    const timing=()=>{const minimumDuration=Math.max(.05,A.duration({...clearedAnimation(s.base,s),duration:0})),d=Math.max(minimumDuration,A.duration(s.base)||2);return {animationDuration:d,boneDuration:Math.min(d,2.8),animationDelay:0,minimumDuration};};
    const preview=(stack,t)=>{
      const p=getContext();if(!sameScope(p,s))throw Error('已切换骨骼，请在新骨骼面板中调整。');
      if(!matchesExpected(p.project.animations[s.animation],s))throw Error('本骨骼已被其他工具修改，请重新打开动画编辑。');
      if(stack.bounce.enabled||stack.shuttle.enabled||stack.expand.enabled)s.channels.add('translate');
      if(stack.expand.enabled)s.channels.add('scale');
      if(stack.rotate?.enabled)s.channels.add('rotate');
      if(stack.opacity.opacity.from!==1||stack.opacity.opacity.to!==1||stack.opacity.corrections.alpha.some(v=>v)||stack.opacity.curves?.alpha)s.alpha=true;
      const baseline=calculationBaseline(p.project.animations[s.animation],s);
      const project={...p.project,animations:{...p.project.animations,[s.animation]:baseline}};
      const result=A.calculate(project,s.animation,[s.bone],stack,t,E,window.NovaFlowBonesEditor);
      for(const key of ['translate','scale','rotate'])if(result.animation.bones[s.bone]?.[key]!==baseline.bones?.[s.bone]?.[key])s.channels.add(key);
      write(s,result.animation);s.dirty=true;s.pending=copy({stack,timing:t});
      panel.dataset.motionState='preview';panel.dataset.motionInterval=`${result.start},${result.end}`;
    };
    view=window.NovaFlowMotionPanel.mount(shadow,{
      mode:activeMode,
      dock:dockRibbon,
      ...ribbonBridge,
      timing,initial:()=>s.config&&copy(s.config),label:()=>`当前骨骼：${s.bone} · 动画：${s.animation}`,
      time:playbackTime,
      playbackRange,
      seek:time=>{const p=getContext();if(sameScope(p,s)){p.onRibbonEventPreviewFocus?.(time);requestAnimationFrame(()=>{if(session===s)seek(time);});}},
      preview,
      save(stack,t){
        // The most recent preview has already been baked into the real project.
        if(!s.pending)preview(stack,t);
        s.config=copy({stack,timing:t});s.committed=s.expected;s.dirty=false;
        panel.dataset.motionState='saved';
      },
      restore(){write(s,s.base);s.committed=s.expected;s.config=null;s.pending=null;s.dirty=false;panel.dataset.motionState='restored';}
    });
  }
  // 飘带计算 is the native left-column panel, kept out of the column (hosted) and laid
  // over the editor's box while its tool is open (docked); the runtime's spec owns
  // that geometry. It stays open off screen, so docking never mounts it in view.
  const ribbonOpened=new WeakSet();
  function pressNative(el){
    const r=el.getBoundingClientRect(),o={bubbles:true,cancelable:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2,button:0,pointerId:1,isPrimary:true};
    el.dispatchEvent(new PointerEvent('pointerdown',o));el.dispatchEvent(new MouseEvent('mousedown',o));
    el.dispatchEvent(new PointerEvent('pointerup',o));el.dispatchEvent(new MouseEvent('mouseup',o));el.dispatchEvent(new MouseEvent('click',o));
  }
  // ---- docked 飘带: the parts the runtime's spec lays out by marker ------------------
  // 整体偏移's row (the editor's 骨骼延迟 drives it) and the event shown under the tabs
  let eventShown=0,eventCount=0;
  const offsetLabel='整体偏移';
  function offsetRange(ribbon){
    const adv=ribbon?.querySelector('[data-novaflow-ribbon-advanced-body]');
    for(const row of adv?adv.children:[])if((row.textContent||'').trim().startsWith(offsetLabel))return {row,range:row.querySelector('input[type=range]')};
    return null;
  }
  // docked there is no event switch: the events section is kept open, and adding an
  // event is what makes events count (the runtime's own toggle, clicked once)
  function keepEventsOpen(ribbon){
    if(!ribbon||ribbon.getAttribute('data-novaflow-ribbon-docked')!=='1')return;
    const section=ribbon.querySelector('[data-novaflow-ribbon-event-section]');
    if(!section||section.getAttribute('data-novaflow-ribbon-event-expanded')==='1')return;
    section.querySelector('[data-novaflow-ribbon-event-head]')?.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
  }
  function markRibbonParts(ribbon){
    keepEventsOpen(ribbon);
    const offset=offsetRange(ribbon);
    if(offset&&offset.row.getAttribute('data-nf-ribbon-offset-row')!=='1')offset.row.setAttribute('data-nf-ribbon-offset-row','1');
    const cards=Array.from(ribbon.querySelectorAll('[data-novaflow-ribbon-event-list] > [data-novaflow-ribbon-event-card]'));
    // a new event is the one shown (the tab added last)
    if(cards.length>eventCount)eventShown=cards.length-1;
    eventCount=cards.length;eventShown=Math.max(0,Math.min(cards.length-1,eventShown));
    const section=ribbon.querySelector('[data-novaflow-ribbon-event-section]');
    if(section&&section.getAttribute('data-nf-ribbon-event-count')!==String(cards.length))section.setAttribute('data-nf-ribbon-event-count',String(cards.length));
    cards.forEach((card,index)=>{
      if(index===eventShown){if(card.getAttribute('data-nf-ribbon-event-shown')!=='1')card.setAttribute('data-nf-ribbon-event-shown','1');}
      else if(card.hasAttribute('data-nf-ribbon-event-shown'))card.removeAttribute('data-nf-ribbon-event-shown');
    });
  }
  function installRibbonDockStyle(){
    if(document.getElementById('nf-ribbon-dock-style'))return;
    const style=document.createElement('style');style.id='nf-ribbon-dock-style';
    // the event tabs on one line, the picked event's sliders from the next one
    const D='[data-novaflow-ribbon-panel="1"][data-novaflow-ribbon-docked="1"]';
    style.textContent=D+' [data-novaflow-ribbon-event-list]::after{content:"";flex:0 0 100%;order:1;height:0}'
      // the column's open-card outline (a pseudo frame) - the editor has its own frame
      +'body '+D+' [data-novaflow-ribbon-event-section="1"][data-novaflow-ribbon-event-expanded]::after{display:none!important}'
      // the tab's delete is a × (its 删除 text is sized to 0 by the runtime's spec)
      +D+' [data-novaflow-ribbon-event-card-title] > button::before{content:"×";font-size:14px;line-height:1}';
    document.head.append(style);
  }
  function setNativeValue(input,value){
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,String(value));
    input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
  }
  // 飘带 timing per animation; 动画总时长 is the animation's own length
  const ribbonTimings=new Map();
  const RIBBON_OFFSET_CYCLES_PER_UNIT=.005;
  function ribbonAnimation(){const p=getContext();return p?{p,name:p.activeAnimationName,animation:p.project.animations[p.activeAnimationName]}:null;}
  function ribbonTimingFor(){
    const a=ribbonAnimation();if(!a)return null;
    const duration=Math.max(.05,Number(a.animation?.duration)||A.duration(a.animation||{})||Number(document.querySelector('[data-novaflow-skeleton-timeline-range="1"]')?.max)||2);
    let t=ribbonTimings.get(a.name);
    if(!t){t={animationDuration:duration,animationDelay:0,boneDuration:duration,boneDelay:0};ribbonTimings.set(a.name,t);}
    t.animationDuration=duration;
    const offset=offsetRange(document.querySelector('[data-novaflow-ribbon-panel="1"]'));
    if(offset?.range)t.boneDelay=Math.max(0,Math.min(t.boneDuration,Number(offset.range.value)*t.boneDuration*RIBBON_OFFSET_CYCLES_PER_UNIT));
    window.__NovaFlowRibbonTiming={animationDelay:t.animationDelay,boneDuration:Math.min(t.boneDuration,t.animationDuration)};
    return {...t};
  }
  function setRibbonTiming(next){
    const a=ribbonAnimation();if(!a)return;
    const t=ribbonTimings.get(a.name)||{};Object.assign(t,next);ribbonTimings.set(a.name,t);
    window.__NovaFlowRibbonTiming={animationDelay:t.animationDelay,boneDuration:t.boneDuration};
    if(Math.abs((Number(a.animation?.duration)||0)-t.animationDuration)>.0005){
      a.p.setProject(previous=>{const animation=previous.animations[a.name];if(!animation)return previous;return {...previous,animations:{...previous.animations,[a.name]:{...animation,duration:Number(t.animationDuration.toFixed(3))}}};});
    }
    const offset=offsetRange(document.querySelector('[data-novaflow-ribbon-panel="1"]'));
    if(offset?.range){
      const raw=Math.round(t.boneDelay/Math.max(.0001,t.boneDuration*RIBBON_OFFSET_CYCLES_PER_UNIT));
      const value=Math.max(Number(offset.range.min)||0,Math.min(Number(offset.range.max)||200,raw));
      if(String(value)!==offset.range.value)setNativeValue(offset.range,value);
    }
    // the span or the delay alone changed: the runtime previews again
    window.NovaFlowRibbonPresets?.refresh?.();
  }
  function ribbonActionButton(kind){
    return Array.from(document.querySelectorAll('[data-novaflow-ribbon-panel="1"] [data-novaflow-ribbon-action-button]'))
      .find(button=>(button.textContent||'').trim()===(kind==='write'?'写入动画':'还原动画'))||null;
  }
  const ribbonBridge={
    ribbonPresets:()=>window.NovaFlowRibbonPresets?.list()||[],
    applyRibbonPreset:id=>window.NovaFlowRibbonPresets?.apply(id),
    ribbonPreview:(root,host,id)=>window.NovaFlowRibbonPresets?.preview(root,host,id),
    ribbonAction:kind=>{const button=ribbonActionButton(kind);if(button&&!button.disabled)button.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));},
    ribbonWriteDisabled:()=>!!ribbonActionButton('write')?.disabled,
    ribbonActivePreset:()=>document.querySelector('[data-novaflow-ribbon-preset-select="1"]')?.value||'',
    ribbonLabel:()=>{const p=getContext();if(!p)return '';const names=(p.selectedBoneNames&&p.selectedBoneNames.length?p.selectedBoneNames:[p.selectedBoneName]).filter(Boolean);return `当前骨骼：${names.join('、')||'未选择'} · 动画：${p.activeAnimationName||''}`;},
    ribbonTiming:ribbonTimingFor,
    setRibbonTiming
  };
  function hostRibbon(ribbon){
    installRibbonDockStyle();
    if(!ribbon.__nfPartsObserver){
      // the same task React adds an event card in, so the tab shows with it
      ribbon.__nfPartsObserver=new MutationObserver(()=>markRibbonParts(ribbon));
      ribbon.__nfPartsObserver.observe(ribbon,{childList:true,subtree:true});
      ribbon.addEventListener('click',event=>{
        const title=event.target instanceof Element?event.target.closest('[data-novaflow-ribbon-event-card-title]'):null;
        if(!title||event.target.closest('button'))return;
        const cards=Array.from(ribbon.querySelectorAll('[data-novaflow-ribbon-event-list] > [data-novaflow-ribbon-event-card]'));
        const index=cards.indexOf(title.parentElement);if(index>=0){eventShown=index;markRibbonParts(ribbon);}
      },true);
    }
    markRibbonParts(ribbon);
    if(ribbon.getAttribute('data-novaflow-ribbon-hosted')!=='1')ribbon.setAttribute('data-novaflow-ribbon-hosted','1');
    if(ribbon.getAttribute('data-open')!=='1'&&!ribbonOpened.has(ribbon)){
      const header=ribbon.querySelector(':scope > .nf-panel-header');
      if(header){ribbonOpened.add(ribbon);pressNative(header);}
    }
    if(!ribbon.__nfWheelStep){
      // the wheel over a docked value steps it, as in the calculation tools
      ribbon.__nfWheelStep=true;
      ribbon.addEventListener('wheel',event=>{
        if(ribbon.getAttribute('data-novaflow-ribbon-docked')!=='1'||!(event.target instanceof Element))return;
        let row=event.target;
        while(row&&row!==ribbon&&!row.querySelector?.('input[type=range]'))row=row.parentElement;
        const range=row&&row!==ribbon?row.querySelector('input[type=range]'):null;
        if(!range||range.disabled||row.querySelectorAll('input[type=range]').length!==1)return;
        event.preventDefault();event.stopPropagation();
        const before=range.value;
        try{if(event.deltaY<0)range.stepUp();else range.stepDown();}catch{return;}
        if(range.value!==before){range.dispatchEvent(new Event('input',{bubbles:true}));range.dispatchEvent(new Event('change',{bubbles:true}));}
      },{passive:false});
    }
  }
  const dockVars=[['left','left'],['top','top'],['width','width'],['height','height'],['inset','inset'],['insetBottom','inset-bottom']];
  function dockRibbon(rect){
    const ribbon=document.querySelector('[data-novaflow-ribbon-panel="1"]');
    if(!rect){if(ribbon?.hasAttribute('data-novaflow-ribbon-docked'))ribbon.removeAttribute('data-novaflow-ribbon-docked');return;}
    const rootStyle=document.documentElement.style;
    for(const [key,name] of dockVars){const value=Math.round(rect[key]||0)+'px';if(rootStyle.getPropertyValue('--nf-ribbon-dock-'+name)!==value)rootStyle.setProperty('--nf-ribbon-dock-'+name,value);}
    if(!ribbon)return false;
    if(ribbon.getAttribute('data-novaflow-ribbon-docked')!=='1'){ribbon.setAttribute('data-novaflow-ribbon-docked','1');keepEventsOpen(ribbon);}
    // whether it already sits there (the panel then shows it in place of its own box)
    const r=ribbon.getBoundingClientRect();
    return Math.abs(r.left-Math.round(rect.left))<=1&&Math.abs(r.top-Math.round(rect.top))<=1&&Math.abs(r.width-Math.round(rect.width))<=1;
  }
  function selectTool(mode){
    activeMode=mode;panel.dataset.editorOpen='1';
    panel.querySelectorAll('[data-motion-mode]').forEach(item=>item.setAttribute('aria-pressed',String(item.dataset.motionMode===mode)));
    if(view&&(mode==='ribbon'||sameScope(getContext(),session)))view.selectMode(activeMode);else open();
  }
  function refresh(){
    const ribbon=document.querySelector(ribbonSelector);
    // Keep the entry discoverable before importing a skeleton. open() explains
    // the required selection until the real editor context becomes available.
    if(!ribbon){if(panel){close();panel.remove();panel=null;}return;}
    hostRibbon(ribbon);
    if(!panel?.isConnected){
      close();panel=document.createElement('div');panel.className='nf-panel';panel.dataset.panelId='bone-motion';panel.dataset.open='0';
      panel.style.cssText='width:100%;font-size:12px';
      panel.innerHTML=`<style>
        [data-panel-id="bone-motion"]{border-bottom:1px solid #272727;padding:3px 0}
        [data-panel-id="bone-motion"] .nf-panel-header{width:100%;height:46px;padding:0 7px;display:flex;align-items:center;justify-content:space-between;text-align:left;background:transparent;color:#d4d4d4;border:0;border-radius:7px;font:inherit;font-weight:500;cursor:pointer}
        [data-panel-id="bone-motion"] .nf-panel-header:hover{background:#222}
        [data-panel-id="bone-motion"] .nf-panel-header .nf-motion-chevron{width:12px;font-size:12px;opacity:.7;text-align:center}
        [data-panel-id="bone-motion"] .nf-motion-tools{display:grid;grid-template-columns:minmax(0,1fr);gap:5px;padding:5px 7px 17px;box-sizing:border-box}
        [data-panel-id="bone-motion"] .nf-motion-tools[hidden]{display:none}
        [data-panel-id="bone-motion"] [data-motion-mode]{width:100%;min-width:0;height:32px;padding:0 10px;text-align:left;line-height:1.2;background:transparent;border:0;border-radius:7px;color:#b4b4b4;font:inherit;font-size:12px;font-weight:500;cursor:pointer;box-shadow:none}
        [data-panel-id="bone-motion"] [data-motion-mode]:hover,[data-panel-id="bone-motion"] [data-motion-mode][aria-pressed="true"]{background:#262626;color:#dedede}
        [data-panel-id="bone-motion"] .nf-motion-body{font-size:11px;color:#999}
      </style><button type="button" class="nf-panel-header" aria-expanded="false"><span style="display:flex;align-items:center"><i class="fas fa-calculator" style="width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;margin-right:8px;background:#292929;border-radius:7px;font-size:14px;color:#bdbdbd" aria-hidden="true"></i>动画编辑</span><i class="fas fa-chevron-right nf-motion-chevron" aria-hidden="true"></i></button><div class="nf-motion-tools" role="group" aria-label="动画编辑工具" hidden>${Object.entries({ribbon:'飘带计算',bounce:'弹跳计算',expand:'缩放计算',shuttle:'移动计算',rotate:'旋转计算',opacity:'透明度计算'}).map(([mode,label])=>`<button type="button" data-motion-mode="${mode}" aria-pressed="false">${label}</button>`).join('')}</div><div class="nf-motion-body"></div>`;
      const lastTool=ribbon.parentElement.querySelector('[data-panel-id="bone-auto-weights"]');
      (lastTool||ribbon.parentElement.lastElementChild).after(panel);
      panel.querySelector('.nf-panel-header').onclick=()=>{
        const expanded=panel.dataset.open!=='1';panel.dataset.open=expanded?'1':'0';
        panel.querySelector('.nf-motion-tools').hidden=!expanded;panel.querySelector('.nf-panel-header').setAttribute('aria-expanded',String(expanded));panel.querySelector('.nf-motion-chevron').className=`fas fa-chevron-${expanded?'down':'right'} nf-motion-chevron`;
        if(!expanded){close();panel.dataset.editorOpen='0';panel.querySelector('.nf-motion-body').replaceChildren();panel.querySelectorAll('[data-motion-mode]').forEach(item=>item.setAttribute('aria-pressed','false'));}
        // opening the group opens the editor at the tool used last (飘带计算 at first)
        else selectTool(activeMode);
      };
      panel.querySelectorAll('[data-motion-mode]').forEach(button=>button.onclick=()=>selectTool(button.dataset.motionMode));
    }
    // The fiber walk is the costly part of this poll; only an open editor needs it.
    if(panel.dataset.open!=='1'||panel.dataset.editorOpen!=='1'||document.hidden)return;
    context=getContext();
    // 飘带计算 works on whatever bones are picked: a new pick must not rebuild the editor
    if(context&&(!session||(activeMode!=='ribbon'&&!sameScope(context,session))))open();
  }
  // Mount in the same DOM-update cycle as the native bone panels, rather than
  // waiting for the selection polling interval and appearing a frame later.
  const containsRibbon=node=>node.nodeType===1&&(node.matches(ribbonSelector)||node.querySelector(ribbonSelector));
  const entryObserver=new MutationObserver(changes=>{
    if((panel&&!panel.isConnected)||changes.some(change=>change.type==='attributes'
      ? change.target.matches(ribbonSelector)
      : [...change.addedNodes,...change.removedNodes].some(containsRibbon)))refresh();
  });
  entryObserver.observe(document.getElementById('root')||document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['data-panel-id','data-novaflow-ribbon-panel']});
  setInterval(refresh,350);refresh();
})();
