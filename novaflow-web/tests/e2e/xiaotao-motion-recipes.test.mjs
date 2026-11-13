import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import vm from 'node:vm';
import {FOART_TOOL_SCHEMA,FOART_MOTIONS,FOART_TOOL_SYSTEM,validateFoartPlan,foartPlanResponseFormat} from '../../packages/shared/src/foart-tool-plan.mjs';
const recipesSource=await readFile(new URL('../../renderer/motion-recipes.js',import.meta.url),'utf8');
const opsSource=await readFile(new URL('../../renderer/spine-structure.ops.js',import.meta.url),'utf8');
const editorSource=await readFile(new URL('../../renderer/spine-skeleton-editor.js',import.meta.url),'utf8');
const toolsSource=await readFile(new URL('../../renderer/xiaotao-foart-tools.js',import.meta.url),'utf8');
const htmlSource=await readFile(new URL('../../renderer/spine-skeleton-editor.html',import.meta.url),'utf8');
const indexSource=await readFile(new URL('../../renderer/index.html',import.meta.url),'utf8');

function recipes(){const sandbox={};vm.createContext(sandbox);vm.runInContext(recipesSource,sandbox);return sandbox.NovaFlowMotionRecipes;}
// the template rig 自动架设 writes: y/x hips, waist under root following x, chest/neck/head, root-level IK targets
function templateRig(){
 return {skeleton:{spine:'3.8.99'},bones:[{name:'root'},{name:'y',parent:'root',x:0,y:300},{name:'x',parent:'y'},{name:'waist',parent:'root',x:0,y:320},
  {name:'chest',parent:'waist',length:80,rotation:90},{name:'neck',parent:'chest',x:80,length:20},{name:'head',parent:'neck',x:20,length:60},
  {name:'hair_1',parent:'head',x:40,length:40,rotation:170},{name:'hair_2',parent:'hair_1',x:40,length:40},
  {name:'leg_r',parent:'x',length:140,rotation:-90},{name:'leg2',parent:'root',x:20,y:20},{name:'arm2',parent:'root',x:60,y:300}],
  ik:[{name:'leg2',bones:['leg_r'],target:'leg2'}],transform:[{name:'x',bones:['waist'],target:'x',translateMix:.5}],
  slots:[{name:'body',bone:'root',attachment:'body'}],skins:[{name:'default',attachments:{body:{body:{x:0,y:300,width:200,height:600}}}}],animations:{}};
}
function uiProject(){
 const atts={},slots=[];
 for(const [n,x,y] of [['bg',0,400],['sym_a',-100,300],['sym_b',100,300],['title',0,700]]){slots.push({name:n,bone:'root',attachment:n});atts[n]={[n]:{x,y,width:120,height:80}};}
 return {skeleton:{spine:'3.8.99'},bones:[{name:'root'}],slots,skins:[{name:'default',attachments:atts}],animations:{}};
}

test('the planner catalogue matches the native recipes and the tool prompt teaches the one-picture flow',()=>{
 const R=recipes();
 assert.deepEqual([...FOART_MOTIONS].sort(),Object.keys(R.MOTIONS).sort());
 assert.match(FOART_TOOL_SYSTEM,/operation:"motion"/);assert.match(FOART_TOOL_SYSTEM,/from_art_layers/);assert.match(FOART_TOOL_SYSTEM,/never call auto_rig for that/);
 const schemas=foartPlanResponseFormat({animation:{active:true}}).schema.properties.operations.items.anyOf;
 assert.ok(schemas.some(s=>s.properties.action.const==='animation'&&s.properties.operation.const==='motion'&&s.properties.motion.enum.includes('attack')));
 assert.ok(schemas.some(s=>s.properties.action.const==='animation'&&s.properties.operation.const==='from_art_layers'));
});

