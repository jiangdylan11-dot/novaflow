import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const read=f=>readFileSync(new URL('../../renderer/'+f,import.meta.url),'utf8');
const ctx=vm.createContext({console});
for(const f of ['spine-bones.editor.js','motion-calculation.engine.js','motion-calculation.animation.js','spine-export-optimizer.js'])vm.runInContext(read(f),ctx);
const E=ctx.NovaFlowMotionEngine,A=ctx.NovaFlowMotionAnimation,M=ctx.NovaFlowBonesEditor,O=ctx.NovaFlowSpineExportOptimizer;
if(process.env.SPINE_TEST_TRANSLATE_LIMIT){const optimize=O.optimize;O.optimize=p=>optimize(p,{limits:{translate:Number(process.env.SPINE_TEST_TRANSLATE_LIMIT)}});}
const presets=vm.runInNewContext('('+read('motion-calculation.panel.js').match(/const presetSets = (\{[\s\S]*?\n  \});/)[1]+')');
const plain=o=>o===undefined?undefined:JSON.parse(JSON.stringify(o));
function fixture(){return {skeleton:{spine:'3.8.99',fps:60},bones:[{name:'root',rotation:23},{name:'ball',parent:'root',x:20,y:30,rotation:31,scaleX:1.2,scaleY:.8},{name:'child',parent:'ball',x:80,length:100}],slots:[{name:'slot',bone:'ball',color:'ff8040ff'}],skins:[],events:{hit:{}},animations:{idle:{events:[{time:.25,name:'hit'},{time:2.9,name:'hit'}],bones:{ball:{}}}}};}
function native(p,version){p=plain(p);p.skeleton.spine=version==='3.8'?'3.8.99':version+'.00';for(const a of Object.values(p.animations)){
 if(version!=='3.8'){for(const b of Object.values(a.bones||{}))if(b.rotate)b.rotate=b.rotate.map(({angle,...f})=>({...f,value:angle??f.value??0}));for(const s of Object.values(a.slots||{}))if(s.color){s.rgba=s.color;delete s.color;}}
 }return p;}
const runtimes={};if(process.env.SPINE_EXTRA_RUNTIME_DIR)for(const version of ['4.1','4.2']){const c=vm.createContext({console});vm.runInContext(readFileSync(process.env.SPINE_EXTRA_RUNTIME_DIR+'/spine-core-'+version+'.js','utf8'),c);runtimes[version]=c.spine;}for(const version of ['3.8','4.0']){const c=vm.createContext({console});vm.runInContext(read('vendor/spine/spine-webgl-'+version+'.js'),c);runtimes[version]=c.spine;}
function player(p,version){const s=runtimes[version],data=new s.SkeletonJson({newMeshAttachment(_skin,name){const m=new s.MeshAttachment(name);m.region={u:0,v:0,u2:1,v2:1,width:1,height:1,originalWidth:1,originalHeight:1,offsetX:0,offsetY:0,rotate:false};return m;}}).readSkeletonData(p),sk=new s.Skeleton(data),a=data.animations[0];return {duration:a.duration,at(t){sk.setToSetupPose();a.apply(sk,-1,t,false,[],1,s.MixBlend.setup,s.MixDirection.mixIn);sk.updateWorldTransform(s.Physics?.update);return {bones:sk.bones.filter(b=>!b.data.name.startsWith('__nf_')).map(b=>[b.worldX,b.worldY,b.a,b.b,b.c,b.d]),vertices:sk.slots.flatMap(slot=>{const a=slot.getAttachment();if(!a?.computeWorldVertices)return [];const v=[];a.computeWorldVertices(slot,0,a.worldVerticesLength,v,0,2);return v;}),colors:sk.slots.map(s=>[s.color.r,s.color.g,s.color.b,s.color.a])};}};}
function compare(before,after,version){const a=player(before,version),b=player(after,version);assert.equal(a.duration,b.duration);let position=0,geometry=0,alpha=0;
 for(let i=0;i<=1200;i++){const t=a.duration*i/1200,x=a.at(t),y=b.at(t);x.bones.forEach((v,k)=>{const w=y.bones[k];position=Math.max(position,Math.hypot(v[0]-w[0],v[1]-w[1]));for(const [px,py]of [[0,0],[100,0],[0,100],[100,100]])geometry=Math.max(geometry,Math.hypot(v[0]+v[2]*px+v[3]*py-w[0]-w[2]*px-w[3]*py,v[1]+v[4]*px+v[5]*py-w[1]-w[4]*px-w[5]*py));});x.vertices.forEach((v,k)=>{geometry=Math.max(geometry,Math.abs(v-y.vertices[k]));});x.colors.forEach((v,k)=>v.forEach((n,c)=>alpha=Math.max(alpha,Math.abs(n-y.colors[k][c]))));}
 assert.ok(geometry<.65,`world geometry error ${geometry}`);assert.ok(alpha<.0032,`color error ${alpha}`);return {position,geometry,alpha};}
