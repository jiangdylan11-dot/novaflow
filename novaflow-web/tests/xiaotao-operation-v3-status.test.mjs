import test from 'node:test';
import assert from 'node:assert/strict';
import {createXiaotaoOperationV3Status} from '../packages/shared/src/xiaotao-operation-v3-status.mjs';
const user={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},sessionId='session',operationId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const request={user,sessionId,payload:{operationId},isCurrent:async()=>true};

test('recovery is default closed and never touches a provider or ledger',async()=>{
  let calls=0;const fn=createXiaotaoOperationV3Status({rpc:async()=>{calls++;}});
  await assert.rejects(fn(request),e=>e.code==='operation-billing-disabled');assert.equal(calls,0);
});
test('queries only the authenticated user and returns a safe state projection',async()=>{
  const calls=[],fn=createXiaotaoOperationV3Status({enabled:true,rpc:async(name,args)=>{calls.push({name,args});
    return {operationId,status:'pending-reconciliation',expected_config:{secret:'never-return'},sessionId:'never-return',usage:{text:'never-return'}};}});
  assert.deepEqual(await fn(request),{operationId,status:'pending-reconciliation'});
  assert.deepEqual(calls,[{name:'get_xiaotao_operation_status_v3',args:{p_operation_id:operationId,p_user_id:user.id}}]);
  await assert.rejects(fn({...request,payload:{operationId,userId:'other'}}),e=>e.code==='operation-invalid-request');assert.equal(calls.length,1);
});
test('only a validated final receipt can expose final credit numbers',async()=>{
  const fn=createXiaotaoOperationV3Status({enabled:true,rpc:async()=>({operationId,status:'settled',outcome:'cancel',charged:1,uncollected:0,raw_cost:999})});
  assert.deepEqual(await fn(request),{operationId,status:'settled',outcome:'cancel',charged:1,uncollected:0});
  for(const row of [{operationId,status:'settled',outcome:'success',charged:-1,uncollected:0},
    {operationId,status:'settled',outcome:'unknown',charged:1,uncollected:0},{operationId,status:'settled',charged:1,uncollected:0},
    {operationId,status:'settled',outcome:'success',charged:1.5,uncollected:0}]){
    const bad=createXiaotaoOperationV3Status({enabled:true,rpc:async()=>row});await assert.rejects(bad(request),e=>e.code==='operation-status-unknown');
  }
});
test('status validates decimal receipts against that operation frozen policy',async()=>{
  const markers={credit_amount_policy:'decimal-v1',credit_precision:6,credit_rounding:'ceil',minimum_positive_credits:0};
  const receipt={operationId,status:'settled',outcome:'success',charged:'0.000001',uncollected:'0.012345',...markers};
  let lastArgs;
  const good=createXiaotaoOperationV3Status({enabled:true,rpc:async(name,args)=>{lastArgs={name,args};return receipt;}});
  assert.deepEqual(await good(request),{operationId,status:'settled',outcome:'success',charged:0.000001,uncollected:0.012345,...markers});
  assert.deepEqual(lastArgs,{name:'get_xiaotao_operation_status_v3',args:{p_operation_id:operationId,p_user_id:user.id}});
  for(const row of [
    {...receipt,credit_precision:5},{...receipt,credit_rounding:'round'},
    {...receipt,minimum_positive_credits:1},{...receipt,credit_amount_policy:'other'},
    {...receipt,charged:'0.0000001'},{...receipt,charged:'-0.000001'},
    {...receipt,uncollected:'14000000.000001'},
    {operationId,status:'settled',outcome:'success',charged:0.1,uncollected:0,credit_amount_policy:'decimal-v1'}
  ]){
    const bad=createXiaotaoOperationV3Status({enabled:true,rpc:async()=>row});
    await assert.rejects(bad(request),e=>e.code==='operation-status-unknown');
  }
  const stale=createXiaotaoOperationV3Status({enabled:true,rpc:async()=>receipt});
  await assert.rejects(stale({...request,isCurrent:async()=>false}),e=>e.code==='selection-stale');
});
test('session changes, malformed results and unavailable database remain unknown without a retry',async()=>{
  let calls=0;const fn=createXiaotaoOperationV3Status({enabled:true,rpc:async()=>{calls++;throw Error('timeout');}});
  await assert.rejects(fn({...request,isCurrent:async()=>false}),e=>e.code==='selection-stale');assert.equal(calls,0);
  await assert.rejects(fn(request),e=>e.code==='operation-status-unknown');assert.equal(calls,1);
  let fresh=true;const changing=createXiaotaoOperationV3Status({enabled:true,rpc:async()=>{fresh=false;return {operationId,status:'unknown'};}});
  await assert.rejects(changing({...request,isCurrent:async()=>fresh}),e=>e.code==='selection-stale');
});
