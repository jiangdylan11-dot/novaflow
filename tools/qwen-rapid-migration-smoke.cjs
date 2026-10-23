'use strict';
// Controlled comparison using the real pre-migration builders and runtime schemas.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const base = 'http://127.0.0.1:8188';
const checkpoint = 'Qwen-Rapid-AIO-NSFW-v20.safetensors';
function loadSpine(file) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  // A one-line function ("function f() { return x }") closes on its own line; only a multi-line
  // body runs to the next two-space "}".
  const declarations = [...source.matchAll(/^  (?:async )?function \w+\([^\n]*\) \{(?:[^\n]*\}[ \t]*\r?$|[\s\S]*?^  \})/gm)].map(m => m[0]).join('\n');
  const constants = source.slice(source.indexOf('  const IMAGE_ANGLE_ADJUST_TIMEOUT_MS'), source.indexOf('  const SPLIT_MODE_DIALOG_ID'));
  const routeConstants = [...source.matchAll(/^  const ((?:SELECTION_INPAINT_MODE_)[A-Z_]+) = [\s\S]*?(?=^  (?:const |let |(?:async )?function ))/gm)].map(m=>m[0]).join('\n');
  const sandbox = { state: {}, console };
  sandbox.window=sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root,'novaflow-web/renderer/qwen21-turbo.workflow.js'),'utf8'),sandbox);
  const checkpointConstant = source.includes('const QWEN_RAPID_CHECKPOINT =') ? 'QWEN_RAPID_CHECKPOINT' : 'IMAGE_WASH_QWEN_CHECKPOINT';
  vm.runInContext('const IMAGE_OUTPAINT_SAFE_DIMENSION_STEP = 8; const '+checkpointConstant+' = '+JSON.stringify(checkpoint)+';\n' + constants + '\n' + routeConstants + '\n' + declarations, sandbox);
  return sandbox;
}
function rapidCandidate(graph) {
  const out = structuredClone(graph), remap = new Map();
  const model = Object.entries(out).find(([,n]) => n.class_type === 'UNETLoader');
  if (!model) throw new Error('Expected one ordinary Qwen model');
  const id = model[0];
  out[id] = { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } };
  for (const [key,n] of Object.entries(out)) {
    if (n.class_type === 'CLIPLoader') remap.set(key, [id,1]);
    if (n.class_type === 'VAELoader') remap.set(key, [id,2]);
    if (['ModelSamplingAuraFlow','CFGNorm'].includes(n.class_type) || n.class_type === 'LoraLoaderModelOnly' && /lightning/i.test(n.inputs.lora_name)) remap.set(key,n.inputs.model);
  }
  const resolve = v => Array.isArray(v) && remap.has(String(v[0])) ? resolve(remap.get(String(v[0]))) : v;
  for (const n of Object.values(out)) {
    for (const key of Object.keys(n.inputs)) n.inputs[key] = resolve(n.inputs[key]);
    if (n.class_type === 'KSampler') Object.assign(n.inputs, { steps:6, cfg:1, sampler_name:'euler_ancestral', scheduler:'beta' });
  }
  for (const key of remap.keys()) delete out[key];
  return out;
}
async function json(route,options) {
  const r = await fetch(base+route,{...options,signal:AbortSignal.timeout(30000)});
  const value = await r.json(); if (!r.ok) throw new Error(JSON.stringify(value)); return value;
}
async function upload(file) {
  const f = new FormData(); f.append('image',new Blob([fs.readFileSync(path.join(root,file))],{type:'image/png'}),path.basename(file)); f.append('overwrite','true');
  const r = await json('/upload/image',{method:'POST',body:f}); return r.subfolder ? r.subfolder+'/'+r.name : r.name;
}
async function main() {
  const q = await json('/queue'); if(q.queue_running.length || q.queue_pending.length) throw new Error('Runtime busy; leave user queue intact.');
  const info = await json('/object_info'); fs.writeFileSync(path.join(root,'.tmp-rapid-object-info.json'),JSON.stringify(info));
  const s = loadSpine('.tmp-rapid-baseline-spine-split-runtime.js');
  const scene = await upload('.tmp-rapid-scene.png'), placement = await upload('.tmp-rapid-placement.png'), reference = await upload('.tmp-rapid-reference.png'), sheet = await upload('.tmp-rapid-sheet.png');
  const localModule = {exports:{}}; new Function('module',fs.readFileSync(path.join(root,'.tmp-rapid-baseline-aifx-local.workflow.js'),'utf8'))(localModule);
  const graphs = {
    outpaint: s.buildQwenImageOutpaintWorkflow(info,scene,'rapid_audit_outpaint',{left:128,right:128,top:0,bottom:0}),
    transfer: s.buildObjectTransferQwenWorkflow(info,{placementName:placement,referenceName:reference},'rapid_audit_transfer',s.resolveObjectTransferQwenRuntime(info)),
    angle: s.buildImageAngleAdjustWorkflow(info,reference,{horizontalAngle:90,verticalAngle:15,zoom:4.3}),
    aifx: localModule.exports.buildWorkflow({objectInfo:info,sheetImageName:sheet,styleImageName:reference,width:512,height:512,seed:9122026,prompt:'A golden magical burst, exactly four cells in a 2 by 2 sprite sheet. Black background.'}).workflow
  };
  const evidencePath = path.join(root,'docs/qwen-rapid-comparison-live-2026-09-12.json');
  const evidence = fs.existsSync(evidencePath) ? JSON.parse(fs.readFileSync(evidencePath)) : [];
  for(const family of ['ordinary','rapid']) for(const [feature,baseline] of Object.entries(graphs)) {
    if (process.env.NF_RAPID_CASE && !process.env.NF_RAPID_CASE.split(',').includes(feature)) continue;
    const caseTag = process.env.NF_RAPID_TAG || 'initial';
    if(evidence.some(x=>x.feature===feature&&x.family===family&&(x.caseTag || 'initial')===caseTag&&x.status?.status_str==='success')) continue;
    const graph = family==='rapid' ? rapidCandidate(baseline) : structuredClone(baseline);
    for(const n of Object.values(graph)) {
      if(n.class_type==='KSampler') n.inputs.seed=9122026;
      if(n.class_type==='SaveImage') n.inputs.filename_prefix='NovaFlow_validation/rapid_'+feature+'_'+family;
    }
    fs.writeFileSync(path.join(root,`.tmp-rapid-${feature}-${family}.json`),JSON.stringify(graph,null,2));
    const started = Date.now();
    const submit = await json('/prompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:graph,client_id:'nf-rapid-audit'})});
    console.log(JSON.stringify({feature,family,event:'submitted',prompt_id:submit.prompt_id}));
    let run;
    while(Date.now()-started < 20*60*1000) {
      run=(await json('/history/'+submit.prompt_id))[submit.prompt_id];
      if(run?.status?.completed||run?.status?.status_str==='error') break;
      await new Promise(r=>setTimeout(r,4000));
    }
    const item={feature,family,caseTag,prompt_id:submit.prompt_id,seconds:(Date.now()-started)/1000,status:run?.status,outputs:run?.outputs,files:[]};
    for(const output of Object.values(run?.outputs||{})) for(const img of output.images||[]) {
      const url=base+'/view?'+new URLSearchParams(img); const bytes=await (await fetch(url)).arrayBuffer();
      const file=`.tmp-rapid-${feature}-${family}${caseTag==='initial'?'':'-'+caseTag}.png`;fs.writeFileSync(path.join(root,file),Buffer.from(bytes));item.files.push(file);
    }
    evidence.push(item);fs.writeFileSync(evidencePath,JSON.stringify(evidence,null,2));
    console.log(JSON.stringify({feature,family,status:item.status?.status_str,seconds:item.seconds}));
    if(!run) throw new Error('Timed out; inspect pending prompt before restarting');
  }
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1});
module.exports={loadSpine,rapidCandidate};
