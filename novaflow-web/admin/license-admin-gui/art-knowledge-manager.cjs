// Runs in the admin main process only. Uses the same locally configured
// Supabase management credentials as the other admin tools, never a user login.
const {pathToFileURL}=require('node:url');
const path=require('node:path');
class ArtManagementError extends Error {constructor(status,code,message){super(message);this.status=status;this.code=code;}}
function createArtKnowledgeManager({getClient}) {
 const result=({data,error})=>{if(error)throw Error(error.message);return data;};
 return {async request(operation,body){
  const methods={candidates:'GET',releases:'GET',review:'GET',prepare:'POST',publish:'POST',rollback:'POST'};
  if(!Object.hasOwn(methods,operation))throw Error('不支持的经验管理操作');
  const client=getClient();if(!client)throw Error('请先在后台管理工具中配置 Supabase 管理连接');
  const {createArtKnowledgeRoutes}=await import(pathToFileURL(path.join(__dirname,'art-shared/art-knowledge.mjs')).href);
  const store={
   async readArtKnowledge(skillId){return result(await client.from('art_knowledge_releases').select('version,methods,skill').eq('skill_id',skillId).eq('active',true).maybeSingle())||{version:'0',methods:[]};},
   async listArtReleases(){return result(await client.rpc('novaflow_art_release_history'))||[];},
   async listArtCandidates(){return result(await client.rpc('novaflow_art_review_candidates'))||[];},
   async getArtReview(){return result(await client.from('art_knowledge_reviews').select('report').eq('state','pending').order('created_at',{ascending:false}).limit(1).maybeSingle())?.report||null;},
   async saveArtReview(_id,report){
    result(await client.from('art_knowledge_reviews').update({state:'outdated'}).eq('state','pending').eq('report->publishRequest->>skillId',report.publishRequest.skillId).neq('batch_sha256',report.batchSHA256));
    result(await client.from('art_knowledge_reviews').upsert({batch_sha256:report.batchSHA256,report,prepared_by:null,prepared_via:'admin-tool'},{onConflict:'batch_sha256'}));
   },
   async publishArtKnowledge(_id,input){return result(await client.rpc('novaflow_art_publish_knowledge',{p_admin_id:null,p_skill_id:input.skillId,p_version:input.version,p_candidate_ids:input.candidateIds,p_validation:input.validation,p_skill:input.skill||null}));},
   async rollbackArtKnowledge(_id,input){return result(await client.rpc('novaflow_art_rollback_knowledge',{p_admin_id:null,p_skill_id:input.skillId,p_version:input.version}));}
  };
  const routes=createArtKnowledgeRoutes({store,management:true,HttpError:ArtManagementError});
  return routes.handle({method:methods[operation],path:'/api/web/art-knowledge/'+operation,headers:{},query:{},body:body||{}});
 }};
}
module.exports={createArtKnowledgeManager};
