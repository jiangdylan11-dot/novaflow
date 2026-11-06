import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const png=id=>'data:image/png;base64,'+Buffer.from('synthetic-'+id).toString('base64');
function fixture(){
  const refs=[],state={provider:'local',mode:'img2img',prompt:'original'};
  let selected={id:'result',imageUrl:png('result')};
  const rt={state,selectedResult:()=>selected,references:()=>refs,captureContext:()=>({generationSurface:'drawing'}),referenceLimit:()=>3};
  const root={setTimeout,document:{querySelector:()=>null,querySelectorAll:()=>[],body:{classList:{contains:()=>false},getAttribute:()=>null}},__NovaFlowArtGenerate:rt,NovaFlowSpineSplitBridge:{getState:()=>({})}};
  vm.createContext(root);
  vm.runInContext(readFileSync(new URL('../../renderer/foart-tool-contract.js',import.meta.url),'utf8'),root);
  vm.runInContext(readFileSync(new URL('../../renderer/xiaotao-foart-tools.js',import.meta.url),'utf8'),root);
  return {root,rt,refs,setSelected:value=>{selected=value;}};
}
const plain=value=>JSON.parse(JSON.stringify(value));

test('mentions follow this turn\'s pictures',()=>{
  const source=readFileSync(new URL('../../renderer/xiaotao-art-agent.js',import.meta.url),'utf8');
  const start=source.indexOf('function renumberTurnMentions'),end=source.indexOf('function createQwenNodeRecheck');
  const box={};vm.createContext(box);vm.runInContext(source.slice(start,end)+';this.renumber=renumberTurnMentions;this.styleOnly=styleOnlyRequest;this.subjectSlot=turnSubjectSlot;this.extras=styleExtras;',box);
  const first='@参考图1换成@参考图2的风格，人物姿势不变',second='分别用@参考图3@参考图4@参考图5各自生成一张';
  assert.equal(box.renumber(second,3),'分别用@参考图1@参考图2@参考图3各自生成一张');
  assert.equal(box.renumber('把<image4>换成<image5>的风格',2),'把<image1>换成<image2>的风格');
  assert.equal(box.renumber(first,2),first,'numbers already on the page stay');
  assert.equal(box.renumber('@参考图3和@参考图4',1),'@参考图3和@参考图4','more names than pictures are left for the page to report');
  assert.equal(box.styleOnly(first,2),false,'the first sentence brings its own subject');
  assert.equal(box.styleOnly(second,3),true,'the second brings only style pictures');
  assert.equal(box.styleOnly('换成@参考图3的风格',1),true);
  assert.equal(box.styleOnly('把@参考图1分别转成@参考图2@参考图3的风格',3),false,'a named subject stays in charge');
  assert.equal(box.styleOnly('各自生成一张',1),false);
  assert.equal(box.styleOnly('用@参考图1的风格画一只猫',1),false);
  assert.equal(box.subjectSlot('把@参考图1分别转成@参考图2@参考图3的风格',3),0);
  assert.equal(box.subjectSlot('@参考图2是主体，分别用@参考图1和@参考图3的风格',3),1);
  assert.equal(box.subjectSlot('把@参考图1转成@参考图2@参考图3的风格',3),-1,'without 分别 it stays one run');
  assert.equal(box.subjectSlot('把@参考图1分别转成@参考图2的风格',2),-1,'one style picture needs no split');
  assert.equal(box.extras('分别用@参考图3@参考图4@参考图5各自生成一张，人物姿势不变，背景改成海边'),'人物姿势不变，背景改成海边');
  assert.equal(box.extras(second),'');
});

