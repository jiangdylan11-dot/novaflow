import test from 'node:test';
import assert from 'node:assert/strict';
import {createXiaotaoOperationV3Prepare} from '../packages/shared/src/xiaotao-operation-v3-prepare.mjs';
import {createXiaotaoOperationV3Chat} from '../packages/shared/src/xiaotao-operation-v3-chat.mjs';

const model='xai/grok-4.7',secret=Buffer.alloc(32,7),user={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},sessionId='test-session';
const p='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aS0AAAAASUVORK5CYII=';
const intent=()=>({mode:'video-rewrite',requestId:'video_test_01',h3Mode:'first_last',durationSeconds:2,prompt:'<Picture 1> 中的女孩睁开眼睛，最后停在 <Picture 2>',requirements:'',references:[{key:'first_frame',kind:'image',sourceId:'first'},{key:'last_frame',kind:'image',sourceId:'last'}],images:[{key:'first_frame',dataUrl:p},{key:'last_frame',dataUrl:p}]});
const answer=()=>{const fields=(n,s)=>`integrated_multimodal_description: ${n}\n\noverall_soundscape: ${s}\n\nnon_diegetic_music: N/A`;return JSON.stringify({modelPrompt:fields('[Shot 1] 3D CG, the girl shown in <Picture 1> sits with her eyes closed. The camera holds a static shot as she opens her eyes, then closes them again and settles into the pose of <Picture 2>.','A soft breeze moves through the room.'),displayPrompt:fields('[Shot 1] 三维 CG，<Picture 1> 中的女孩闭眼坐着。镜头固定，她睁开眼睛，随后又闭上，落定在 <Picture 2> 的姿态。','微风轻轻吹过房间。')});};
function ledger(){const events=[];let state='';return {events,rpc:async(name,args)=>{events.push({name,args});if(name==='claim_xiaotao_operation_route_v3')return {route:'v3',idempotent:false};if(name==='reserve_xiaotao_operation_stage_v3'){if(state)return {status:state,idempotent:true};state='reserved';return {status:state,idempotent:false};}if(name==='mark_xiaotao_operation_stage_dispatched_v3'){state='dispatched';return {status:state,first_dispatch:true};}if(name==='record_xiaotao_operation_stage_usage_v3'){state='recorded';return {status:state};}if(name==='finalize_xiaotao_operation_v3'){state='settled';return {status:state,outcome:args.p_outcome,charged:0.000539,uncollected:0};}throw Error('unexpected '+name);}};}
const amount={credit_amount_policy:'decimal-v1',credit_precision:6,credit_rounding:'ceil',minimum_positive_credits:0};
const provider=()=>({apiKey:'synthetic',model,configRevision:'1',pricingSnapshotReady:true,operationTextChatV3:true,operationVideoRewriteV3:true,operationVisionChatV3:true,operationDecimalCreditsV1:true,operationDecimalLedgerReady:true,creditConfig:{credits_per_usd:0.001,xiaotao_online:{markup:1.5,enabled_models:[model],...amount}}});
const common={user,sessionId,isCurrent:async()=>true};

test('first-last vision quote reserves both images under decimal policy, submits once and binds bytes',async()=>{
  const db=ledger(),options={enabled:true,visionEnabled:true,videoRewriteEnabled:true,secret,loadProvider:async()=>provider(),rpc:db.rpc};
  const source=intent(),prep=createXiaotaoOperationV3Prepare(options);
  const q=await prep({...common,payload:{nonce:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',model,intent:source}});
  const textOnly={...source};delete textOnly.images;
  const qText=await prep({...common,payload:{nonce:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',model,intent:textOnly}});
  assert.ok(q.estimatedCredits>qText.estimatedCredits);assert.ok(q.estimatedCredits<1);
  let calls=0;const run=createXiaotaoOperationV3Chat({...options,infer:async({body})=>{calls++;assert.equal(body.model,model);assert.equal(body.input.at(-1).content.filter(x=>x.type==='input_image').length,2);return {data:{model,status:'completed',finish_reason:'stop',usage:{billing_token_usage_invalid:false,input_tokens:80,output_tokens:20,total_tokens:100,input_tokens_details:{cached_tokens:0}},output:[{type:'message',role:'assistant',content:[{type:'output_text',text:answer()}]}]}};}});
  await assert.rejects(run({...common,payload:{operationToken:q.token,intent:{...source,images:[source.images[1],{...source.images[0],dataUrl:'data:image/png;base64,aGVsbG8='}]}}}));
  assert.equal(calls,0);
  const result=await run({...common,payload:{operationToken:q.token,intent:source}});
  assert.equal(result.ok,true);assert.equal(result.videoDraft.textOnly,false);assert.equal(result.receipt.charged,0.000539);
  assert.equal(db.events.filter(x=>x.name==='finalize_xiaotao_operation_v3').length,1);
  await assert.rejects(run({...common,payload:{operationToken:q.token,intent:source}}));assert.equal(calls,1);
});
test('vision gate, model allowlist and signed policy reject before reserving',async()=>{
  for(const closed of ['vision','policy']){
    const db=ledger(),pvd=provider();if(closed==='policy')pvd.operationVisionChatV3=false;
    const prepare=createXiaotaoOperationV3Prepare({enabled:true,videoRewriteEnabled:true,visionEnabled:closed!=='vision',secret,loadProvider:async()=>pvd,rpc:db.rpc});
    await assert.rejects(prepare({...common,payload:{nonce:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',model,intent:intent()}}));assert.equal(db.events.length,0,closed);
  }
});