function scenarios(){const list=[];
 for(const mode of ['bounce','expand','shuttle'])for(const [name,values,axes]of presets[mode]){
  const stack=E.freshStack();for(const p of Object.values(stack))p.enabled=false;const p=stack[mode];Object.assign(p,values,{enabled:true});for(const key of E.ownedChannels[mode])p.axes[key].amp=axes[key];
  list.push({name,mode,stack});
  if(mode!=='bounce')list.push({name:name+'反向',mode,stack:plain({...stack,[mode]:{...p,reverse:true}})});
 }
 for(const [name,opacity]of [['透明到实心',{from:0,to:1,behavior:'once'}],['实心到透明',{from:1,to:0,behavior:'once'}],['呼吸闪烁',{from:.15,to:1,behavior:'pulse',cycles:3}]]){const stack=E.freshStack();for(const p of Object.values(stack))p.enabled=false;stack.opacity.enabled=true;Object.assign(stack.opacity.opacity,opacity,{on:true});list.push({name,mode:'opacity',stack});}
 const stack=E.freshStack();for(const p of Object.values(stack))p.enabled=true;stack.shuttle.axes.x.amp=1000;stack.shuttle.axes.y.amp=-1000;stack.shuttle.axes.y.cycles=3;stack.expand.axes.sx.amp=10;stack.expand.axes.sy.amp=-.8;stack.expand.link=false;stack.opacity.opacity.on=true;list.push({name:'组合极值及独立XY',mode:'combined',stack});
 return list.map(s=>{const p=fixture();p.animations.idle=A.calculate(p,'idle',['ball'],s.stack,{animationDuration:3,boneDuration:2,animationDelay:.4},E,M).animation;return {...s,project:p};});
}
function ribbonFixture(){
 const source=read('novaflow-brand-runtime.js'),functions=new Map([...source.matchAll(/^  function (\w+)\([^]*?^  \}/gm)].map(m=>[m[1],m[0]])),selected=new Map();
 function select(name){if(selected.has(name)||name==='getRibbonTimelineDuration')return;selected.set(name,functions.get(name));for(const m of functions.get(name).matchAll(/\b(\w+)\s*\(/g))if(functions.has(m[1]))select(m[1]);}
 for(const n of ['getRibbonUniformWaveLayout','buildRibbonUniformWaveRotateMap'])select(n);
 const code=[...selected.values()].join('\n'),constants=[...new Set(code.match(/\bRIBBON_[A-Z_]+\b/g))].map(n=>`const ${n} = ${source.match(new RegExp(`^  const ${n} = ([^;]+);`,'m'))[1]};`);
 const c=vm.createContext({getRibbonTimelineDuration:()=>2});vm.runInContext(constants.join('\n')+'\n'+code,c);
 const p=fixture();p.bones=[{name:'root'},...Array.from({length:8},(_,i)=>({name:'r'+i,parent:i?'r'+(i-1):'root',x:i?35:0,length:35}))];p.slots=[];p.animations={idle:{bones:{}}};
 const entries=p.bones.slice(1).map((b,i)=>({name:b.name,sourceName:'r0',chainIndex:i}));
 const o={duration:2,fps:60,stiffness:0,elasticity:18,amplitude:36,wind:0,delay:57,offset:0,wavePhase:36,whip:0,swingCount:1,nativeSwingCount:1,waveCount:1,uniformWeight:50};
 const map=c.buildRibbonUniformWaveRotateMap(c.getRibbonUniformWaveLayout({...p,entries},entries),o);
 for(const [name,rotate]of map)p.animations.idle.bones[name]={rotate:plain(rotate)};
 return {name:'飘带8骨骼',mode:'ribbon',project:p};
}
const reports=[];
for(const version of Object.keys(runtimes))for(const s of [...scenarios(),ribbonFixture()])test(version+' '+s.name,()=>{
 const before=native(s.project,version),snapshot=JSON.stringify(before),{project:after,stats}=O.optimize(before),error=compare(before,after,version);
 assert.equal(JSON.stringify(before),snapshot);assert.equal(after.bones.length,before.bones.length+stats.addedBones);assert.deepEqual(plain(after.animations.idle.events),before.animations.idle.events);assert.ok(stats.afterKeys<stats.beforeKeys,JSON.stringify(stats));assert.ok(stats.bytesAfter<stats.bytesBefore);
 reports.push({version,name:s.name,mode:s.mode,before:stats.beforeKeys,after:stats.afterKeys,bytesBefore:stats.bytesBefore,bytesAfter:stats.bytesAfter,addedBones:stats.addedBones,...error});
});
test('authored curves, discontinuities, events, constraints and other fields survive unchanged',()=>{
 const p=fixture();p.animations.idle.bones.ball={translate:[{time:0,x:0,curve:'stepped'},{time:1,x:4},{time:2,x:8},{time:3,x:9}],scale:[{time:0,x:1,y:1,curve:.25,c2:.3,c3:.75,c4:.8},{time:2,x:2,y:3}]};p.ik=[{name:'ik',target:'root',bones:['ball']}];
 assert.deepEqual(plain(O.optimize(p).project),p);
 const q=native(p,'4.0');q.animations.idle.bones.ball.scale[0].curve=[.2,1.1,.8,1.8,.2,1.2,.8,2.8];delete q.animations.idle.bones.ball.scale[0].c2;delete q.animations.idle.bones.ball.scale[0].c3;delete q.animations.idle.bones.ball.scale[0].c4;assert.deepEqual(plain(O.optimize(q).project),q);
});
test('3.8 helpers preserve scale, rotation, shear, negative setup scale and other animations',()=>{
 const p=fixture(),b=p.bones[1];b.rotation=41;b.shearX=13;b.shearY=-9;b.scaleX=-1.3;b.scaleY=.7;
 p.animations.idle.bones.ball={scale:Array.from({length:181},(_,i)=>({time:i/60,x:1+.4*Math.sin(i/60*2),y:1+.3*Math.cos(i/60*5)})),rotate:[{time:0,angle:20},{time:3,angle:105}],translate:[{time:0,x:4,y:9},{time:3,x:40,y:-16}]};
 p.animations.other={bones:{ball:{translate:[{x:12,y:-22},{time:3,x:-15,y:48}],rotate:[{angle:75}],scale:[{x:.7,y:1.4},{time:3,x:1.1,y:.8}]}}};
 const {project:out,stats}=O.optimize(p);assert.ok(stats.addedBones>0,'must exercise scale helper');compare(p,out,'3.8');
 const x=plain(p),y=plain(out);x.animations={other:x.animations.other};y.animations={other:y.animations.other};compare(x,y,'3.8');
});
test('constraints and nonstandard inheritance keep their bone hierarchy',()=>{
 const p=scenarios().find(s=>s.name==='椭圆运动').project;p.ik=[{name:'reach',bones:['ball'],target:'root'}];const out=O.optimize(p).project;assert.deepEqual(plain(out.bones),p.bones);
});
test('weighted vertices remap to the same named bones when adding X and scale helpers',()=>{
 const p=fixture();p.slots[0].attachment='mesh';p.skins=[{name:'default',attachments:{slot:{mesh:{type:'mesh',uvs:[0,0,1,0,1,1],triangles:[0,1,2],vertices:[1,1,0,0,1,2,1,80,0,.5,2,0,0,.5,1,2,20,100,1],hull:3}}}}];
 p.animations.idle.bones.ball={translate:Array.from({length:121},(_,i)=>({time:i/60,x:100*Math.sin(i/60*3),y:70*Math.cos(i/60*2)})),scale:Array.from({length:121},(_,i)=>({time:i/60,x:1+.4*Math.sin(i/60*2),y:1+.3*Math.cos(i/60*5)}))};
 const {project:out,stats}=O.optimize(p);assert.ok(stats.addedBones>=1);compare(p,out,'3.8');
});
test('user weighted-mesh project retains both ribbons after export optimization',()=>{
 if(!process.env.SPINE_USER_FIXTURE)return;
 const p=JSON.parse(readFileSync(process.env.SPINE_USER_FIXTURE,'utf8')),stack=E.freshStack();for(const p of Object.values(stack))p.enabled=false;stack.shuttle.enabled=true;stack.expand.enabled=true;
 p.animations.animation.bones={};p.animations.animation=A.calculate(p,'animation',['root'],stack,{animationDuration:3,boneDuration:2,animationDelay:.4},E,M).animation;
 for(const version of Object.keys(runtimes)){const source=native(p,version),out=O.optimize(source);const error=compare(source,out.project,version);reports.push({version,name:'用户双飘带工程',mode:'user',before:out.stats.beforeKeys,after:out.stats.afterKeys,bytesBefore:out.stats.bytesBefore,bytesAfter:out.stats.bytesAfter,addedBones:out.stats.addedBones,...error});}
});
test('multi-turn rotation never becomes a shortest-arc shortcut',()=>{
 const p=fixture();p.animations.idle.bones.ball.rotate=Array.from({length:181},(_,i)=>({time:i/60,angle:i*4}));for(const version of Object.keys(runtimes)){const source=native(p,version);compare(source,O.optimize(source).project,version);}
});
test('formal export builder uses this optimizer without stripping curves',()=>{
 const source=read('novaflow-brand-runtime.js'),build=source.match(/^  function buildSkeletonSpineExportJson\([^]*?^  \}/m)[0];
 const c=vm.createContext({console:{info(){}},window:{NovaFlowSpineExportOptimizer:O},cloneSkeletonSpineExportValue:plain,SKELETON_SPINE_EXPORT_PROJECT_KEYS:['skeleton','bones','slots','skins','events','animations']});vm.runInContext(build,c);
 const p=scenarios()[0].project,out=JSON.parse(c.buildSkeletonSpineExportJson({project:p},{jsonText:JSON.stringify(p)}));assert.deepEqual(out,plain(O.optimize(p).project));
});
test('actual UI-exported 3.8 and 4.0 files match the pre-export project in native playback',()=>{
 if(!process.env.SPINE_UI_EXPORT_DIR)return;
 const folder=process.env.SPINE_UI_EXPORT_DIR;
 for(const [version,suffix]of [['3.8','38'],['4.0','40']]){
  const before=JSON.parse(readFileSync(folder+'/ui-source-'+suffix+'.json','utf8'));
  const after=JSON.parse(readFileSync(folder+'/ui-export/optimized-'+suffix+'.json','utf8'));
  const error=compare(before,after,version);assert.equal(after.skeleton.spine,before.skeleton.spine);console.log('Actual UI export',version,JSON.stringify(error));
 }
});
test('write reproducible comparison data when explicitly requested',()=>{if(process.env.SPINE_EXPORT_REPORT){mkdirSync(process.env.SPINE_EXPORT_REPORT,{recursive:true});writeFileSync(process.env.SPINE_EXPORT_REPORT+'/comparison.json',JSON.stringify(reports,null,2));}console.log(JSON.stringify(reports.filter(r=>['橡胶球','椭圆运动','组合极值及独立XY','飘带8骨骼'].includes(r.name))));});
