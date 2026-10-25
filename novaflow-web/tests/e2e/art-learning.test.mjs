import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createArtLearning,classifyArtFeedback} from '../../worker/src/art-learning.mjs';
import {createArtSkillService,artDigest} from '../../worker/src/art-skill-service.mjs';
import {computeArtAgentFingerprint} from '../../worker/src/flash-art-agent.mjs';
import {createStrataPromptAssistant} from '../../worker/src/strata-prompt-assistant.mjs';
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
function request(){const p={requestId:randomUUID(),mode:'drawing',message:'请按参考画风重绘，给我完整提示词',history:[],
  artContext:{provider:'local',engine:'qwen-2.1',mode:'img2img',nsfw:false,prompt:'',negativePrompt:'keep negative',cfg:3,steps:8,referenceRoles:['subject','style']},
  images:[{role:'subject',dataUrl:PNG},{role:'style',dataUrl:PNG}]};p.contextFingerprint=computeArtAgentFingerprint(p);return p;}
async function fixture(t){const directory=await mkdtemp(join(tmpdir(),'nf-shared-art-'));t.after(()=>rm(directory,{recursive:true,force:true}));let user='A';
  const hub={version:'1',methods:[]},sent=[],getKnowledge=async()=>structuredClone(hub),getOwner=()=>user;
  const make=()=>createArtLearning({directory,getOwner,getKnowledge,queueCandidate:async value=>{sent.push(structuredClone(value));return {accepted:true};}});
  return {directory,hub,sent,make,learning:make(),setOwner:id=>{user=id;}};}
async function complete(learning,{method='分别分析受光面、暗面与局部高光，避免以统一滤色替代光色关系。',prompt='brief',payload=request(),resultSHA256='a'.repeat(64)}={}){
  const session=await learning.begin(payload,'flash'),proposal={proposalId:randomUUID(),prompt,action:'generate',...(method?{learningMethod:method}:{})};
  await learning.planned(session,{ok:true,data:{model:'flash',proposal,toolTrace:[]}});const resultId=randomUUID();
  await learning.command({action:'receipt',taskId:session.taskId,proposalId:proposal.proposalId,execution:'succeeded',resultId,resultSHA256});
  return {session,proposal,resultId};}
const tick=()=>new Promise(r=>setTimeout(r,30));

