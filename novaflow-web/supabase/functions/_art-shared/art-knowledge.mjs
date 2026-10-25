// GENERATED COPY - source: packages/shared/src/art-knowledge.mjs
import {sha256Hex} from './tokens.mjs';
// Brain-independent, method-only shared knowledge API. Source task records and
// personal preferences are deliberately outside this protocol.
export function createArtKnowledgeRoutes({store,requireUser,requireWorker,HttpError}) {
  const fail=(status,message)=>{throw new HttpError(status,'art-knowledge-invalid',message);};
  const shape=(value,keys)=>value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).every(k=>keys.includes(k));
  const scalar=value=>typeof value==='string' && /^[A-Za-z0-9*_.:-]{1,100}$/.test(value);
  const skill=value=>['style-transfer','image-creation'].includes(value);
  function candidate(value) {
    if(!shape(value,['schema','key','scope','method','status','evidence']) || value.schema!=='nf.art.method-candidate.v1' || value.status!=='candidate'
      || !shape(value.scope,['skillId','generationModel','variant','brain']) || Object.keys(value.scope).length!==4
      || !skill(value.scope.skillId) || !Object.values(value.scope).every(scalar)
      || typeof value.method!=='string' || !value.method.trim() || value.method.length>600
      || /data:image\/|https?:\/\/|Bearer\s|我(?:个人)?(?:喜欢|偏好)|我的(?:照片|名字|账号)/i.test(value.method)
      || !Array.isArray(value.evidence) || value.evidence.length<1 || value.evidence.length>20)fail(400,'only abstract professional methods and bounded evidence are accepted');
    const evidence=value.evidence.map(item=>{
      if(!shape(item,['taskId','parentTaskId','resultSHA256','previousResultSHA256','feedback','skillVersion','improvement'])
        || typeof item.taskId!=='string' || !/^[A-Za-z0-9_-]{1,128}$/.test(item.taskId)
        || !/^[a-f0-9]{64}$/.test(item.resultSHA256||'') || !['satisfied','adopted','unsatisfied','revision'].includes(item.feedback)
        || typeof item.improvement!=='boolean')fail(400,'invalid task-result evidence');
      return {taskId:item.taskId,resultSHA256:item.resultSHA256,feedback:item.feedback,improvement:item.improvement};
    });
    return {scope:value.scope,method:value.method.trim(),evidence};
  }
  return {async handle({method,path,headers,query,body}) {
    if(!path.startsWith('/api/web/art-knowledge'))return null;
    const isRead=method==='GET' && path==='/api/web/art-knowledge';
    const token=String(headers.authorization||headers.Authorization||'').replace(/^Bearer\s+/i,'');
    const principal=isRead && token.startsWith('nfw_')?await requireWorker(headers):await requireUser(headers);
    if(typeof store.readArtKnowledge!=='function')fail(503,'shared art knowledge is not enabled');
    if(isRead){if(!skill(query.skillId))fail(400,'invalid art skill');return {ok:true,...await store.readArtKnowledge(query.skillId,query.knownVersion)};}
    if(method==='GET'&&path==='/api/web/art-knowledge/publisher')return {ok:true,publisher:await store.isArtPublisher(principal.id)};
    if(path==='/api/web/art-knowledge/consent') {
      if(method==='GET')return {ok:true,allowed:await store.getArtLearningConsent(principal.id)};
      if(method==='POST'&&shape(body,['allow'])&&typeof body.allow==='boolean'){await store.setArtLearningConsent(principal.id,body.allow);return {ok:true,allowed:body.allow};}
      fail(400,'invalid sharing consent');
    }
    if(method==='POST' && path==='/api/web/art-knowledge/candidates') {
      const input=candidate(body);if(!await store.getArtLearningConsent(principal.id))fail(403,'shared learning consent is required');
      return {ok:true,...await store.submitArtMethod(principal.id,input)};
    }
    const publisher=await store.isArtPublisher(principal.id);
    if(principal.role!=='admin'&&!publisher)fail(403,'owner or administrator review is required');
    if(method==='GET'&&path==='/api/web/art-knowledge/review'){if(!publisher)fail(403,'publisher owner required');return {ok:true,review:await store.getArtReview()};}
    if(method==='GET' && path==='/api/web/art-knowledge/candidates')return {ok:true,candidates:await store.listArtCandidates()};
    if(['/api/web/art-knowledge/publish','/api/web/art-knowledge/rollback','/api/web/art-knowledge/prepare'].includes(path)
      && !publisher)fail(403,'only the configured publisher owner may approve a release');
    if(method==='POST' && ['/api/web/art-knowledge/prepare','/api/web/art-knowledge/publish','/api/web/art-knowledge/rollback'].includes(path)) {
      const rollback=path.endsWith('/rollback'),prepare=path.endsWith('/prepare');
      if(!shape(body,rollback?['skillId','version']:['skillId','version','candidateIds','validation','skill',...(prepare?[]:['approval'])]) || !skill(body.skillId)
        || typeof body.version!=='string' || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(body.version))fail(400,'invalid skill release');
      if(rollback)return {ok:true,...await store.rollbackArtKnowledge(principal.id,body)};
      if(!shape(body.validation,['passed','benchmarkSHA256','cases']) || body.validation.passed!==true
        || !/^[a-f0-9]{64}$/.test(body.validation.benchmarkSHA256||'') || !Number.isInteger(body.validation.cases)||body.validation.cases<1)fail(400,'fixed benchmark acceptance is required');
      if(body.skill && (body.skill.schema!=='nf.art.skill.v1'||body.skill.status!=='stable'||body.skill.id!==body.skillId||body.skill.version!==body.version
        || typeof body.skill.systemPrompt!=='string'||body.skill.systemPrompt.length>24000||await sha256Hex(body.skill.systemPrompt)!==body.skill.systemSHA256))fail(400,'invalid professional skill version');
      const active=await store.readArtKnowledge(body.skillId),rows=(await store.listArtCandidates()).filter(c=>c.scope.skillId===body.skillId);
      const normalized=v=>v.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\s]/gu,'');
      const scopeKey=s=>JSON.stringify(['skillId','generationModel','variant','brain'].map(k=>s[k]));
      const known=new Set(active.methods.map(m=>scopeKey(m.scope)+'\n'+normalized(m.text)));
      const excluded=[],eligible=[];
      for(const row of rows) {
        const reason=known.has(scopeKey(row.scope)+'\n'+normalized(row.method))?'already-published':Number(row.positive_count)<1?'no-positive-evidence':null;
        if(reason)excluded.push({id:row.id,reason});
        else eligible.push({...row,reviewNotes:[...(row.negative_count?['conflicting-feedback']:[]),...(row.positive_users<2?['single-user-evidence']:[]),'fixed-benchmark-and-owner-review-required']});
      }
      const ids=body.candidateIds??(prepare?eligible.slice(0,20).map(c=>c.id):null);
      if(!Array.isArray(ids)||ids.length>20||ids.some(id=>!/^[a-f0-9-]{36}$/i.test(id))||new Set(ids).size!==ids.length)fail(400,'invalid candidate selection');
      const selected=ids.map(id=>eligible.find(c=>c.id===id));
      if(selected.some(c=>!c))fail(409,'selected candidates are no longer eligible; prepare a fresh review');
      if(!prepare&&selected.length<1)fail(400,'nothing approved for publication');
      const ordered=[...selected].sort((a,b)=>a.id.localeCompare(b.id));
      const batch={skillId:body.skillId,version:body.version,baseVersion:active.version,
        candidates:ordered.map(c=>({id:c.id,method:c.method,scope:c.scope,evidenceFingerprint:c.evidence_fingerprint})),
        validation:body.validation,skill:body.skill||null};
      const batchSHA256=await sha256Hex(JSON.stringify(batch));
      if(prepare){const report={ok:true,status:'awaiting-owner-approval',batchSHA256,baseVersion:active.version,
        selected:ordered,excluded,remaining:eligible.length-selected.length,
        publishRequest:{skillId:body.skillId,version:body.version,candidateIds:ids,validation:body.validation,...(body.skill?{skill:body.skill}:{})}};await store.saveArtReview(principal.id,report);return report;}
      if(!shape(body.approval,['approved','batchSHA256'])||body.approval.approved!==true||body.approval.batchSHA256!==batchSHA256)fail(409,'explicit owner approval for this exact unchanged batch is required');
      return {ok:true,...await store.publishArtKnowledge(principal.id,{...body,candidateIds:ids,validation:{...body.validation,
        baseVersion:active.version,evidenceFingerprints:Object.fromEntries(ordered.map(c=>[c.id,c.evidence_fingerprint])),
        ownerApproved:true,approvedBy:principal.id,approvalSHA256:batchSHA256}})};
    }
    fail(404,'unknown shared art knowledge route');
  }};
}
