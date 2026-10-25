import {createClient} from 'npm:@supabase/supabase-js@2.108.2';
import {createControlPlane} from './control-plane.mjs';
import {resolveControlSecret} from './tokens.mjs';
import {RELEASE_VERSION} from './release.mjs';
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,POST,OPTIONS','cache-control':'no-store'};
// Production and QA share this exact implementation. QA has separate tables,
// RPC names and owner policy; its releases never enter production cache reads.
export async function serveArtKnowledge({name,qa=false}:{name:string,qa?:boolean}) {
 const env=(key:string)=>String(Deno.env.get(key)||'').trim();
 const client=createClient(env('NOVAFLOW_SUPABASE_URL')||env('SUPABASE_URL'),env('NOVAFLOW_SUPABASE_SERVICE_ROLE_KEY')||env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false}});
 const table=(suffix:string)=>(qa?'qa_art_':'art_')+suffix;
 const rpc=(suffix:string)=>(qa?'novaflow_art_qa_':'novaflow_art_')+suffix;
 const result=({data,error}:any)=>{if(error)throw error;return data;};
 const store={
  async getUserById(id:string){return result(await client.from('users').select('id,role,status,expires_at').eq('id',id).maybeSingle());},
  async getUserSession(id:string){return result(await client.from('user_sessions').select('id,user_id,revoked_at').eq('id',id).maybeSingle());},
  async getWorkerById(id:string){return result(await client.from('gpu_workers').select('id,owner_id,status').eq('id',id).maybeSingle());},
  async readArtKnowledge(skillId:string,knownVersion?:string){const row=result(await client.from(table('knowledge_releases')).select('version,methods,skill').eq('skill_id',skillId).eq('active',true).maybeSingle());return row&&row.version===knownVersion?{version:row.version,unchanged:true}:row||{version:'0',methods:[]};},
  async isArtPublisher(id:string){return Boolean(result(await client.from(table('knowledge_policy')).select('singleton').eq('publisher_user_id',id).maybeSingle()));},
  async getArtLearningConsent(id:string){return result(await client.from(table('learning_consents')).select('allowed').eq('user_id',id).maybeSingle())?.allowed===true;},
  async setArtLearningConsent(id:string,allowed:boolean){result(await client.from(table('learning_consents')).upsert({user_id:id,allowed,updated_at:new Date().toISOString()}));},
  async submitArtMethod(id:string,input:any){return result(await client.rpc(rpc('submit_method'),{p_user_id:id,p_scope:input.scope,p_method:input.method,p_evidence:input.evidence}));},
  async submitArtOutcome(id:string,input:any){return result(await client.rpc(rpc('submit_outcome'),{p_user_id:id,p_method_ids:input.appliedMethodIds,p_evidence:input.evidence}));},
  async listArtReleases(){return result(await client.rpc(rpc('release_history')))||[];},
  async listArtCandidates(){return result(await client.rpc(rpc('review_candidates')))||[];},
  async saveArtReview(id:string,report:any){result(await client.from(table('knowledge_reviews')).update({state:'outdated'}).eq('state','pending').eq('report->publishRequest->>skillId',report.publishRequest.skillId).neq('batch_sha256',report.batchSHA256));result(await client.from(table('knowledge_reviews')).upsert({batch_sha256:report.batchSHA256,report,prepared_by:id},{onConflict:'batch_sha256'}));},
  async getArtReview(){return result(await client.from(table('knowledge_reviews')).select('report').eq('state','pending').order('created_at',{ascending:false}).limit(1).maybeSingle())?.report||null;},
  async publishArtKnowledge(id:string,input:any){return result(await client.rpc(rpc('publish_knowledge'),{p_admin_id:id,p_skill_id:input.skillId,p_version:input.version,p_candidate_ids:input.candidateIds,p_validation:input.validation,p_skill:input.skill||null}));},
  async rollbackArtKnowledge(id:string,input:any){return result(await client.rpc(rpc('rollback_knowledge'),{p_admin_id:id,p_skill_id:input.skillId,p_version:input.version}));}
 };
 const sessionSecret=env('NOVAFLOW_SESSION_SECRET'),controlSecret=await resolveControlSecret({sessionSecret,controlSecret:env('NOVAFLOW_WEB_CONTROL_SECRET')});
 const plane=createControlPlane({store,secrets:{sessionSecret,controlSecret},logger:()=>{}});
 const json=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{...cors,'content-type':'application/json'}});
 Deno.serve(async request=>{
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  const url=new URL(request.url);let path=url.pathname;
  for(const prefix of ['/functions/v1/'+name,'/'+name])if(path.startsWith(prefix+'/')||path===prefix){path=path.slice(prefix.length)||'/';break;}
  if(request.method==='GET'&&path==='/health')return json(200,{ok:true,service:name,releaseVersion:RELEASE_VERSION,channel:qa?'qa':'stable'});
  if(!path.startsWith('/api/web/art-knowledge'))return json(404,{ok:false,error:'unknown knowledge route'});
  try{
   const text=request.method==='POST'?await request.text():'';if(new TextEncoder().encode(text).length>128*1024)return json(413,{ok:false,error:'knowledge request too large'});
   const response=await plane.handle({method:request.method,path,headers:Object.fromEntries(request.headers),query:Object.fromEntries(url.searchParams),body:text?JSON.parse(text):{}});
   return json(response.status,response.body);
  }catch{return json(400,{ok:false,error:'invalid knowledge request'});}
 });
}
