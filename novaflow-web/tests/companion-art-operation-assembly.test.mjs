import test from 'node:test';
import assert from 'node:assert/strict';
import {artBusinessDependencies} from '../supabase/functions/novaflow-companion/art-dependencies.mjs';

test('art operation assembly is closed by default and requires a server-owned adapter',()=>{
  const secret=Buffer.alloc(32,2),closed=artBusinessDependencies(secret);
  assert.equal(closed.enabled,false);assert.equal(closed.accountingReady,false);assert.equal(closed.operationV3ForRequest,undefined);
  assert.throws(()=>artBusinessDependencies(secret,{operationV3Enabled:true}),e=>e.code==='operation-billing-unavailable');
});

test('art adapter is constructed separately for each request with that request verifier',async()=>{
  const secret=Buffer.alloc(32,2),seen=[];
  const business=artBusinessDependencies(secret,{operationV3Enabled:true,createOperationV3Adapter:async args=>{seen.push(args);return {enabled:true};}});
  const provider={creditConfig:{}},rpc=async()=>{},first=async()=>true,second=async()=>false;
  assert.equal(business.enabled,true);assert.equal(business.accountingReady,true);
  await business.operationV3ForRequest({provider,rpc,isCurrent:first});
  await business.operationV3ForRequest({provider,rpc,isCurrent:second});
  assert.equal(seen.length,2);assert.equal(seen[0].isCurrent,first);assert.equal(seen[1].isCurrent,second);
  assert.equal(seen[0].secret,secret);assert.equal(seen[0].provider,provider);assert.equal(seen[0].rpc,rpc);
});
