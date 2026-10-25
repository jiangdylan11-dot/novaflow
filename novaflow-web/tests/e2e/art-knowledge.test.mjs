import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {startLocalControlPlane} from '../../control-local/src/server.mjs';
import {createArtKnowledgeCache} from '../../worker/src/art-knowledge-cache.mjs';
import {artKnowledgeRelease} from '../../tools/art-knowledge-release.mjs';

// Throwaway PostgreSQL + real HTTP. This never contacts Supabase.
test('shared methods require consent, exact owner review, immutable releases and rollback',async t=>{
  const ctx=await startLocalControlPlane({port:0});
  t.after(async()=>{await new Promise(r=>ctx.server.close(r));await ctx.db.close();});
  await ctx.db.exec(await readFile(new URL('../../supabase/optional-migrations/20261026010000_art_knowledge.sql',import.meta.url),'utf8'));
  async function call(who,path,body,method=body?'POST':'GET'){
    const res=await fetch(ctx.url+path,{method,headers:{'content-type':'application/json',...(who?{authorization:'Bearer '+who.session.token}:{})},...(body?{body:JSON.stringify(body)}:{})});
    return {status:res.status,body:await res.json()};
  }
  const owner=(await call(null,'/dev/login',{email:'publisher@local.test'})).body;
  const other=(await call(null,'/dev/login',{email:'other-admin@local.test'})).body;
  const user=(await call(null,'/dev/login',{email:'contributor@local.test'})).body;
  await ctx.db.query("update public.users set role='admin' where id=any($1::uuid[])",[[other.user.id]]);
  const root='/api/web/art-knowledge',scope={skillId:'style-transfer',generationModel:'qwen-2.1',variant:'standard',brain:'*'};
  const candidate=(method='分别分析暗面、高光。',feedback='satisfied',id='task-1')=>({schema:'nf.art.method-candidate.v1',key:'local-key',status:'candidate',scope,method,evidence:[{taskId:id,resultSHA256:'a'.repeat(64),feedback,improvement:false}]});
  const release={skillId:'style-transfer',version:'1.0.1',validation:{passed:true,benchmarkSHA256:'b'.repeat(64),cases:1}};
  await t.test('no installation grants authority; opt-in and method-only schema are enforced',async()=>{
    assert.equal((await call(null,root+'?skillId=style-transfer')).status,401);
    assert.equal((await call(user,root+'/candidates',candidate())).status,403);
    assert.equal((await call(user,root+'/consent')).body.allowed,false);
    assert.equal((await call(user,root+'/consent',{allow:true})).status,200);
    assert.equal((await call(user,root+'/candidates',{...candidate(),prompt:'private original prompt'})).status,400);
    assert.equal((await call(user,root+'/candidates',candidate('data:image/png;base64,pixels'))).status,400);
    assert.equal((await call(user,root+'/prepare',release)).status,403);
    assert.equal((await call(other,root+'/prepare',release)).status,403,'another admin is not the configured publisher');
    assert.equal((await call(owner,root+'/prepare',release)).status,403,'unset owner is deny-by-default');
  });
  await ctx.db.query('update public.art_knowledge_policy set publisher_user_id=$1',[owner.user.id]);
  let first;
  await t.test('normalized duplicates merge evidence; negatives do not enter the release',async()=>{
    first=(await call(user,root+'/candidates',candidate())).body;
    assert.equal(first.accepted,true);
    const duplicate=(await call(user,root+'/candidates',candidate('分别分析暗面 高光'))).body;
    assert.equal(duplicate.candidateId,first.candidateId);
    assert.equal((await ctx.store.listArtCandidates())[0].evidence_count,1);
    await call(user,root+'/candidates',candidate('避免局部过曝。','unsatisfied','negative-task'));
    const report=await call(owner,root+'/prepare',release);
    assert.equal(report.status,200,JSON.stringify(report.body));
    assert.equal(report.body.selected.length,1);assert.equal(report.body.excluded[0].reason,'no-positive-evidence');
    assert(report.body.selected[0].reviewNotes.includes('single-user-evidence'));
    const packet=(await call(user,root+'?skillId=style-transfer')).body;
    assert.equal(packet.version,'0');assert.equal(packet.methods.length,0,'candidate never active');
  });
  let approved;
  await t.test('only this owner may approve an exact unchanged review batch',async()=>{
    approved=(await call(owner,root+'/prepare',release)).body;
    const publish={...approved.publishRequest,approval:{approved:true,batchSHA256:approved.batchSHA256}};
    assert.equal((await call(user,root+'/publish',publish)).status,403);
    assert.equal((await call(other,root+'/publish',publish)).status,403);
    assert.equal((await call(owner,root+'/publish',{...publish,approval:{approved:true,batchSHA256:'0'.repeat(64)}})).status,409);
    assert.equal((await call(owner,root+'/publish',{...publish,validation:{...publish.validation,cases:2}})).status,409,'benchmark change invalidates approval');
    await call(user,root+'/candidates',candidate('分别分析暗面 高光','satisfied','task-2'));
    assert.equal((await call(owner,root+'/publish',publish)).status,409,'feedback evidence change invalidates approval');
    approved=(await call(owner,root+'/prepare',release)).body;
    const result=await call(owner,root+'/publish',{...approved.publishRequest,approval:{approved:true,batchSHA256:approved.batchSHA256}});
    assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.methods.length,1);
    assert(!JSON.stringify(result.body).includes('task-1'));
  });
  await t.test('published methods survive the next release, dedupe and owner rollback',async()=>{
    const report=(await call(owner,root+'/prepare',{...release,version:'1.0.2'})).body;
    assert.equal(report.selected.length,0);assert(report.excluded.some(c=>c.reason==='already-published'));
    await call(user,root+'/candidates',candidate('将肤色明暗与背景冷暖分别组织。','adopted','new-method'));
    const next=(await call(owner,root+'/prepare',{...release,version:'1.0.2'})).body;
    const result=await call(owner,root+'/publish',{...next.publishRequest,approval:{approved:true,batchSHA256:next.batchSHA256}});
    assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.methods.length,2);
    const same=(await call(user,root+'?skillId=style-transfer&knownVersion=1.0.2')).body;
    assert.equal(same.unchanged,true);assert.equal(same.methods,undefined);
    assert.equal((await call(other,root+'/rollback',{skillId:'style-transfer',version:'1.0.1'})).status,403);
    assert.equal((await call(owner,root+'/rollback',{skillId:'style-transfer',version:'1.0.1'})).status,200);
    assert.equal((await call(user,root+'?skillId=style-transfer')).body.methods.length,1);
  });
  await t.test('published method outcomes remain evidence, are idempotent and flag regression without automatic rule changes',async()=>{
    const outcome={schema:'nf.art.method-outcome.v1',key:'outcome-fixture',status:'candidate',appliedMethodIds:[first.candidateId],evidence:{taskId:'published-outcome',resultSHA256:'c'.repeat(64),feedback:'unsatisfied',improvement:false}};
    assert.equal((await call(user,root+'/outcomes',outcome)).status,200);assert.equal((await call(user,root+'/outcomes',outcome)).status,200);
    assert.equal((await call(user,root+'/outcomes',{...outcome,evidence:{...outcome.evidence,resultSHA256:'d'.repeat(64)}})).status,409);
    const report=(await call(owner,root+'/prepare',{...release,version:'1.0.3'})).body;
    assert.equal(report.selected.length,0);assert.equal(report.monitor.length,1);assert.equal(report.monitor[0].negative_count,1);
    assert(report.excluded.some(c=>c.reason==='previously-withdrawn'),'A rolled-back method never becomes an automatic new candidate');
    assert.equal((await call(user,root+'?skillId=style-transfer')).body.version,'1.0.1');
    assert((await call(owner,root+'/releases')).body.releases.length>=2);assert.equal((await call(user,root+'/releases')).status,403);
  });
  await t.test('SQL enforces owner and unchanged evidence even without the HTTP wrapper',async()=>{
    await assert.rejects(ctx.store.publishArtKnowledge(other.user.id,{...release,candidateIds:[first.candidateId],validation:{...release.validation,ownerApproved:true,approvedBy:other.user.id}}),/publisher owner/);
    await assert.rejects(ctx.store.publishArtKnowledge(owner.user.id,{...release,version:'9.0.0',candidateIds:[first.candidateId],validation:{...release.validation,ownerApproved:true,approvedBy:owner.user.id}}),/pending owner review required|reviewed evidence changed/);
    await ctx.db.exec('set role authenticated');
    try{await assert.rejects(ctx.db.query('select * from public.art_method_candidates'),/permission denied/);
      await assert.rejects(ctx.db.query('select public.novaflow_art_review_candidates()'),/permission denied/);}
    finally{await ctx.db.exec('reset role');}
    await call(user,root+'/consent',{allow:false});assert.equal((await call(user,root+'/candidates',candidate())).status,403);
  });
});