test('motion and from_art_layers pass plan validation; bad values do not',()=>{
 const wire=op=>({schema:FOART_TOOL_SCHEMA,status:'act',reply:'做动作',operations:[{action:'animation',...op}]});
 const loaded={schema:FOART_TOOL_SCHEMA,controls:[],animation:{active:true,loaded:true,bones:[{name:'root'}]}};
 const empty={schema:FOART_TOOL_SCHEMA,controls:[],animation:{active:true,loaded:false}};
 validateFoartPlan(wire({operation:'motion',motion:'idle'}),loaded);
 validateFoartPlan(wire({operation:'motion',motion:'ui_pop',name:'入场',targets:['sym_*'],delay:.3,merge:true,intensity:1.2,loop:false}),loaded);
 validateFoartPlan(wire({operation:'from_art_layers'}),empty);
 assert.throws(()=>validateFoartPlan(wire({operation:'motion',motion:'idle'}),empty));
 for(const bad of [{motion:'dance'},{motion:'idle',intensity:9},{motion:'idle',duration:0},{motion:'idle',facing:2},{motion:'idle',targets:'all'},{motion:'idle',script:'x'}])
  assert.throws(()=>validateFoartPlan(wire({operation:'motion',...bad}),loaded));
});

test('character recipes key the trunk, carry the waist with the hips and stay inside the rig',()=>{
 const R=recipes(),src=templateRig();
 for(const motion of ['idle','attack','hit','die','win','jump','cast','walk','float']){
  const out=R.synthesize(src,{motion});
  const a=out.json.animations[out.name];
  assert.ok(Object.keys(a.bones).length>0,motion);
  for(const name of Object.keys(a.bones))assert.ok(src.bones.some(b=>b.name===name),motion+' keyed an unknown bone '+name);
  if(a.bones.y?.translate){const w=a.bones.waist?.translate;assert.ok(w,motion+': the waist must follow a hips move');assert.equal(w.length,a.bones.y.translate.length);}
  assert.equal(JSON.stringify(out.json.bones),JSON.stringify(src.bones),motion+' must not change the rig');
 }
 const attack=R.synthesize(src,{motion:'attack'});assert.equal(attack.json.animations[attack.name].events[0].name,'hit');
 const die=R.synthesize(src,{motion:'die'});assert.ok(die.json.animations[die.name].slots.body.color.at(-1).color.endsWith('00'),'die fades out');
 const twice=R.synthesize(attack.json,{motion:'attack'});assert.notEqual(twice.name,attack.name,'a second attack gets its own name');
});

test('UI recipes give each target layer its own bone without moving the picture, stagger and merge',()=>{
 const R=recipes(),src=uiProject();
 const pop=R.synthesize(src,{motion:'ui_pop',name:'入场',targets:['sym_*']});
 const j=pop.json,boneOf=Object.fromEntries(j.slots.map(s=>[s.name,s.bone]));
 assert.equal(boneOf.bg,'root');assert.notEqual(boneOf.sym_a,'root');
 const b=j.bones.find(x=>x.name===boneOf.sym_a),att=j.skins[0].attachments.sym_a.sym_a;
 assert.equal(b.x+att.x,-100);assert.equal(b.y+att.y,300);
 const sa=j.animations['入场'].bones[boneOf.sym_a].scale,sb=j.animations['入场'].bones[boneOf.sym_b].scale;
 assert.equal(sa[0].x,0);assert.ok(sb.findIndex(k=>k.x>1)>=0);
 const peak=keys=>keys.find(k=>k.x>1).time;assert.ok(peak(sb)>peak(sa),'second symbol pops later');
 const more=R.synthesize(j,{motion:'ui_bigwin',name:'入场',targets:['title'],merge:true,delay:.5});
 const anim=more.json.animations['入场'];assert.equal(more.name,'入场');
 assert.ok(anim.bones[boneOf.sym_a]&&anim.bones[more.json.slots.find(s=>s.name==='title').bone],'merged into one animation');
 assert.equal(anim.bones[more.json.slots.find(s=>s.name==='title').bone].scale[0].curve,'stepped');
});

