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
  const editorApi=()=>{const ed=window.NovaFlowSkeletonEditor;const api=ed&&ed.active&&ed.active()?ed.api():null;return api&&api.loaded()?api:null;};
  const pickedSlot=()=>{const api=editorApi();return api&&api.selectedSlot?api.selectedSlot():null;};
  // the calculation tools need a bone picked, the frame tools an animation; a tool that does not
  // apply to the pick is greyed (the note under the list says what to pick). 透明度计算 was removed
  // 2026-10-12 (user: 鸡肋); the engine's opacity channel stays off underneath.
  function syncToolAvailability(panel){
    const api=editorApi();if(!api)return;
    const bone=api.selectedBone();
    const anim=!!api.anim();
    panel.querySelectorAll('[data-motion-mode]').forEach(item=>{
      // the frame tools need a bone too (the pictures hang on it) and an animation to write into
      // 粒子特效和帧工具一样：要动画，也要骨骼（粒子放在那根骨骼下面，2026-10-16 用户）
      const mode=item.dataset.motionMode,frameTool=isFrameTool(mode)||mode==='particle',ok=frameTool?(anim&&!!bone):!!bone;
      if(item.disabled!==!ok)item.disabled=!ok;
      const title=ok?'':(frameTool&&!anim?'先选一个动画':'先在画板或工程树里选中一个骨骼');
      if(item.title!==title)item.title=title;
    });
    // no bone picked: the open editor (and 飘带计算 docked over it) is greyed and takes no input,
    // like the list (user 2026-10-12: 没选中骨骼，左侧和编辑面板都应该禁用)
    const off=!bone;
    for(const el of [document.querySelector('[data-novaflow-motion-curve="1"]'),document.querySelector('[data-novaflow-ribbon-panel="1"][data-novaflow-ribbon-docked="1"]')]){
      if(!el)continue;
      if(el.inert!==off)el.inert=off;
      if(off&&el.getAttribute('data-nf-motion-no-bone')!=='1')el.setAttribute('data-nf-motion-no-bone','1');
      else if(!off&&el.hasAttribute('data-nf-motion-no-bone'))el.removeAttribute('data-nf-motion-no-bone');
    }
    if(!document.getElementById('nf-motion-no-bone-style')){
      const style=document.createElement('style');style.id='nf-motion-no-bone-style';
      // a filter, not opacity: the runtime's spec pins the docked 飘带 panel's opacity
      style.textContent='[data-nf-motion-no-bone="1"]{filter:grayscale(.7) brightness(.5)!important}';
      document.head.append(style);
    }
  }
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
    // the 骨骼动画 editor (spine-skeleton-editor.host.js) shows the stage and owns the clock
    const editor=window.NovaFlowSkeletonEditor;if(editor?.active?.())editor.seek(time);
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
    const editor=window.NovaFlowSkeletonEditor;if(editor?.active?.())return editor.time();
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
  // the same scope = same project / animation / bone, and the same picked slot (透明度计算 keys that slot alone)
  function sameScope(p,s){return p&&p.project.bones===s.identity&&p.activeAnimationName===s.animation&&p.selectedBoneName===s.bone&&((pickedSlot()||{}).name||'')===(s.pickedSlot||'');}
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
    if(!matchesExpected(existing,s))throw Error('本骨骼已被其他工具修改，请重新打开动画工具。');
    s.pendingSignatures??=new Set();
    s.pendingSignatures.add(signature(existing,s));
    s.pendingSignatures.add(signature(s.expected,s));
    const editor=window.NovaFlowSkeletonEditor;
    if(editor?.applyCalculationAnimation){
      const committed=editor.applyCalculationAnimation(s.animation,patch(existing,animation,s),'write');
      if(!committed)throw Error('动画已切换，请重新选择计算工具。');
      s.expected=typeof committed==='object'?committed:animation;
      return;
    }
    s.expected=animation;
    p.setProject(previous=>{
      if(previous.bones!==s.identity||!previous.animations[s.animation])return previous;
      return {...previous,animations:{...previous.animations,[s.animation]:patch(previous.animations[s.animation],animation,s)}};
    });
  }
  function createSession(p){
    const animation=p.activeAnimationName,bone=p.selectedBoneName,identity=p.project.bones;
    let group=records.get(identity);if(!group){group=new Map();records.set(identity,group);}
    const key=JSON.stringify([animation,bone,(pickedSlot()||{}).name||'']),existing=group.get(key),current=p.project.animations[animation];
    if(existing&&matchesExpected(current,existing)){
      existing.dirty=false;return existing;
    }
    // 透明度计算 keys the picked slot alone (the 骨骼动画 editor's pick); without one, every slot of the bone
    const picked=pickedSlot(),slots=picked&&picked.bone===bone?[picked.name]:slotNames(p.project,bone);
    const s={identity,animation,bone,slots,pickedSlot:(picked||{}).name||'',base:current,committed:current,expected:current,channels:new Set(),alpha:false,dirty:false,config:null,group,key,setProject:p.setProject};
    group.set(key,s);return s;
  }
  // Unwritten calculations only affect the live pose; closing never writes a compensating edit.
  function revert(s){
    window.NovaFlowSkeletonEditor?.api?.()?.clearAnimationPreview?.();
    s.pendingAnimation=null;s.pending=null;
    s.expected=s.committed;s.pendingSignatures?.clear();
  }
  function previewCalculation(s,animation){
    if(!window.NovaFlowSkeletonEditor?.applyCalculationAnimation?.(s.animation,animation,'preview'))throw Error('动画已切换，请重新选择计算工具。');
    s.pendingAnimation=animation;s.dirty=true;
  }
  let rebind=null;
  function close(){
    rebind=null;
    if(session?.dirty){try{revert(session);}catch(error){view?.status(error.message);}}
    if(session)session.dirty=false;
    view?.destroy();view=null;session=null;
  }
  function open(){
    // One editor: a pick in progress can read "no bone" for a moment and the editor stays;
    // another bone keeps the same editor and only swaps in that bone's values (closing and
    // building it again made the whole editor vanish for a moment on every bone pick)
    const next=getContext();
    const ready=!!(next?.project.animations[next.activeAnimationName]&&next.selectedBoneName);
    if(view&&!ready)return;
    if(view&&rebind){rebind(next);return;}
    close();context=next;
    const body=panel.querySelector('.nf-motion-body');body.replaceChildren();
    if(!ready){body.textContent='请先选择动画和一个骨骼。';return;}
    session=createSession(context);let s=session;
    rebind=ctx=>{
      if(s.dirty){try{revert(s);}catch(error){view?.status(error.message);}}
      s.dirty=false;context=ctx;session=s=createSession(ctx);
      view.rebind(activeMode);
    };
    const host=document.createElement('div');body.append(host);const shadow=host.attachShadow({mode:'open'});
    const timing=()=>{const minimumDuration=Math.max(.05,A.duration({...clearedAnimation(s.base,s),duration:0})),d=Math.max(minimumDuration,A.duration(s.base)||2);return {animationDuration:d,boneDuration:Math.min(d,2.8),animationDelay:0,minimumDuration};};
    const preview=(stack,t)=>{
      const p=getContext();if(!sameScope(p,s))throw Error('已切换骨骼，请在新骨骼面板中调整。');
      if(!matchesExpected(p.project.animations[s.animation],s))throw Error('本骨骼已被其他工具修改，请重新打开动画工具。');
      if(stack.bounce.enabled||stack.shuttle.enabled||stack.expand.enabled)s.channels.add('translate');
      if(stack.expand.enabled)s.channels.add('scale');
      if(stack.rotate?.enabled)s.channels.add('rotate');
      if(stack.opacity.opacity.from!==1||stack.opacity.opacity.to!==1||stack.opacity.corrections.alpha.some(v=>v)||stack.opacity.curves?.alpha)s.alpha=true;
      const baseline=calculationBaseline(p.project.animations[s.animation],s);
      const project={...p.project,animations:{...p.project.animations,[s.animation]:baseline}};
      const result=A.calculate(project,s.animation,[s.bone],stack,t,E,window.NovaFlowBonesEditor,{slots:s.slots});
      for(const key of ['translate','scale','rotate'])if(result.animation.bones[s.bone]?.[key]!==baseline.bones?.[s.bone]?.[key])s.channels.add(key);
      previewCalculation(s,result.animation);s.pending=copy({stack,timing:t});
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
        if(!s.pendingAnimation||!s.dirty)preview(stack,t);
        write(s,s.pendingAnimation);
        s.config=copy({stack,timing:t});s.committed=s.expected;s.dirty=false;
        panel.dataset.motionState='saved';
      },
      restore(){const p=getContext();if(!sameScope(p,s))return;previewCalculation(s,patch(p.project.animations[s.animation],s.base,s));s.config=null;s.pending=null;panel.dataset.motionState='preview';},
      // switching tools drops anything not explicitly written
      dirty:()=>s.dirty,
      discard(){if(s.dirty)revert(s);s.pending=null;s.dirty=false;panel.dataset.motionState='discarded';}
    });
  }
  // 飘带计算 is the native left-column panel, kept out of the column (hosted) and laid
  // over the editor's box while its tool is open (docked); the runtime's spec owns
  // that geometry. It is open exactly while docked: an open 飘带 panel runs its own
  // behaviour on every bone pick (camera on the chain, a guard on project writes), which
  // broke the rest of the page while it sat open off screen. React can also close it on
  // its own, so the state is checked and pressed back, at most every 300 ms.
  let ribbonToggledAt=0,ribbonPreparing=false,ribbonPrepareAt=0;
  function syncRibbonOpen(ribbon){
    const want=ribbon.getAttribute('data-novaflow-ribbon-docked')==='1'||ribbonPreparing;
    if((ribbon.getAttribute('data-open')==='1')===want||performance.now()-ribbonToggledAt<300)return;
    const header=ribbon.querySelector(':scope > .nf-panel-header');
    if(header){ribbonToggledAt=performance.now();pressNative(header);}
  }
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
      const del=card.querySelector(':scope [data-novaflow-ribbon-event-card-title] > button');
      if(del&&del.getAttribute('data-novaflow-x-glyph')!=='1')del.setAttribute('data-novaflow-x-glyph','1');
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
      // the tab's delete is the shared close button (theme 2.0z / 3.1a, tagged in markRibbonParts)
      ;
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
    let duration=Math.max(.05,Number(a.animation?.duration)||A.duration(a.animation||{})||Number(document.querySelector('[data-novaflow-skeleton-timeline-range="1"]')?.max)||2);
    let t=ribbonTimings.get(a.name);
    // an animation with no keys yet (a PS export's empty "animation" is 0.01-0.05 s long)
    // starts at 2 s, as the calculation tools do; a ribbon solved over 0.05 s does not move
    const keyed=A.duration({...(a.animation||{}),duration:0});
    if(!t&&!(keyed>0)&&duration<.5){
      duration=2;
      a.p.setProject(previous=>{const animation=previous.animations[a.name];if(!animation)return previous;return {...previous,animations:{...previous.animations,[a.name]:{...animation,duration:2}}};});
    }
    if(!t){t={animationDuration:duration,animationDelay:0,boneDuration:duration,boneDelay:0};ribbonTimings.set(a.name,t);}
    else if(t.animationDuration>duration+.0005&&Math.abs((Number(a.animation?.duration)||0)-duration)<.0005&&!(keyed>0)&&duration<.5)duration=t.animationDuration;
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
  // opened off screen first: the editor keeps the tool it shows until the panel's rows are
  // mounted, then turns into 飘带计算 in one task (no empty box while React mounts it)
  // mounted = its rows are there, the 自动链条 row included (React adds it a moment after the
  // others; the box measured without it grew when it came - a flash); a 600 ms grace in case a
  // build has no such row
  const ribbonMounted=ribbon=>!!(ribbon.querySelector('[data-novaflow-ribbon-preset-controls]')&&ribbon.querySelector('[data-novaflow-ribbon-advanced-card]')&&ribbon.querySelector('[data-novaflow-ribbon-event-section]')&&(ribbon.querySelector('[data-novaflow-ribbon-chain-toggle-card] input')||(ribbonPrepareAt&&performance.now()-ribbonPrepareAt>600)));
  function prepareRibbon(){
    const ribbon=document.querySelector('[data-novaflow-ribbon-panel="1"]');if(!ribbon)return false;
    ribbonPreparing=true;if(!ribbonPrepareAt)ribbonPrepareAt=performance.now();
    if(ribbon.getAttribute('data-open')!=='1'){syncRibbonOpen(ribbon);return false;}
    window.NovaFlowRibbonPresets?.prepare?.(ribbon);
    return ribbonMounted(ribbon);
  }
  // the docked panel's own height (its body is stretched to the box, so add up its parts):
  // the editor is sized to it, with no empty band under the parameters
  function ribbonContentHeight(){
    const ribbon=document.querySelector('[data-novaflow-ribbon-panel="1"][data-novaflow-ribbon-docked="1"]');
    const body=ribbon?.querySelector(':scope > .nf-panel-body');if(!body)return 0;
    const h=sel=>{const n=body.querySelector(sel);return n?n.getBoundingClientRect().height:0;};
    const cs=getComputedStyle(body),pad=parseFloat(cs.paddingTop)+parseFloat(cs.paddingBottom),gap=parseFloat(cs.rowGap)||0;
    // three row gaps: the free 1fr row sits between the parameters and 自动链条
    const left=h(':scope > [data-novaflow-ribbon-preset-controls]')+h(':scope > [data-novaflow-ribbon-advanced-card]')+h(':scope > [data-novaflow-ribbon-chain-toggle-card]')+gap*3;
    const section=body.querySelector(':scope > [data-novaflow-ribbon-event-section]');
    const right=section?h('[data-novaflow-ribbon-event-add]')+(parseFloat(getComputedStyle(section).rowGap)||0)+h('[data-novaflow-ribbon-event-list]'):0;
    // stacked in a narrow editor: the events come under the parameters
    if(ribbon.getAttribute('data-nf-ribbon-narrow')==='1')return Math.ceil(left+gap+(section?parseFloat(getComputedStyle(section).paddingTop)||0:0)+right+pad);
    return Math.ceil(Math.max(left,right)+pad);
  }
  const ribbonBridge={
    prepareRibbon,
    ribbonContentHeight,
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
    syncRibbonOpen(ribbon);
    if(!ribbon.__nfWheelStep){
      // the wheel steps a docked value only once its box is selected (focused) and the cursor
      // is on that row; anywhere else it scrolls the block, as in the calculation tools
      ribbon.__nfWheelStep=true;
      ribbon.addEventListener('wheel',event=>{
        if(ribbon.getAttribute('data-novaflow-ribbon-docked')!=='1'||!(event.target instanceof Element))return;
        let row=event.target;
        while(row&&row!==ribbon&&!row.querySelector?.('input[type=range]'))row=row.parentElement;
        const range=row&&row!==ribbon?row.querySelector('input[type=range]'):null;
        if(!range||range.disabled||row.querySelectorAll('input[type=range]').length!==1)return;
        const focused=document.activeElement;
        if(!(focused instanceof HTMLInputElement)||!row.contains(focused)||!['number','range','text'].includes(focused.type))return;
        event.preventDefault();event.stopPropagation();
        const before=range.value;
        try{if(event.deltaY<0)range.stepUp();else range.stepDown();}catch{return;}
        if(range.value!==before){range.dispatchEvent(new Event('input',{bubbles:true}));range.dispatchEvent(new Event('change',{bubbles:true}));}
      },{passive:false});
    }
  }
  const dockVars=[['left','left'],['top','top'],['width','width'],['height','height'],['inset','inset'],['insetBottom','inset-bottom']];
  let dockPlaced='';
  function dockRibbon(rect){
    const ribbon=document.querySelector('[data-novaflow-ribbon-panel="1"]');
    if(!rect){dockPlaced='';ribbonPreparing=false;ribbonPrepareAt=0;if(!ribbon)return;if(ribbon.hasAttribute('data-novaflow-ribbon-docked')){ribbon.removeAttribute('data-novaflow-ribbon-docked');window.NovaFlowRibbonPresets?.settle?.();}if(ribbon.getAttribute('data-open')==='1')syncRibbonOpen(ribbon);return;}
    // narrow (a small window): the docked panel stacks its events under the parameters
    if(ribbon){const narrow=rect.width<640;if((ribbon.getAttribute('data-nf-ribbon-narrow')==='1')!==narrow){if(narrow)ribbon.setAttribute('data-nf-ribbon-narrow','1');else ribbon.removeAttribute('data-nf-ribbon-narrow');}}
    const rootStyle=document.documentElement.style;let changed=false;
    for(const [key,name] of dockVars){const value=Math.round(rect[key]||0)+'px';if(rootStyle.getPropertyValue('--nf-ribbon-dock-'+name)!==value){rootStyle.setProperty('--nf-ribbon-dock-'+name,value);changed=true;}}
    // already placed in this very box: no measuring (a rect read each frame forced a layout
    // after every slider write - the drag stuttered)
    const signature=dockVars.map(([key])=>Math.round(rect[key]||0)).join(',');
    if(!changed&&ribbon&&dockPlaced===signature&&ribbon.getAttribute('data-novaflow-ribbon-docked')==='1'&&ribbon.getAttribute('data-open')==='1')return true;
    if(!ribbon)return false;
    ribbonPreparing=false;
    if(ribbon.getAttribute('data-novaflow-ribbon-docked')!=='1'){ribbon.setAttribute('data-novaflow-ribbon-docked','1');keepEventsOpen(ribbon);changed=true;}
    if(ribbon.getAttribute('data-open')!=='1'){syncRibbonOpen(ribbon);if(ribbon.getAttribute('data-open')!=='1')return false;}
    // in place, and mounted: the box shows it only once its rows are there (it mounts on open)
    // the event section opens as soon as it exists (docking happened off screen before it was
    // mounted), and before the first-frame refresh so that pass marks the head React renders
    // for it (添加事件 showed grey in the first 飘带 frame)
    keepEventsOpen(ribbon);
    window.NovaFlowRibbonPresets?.prepare?.(ribbon);
    if(!ribbonMounted(ribbon))return false;
    // docking (or a new box) is laid out in this task, then measured
    if(changed)window.NovaFlowRibbonPresets?.settle?.();
    const r=ribbon.getBoundingClientRect();
    const placed=Math.abs(r.left-Math.round(rect.left))<=1&&Math.abs(r.top-Math.round(rect.top))<=1&&Math.abs(r.width-Math.round(rect.width))<=1;
    dockPlaced=placed?signature:'';
    return placed;
  }
  // 序列K帧 / 序列扫光 have no curve editor: the 骨骼动画 editor shows its layer cards over the
  // stage (tick the frames, 写入动画); picking them closes the curve editor, picking a calculation
  // tool closes the cards (setPanel('motion'))
  const isFrameTool=mode=>mode==='sequence'||mode==='sweep'||mode==='loop';
  let frameToolAt=0;
  function selectTool(mode){
    activeMode=mode;
    panel.querySelectorAll('[data-motion-mode]').forEach(item=>item.setAttribute('aria-pressed',String(item.dataset.motionMode===mode)));
    const editor=window.NovaFlowSkeletonEditor;
    // 粒子特效（2026-10-16 用户）：飘带等计算面板、帧工具卡片都关掉，右侧开粒子面板；切到别的工具，粒子面板自动关
    if(mode==='particle'){
      close();panel.dataset.editorOpen='0';panel.querySelector('.nf-motion-body').replaceChildren();
      frameToolAt=performance.now();editor?.setPanel?.('frames',false);editor?.openParticle?.();
      return;
    }
    editor?.closeParticle?.();
    if(isFrameTool(mode)){
      close();panel.dataset.editorOpen='0';panel.querySelector('.nf-motion-body').replaceChildren();
      frameToolAt=performance.now();editor?.setPanel?.(mode,true);
      return;
    }
    editor?.setPanel?.('frames',false);
    panel.dataset.editorOpen='1';
    if(view&&(mode==='ribbon'||sameScope(getContext(),session)))view.selectMode(activeMode);else open();
  }
  let ribbonMissingSince=0;
  function refresh(){
    const ribbon=document.querySelector(ribbonSelector);
    // Keep the entry discoverable before importing a skeleton. open() explains
    // the required selection until the real editor context becomes available.
    // React may take the 飘带 panel out and put it back while it re-renders (a bone pick):
    // the editor is torn down only once the section is really gone
    if(!ribbon){
      if(panel){if(!ribbonMissingSince)ribbonMissingSince=performance.now();if(performance.now()-ribbonMissingSince<600)return;close();panel.remove();panel=null;}
      return;
    }
    ribbonMissingSince=0;
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
        [data-panel-id="bone-motion"] [data-motion-mode]:not([disabled]):hover,[data-panel-id="bone-motion"] [data-motion-mode][aria-pressed="true"]{background:#262626;color:#dedede}
        [data-panel-id="bone-motion"] [data-motion-mode][disabled]{color:#5a5a5a;cursor:default}
        [data-panel-id="bone-motion"] .nf-motion-note{margin:4px 10px 0;font-size:11px;line-height:1.6;color:#6a6a6a}
        [data-panel-id="bone-motion"] .nf-motion-body{font-size:11px;color:#999}
      </style><button type="button" class="nf-panel-header" aria-expanded="false"><span style="display:flex;align-items:center"><i class="fas fa-calculator" style="width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;margin-right:8px;background:#292929;border-radius:7px;font-size:14px;color:#bdbdbd" aria-hidden="true"></i>动画工具</span><i class="fas fa-chevron-right nf-motion-chevron" aria-hidden="true"></i></button><div class="nf-motion-tools" role="group" aria-label="动画工具" hidden>${Object.entries({ribbon:'飘带计算',bounce:'弹跳计算',expand:'缩放计算',shuttle:'移动计算',rotate:'旋转计算',sequence:'序列K帧',sweep:'特效扫光',loop:'循环运动',particle:'粒子特效'}).map(([mode,label])=>`<button type="button" data-motion-mode="${mode}" aria-pressed="false">${label}</button>`).join('')}<p class="nf-motion-note">选中骨骼后可用飘带、弹跳、缩放、移动、旋转计算；序列K帧、特效扫光、循环运动在画面下方的卡片里选图片。</p></div><div class="nf-motion-body"></div>`;
      const lastTool=ribbon.parentElement.querySelector('[data-panel-id="bone-auto-weights"]');
      (lastTool||ribbon.parentElement.lastElementChild).after(panel);
      panel.querySelector('.nf-panel-header').onclick=()=>{
        const expanded=panel.dataset.open!=='1';
        // one panel at a time: 动画编辑 closes 骨骼架设 / 自动蒙皮 / 自动权重 (user 2026-10-10)
        // the 骨骼动画 editor's project / selection go into the app first; React applies them a
        // moment later, so the tool opens after that instead of reading the old state
        let editorSynced=false;
        if(expanded){try{window.NovaFlowAutoMeshPanel?.closePanels?.();}catch{}try{editorSynced=!!window.NovaFlowSkeletonEditor?.beforeMotion?.();}catch{}}
        panel.dataset.open=expanded?'1':'0';
        panel.querySelector('.nf-motion-tools').hidden=!expanded;panel.querySelector('.nf-panel-header').setAttribute('aria-expanded',String(expanded));panel.querySelector('.nf-motion-chevron').className=`fas fa-chevron-${expanded?'down':'right'} nf-motion-chevron`;
        if(expanded){try{const api=editorApi();if(api&&!api.selectedBone()&&api.rootBone&&api.rootBone())api.selectBone(api.rootBone());}catch{}}
        // 展开时工具一个都不选（2026-10-16 用户：动画工具展开的时候默认什么工具都不选）——不自动打开上次的工具，点哪个开哪个；骨骼照旧默认 root
        if(!expanded){close();panel.dataset.editorOpen='0';panel.querySelector('.nf-motion-body').replaceChildren();panel.querySelectorAll('[data-motion-mode]').forEach(item=>item.setAttribute('aria-pressed','false'));try{window.NovaFlowSkeletonEditor?.closeParticle?.();}catch{}}
      };
      panel.querySelectorAll('[data-motion-mode]').forEach(button=>button.onclick=()=>selectTool(button.dataset.motionMode));
    }
    syncToolAvailability(panel);
    if(panel.dataset.open==='1'&&activeMode==='particle'){
      const api=editorApi();
      if(api&&api.particleOpen&&!api.particleOpen()&&performance.now()-frameToolAt>1000)panel.querySelectorAll('[data-motion-mode]').forEach(item=>item.setAttribute('aria-pressed','false'));
    }
    if(panel.dataset.open==='1'&&isFrameTool(activeMode)){
      const api=editorApi();
      // the cards closed with their × (not the moment after the click: setPanel lands a tick later)
      if(api&&api.panel&&api.panel()!==activeMode&&performance.now()-frameToolAt>1000)panel.querySelectorAll('[data-motion-mode]').forEach(item=>item.setAttribute('aria-pressed','false'));
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
  // the other panels close 动画编辑 when they open
  window.NovaFlowMotionEditing={collapse(){if(panel&&panel.dataset.open==='1')panel.querySelector('.nf-panel-header')?.onclick?.();}};
  setInterval(refresh,350);refresh();
})();
