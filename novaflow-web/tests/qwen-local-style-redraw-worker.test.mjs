import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createWorker} from '../worker/src/worker-core.mjs';
import {STYLE_NEGATIVE} from '../packages/shared/src/qwen21-native-rewrite.mjs';

const response=x=>new Response(JSON.stringify(x),{headers:{'content-type':'application/json'}});
const taskId='cccccccc-cccc-4ccc-8ccc-cccccccccccc',requestId='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const scope='qwen21-local-image-edit-v1',capability='qwen3.5-9b-heretic-qwen21-local-image-edit-v1';
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP8zwACTGCSAQANHQEDgslx/wAAAABJRU5ErkJggg==';
const answer={drawing:{genre:'flat_cel',line:'thin_uniform',shading:'two_step',highlight:'angular',hair:'ribbon',colour_layout:'flat',surface:'smooth'},hair_colour:'brown',
  light:{key:'soft',direction:'above',contrast:'medium',shadow:'cool',skin:'matte',hair_depth:'two'},style_description:'',mood_description:'bright midday',
  content_description:'A young woman with brown hair sits at a wooden desk in a bright room.',time_of_day:'midday',sun_visible:false,sky_visible:false};

test('a subject + style set on the local brain gets the shared style-redraw instructions and an assembled prompt',async()=>{
  const root=await mkdtemp(join(tmpdir(),'qwen-style-redraw-')),oldFetch=globalThis.fetch;let worker,sent=null,completed=null;
  const request={requestId,mode:'image-edit',images:[{role:'subject',dataUrl:png},{role:'style',dataUrl:png}],currentPrompt:'用图2的风格画图1',requirements:'',negativePrompt:'水印',promptContract:'qwen21-native-rewrite-v3'};
  const bytes=Buffer.from(JSON.stringify(request)),sha=createHash('sha256').update(bytes).digest('hex');
  const identity={id:'qwen35-heretic',verification:'server-weight-path'},policy={enabled:true,owner_enabled:true,sharing_enabled:false,sharing_scope:'pool',allowed_user_ids:[]};
  const assistant={status:()=>({qwenBusinessBridgeEnabled:true,qwen21NativeRewriteV3Enabled:true,qwenImageEditEnabled:true,localModels:[]}),
    async runForTask(_id,method,payload,ctx){assert.equal(method,'qwenImageEdit');sent=payload;assert.equal(await ctx.imageEditPhaseVerifier(ctx.imageEditActor,'before'),true);
      return {ok:true,data:{analysisBackend:'qwen-cpu',modelIdentity:identity,resourcesReleased:true,generationReady:true,styleAnswer:JSON.stringify(answer)}};}};
  globalThis.fetch=async(input,init={})=>{const url=new URL(String(input)),body=init.body?JSON.parse(init.body):{};
    if(url.port==='19091')return response(url.pathname==='/queue'?{queue_running:[],queue_pending:[]}:{system:{comfyui_version:'fixture'}});
    if(url.pathname==='/api/worker/register')return response({workerToken:'fixture',grantKey:'fixture',policy,worker:{}});
    if(url.pathname==='/api/worker/heartbeat')return response({policy,worker:{}});
    if(url.pathname==='/api/worker/claim')return response({task:{id:taskId,task_type:'prompt_assistant',model_id:capability,attempt_count:1,parameters:{action:'optimize-prompt',model_id:'qwen3.5-9b-heretic',assistant_tool_scope:scope,
      request_id:requestId,request_sha256:sha,request_bytes:bytes.length},references:[{name:'qwen21-local-image-edit-request.json',kind:'json',bytes:bytes.length}]}});
    if(url.pathname.endsWith('/qwen-foart-plan-verify'))return response({authorized:true,taskId,workerId:worker.identity.workerId,userId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sessionId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',scope,attempt:1,op:body.op,...(body.op==='upload'&&body.phase==='finish'?{digestBound:true,sha256:body.sha256,bytes:body.bytes}:{})});
    if(url.pathname.endsWith('/progress'))return response({ok:true,task:{id:taskId,status:body.status,assigned_worker_id:worker.identity.workerId,attempt_count:1}});
    if(url.pathname.endsWith('/complete')){completed=body;return response({ok:true,task:{id:taskId,status:'completed',assigned_worker_id:worker.identity.workerId,attempt_count:1}});}
    return response({ok:true});};
  worker=createWorker({controlUrl:'http://127.0.0.1:19092',comfyImageUrl:'http://127.0.0.1:19091',dataDir:root,configPath:join(root,'identity.json'),workflowDir:root,
    rendererDir:root,gatewayPort:0,gatewayHost:'127.0.0.1',publicEndpoint:'http://127.0.0.1:19093',tunnel:false,registrationProfile:'compute-only',localTasks:null,
    pollIntervalMs:3600000,heartbeatIntervalMs:3600000,qwenImageEditEnabled:true,promptAssistant:()=>assistant,logger:()=>{}});
  try{
    await worker.startSharing();worker.setComputeReady(true);
    const input=join(root,'tasks',taskId,'input');await mkdir(input,{recursive:true});await writeFile(join(input,'qwen21-local-image-edit-request.json'),bytes);
    await worker.claimAndRun();
    assert.match(sent.styleRedraw.system,/style redraw for Qwen Image 2\.1/);assert.equal(JSON.parse(sent.styleRedraw.user).task,'style-redraw');
    assert.ok(completed,'task completed');
    const result=JSON.parse(await readFile(join(root,'tasks',taskId,'output','qwen21-local-image-edit-result-1.json'),'utf8'));
    assert.equal(result.data.modelPromptPolicy,'qwen21-style-redraw-v1');assert.equal(result.data.modelPromptLanguage,'en');assert.equal(result.data.styleAnswer,undefined);
    assert.match(result.data.modelPrompt,/^Loosely based on <image1>/);assert.match(result.data.modelPrompt,/<image2>/);assert.match(result.data.modelPrompt,/brown hair/);
    assert.equal(result.data.negativePrompt,'水印, '+STYLE_NEGATIVE);
  } finally {await worker.stop().catch(()=>{});globalThis.fetch=oldFetch;await rm(root,{recursive:true,force:true});}
});
