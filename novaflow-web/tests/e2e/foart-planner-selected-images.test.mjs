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
  const box={};vm.createContext(box);vm.runInContext(source.slice(source.indexOf('function turnSlot'),source.indexOf('function createQwenNodeRecheck'))+';this.slot=turnSlot;this.request=runRequest;',box);
  assert.deepEqual([1,2,3].map(n=>box.slot(n,2)),[0,1,-1],'a number past this turn\'s pictures names nothing');
  assert.equal(box.request('@参考图1换成@参考图3的风格，姿势照@参考图2',0,[2,1]),'@参考图1换成@参考图2的风格，姿势照@参考图3','a run\'s brief numbers its pictures as the page holds them');
  assert.equal(box.request('换成@参考图2的风格',-1,[1]),'换成@参考图2的风格','the remembered subject is not among the labels');
  assert.doesNotMatch(source,/renumberTurnMentions|turnLabels|planStyleRun|runStyle\b|styleExtras/,'no second numbering is guessed after send');
  // The composer's @ list: this message's attachments from 1 (they replace the page on send), else the page.
  const start=source.indexOf('const mentionResources=()=>{'),end=source.indexOf('const mountMentions');
  const page=[{name:'old1.png',dataUrl:'data:o1'},{name:'old2.png',dataUrl:'data:o2'},null,{name:'old3.png',dataUrl:'data:o3'}];
  const list=staged=>{const scope={root:{__NovaFlowArtGenerate:{references:()=>page}},controller:{state:{staged}}};vm.createContext(scope);
    return plain(vm.runInContext(source.slice(start,end).replace('const mentionResources=','')+';',scope)()).map(row=>row.key+':'+row.fileName);};
  assert.deepEqual(list([]),['art_reference_1:old1.png','art_reference_2:old2.png','art_reference_3:old3.png']);
  assert.deepEqual(list([{id:'up-4',kind:'image',name:'photo.jpg',previewUrl:'data:p'},{id:'up-5',kind:'audio',name:'a.mp3'},{id:'up-6',kind:'image',name:'style.png',previewUrl:'data:s'}]),
    ['art_reference_1:photo.jpg','art_reference_2:style.png'],'the screenshot case: two new pictures are 参考图1 and 参考图2, not 4 and 5');
});

