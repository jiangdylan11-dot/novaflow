import {mkdir,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {filterArtCandidates} from '../packages/shared/src/art-knowledge.mjs';

// Server/admin-only, read-only preparation. The key comes from local server
// environment and is never written to the report or the public site.
export async function prepareDeploymentArtReview({outputPath,qa=false,env=process.env,fetchImpl=fetch}={}) {
  const url=env.NOVAFLOW_SUPABASE_URL,key=env.NOVAFLOW_SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)throw Error('发布前经验筛选需要本机后台只读查询配置；不会自动发布经验');
  if(new URL(url).protocol!=='https:')throw Error('Supabase 后台查询必须使用 HTTPS');
  const table=qa?'qa_art_':'art_',rpc=qa?'novaflow_art_qa_':'novaflow_art_';
  async function query(path,body){const response=await fetchImpl(url.replace(/\/+$/,'')+'/rest/v1/'+path,{method:body?'POST':'GET',headers:{apikey:key,authorization:'Bearer '+key,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('发布前经验只读筛选失败：HTTP '+response.status);return response.json();}
  const [rows,releases]=await Promise.all([query('rpc/'+rpc+'review_candidates',{}),query(table+'knowledge_releases?active=eq.true&select=skill_id,version,methods')]);
  const skills=['style-transfer','image-creation'].map(skillId=>{
    const active=releases.find(r=>r.skill_id===skillId)||{version:'0',methods:[]};
    return {skillId,activeVersion:active.version,...filterArtCandidates({rows,active,skillId})};
  });
  const report={schema:'nf.art.deployment-review.v1',createdAt:new Date().toISOString(),channel:qa?'qa':'stable',readOnly:true,published:false,
    status:skills.some(s=>s.eligible.length)?'awaiting-owner-review':'no-new-eligible-methods',skills};
  await mkdir(dirname(outputPath),{recursive:true});await writeFile(outputPath,JSON.stringify(report,null,2));
  const text=['# 部署前专业经验筛选','', '此报告只读生成，未发布任何经验。候选须经过基准验证及本人明确批准后才能发布。',''];
  for(const skill of skills){text.push(`## ${skill.skillId}（当前 ${skill.activeVersion}）`,'',`待审 ${skill.eligible.length} 条，过滤 ${skill.excluded.length} 条，已发布方法需复核 ${skill.monitor.length} 条。`,'');for(const row of skill.eligible)text.push(`- ${row.method}\n  正面 ${row.positive_count}，反面 ${row.negative_count}；${row.id}`);for(const row of skill.monitor)text.push(`- [复核] ${row.method}\n  正面 ${row.positive_count}，反面 ${row.negative_count}；仅提示本人复核，不自动更改正式版本。`);text.push('');}
  await writeFile(outputPath+'.md',text.join('\n'));return {outputPath,status:report.status,eligible:skills.reduce((n,s)=>n+s.eligible.length,0),published:false};
}
