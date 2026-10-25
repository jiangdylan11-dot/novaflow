import test from 'node:test';
import assert from 'node:assert/strict';
import {createArtTaskIdentity} from '../../worker/src/art-task-identity.mjs';
import {startLocalServer} from '../../worker/src/local-server.mjs';
import {createArtLearning} from '../../worker/src/art-learning.mjs';
import {mkdtemp,mkdir,writeFile,rm,readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const fixtureExpires=Math.floor(Date.now()/1000)+3600;
const token=id=>'nfs_'+Buffer.from(JSON.stringify({sub:id,exp:fixtureExpires})).toString('base64url')+'.fixture';
test('browser accounts are verified independently of compute binding, cached and scoped across concurrent tasks',async()=>{
  let checks=0;const actor=createArtTaskIdentity({identifyUser:async value=>{checks++;await new Promise(r=>setTimeout(r,3));return {id:value===token('A')?'A':'B',status:'active'};},fallbackOwner:()=> 'device'});
  const a={accountId:'A',accountToken:token('A')},b={accountId:'B',accountToken:token('B')};
  assert.equal(await actor.identify(a),'A');assert.equal(await actor.identify(a),'A');assert.equal(checks,1);
  assert.equal(await actor.identify(b),'B');await assert.rejects(actor.identify({...a,accountId:'B'}),/无法核验/);
  const values=await Promise.all(['A','B'].map(id=>actor.runAs(id,async()=>{await new Promise(r=>setTimeout(r,id==='A'?10:1));return actor.owner();})));
  assert.deepEqual(values,['A','B']);assert.equal(actor.owner(),'device');
  await assert.rejects(actor.identify({accountId:'A'}),/无法核验/);assert.equal(await actor.identify({}),'device');
});
test('failed verification creates no trusted identity and cached identity cannot exceed the bounded lifetime',async()=>{
  let time=1000,calls=0;const actor=createArtTaskIdentity({now:()=>time,ttlMs:20,identifyUser:async()=>{calls++;if(calls>1)throw Error('revoked');return {id:'A'};},fallbackOwner:()=> 'device'});
  assert.equal(await actor.identify({accountToken:token('A')}),'A');time+=21;
  await assert.rejects(actor.identify({accountToken:token('A')}),/无法核验/);assert.equal(actor.owner(),'device');
});

test('paired HTTP records unbound browser accounts separately and strips login tokens before AI planning',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'nf-art-login-'));t.after(()=>rm(directory,{recursive:true,force:true}));const webRoot=join(directory,'web');await mkdir(webRoot);await writeFile(join(webRoot,'index.html'),'<head></head>');
  const actor=createArtTaskIdentity({identifyUser:async value=>({id:value===token('A')?'A':'B',status:'active'}),fallbackOwner:()=> 'device'});
  const learning=createArtLearning({directory:join(directory,'journal'),getOwner:actor.owner});
  const seen=[],server=await startLocalServer({port:0,dataDir:directory,webRoot,worker:{identity:{workerId:'fixture'},getState:()=>({boundAccount:null})},artLearning:learning,artActor:actor,
    promptAssistant:{artAgentChat:async(payload,{learningAllowed})=>{seen.push(payload);assert.equal(payload.accountToken,undefined);if(!learningAllowed)return {ok:true,data:{reply:'original flow'}};
      const task=await learning.begin(payload,'fixture');return {ok:true,data:{reply:'plan',learning:await learning.planned(task,{ok:true,data:{proposal:{proposalId:payload.requestId,prompt:'brief',action:'prompt'}}})}};}}});
  t.after(()=>server.close());const key=new URL(server.openUrl).hash.split('=')[1];
  const call=async(action,body)=>{const response=await fetch(server.origin+'/local/prompt-assistant/'+action,{method:'POST',headers:{'content-type':'application/json','x-novaflow-local':key},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
  const plans=await Promise.all(['A','B'].map(id=>call('art-agent-chat',{accountId:id,accountToken:token(id),requestId:'request-'+id,mode:'creation',message:'test',artContext:{engine:'qwen-2.1'},images:[]})));
  for(const plan of plans){assert.equal(plan.status,200);assert(plan.body.data.learning);}
  for(const id of ['A','B']){const rows=await call('art-learning',{accountId:id,accountToken:token(id),action:'list'});assert.equal(rows.status,200);assert.equal(rows.body.data.tasks.length,1);assert.equal(rows.body.data.tasks[0].ownerId,id);}
  assert.equal((await call('art-learning',{accountId:'B',accountToken:token('A'),action:'list'})).status,403);
  for(const name of await readdir(join(directory,'journal'))){if(name.endsWith('.json'))assert(!(await readFile(join(directory,'journal',name),'utf8')).includes('accountToken'));}
  assert.equal(seen.length,2);
});