test('cache reads never wait for sync; offline restart, rollback and immutability retain good data',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'nf-art-cache-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const method={id:'approved',text:'分别组织明暗块面。',status:'stable',scope:{skillId:'style-transfer',generationModel:'qwen-2.1',variant:'standard',brain:'*'}};
  let packet={version:'1.0.1',methods:[method]},calls=0;
  const cache=createArtKnowledgeCache({directory,fetchPacket:async({skillId})=>{calls++;return skillId==='style-transfer'?packet:{version:'0',methods:[]};}});
  assert.equal((await cache.read({skillId:'style-transfer'})).version,'0');assert.equal(calls,0);
  await cache.sync();assert.equal((await cache.read({skillId:'style-transfer'})).version,'1.0.1');
  packet={version:'1.0.2',methods:[{...method,id:'second'}]};await cache.sync();
  packet={version:'1.0.1',methods:[method]};await cache.sync();assert.equal((await cache.read({skillId:'style-transfer'})).version,'1.0.1','server rollback switches cached pointer');
  packet={version:'1.0.1',methods:[{...method,text:'silently changed'}]};assert((await cache.sync())[0].unavailable);assert.equal((await cache.read({skillId:'style-transfer'})).methods[0].text,method.text);
  packet={version:'1.0.3',methods:[{...method,status:'candidate'}]};assert((await cache.sync())[0].unavailable);
  const offline=createArtKnowledgeCache({directory,fetchPacket:async()=>{throw Error('offline');}});await offline.sync();assert.equal((await offline.read({skillId:'style-transfer'})).version,'1.0.1');
  let unblock;const pending=new Promise(r=>{unblock=r;});
  const slow=createArtKnowledgeCache({directory,fetchPacket:async()=>{await pending;throw Error('timeout');}});
  const running=slow.sync();
  assert.equal((await Promise.race([slow.read({skillId:'style-transfer'}),new Promise((_,reject)=>setTimeout(()=>reject(Error('read blocked on network')),200))])).version,'1.0.1');
  unblock();await running;
});