test('美工 layers become a loadable layered project, back to front, bottom-centre origin',()=>{
 const R=recipes();
 const src=R.projectFromLayers([{name:'身体',dataUrl:'data:image/png;base64,AA',x:10,y:20,width:100,height:200},{name:'头/发',dataUrl:'data:image/png;base64,BB',x:30,y:0,width:60,height:60}],{width:200,height:400},{name:'hero.png'});
 const j=JSON.parse(src.skeleton.text);
 assert.equal(src.skeleton.fileName,'hero.json');assert.deepEqual(j.slots.map(s=>s.name),['身体','头_发']);
 assert.deepEqual(JSON.parse(JSON.stringify(j.skins[0].attachments['身体']['身体'])),{x:-40,y:280,width:100,height:200});
 assert.deepEqual([...src.images.map(i=>i.fileName)],['身体.png','头_发.png']);assert.match(src.atlas.text,/头_发\.png\nsize: 60,60/);
 assert.throws(()=>R.projectFromLayers([],{width:1,height:1}));
});

test('the editor wires motion through one undo step and rigs a bare character first',async()=>{
 const R=recipes(),calls=[];
 const state={json:{...templateRig(),bones:[{name:'root'}],ik:[],transform:[]},history:[],mode:'setup',frame:3};
 const sandbox={window:{NovaFlowMotionRecipes:R},state,FPS:30,refresh(){},setMode:m=>{state.mode=m},agentContext:()=>({ok:true}),
  autoRig:async()=>{calls.push('rig');state.json={...templateRig()};return {bones:12,ik:1,layers:1}},
  imageLayers:()=>[{skin:'default',slot:'body',name:'body'}],meshOneLayer:()=>{},weighOneLayer:()=>{},
  runBatch:async(layers,label)=>{calls.push(label);return {done:layers.length}},
  edit:(label,fn)=>{calls.push(label);const r=fn(state.json);state.history.push(state.json);state.json=r.json;return r}};
 sandbox.window.parent=sandbox.window;vm.createContext(sandbox);
 const start=editorSource.indexOf('  async function agentMotion(op) {'),end=editorSource.indexOf('  function agentAction(op) {',start);assert.ok(start>0&&end>start);
 vm.runInContext(editorSource.slice(start,end)+';this.agentMotion=agentMotion;',sandbox);
 const r=await sandbox.agentMotion({action:'animation',operation:'motion',motion:'idle'});
 assert.deepEqual(calls,['rig','自动蒙皮','自动权重','小桃动作 待机']);assert.equal(r.animation,'待机');assert.equal(r.prepared.bones,12);
 assert.equal(state.anim,'待机');assert.equal(state.mode,'animate');assert.equal(state.history.length,1);
 const ui=await sandbox.agentMotion({action:'animation',operation:'motion',motion:'ui_press',name:'按下'});assert.equal(ui.prepared,null);
 await assert.rejects(sandbox.agentMotion({action:'animation',operation:'motion',motion:'idle',evil:1}));
 await assert.rejects(sandbox.agentMotion({action:'animation',operation:'motion',motion:'idle',intensity:50}));
});

test('the page loads the recipes for the editor and 小桃 runs both operations natively',()=>{
 assert.match(htmlSource,/'motion-recipes\.js', 'spine-skeleton-editor\.js'/);
 assert.match(indexSource,/<script src="\.\/motion-recipes\.js"><\/script>/);
 assert.match(toolsSource,/op\.operation==='from_art_layers'/);assert.match(toolsSource,/noFolderAsk:true/);
 assert.match(toolsSource,/op\.operation==='motion'\)\{onStatus\('正在生成动作…'\);const result=await api\.agentAction\(op\)/);
 assert.match(editorSource,/if \(op && op\.operation === 'motion'\) return agentMotion\(op\)/);
});

// ---- effects ----------------------------------------------------------------------------------
import {FOART_EFFECTS} from '../../packages/shared/src/foart-tool-plan.mjs';
const fxIndex=JSON.parse(await readFile(new URL('../../renderer/fx-library/index.json',import.meta.url),'utf8'));
const fxOf=async id=>JSON.parse(await readFile(new URL('../../renderer/fx-library/'+id+'/fx.json',import.meta.url),'utf8'));

