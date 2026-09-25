(function (root) {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const n = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  function curve(t, f) {
    if (f?.curve === 'stepped') return 0;
    const c = Array.isArray(f?.curve) ? f.curve : typeof f?.curve === 'number' ? [f.curve, f.c2 ?? 0, f.c3 ?? 1, f.c4 ?? 1] : null;
    if (!c || !c.slice(0, 4).every(Number.isFinite)) return t;
    const bez = (v, a, b) => 3 * (1-v)**2 * v * a + 3 * (1-v) * v*v * b + v*v*v;
    let lo = 0, hi = 1;
    for (let i = 0; i < 28; i++) { const m = (lo+hi)/2; if (bez(m,c[0],c[2]) < t) lo=m; else hi=m; }
    return bez((lo+hi)/2,c[1],c[3]);
  }
  function scalar(frames, t, key, fallback) {
    if (!frames?.length || t < n(frames[0].time)) return fallback;
    let i = 0; while (i+1 < frames.length && n(frames[i+1].time) <= t) i++;
    const a=frames[i], b=frames[i+1], av=n(a[key] ?? a.value, fallback);
    if (!b) return av;
    const u=curve((t-n(a.time))/Math.max(1e-9,n(b.time)-n(a.time)),a);
    return av+(n(b[key] ?? b.value,fallback)-av)*u;
  }
  function color(frames, t, fallback='ffffffff') {
    const base = /^[\da-f]{8}$/i.test(fallback) ? fallback : 'ffffffff';
    const channels = [0,2,4,6].map(i=>scalar((frames||[]).map(f=>({...f,v:parseInt((f.color||base).slice(i,i+2),16)})),t,'v',parseInt(base.slice(i,i+2),16)));
    return channels;
  }
  function duration(animation) {
    let max=n(animation?.duration);
    const visit=x=>{if(!x||typeof x!=='object')return;if(Array.isArray(x)){for(const v of x){max=Math.max(max,n(v?.time));visit(v);}}else for(const [k,v]of Object.entries(x))if(k!=='duration')visit(v);};
    visit(animation);return max;
  }
  function selection(project, names) {
    const bones=new Map(project.bones.map(b=>[b.name,b])), set=new Set(names.filter(name=>bones.has(name)));
    return [...set].filter(name=>{let p=bones.get(name)?.parent, seen=new Set();while(p&&!seen.has(p)){if(set.has(p))return false;seen.add(p);p=bones.get(p)?.parent;}return true;});
  }
  function descendants(project, names) {
    const out=new Set(names);let change=true;
    while(change){change=false;for(const b of project.bones)if(out.has(b.parent)&&!out.has(b.name)){out.add(b.name);change=true;}}
    return out;
  }
  function pose(project, animation, time, math) {
    const bones=project.bones.map(b=>{const t=animation.bones?.[b.name]||{};return {...b,
      x:n(b.x)+scalar(t.translate,time,'x',0),y:n(b.y)+scalar(t.translate,time,'y',0),
      rotation:n(b.rotation)+scalar(t.rotate,time,'angle',0),scaleX:n(b.scaleX,1)*scalar(t.scale,time,'x',1),scaleY:n(b.scaleY,1)*scalar(t.scale,time,'y',1),
      shearX:n(b.shearX)+scalar(t.shear,time,'x',0),shearY:n(b.shearY)+scalar(t.shear,time,'y',0),transform:b.transform||b.transformMode||b.inherit};});
    return {bones,world:math.worldTransforms({bones})};
  }
  const invVector=(m,x,y)=>{if(!m)return [x,y];const det=m.a*m.d-m.b*m.c;if(Math.abs(det)<1e-9)throw Error('父骨骼缩放为零，无法计算位移。');return [(m.d*x-m.b*y)/det,(-m.c*x+m.a*y)/det];};
  function bounds(project, name, math) {
    const setup=pose(project,{},0,math), index=new Map(project.bones.map((b,i)=>[b.name,i])), target=setup.world[index.get(name)], children=descendants(project,[name]);
    const points=[];const add=(bone,x,y)=>{const w=setup.world[index.get(bone)];if(!w)return;points.push(invVector(target,w.worldX+w.a*x+w.b*y-target.worldX,w.worldY+w.c*x+w.d*y-target.worldY));};
    const skins=Array.isArray(project.skins)?project.skins.map(s=>s.attachments||{}):Object.values(project.skins||{});
    for(const slot of project.slots||[])for(const skin of skins)for(const a of Object.values(skin?.[slot.name]||{})){
      if(a.type==='boundingbox'||a.type==='clipping'||a.type==='path')continue;
      if(a.vertices&&a.uvs&&a.vertices.length!==a.uvs.length){
        // Weighted meshes can be driven by this bone even when their slot is
        // attached to an ancestor. Resolve the weighted setup vertices first.
        for(let i=0;i<a.vertices.length;){const count=a.vertices[i++];let wx=0,wy=0,affected=false;
          for(let j=0;j<count;j++){const bi=a.vertices[i++],x=a.vertices[i++],y=a.vertices[i++],weight=a.vertices[i++],w=setup.world[bi];if(!w)continue;wx+=(w.worldX+w.a*x+w.b*y)*weight;wy+=(w.worldY+w.c*x+w.d*y)*weight;affected ||= children.has(project.bones[bi]?.name);}
          if(affected)points.push(invVector(target,wx-target.worldX,wy-target.worldY));
        }
      }
      else if(!children.has(slot.bone))continue;
      else if(a.vertices&&a.uvs&&a.vertices.length===a.uvs.length){for(let i=0;i<a.vertices.length;i+=2)add(slot.bone,a.vertices[i],a.vertices[i+1]);}
      else if(a.width&&a.height){const r=n(a.rotation)*Math.PI/180,c=Math.cos(r),s=Math.sin(r);for(const x of [-a.width/2,a.width/2])for(const y of [-a.height/2,a.height/2]){const px=x*n(a.scaleX,1),py=y*n(a.scaleY,1);add(slot.bone,n(a.x)+c*px-s*py,n(a.y)+s*px+c*py);}}
    }
    if(!points.length){const length=n(project.bones[index.get(name)].length,60);points.push([0,-10],[Math.max(length,1),10]);}
    return {minX:Math.min(...points.map(p=>p[0])),maxX:Math.max(...points.map(p=>p[0])),minY:Math.min(...points.map(p=>p[1])),maxY:Math.max(...points.map(p=>p[1]))};
  }
  function merge(frames, generated, start, end, sampleBoundary) {
    const eps=1/6000, before=(frames||[]).filter(f=>n(f.time)<start), after=(frames||[]).filter(f=>n(f.time)>end);
    const split=time=>{
      const index=(frames||[]).findIndex((f,i)=>n(f.time)<=time&&frames[i+1]&&n(frames[i+1].time)>time);
      if(index<0)return null;
      const f=frames[index];if(f.curve==='stepped')return {index,left:'stepped',right:'stepped'};
      if(!Array.isArray(f.curve)||f.curve.length!==4)return null;
      const [x1,y1,x2,y2]=f.curve,u=(time-n(f.time))/(n(frames[index+1].time)-n(f.time));
      const bez=t=>3*(1-t)**2*t*x1+3*(1-t)*t*t*x2+t*t*t;
      let lo=0,hi=1;for(let i=0;i<30;i++){const t=(lo+hi)/2;if(bez(t)<u)lo=t;else hi=t;}
      const t=(lo+hi)/2,mix=(a,b)=>a+(b-a)*t;
      const a=[t*x1,t*y1],b=[mix(x1,x2),mix(y1,y2)],c=[mix(x2,1),mix(y2,1)],d=[mix(a[0],b[0]),mix(a[1],b[1])],e=[mix(b[0],c[0]),mix(b[1],c[1])],v=[mix(d[0],e[0]),mix(d[1],e[1])];
      if(Math.abs(v[1])<1e-9||Math.abs(1-v[1])<1e-9)return null;
      return {index,left:[a[0]/v[0],a[1]/v[1],d[0]/v[0],d[1]/v[1]],right:[(e[0]-v[0])/(1-v[0]),(e[1]-v[1])/(1-v[1]),(c[0]-v[0])/(1-v[0]),(c[1]-v[1])/(1-v[1])]};
    };
    if(start>eps){const cut=split(start-eps);if(cut&&before[cut.index])before[cut.index]={...before[cut.index],curve:cut.left};before.push({...sampleBoundary(start-eps),time:start-eps});}
    if(after.length){const cut=split(end+eps);after.unshift({...sampleBoundary(end+eps),time:end+eps,...(cut?{curve:cut.right}:{})});}
    return [...before,...generated,...after].sort((a,b)=>n(a.time)-n(b.time));
  }
  function calculate(project, animationName, names, stack, timing, engine, math) {
    const original=project.animations?.[animationName];if(!original)throw Error('请先选择当前动画。');
    const targets=selection(project,names);if(!targets.length)throw Error('请先在骨骼树或画板中选择骨骼。');
    const driven=new Set([...(project.ik||[]).flatMap(c=>c.bones||[]),...(project.transform||[]).flatMap(c=>c.bones||[]),...(project.path||[]).flatMap(c=>c.bones||[])]);
    if(targets.some(x=>driven.has(x)))throw Error('所选骨骼由约束驱动，请选择它的控制骨骼后计算。');
    const start=Math.max(0,n(timing.animationDelay)), span=Math.max(.05,n(timing.boneDuration,2.8)), end=start+span;
    if(end>n(timing.animationDuration)+1e-6)throw Error('动画延迟加骨骼总时长不能超过动画总时长。');
    const params=clone(stack);for(const p of Object.values(params))p.duration=span;
    const keyDuration=duration({...original,duration:0});
    if(n(timing.animationDuration)+1e-6<keyDuration)throw Error('动画总时长不能短于已有关键帧；其他骨骼不会被裁切。');
    const animation={...original,bones:{...original.bones},slots:{...original.slots},duration:n(timing.animationDuration)};
    const translate=!!(params.bounce.enabled||params.shuttle.enabled),scale=!!params.expand.enabled;
    const opacity=params.opacity.opacity,alpha=opacity.on&&(opacity.from!==1||opacity.to!==1||params.opacity.corrections.alpha.some(v=>v!==0)||params.opacity.curves?.alpha);
    const affected=new Set(targets), slots=(project.slots||[]).filter(s=>affected.has(s.bone));
    const fps=Math.max(15,Math.min(120,n(project.skeleton?.fps,60))), times=new Set([start,end]);
    for(let i=1;i<span*fps;i++)times.add(start+i/fps);
    // Preserve the exact seam when a non-periodic channel is shifted around its cycle.
    for(const p of Object.values(params))if(p.delay>0&&p.delay<span){times.add(start+p.delay);times.add(start+p.delay-1/6000);}
    for(const event of engine.events(params.bounce))if(params.bounce.enabled)times.add(start+engine.timelineTime(params.bounce,event.u));
    const entries=targets.map(name=>({name,i:project.bones.findIndex(b=>b.name===name),translate:[],scale:[]}));
    const slotFrames=new Map(slots.map(s=>[s.name,[]]));
    for(const time of [...times].sort((a,b)=>a-b)){
      const t=time-start, value=engine.sampleStack(params,t/span), evaluated=pose(project,original,time,math);
      for(const item of entries){const b=evaluated.bones[item.i],w=evaluated.world[item.i],parent=w.parent>=0?evaluated.world[w.parent]:null,old=original.bones?.[item.name]||{};
        let dx=translate?value.x:0,dy=translate?value.y:0;
        const [lx,ly]=invVector(parent,dx,dy);
        if(translate)item.translate.push({time,x:scalar(old.translate,time,'x',0)+lx,y:scalar(old.translate,time,'y',0)+ly});
        if(scale)item.scale.push({time,x:scalar(old.scale,time,'x',1)*value.sx,y:scalar(old.scale,time,'y',1)*value.sy});
      }
      if(alpha)for(const slot of slots){const old=original.slots?.[slot.name]||{},rgba=color(old.rgba||old.color,time,slot.color);rgba[3]*=value.alpha;slotFrames.get(slot.name).push({time,color:rgba.map(v=>Math.round(Math.max(0,Math.min(255,v))).toString(16).padStart(2,'0')).join('')});}
    }
    for(const item of entries){const old=original.bones?.[item.name]||{},next={...old};for(const channel of ['translate','scale'])if(item[channel].length)next[channel]=merge(old[channel],item[channel],start,end,t=>({x:scalar(old[channel],t,'x',channel==='scale'?1:0),y:scalar(old[channel],t,'y',channel==='scale'?1:0)}));animation.bones[item.name]=next;}
    if(alpha)for(const slot of slots){const old=original.slots?.[slot.name]||{},key=old.rgba?'rgba':'color';animation.slots[slot.name]={...old,[key]:merge(old[key],slotFrames.get(slot.name),start,end,t=>({color:color(old[key],t,slot.color).map(v=>Math.round(v).toString(16).padStart(2,'0')).join('')}))};}
    // Spine derives duration from keys, not the editor's duration metadata.
    // Extend only a selected-bone channel so exported playback has the same length.
    if(duration({...animation,duration:0})<animation.duration){
      const target=animation.bones[targets[0]],key=target.scale?.length?'scale':'translate',base=key==='scale'?1:0;
      const frames=target[key]||[],time=animation.duration;
      target[key]=[...frames,{time,x:scalar(frames,time,'x',base),y:scalar(frames,time,'y',base)}];
    }
    return {animation,targets,slots:alpha?slots.map(s=>s.name):[],start,end};
  }
  const api={calculate,selection,descendants,duration,scalar,color,bounds,pose};root.NovaFlowMotionAnimation=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window==='undefined'?globalThis:window);