test('only actual result feedback is recorded; silence and another generation do not imply satisfaction',async t=>{
  const f=await fixture(t),task=await complete(f.learning);assert.equal((await f.learning.command({action:'list'})).tasks[0].feedback,'unrated');
  assert.equal(f.sent.length,0);await assert.rejects(f.learning.command({action:'feedback',taskId:task.session.taskId,resultId:'wrong',message:'这次很好'}),/实际成图/);
  await f.learning.command({action:'feedback',taskId:task.session.taskId,resultId:task.resultId,message:'这次效果很好。'});await tick();
  assert.equal(f.sent.length,1);assert.equal(f.sent[0].status,'candidate');assert.equal(f.sent[0].evidence[0].improvement,false);
  assert.equal((await f.learning.begin(request(),'flash')).experiences.length,0,'Candidate is never an active rule');
});
test('shared stable knowledge works for another user and another brain; private tasks stay isolated',async t=>{
  const f=await fixture(t),task=await complete(f.learning);
  f.hub.methods=[{id:'shared-1',text:'分别描述暗面与高光的冷暖。',status:'stable',scope:{skillId:'style-transfer',generationModel:'qwen-2.1',variant:'standard',brain:'*'}}];
  f.setOwner('B');assert.equal((await f.learning.command({action:'list'})).tasks.length,0);
  const restarted=f.make(),next=await restarted.begin(request(),'gpt-api');assert.equal(next.experiences[0].id,'shared-1');
  await assert.rejects(restarted.command({action:'feedback',taskId:task.session.taskId,resultId:task.resultId,message:'好'}),/没有该任务/);
  await assert.rejects(restarted.command({action:'list',ownerId:'A'}),/不能在请求中指定/);
});
test('model/brain applicability and candidate status are enforced without a restart',async t=>{
  const f=await fixture(t);f.hub.methods=[
    {id:'wrong-model',status:'stable',text:'other',scope:{skillId:'style-transfer',generationModel:'other',variant:'*',brain:'*'}},
    {id:'candidate',status:'candidate',text:'untested',scope:{skillId:'style-transfer',generationModel:'*',variant:'*',brain:'*'}},
    {id:'brain-only',status:'stable',text:'brain-specific',scope:{skillId:'style-transfer',generationModel:'*',variant:'*',brain:'flash'}}];
  assert.equal((await f.learning.begin(request(),'gpt')).experiences.length,0);assert.equal((await f.learning.begin(request(),'flash')).experiences[0].id,'brain-only');
  f.hub.methods=[];assert.equal((await f.learning.begin(request(),'flash')).experiences.length,0);
});
test('repeated feedback and normalized duplicates merge evidence rather than accumulating rules',async t=>{
  const f=await fixture(t),a=await complete(f.learning,{method:'分别分析暗面、高光。'});
  for(let i=0;i<2;i++)await f.learning.command({action:'feedback',taskId:a.session.taskId,resultId:a.resultId,message:'这次效果很好。'});
  const b=await complete(f.learning,{method:'分别分析暗面 高光'});await f.learning.command({action:'feedback',taskId:b.session.taskId,resultId:b.resultId,message:'不满意'});await tick();
  const db=JSON.parse(await readFile(join(f.directory,artDigest('A')+'.tasks.json'),'utf8'));
  assert.equal(db.outbox.length,1);assert.equal(db.outbox[0].evidence.length,2);assert.deepEqual(new Set(db.outbox[0].evidence.map(v=>v.feedback)),new Set(['satisfied','unsatisfied']));
  assert(!JSON.stringify(f.sent).includes('userRequest'));assert(!JSON.stringify(f.sent).includes('data:image/'));assert(!JSON.stringify(f.sent).includes('"prompt"'));
});
test('an actual revision needs different result and prompt plus explicit positive feedback to count as progress',async t=>{
  const f=await fixture(t),a=await complete(f.learning,{resultSHA256:artDigest(Buffer.from(PNG.split(',')[1],'base64'))});
  await f.learning.command({action:'feedback',taskId:a.session.taskId,resultId:a.resultId,message:'人物没问题，主要是光影不对。'});
  const p=request();p.images.push({role:'result',dataUrl:PNG});p.contextFingerprint=computeArtAgentFingerprint(p);
  const b=await complete(f.learning,{payload:p,prompt:'new corrected brief',resultSHA256:'b'.repeat(64)});
  await f.learning.command({action:'feedback',taskId:b.session.taskId,resultId:b.resultId,message:'最终采用这张'});await tick();
  const db=JSON.parse(await readFile(join(f.directory,artDigest('A')+'.tasks.json'),'utf8'));
  const proof=db.outbox.flatMap(c=>c.evidence).find(e=>e.taskId===b.session.taskId);assert.equal(proof.improvement,true);assert.equal(proof.parentTaskId,a.session.taskId);
});
test('missing abstraction is filtered; personal preferences never form a separate library',async t=>{
  const f=await fixture(t),a=await complete(f.learning,{method:''});await f.learning.command({action:'feedback',taskId:a.session.taskId,resultId:a.resultId,message:'以后我都喜欢冷色。'});await tick();
  const db=JSON.parse(await readFile(join(f.directory,artDigest('A')+'.tasks.json'),'utf8'));assert.equal(db.outbox.length,0);assert.equal(db.experiences,undefined);
  await assert.rejects(f.learning.command({action:'settings',applyExperiences:true}));
});
test('runtime skill version pointer can roll back without overwriting old versions',async t=>{
  const f=await fixture(t),service=createArtSkillService(join(f.directory,'skills')),initial=await service.active();
  const next={...initial,version:'1.0.2'};await writeFile(join(f.directory,'skills','style-transfer.1.0.2.json'),JSON.stringify(next));
  await writeFile(join(f.directory,'skills','active.json'),JSON.stringify({version:next.version,sha256:next.systemSHA256}));assert.equal((await service.active()).version,next.version);
  await writeFile(join(f.directory,'skills','active.json'),JSON.stringify({version:initial.version,sha256:initial.systemSHA256}));assert.equal((await service.active()).version,initial.version);
});
test('coordinator consumes the stable shared packet exactly once while preserving tool and resource guards',async t=>{
  const f=await fixture(t);f.hub.methods=[{id:'approved-method',text:'皮肤暗面与高光分别组织。',status:'stable',scope:{skillId:'style-transfer',generationModel:'*',variant:'*',brain:'*'}}];let count=0;const events=[];
  const assistant=createStrataPromptAssistant({artLearning:f.learning,config:{expectedModel:{ids:['flash']}},lifecycle:{load:async()=>{events.push('load');return {ok:true};},unload:async()=>{events.push('unload');return {ok:true,released:true};}},fetchImpl:async(url,init)=>{
    if(url.endsWith('/v1/models'))return Response.json({data:[{id:'flash'}]});if(url.endsWith('/props'))return new Response('',{status:404});count++;
    const b=JSON.parse(init.body),content=b.messages.at(-1).content;assert(content.some(c=>c.text?.includes('sharedArtKnowledge')));const snapshot=JSON.parse(content[0].text);
    return Response.json({model:'flash',id:randomUUID(),choices:[{finish_reason:'tool_calls',message:{role:'assistant',tool_calls:[{id:'final',type:'function',function:{name:'propose_art_direction',arguments:JSON.stringify({contextFingerprint:snapshot.contextFingerprint,prompt:'Redraw <image1> using <image2>, distinguishing skin shadows and highlights.',sourceContent:'The original person remains recognizable.',renderingClass:'anime',explanation:'分别组织暗面与高光。',learningMethod:'在光色修正中分别组织受光面、暗面和高光。'})}}]}}]});}});
  const response=await assistant.artAgentChat(request());assert.equal(response.ok,true);assert.equal(count,1);assert.deepEqual(events,['load','unload']);assert.deepEqual(response.data.learning.appliedExperienceIds,['approved-method']);assert.equal(response.resourcesReleased,true);assert.equal(response.data.proposal.negativePrompt,'keep negative');
});
test('feedback classification never treats continuing work as satisfaction',()=>{for(const [value,state] of [['这次效果很好。','satisfied'],['不太满意','unsatisfied'],['人物没问题，主要是光影不对。','revision'],['最终采用这张','adopted'],['再来一张','unrated']])assert.equal(classifyArtFeedback(value),state);});
