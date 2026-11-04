// Synthetic fixtures only: no production service, account, or credential.
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,readFile,readdir,access,rm,utimes,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,basename} from 'node:path';
import {request as httpRequest} from 'node:http';
import {createHash} from 'node:crypto';
import {createGateway,sweepTaskFiles} from '../../worker/src/gateway/gateway.mjs';
import {candidateTaskIdState,candidateTaskDirectory,CANDIDATE_TASKS_ROOT} from '../../worker/src/gateway/candidate-task-path.mjs';
import {issueGrantToken} from '../../packages/shared/src/tokens.mjs';

const key='FIXED-TEST-KEY-ONLY',user='test-owner',worker='test-worker',proof='FIXED-TEST-PROOF';
const candidate='fa047a0a-0000-8000-8000-000000000001',legacy='11111111-1111-4111-8111-111111111111';
let dir,gw,closed,timed,port,closedPort,timedPort,phaseMode='allow',calls=[],finishStarted,finishRelease,abortCount=0;
const digest = text => createHash('sha256').update(text).digest('hex');
// This map represents independently bound server data, never the incoming hash.
const bound = new Map([
  [candidate,'{"synthetic":true}'],
  ['fa047a0a-0000-8000-8000-000000000007','{"partial":true}'],
  ['fa047a0a-0000-8000-8000-000000000010','{"finished":true}'],
  ['fa047a0a-0000-8000-8000-000000000013','{"synthetic":true}'],
  ['fa047a0a-0000-8000-8000-000000000019','{"synthetic":true}'],
  ['fa047a0a-0000-8000-8000-000000000020','{"synthetic":true}'],
  ['fa047a0a-0000-8000-8000-000000000021','{"synthetic":true}'],
  ['fa047a0a-0000-8000-8000-000000000022','{"synthetic":true}'],
  ['fa047a0a-0000-8000-8000-000000000023','{"synthetic":true}'],
  ['fa047a0a-0000-8000-8000-000000000024','{"synthetic":true}'],
  ['fa047a0a-0000-8000-8000-000000000025','{"synthetic":true}'],
  ['fa047a0a-0000-8000-8000-000000000026','{"synthetic":true}'],
  ['fa047a0a-0000-8000-8000-000000000028','{"synthetic":true}'],
]);
async function verifier(input){
  calls.push({...input,proof:'[redacted-test-proof]'});
  if(phaseMode==='status401'||phaseMode==='status403')throw Object.assign(Error('private-verifier-detail'),{status:Number(phaseMode.slice(6))});
  if((phaseMode==='hang-start'&&input.phase==='start')||(phaseMode==='hang-finish'&&input.phase==='finish'))
    return new Promise(resolve=>input.signal.addEventListener('abort',()=>{abortCount++;resolve(null);},{once:true}));
  if(phaseMode==='ignore-abort-finish'&&input.phase==='finish')return new Promise(resolve=>setTimeout(()=>resolve({authorized:true,
    taskId:input.taskId,workerId:input.workerId,op:input.op,userId:user,sessionId:'test-session',attempt:1,scope:'qwen-foart-rotation-candidate-v1'}),150));
  if(phaseMode==='hold-finish'&&input.phase==='finish'){finishStarted();await new Promise(resolve=>{finishRelease=resolve;});}
  if(phaseMode==='offline')throw Error('offline');
  if(input.proof!==proof||phaseMode==='deny'||phaseMode==='deny-finish'&&input.phase==='finish'||input.untrustedGrantUser!==user)return {authorized:false};
  const identity={authorized:true,taskId:input.taskId,workerId:input.workerId,op:input.op,userId:user,
    sessionId:phaseMode==='session-change'&&input.phase==='finish'?'other-session':'test-session',attempt:1,scope:'qwen-foart-rotation-candidate-v1'};
  if(input.phase!=='finish'||input.op!=='upload')return identity;
  const expected=bound.get(input.taskId);
  if(phaseMode==='missing-binding')return identity;
  if(phaseMode==='echo-unbound')return {...identity,sha256:input.sha256,bytes:input.bytes};
  if(phaseMode==='missing-hash')return {...identity,digestBound:true,bytes:input.bytes};
  if(phaseMode==='missing-bytes')return {...identity,digestBound:true,sha256:input.sha256};
  if(phaseMode==='wrong-hash')return {...identity,digestBound:true,sha256:'0'.repeat(64),bytes:input.bytes};
  if(phaseMode==='wrong-bytes')return {...identity,digestBound:true,sha256:input.sha256,bytes:input.bytes+1};
  if(!expected)return {...identity,digestBound:false,sha256:'0'.repeat(64),bytes:0};
  const expectedHash=digest(expected),expectedBytes=Buffer.byteLength(expected);
  return {...identity,digestBound:input.sha256===expectedHash && input.bytes===expectedBytes,sha256:expectedHash,bytes:expectedBytes};
}
async function grant(id,op,sub=user){return issueGrantToken({userId:sub,taskId:id,workerId:worker,op},key);}
function url(id,kind='input',name='request.json',p=port){return `http://127.0.0.1:${p}/gw/tasks/${id}/${kind}/${name}`;}
async function req({id=candidate,kind='input',name='request.json',method='PUT',p=port,tokenId=id,tokenUser=user,proofValue=proof,scope,body='{"synthetic":true}'}={}){
  const op=kind==='input'?'upload':'download';const token=await grant(tokenId,op,tokenUser);
  return fetch(url(id,kind,name,p)+(scope?'?scope='+scope:''),{method,headers:{'x-novaflow-grant':token,
    'x-novaflow-candidate-proof':proofValue,'connection':'close'},...(['PUT','POST'].includes(method)?{body}:{})});
}
before(async()=>{
  dir=await mkdtemp(join(tmpdir(),'foart-gateway-fixture-'));
  gw=createGateway({workerId:worker,dataDir:dir,getGrantKey:()=>key,verifyCandidateAccess:verifier});
  closed=createGateway({workerId:worker,dataDir:dir,getGrantKey:()=>key});
  timed=createGateway({workerId:worker,dataDir:dir,getGrantKey:()=>key,verifyCandidateAccess:verifier,candidateVerificationTimeoutMs:50});
  port=await gw.listen(0,'127.0.0.1');closedPort=await closed.listen(0,'127.0.0.1');timedPort=await timed.listen(0,'127.0.0.1');
  assert.equal(gw.server.address().address,'127.0.0.1');assert.equal(closed.server.address().address,'127.0.0.1');assert.equal(timed.server.address().address,'127.0.0.1');
});
after(async()=>{
  for(const item of [gw,closed,timed])if(item?.server?.listening)await item.close();
  assert.equal(gw?.server?.listening,false);assert.equal(closed?.server?.listening,false);assert.equal(timed?.server?.listening,false);
  if(dir&&dirname(dir)===tmpdir()&&basename(dir).startsWith('foart-gateway-fixture-'))await rm(dir,{recursive:true,force:true});
});
test('classification is canonical and candidate path refuses ordinary/invalid input',()=>{
  assert.equal(candidateTaskIdState(candidate),'candidate');assert.equal(candidateTaskIdState(candidate.toUpperCase()),'noncanonical-candidate');
  assert.equal(candidateTaskIdState(legacy),'other');assert.equal(candidateTaskIdState('garbage'),'other');
  assert.throws(()=>candidateTaskDirectory(dir,legacy,'input'));assert.throws(()=>candidateTaskDirectory(dir,candidate,'../output'));
});
test('default has no verifier and refuses candidate before storage',async()=>{
  assert.equal((await req({p:closedPort})).status,503);
  await assert.rejects(access(candidateTaskDirectory(dir,candidate,'input')),e=>e.code==='ENOENT');
});
test('online verifier timeout aborts its signal and cannot publish',async()=>{
  const id='fa047a0a-0000-8000-8000-000000000014';phaseMode='hang-start';const before=abortCount;
  assert.equal((await req({id,p:timedPort})).status,503);assert.equal(abortCount,before+1);phaseMode='allow';
  await assert.rejects(access(candidateTaskDirectory(dir,id,'input')),e=>e.code==='ENOENT');
});
test('upstream identity denial is a generic 403 without verifier details',async()=>{
  for(const mode of ['status401','status403']){
    phaseMode=mode;const r=await req({id:'fa047a0a-0000-8000-8000-000000000018'});
    assert.equal(r.status,403);const body=await r.text();assert.match(body,/candidate verification denied/);assert.doesNotMatch(body,/private-verifier-detail|FIXED-TEST-PROOF/);
  }
  phaseMode='allow';
});
test('timeout at upload finish removes temporary file',async()=>{
  const id='fa047a0a-0000-8000-8000-000000000015',before=abortCount;phaseMode='hang-finish';
  assert.equal((await req({id,p:timedPort})).status,503);assert.equal(abortCount,before+1);phaseMode='allow';
  assert.deepEqual(await readdir(candidateTaskDirectory(dir,id,'input')),[]);
});
test('socket closed before verifier starts does not leak an unhandled rejection',async()=>{
  let releaseKey,keyStarted;const entered=new Promise(resolve=>{keyStarted=resolve;});
  const keyWait=new Promise(resolve=>{releaseKey=resolve;});let called=false;
  const gated=createGateway({workerId:worker,dataDir:dir,getGrantKey:async()=>{keyStarted();await keyWait;return key;},
    verifyCandidateAccess:async()=>{called=true;throw Error('must not run');}});
  const p=await gated.listen(0,'127.0.0.1'),id='fa047a0a-0000-8000-8000-000000000017',token=await grant(id,'upload');
  const unhandled=[];const onUnhandled=error=>unhandled.push(error);process.on('unhandledRejection',onUnhandled);
  try {
    const request=httpRequest(url(id,'input','request.json',p),{method:'PUT',headers:{'x-novaflow-grant':token,
      'x-novaflow-candidate-proof':proof,'connection':'close'}});
    request.on('error',()=>{});request.end('{"synthetic":true}');await entered;
    request.destroy();await new Promise(resolve=>setTimeout(resolve,30));releaseKey();
    await new Promise(resolve=>setTimeout(resolve,40));
    assert.equal(called,false);assert.deepEqual(unhandled,[]);
    await assert.rejects(access(candidateTaskDirectory(dir,id,'input')),e=>e.code==='ENOENT');
  } finally {releaseKey();process.removeListener('unhandledRejection',onUnhandled);await gated.close();assert.equal(gated.server.listening,false);}
});
test('late verifier response after timeout cannot publish even if callback ignores abort',async()=>{
  const id='fa047a0a-0000-8000-8000-000000000016';phaseMode='ignore-abort-finish';
  assert.equal((await req({id,p:timedPort})).status,503);phaseMode='allow';await new Promise(resolve=>setTimeout(resolve,180));
  assert.deepEqual(await readdir(candidateTaskDirectory(dir,id,'input')),[]);
});
test('legacy upload and output still use legacy path without candidate verifier',async()=>{
  const res=await req({id:legacy,p:closedPort});assert.equal(res.status,200);
  assert.equal(await readFile(join(dir,'tasks',legacy,'input','request.json'),'utf8'),'{"synthetic":true}');
  await mkdir(join(dir,'tasks',legacy,'output'),{recursive:true});await writeFile(join(dir,'tasks',legacy,'output','request.json'),'legacy');
  const out=await req({id:legacy,kind:'output',method:'GET',p:closedPort});assert.equal(out.status,200);assert.equal(await out.text(),'legacy');
  assert.equal((await req({id:legacy,name:'other.json',p:closedPort})).status,200);
  await mkdir(join(dir,'tasks',legacy,'preview'),{recursive:true});await writeFile(join(dir,'tasks',legacy,'preview','other.json'),'legacy-preview');
  const preview=await req({id:legacy,kind:'preview',name:'other.json',method:'GET',p:closedPort});
  assert.equal(preview.status,200);assert.equal(await preview.text(),'legacy-preview');
});
test('candidate rejects noncontract paths and methods before any grant or verifier call',async()=>{
  let keyCalls=0,verifyCalls=0;
  const gated=createGateway({workerId:worker,dataDir:dir,getGrantKey:()=>{keyCalls++;return key;},
    verifyCandidateAccess:async()=>{verifyCalls++;return {authorized:true};}});
  const p=await gated.listen(0,'127.0.0.1'),id='fa047a0a-0000-8000-8000-000000000027';
  try{
    for(const [kind,name,method] of [
      ['input','other.json','PUT'],['input','result.json','POST'],['input','REQUEST.JSON','PUT'],
      ['input','request.json','GET'],['output','request.json','GET'],['output','other.json','HEAD'],
      ['output','result.json','PUT'],['preview','result.json','GET'],['preview','request.json','HEAD'],
    ]){
      const res=await fetch(url(id,kind,name,p),{method,headers:{'x-novaflow-grant':'untrusted-token',
        'x-novaflow-candidate-proof':'untrusted-proof','connection':'close'},
        ...(['PUT','POST'].includes(method)?{body:'{"synthetic":true}'}:{})});
      assert.equal(res.status,404,`${method} ${kind}/${name}`);
    }
    assert.equal(keyCalls,0);assert.equal(verifyCalls,0);
    await assert.rejects(access(candidateTaskDirectory(dir,id,'input')),error=>error.code==='ENOENT');
  }finally{await gated.close();assert.equal(gated.server.listening,false);}
});
test('candidate write is isolated, checks online twice and duplicate cannot overwrite',async()=>{
  calls=[];assert.equal((await req()).status,200);
  assert.deepEqual(calls.map(x=>x.phase),['start','finish']);
  assert.equal(Object.hasOwn(calls[0],'sha256'),false);assert.equal(Object.hasOwn(calls[0],'bytes'),false);
  assert.equal(calls[1].sha256,digest('{"synthetic":true}'));assert.equal(calls[1].bytes,Buffer.byteLength('{"synthetic":true}'));
  assert.equal(await readFile(join(candidateTaskDirectory(dir,candidate,'input'),'request.json'),'utf8'),'{"synthetic":true}');
  await assert.rejects(access(join(dir,'tasks',candidate,'input','request.json')),e=>e.code==='ENOENT');
  assert.equal((await req()).status,409);
  assert.deepEqual(await readdir(candidateTaskDirectory(dir,candidate,'input')),['request.json']);
});
test('candidate POST accepts only the bound request.json input',async()=>{
  const id='fa047a0a-0000-8000-8000-000000000028';calls=[];
  assert.equal((await req({id,method:'POST'})).status,200);
  assert.deepEqual(calls.map(call=>call.phase),['start','finish']);
  assert.equal(await readFile(join(candidateTaskDirectory(dir,id,'input'),'request.json'),'utf8'),'{"synthetic":true}');
});
test('candidate content must match the independently bound hash and byte length',async()=>{
  for(const [id,body] of [
    ['fa047a0a-0000-8000-8000-000000000019','{"synthetic":null}'], // same length, different bytes
    ['fa047a0a-0000-8000-8000-000000000020','{"synthetic":true }'], // different length
  ]){
    const r=await req({id,body});assert.equal(r.status,403);
    assert.deepEqual(await readdir(candidateTaskDirectory(dir,id,'input')),[]);
  }
});
test('missing binding confirmation or malformed bound values cannot publish',async()=>{
  for(const [id,mode,expectedStatus] of [
    ['fa047a0a-0000-8000-8000-000000000021','missing-binding',503],
    ['fa047a0a-0000-8000-8000-000000000022','echo-unbound',503],
    ['fa047a0a-0000-8000-8000-000000000023','missing-hash',503],
    ['fa047a0a-0000-8000-8000-000000000024','missing-bytes',503],
    ['fa047a0a-0000-8000-8000-000000000025','wrong-hash',403],
    ['fa047a0a-0000-8000-8000-000000000026','wrong-bytes',403],
  ]){
    phaseMode=mode;const r=await req({id});assert.equal(r.status,expectedStatus,mode);
    assert.deepEqual(await readdir(candidateTaskDirectory(dir,id,'input')),[]);
  }
  phaseMode='allow';
});
test('forgery, revoked finish and changed session do not publish or retain temporary files',async()=>{
  for(const [i,mode] of ['deny','offline','deny-finish','session-change'].entries()){
    phaseMode=mode;const id=`fa047a0a-0000-8000-8000-00000000000${i+2}`;
    const r=await req({id});assert.ok([403,503].includes(r.status));
    const input=candidateTaskDirectory(dir,id,'input');try{assert.deepEqual(await readdir(input),[]);}catch(e){if(e.code!=='ENOENT')throw e;}
  }
  phaseMode='allow';assert.equal((await req({proofValue:'forged',id:'fa047a0a-0000-8000-8000-000000000006'})).status,403);
  const count=calls.length;assert.equal((await req({proofValue:'',id:'fa047a0a-0000-8000-8000-000000000006'})).status,403);assert.equal(calls.length,count);
  assert.equal((await req({tokenId:legacy})).status,403);
  assert.equal((await req({id:candidate.toUpperCase()})).status,400);
});
test('partial candidate upload is not visible under final name',async()=>{
  const id='fa047a0a-0000-8000-8000-000000000007',token=await grant(id,'upload');
  const request=httpRequest(url(id),{method:'PUT',headers:{'x-novaflow-grant':token,'x-novaflow-candidate-proof':proof,'connection':'close'}});
  const response=new Promise((resolve,reject)=>{request.on('response',resolve);request.on('error',reject);});request.write('{"partial":');
  const input=candidateTaskDirectory(dir,id,'input');let files=[];
  for(let i=0;i<100;i++){try{files=await readdir(input);}catch{}if(files.some(name=>name.endsWith('.upload')))break;await new Promise(r=>setTimeout(r,5));}
  assert.ok(files.some(name=>name.endsWith('.upload')));assert.ok(!files.includes('request.json'));
  request.end('true}');const res=await response;res.resume();assert.equal(res.statusCode,200);
  const finish=calls.findLast(call=>call.taskId===id&&call.phase==='finish');
  assert.equal(finish.sha256,digest('{"partial":true}'));assert.equal(finish.bytes,Buffer.byteLength('{"partial":true}'));
  assert.equal(await readFile(join(input,'request.json'),'utf8'),'{"partial":true}');
});
test('disconnect during final online verification cleans temp and never publishes',async()=>{
  const id='fa047a0a-0000-8000-8000-000000000010',token=await grant(id,'upload');phaseMode='hold-finish';
  const started=new Promise(resolve=>{finishStarted=resolve;});
  const request=httpRequest(url(id),{method:'PUT',headers:{'x-novaflow-grant':token,'x-novaflow-candidate-proof':proof,'connection':'close'}});
  request.on('error',()=>{});request.end('{"finished":true}');await started;
  const call=calls.at(-1);request.destroy();await new Promise(resolve=>setTimeout(resolve,30));assert.equal(call.signal.aborted,true);finishRelease();
  const input=candidateTaskDirectory(dir,id,'input');let files;
  for(let i=0;i<100;i++){files=await readdir(input);if(files.length===0)break;await new Promise(r=>setTimeout(r,5));}
  assert.deepEqual(files,[]);phaseMode='allow';
});
test('simultaneous duplicate uploads publish at most once',async()=>{
  const id='fa047a0a-0000-8000-8000-000000000013';
  const results=await Promise.all([req({id}),req({id})]);assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);
  assert.deepEqual(await readdir(candidateTaskDirectory(dir,id,'input')),['request.json']);
});
test('candidate read, HEAD, revoked/offline and misleading scope use candidate gate',async()=>{
  const out=candidateTaskDirectory(dir,candidate,'output');await mkdir(out,{recursive:true});await writeFile(join(out,'result.json'),'candidate');
  const ok=await req({kind:'output',name:'result.json',method:'GET',scope:'legacy'});assert.equal(ok.status,200);assert.equal(await ok.text(),'candidate');
  const head=await req({kind:'output',name:'result.json',method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  phaseMode='deny';assert.equal((await req({kind:'output',name:'result.json',method:'HEAD'})).status,403);
  phaseMode='offline';assert.equal((await req({kind:'output',name:'result.json',method:'GET'})).status,503);phaseMode='allow';
});
test('candidate sweep respects active IDs and other directories',async()=>{
  const stale='fa047a0a-0000-8000-8000-000000000008',active='fa047a0a-0000-8000-8000-000000000009';
  for(const id of [stale,active,legacy]){const p=join(dir,CANDIDATE_TASKS_ROOT,id,'output');await mkdir(p,{recursive:true});await writeFile(join(p,'request.json'),id);await utimes(join(p,'request.json'),new Date(0),new Date(0));}
  const report=await sweepTaskFiles({dataDir:dir,ttlSeconds:{input:1,image:1,video:1},activeTaskIds:[active.toUpperCase()],taskSpace:'candidate'});
  assert.ok(report.expiredTasks.includes(stale));assert.ok(!report.expiredTasks.includes(active));
  await assert.rejects(access(join(dir,CANDIDATE_TASKS_ROOT,stale,'output','request.json')),e=>e.code==='ENOENT');
  await access(join(dir,CANDIDATE_TASKS_ROOT,active,'output','request.json'));await access(join(dir,CANDIDATE_TASKS_ROOT,legacy,'output','request.json'));
});
test('candidate upload refuses a linked input directory',async t=>{
  const id='fa047a0a-0000-8000-8000-000000000012',outside=join(dir,'outside-upload-fixture'),base=join(dir,CANDIDATE_TASKS_ROOT,id);
  await mkdir(outside,{recursive:true});await mkdir(base,{recursive:true});
  try{await symlink(outside,join(base,'input'),'junction');}catch(error){if(['EPERM','EACCES','ENOTSUP'].includes(error.code))return t.skip('junction creation unavailable');throw error;}
  assert.equal((await req({id})).status,503);assert.deepEqual(await readdir(outside),[]);
});
test('candidate sweep skips linked kind folders and preserves their target',async t=>{
  const id='fa047a0a-0000-8000-8000-000000000011',outside=join(dir,'outside-fixture'),base=join(dir,CANDIDATE_TASKS_ROOT,id);
  await mkdir(outside,{recursive:true});await writeFile(join(outside,'keep.json'),'keep');await utimes(join(outside,'keep.json'),new Date(0),new Date(0));
  await mkdir(base,{recursive:true});try{await symlink(outside,join(base,'output'),'junction');}catch(error){if(['EPERM','EACCES','ENOTSUP'].includes(error.code))return t.skip('junction creation unavailable');throw error;}
  const report=await sweepTaskFiles({dataDir:dir,ttlSeconds:{input:1,image:1,video:1},taskSpace:'candidate'});
  assert.ok(!report.expiredTasks.includes(id));assert.equal(await readFile(join(outside,'keep.json'),'utf8'),'keep');
});