test('each style picture runs on the remembered subject, in turn, and the page is put back',async()=>{
  const source=readFileSync(new URL('../../renderer/xiaotao-art-agent.js',import.meta.url),'utf8');
  const start=source.indexOf('async function runEachStyle'),end=source.indexOf('async function prepareQwenCurrentDrawingPrompt');
  const seen=[];let page=[{name:'a',file:{n:'a'}},{name:'b',file:{n:'b'}},{name:'c',file:{n:'c'}}];
  const rt={references:()=>page,setReference(index,value){page[index]=value;},refreshReferences(){}};
  const box={root:{__NovaFlowArtGenerate:rt,URL:{createObjectURL:file=>'blob:'+file.n}},state:{},notify(){},currentSubject:{name:'photo',file:{n:'photo'}},
    async plannerDrawingPrompt(op,message){seen.push([page.filter(Boolean).map(ref=>ref.name+':'+ref.drawingRole+':'+ref.dataUrl).join(),op.useResult,message]);return {action:'image_generate',phase:'completed',outputs:[{id:String(seen.length)}]};}};
  vm.createContext(box);vm.runInContext(source.slice(source.indexOf('function styleExtras'),source.indexOf('function createQwenNodeRecheck')),box);
  vm.runInContext('var run='+source.slice(start,end).trim().replace(/^async function runEachStyle/,'async function'),box);
  const receipt=await box.run();
  assert.deepEqual(seen.map(row=>row[0]),['photo:subject:blob:photo,a:style:blob:a','photo:subject:blob:photo,b:style:blob:b','photo:subject:blob:photo,c:style:blob:c']);
  assert.ok(seen.every(row=>row[1]===false&&row[2]==='@参考图1换成@参考图2的风格'));
  assert.equal(receipt.message,'已按 3 张风格图各生成一张');assert.equal(receipt.outputs.length,3);
  assert.deepEqual(page.filter(Boolean).map(ref=>ref.name),['a','b','c'],'the page ends as this turn left it');
  seen.length=0;page=[{name:'p',file:{n:'p'}},{name:'s1',file:{n:'s1'}},{name:'s2',file:{n:'s2'}}];
  const split=await box.run('把@参考图1分别转成@参考图2@参考图3的风格，人物姿势不变',0);
  assert.deepEqual(seen.map(row=>row[0]),['p:subject:blob:p,s1:style:blob:s1','p:subject:blob:p,s2:style:blob:s2'],'the subject named in the sentence is used');
  assert.ok(seen.every(row=>row[2]==='@参考图1换成@参考图2的风格，人物姿势不变'),'extra wishes reach every run');
  assert.equal(split.message,'已按 2 张风格图各生成一张');assert.deepEqual(page.filter(Boolean).map(ref=>ref.name),['p','s1','s2']);
  assert.match(source,/if\(styleOnly&&!currentSubject\)plan=\{\.\.\.plan,status:'clarify'/,'no subject asks for one');
  assert.match(source,/if\(newConversation\)\{reset\(\);lastUploads=\[\];currentSubject=null;/);
});

test('a request naming both pictures as style still leaves one subject',()=>{
  const source=readFileSync(new URL('../../renderer/xiaotao-art-agent.js',import.meta.url),'utf8');
  const start=source.indexOf('function styleSlots'),end=source.indexOf('function createQwenNodeRecheck');
  const box={};vm.createContext(box);vm.runInContext(source.slice(start,end)+';this.slots=(m,n)=>[...styleSlots(m,n)];',box);
  assert.deepEqual(plain(box.slots('@参考图1的风格换成@参考图2的风格，人物姿势不变',2)),[1]);
  assert.deepEqual(plain(box.slots('图2的风格换成图1的风格',2)),[0]);
  assert.deepEqual(plain(box.slots('用图2的风格重绘图1',2)),[1]);
  assert.deepEqual(plain(box.slots('换个风格',2)),[1]);
  assert.deepEqual(plain(box.slots('图2和图3的风格都用上',3)),[2]);
});

test('pictures attached this turn are never replaced by a previous result',()=>{
  const source=readFileSync(new URL('../../renderer/xiaotao-art-agent.js',import.meta.url),'utf8');
  const start=source.indexOf('function keepTurnPictures'),end=source.indexOf('function createQwenNodeRecheck');
  const box={};vm.createContext(box);vm.runInContext(source.slice(start,end)+';this.keep=keepTurnPictures;',box);
  assert.equal(box.keep({action:'use_result'}),null);
  assert.deepEqual(plain(box.keep({action:'image_optimize',prompt:'p',generationMode:'img2img',useResult:true})),{action:'image_optimize',prompt:'p',generationMode:'img2img',useResult:false});
  const untouched={action:'image_generate',prompt:'p',generationMode:'img2img',useResult:false};assert.equal(box.keep(untouched),untouched);
  assert.match(source,/\(preferUploads\|\|lastUploads\.some\(item=>item\.kind==='image'\)\)&&!generatedKinds\.has\('image_generate'\)/,'a picture made earlier this turn can still be revised');
  const contract=readFileSync(new URL('../../renderer/foart-tool-contract.js',import.meta.url),'utf8');
  assert.ok(contract.includes('If the user attached reference images in this turn, useResult must be false'));
});

test('planner uses all selected drawing references in slot order instead of displacing the third with a result',async()=>{
  const f=fixture();f.refs.push({drawingRole:'subject',dataUrl:png(1)},{drawingRole:'style',dataUrl:png(2)},{drawingRole:'pose',dataUrl:png(3)});
  const images=await f.root.NovaFlowFoartTools.images();
  assert.deepEqual(plain(images.map(({role,dataUrl})=>({role,dataUrl}))),[{role:'subject',dataUrl:png(1)},{role:'style',dataUrl:png(2)},{role:'pose',dataUrl:png(3)}]);
});

test('all native drawing roles and auto are preserved; unusable, conflicting and sparse slots fail closed',async()=>{
  for(const role of ['subject','style','pose','background','material','color','composition','lighting','object','auto']){
    const f=fixture();f.refs.push({drawingRole:role,dataUrl:png(role)});
    const images=await f.root.NovaFlowFoartTools.images();assert.equal(images[0].role,role==='auto'?'reference':role);
  }
  for(const refs of [[{drawingRole:'none',dataUrl:png(1)}],[{drawingRole:'subject',role:'style',dataUrl:png(1)}],[null,{drawingRole:'style',dataUrl:png(1)}],Array.from({length:4},(_,i)=>({drawingRole:'subject',dataUrl:png(i)}))]){
    const f=fixture();f.refs.push(...refs);await assert.rejects(f.root.NovaFlowFoartTools.images());
  }
});

test('reference role changes during byte read abort; capture includes roles but no image bytes',async()=>{
  const f=fixture();f.refs.push({drawingRole:'subject',dataUrl:'blob:synthetic'});
  const before=plain(f.root.NovaFlowFoartTools.capture());assert.equal(before.art.references[0].drawingRole,'subject');assert.equal(before.art.references[0].role,null);assert.equal(JSON.stringify(before).includes('blob:synthetic'),false);
  f.root.resolveReferenceDataUrl=async()=>{f.refs[0].drawingRole='style';return png(1);};
  await assert.rejects(f.root.NovaFlowFoartTools.images());
  const after=plain(f.root.NovaFlowFoartTools.capture());assert.equal(after.art.references[0].drawingRole,'style');assert.notDeepEqual(after.art.references,before.art.references);
});

test('additional explicit uploads never displace references; unselected fallback still uses result',async()=>{
  const f=fixture();f.refs.push({drawingRole:'subject',dataUrl:png(1)},{drawingRole:'style',dataUrl:png(2)},{drawingRole:'pose',dataUrl:png(3)});
  f.root.NovaFlowFoartTools.setUploads([{kind:'image',name:'extra',dataUrl:png('extra')}]);
  await assert.rejects(f.root.NovaFlowFoartTools.images({preferUploads:true}));
  const empty=fixture();const result=await empty.root.NovaFlowFoartTools.images();assert.equal(result.length,1);assert.equal(result[0].dataUrl,png('result'));
});
