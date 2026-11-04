import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {FOART_TOOL_SCHEMA,validateFoartPlan} from '../../packages/shared/src/foart-tool-plan.mjs';
const source=await readFile(new URL('../../renderer/spine-skeleton-editor.js',import.meta.url),'utf8');
test('assistant animation export uses the original selected-project exporter and writer, without a fabricated directory',async()=>{
  const calls=[],files=[],src={bones:[{name:'root'}],animations:{idle:{bones:{root:{rotate:[{angle:3}]}}}}};let picks=0;
  const sandbox={mediaExportPlans:()=>[{name:'甲',entries:[{src}]},{name:'乙',entries:[{src}]}],pickDirectory:async()=>{picks++;return {name:'real user directory'}},window:{NovaFlowSequenceAtlas:{createFileWriter:({handle})=>{assert.equal(handle.name,'real user directory');return (name,bytes)=>files.push({name,bytes})}}},atlasSettings:()=>({paddingX:2}),status(){},exportProject:async(opts,write)=>{calls.push(opts);await write(opts.name+'.json',new TextEncoder().encode(JSON.stringify(opts.project)));return {missing:[],images:1}}};
  vm.createContext(sandbox);const begin=source.indexOf('  async function exportSelectedProjects('),end=source.indexOf('  function createMediaRenderer(',begin);vm.runInContext(source.slice(begin,end),sandbox);
  const before=JSON.stringify(src);const result=await sandbox.exportSelectedProjects({version:'4.2',packed:false,skel:false,write:(name,bytes)=>files.push({name,bytes})});
  assert.equal(picks,0);assert.equal(result.projects.length,2);assert.deepEqual(files.map(f=>f.name),['甲/甲.json','乙/乙.json']);assert.equal(calls[0].version,'4.2');assert.equal(calls[0].packed,false);assert.equal(calls[0].exactBaseName,true);assert.equal(JSON.stringify(src),before);
  await sandbox.exportSelectedProjects({});assert.equal(picks,1,'The normal manual exporter still uses its real directory picker');
  sandbox.exportProject=async()=>({missing:['missing.png']});await assert.rejects(sandbox.exportSelectedProjects({write(){}}),/缺少图片/);
});
test('animation export contract preserves checked projects, native formats and transparency limits',()=>{
  const context={schema:FOART_TOOL_SCHEMA,controls:[],animation:{active:true,loaded:true,exportProjects:[{name:'甲',exported:true}]}};
  const plan=operation=>({schema:FOART_TOOL_SCHEMA,status:'act',reply:'按原生导出',operations:[{action:'animation',...operation}]});
  for(const op of [{operation:'export_project',format:'json',version:'4.2',packed:true},{operation:'export_project',format:'skel'},{operation:'export_media',kind:'sequence',transparent:true},{operation:'export_media',kind:'video',format:'webm',transparent:true}])assert.doesNotThrow(()=>validateFoartPlan(plan(op),context));
  for(const op of [{operation:'export_project',format:'exe'},{operation:'export_media',kind:'video',format:'mp4',transparent:true},{operation:'export_media',kind:'sequence',format:'mp4'}])assert.throws(()=>validateFoartPlan(plan(op),context));
  assert.throws(()=>validateFoartPlan(plan({operation:'export_project'}),{...context,animation:{...context.animation,exportProjects:[]}}));
});
