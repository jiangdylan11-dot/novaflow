/* Export-copy optimization. No hierarchy, weights, constraints or editor data are rewritten. */
(function (root) {
  'use strict';
  const limits = Object.freeze({translate: 0.35, rotate: 0.035, scale: 0.0006, shear: 0.035, color: 0.75 / 255});
  const clone = value => JSON.parse(JSON.stringify(value));
  const bytes = value => JSON.stringify(value).length;
  const round = value => Number(value.toFixed(8));
  const lerp = (a,b,t) => a+(b-a)*t;
  // Both supported runtimes flatten cubic Beziers into ten linear intervals.
  // Fit and verify that actual representation, not an ideal cubic the player never uses.
  function basis(u) {
    const k=Math.min(9,Math.floor(u*10)),f=u*10-k;
    const at=t=>[3*(1-t)*(1-t)*t,3*(1-t)*t*t,t*t*t];
    const a=at(k/10),b=at((k+1)/10);
    return a.map((v,i)=>lerp(v,b[i],f));
  }
  function sample(rows,t) {
    let lo=0,hi=rows.length-1;
    if(t<=rows[0].t)return rows[0].v;
    if(t>=rows[hi].t)return rows[hi].v;
    while(hi-lo>1){const m=(lo+hi)>>1;if(rows[m].t<=t)lo=m;else hi=m;}
    const u=(t-rows[lo].t)/(rows[hi].t-rows[lo].t);
    return rows[lo].v.map((v,c)=>lerp(v,rows[hi].v[c],u));
  }
  function segment(rows,a,b,tolerance,legacy,cubic) {
    const left=rows[a],right=rows[b],span=right.t-left.t,channels=left.v.length;
    if(!(span>0))return null;
    let handles=null;
    if(cubic && b>a+1){
      const count=legacy?1:channels;
      handles=[];
      for(let h=0;h<count;h++){
        let aa=0,ab=0,bb=0,ay=0,by=0;
        for(let i=a+1;i<b;i++){
          const q=basis((rows[i].t-left.t)/span);
          for(let c=0;c<channels;c++){
            if(!legacy&&c!==h)continue;
            const delta=right.v[c]-left.v[c];
            const x=legacy?q[0]*delta:q[0],y=legacy?q[1]*delta:q[1];
            const z=legacy?rows[i].v[c]-left.v[c]-q[2]*delta:rows[i].v[c]-(1-q[0]-q[1]-q[2])*left.v[c]-q[2]*right.v[c];
            aa+=x*x;ab+=x*y;bb+=y*y;ay+=x*z;by+=y*z;
          }
        }
        // A three-key span has only one interior observation. Regularize toward
        // a straight tangent instead of rejecting it, so short pieces can merge.
        const ridge=Math.max(aa,bb,1)*1e-9;
        aa+=ridge;bb+=ridge;
        ay+=ridge*(legacy?1/3:lerp(left.v[h],right.v[h],1/3));
        by+=ridge*(legacy?2/3:lerp(left.v[h],right.v[h],2/3));
        const det=aa*bb-ab*ab;
        if(Math.abs(det)<1e-18)return null;
        handles.push([(ay*bb-by*ab)/det,(by*aa-ay*ab)/det].map(round));
      }
      if(legacy)handles=left.v.map((v,c)=>handles[0].map(h=>v+(right.v[c]-v)*h));
    } else if(cubic)return null;
    const evaluate=t=>{
      const u=(t-left.t)/span;
      if(!handles)return left.v.map((v,c)=>lerp(v,right.v[c],u));
      const q=basis(u);
      return left.v.map((v,c)=>(1-q[0]-q[1]-q[2])*v+q[0]*handles[c][0]+q[1]*handles[c][1]+q[2]*right.v[c]);
    };
    // Difference of two piecewise linear functions reaches its maximum at their knots.
    const checks=rows.slice(a,b+1).map(row=>row.t);
    if(handles)for(let i=1;i<10;i++)checks.push(left.t+span*i/10);
    let error=0,split=(a+b)>>1;
    for(const t of checks){
      const actual=evaluate(t),expected=sample(rows,t);
      for(let c=0;c<channels;c++){
        const diff=Math.abs(actual[c]-expected[c]);
        if(diff>error){error=diff;let n=a+1;while(n<b-1&&rows[n].t<t)n++;split=n;}
      }
    }
    // Leave room for Float32 runtime storage and JSON handle rounding.
    return {a,b,handles,error,split,ok:error<=tolerance*.92};
  }
  function fit(rows,tolerance,legacy,allowCubic=true) {
    const choose=(a,b)=>{
      const linear=segment(rows,a,b,tolerance,legacy,false);
      if(linear.ok)return linear;
      const cubic=allowCubic?segment(rows,a,b,tolerance,legacy,true):null;
      return cubic && (cubic.ok || cubic.error<linear.error)?cubic:linear;
    };
    if(allowCubic){
      const full=choose(0,rows.length-1);if(full.ok)return [full];
      // Runtime subdivisions can align with ten original frames even when a
      // two-frame merge fails. Search across those local minima, not just neighbours.
      const output=[];
      for(let a=0;a<rows.length-1;){
        let best=choose(a,a+1);
        for(let b=a+2;b<=Math.min(rows.length-1,a+30);b++){
          const candidate=choose(a,b);if(candidate.ok)best=candidate;
        }
        output.push(best);a=best.b;
      }
      return output;
    }
    const result=[],pending=[[0,rows.length-1]];
    while(pending.length){
      const [a,b]=pending.pop(),s=choose(a,b);
      if(s.ok||b===a+1){result.push(s);continue;}
      const mid=Math.max(a+1,Math.min(b-1,s.split));pending.push([mid,b],[a,mid]);
    }
    // Try merging neighbouring fitted pieces after the initial error subdivision.
    for(let i=0;i<result.length-1;i++){
      const merged=choose(result[i].a,result[i+1].b);
      if(merged.ok){result.splice(i,2,merged);i=Math.max(-1,i-2);}
    }
    return result;
  }
  function encode(rows,pieces,keys,legacy,color) {
    const frame=row=>{
      const f={time:row.t};
      if(color)f.color=row.v.map(v=>Math.round(Math.max(0,Math.min(1,v))*255).toString(16).padStart(2,'0')).join('');
      else keys.forEach((key,c)=>f[key]=row.v[c]);
      return f;
    };
    const out=[];
    for(const s of pieces){
      const left=rows[s.a],right=rows[s.b],f=frame(left);
      if(s.handles){
        if(legacy){
          const c=left.v.findIndex((v,c)=>Math.abs(right.v[c]-v)>1e-10);
          if(c>=0){const d=right.v[c]-left.v[c];f.curve=1/3;f.c2=round((s.handles[c][0]-left.v[c])/d);f.c3=2/3;f.c4=round((s.handles[c][1]-left.v[c])/d);}
        }else f.curve=s.handles.flatMap(h=>[round(left.t+(right.t-left.t)/3),h[0],round(left.t+(right.t-left.t)*2/3),h[1]]);
      }
      out.push(f);
    }
    out.push(frame(rows.at(-1)));
    return out;
  }
  function optimizeTrack(frames,keys,defaults,tolerance,legacy,color=false) {
    // Authored curves, stepped changes and nonstandard frame fields are exact passthroughs.
    const allowed=new Set(['time',...(color?['color']:keys)]);
    if(!Array.isArray(frames)||frames.length<4||frames.some(f=>Object.keys(f).some(k=>!allowed.has(k))))return null;
    const rows=frames.map(f=>({t:Number(f.time||0),v:color?String(f.color||'ffffffff').match(/../g)?.map(h=>parseInt(h,16)/255):keys.map((k,i)=>Number(f[k]??defaults[i]))}));
    if(rows.some((r,i)=>!Number.isFinite(r.t)||!r.v||r.v.length!==keys.length||r.v.some(v=>!Number.isFinite(v))||(i&&r.t<=rows[i-1].t)))return null;
    const gaps=rows.slice(1).map((r,i)=>r.t-rows[i].t).sort((a,b)=>a-b);
    if(gaps[gaps.length>>1]>.1)return null;
    const candidates=[false,true].map(cubic=>{
      const pieces=fit(rows,tolerance,legacy,cubic),out=encode(rows,pieces,keys,legacy,color);
      return {frames:out,error:Math.max(...pieces.map(p=>p.error))};
    });
    candidates.sort((a,b)=>a.frames.length-b.frames.length||bytes(a.frames)-bytes(b.frames));
    return candidates.find(c=>c.frames.length<frames.length&&bytes(c.frames)<bytes(frames))||null;
  }
  function remapWeights(project,oldBones) {
    const indexes=new Map(project.bones.map((b,i)=>[b.name,i]));
    const skins=Array.isArray(project.skins)?project.skins.map(s=>s.attachments):Object.values(project.skins||{});
    for(const skin of skins)for(const slot of Object.values(skin||{}))for(const a of Object.values(slot||{})){
      if(!Array.isArray(a.vertices))continue;
      const count=a.uvs?.length??(a.vertexCount===undefined?null:a.vertexCount*2);
      if(count===null)throw Error('Unknown vertex attachment');
      if(a.vertices.length===count)continue;
      const vertices=a.vertices;
      for(let i=0;i<vertices.length;){const n=vertices[i++];if(!Number.isInteger(n)||n<1||i+n*4>vertices.length)throw Error('Invalid weighted vertices');for(let j=0;j<n;j++,i+=4){const name=oldBones[vertices[i]]?.name;if(!indexes.has(name))throw Error('Invalid bone index');vertices[i]=indexes.get(name);}}
    }
  }
  function helperCandidate(project,name,type,tolerance) {
    // Constraints may depend on immediate parent identity. Keep their authored hierarchy.
    if(['ik','transform','path'].some(k=>project[k]?.length))return null;
    if(type==='scale'&&project.bones.some(b=>b.transform&&b.transform!=='normal'))return null;
    const bone=project.bones.find(b=>b.name===name);
    if(!bone||bone.skin||(bone.transform&&bone.transform!=='normal'))return null;
    const candidate=clone(project),oldBones=clone(candidate.bones),index=candidate.bones.findIndex(b=>b.name===name),child=candidate.bones[index];
    let helper='__nf_'+(type==='scale'?'scaleX_':'moveX_')+name;
    while(candidate.bones.some(b=>b.name===helper))helper+='_';
    const parent=type==='scale'?{...child,name:helper,length:0}:{name:helper,...(child.parent?{parent:child.parent}:{})};
    child.parent=helper;
    if(type==='scale'){child.x=0;child.y=0;child.rotation=0;child.shearX=0;child.shearY=0;child.scaleX=1;parent.scaleY=1;}
    candidate.bones.splice(index,0,parent);
    let changed=false;
    for(const a of Object.values(candidate.animations||{})){
      const b=a.bones?.[name];if(!b)continue;
      const h={};
      if(type==='scale')for(const key of ['translate','rotate','shear'])if(b[key]){h[key]=b[key];delete b[key];}
      const frames=b[type];
      if(frames?.length){
        const base=type==='scale'?1:0;
        // Shared authored curves also split exactly, with the same handles on each bone.
        const axes=['x','y'].map(key=>frames.map(f=>{const out={...f,[key]:f[key]??base};delete out[key==='x'?'y':'x'];return out;}));
        const fits=axes.map((axis,c)=>optimizeTrack(axis,[c?'y':'x'],[base],tolerance,true));
        h[type]=fits[0]?.frames||axes[0];b[type]=fits[1]?.frames||axes[1];
        if(fits.some(Boolean))changed=true;
      }
      if(Object.keys(h).length){a.bones[helper]=h;}
    }
    if(!changed)return null;
    try{remapWeights(candidate,oldBones);}catch{return null;}
    return candidate;
  }
  function keyCount(project){let count=0;for(const a of Object.values(project.animations||{}))for(const group of ['bones','slots'])for(const item of Object.values(a[group]||{}))for(const [key,frames]of Object.entries(item))if(Array.isArray(frames)&&/^(rotate|translate[xy]?|scale[xy]?|shear[xy]?|color|rgba|alpha)$/.test(key))count+=frames.length;return count;}
  function optimize(project,options={}) {
    let output=clone(project);const version=String(output.skeleton?.spine||output.skeleton?.version||'');
    const legacy=version.startsWith('3.8'),modern=/^4\.[012](\.|$)/.test(version);
    if(legacy&&root.NovaFlowMotionAnimation)output=root.NovaFlowMotionAnimation.expandAxisCurves(output);
    const inputKeys=keyCount(output);
    const stats={spineVersion:version,enabled:legacy||modern,beforeKeys:0,afterKeys:0,optimized:0,addedBones:0,tracks:[],limits,bytesBefore:bytes(output)};
    if(!stats.enabled)return {project:output,stats};
    const bones=output.bones||[],byName=new Map(bones.map(b=>[b.name,b]));
    // Divide the local error budget across a chain; long chains cannot accumulate the full budget per bone.
    const depth=name=>{let d=1,b=byName.get(name),seen=new Set();while(b?.parent&&!seen.has(b.name)){seen.add(b.name);d++;b=byName.get(b.parent);}return d;};
    const chain=Math.max(1,...bones.map(b=>depth(b.name)));
    if(legacy&&options.helpers!==false&&!bones.some(b=>b.name.startsWith('__nf_'))){
      for(const bone of bones)for(const type of ['translate','scale']){
        if(!Object.values(output.animations||{}).some(a=>a.bones?.[bone.name]?.[type]?.length>=4))continue;
        const tolerance=(options.limits?.[type]??limits[type])/Math.sqrt(chain);
        // Compare the whole exported object, including the helper definition and all animations.
        const baseline=clone(output);
        for(const a of Object.values(baseline.animations||{})){const b=a.bones?.[bone.name];if(b?.[type]){const result=optimizeTrack(b[type],['x','y'],type==='scale'?[1,1]:[0,0],tolerance,true);if(result)b[type]=result.frames;}}
        const candidate=helperCandidate(output,bone.name,type,tolerance);
        if(candidate&&bytes(candidate)+96<bytes(baseline)&&keyCount(candidate)<keyCount(baseline)){output=candidate;stats.addedBones++;}
      }
    }
    function process(owner,key,keys,defaults,type,animation,name,color=false){
      const frames=owner[key];if(!Array.isArray(frames)||!frames.length)return;
      const before=frames.length,tolerance=(options.limits?.[type]??limits[type])/(type==='color'?1:Math.sqrt(chain));
      let result=optimizeTrack(frames,keys,defaults,tolerance,legacy,color);
      // Legacy rotate playback may take the shortest arc between keys. Do not
      // collapse multi-turn motion into a large ambiguous angular jump.
      if(type==='rotate'&&result?.frames.some((f,i)=>i&&Math.abs((f[keys[0]]||0)-(result.frames[i-1][keys[0]]||0))>120))result=null;
      let out=result?.frames||frames,split=null;
      // 4.x can store independent axes without modifying the skeleton hierarchy.
      if(modern&&!color&&keys.length===2&&['translate','scale','shear'].includes(key)&&!frames.some(f=>f.curve!==undefined)){
        const axes=keys.map((k,c)=>{
          const single=frames.map(f=>({time:f.time||0,value:f[k]??defaults[c]}));
          return optimizeTrack(single,['value'],[defaults[c]],tolerance,false)?.frames||single;
        });
        if(axes.reduce((sum,a)=>sum+a.length,0)<before&&bytes({[key+'x']:axes[0],[key+'y']:axes[1]})<bytes({[key]:out}))split=axes;
      }
      let after=out.length;
      if(split){delete owner[key];owner[key+'x']=split[0];owner[key+'y']=split[1];after=split[0].length+split[1].length;}
      else owner[key]=out;
      stats.beforeKeys+=before;stats.afterKeys+=after;if(after<before)stats.optimized++;
      stats.tracks.push({animation,name,type:key,before,after,maxError:result?.error||0,tolerance,split:!!split});
    }
    for(const [animation,a]of Object.entries(output.animations||{})){
      for(const [name,b]of Object.entries(a.bones||{})){
        if(modern&&Array.isArray(b.rotate))b.rotate=b.rotate.map(f=>{if(f.angle===undefined)return f;const o={...f,value:f.angle};delete o.angle;return o;});
        if(legacy&&Array.isArray(b.rotate))b.rotate=b.rotate.map(f=>{if(f.value===undefined)return f;const o={...f,angle:f.value};delete o.value;return o;});
        process(b,'rotate',[legacy?'angle':'value'],[0],'rotate',animation,name);
        for(const key of ['translate','scale','shear']){
          if(modern)for(const axis of ['x','y'])process(b,key+axis,['value'],[key==='scale'?1:0],key,animation,name);
          process(b,key,['x','y'],key==='scale'?[1,1]:[0,0],key,animation,name);
        }
      }
      for(const [name,s]of Object.entries(a.slots||{})){
        if(modern&&s.color&&!s.rgba){s.rgba=s.color;delete s.color;}
        process(s,legacy?'color':'rgba',['r','g','b','a'],[1,1,1,1],'color',animation,name,true);
        if(modern)process(s,'alpha',['value'],[1],'color',animation,name);
      }
    }
    // 3.8 expects the four normalized handles in separate fields. Preserve native 4.x curves.
    if(legacy){const visit=node=>{if(!node||typeof node!=='object')return;if(Array.isArray(node.curve)&&node.curve.length===4){const c=node.curve;node.curve=c[0];node.c2=c[1];node.c3=c[2];node.c4=c[3];}for(const v of Object.values(node))if(typeof v==='object')visit(v);};visit(output.animations);}
    stats.beforeKeys=inputKeys;stats.afterKeys=keyCount(output);
    stats.bytesAfter=bytes(output);stats.reduction=stats.beforeKeys?1-stats.afterKeys/stats.beforeKeys:0;
    return {project:output,stats};
  }
  root.NovaFlowSpineExportOptimizer={optimize,optimizeTrack,limits};
})(typeof window==='undefined'?globalThis:window);
