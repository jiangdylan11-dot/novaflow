import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createWorker,QWEN21_NATIVE_REWRITE_V3_CAPABILITY,qwen21NativeRewriteV3Advertisable} from '../worker/src/worker-core.mjs';
import {createControlPlane} from '../packages/shared/src/control-plane.mjs';

const user='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const node='cccccccc-cccc-4ccc-8ccc-cccccccccccc',secret='fixture-secret';
const encoded=Buffer.from(JSON.stringify({sub:user,exp:Math.floor(Date.now()/1000)+300})).toString('base64url');
const headers={authorization:'Bearer nfs_'+encoded+'.'+createHmac('sha256',secret).update(encoded).digest('base64url')};
const qwen={id:'qwen3.5-9b-heretic',enabled:true,configured:true,identityVerified:true,trial:{backend:'cpu',chat:true,images:true,tools:false,business:true}};

test('worker reports v3 only with explicit implementation attestation and verified business model',async()=>{
  let status={qwenBusinessBridgeEnabled:true,localModels:[qwen]};
  const worker=createWorker({controlUrl:'http://127.0.0.1:9',dataDir:'.',workflowDir:'.',configPath:'fixture',logger:()=>{},promptAssistant:{status:()=>status}});
  let models=await worker.reportModels();assert.equal(models.find(m=>m.model_id===QWEN21_NATIVE_REWRITE_V3_CAPABILITY),undefined);
  status={...status,qwen21NativeRewriteV3Enabled:true};
  models=await worker.reportModels();assert.equal(models.find(m=>m.model_id===QWEN21_NATIVE_REWRITE_V3_CAPABILITY).status,'ready');
  status={...status,localModels:[{...qwen,identityVerified:false}]};
  models=await worker.reportModels();assert.equal(models.find(m=>m.model_id===QWEN21_NATIVE_REWRITE_V3_CAPABILITY).status,'missing');
  status={...status,localModels:[qwen],qwen21NativeRewriteV3Enabled:false};
  models=await worker.reportModels();assert.equal(models.find(m=>m.model_id===QWEN21_NATIVE_REWRITE_V3_CAPABILITY).status,'missing');
  assert.equal(qwen21NativeRewriteV3Advertisable({qwen21NativeRewriteV3Enabled:'true',localModels:[qwen]}),false);
});

test('control plane only reveals readiness for the authenticated user’s selected enabled node',async()=>{
  let owner=user,enabled=true,ownerEnabled=true,ready=true;const queries=[];
  const store={getUserById:async()=>({id:user,plan:'pro',status:'active'}),
    getWorkerById:async id=>id===node?{id:node,owner_id:owner,enabled,owner_enabled:ownerEnabled}:null,
    countCapableWorkers:async(model,_vram,_timeout,target,_premium,queryUser,shared)=>{
      if(model===QWEN21_NATIVE_REWRITE_V3_CAPABILITY){queries.push({target,queryUser,shared});return ready?1:0;}return 0;
    }};
  const plane=createControlPlane({store,secrets:{sessionSecret:secret}});
  const caps=async(query={},auth=headers)=>(await plane.handle({method:'GET',path:'/api/web/capabilities',query,headers:auth})).body.features.qwen21NativeRewriteV3;
  assert.equal(await caps({worker:node}),true);assert.deepEqual(queries.at(-1),{target:node,queryUser:user,shared:false});
  assert.equal(await caps(),false);assert.equal(await caps({worker:node},{}),false);
  owner=other;assert.equal(await caps({worker:node}),false);owner=user;
  enabled=false;assert.equal(await caps({worker:node}),false);enabled=true;
  ownerEnabled=false;assert.equal(await caps({worker:node}),false);ownerEnabled=true;
  ready=false;assert.equal(await caps({worker:node}),false);
});
