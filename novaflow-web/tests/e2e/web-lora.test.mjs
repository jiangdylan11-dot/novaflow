import { approveComputeWorker } from '../helpers.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { startLocalControlPlane } from '../../control-local/src/server.mjs';
import { generateWorkerSecret } from '../../packages/shared/src/tokens.mjs';
import { createDomSandbox } from '../../worker/src/comfy/dom-shim.mjs';
import { commonLoraCatalog } from '../../packages/shared/src/lora-catalog.mjs';
let checks = 0;
function equal(a,b) { assert.deepEqual(a,b); checks++; }
const item = { name: 'minimax_h3/motion.safetensors', fingerprint: 's10-m123-h' + 'a'.repeat(64), modelFamily: 'fl2va', kind: 'standard', supportedSteps: null, strengthRange: { min: 0, max: 2 } };
const catalog = { version: 1, updated_at: new Date().toISOString(), h3: { ok:true, items:[item] }, qwen: {ok:true,items:[{name:'qwen/style.safetensors'}]}, qwen_nsfw:{ok:true,items:[]} };
equal(commonLoraCatalog([{detail:{lora_catalog:catalog}}],{kind:'h3',mode:'t2v'}).length,1);
equal(commonLoraCatalog([{detail:{lora_catalog:catalog}}, {detail:{lora_catalog:{...catalog,h3:{ok:true,items:[]}}}}],{kind:'h3'}).length,0);
assert.throws(()=>commonLoraCatalog([{detail:{}}],{kind:'qwen'}),/0.4.4/);checks++;
assert.throws(()=>commonLoraCatalog([{detail:{lora_catalog:{...catalog,updated_at:'invalid'}}}],{kind:'qwen'}),/过期/);checks++;
const ctx = await startLocalControlPlane({ port: 0 });
async function request(path, method='GET', body, token) {
  const res=await fetch(ctx.url+path,{method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:res.status,body:await res.json()};
}
try {
  const login=await request('/dev/login','POST',{email:'lora@novaflow.local',balance:0});
  const token=login.body.session.token;
  const worker=await request('/api/worker/register','POST',{worker_id:crypto.randomUUID(),worker_name:'lora-fixture',worker_secret:generateWorkerSecret(),hardware:{vram_mb:32000}},token);
  await approveComputeWorker(ctx.db,worker.body.worker.id);
  const wt=worker.body.workerToken;
  await request('/api/worker/models','POST',{models:['qwen-image-2511','minimax-h3'].map(model_id=>({model_id,status:'ready',detail:{lora_catalog:catalog,private_path:'C:/private'}}))},wt);
  equal((await request('/api/web/loras/qwen')).status,401);
  const qwen=await request('/api/web/loras/qwen?nsfw=false','GET',undefined,token);
  equal(qwen.status,200);equal(qwen.body.items[0].name,'qwen/style.safetensors');
  equal(JSON.stringify(qwen).includes('C:/private'),false);
  equal((await request('/api/web/loras/qwen?nsfw=true','GET',undefined,token)).body.items.length,0);
  equal((await request('/api/web/loras/h3?mode=t2v&steps=4','GET',undefined,token)).body.items[0].fingerprint,item.fingerprint);
  equal((await request('/api/web/loras/h3/validate','POST',{...item,mode:'t2v',steps:4,strength:0.6},token)).status,200);
  equal((await request('/api/web/loras/h3/validate','POST',{...item,fingerprint:'stale',mode:'t2v',strength:0.6},token)).status,400);
  equal((await request('/api/web/loras/h3?mode=wrong','GET',undefined,token)).status,400);
  const sandbox=createDomSandbox({Response,Request,Blob,FormData,NOVAFLOW_WEB_CONFIG:{controlUrl:ctx.url},fetch});
  sandbox.localStorage.setItem('novaflow_web_session_v1',JSON.stringify({token}));
  runInContext(await readFile(new URL('../../renderer/novaflow-web-runtime.js',import.meta.url),'utf8'),createContext(sandbox));
  equal((await sandbox.electronAPI.qwenLoraCatalog()).items.length,1);
  equal((await sandbox.electronAPI.minimaxH3LoraCatalog({mode:'t2v',steps:4})).items.length,1);
  equal((await sandbox.electronAPI.minimaxH3LoraValidate({...item,mode:'t2v',steps:4,strength:1})).item.name,item.name);
} finally { await new Promise(resolve => ctx.server.close(resolve)); await ctx.db.close(); }
console.log(checks+' passed, 0 failed: authenticated LoRA catalog, pool compatibility and Web bridge');
