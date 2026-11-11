import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
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