test('the effect library matches the planner list and every picture it names is shipped',async()=>{
 assert.deepEqual([...FOART_EFFECTS].sort(),Object.keys(fxIndex.effects).sort());
 const {access}=await import('node:fs/promises');
 for(const id of FOART_EFFECTS){
  const def=fxIndex.effects[id];
  if(def.native)continue;
  if(def.kit){for(const set of [def.kit.in,def.kit.loop]){assert.ok(set.length>=4);for(const part of set)assert.ok(fxIndex.effects[part.effect]&&!fxIndex.effects[part.effect].kit,id+' part '+part.effect);}continue;}
  const fx=await fxOf(id);assert.equal(fx.id,id);assert.ok(fx.duration>0&&fx.pictures.length>0,id);
  for(const pic of fx.pictures)await access(new URL('../../renderer/fx-library/'+id+'/'+pic+'.png',import.meta.url));
  for(const m of Object.values(fx.attachments))for(const [name,att] of Object.entries(m)){assert.ok(fx.pictures.includes(name),id+' attachment '+name);assert.equal(att.path,name);}
  for(const tr of Object.values(fx.animation.slots||{}))for(const k of tr.attachment||[])assert.ok(k.name===null||fx.pictures.includes(k.name),id+' key picture');
  assert.match(FOART_TOOL_SYSTEM,new RegExp(id+'='));
 }
});

test('add_effect passes plan validation; an effect lands on the subject, in time, on its own bones and slots',async()=>{
 const wire=op=>({schema:FOART_TOOL_SCHEMA,status:'act',reply:'加特效',operations:[{action:'animation',...op}]});
 const loaded={schema:FOART_TOOL_SCHEMA,controls:[],animation:{active:true,loaded:true,bones:[{name:'root'}]}};
 validateFoartPlan(wire({operation:'add_effect',effect:'hit'}),loaded);
 validateFoartPlan(wire({operation:'add_effect',effect:'backlight',name:'中奖',under:true,scale:.5,targets:['sym_*']}),loaded);
 validateFoartPlan(wire({operation:'add_effect',effect:'slash',tone:'ice'}),loaded);
 for(const bad of [{effect:'slash',tone:'pink'},{effect:'boom'},{effect:'hit',scale:0},{effect:'hit',time:-1},{effect:'hit',under:'yes'},{effect:'hit',script:1}])assert.throws(()=>validateFoartPlan(wire({operation:'add_effect',...bad}),loaded));
 const R=recipes(),src=uiProject();src.animations['中奖']={bones:{root:{scale:[{time:0,x:1,y:1},{time:1,x:1.1,y:1.1},{time:2,x:1,y:1}]}}};
 const box=R.subjectBox(src,'中奖');
 assert.equal(box.x,0);assert.equal(box.under,0);assert.ok(box.w>=320&&box.h>=480);
 const only=R.subjectBox(src,'中奖',['title']);assert.equal(only.y,700);assert.equal(only.under,3);
 const hit=await fxOf('hit'),before=JSON.stringify(src);
 const out=R.mergeEffect(src,hit,{anim:'中奖',time:.5,x:box.x,y:box.y,scale:.5,under:null});
 assert.equal(JSON.stringify(src),before,'the source project is untouched');
 const j=out.json,holder=j.bones.find(b=>b.name===out.holder);
 assert.equal(holder.parent,'root');assert.equal(holder.x,box.x);assert.equal(holder.scaleX,.5);
 assert.equal(out.slots.length,hit.slots.length);assert.deepEqual([...j.slots.slice(-hit.slots.length)].map(s=>s.name),[...out.slots],'on top by default');
 for(const name of out.slots){const keys=j.animations['中奖'].slots[name].attachment;assert.equal(keys[0].time,0);assert.equal(keys[0].name,null,'hidden before its time');assert.equal(keys.at(-1).name,null,'hidden after it ends');assert.ok(keys.some(k=>k.name&&k.time>=.5));}
 assert.ok(Math.abs(out.end-(.5+hit.duration))<1e-3);
 // a looping effect fills the animation with a whole number of loops and stays to its end, under the subject when asked
 const back=await fxOf('backlight');const looped=R.mergeEffect(src,back,{anim:'中奖',time:0,x:0,y:400,scale:1,under:box.under});
 assert.equal(looped.end,2);assert.equal(looped.repeats,1);assert.deepEqual([...looped.json.slots.slice(0,back.slots.length)].map(s=>s.name),[...looped.slots]);
 const second=R.mergeEffect(looped.json,back,{anim:'中奖',time:0,x:0,y:400,scale:1,under:null});assert.notEqual(second.holder,looped.holder,'a second copy gets its own names');
 assert.equal(R.effectTime({animations:{a:{events:[{time:.42,name:'hit'}]}}},'a','strike'),.42);assert.equal(R.effectTime(src,'中奖','start'),0);
});