test('release preparation writes a readable report and cannot publish without exact explicit approval',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'nf-art-review-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const {writeFile}=await import('node:fs/promises'),benchmark=join(directory,'benchmark.json'),report=join(directory,'review.json');
  await writeFile(benchmark,JSON.stringify({passed:true,cases:[{visualAcceptance:'owner-approved-fixture'}]}));
  const calls=[],options={env:{NOVAFLOW_ART_OWNER_TOKEN:'fixture-token'},fetchImpl:async(url,init)=>{
    calls.push({url,body:JSON.parse(init.body)});
    return Response.json({ok:true,status:'awaiting-owner-approval',baseVersion:'0',batchSHA256:'c'.repeat(64),selected:[],excluded:[],remaining:0,publishRequest:{skillId:'style-transfer',version:'1.0.1',candidateIds:[],validation:{passed:true}}});
  }};
  const args=['--control','https://control.test','--report',report];
  await artKnowledgeRelease(['--prepare',...args,'--benchmark',benchmark,'--version','1.0.1'],options);
  assert.equal(calls.length,1);assert(calls[0].url.endsWith('/prepare'));
  assert((await readFile(report+'.md','utf8')).includes('等待本人确认，尚未发布'));
  assert(!(await readFile(report,'utf8')).includes('fixture-token'));
  await assert.rejects(artKnowledgeRelease(['--publish',...args],options),/显式提供/);assert.equal(calls.length,1);
  await assert.rejects(artKnowledgeRelease(['--publish',...args,'--approve-batch','wrong'],options),/显式提供/);assert.equal(calls.length,1);
});
