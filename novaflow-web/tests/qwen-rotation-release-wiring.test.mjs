import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createContext,runInContext} from 'node:vm';
import {createControlPlane,qwenRotationControlOptions} from '../packages/shared/src/control-plane.mjs';
import {QWEN_ROTATION_RELEASE_POLICY} from '../worker/src/qwen-rotation-release-policy.mjs';
import {computePromptAssistantOptions} from '../worker/src/compute-assistant.mjs';

const user='22222222-2222-4222-8222-222222222222',sid='33333333-3333-4333-8333-333333333333';
const worker='11111111-1111-4111-8111-111111111111',secret='synthetic-session-secret';
const encoded=Buffer.from(JSON.stringify({sub:user,sid,exp:Math.floor(Date.now()/1000)+300})).toString('base64url');
const headers={authorization:'Bearer nfs_'+encoded+'.'+createHmac('sha256',secret).update(encoded).digest('base64url')};

function fixture({verify=false,create=false,owner=user,ready=true,revoked=false}={}) {
  const node={id:worker,owner_id:owner,enabled:true,owner_enabled:true};
  const store={getUserById:async()=>({id:user,status:'active',plan:'pro'}),getUserSession:async()=>({id:sid,user_id:user,revoked_at:revoked?'2026-01-01T00:00:00Z':null}),
    getWorkerById:async()=>node,countCapableWorkers:async model=>model==='qwen3.5-9b-heretic-foart-rotation-candidate-v1'&&ready?1:0};
  for(const name of ['createQwenRotationCandidate','listQwenRotationCandidates','claimQwenRotationCandidate',
    'authorizeQwenRotationLease','startQwenRotationCandidate','completeQwenRotationCandidate','cancelQwenRotationCandidate'])store[name]=async()=>true;
  return createControlPlane({store,secrets:{sessionSecret:secret},qwenRotationVerifyEnabled:verify,qwenRotationCreateEnabled:create});
}

test('legacy candidate stays off while the reviewed ordinary preview requires both node gates',async()=>{
  assert.deepEqual(qwenRotationControlOptions(),{qwenRotationVerifyEnabled:false,qwenRotationCreateEnabled:false});
  for(const v of [true,1,'1','TRUE','false',''])assert.equal(qwenRotationControlOptions({verify:v,create:v}).qwenRotationVerifyEnabled,false);
  assert.deepEqual(qwenRotationControlOptions({verify:'true',create:'true'}),{qwenRotationVerifyEnabled:true,qwenRotationCreateEnabled:true});
  assert.deepEqual(QWEN_ROTATION_RELEASE_POLICY,{verificationEnabled:false,candidateEnabled:false,planVerificationEnabled:true,planEnabled:true});assert.equal(Object.isFrozen(QWEN_ROTATION_RELEASE_POLICY),true);
  assert.equal(computePromptAssistantOptions({qwenRotationVerificationEnabled:QWEN_ROTATION_RELEASE_POLICY.verificationEnabled,
    qwenRotationCandidateEnabled:QWEN_ROTATION_RELEASE_POLICY.candidateEnabled},null,[]).qwenRotationCandidateEnabled,false);
  assert.equal(computePromptAssistantOptions({qwenPlanVerificationEnabled:true,qwenPlanEnabled:true},null,[]).qwenPlanEnabled,true);
  assert.equal(computePromptAssistantOptions({qwenPlanVerificationEnabled:false,qwenPlanEnabled:true},null,[]).qwenPlanEnabled,false);
  assert.equal(computePromptAssistantOptions({qwenPlanVerificationEnabled:true,qwenPlanEnabled:false},null,[]).qwenPlanEnabled,false);
  const main=await readFile(new URL('../worker/electron/compute-main.cjs',import.meta.url),'utf8');
  assert.match(main,/import\(pathToFileURL\(path\.join\(__dirname, '\.\.\/src\/qwen-rotation-release-policy\.mjs'\)\)\.href\)/);
  assert.match(main,/qwenRotationVerificationEnabled: QWEN_ROTATION_RELEASE_POLICY\.verificationEnabled === true/);
  assert.match(main,/qwenRotationCandidateEnabled: QWEN_ROTATION_RELEASE_POLICY\.verificationEnabled === true && QWEN_ROTATION_RELEASE_POLICY\.candidateEnabled === true/);
  const build=JSON.parse(await readFile(new URL('../worker/electron-builder-compute.json',import.meta.url),'utf8'));assert.ok(build.files.includes('src/**/*'));
  const edge=await readFile(new URL('../supabase/functions/novaflow-web/index.ts',import.meta.url),'utf8');
  assert.match(edge,/qwenRotationControlOptions\(\{verify:env\('FOART_QWEN_ROTATION_VERIFY_ENABLED'\),create:env\('FOART_QWEN_ROTATION_CREATE_ENABLED'\)\}\)/);
});

test('capability needs both server switches, a live session and a ready owned selected node',async()=>{
  for(const opts of [{},{verify:true},{create:true},{verify:true,create:true,owner:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},{verify:true,create:true,ready:false}]){
    const r=await fixture(opts).handle({method:'GET',path:'/api/web/capabilities',query:{worker},headers});
    assert.equal(r.status,200);assert.equal(r.body.features.qwen35FoartRotationCandidate,false);
  }
  const active=fixture({verify:true,create:true});
  const ready=await active.handle({method:'GET',path:'/api/web/capabilities',query:{worker},headers});
  assert.equal(ready.body.features.qwen35FoartRotationCandidate,true);assert.equal(ready.body.features.qwen35FoartRotationOwnerLeaseBound,true);
  const unpinned=await active.handle({method:'GET',path:'/api/web/capabilities',query:{},headers});assert.equal(unpinned.body.features.qwen35FoartRotationCandidate,false);
  const revoked=await fixture({verify:true,create:true,revoked:true}).handle({method:'GET',path:'/api/web/capabilities',query:{worker},headers});assert.notEqual(revoked.status,200);
  const fake=await fixture().handle({method:'POST',path:'/api/web/qwen-rotation/tasks',headers,body:{qwenRotationCreateEnabled:true,qwenRotationVerifyEnabled:true}});
  assert.equal(fake.status,503);
});

test('real web status requires server capability, owner binding and a selected node',async()=>{
  const src=await readFile(new URL('../renderer/novaflow-web-runtime.js',import.meta.url),'utf8');
  const begin=src.indexOf('  async function pooledPromptStatus('),end=src.indexOf('  async function waitForTaskEnd(',begin);assert.ok(begin>0&&end>begin);
  for(const [node,features,want] of [[null,{qwen35FoartRotationCandidate:true,qwen35FoartRotationOwnerLeaseBound:true},false],
    [{id:worker},{qwen35FoartRotationCandidate:true},false],[{id:worker},{qwen35FoartRotationCandidate:false,qwen35FoartRotationOwnerLeaseBound:true},false],
    [{id:worker},{qwen35FoartRotationCandidate:true,qwen35FoartRotationOwnerLeaseBound:true},true]]) {
    const ctx={computeNode:node,pooledPromptRequests:new Map(),tasks:new Map(),control:async()=>({taskTypes:[],features}),String,Date};
    createContext(ctx);runInContext(src.slice(begin,end)+'\nglobalThis.run=pooledPromptStatus;',ctx);
    assert.equal((await ctx.run()).result.features.qwen35FoartRotationCandidate,want);
  }
});
