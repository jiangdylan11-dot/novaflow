/* Formal bone editor bridge. The existing React project remains the single source of truth. */
(() => {
  'use strict';
  const A=window.NovaFlowMotionAnimation,E=window.NovaFlowMotionEngine;
  const records=new WeakMap();
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
  function signature(animation,s){return JSON.stringify({bone:animation?.bones?.[s.bone],slots:s.slots.map(n=>animation?.slots?.[n])});}
  function write(s,animation){
    const p=getContext();if(!p||p.project.bones!==s.identity)throw Error('骨骼项目已切换，请重新选择骨骼。');
    const existing=p.project.animations[s.animation];
    if(signature(existing,s)!==signature(s.expected,s))throw Error('本骨骼已被其他工具修改，请重新打开动画计算。');
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
    if(existing&&signature(current,existing)===signature(existing.expected,existing)){
      existing.expected=current;existing.dirty=false;return existing;
    }
    const s={identity,animation,bone,slots:slotNames(p.project,bone),base:current,committed:current,expected:current,channels:new Set(),alpha:false,dirty:false,config:null,group,key};
    group.set(key,s);return s;
  }
  function close(){
    if(session?.dirty){try{write(session,session.committed);}catch(error){view?.status(error.message);}}
    if(session)session.dirty=false;
    view?.destroy();view=null;session=null;
  }
  function open(){
    close();context=getContext();
    const body=panel.querySelector(`[data-motion-mode="${activeMode}"] .nf-motion-body`);body.replaceChildren();
    if(!context?.project.animations[context.activeAnimationName]||!context.selectedBoneName){body.textContent='请先选择动画和一个骨骼。';return;}
    session=createSession(context);const s=session;
    const host=document.createElement('div');body.append(host);const shadow=host.attachShadow({mode:'open'});
    const timing=()=>{const d=Math.max(.05,A.duration(s.base)||2);return {animationDuration:d,boneDuration:Math.min(d,2.8),animationDelay:0};};
    const preview=(stack,t)=>{
      const p=getContext();if(!sameScope(p,s))throw Error('已切换骨骼，请在新骨骼面板中调整。');
      if(signature(p.project.animations[s.animation],s)!==signature(s.expected,s))throw Error('本骨骼已被其他工具修改，请重新打开动画计算。');
      if(stack.bounce.enabled||stack.shuttle.enabled||stack.expand.enabled)s.channels.add('translate');
      if(stack.expand.enabled)s.channels.add('scale');
      if(stack.opacity.opacity.from!==1||stack.opacity.opacity.to!==1||stack.opacity.corrections.alpha.some(v=>v))s.alpha=true;
      const baseline=patch(p.project.animations[s.animation],s.base,s);
      const project={...p.project,animations:{...p.project.animations,[s.animation]:baseline}};
      const result=A.calculate(project,s.animation,[s.bone],stack,t,E,window.NovaFlowBonesEditor);
      for(const key of ['translate','scale'])if(result.animation.bones[s.bone]?.[key]!==baseline.bones?.[s.bone]?.[key])s.channels.add(key);
      write(s,result.animation);s.dirty=true;s.pending=copy({stack,timing:t});
      panel.dataset.motionState='preview';panel.dataset.motionInterval=`${result.start},${result.end}`;
    };
    view=window.NovaFlowMotionPanel.mount(shadow,{
      mode:activeMode,
      timing,initial:()=>s.config&&copy(s.config),label:()=>`当前骨骼：${s.bone} · 动画：${s.animation}`,
      time:()=>Number(window.__NovaFlowSkeletonTimelineOfficialProxy?.timeSec ?? context?.currentTimeSec)||0,
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
    const ribbon=document.querySelector('[data-panel-id="bone-ribbon"], [data-novaflow-ribbon-panel="1"]');
    context=getContext();
    if(!ribbon||!context){if(panel){close();panel.remove();panel=null;}return;}
    if(!panel?.isConnected){
      close();panel=document.createElement('div');panel.dataset.panelId='bone-motion';panel.dataset.open='0';
      panel.style.cssText='width:100%;font-size:12px';
      panel.innerHTML=Object.entries({bounce:'弹跳计算',expand:'扩张计算',shuttle:'往返计算',opacity:'透明度计算'}).map(([mode,label])=>`<section class="nf-panel" data-motion-mode="${mode}" style="width:100%;border-bottom:1px solid #272727;padding:3px 0"><button type="button" class="nf-panel-header" aria-expanded="false" style="width:100%;height:46px;padding:0 7px;display:flex;align-items:center;justify-content:space-between;text-align:left;background:transparent;color:#d4d4d4;border:0;font:inherit;cursor:pointer"><span style="display:flex;align-items:center"><i class="fas fa-calculator" style="width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;margin-right:8px;background:#292929;border-radius:5px" aria-hidden="true"></i>${label}</span><span aria-hidden="true">›</span></button><div class="nf-motion-body" hidden style="padding:10px"></div></section>`).join('');
      ribbon.after(panel);
      panel.querySelectorAll('[data-motion-mode]').forEach(section=>section.querySelector('button').onclick=()=>{
        const next=section.dataset.motionMode,wasOpen=panel.dataset.open==='1',collapse=wasOpen&&next===activeMode;
        const previous=panel.querySelector(`[data-motion-mode="${activeMode}"] .nf-motion-body`);
        activeMode=next;panel.dataset.open=collapse?'0':'1';
        panel.querySelectorAll('[data-motion-mode]').forEach(item=>{const show=!collapse&&item===section;item.querySelector('.nf-motion-body').hidden=!show;item.querySelector('button').setAttribute('aria-expanded',String(show));item.querySelector('button>span:last-child').textContent=show?'⌄':'›';});
        if(collapse){close();previous.replaceChildren();}
        else if(wasOpen&&view){section.querySelector('.nf-motion-body').append(...previous.childNodes);view.selectMode(next);}
        else open();
      });
    }
    if(panel.dataset.open==='1'&&(!session||!sameScope(context,session)))open();
  }
  setInterval(refresh,350);refresh();
})();
