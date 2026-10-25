// Production adapter for the measured native catalog chain. CPU actions are
// packaged with the assistant; only this worker submits local model tasks.
import { randomUUID, createHash } from 'node:crypto';
import { UI_CATALOG_MODEL, buildUiCatalogGraph, inferUiGraph } from './ui-catalog-planner.mjs';
export const NATIVE_UI_PLANNER = 'native-catalog-v3';
export const NATIVE_UI_METHOD = 'native-source-catalog-v3';
const sha = text => createHash('sha256').update(text).digest('hex');

export async function planNativeUiDraft({baseUrl,payload,cpu,infer,fetchImpl=fetch,pollMs=1000,timeoutMs=300000,isCancelled=()=>false}) {
  if(infer!==undefined&&typeof infer!=='function')throw new Error('UI 原生推理接口无效');
  const images=payload.images,request=String(payload.currentPrompt||'').trim();
  if(payload.uiCatalogResume||payload.uiDraftResume)throw new Error('本次设计不接受旧分析答案');
  if(!Array.isArray(images)||!images.length||images.length>10)throw new Error('请提供有效布局参考图');
  const layouts=images.flatMap((ref,i)=>ref.role==='layout'?[i]:[]);
  if(layouts.length!==1)throw new Error('完整UI设计需要一张明确的布局参考图');
  if(!request||request.length>18000)throw new Error('请填写有效设计要求');
  const index=layouts[0],base=String(baseUrl).replace(/\/+$/,''),ids=[],timings=[],raws={},sourceIds={};
  let stage='prepare-reference',dispatchClientId='',sourceFocusCalls=0,artRetryCalls=0,artRetryProof=null,analysisModel=infer?'':UI_CATALOG_MODEL;
  const nativeImages=new Map();
  const active=()=>{if(isCancelled()||payload.signal?.aborted)throw new Error('任务已中止；未提交后续分析或生图');};
  const json=async(path,init={})=>{
    const r=await fetchImpl(base+path,{...init,signal:AbortSignal.timeout(30000)});
    if(!r.ok)throw new Error('本地模型接口 HTTP '+r.status);
    return r.json();
  };
  const idle=async()=>{active();const q=await json('/queue');
    if(!Array.isArray(q.queue_running)||!Array.isArray(q.queue_pending))throw new Error('无法核对GPU队列；未提交分析');
    if(q.queue_running.length||q.queue_pending.length)throw new Error('其他任务正在使用GPU，请等待完成；未重复提交');};
  const upload=async(dataUrl)=>{
    if(infer){active();const name='native-ui-'+randomUUID();nativeImages.set(name,dataUrl);return name;}
    active();const form=new FormData(),mime=dataUrl.slice(5,dataUrl.indexOf(';'));
    form.append('image',new Blob([Buffer.from(dataUrl.split(',')[1],'base64')],{type:mime}),'NF_UI_NATIVE_'+randomUUID()+'.png');form.append('overwrite','false');
    const reply=await json('/upload/image',{method:'POST',body:form});if(!reply.name)throw new Error('参考图上传结果未确认');
    return (reply.subfolder?reply.subfolder+'/':'')+reply.name;
  };
  const names={};
  const addViews=async views=>{for(const [key,data] of Object.entries(views))names[key]=await upload(data);};
  const bindViews=graph=>{
    graph=structuredClone(graph);
    for(const node of Object.values(graph)){
      if(node.class_type==='LoadImage'){
        const key=String(node.inputs.image).match(/^__native_(.+)__$/)?.[1];
        if(key){if(!names[key])throw new Error('缺少本次参考视图：'+key);node.inputs.image=names[key];}
      }
      if(typeof node.inputs?.filename_prefix==='string')node.inputs.filename_prefix='NF_UI_NATIVE_'+randomUUID();
    }
    return graph;
  };
  const execute=async graph=>{
    active();if(ids.length>=6)throw new Error('已达到本次有界分析上限；未提交生图');
    if(infer){
      const result=await inferUiGraph(infer,bindViews(graph),{resolveImage:name=>nativeImages.get(name),stage,signal:payload.signal,isCancelled});
      if(analysisModel&&analysisModel!==result.model)throw new Error('UI 分析会话的实际模型发生变化；未提交生图');
      analysisModel=result.model;ids.push(result.requestId);
      timings.push({stage,promptId:result.requestId,requestId:result.requestId,model:result.model,wallMs:result.wallMs,budget:result.budget,...(result.syntaxProjection?{syntaxProjection:result.syntaxProjection}:{}),rawChars:result.text.length,...(result.usage?{usage:result.usage}:{}),...(result.timing?{timing:result.timing}:{})});
      return result.text;
    }
    await idle();dispatchClientId='novaflow-native-ui-'+randomUUID();const start=Date.now();
    const sent=await json('/prompt',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({client_id:dispatchClientId,prompt:bindViews(graph)})});
    if(!sent.prompt_id)throw new Error('模型提交结果未确认，请核对队列；不会自动重提');
    ids.push(sent.prompt_id);
    while(Date.now()-start<timeoutMs){
      const h=(await json('/history/'+sent.prompt_id))[sent.prompt_id];
      if(h?.status?.status_str==='error')throw new Error('模型分析失败，任务 '+sent.prompt_id);
      if(h?.status?.completed){
        if(h.status.status_str!=='success')throw new Error('模型任务未成功：'+sent.prompt_id);
        const raw=h.outputs?.['4']?.text,text=Array.isArray(raw)?raw.join(''):String(raw||'');
        if(!text.trim())throw new Error('模型分析没有返回有效内容；未提交生图');
        timings.push({stage,promptId:sent.prompt_id,wallMs:Date.now()-start,rawChars:text.length});active();return text;
      }
      await new Promise(r=>setTimeout(r,pollMs));
    }
    throw new Error('分析等待超时，任务 '+sent.prompt_id+'；请先核对终态，勿重复提交');
  };
  try {
    if(!infer){await idle();const available=await json('/object_info/CLIPLoader');
      if(!available.CLIPLoader?.input?.required?.clip_name?.[0]?.includes(UI_CATALOG_MODEL))throw new Error('缺少已验证的本地PE模型，不会下载或换模型');}
    const prepared=await cpu({action:'native-ui-prepare',image:images[index]});await addViews(prepared.views);
    for(const kind of ['natural','grid','controls']){stage='source-'+kind;raws[kind]=await execute(prepared.graphs[kind]);sourceIds[kind]=ids.at(-1);}
    stage='source-projection';
    let projected=await cpu({action:'native-ui-project',raws,ids:sourceIds,focusUsed:false,image:images[index]});
    if(projected.focus){
      sourceFocusCalls=1;const focus=projected.focus;stage='source-'+focus.kind+'-focus';await addViews(focus.views);
      const text=await execute(focus.graph),key=focus.kind==='controls'?'controls_focus':'grid';raws[key]=text;sourceIds[key]=ids.at(-1);
      projected=await cpu({action:'native-ui-project',raws,ids:sourceIds,focusUsed:true,image:images[index]});
      if(projected.focus)throw new Error('结构聚焦后仍不完整，本次未提交生图');
    }
    active();stage='catalog-job';
    const bundle=await cpu({action:'native-ui-job',source:projected.source,request,sourceId:ids.at(-1),imageSha256:prepared.proof.originalSha256});
    const metadata={schema:'nf.ui.structure-catalog.v1',recognitionMethod:NATIVE_UI_METHOD,model:analysisModel,...(infer?{analysisBackend:'strata'}:{}),sourceIds,sourceFocusCalls,sourceShape:projected.source.shape,mainCount:projected.source.mains.length,sourceProof:projected.proof,sourceImage:prepared.proof,modelFieldRepairCalls:0,automaticSourceFocusLimit:1};
    if(payload.uiAnalysisStage==='source-only')return {bundle,uiCatalog:{...metadata,analysisProvider:'grok',designPending:true,promptIds:ids,timings}};
    stage='native-art';
    const artNames=[],roles=[];
    for(const [i,ref] of images.entries()){
      if(i===index)continue;
      if(!['style','color','material','content','identity','character_identity'].includes(ref.role))throw new Error('未支持的美术参考职责；未静默丢弃参考图');
      artNames.push(await upload(ref.dataUrl));roles.push({art_image_index:artNames.length,original_reference_index:i+1,role:ref.role});
    }
    // The layout is deliberately absent from the local art call. Additional
    // explicitly assigned style/identity references retain their own roles.
    if(artNames.length){bundle.job.context.art_reference_roles=roles;bundle.graph=buildUiCatalogGraph({system:bundle.graph['3'].inputs.prompt.split('<|im_start|>system\n')[1].split('<|im_end|>')[0],context:{context:bundle.job.context},images:artNames,maxLength:bundle.graph['3'].inputs.max_length});}
    let raw=await execute(bundle.graph);
    const first=await cpu({action:'native-ui-inspect-art',raw,keys:bundle.job.output_keys});
    if(first.missing.length){
      if(first.missing.length>3)throw new Error('目录缺失字段过多；本次未提交生图，不扩大重试');
      active();artRetryCalls=1;stage='native-art-catalog-retry';
      const retryGraph=structuredClone(bundle.graph);
      const rule='\n这是本请求唯一一次完整目录重试。上次缺少的键为'+first.missing.join('、')+'，本次必须包含。必须重新返回全部output_keys，不只返回遗漏字段。字段数量以output_keys为准，不能因主题名称中的数字省略条目。整体风格沿用第一次已得到的环境设计：'+String(first.catalog.ENVIRONMENT_ART||'')+'。';
      retryGraph['3'].inputs.prompt=retryGraph['3'].inputs.prompt.replace('<|im_end|>',rule+'<|im_end|>');
      const retry=await execute(retryGraph);
      const merged=await cpu({action:'native-ui-merge-art',first:raw,retry,keys:bundle.job.output_keys});raw=merged.raw;artRetryProof=merged.proof;
    }
    stage='native-compile';const compiled=await cpu({action:'native-ui-compile',bundle,raw});active();
    return {prompt:compiled.prompt,negativePrompt:'',uiCatalog:{...metadata,analysisProvider:'local',promptIds:ids,timings,providerCallCount:ids.length,artRetryCalls,artRetryProof,catalog:compiled.catalog,compileProof:compiled.proof,extraction:compiled.extraction,promptSha256:sha(compiled.prompt)},
      uiDraft:{method:NATIVE_UI_METHOD,model:analysisModel,...(infer?{analysisBackend:'strata'}:{}),originalRequirements:request,promptIds:ids,timings,source:prepared.proof},
      uiPlan:{version:1,layoutMode:'preserve',layoutReference:index+1,visualMode:'theme-redesign',references:images.map((r,i)=>({index:i+1,role:r.role==='layout'?'layout':['style','color','material'].includes(r.role)?'style':'content'})),layoutChanges:[],preserve:[],grids:[]}};
  } catch(error){error.uiCatalogDiagnostics={stage,model:analysisModel,...(infer?{analysisBackend:'strata'}:{}),promptIds:ids,timings,dispatchClientId,sourceFocusCalls,artRetryCalls,samplingSubmitted:false};throw error;}
}