test('each run puts the subject and its own pictures on the page, in the brain\'s roles',async()=>{
  const source=readFileSync(new URL('../../renderer/xiaotao-art-agent.js',import.meta.url),'utf8');
  const start=source.indexOf('async function runImageRuns'),end=source.indexOf('async function prepareQwenCurrentDrawingPrompt');
  const seen=[];let page=[{name:'a',file:{n:'a'}},{name:'b',file:{n:'b'}},{name:'c',file:{n:'c'}}];
  const rt={references:()=>page,setReference(index,value){page[index]=value;},refreshReferences(){}};
  const box={root:{__NovaFlowArtGenerate:rt,URL:{createObjectURL:file=>'blob:'+file.n}},state:{},notify(){},currentSubject:{name:'photo',file:{n:'photo'}},
    async plannerDrawingPrompt(op,message,options){seen.push([page.filter(Boolean).map(ref=>ref.name+':'+ref.drawingRole+':'+ref.dataUrl).join(),op.useResult,message,options.rolesSet]);return {action:'image_generate',phase:'completed',outputs:[{id:String(seen.length)}],message:'done'};}};
  vm.createContext(box);vm.runInContext(source.slice(source.indexOf('function runRequest'),source.indexOf('const pageLimitQuestion='))+'var run='+source.slice(start,end).trim().replace(/^async function runImageRuns/,'async function'),box);
  const styles=(count,subjectSlot=-1)=>Object.fromEntries(Array.from({length:count},(_,i)=>[i,i===subjectSlot?'subject':'style']));
  const receipt=await box.run({subjectSlot:-1,roles:styles(3),runs:[0,1,2].map(slot=>({slots:[slot],prompt:'换成@参考图'+(slot+1)+'的风格'})),prompt:'换成这张的风格'});
  assert.deepEqual(seen.map(row=>row[0]),['photo:subject:blob:photo,a:style:blob:a','photo:subject:blob:photo,b:style:blob:b','photo:subject:blob:photo,c:style:blob:c']);
  assert.ok(seen.every(row=>row[1]===false&&row[2]==='换成@参考图2的风格'&&row[3]===true),'each run\'s brief points at its own picture');
  assert.equal(receipt.message,'已按要求分 3 次生成 3 张');assert.equal(receipt.outputs.length,3);
  assert.deepEqual(page.filter(Boolean).map(ref=>ref.name+':'+ref.drawingRole),['photo:subject','c:style'],'the page shows what the last run used, not every picture at once');
  seen.length=0;page=[{name:'p',file:{n:'p'}},{name:'s1',file:{n:'s1'}},{name:'s2',file:{n:'s2'}}];
  const split=await box.run({subjectSlot:0,roles:styles(3,0),runs:[{slots:[1],prompt:''},{slots:[2],prompt:''}],prompt:'@参考图1换成@参考图2的风格，人物姿势不变'});
  assert.deepEqual(seen.map(row=>row[0]),['p:subject:blob:p,s1:style:blob:s1','p:subject:blob:p,s2:style:blob:s2'],'the subject named in the sentence is used');
  assert.ok(seen.every(row=>row[2]==='@参考图1换成@参考图2的风格，人物姿势不变'),'the brief reaches every run');
  assert.equal(split.message,'已按要求分 2 次生成 2 张');assert.deepEqual(page.filter(Boolean).map(ref=>ref.name),['p','s2']);
  seen.length=0;page=[{name:'p',file:{n:'p'}},{name:'s1',file:{n:'s1'}},{name:'s2',file:{n:'s2'}}];
  await box.run({subjectSlot:0,roles:{0:'subject',1:'style',2:'pose'},runs:[{slots:[1,2],prompt:''}],prompt:'@参考图1换成@参考图2的风格，姿势照@参考图3'});
  assert.deepEqual(seen.map(row=>row[0]),['p:subject:blob:p,s1:style:blob:s1,s2:pose:blob:s2'],'one run with a style and a pose picture, each in its role');
  assert.equal(seen[0][2],'@参考图1换成@参考图2的风格，姿势照@参考图3');
  // Dylan's case: the page still holds the last turn's 图1/图2; the three pictures he sent are the styles, whatever the page holds.
  seen.length=0;page=[{name:'old-subject',file:{n:'old-subject'}},{name:'old-style',file:{n:'old-style'}}];
  const sent=['s1','s2','s3'].map(n=>({name:n,file:{n},source:'xiaotao-upload'}));
  const turn=await box.run({subjectSlot:-1,roles:styles(3),runs:[0,1,2].map(slot=>({slots:[slot],prompt:''})),prompt:'换成这张的风格',pictures:sent});
  assert.deepEqual(seen.map(row=>row[0]),['photo:subject:blob:photo,s1:style:blob:s1','photo:subject:blob:photo,s2:style:blob:s2','photo:subject:blob:photo,s3:style:blob:s3'],'each sent style runs once with the remembered subject');
  assert.equal(turn.outputs.length,3);
  assert.match(source,/if\(newConversation\)\{reset\(\);lastUploads=\[\];currentSubject=null;/);
  assert.match(source,/imageRunPlans\.set\(single,\{\.\.\.imageRuns,pictures:turnImages\.length\?/,'run details stay off the plan, which is validated again before each step');
});

test('one style picture failing does not drop the others; all failing or a stop is an error',async()=>{
  const source=readFileSync(new URL('../../renderer/xiaotao-art-agent.js',import.meta.url),'utf8');
  const start=source.indexOf('async function runImageRuns'),end=source.indexOf('async function prepareQwenCurrentDrawingPrompt');
  const make=fails=>{
    let page=[{name:'a',file:{n:'a'}},{name:'b',file:{n:'b'}},{name:'c',file:{n:'c'}}],calls=0;
    const rt={references:()=>page,setReference(index,value){page[index]=value;},refreshReferences(){}};
    const box={root:{__NovaFlowArtGenerate:rt,URL:{createObjectURL:file=>'blob:'+file.n}},state:{},notify(){},currentSubject:{name:'photo',file:{n:'photo'}},
      async plannerDrawingPrompt(){calls++;if(fails(calls))throw Error('在线模型这次没有返回结果');return {action:'image_generate',phase:'completed',outputs:[{id:String(calls)}],message:'done'};}};
    vm.createContext(box);vm.runInContext(source.slice(source.indexOf('function runRequest'),source.indexOf('const pageLimitQuestion='))+'var run='+source.slice(start,end).trim().replace(/^async function runImageRuns/,'async function'),box);
    return {box,calls:()=>calls,page:()=>page};
  };
  const partial=make(n=>n===2);
  const three={subjectSlot:-1,roles:{0:'style',1:'style',2:'style'},runs:[0,1,2].map(slot=>({slots:[slot],prompt:''})),prompt:'换成这张的风格'};
  const receipt=await partial.box.run(three);
  assert.equal(partial.calls(),3,'the third picture still runs after the second fails');
  assert.equal(receipt.outputs.map(o=>o.id).join(),'1,3');
  assert.equal(receipt.message,'已生成 2 张；未完成：第 2 次：在线模型这次没有返回结果');
  assert.equal(partial.page().filter(Boolean).map(ref=>ref.name).join(),'photo,c','the page shows the last run');
  const all=make(()=>true);
  await assert.rejects(all.box.run({...three,runs:three.runs.slice(0,2)}),/第 1 次：在线模型这次没有返回结果；第 2 次/);
  const stopped=make(n=>n===1);
  await assert.rejects(stopped.box.run({...three,runs:three.runs.slice(0,2)},{aborted:true}),/已停止/);
  assert.equal(stopped.calls(),0);
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

test('a message\'s pictures replace the 图生图 references even when it says 作为风格参考',()=>{
  const source=readFileSync(new URL('../../renderer/xiaotao-upload.js',import.meta.url),'utf8');
  const box={window:{},document:{}};box.globalThis=box;box.self=box;vm.createContext(box);vm.runInContext(source,box);
  const api=box.window.NovaFlowXiaotaoUpload||box.NovaFlowXiaotaoUpload;
  const images=['s1.png','s2.webp','s3.png'].map(name=>({kind:'image',name,status:'ready'}));
  for(const text of ['用这3张图作为风格参考，再各自生成一次','把这几张放进图生图参考','用这几张图生图']){
    const place=api.planRoutes(text,images).place.filter(item=>item.destination.id==='img2img');
    assert.deepEqual(plain(place.map(item=>[item.name,item.replaceReferences,item.referenceIndex])),[['s1.png',true,0],['s2.webp',true,1],['s3.png',true,2]],text);
  }
});

test('the online brain reads the request before any 图生图 picture is placed',()=>{
  const source=readFileSync(new URL('../../renderer/xiaotao-art-agent.js',import.meta.url),'utf8');
  // The upload step keeps 图生图 pictures aside for a tool turn; nothing is put on the page before the plan.
  assert.match(source,/deferredDrawing = deferDrawing \? plan\.place\.filter\(item => item\.destination\?\.id === 'img2img'\) : \[\];/);
  assert.match(source,/if\(deferredDrawing\.includes\(item\)\)continue;/);
  assert.match(source,/deferDrawing=operationGeneral;\r?\n\s*if \(!\(await ensureStaged\(\)\)\) return false;/);
  // A style run never places them all: it places subject + one style per run. A plain 图生图 step places them just before it runs.
  assert.match(source,/if\(imageRunPlans\.has\(op\)\)\{drawingPending\.length=0;receipt=await runImageRuns/);
  assert.match(source,/if\(op\.generationMode!=='txt2img'&&op\.useResult!==true\)await placeDrawingPending\(\);/);
});
