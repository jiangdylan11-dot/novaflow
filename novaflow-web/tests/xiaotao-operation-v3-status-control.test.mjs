import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createControlPlane} from '../packages/shared/src/control-plane.mjs';
import {createXiaotaoOperationV3Status} from '../packages/shared/src/xiaotao-operation-v3-status.mjs';
const userId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',other='cccccccc-cccc-4ccc-8ccc-cccccccccccc',operationId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const secret='synthetic-session-secret',path='/api/web/companion/operation/status';
function auth(sub=userId){const part=Buffer.from(JSON.stringify({sub,sid:'s1',exp:Math.floor(Date.now()/1000)+300})).toString('base64url');return {authorization:'Bearer nfs_'+part+'.'+createHmac('sha256',secret).update(part).digest('base64url')};}
const store={getUserById:async id=>[userId,other].includes(id)?{id,status:'active'}:null,getUserSession:async id=>({id,user_id:userId,revoked_at:null})};
const request=(plane,body={operationId},headers=auth())=>plane.handle({method:'POST',path,body,headers});

test('status requires authentication, accepts only operation ID, and binds query to the current user',async()=>{
  const calls=[],rpc=async(name,args)=>{calls.push({name,args});return {operationId,status:'pending-reconciliation',expected_config:{private:'do-not-leak'}};};
  const status=createXiaotaoOperationV3Status({enabled:true,rpc});
  const plane=createControlPlane({store,secrets:{sessionSecret:secret},companion:{getXiaotaoOperationV3Status:status}});
  assert.equal((await request(plane,{operationId},{})).status,401);
  assert.equal((await request(plane,{operationId,userId:other})).status,400);
  const res=await request(plane);assert.equal(res.status,200);assert.deepEqual(res.body.operation,{operationId,status:'pending-reconciliation'});
  assert.deepEqual(calls,[{name:'get_xiaotao_operation_status_v3',args:{p_operation_id:operationId,p_user_id:userId}}]);
  assert.equal(JSON.stringify(res.body).includes('do-not-leak'),false);
});

test('status is default closed without sending a charge or request to a provider',async()=>{
  const plane=createControlPlane({store,secrets:{sessionSecret:secret},companion:{}});
  const res=await request(plane);assert.equal(res.status,503);assert.equal(res.body.code,'operation-billing-disabled');
});
