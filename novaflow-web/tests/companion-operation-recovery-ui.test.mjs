import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import {webcrypto} from 'node:crypto';

const id='cccccccc-cccc-4ccc-8ccc-cccccccccccc',modelId='xai/grok-4.7';
test('recovery notices stay account-bound and pending cannot be dismissed',async()=>{
  let owner='account-a',status='pending-reconciliation';const rows=new Map([['account-a',[{operationId:id,modelId}]]]);let checks=0,dismisses=0;
  const client={captureFoartBillingOwner(){const captured=owner;return {owner:captured,current:()=>owner===captured};},
    listCompanionOperationRecovery:()=>rows.get(owner)||[],
    checkCompanionOperationRecovery:async operationId=>{checks++;return {ok:true,operation:{operationId,status,...(status==='settled'?{outcome:'success',charged:1,uncollected:0}:{})}};},
    dismissCompanionOperationRecovery:async operationId=>{dismisses++;if(status!=='settled')return {ok:false};rows.set(owner,[]);return {ok:true,operation:{operationId,status,outcome:'success',charged:1,uncollected:0}};}};
  const storage={getItem:()=>null,setItem(){}},sandbox={console,crypto:webcrypto,AbortController,setTimeout,clearTimeout,localStorage:storage};sandbox.window=sandbox;
  runInContext(readFileSync(new URL('../renderer/xiaotao-art-agent.js',import.meta.url),'utf8'),createContext(sandbox));
  const controller=sandbox.NovaFlowXiaotaoArtAgent.createController({bridge:{},storage,api:()=>client});
  assert.equal(controller.operationRecoveryNotices()[0].recovery,null);
  assert.equal(await controller.checkOperationRecovery(id),true);assert.equal(controller.operationRecoveryNotices()[0].recovery.status,'pending-reconciliation');
  assert.equal(await controller.checkOperationRecovery(id,true),false);assert.equal(rows.get(owner).length,1);
  owner='account-b';assert.equal(controller.operationRecoveryNotices().length,0);assert.equal(await controller.checkOperationRecovery(id),false);
  owner='account-a';status='settled';assert.equal(await controller.checkOperationRecovery(id),true);
  assert.equal(controller.operationRecoveryNotices()[0].recovery.charged,1);assert.equal(await controller.checkOperationRecovery(id,true),true);
  assert.equal(controller.operationRecoveryNotices().length,0);assert.equal(checks,2);assert.equal(dismisses,2);
});
