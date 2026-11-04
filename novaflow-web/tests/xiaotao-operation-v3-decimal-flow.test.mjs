import test from 'node:test';
import assert from 'node:assert/strict';
import {createXiaotaoOperationV3Prepare} from '../packages/shared/src/xiaotao-operation-v3-prepare.mjs';
import {createXiaotaoOperationV3Chat} from '../packages/shared/src/xiaotao-operation-v3-chat.mjs';
import {ceilXiaotaoLedgerCredit} from '../packages/shared/src/xiaotao-decimal-usage.mjs';
import {parseCreditDecimal,addCreditDecimal,creditDecimalText} from '../packages/shared/src/xiaotao-operation-pricing-v3.mjs';
import {readFileSync} from 'node:fs';

const user={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},sessionId='decimal-test';
const nonce='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',secret=Buffer.alloc(32,7);
const model='deepseek/deepseek-v4.1-flash';
const intent={mode:'chat',requestId:'decimal_request_1',message:'Hello',history:[],promptLanguage:'en'};
const config={credits_per_usd:211,xiaotao_online:{markup:1.5,enabled_models:[model],
  credit_amount_policy:'decimal-v1',credit_precision:6,credit_rounding:'ceil',minimum_positive_credits:0}};
const provider={apiKey:'synthetic',model:'xai/grok-4.7',configRevision:'1',pricingSnapshotReady:true,
  operationTextChatV3:true,operationDecimalCreditsV1:true,operationDecimalLedgerReady:true,creditConfig:config};

// This in-memory RPC is solely a routing fixture. It does not stand in for the
// required PostgreSQL transaction, permission, or concurrent-settlement tests.
function fakeLedger() {
  const rows=new Map(),events=[];
  const rpc=async(name,args)=>{
    events.push({name,args:structuredClone(args)});
    if(name==='claim_xiaotao_operation_route_v3')return {route:'v3',idempotent:false};
    const id=args.p_operation_id;
    if(name==='reserve_xiaotao_operation_stage_v3') {
      const old=rows.get(id);if(old)return {status:old.state,idempotent:true};
      const snapshot=JSON.parse(args.p_policy_snapshot_text);
      assert.equal(snapshot.config.xiaotao_online.credit_amount_policy,'decimal-v1');
      assert.equal(snapshot.config.xiaotao_online.minimum_positive_credits,0);
      assert.ok(args.p_estimated_credits>0 && args.p_estimated_credits<1);
      rows.set(id,{state:'reserved',raw:'0'});return {status:'reserved',idempotent:false};
    }
    const row=rows.get(id);if(!row)throw Error('missing operation');
    if(name==='mark_xiaotao_operation_stage_dispatched_v3'){
      if(row.state!=='reserved')return {status:row.state,first_dispatch:false};
      row.state='dispatched';return {status:'dispatched',first_dispatch:true};
    }
    if(name==='record_xiaotao_operation_stage_usage_v3'){
      if(row.state!=='dispatched')throw Error('not dispatched');
      row.raw=String(args.p_raw_credits);row.state='recorded';return {status:'recorded'};
    }
    if(name==='finalize_xiaotao_operation_v3'){
      if(row.state==='dispatched')return {status:'pending-reconciliation'};
      if(row.state==='settled')return {...row.receipt,idempotent:true};
      const charged=row.state==='recorded'?ceilXiaotaoLedgerCredit(row.raw):0;
      row.receipt={status:'settled',outcome:args.p_outcome,charged,uncollected:0,idempotent:false};
      row.state='settled';return row.receipt;
    }
    throw Error('unexpected rpc '+name);
  };
  return {rpc,rows,events};
}

async function fixture(infer) {
  const db=fakeLedger(),options={enabled:true,secret,loadProvider:async()=>provider,rpc:db.rpc};
  const prepared=await createXiaotaoOperationV3Prepare(options)({user,sessionId,payload:{nonce,model,intent},isCurrent:async()=>true});
  const run=createXiaotaoOperationV3Chat({...options,infer});
  return {db,prepared,run:extra=>run({user,sessionId,payload:{operationToken:prepared.token,intent},isCurrent:async()=>true,...extra})};
}
const providerReply=()=>({data:{model,status:'completed',finish_reason:'stop',
  usage:{billing_token_usage_invalid:false,input_tokens:1,output_tokens:0,total_tokens:1,input_tokens_details:{cached_tokens:1}},
  output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'ok'}]}]}});

