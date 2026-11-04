import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalizeXiaotaoV3ChatIntent,createXiaotaoOperationV3Prepare} from '../packages/shared/src/xiaotao-operation-v3-prepare.mjs';
import {createXiaotaoOperationV3Chat} from '../packages/shared/src/xiaotao-operation-v3-chat.mjs';

const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const user={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},sessionId='session',nonce='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const model='xai/grok-4.7',secret=Buffer.alloc(32,7);
const intent=()=>({mode:'chat',requestId:'vision_request_123',message:'Describe the synthetic image.',history:[],promptLanguage:'zh-CN',images:[{dataUrl:png,role:'style',source:2}]});
const provider=()=>({apiKey:'synthetic',model,configRevision:'1',pricingSnapshotReady:true,creditConfig:{}});
const reply=()=>({data:{model,status:'completed',finish_reason:'stop',usage:{billing_token_usage_invalid:false,input_tokens:80,output_tokens:20,total_tokens:100},
  output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'Synthetic response.'}]}]}});
function ledger(){
  const rows=new Map(),calls=[];
  const rpc=async(name,args)=>{
    calls.push({name,args:structuredClone(args)});const id=args.p_operation_id;
    if(name==='claim_xiaotao_operation_route_v3')return {route:'v3',idempotent:false};
    if(name==='reserve_xiaotao_operation_stage_v3'){
      if(rows.has(id))return {status:rows.get(id).status,idempotent:true};
      rows.set(id,{status:'reserved'});return {status:'reserved',idempotent:false};
    }
    const row=rows.get(id);if(!row)throw Error('unknown operation');
    if(name==='mark_xiaotao_operation_stage_dispatched_v3'){row.status='dispatched';return {status:'dispatched',first_dispatch:true};}
    if(name==='record_xiaotao_operation_stage_usage_v3'){row.status='recorded';return {status:'recorded'};}
    if(name==='finalize_xiaotao_operation_v3'){if(row.status==='dispatched')return {status:'pending-reconciliation'};row.status='settled';return {status:'settled',outcome:args.p_outcome,charged:1,uncollected:0};}
    throw Error('unknown rpc');
  };
  return {rpc,rows,calls};
}
async function fixture(infer=async()=>reply()){
  const db=ledger(),loadProvider=async()=>provider();
  const prepare=createXiaotaoOperationV3Prepare({enabled:true,visionEnabled:true,secret,loadProvider,rpc:db.rpc});
  const prepared=await prepare({user,sessionId,payload:{nonce,model,intent:intent()},isCurrent:async()=>true});
  const execute=createXiaotaoOperationV3Chat({enabled:true,visionEnabled:true,secret,loadProvider,rpc:db.rpc,infer});
  const run=(changes={})=>execute({user,sessionId,payload:{operationToken:prepared.token,intent:intent()},isCurrent:async()=>true,...changes});
  return {db,prepared,run};
}

test('vision requires separate server opt-in and reuses existing input validation',()=>{
  assert.throws(()=>canonicalizeXiaotaoV3ChatIntent(intent()),e=>e.code==='operation-intent-unsupported');
  for(const images of [[],Array(4).fill({dataUrl:png}),[{dataUrl:'https://example.invalid/private.png'}],
    [{dataUrl:png,role:'system'}],[{dataUrl:png,role:'style',secret:'not-allowed'}]])
    assert.throws(()=>canonicalizeXiaotaoV3ChatIntent({...intent(),images},{visionEnabled:true}));
});
test('image bytes, order and role are bound to the intent while source objects are cloned',()=>{
  const input=intent(),first=canonicalizeXiaotaoV3ChatIntent(input,{visionEnabled:true});
  input.images[0].role='subject';
  assert.equal(first.intent.images[0].role,'style');
  assert.notEqual(first.intentHash,canonicalizeXiaotaoV3ChatIntent(input,{visionEnabled:true}).intentHash);
  const pair={...intent(),images:[{dataUrl:png,role:'subject'},{dataUrl:png,role:'style'}]};
  assert.notEqual(canonicalizeXiaotaoV3ChatIntent(pair,{visionEnabled:true}).intentHash,
    canonicalizeXiaotaoV3ChatIntent({...pair,images:[...pair.images].reverse()},{visionEnabled:true}).intentHash);
});
test('one image request reserves vision, passes the actual bytes once, and records only usage',async()=>{
  let calls=0;
  const f=await fixture(async options=>{calls++;assert.equal(options.maxRetries,0);
    assert.ok(options.body.input.some(m=>m.content.some(p=>p.type==='input_image'&&p.image_url===png)));return reply();});
  const result=await f.run();assert.equal(result.ok,true);assert.equal(result.receipt.charged,1);assert.equal(calls,1);
  assert.equal(f.db.calls.find(c=>c.name==='reserve_xiaotao_operation_stage_v3').args.p_feature,'xiaotao_vision');
  assert.ok(!JSON.stringify(f.db.calls).includes(png));
  await assert.rejects(f.run(),e=>e.code==='operation-status-unknown');assert.equal(calls,1);
});
test('swapping image bytes or role after preparing fails before reservation',async()=>{
  const f=await fixture();
  await assert.rejects(f.run({payload:{operationToken:f.prepared.token,intent:{...intent(),images:[{dataUrl:png,role:'subject'}]}}}));
  assert.deepEqual(f.db.calls.map(c=>c.name),['claim_xiaotao_operation_route_v3']);
});
test('uncertain provider outcome holds the operation and never resends the image',async()=>{
  let calls=0;const f=await fixture(async()=>{calls++;throw Error('uncertain');});
  await assert.rejects(f.run(),e=>e.code==='operation-status-unknown');
  assert.equal(f.db.rows.get(f.prepared.operationId).status,'dispatched');
  await assert.rejects(f.run(),e=>e.code==='operation-status-unknown');assert.equal(calls,1);
});
