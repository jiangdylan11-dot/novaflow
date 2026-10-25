(function(root){
 'use strict';
 const api=()=>root.electronAPI||{},id='nf-art-knowledge-review';
 const node=(tag,text,style)=>{const e=document.createElement(tag);if(text)e.textContent=text;if(style)e.style.cssText=style;return e;};
 async function open(){
  if(document.getElementById(id))return;
  const dialog=node('dialog',null,'width:min(900px,92vw);max-height:85vh;background:#212121;color:#ddd;border:1px solid #555;border-radius:10px;padding:20px;font:13px/1.7 "Microsoft YaHei",sans-serif;overflow:auto');dialog.id=id;
  const top=node('div',null,'display:flex;gap:12px;align-items:center'),title=node('h2','专业经验审核','font-size:17px;flex:1;margin:0'),close=node('button','关闭');top.append(title,close);dialog.append(top);
  close.onclick=()=>{dialog.close();dialog.remove();};
  const note=node('p','正在读取待审清单…'),content=node('div'),actions=node('div',null,'display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:16px');dialog.append(note,content,actions);document.body.append(dialog);dialog.showModal();
  const button=(text,fn)=>{const e=node('button',text,'background:#333;color:#ddd;border:1px solid #666;border-radius:5px;padding:7px 12px;cursor:pointer');e.onclick=fn;return e;};
  let report=null,selected=[],candidates=[];
  async function showReport(value){
   report=value;content.replaceChildren();actions.replaceChildren();
   if(!report){note.textContent='暂无通过基准的待发布批次。候选需要验证，不会自动发布。';
    const listing=await api().artKnowledgeCandidates();candidates=listing.candidates||[];selected=candidates.filter(c=>c.positive_count>0).slice(0,20).map(c=>c.id);
    for(const c of candidates.slice(0,50)){const row=node('label',null,'display:block;border-bottom:1px solid #3c3c3c;padding:10px 0'),check=node('input');check.type='checkbox';check.checked=selected.includes(c.id);check.disabled=c.positive_count<1;
      check.onchange=()=>{selected=check.checked?[...selected,c.id]:selected.filter(id=>id!==c.id);};row.append(check,node('span',' '+c.method),node('small',` 满意/采用 ${c.positive_count}；不满意/修改 ${c.negative_count}`,'display:block;color:#aaa'));content.append(row);}
    const version=node('input');version.placeholder='待发布经验版本，例如 1.0.2';version.setAttribute('aria-label','待发布经验版本');version.style.cssText='background:#181818;color:#ddd;border:1px solid #555;padding:7px;width:220px';
    const file=node('input');file.type='file';file.accept='.json,application/json';file.setAttribute('aria-label','通过的固定基准记录');
    actions.append(version,file,button('筛选并准备待审清单',async()=>{try{
      const input=file.files?.[0];if(!input||input.size>128*1024)throw Error('请选择通过的固定基准 JSON 记录');const bytes=await input.arrayBuffer(),benchmark=JSON.parse(new TextDecoder().decode(bytes));
      if(benchmark.passed!==true||!Array.isArray(benchmark.cases)||benchmark.cases.length<1)throw Error('固定基准尚未通过，本次不发布');
      if(selected.length<1||selected.length>20)throw Error('每批请选择 1 至 20 条有正面证据的方法');
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
      await showReport(await api().artKnowledgePrepare({skillId:'style-transfer',version:version.value.trim(),candidateIds:selected,validation:{passed:true,cases:benchmark.cases.length,benchmarkSHA256:hash}}));
    }catch(error){note.textContent=error.message||'准备失败';}}));return;
   }
   const input=report.publishRequest;note.textContent=`等待本人确认：${report.baseVersion} → ${input.version}，本批 ${report.selected.length} 条；自动过滤 ${report.excluded.length} 条。`;
   for(const c of report.selected){const row=node('div',null,'border:1px solid #444;border-radius:6px;margin:10px 0;padding:12px');row.append(node('p',c.method,'margin:0 0 6px;color:#eee'),node('div',`适用：${c.scope.generationModel} / ${c.scope.variant}；满意/采用 ${c.positive_count}，不满意/修改 ${c.negative_count}`),node('small',c.reviewNotes.map(note=>({'conflicting-feedback':'有相反评价，请重点核对','single-user-evidence':'目前仅单个用户提供正面证据','fixed-benchmark-and-owner-review-required':'需要基准验证和本人批准'})[note]||note).join('，'),'color:#d6ba8b'));content.append(row);}
   content.append(node('p',`基准案例 ${input.validation.cases}；基准摘要 ${input.validation.benchmarkSHA256}`,'overflow-wrap:anywhere;color:#aaa'),node('p','本批摘要 '+report.batchSHA256,'overflow-wrap:anywhere;color:#aaa'));
   const label=node('label'),check=node('input');check.type='checkbox';label.append(check,node('span',' 我已核对本批方法及基准结果，同意发布'));content.append(label);
   const publish=button('确认发布本批经验',async()=>{publish.disabled=true;try{await api().artKnowledgePublish({...input,approval:{approved:true,batchSHA256:report.batchSHA256}});note.textContent='本批已发布，客户端将在后台同步。';actions.replaceChildren();if(report.baseVersion!=='0')actions.append(button('回退到 '+report.baseVersion,async()=>{try{await api().artKnowledgeRollback({skillId:input.skillId,version:report.baseVersion});note.textContent='已回退到 '+report.baseVersion;}catch(error){note.textContent=error.message;}}));}catch(error){note.textContent='未发布：'+(error.message||'清单已变化，请重新筛选');publish.disabled=false;}});publish.disabled=true;check.onchange=()=>{publish.disabled=!check.checked||!report.selected.length;};actions.append(publish,button('重新读取',load),button('重新筛选候选',()=>void showReport(null)));
  }
  async function load(){try{const state=await api().artKnowledgeState();if(!state.publisher)throw Error('只有项目发布人可以审核发布');const response=await api().artKnowledgeReview();await showReport(response.review);}catch(error){note.textContent=error.message||'读取失败';}}
  await load();
 }
 root.NovaFlowArtKnowledgeReview=Object.freeze({open});
})(globalThis);
