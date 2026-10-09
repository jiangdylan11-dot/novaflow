/* Formal bone editor bridge. The existing React project remains the single source of truth. */
(() => {
  'use strict';
  const A=window.NovaFlowMotionAnimation,E=window.NovaFlowMotionEngine;
  const records=new WeakMap();
  const ribbonSelector='[data-panel-id="bone-ribbon"], [data-novaflow-ribbon-panel="1"]';
  let panel=null,view=null,session=null,context=null,activeMode='bounce';
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
    if(!matchesExpected(existing,s))throw Error('本骨骼已被其他工具修改，请重新打开动画计算。');
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
      if(!matchesExpected(p.project.animations[s.animation],s))throw Error('本骨骼已被其他工具修改，请重新打开动画计算。');
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
  function refresh(){
    const ribbon=document.querySelector(ribbonSelector);
    // Keep the entry discoverable before importing a skeleton. open() explains
    // the required selection until the real editor context becomes available.
    if(!ribbon){if(panel){close();panel.remove();panel=null;}return;}
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
      </style><button type="button" class="nf-panel-header" aria-expanded="false"><span style="display:flex;align-items:center"><i class="fas fa-calculator" style="width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;margin-right:8px;background:#292929;border-radius:7px;font-size:14px;color:#bdbdbd" aria-hidden="true"></i>动画计算</span><i class="fas fa-chevron-right nf-motion-chevron" aria-hidden="true"></i></button><div class="nf-motion-tools" role="group" aria-label="动画计算工具" hidden>${Object.entries({bounce:'弹跳计算',expand:'缩放计算',shuttle:'移动计算',rotate:'旋转计算',opacity:'透明度计算'}).map(([mode,label])=>`<button type="button" data-motion-mode="${mode}" aria-pressed="false">${label}</button>`).join('')}</div><div class="nf-motion-body"></div>`;
      const lastTool=ribbon.parentElement.querySelector('[data-panel-id="bone-auto-weights"]');
      (lastTool||ribbon.parentElement.lastElementChild).after(panel);
      panel.querySelector('.nf-panel-header').onclick=()=>{
        const expanded=panel.dataset.open!=='1';panel.dataset.open=expanded?'1':'0';
        panel.querySelector('.nf-motion-tools').hidden=!expanded;panel.querySelector('.nf-panel-header').setAttribute('aria-expanded',String(expanded));panel.querySelector('.nf-motion-chevron').className=`fas fa-chevron-${expanded?'down':'right'} nf-motion-chevron`;
        if(!expanded){close();panel.dataset.editorOpen='0';panel.querySelector('.nf-motion-body').replaceChildren();panel.querySelectorAll('[data-motion-mode]').forEach(item=>item.setAttribute('aria-pressed','false'));}
      };
      panel.querySelectorAll('[data-motion-mode]').forEach(button=>button.onclick=()=>{
        activeMode=button.dataset.motionMode;panel.dataset.editorOpen='1';
        panel.querySelectorAll('[data-motion-mode]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
        if(view&&sameScope(getContext(),session))view.selectMode(activeMode);else open();
      });
    }
    // The fiber walk is the costly part of this poll; only an open editor needs it.
    if(panel.dataset.open!=='1'||panel.dataset.editorOpen!=='1'||document.hidden)return;
    context=getContext();
    if(context&&(!session||!sameScope(context,session)))open();
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
