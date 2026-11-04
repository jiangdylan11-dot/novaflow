import test from 'node:test';
import assert from 'node:assert/strict';
import {createXiaotaoOperationV3Prepare} from '../packages/shared/src/xiaotao-operation-v3-prepare.mjs';
import {createXiaotaoOperationV3Chat as create} from '../packages/shared/src/xiaotao-operation-v3-chat.mjs';

const secret=Buffer.alloc(32,7),user={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},sessionId='session',nonce='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const intent=()=>({mode:'chat',requestId:'request_123',message:'整理提示词',history:[{role:'user',content:'你好'}],promptLanguage:'zh-CN'});
const provider=()=>({apiKey:'test-only',model:'xai/grok-4.7',configRevision:'1',pricingSnapshotReady:true,creditConfig:{}});
const reply=()=>({data:{model:'xai/grok-4.7',status:'completed',finish_reason:'stop',usage:{billing_token_usage_invalid:false,input_tokens:80,output_tokens:20,total_tokens:100},
  output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'整理完成'}]}]}});
function ledger(){
  const operations=new Map(),events=[],rpcCalls=[];
  const rpc=async(name,args)=>{
    events.push(name);
    rpcCalls.push({name,args:structuredClone(args)});
    const id=args.p_operation_id;
    if(name==='claim_xiaotao_operation_route_v3')return {route:'v3',idempotent:false};
    if(name==='reserve_xiaotao_operation_stage_v3'){
      const old=operations.get(id);
      if(old)return {status:old.status,idempotent:true};
      operations.set(id,{status:'reserved',hash:args.p_request_hash,phase:args.p_phase_id});
      return {status:'reserved',idempotent:false};
    }
    const operation=operations.get(id);if(!operation)throw Error('unknown operation');
    if(name==='mark_xiaotao_operation_stage_dispatched_v3'){
      if(operation.status!=='reserved')return {status:operation.status,first_dispatch:false};
      operation.status='dispatched';return {status:'dispatched',first_dispatch:true};
    }
    if(name==='record_xiaotao_operation_stage_usage_v3'){
      if(operation.status!=='dispatched')throw Error('not dispatched');
      operation.status='recorded';operation.raw=args.p_raw_credits;return {status:'recorded',idempotent:false};
    }
    if(name==='finalize_xiaotao_operation_v3'){
      if(operation.status==='dispatched')return {status:'pending-reconciliation'};
      const charged=operation.status==='recorded'?Math.max(1,Math.ceil(operation.raw-1e-9)):0;
      operation.status='settled';return {status:'settled',outcome:args.p_outcome,charged,idempotent:false};
    }
    throw Error('unknown rpc');
  };
  return {rpc,events,operations,rpcCalls};
}
async function fixture({infer=async()=>reply(),isCurrent=async()=>true,loadProvider=async()=>provider()}={}) {
  const db=ledger(),prepare=createXiaotaoOperationV3Prepare({enabled:true,secret,loadProvider,rpc:db.rpc});
  const prepared=await prepare({user,sessionId,payload:{nonce,model:'xai/grok-4.7',intent:intent()},isCurrent:async()=>true});
  const run=create({enabled:true,secret,loadProvider,rpc:db.rpc,infer});
  const execute=(extra={})=>run({user,sessionId,payload:{operationToken:prepared.token,intent:intent()},isCurrent,...extra});
  return {db,prepared,run,execute};
}
test('closed unless explicitly enabled',async()=>{
  await assert.rejects(create()({}),e=>e.code==='operation-billing-disabled');
});
test('raw database expected config differs safely from effective public pricing',async()=>{
  const f=await fixture({loadProvider:async()=>({...provider(),billingExpectedConfig:{xiaotao_online:{markup:1.2}},creditConfig:{xiaotao_online:{markup:1.5}}})});
  await f.execute();
  const reserve=f.db.rpcCalls.find(call=>call.name==='reserve_xiaotao_operation_stage_v3').args;
  assert.equal(reserve.p_expected_config.xiaotao_online.markup,1.2);
  assert.equal(JSON.parse(reserve.p_policy_snapshot_text).config.xiaotao_online.markup,1.5);
});
test('one real input contract moves one fixed stage through reserve, dispatch, usage and receipt',async()=>{
  let calls=0;const f=await fixture({infer:async options=>{
    calls++;assert.equal(options.model,'xai/grok-4.7');assert.equal(options.maxRetries,0);assert.equal(options.includeBillingIntegrity,true);
    assert.equal(options.body.max_output_tokens,2048);return reply();
  }});
  const value=await f.execute();
  assert.equal(value.reply,'整理完成');assert.equal(value.receipt.charged,1);assert.equal(calls,1);
  assert.deepEqual(f.db.events,['claim_xiaotao_operation_route_v3','reserve_xiaotao_operation_stage_v3',
    'mark_xiaotao_operation_stage_dispatched_v3','record_xiaotao_operation_stage_usage_v3','finalize_xiaotao_operation_v3']);
  const row=f.db.operations.get(f.prepared.operationId);assert.equal(row.phase,'chat');assert.equal(row.status,'settled');
  await assert.rejects(f.execute(),e=>e.code==='operation-status-unknown');assert.equal(calls,1);
});
test('tampered intent, client model or different session fail before reservation',async()=>{
  const f=await fixture();
  await assert.rejects(f.execute({payload:{operationToken:f.prepared.token,intent:{...intent(),message:'不同'}}}));
  await assert.rejects(f.execute({payload:{operationToken:f.prepared.token,intent:intent(),model:'other'}}));
  await assert.rejects(f.execute({sessionId:'other'}));
  assert.deepEqual(f.db.events,['claim_xiaotao_operation_route_v3']);
});
test('cancel before dispatch settles only an unspent reservation',async()=>{
  let reads=0,calls=0;
  const f=await fixture({infer:async()=>{calls++;return reply();}});
  const result=await f.execute({signal:{get aborted(){return ++reads>=2;}}});
  assert.equal(result.ok,false);assert.equal(result.errorCode,'cancelled-before-dispatch');assert.equal(result.receipt.charged,0);
  assert.equal(calls,0);assert.equal(f.db.events.at(-1),'finalize_xiaotao_operation_v3');
  assert.ok(!f.db.events.includes('mark_xiaotao_operation_stage_dispatched_v3'));
});
test('provider failure or bad usage after dispatch remains pending and is never replayed',async()=>{
  let calls=0;const f=await fixture({infer:async()=>{calls++;throw Error('timeout');}});
  await assert.rejects(f.execute(),e=>e.code==='operation-status-unknown');
  assert.equal(f.db.operations.get(f.prepared.operationId).status,'dispatched');
  await assert.rejects(f.execute(),e=>e.code==='operation-status-unknown');assert.equal(calls,1);
  const g=await fixture({infer:async()=>{const result=reply();delete result.data.usage.billing_token_usage_invalid;return result;}});
  await assert.rejects(g.execute(),e=>e.code==='operation-status-unknown');
  assert.equal(g.db.operations.get(g.prepared.operationId).status,'dispatched');
});
test('known usage is settled even when unusable output or cancellation follows dispatch',async()=>{
  const bad=await fixture({infer:async()=>{const result=reply();result.data.output=[];return result;}});
  const invalid=await bad.execute();assert.equal(invalid.ok,false);assert.equal(invalid.errorCode,'operation-provider-output-invalid');
  assert.equal(invalid.receipt.charged,1);assert.equal(invalid.receipt.outcome,'cancel');
  const controller=new AbortController();
  const cancelled=await fixture({infer:async()=>{controller.abort();return reply();}});
  const stopped=await cancelled.execute({signal:controller.signal});assert.equal(stopped.ok,false);
  assert.equal(stopped.errorCode,'operation-cancelled-after-dispatch');assert.equal(stopped.receipt.charged,1);
});
test('missing or non-stop finish reason settles known usage but never reports success',async()=>{
  for(const finish of [undefined,'length','tool_calls','content_filter']) {
    const f=await fixture({infer:async()=>{const result=reply();result.data.finish_reason=finish;return result;}});
    const result=await f.execute();assert.equal(result.ok,false);assert.equal(result.errorCode,'operation-provider-output-invalid');
    assert.equal(result.receipt.outcome,'cancel');assert.equal(result.receipt.charged,1);
  }
});
test('session revoked after provider usage is settled without disclosing reply or receipt',async()=>{
  let active=true;const f=await fixture({isCurrent:async()=>active,infer:async()=>{active=false;return reply();}});
  await assert.rejects(f.execute(),e=>e.code==='selection-stale'&&!('receipt' in e)&&!('reply' in e));
  assert.equal(f.db.events.at(-1),'finalize_xiaotao_operation_v3');assert.equal(f.db.operations.get(f.prepared.operationId).status,'settled');
});