test('decimal operation routes exact sub-credit usage and never redispatches on retry',async()=>{
  let calls=0;const f=await fixture(async()=>{calls++;return providerReply();});
  const result=await f.run();
  assert.equal(result.ok,true);assert.equal(result.receipt.charged,0.000002);assert.equal(calls,1);
  assert.equal(f.db.rows.get(f.prepared.operationId).raw,'0.0000011394');
  await assert.rejects(f.run(),e=>e.code==='operation-status-unknown');assert.equal(calls,1);
  const finals=f.db.events.filter(x=>x.name==='finalize_xiaotao_operation_v3');
  const repeated=await f.db.rpc('finalize_xiaotao_operation_v3',finals[0].args);
  assert.equal(repeated.charged,0.000002);assert.equal(repeated.idempotent,true);
});

test('cancel before dispatch releases the synthetic hold without a provider call',async()=>{
  let calls=0,checks=0;const f=await fixture(async()=>{calls++;return providerReply();});
  const result=await f.run({signal:{get aborted(){return ++checks>=2;}}});
  assert.equal(result.ok,false);assert.equal(result.receipt.outcome,'cancel');assert.equal(result.receipt.charged,0);
  assert.equal(calls,0);assert.ok(!f.db.events.some(x=>x.name==='mark_xiaotao_operation_stage_dispatched_v3'));
});

test('unknown provider result stays pending and is never retried automatically',async()=>{
  let calls=0;const f=await fixture(async()=>{calls++;throw Error('synthetic timeout');});
  await assert.rejects(f.run(),e=>e.code==='operation-status-unknown');
  assert.equal(f.db.rows.get(f.prepared.operationId).state,'dispatched');
  await assert.rejects(f.run(),e=>e.code==='operation-status-unknown');assert.equal(calls,1);
});

test('two priced stages aggregate raw decimal cost before one final ledger quantization',async()=>{
  const stages=new Map(),events=[];let closed=false;
  const rpc=async(name,args)=>{
    events.push(name);
    if(name==='claim_xiaotao_operation_route_v3')return {route:'v3',idempotent:false};
    const key=args.p_phase_id;
    if(name==='reserve_xiaotao_operation_stage_v3'){
      if(stages.has(key))return {status:stages.get(key).state,idempotent:true};
      if(closed)throw Error('closed');stages.set(key,{state:'reserved'});return {status:'reserved',idempotent:false};
    }
    if(name==='mark_xiaotao_operation_stage_dispatched_v3'){
      stages.get(key).state='dispatched';return {status:'dispatched',first_dispatch:true};
    }
    if(name==='record_xiaotao_operation_stage_usage_v3'){
      const row=stages.get(key);row.state='recorded';row.raw=String(args.p_raw_credits);return {status:'recorded'};
    }
    if(name==='finalize_xiaotao_operation_v3'){
      let raw=parseCreditDecimal(0,'zero');
      for(const row of stages.values())if(row.raw)raw=addCreditDecimal(raw,parseCreditDecimal(row.raw,'stage'));
      closed=true;return {status:'settled',outcome:args.p_outcome,charged:ceilXiaotaoLedgerCredit(creditDecimalText(raw)),uncollected:0};
    }
    throw Error('unexpected rpc '+name);
  };
  const image='data:image/png;base64,'+readFileSync(new URL('./style-canvas-synthetic.png',import.meta.url)).toString('base64');
  const styleIntent={mode:'style-analysis',requestId:'decimal_style_1',kind:'aifx-material-supplement',images:[{role:'material',dataUrl:image}],supplement:'more stars'};
  const styleProvider={...provider,operationStyleV3:true,operationVisionChatV3:true,operationStyleVisionModels:[model]};
  const options={enabled:true,visionEnabled:true,styleEnabled:true,styleVisionModels:[model],secret,rpc,loadProvider:async()=>styleProvider};
  const prepared=await createXiaotaoOperationV3Prepare(options)({user,sessionId,payload:{nonce,model,intent:styleIntent},isCurrent:async()=>true});
  assert.ok(prepared.estimatedCredits>0 && prepared.estimatedCredits<1);
  let calls=0;
  const run=createXiaotaoOperationV3Chat({...options,infer:async()=>{
    const reply=providerReply();reply.data.output[0].content[0].text=++calls===1
      ? JSON.stringify({name:'flower',elements:'made of petals',colours:'yellow',breakup:'It scatters.'}):'more stars';
    return reply;
  }});
  const result=await run({user,sessionId,payload:{operationToken:prepared.token,intent:styleIntent},isCurrent:async()=>true});
  assert.equal(result.ok,true);assert.equal(calls,2);
  assert.deepEqual([...stages.values()].map(row=>row.raw),['0.0000011394','0.0000011394']);
  assert.equal(result.receipt.charged,0.000003);
  assert.equal(events.filter(name=>name==='finalize_xiaotao_operation_v3').length,1);
});
