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
