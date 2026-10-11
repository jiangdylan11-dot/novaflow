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
  // ---- keys on integer frames (30 fps, the app's frame rate) and the fewest of them: a tool's
  // motion is sampled on every frame, then every extreme of every channel is a key and the
  // runs between them become one Spine Bezier ease (or a line) while that replays the samples
  // within the tolerance - an animator's keys, not a key per frame
  const FPS=30, frameTime=f=>Number((f/FPS).toFixed(4));
  // a key's curve as [cx1,cy1,cx2,cy2] (Spine 3.8 curve/c2/c3/c4, or the 3.7 array), else null
  const curveOf=f=>Array.isArray(f?.curve)&&f.curve.length===4?f.curve.map(Number):typeof f?.curve==='number'?[f.curve,n(f.c2,0),n(f.c3,1),n(f.c4,1)]:null;
  // the key with that curve written the 3.8 way (null = linear, 'stepped' kept)
  function withCurve(f,c){const {curve,c2,c3,c4,...rest}=f;if(c==='stepped')return {...rest,curve:'stepped'};return c?{...rest,curve:c[0],c2:c[1],c3:c[2],c4:c[3]}:rest;}
  // the Bezier parameter at time fraction u for time handles x1 / x2
  function bezierT(x1,x2,u){let lo=0,hi=1,t=u;for(let i=0;i<24;i++){t=(lo+hi)/2;const x=3*(1-t)*(1-t)*t*x1+3*(1-t)*t*t*x2+t*t*t;if(x<u)lo=t;else hi=t;}return t;}
  function bezierAt(c,u){const t=bezierT(c[0],c[2],u);return 3*(1-t)*(1-t)*t*c[1]+3*(1-t)*t*t*c[3]+t*t*t;}
  // the tolerance for a channel set: a floor, or a share of how far the motion travels
  function toleranceFor(samples,keys,floor,share){
    let spread=0;for(const k of keys){const v=samples.map(f=>n(f[k]));spread=Math.max(spread,Math.max(...v)-Math.min(...v));}
    return Math.max(floor,spread*(typeof share==='number'?share:.03));
  }
  // opts.step: a key may sit on every step-th sample only (samples finer than the frames, as
  // the ribbon's 60 fps solve: the keys stay on frames while the ease follows every sample)
  function sparse(samples,keys,tol,opts){
    const s=samples;if(s.length<=2)return s.map(f=>withCurve(f,null));
    const step=Math.max(1,Math.round((opts&&opts.step)||1)),cand=m=>m%step===0||m===s.length-1;
    const val=(f,k)=>n(f[k]),time=f=>n(f.time);
    // does a curve (null = a line) from sample i to j replay the samples between within tol
    const fits=(i,j,curve)=>{
      const span=time(s[j])-time(s[i]);
      for(let m=i+1;m<j;m++){
        const u=(time(s[m])-time(s[i]))/span,w=curve?bezierAt(curve,u):u;
        for(const k of keys){const a=val(s[i],k),b=val(s[j],k);if(Math.abs(a+(b-a)*w-val(s[m],k))>tol)return false;}
      }
      return true;
    };
    // the ease between two keys: the sampled slope at each end is its tangent (zero at an
    // extreme), so neighbouring eases meet without a corner - the curve is smooth through
    // every key, not just close to the samples; the handle lengths come from a few fixed
    // pairs and the pair that replays every channel best wins
    // a loop (first and last samples equal): the tangent at either end is taken across the
    // seam, so the wrap plays without a hitch
    const n1=s.length-1,loop=n1>2&&keys.every(k=>Math.abs(val(s[0],k)-val(s[n1],k))<=tol*.5);
    // (an extreme keeps its sampled slope too: a peak that falls between two frames is then
    // reached by the ease's overshoot at its true time, instead of being pinned to the frame)
    const slopeAt=(m,k)=>{
      if(loop&&(m===0||m===n1))return (val(s[1],k)-val(s[n1-1],k))/((time(s[1])-time(s[0]))+(time(s[n1])-time(s[n1-1])));
      const a=Math.max(0,m-1),b=Math.min(n1,m+1);
      return (val(s[b],k)-val(s[a],k))/(time(s[b])-time(s[a]));
    };
    const ease=(i,j)=>{
      const span=time(s[j])-time(s[i]),deltas=keys.map(k=>val(s[j],k)-val(s[i],k));
      if(!deltas.some(d=>Math.abs(d)>tol))return null;
      let k=0;for(let q=1;q<keys.length;q++)if(Math.abs(deltas[q])>Math.abs(deltas[k]))k=q;
      const d=deltas[k],t0=slopeAt(i,keys[k])*span/d,t1=slopeAt(j,keys[k])*span/d;
      if(!Number.isFinite(t0)||!Number.isFinite(t1))return null;
      let best=null,bestErr=Infinity;
      for(const a of [.2,.3,.4,.5])for(const b of [.2,.3,.4,.5]){
        const c=[a,a*t0,1-b,1-b*t1].map(v=>Number(v.toFixed(3)));
        let err=0;
        for(let m=i+1;m<j&&err<=tol;m++){const w=bezierAt(c,(time(s[m])-time(s[i]))/span);keys.forEach((q,idx)=>{err=Math.max(err,Math.abs(val(s[i],q)+deltas[idx]*w-val(s[m],q)));});}
        if(err<bestErr){bestErr=err;best=c;}
      }
      return bestErr<=tol?best:null;
    };
    // every direction change of every channel is a key - unless the swing to it and away
    // from it stays within the tolerance (a wobble the ease absorbs)
    const must=new Set([0,s.length-1]),turn=tol*.05;
    for(const k of keys){
      // a run's last sample before the direction flips (a peak between two equal samples counts)
      const ext=[0];let dir=0;
      for(let m=0;m<s.length-1;m++){const step=val(s[m+1],k)-val(s[m],k);if(Math.abs(step)<=turn)continue;const sign=step>0?1:-1;if(dir&&sign!==dir)ext.push(m);dir=sign;}
      ext.push(s.length-1);
      for(let e=1;e<ext.length-1;e++){const v=val(s[ext[e]],k);if(Math.abs(v-val(s[ext[e-1]],k))>tol&&Math.abs(v-val(s[ext[e+1]],k))>tol)must.add(Math.min(s.length-1,Math.round(ext[e]/step)*step));}
    }
    const out=[];let i=0;
    while(i<s.length-1){
      // the farthest sample (not past the next extreme) an ease reaches within tol; the ease
      // comes first because it keeps the slope continuous through the key (a short line next
      // to an ease is a corner), a line only where no ease fits
      let j=0,curve=null;
      for(let m=i+1;m<s.length;m++){
        const c=ease(i,m);
        if(c){if(cand(m)){j=m;curve=c;}}
        else if(fits(i,m,null)){if(cand(m)){j=m;curve=null;}}
        else break;
        if(must.has(m)&&cand(m))break;
      }
      if(!j){j=i+1;while(j<s.length-1&&!cand(j))j++;curve=ease(i,j);}
      // the leftover to the next extreme must start with an ease too (a two-frame line there is
      // a corner): back the key off until it can
      const canGo=(a)=>{for(let m=a+1;m<s.length;m++){if(ease(a,m)){if(cand(m))return true;}else return false;if(must.has(m)&&cand(m))break;}return false;};
      while(j>i+step&&!must.has(j)&&j<s.length-1&&!canGo(j)){j-=step;curve=ease(i,j);}
      out.push(withCurve(s[i],curve));
      i=j;
    }
    out.push(withCurve(s[s.length-1],null));
    return out;
  }
  function merge(frames, generated, start, end, sampleBoundary) {
    const before=(frames||[]).filter(f=>n(f.time)<start-1e-6), after=(frames||[]).filter(f=>n(f.time)>end+1e-6);
    const split=time=>{
      const index=(frames||[]).findIndex((f,i)=>n(f.time)<=time&&frames[i+1]&&n(frames[i+1].time)>time);
      if(index<0)return null;
      const f=frames[index];if(f.curve==='stepped')return {index,left:'stepped',right:'stepped'};
      const cv=curveOf(f);if(!cv)return null;
      const [x1,y1,x2,y2]=cv,u=(time-n(f.time))/(n(frames[index+1].time)-n(f.time));
      const bez=t=>3*(1-t)**2*t*x1+3*(1-t)*t*t*x2+t*t*t;
      let lo=0,hi=1;for(let i=0;i<30;i++){const t=(lo+hi)/2;if(bez(t)<u)lo=t;else hi=t;}
      const t=(lo+hi)/2,mix=(a,b)=>a+(b-a)*t;
      const a=[t*x1,t*y1],b=[mix(x1,x2),mix(y1,y2)],c=[mix(x2,1),mix(y2,1)],d=[mix(a[0],b[0]),mix(a[1],b[1])],e=[mix(b[0],c[0]),mix(b[1],c[1])],v=[mix(d[0],e[0]),mix(d[1],e[1])];
      if(Math.abs(v[1])<1e-9||Math.abs(1-v[1])<1e-9)return null;
      return {index,left:[a[0]/v[0],a[1]/v[1],d[0]/v[0],d[1]/v[1]],right:[(e[0]-v[0])/(1-v[0]),(e[1]-v[1])/(1-v[1]),(c[0]-v[0])/(1-v[0]),(c[1]-v[1])/(1-v[1])]};
    };
    // the untouched keys around the interval end / resume on the frame before / after it
    const has=(list,t)=>list.some(f=>Math.abs(n(f.time)-t)<1e-6);
    if(start>1/FPS-1e-6){const t=frameTime(Math.round(start*FPS)-1);if(!has(before,t)){const cut=split(t);if(cut&&before[cut.index])before[cut.index]=withCurve(before[cut.index],cut.left);before.push({...sampleBoundary(t),time:t});}}
    if(after.length){const t=frameTime(Math.round(end*FPS)+1);if(!has(after,t)&&t<n(after[0].time)){const cut=split(t);after.unshift(withCurve({...sampleBoundary(t),time:t},cut?cut.right:null));}}
    return [...before,...generated,...after].sort((a,b)=>n(a.time)-n(b.time));
  }
  // opts.slots: only these slots take the opacity keys (the picked slot), else every slot of the bones
  function calculate(project, animationName, names, stack, timing, engine, math, opts) {
    const original=project.animations?.[animationName];if(!original)throw Error('请先选择当前动画。');
    const targets=selection(project,names);if(!targets.length)throw Error('请先在骨骼树或画板中选择骨骼。');
    const driven=new Set([...(project.ik||[]).flatMap(c=>c.bones||[]),...(project.transform||[]).flatMap(c=>c.bones||[]),...(project.path||[]).flatMap(c=>c.bones||[])]);
    if(targets.some(x=>driven.has(x)))throw Error('所选骨骼由约束驱动，请选择它的控制骨骼后计算。');
    const startFrame=Math.round(Math.max(0,n(timing.animationDelay))*FPS), spanFrames=Math.max(1,Math.round(Math.max(.05,n(timing.boneDuration,2.8))*FPS));
    const start=frameTime(startFrame), span=frameTime(spanFrames), end=frameTime(startFrame+spanFrames);
    if(end>n(timing.animationDuration)+1e-6)throw Error('动画延迟加骨骼总时长不能超过动画总时长。');
    const params=clone(stack);for(const p of Object.values(params))p.duration=span;
    const keyDuration=duration({...original,duration:0});
    if(n(timing.animationDuration)+1e-6<keyDuration)throw Error('动画总时长不能短于已有关键帧；其他骨骼不会被裁切。');
    const animation={...original,bones:{...original.bones},slots:{...original.slots},duration:n(timing.animationDuration)};
    const translate=!!(params.bounce.enabled||params.shuttle.enabled),scale=!!params.expand.enabled,rotate=!!params.rotate?.enabled;
    const opacity=params.opacity.opacity,alpha=opacity.on&&(opacity.from!==1||opacity.to!==1||params.opacity.corrections.alpha.some(v=>v!==0)||params.opacity.curves?.alpha);
    const only=opts&&Array.isArray(opts.slots)?new Set(opts.slots):null;
    const affected=new Set(targets), slots=(project.slots||[]).filter(s=>affected.has(s.bone)&&(!only||only.has(s.name)));
    // one sample per frame of the interval (a seam or an impact lands on its nearest frame)
    const times=new Set();for(let f=startFrame;f<=startFrame+spanFrames;f++)times.add(frameTime(f));
    // only the targets and their ancestors are posed per sample: their parents' world frames
    // are all the keys need (posing all ~200 bones per sample made a slider drag stutter)
    const byName=new Map(project.bones.map(b=>[b.name,b])),chain=new Set(targets);
    for(const name of targets){let p=byName.get(name)?.parent;while(p&&!chain.has(p)&&byName.has(p)){chain.add(p);p=byName.get(p).parent;}}
    const posed={...project,bones:project.bones.filter(b=>chain.has(b.name))};
    const entries=targets.map(name=>({name,i:posed.bones.findIndex(b=>b.name===name),translate:[],scale:[],rotate:[]}));
    const slotFrames=new Map(slots.map(s=>[s.name,[]]));
    for(const time of [...times].sort((a,b)=>a-b)){
      const t=time-start, value=engine.sampleStack(params,t/span), evaluated=pose(posed,original,time,math);
      for(const item of entries){const b=evaluated.bones[item.i],w=evaluated.world[item.i],parent=w.parent>=0?evaluated.world[w.parent]:null,old=original.bones?.[item.name]||{};
        let dx=translate?value.x:0,dy=translate?value.y:0;
        const [lx,ly]=invVector(parent,dx,dy);
        if(translate)item.translate.push({time,x:scalar(old.translate,time,'x',0)+lx,y:scalar(old.translate,time,'y',0)+ly});
        if(scale)item.scale.push({time,x:scalar(old.scale,time,'x',1)*value.sx,y:scalar(old.scale,time,'y',1)*value.sy});
        // Local rotation adds to the existing key directly; no parent transform involved.
        if(rotate)item.rotate.push({time,angle:scalar(old.rotate,time,'angle',0)+value.r});
      }
      if(alpha)for(const slot of slots){const old=original.slots?.[slot.name]||{},rgba=color(old.rgba||old.color,time,slot.color);rgba[3]*=value.alpha;slotFrames.get(slot.name).push({time,a:rgba[3],color:rgba.map(v=>Math.round(Math.max(0,Math.min(255,v))).toString(16).padStart(2,'0')).join('')});}
    }
    // what a key may stray from the sampled motion: 3% of the travel, at least a pixel / half a
    // percent of scale / a quarter degree
    const floor={translate:1,scale:.005,rotate:.25},chans={translate:['x','y'],scale:['x','y'],rotate:['angle']};
    for(const item of entries){const old=original.bones?.[item.name]||{},next={...old};for(const channel of ['translate','scale','rotate'])if(item[channel].length)next[channel]=merge(old[channel],sparse(item[channel],chans[channel],toleranceFor(item[channel],chans[channel],floor[channel])),start,end,channel==='rotate'?t=>({angle:scalar(old.rotate,t,'angle',0)}):t=>({x:scalar(old[channel],t,'x',channel==='scale'?1:0),y:scalar(old[channel],t,'y',channel==='scale'?1:0)}));animation.bones[item.name]=next;}
    if(alpha)for(const slot of slots){const old=original.slots?.[slot.name]||{},key=old.rgba?'rgba':'color';animation.slots[slot.name]={...old,[key]:merge(old[key],sparse(slotFrames.get(slot.name),['a'],toleranceFor(slotFrames.get(slot.name),['a'],3)).map(({a,...f})=>f),start,end,t=>({color:color(old[key],t,slot.color).map(v=>Math.round(v).toString(16).padStart(2,'0')).join('')}))};}
    // Spine derives duration from keys, not the editor's duration metadata.
    // Extend only a selected-bone channel so exported playback has the same length.
    if(duration({...animation,duration:0})<animation.duration){
      const target=animation.bones[targets[0]],key=['scale','translate','rotate'].find(k=>target[k]?.length)||'translate',base=key==='scale'?1:0;
      const frames=target[key]||[],time=animation.duration;
      target[key]=[...frames,key==='rotate'?{time,angle:scalar(frames,time,'angle',0)}:{time,x:scalar(frames,time,'x',base),y:scalar(frames,time,'y',base)}];
    }
    return {animation,targets,slots:alpha?slots.map(s=>s.name):[],start,end};
  }
  const api={calculate,selection,descendants,duration,scalar,color,bounds,pose,sparse,toleranceFor,bezierAt,curveOf,FPS};root.NovaFlowMotionAnimation=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window==='undefined'?globalThis:window);
