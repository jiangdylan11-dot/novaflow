(function(root){
 'use strict';
 const request=async(operation,body)=>{const response=await root.adminAPI.artKnowledgeRequest(operation,body);if(!response?.ok||!response.result?.ok)throw Error(response?.error||response?.result?.error||'后台经验服务请求失败');return response.result;};
 const api=()=>({artKnowledgeCandidates:()=>request('candidates'),artKnowledgeReleases:()=>request('releases'),artKnowledgeReview:()=>request('review'),artKnowledgePrepare:body=>request('prepare',body),artKnowledgePublish:body=>request('publish',body),artKnowledgeRollback:body=>request('rollback',body)});
 const node=(tag,text,className)=>{const e=document.createElement(tag);if(text)e.textContent=text;if(className)e.className=className;return e;};
 let started=false;
 async function open(){
  const host=document.getElementById('nf-art-knowledge-review');
  const note=document.getElementById('artKnowledgeNote');
  const content=document.getElementById('artKnowledgeContent');
  const actions=document.getElementById('artKnowledgeActions');
  if(!host||!note||!content||!actions||started)return;
  started=true;
  const button=(text,fn,primary)=>{const e=node('button',text,primary?'btn primary':'btn');e.type='button';e.onclick=fn;return e;};
  let report=null,selected=[],candidates=[],chosenSkill='style-transfer';
  async function showReport(value){
   report=value;content.replaceChildren();actions.replaceChildren();
   if(!report){note.textContent='暂无通过基准的待发布批次。候选需要验证，不会自动发布。';
    const [listing,history]=await Promise.all([api().artKnowledgeCandidates(),api().artKnowledgeReleases()]);candidates=(listing.candidates||[]).filter(c=>c.scope?.skillId===chosenSkill);selected=candidates.filter(c=>c.positive_count>0&&!c.published_before).slice(0,20).map(c=>c.id);
    const skills=node('select',null,'tableSelect');skills.setAttribute('aria-label','待审核的专业技能');for(const [value,label] of [['style-transfer','画风迁移'],['image-creation','画面创作']]){const option=node('option',label);option.value=value;skills.append(option);}skills.value=chosenSkill;skills.onchange=()=>{chosenSkill=skills.value;void showReport(null);};content.append(skills);
    for(const c of candidates.slice(0,50)){const row=node('label',null,'artCandidate'),check=node('input');check.type='checkbox';check.checked=selected.includes(c.id);check.disabled=c.positive_count<1||c.published_before;
      check.onchange=()=>{selected=check.checked?[...selected,c.id]:selected.filter(id=>id!==c.id);};const text=node('span');text.append(node('span',c.method),node('small',` ${c.published_before?'历史已发布 · ':''}满意/采用 ${c.positive_count}；不满意/修改 ${c.negative_count}`,'hint'));row.append(check,text);content.append(row);}
    if(history.releases?.length){const versions=node('select',null,'tableSelect');versions.setAttribute('aria-label','正式经验历史版本');for(const release of history.releases){const option=node('option',`${release.skill_id} / ${release.version}（${release.active?'当前':'历史'} · ${release.method_count} 条）`);option.value=release.skill_id+'@'+release.version;option.dataset.active=release.active?'true':'false';versions.append(option);}const rollback=button('回退到所选历史版本',async()=>{try{const [skillId,version]=versions.value.split('@');await api().artKnowledgeRollback({skillId,version});note.textContent='已切换到 '+version;await showReport(null);}catch(error){note.textContent='未回退：'+error.message;}});rollback.disabled=versions.selectedOptions[0]?.dataset.active==='true';versions.onchange=()=>{rollback.disabled=versions.selectedOptions[0]?.dataset.active==='true';};const versionRow=node('div',null,'actions');versionRow.append(versions,rollback);content.prepend(versionRow);}
    const version=node('input');version.placeholder='待发布经验版本，例如 1.0.2';version.setAttribute('aria-label','待发布经验版本');
    const file=node('input');file.type='file';file.accept='.json,application/json';file.setAttribute('aria-label','通过的固定基准记录');
    actions.append(version,file,button('筛选并准备待审清单',async()=>{try{
      const input=file.files?.[0];if(!input||input.size>128*1024)throw Error('请选择通过的固定基准 JSON 记录');const bytes=await input.arrayBuffer(),benchmark=JSON.parse(new TextDecoder().decode(bytes));
      if(benchmark.passed!==true||!Array.isArray(benchmark.cases)||benchmark.cases.length<1)throw Error('固定基准尚未通过，本次不发布');
      if(selected.length<1||selected.length>20)throw Error('每批请选择 1 至 20 条有正面证据的方法');
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
      await showReport(await api().artKnowledgePrepare({skillId:chosenSkill,version:version.value.trim(),candidateIds:selected,validation:{passed:true,cases:benchmark.cases.length,benchmarkSHA256:hash}}));
    }catch(error){note.textContent=error.message||'准备失败';}}));return;
   }
   const input=report.publishRequest;note.textContent=`等待本人确认：${report.baseVersion} → ${input.version}，本批 ${report.selected.length} 条；自动过滤 ${report.excluded.length} 条。`;
   for(const c of report.selected){const row=node('div',null,'artReviewCard');row.append(node('p',c.method),node('div',`适用：${c.scope.generationModel} / ${c.scope.variant}；满意/采用 ${c.positive_count}，不满意/修改 ${c.negative_count}`),node('small',c.reviewNotes.map(note=>({'conflicting-feedback':'有相反评价，请重点核对','single-user-evidence':'目前仅单个用户提供正面证据','fixed-benchmark-and-owner-review-required':'需要基准验证和本人批准'})[note]||note).join('，'),'hint'));content.append(row);}
   content.append(node('p',`基准案例 ${input.validation.cases}；基准摘要 ${input.validation.benchmarkSHA256}`,'hint'),node('p','本批摘要 '+report.batchSHA256,'hint'));
   const label=node('label'),check=node('input');check.type='checkbox';label.append(check,node('span',' 我已核对本批方法及基准结果，同意发布'));content.append(label);
   const publish=button('确认发布本批经验',async()=>{publish.disabled=true;try{await api().artKnowledgePublish({...input,approval:{approved:true,batchSHA256:report.batchSHA256}});note.textContent='本批已发布，客户端将在后台同步。';actions.replaceChildren();if(report.baseVersion!=='0')actions.append(button('回退到 '+report.baseVersion,async()=>{try{await api().artKnowledgeRollback({skillId:input.skillId,version:report.baseVersion});note.textContent='已回退到 '+report.baseVersion;}catch(error){note.textContent=error.message;}}));}catch(error){note.textContent='未发布：'+(error.message||'清单已变化，请重新筛选');publish.disabled=false;}},true);publish.disabled=true;check.onchange=()=>{publish.disabled=!check.checked||!report.selected.length;};actions.append(publish,button('重新读取',load),button('重新筛选候选',()=>void showReport(null)));
  }
  async function load(){try{const response=await api().artKnowledgeReview();await showReport(response.review);}catch(error){note.textContent=error.message||'读取失败';}}
  await load();
 }
 root.NovaFlowArtKnowledgeReview=Object.freeze({open});
 document.getElementById('artKnowledgeOpen')?.addEventListener('click',()=>void open());
})(globalThis);
