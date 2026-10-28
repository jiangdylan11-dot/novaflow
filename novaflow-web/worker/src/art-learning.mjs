import {mkdir,readFile,writeFile,rename,open,unlink,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createArtSkillService,artDigest,readArtSkill,sharedSkillForRelease} from './art-skill-service.mjs';
const need=(ok,message)=>{if(!ok)throw Object.assign(Error(message),{errorCode:'art-learning-invalid'});};
const text=(v,max=12000)=>{need(typeof v==='string' && v.length<=max && !/data:image\/|Bearer\s+[A-Za-z0-9]/i.test(v),'任务文字无效或包含内嵌素材/认证信息');return v;};
const keyFor=(scope,method)=>artDigest(JSON.stringify(['skillId','generationModel','variant','brain'].map(k=>scope[k]||'*'))+'\n'+method.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\s]/gu,''));
export function classifyArtFeedback(message){
  text(message);
  if(/不满意|不太满意|效果不好|这张不行|画风不对|不要再使用刚才那个策略/.test(message))return 'unsatisfied';
  if(/人物.{0,6}(?:不错|没问题|可以).{0,12}(?:但是|主要|只是)|画风不够|光影不对|上次的画风更准确|调整|修改|改成|太蓝|太黄/.test(message))return 'revision';
  if(/但是|不过|只是|还需|还要|希望|如果/.test(message))return 'unrated';
  // Only explicit evaluations count; questions, conditional wishes and mixed
  // corrections must never silently become positive training evidence.
  if(/^(?:这次|这张(?:图)?|这个|效果|结果)?(?:的)?(?:效果|画面)?(?:做得|做的|画得|画的)?(?:挺好(?:的)?|很好|很满意|满意|很棒|不错)(?:了)?[，,\s]*$/.test(message.trim().split(/[。！!]/)[0]))return 'satisfied';
  if(/^(?:这次|这张|这个)?(?:就用|采用|最终采用|确认采用)(?:这张|这个|本次)?[。！!]*$/.test(message.trim()))return 'adopted';
  return 'unrated';
}
// Private TASK continuity, not a personal long-term experience library.
// Shared runtime knowledge comes exclusively from the reviewed central packet.
export function createArtLearning({directory,getOwner,skillService=createArtSkillService(join(directory,'skills')),
  getKnowledge=async()=>({version:'bundled-only',methods:[]}),queueCandidate=null}){
  const queues=new Map(),owner=()=>{const id=getOwner();need(typeof id==='string'&&id.length>0&&id.length<256,'任务主体不可用');return id;};
  const fileFor=id=>join(directory,artDigest(id)+'.tasks.json');
  async function load(id){try{const path=fileFor(id);need((await stat(path)).size<=12*1024*1024,'任务记录过大');
    const db=JSON.parse(await readFile(path,'utf8'));need(db.schema==='nf.art.task-journal.v2'&&db.ownerId===id&&Array.isArray(db.tasks)&&Array.isArray(db.outbox),'任务记录损坏，原文件已保留');return db;
  }catch(e){if(e.code!=='ENOENT')throw e;return {schema:'nf.art.task-journal.v2',ownerId:id,tasks:[],outbox:[]};}}
  function mutate(id,fn){const run=(queues.get(id)||Promise.resolve()).catch(()=>{}).then(async()=>{
    await mkdir(directory,{recursive:true});const path=fileFor(id),lock=path+'.lock',tmp=path+'.'+randomUUID()+'.tmp';const handle=await open(lock,'wx');
    try{const db=await load(id),result=fn(db),bytes=JSON.stringify(db);need(Buffer.byteLength(bytes)<=12*1024*1024,'任务记录容量已满');await writeFile(tmp,bytes,{flag:'wx'});await rename(tmp,path);return structuredClone(result);}
    finally{await handle.close();await unlink(tmp).catch(()=>{});await unlink(lock);}});
    queues.set(id,run);void run.finally(()=>{if(queues.get(id)===run)queues.delete(id);}).catch(()=>{});return run;}
  function roomForContribution(db){while(db.outbox.length>=200){const index=db.outbox.findIndex(c=>c.status==='submitted');need(index>=0,'待同步反馈数量已满，未丢弃未上传记录');db.outbox.splice(index,1);}}
  async function knowledge(scope,brain){const packet=await getKnowledge({...scope,brain});
    need(packet&&typeof packet.version==='string'&&Array.isArray(packet.methods)&&packet.methods.length<=100,'共享经验包无效');
    return {version:packet.version,...(packet.skill?{skill:packet.skill}:{}),methods:packet.methods.filter(m=>m.status==='stable'&&typeof m.id==='string'&&typeof m.text==='string'&&m.text.length<=600
      && !/data:image\//i.test(m.text)&&['skillId','generationModel','variant'].every(k=>m.scope?.[k]==='*'||m.scope?.[k]===scope[k])&&(m.scope.brain==='*'||m.scope.brain===brain)).slice(0,5)};}
  async function begin(payload,brain){const id=owner(),context=payload.artContext||{},scope={skillId:payload.mode==='drawing'?'style-transfer':'image-creation',generationModel:context.engine||'',variant:context.localQwen21Variant||'standard'};
    const packet=await knowledge(scope,brain),bundled=payload.mode==='drawing'?await readArtSkill():null;
    const shared=packet.skill&&bundled?sharedSkillForRelease(packet.skill,bundled):null;
    const skill=payload.mode==='drawing'?(shared||await skillService.active()):null;
    const skillSource=skill?{kind:shared?'reviewed-shared':'local-active',version:skill.version,systemSHA256:skill.systemSHA256,
      ...(packet.skill&&!shared?{ignoredSharedSkill:{version:packet.skill.version,reason:'older-or-conflicting-with-bundled-release'}}:{})}:null;
    const task=await mutate(id,db=>{need(!db.tasks.some(t=>t.requestId===payload.requestId),'任务请求已记录');
      while(db.tasks.length>=200){const index=db.tasks.findIndex(t=>['succeeded','failed','proposed'].includes(t.execution));need(index>=0,'任务记录过多');db.tasks.splice(index,1);}
      const result=payload.images?.find(i=>['result','output'].includes(i.role)),parent=result&&db.tasks.findLast(t=>t.resultSHA256===artDigest(Buffer.from(result.dataUrl.split(',')[1],'base64')));
      const t={id:randomUUID(),ownerId:id,requestId:payload.requestId,conversationId:payload.conversationId||'',parentTaskId:parent?.id||'',userRequest:text(payload.message),contextFingerprint:payload.contextFingerprint,scope,brain,
        skillVersion:skill?.version||'agent-direct-v1',skillSHA256:skill?.systemSHA256||'',skillSource,inputReferences:(payload.images||[]).map(i=>({role:i.role,sha256:artDigest(Buffer.from(i.dataUrl.split(',')[1],'base64'))})),
        parameters:Object.fromEntries(['width','height','cfg','steps','seed','localQwen21Variant'].filter(k=>context[k]!==undefined).map(k=>[k,context[k]])),execution:'planning',feedback:'unrated',events:[],
        knowledgeVersion:packet.version,appliedExperienceIds:packet.methods.map(m=>m.id),createdAt:new Date().toISOString()};db.tasks.push(t);return t;});
    return {ownerId:id,taskId:task.id,skill,skillSource,scope,experiences:packet.methods,knowledgeVersion:packet.version};}
  async function planned(session,response){return mutate(session.ownerId,db=>{const t=db.tasks.find(t=>t.id===session.taskId);need(t,'任务记录不存在');const d=response?.data,p=d?.proposal;
    Object.assign(t,{execution:response?.ok?p?'proposed':'succeeded':'failed',conversationId:d?.conversationId||t.conversationId,error:response?.ok?'':String(response?.errorCode||'agent-failed').slice(0,160),
      proposalId:p?.proposalId||'',requestedAction:p?.action||'discussion',prompt:p?text(p.prompt):'',tools:(d?.toolTrace||[]).map(x=>x.name),brain:d?.model||t.brain});
    if(d?.inferenceStrategy)t.inferenceStrategy=d.inferenceStrategy;
    if(p?.learningMethod)t.methodCandidate=text(p.learningMethod,600);
    return {taskId:t.id,skillVersion:t.skillVersion,skillSource:t.skillSource,knowledgeVersion:t.knowledgeVersion,appliedExperienceIds:t.appliedExperienceIds};});}
  async function command(p={}){need(!['ownerId','userId','visibility','public'].some(k=>k in p),'不能在请求中指定任务所属用户或公共发布权限');const id=owner();
    if(p.action==='list')return {tasks:(await load(id)).tasks.slice(-200).reverse()};
    if(p.action==='pending')return {candidates:(await load(id)).outbox.filter(c=>c.status==='candidate').slice(0,10)};
    if(p.action==='ack')return mutate(id,db=>{const c=db.outbox.find(c=>c.key===p.key);need(c,'候选方法不存在');if(p.evidenceSHA256!==artDigest(JSON.stringify(c.evidence)))return {ok:false,stale:true};c.status='submitted';return {ok:true};});
    if(p.action==='knowledge')return knowledge(p.scope,p.brain);
    const answer=await mutate(id,db=>{const t=db.tasks.find(t=>t.id===p.taskId);need(t,'当前账号下没有该任务');
      if(p.action==='receipt'){need(t.proposalId&&t.proposalId===p.proposalId&&['applied','succeeded','failed'].includes(p.execution),'执行回执与提案不符');
        if(t.execution==='succeeded'){need(p.execution==='succeeded'&&t.resultId===p.resultId,'不能覆盖已完成的结果');return {ok:true};}
        need(['proposed','applied'].includes(t.execution),'任务不接受执行回执');if(p.execution==='succeeded')need(typeof p.resultId==='string'&&p.resultId.length<=160&&/^[a-f0-9]{64}$/.test(p.resultSHA256||''),'缺少实际结果编号或摘要');
        t.execution=p.execution;if(p.resultId){t.resultId=text(p.resultId,160);t.resultSHA256=p.resultSHA256;}return {ok:true};}
      need(p.action==='feedback','未知任务操作');need(t.execution==='succeeded'&&t.resultId&&t.resultId===p.resultId,'反馈必须关联本任务实际成图');
      const message=text(p.message),state=p.feedback||classifyArtFeedback(message);need(['satisfied','unsatisfied','revision','adopted','unrated'].includes(state),'反馈类别无效');
      t.feedback=state;t.events.push({type:'feedback',state,message,at:new Date().toISOString()});t.events=t.events.slice(-30);
      const parent=db.tasks.find(v=>v.id===t.parentTaskId),improved=['satisfied','adopted'].includes(state)&&parent&&['revision','unsatisfied'].includes(parent.feedback)&&parent.resultSHA256!==t.resultSHA256&&parent.prompt!==t.prompt;
      if(t.methodCandidate&&state!=='unrated'){const scope={...t.scope,brain:'*'},key=keyFor(scope,t.methodCandidate),evidence={taskId:t.id,parentTaskId:parent?.id||'',resultSHA256:t.resultSHA256,previousResultSHA256:parent?.resultSHA256||'',feedback:state,skillVersion:t.skillVersion,improvement:Boolean(improved)};
        const existing=db.outbox.find(v=>v.key===key);
        if(existing){if(!existing.evidence.some(v=>v.taskId===t.id))existing.evidence.push(evidence);else existing.evidence[existing.evidence.findIndex(v=>v.taskId===t.id)]=evidence;existing.evidence=existing.evidence.slice(-20);existing.status='candidate';}
        else{roomForContribution(db);db.outbox.push({schema:'nf.art.method-candidate.v1',key,scope,method:t.methodCandidate,status:'candidate',evidence:[evidence]});}}
      if(t.appliedExperienceIds?.length&&state!=='unrated'){
        const outcome={schema:'nf.art.method-outcome.v1',key:artDigest('outcome:'+t.id),status:'candidate',appliedMethodIds:t.appliedExperienceIds.slice(0,5),
          evidence:{taskId:t.id,resultSHA256:t.resultSHA256,feedback:state,improvement:Boolean(improved)}};
        const index=db.outbox.findIndex(c=>c.key===outcome.key);if(index>=0)db.outbox[index]=outcome;else{roomForContribution(db);db.outbox.push(outcome);}
      }
      return {feedback:state};});
    // Only a configured, consent-aware adapter can transmit this abstract outbox.
    // Never pass private task prompts/chat/images to a shared learning service.
    if(p.action==='feedback'&&queueCandidate)void(async()=>{const db=await load(id);for(const c of db.outbox.filter(c=>c.status==='candidate')){
      const packet=c.schema==='nf.art.method-outcome.v1'?null:await knowledge(c.scope,'*'),known=packet?.methods.some(m=>keyFor(m.scope,m.text)===c.key),sent=known?{accepted:true}:await queueCandidate(c);
      if(sent?.accepted)await mutate(id,state=>{const item=state.outbox.find(v=>v.key===c.key);if(item&&JSON.stringify(item.evidence)===JSON.stringify(c.evidence))item.status='submitted';return {ok:true};});}})().catch(()=>{});
    return answer;}
  return {begin,planned,command};
}
