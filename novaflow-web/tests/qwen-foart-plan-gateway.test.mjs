import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { base64UrlJson, hmacSha256 } from '../packages/shared/src/tokens.mjs';
import { createGateway } from '../worker/src/gateway/gateway.mjs';

const scope='qwen-foart-plan-v1', requestName='qwen-foart-plan-request.json';
const resultName='qwen-foart-plan-result-1.json', key='isolated-test-key-only';
const bytes=Buffer.from('{"message":"合成测试"}');
const digest=createHash('sha256').update(bytes).digest('hex');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function grant({taskId,workerId,userId,op,withScope=true,attempt=1}) {
  const iat=Math.floor(Date.now()/1000);
  const payload={kind:'grant',sub:userId,task:taskId,wid:workerId,op,iat,exp:iat+60,nonce:randomUUID(),
    ...(withScope ? {scope,attempt} : {})};
  const encoded=base64UrlJson(payload);
  return 'nfg_'+encoded+'.'+await hmacSha256(encoded,key);
}

async function fixture() {
  const root=await mkdtemp(join(tmpdir(),'foart-qwen-plan-gateway-'));
  const taskId=randomUUID(),workerId=randomUUID(),userId=randomUUID(),sessionId=randomUUID();
  const state={revoked:false,cancelled:false,attempt:1,wrongDigest:false,calls:[]};
  const verifier=async args=>{
    state.calls.push({op:args.op,phase:args.phase,attempt:args.attempt});
    if(state.revoked||state.cancelled)throw Object.assign(new Error('denied'),{status:403});
    const result={authorized:true,taskId,workerId,userId,sessionId,scope,op:args.op,attempt:state.attempt};
    if(args.phase==='finish')Object.assign(result,{digestBound:true,sha256:state.wrongDigest?'0'.repeat(64):digest,bytes:bytes.length});
    return result;
  };
  const gateway=createGateway({workerId,dataDir:root,getGrantKey:async()=>key,verifyQwenFoartPlanAccess:verifier});
  const port=await gateway.listen(0,'127.0.0.1');
  const path=(kind,name)=>`http://127.0.0.1:${port}/gw/tasks/${taskId}/${kind}/${name}`;
  const token=(op,options={})=>grant({taskId,workerId,userId,op,...options});
  async function close(){
    await gateway.close();
    const p=resolve(root), parent=resolve(tmpdir());
    assert.equal(dirname(p),parent);
    assert.ok(basename(p).startsWith('foart-qwen-plan-gateway-'));
    await rm(p,{recursive:true,force:true});
  }
  return {root,taskId,workerId,userId,sessionId,state,path,token,close,port};
}

async function put(url,token,data=bytes){
  return fetch(url,{method:'PUT',headers:{'x-novaflow-grant':token,'content-type':'application/json'},body:data});
}

test('restricted ordinary plan gateway checks status, scope, attempt and atomically publishes',async t=>{
  const f=await fixture();
  try {
    const upload=await f.token('upload');
    await t.test('unscoped token cannot access reserved file and scoped token cannot use ordinary filename',async()=>{
      assert.equal((await put(f.path('input',requestName),await f.token('upload',{withScope:false}))).status,403);
      assert.equal((await put(f.path('input','request.json'),upload)).status,403);
      assert.equal(f.state.calls.length,0);
    });
    await t.test('Windows filename aliases and invalid attempts cannot bypass reserved branch',async()=>{
      for(const name of ['QWEN-FOART-PLAN-REQUEST.JSON','qwen-foart-plan-request.json.',
        'qwen-foart-plan-result-01.json','qwen-foart-plan-result-21.json']){
        const kind=name.includes('result')?'output':'input';
        const method=kind==='output'?'GET':'PUT';
        const token=await f.token(kind==='output'?'download':'upload');
        const res=await fetch(f.path(kind,name),{method,headers:{'x-novaflow-grant':token},...(method==='PUT'?{body:bytes}:{})});
        assert.equal(res.status,404,name);
      }
      assert.equal(f.state.calls.length,0);
    });
    await t.test('other worker grant and stale attempt are denied',async()=>{
      const other=await f.token('upload',{workerId:randomUUID()});
      assert.equal((await put(f.path('input',requestName),other)).status,403);
      assert.equal((await put(f.path('input',requestName),await f.token('upload',{attempt:2}))).status,403);
    });
    await t.test('revoked session is denied after grant was issued',async()=>{
      f.state.revoked=true;
      assert.equal((await put(f.path('input',requestName),upload)).status,403);
      f.state.revoked=false;
    });
    await t.test('partial upload remains invisible and cancellation before finish rejects publication',async()=>{
      const final=join(f.root,'tasks',f.taskId,'input',requestName);
      const starts=f.state.calls.filter(v=>v.op==='upload'&&v.phase==='start').length;
      let reply;
      const response=new Promise((resolve,reject)=>{
        const req=httpRequest(f.path('input',requestName),{method:'PUT',headers:{'x-novaflow-grant':upload,'content-type':'application/json'}},res=>{
          res.resume();res.once('end',()=>resolve(res.statusCode));
        });
        req.once('error',reject); reply=req;
      });
      reply.write(bytes.subarray(0,4));
      for(let i=0;i<100&&f.state.calls.filter(v=>v.op==='upload'&&v.phase==='start').length===starts;i++)await sleep(10);
      assert.equal(f.state.calls.filter(v=>v.op==='upload'&&v.phase==='start').length,starts+1);
      await sleep(40);
      await assert.rejects(access(final),{code:'ENOENT'});
      f.state.cancelled=true;
      reply.end(bytes.subarray(4));
      assert.equal(await response,403);
      await assert.rejects(access(final),{code:'ENOENT'});
      f.state.cancelled=false;
    });
    await t.test('digest mismatch denies publication; valid upload cannot be overwritten',async()=>{
      const final=join(f.root,'tasks',f.taskId,'input',requestName);
      f.state.wrongDigest=true;
      assert.equal((await put(f.path('input',requestName),upload)).status,403);
      await assert.rejects(access(final),{code:'ENOENT'});
      f.state.wrongDigest=false;
      assert.equal((await put(f.path('input',requestName),upload)).status,200);
      assert.deepEqual(await readFile(final),bytes);
      assert.equal((await put(f.path('input',requestName),upload)).status,409);
      assert.deepEqual(await readFile(final),bytes);
    });
    await t.test('download binds signed attempt and checks session online',async()=>{
      const dir=join(f.root,'tasks',f.taskId,'output');await mkdir(dir,{recursive:true});
      await writeFile(join(dir,resultName),'{}');
      const download=await f.token('download');
      assert.equal((await fetch(f.path('output',resultName),{headers:{'x-novaflow-grant':await f.token('download',{attempt:2})}})).status,403);
      assert.equal((await fetch(f.path('output',resultName),{headers:{'x-novaflow-grant':download}})).status,200);
      f.state.revoked=true;
      assert.equal((await fetch(f.path('output',resultName),{headers:{'x-novaflow-grant':download}})).status,403);
      f.state.revoked=false;
    });
  } finally { await f.close(); }
});

test('simultaneous restricted uploads cannot replace each other',async()=>{
  const f=await fixture();
  try {
    const upload=await f.token('upload');
    const responses=await Promise.all([put(f.path('input',requestName),upload),put(f.path('input',requestName),upload)]);
    assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
    assert.deepEqual(await readFile(join(f.root,'tasks',f.taskId,'input',requestName)),bytes);
  } finally { await f.close(); }
});
