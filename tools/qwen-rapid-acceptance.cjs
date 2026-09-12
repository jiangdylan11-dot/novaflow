'use strict';
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {loadSpine}=require('./qwen-rapid-migration-smoke.cjs');
const root=path.resolve(__dirname,'..');
const read=n=>fs.readFileSync(path.join(root,'particle-editor',n),'utf8');
function loadArt(){
 const s={console,URLSearchParams}; s.window=s;s.globalThis=s;vm.createContext(s);
 for(const f of ['art-generate-model.resource.js','art-generate-lora.js','ui-design-local-resolution.helper.js','ui-design-local.workflow.js','ui-design-local-refine.workflow.js','art-generate-provider.workflow.js','art-generate-ideogram.workflow.js'])vm.runInContext(read(f),s);
 const source=read('novaflow-brand-runtime.js');
 const templates=source.slice(source.indexOf('const ART_GENERATE_WORKFLOW_TEMPLATES ='),source.indexOf('const ART_GENERATE_STATE ='));
 const functions=[...source.matchAll(/^  (?:async )?function \w+\([^\n]*\) \{[\s\S]*?^  \}/gm)].map(m=>m[0]).join('\n');
 vm.runInContext(templates+'\nconst ART_GENERATE_STATE={provider:"local",mode:"img2img",nsfw:false,width:512,height:512,seed:9122026,randomSeed:false};\n'+functions,s);
 return s;
}
function graphs(info){
 const s=loadArt();
 const state={provider:'local',mode:'img2img',nsfw:false,width:512,height:512,seed:9122026,randomSeed:false,localEditStrength:'faithful',loras:[{name:'qwen\\HQL0.2.safetensors',strength:.35}]};
 const refs=['.tmp-rapid-scene.png','.tmp-rapid-reference.png'];
 const args=['local','img2img',refs,'NovaFlow_validation/rapid_art','Change only the roof to blue. Keep the house, landscape and positions unchanged.','blurry, distorted','rapid-accept',[{width:512,height:512},{width:512,height:512}],state];
 const art=s.buildArtGenerateRunWorkflow(...args);
 const ui=s.buildArtGenerateRunWorkflow(...args,undefined,{taskProfile:'ui-design',referenceRoles:[{role:'reference',name:refs[0],autoPrimary:true},{role:'ui_layout',name:refs[1]}],layoutGuideEncoding:'soft-ui-semantic-scaffold-v2'});
 const inpaint={exports:{}};new Function('module',read('split-inpaint-nsfw.workflow.js'))(inpaint);
 const aifx={exports:{}};new Function('module',read('aifx-local.workflow.js'))(aifx);
 const out={art:art.workflow,ui:ui.workflow};
 for(const mode of ['edit','completion'])out[mode]=inpaint.exports.buildWorkflow({runtimeInfo:info,mode,imageName:refs[0],maskName:'.tmp-rapid-transfer-mask.png',prefix:'NovaFlow_validation/rapid_'+mode,prompt:mode==='edit'?'Add a small red wooden chair in the selected region.':'Fill the selected area naturally. Continue the grass and landscape.',seed:9122026});
 out['edit-roof']=inpaint.exports.buildWorkflow({runtimeInfo:info,mode:'edit',imageName:'.tmp-rapid-edit-crop.png',maskName:'.tmp-rapid-roof-mask.png',prefix:'NovaFlow_validation/rapid_edit_roof',prompt:'Change the red roof to blue. Preserve the shape of the roof, chimney, house and background.',seed:9122026});
 out['completion-roof']=inpaint.exports.buildWorkflow({runtimeInfo:info,mode:'completion',imageName:'.tmp-rapid-hole-crop.png',maskName:'.tmp-rapid-hole-mask.png',prefix:'NovaFlow_validation/rapid_completion_roof',prompt:'Repair the missing red roof. Replace the grey rectangular hole with the same continuous solid red roof.',seed:9122026});
 out['aifx-tail']=aifx.exports.buildWorkflow({objectInfo:info,sheetImageName:'.tmp-rapid-sheet.png',styleImageName:refs[1],width:512,height:512,seed:9122026,anchorRole:'dissipation',anchorFrame:{index:3,phase:'dissipation'},materialReferenceMode:'generated-peak-material-token',promptsPrecompiled:true,structurePrompt:'Create one isolated dissipation VFX frame on black with sparse small broken sparks. Preserve the motion anchors.',stylePrompt:'Golden luminous magical particles, no solid object, sparse fading sparks. Image 1 supplies material texture only.',prompt:'A sparse golden magical burst fading to tiny sparks on black.'}).workflow;
 return out;
}
async function json(route,options){const r=await fetch('http://127.0.0.1:8188'+route,options);const x=await r.json();if(!r.ok)throw new Error(JSON.stringify(x));return x;}
async function main(){
 const info=await json('/object_info');const built=graphs(info);
 for(const [name,g]of Object.entries(built)){
  if(!g)throw new Error(name+' missing graph');
  if(/qwen_image_edit_2511_(bf16|fp8mixed)/.test(JSON.stringify(g)))throw new Error('Retired model in '+name);
  console.log(name,Object.keys(g).length,Object.values(g).filter(n=>n.class_type==='KSampler').map(n=>n.inputs.steps));
 }
 if(process.argv.includes('--build-only'))return;
 const form=new FormData();form.append('image',new Blob([fs.readFileSync('.tmp-rapid-transfer-mask.png')],{type:'image/png'}),'.tmp-rapid-transfer-mask.png');form.append('overwrite','true');await json('/upload/image',{method:'POST',body:form});
 for(const file of ['edit-crop','roof-mask','hole-crop','hole-mask']){const name='.tmp-rapid-'+file+'.png',f=new FormData();f.append('image',new Blob([fs.readFileSync(name)],{type:'image/png'}),name);f.append('overwrite','true');await json('/upload/image',{method:'POST',body:f});}
 const evidenceFile='docs/qwen-rapid-acceptance-live-2026-09-12.json';
 const evidence=fs.existsSync(evidenceFile)?JSON.parse(fs.readFileSync(evidenceFile)):[];
 for(const[name,g]of Object.entries(built)){
  if(process.env.NF_RAPID_CASE&&!process.env.NF_RAPID_CASE.split(',').includes(name))continue;
  if(evidence.some(x=>x.name===name&&x.status?.status_str==='success'))continue;
  const queue=await json('/queue');if(queue.queue_running.length||queue.queue_pending.length)throw new Error('Runtime busy');
  fs.writeFileSync('.tmp-rapid-accept-'+name+'.json',JSON.stringify(g,null,2));
  const start=Date.now();const submit=await json('/prompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:g,client_id:'nf-rapid-accept'})});
  console.log({name,prompt_id:submit.prompt_id,event:'submitted'});
  let run;
  while(Date.now()-start<20*60*1000){run=(await json('/history/'+submit.prompt_id))[submit.prompt_id];if(run?.status?.completed||run?.status?.status_str==='error')break;await new Promise(r=>setTimeout(r,4000));}
  const item={name,prompt_id:submit.prompt_id,seconds:(Date.now()-start)/1000,status:run?.status,outputs:run?.outputs};
  for(const output of Object.values(run?.outputs||{}))for(const img of output.images||[]){const r=await fetch('http://127.0.0.1:8188/view?'+new URLSearchParams(img));fs.writeFileSync('.tmp-rapid-accept-'+name+'.png',Buffer.from(await r.arrayBuffer()));}
  evidence.push(item);fs.writeFileSync('docs/qwen-rapid-acceptance-live-2026-09-12.json',JSON.stringify(evidence,null,2));console.log({name,status:run?.status?.status_str,seconds:item.seconds});
  if(run?.status?.status_str!=='success')throw new Error(JSON.stringify(run?.status||'timeout'));
 }
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1});
module.exports={loadArt,graphs};