test('the editor and 小桃 run add_effect natively',()=>{
 assert.match(editorSource,/if \(op && op\.operation === 'add_effect'\) return agentAddEffect\(op\)/);
 assert.match(editorSource,/await addImageFile\(new File\(\[blob\], pic \+ '\.png'/);
 assert.ok(editorSource.includes("const parts = def.kit ? def.kit[loopKit ? 'loop' : 'in'] : [null]"));
 assert.ok(editorSource.includes("L.generateSweepSequence(rgba, w, hh, { scheme: 'gold'"));
 assert.match(editorSource,/const swing = R\.swingFromTracks\(trace\.tracks, trace\.frames, FPS, /);
 assert.match(editorSource,/tone = R\.toneFromHues\(h\.bins, h\.total\)/);
 assert.match(toolsSource,/op\.operation==='add_effect'\)\{onStatus\('正在加特效…'\);const result=await api\.agentAction\(op\)/);
});

test('an arc follows the swing it is read from; tones turn colour and leave white alone',async()=>{
 const R=recipes(),F=20,fps=30;
 // a tip swinging a quarter circle of radius 200 around (0,300) between frames 8 and 14, and a still body
 const tip=new Float32Array(F*2),body=new Float32Array(F*2);
 for(let f=0;f<F;f++){const u=Math.max(0,Math.min(1,(f-8)/6)),a=(120-90*u)*Math.PI/180;tip[f*2]=200*Math.cos(a);tip[f*2+1]=300+200*Math.sin(a);body[f*2]=0;body[f*2+1]=300;}
 const sw=R.swingFromTracks([body,tip],F,fps);
 assert.ok(sw.frame>=8&&sw.frame<=14,'peak inside the swing');assert.ok(sw.from>=7&&sw.to<=15);
 assert.ok(sw.chord>200&&sw.chord<300);assert.equal(sw.bulge,1,'a clockwise swing bulges to the left of its travel');
 const arc=R.placeArc(sw,512,4/3);assert.equal(arc.flip,true);assert.ok(arc.scale>.4&&arc.scale<1);assert.ok(Math.hypot(arc.x,arc.y-300)>120&&Math.hypot(arc.x,arc.y-300)<=205,'sits on the path');
 const mirrored=R.swingFromTracks([body,tip.map((v,i)=>i%2?v:-v)],F,fps);assert.equal(mirrored.bulge,-1);assert.equal(R.placeArc(mirrored,512,4/3).flip,false);
 assert.equal(R.swingFromTracks([body],F,fps),null,'nothing moves, nothing to follow');
 assert.deepEqual([...R.driftFromTracks([Float32Array.from([0,0,5,0,9,0])],3,2)],[9,0]);
 const bins=new Float32Array(36);bins[20]=5;assert.equal(R.toneFromHues(bins,10),'ice');bins.fill(1);assert.equal(R.toneFromHues(bins,36),null,'no clear colour');assert.equal(R.toneFromHues(new Float32Array(36),10),null);
 const px=Uint8ClampedArray.from([255,0,0,255, 255,255,255,255, 0,0,0,0]);R.shiftHue(px,120);assert.deepEqual([...px],[0,255,0,255, 255,255,255,255, 0,0,0,0]);
 const hit=await fxOf('hit'),toned=R.renameEffectPictures(hit,'_ice');
 assert.deepEqual([...toned.pictures],hit.pictures.map(n=>n+'_ice'));
 for(const m of Object.values(toned.attachments))for(const [n,a] of Object.entries(m)){assert.match(n,/_ice$/);assert.equal(a.path,n);}
 for(const tr of Object.values(toned.animation.slots))for(const k of tr.attachment||[])assert.ok(k.name===null||/_ice$/.test(k.name));
 assert.ok(!JSON.stringify(hit).includes('_ice'),'the library entry is untouched');
 for(const def of Object.values(fxIndex.effects)){if(def.native||def.kit)continue;assert.ok(def.hue>=0&&def.hue<360);if(def.onTarget)assert.ok(['subject','target'].includes(def.onTarget.fit));}
});

test('a set of effects: a holding layer stays, a settled one is simply there, an entrance never grows, lights can be turned down',async()=>{
 const R=recipes(),src=uiProject();src.animations['进场']={bones:{root:{scale:[{time:0,x:0,y:0},{time:.4,x:1.1,y:1.1},{time:.6,x:1,y:1}]}}};
 const dim=await fxOf('dim'),coins=await fxOf('burst'),rays=await fxOf('rays');
 assert.equal(dim.hold,true);
 const held=R.mergeEffect(src,dim,{anim:'进场',time:0,x:0,y:0,scale:1,under:0});
 assert.equal(held.json.slots[0].name,held.slots[0],'under everything');assert.equal(held.end,.6);
 const hk=held.json.animations['进场'].slots[held.slots[0]];assert.ok(hk.attachment.every(k=>k.name!==null),'never switched off');assert.equal(hk.color.at(-1).color,'000000a6');
 const there=R.mergeEffect(src,dim,{anim:'进场',time:0,x:0,y:0,scale:1,under:0,settled:true});
 assert.deepEqual([...there.json.animations['进场'].slots[there.slots[0]].color].map(k=>[k.time,k.color]),[[0,'000000a6']]);
 const cut=R.mergeEffect(src,coins,{anim:'进场',time:.3,x:0,y:0,scale:1,under:null,natural:true});
 assert.equal(cut.end,.6,'the entrance keeps its length');assert.equal(R.animationLength(cut.json.animations['进场']),.6);
 const free=R.mergeEffect(src,coins,{anim:'进场',time:.3,x:0,y:0,scale:1,under:null});assert.ok(free.end>.95);
 const soft=R.mergeEffect(src,rays,{anim:'进场',time:0,x:0,y:0,scale:1,under:null,alpha:.5});
 const first=soft.json.animations['进场'].slots[soft.slots[0]].color[0].color,plain=rays.animation.slots.a.color[0].color;
 assert.equal(parseInt(first.slice(6),16),Math.round(parseInt(plain.slice(6),16)*.5));
 // coins are made by the software's own particle system from a template its library ships
 const bundled=(await readdir(new URL('../../particle-templates/',import.meta.url))).map(f=>'file_'+f.replace(/\.json$/,''));
 for(const id of ['coins','coinloop']){const def=fxIndex.effects[id];assert.equal(def.native,'particle');assert.ok(bundled.includes(def.template),id+' template ships');assert.ok(def.span>0&&def.rel>0);}
 assert.equal(fxIndex.effects.coinloop.loop,true);
 assert.ok(editorSource.includes("if (def.native === 'particle') fx = await fxParticle(op, ctx, part, def)"));
 assert.ok(editorSource.includes('const parts = await P.spineParts(systems, D)'));
});
