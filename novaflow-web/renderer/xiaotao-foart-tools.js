(function(root){
  'use strict';
  const fail=message=>{throw new Error(message);},copy=v=>JSON.parse(JSON.stringify(v)),sleep=ms=>new Promise(r=>root.setTimeout(r,ms));
  const ART_SETTINGS=['provider','mode','prompt','negativePrompt','width','height','steps','cfg','seed','randomSeed','count','nsfw','samplingOverrides','loras','localDrawEngine','localQwen21Variant','drawingTask','drawingAnalysisEngine','localTextQuality','localEditStrength','localUiEngine','gptQualityTxt2img','gptQualityImg2img','gptSize','gptCustomWidth','gptCustomHeight','uiRunIntent','uiPreserveLayout','uiLayoutMode','uiNativeEditPrompt','iterationReferenceCount'];
  const artSettings=state=>Object.fromEntries(ART_SETTINGS.filter(key=>state[key]!==undefined).map(key=>[key,state[key]]));
  const contract=()=>root.NovaFlowFoartToolContract;
  const SCOPE='[data-novaflow-art-drawing-host="1"],[data-novaflow-art-ui-host="1"],#novaflow-art-generate-workspace,#novaflow-spine-split-workspace-overlay,#novaflow-spine-split-right-workspace,[data-novaflow-spine-split],#novaflow-audio-studio,[data-novaflow-ai-main-stage="1"],[data-novaflow-ai-resource-card="1"],[data-novaflow-ai-bottom-workspace="1"],[data-nf-color-correction-panel],[data-novaflow-ai-cutout-detail],[data-novaflow-ai-cutout-edit-canvas],[data-novaflow-ai-settings-fields],[data-novaflow-ai-top-mode-tabs],[data-novaflow-ai-generation-panel],[data-nf-ve-shell],.nf-ve-shell,[data-novaflow-ai-tool-heading],[data-novaflow-ai-mode-section="1"],[data-novaflow-ai-prompt-dock],[data-novaflow-ai-mode-controls],[data-novaflow-pose-reference="1"],#novaflow-video-frame-edit-overlay,[data-novaflow-video-frame-edit-panel],[data-novaflow-ai-post-section="1"],[data-novaflow-ui-design-inspector="1"],[data-novaflow-ui-layer-properties="1"],[data-novaflow-ui-design-workspace="1"],.nf-panel';
  const ELEMENTS='[data-novaflow-ai-resource-card="1"],button,input,textarea,select,[role="button"],[role="checkbox"],[role="option"],[data-novaflow-spine-split-tool-action],[data-novaflow-selection-tool-canvas],canvas[data-novaflow-ai-cutout-edit-canvas],canvas[data-novaflow-mask-tool-canvas],[data-novaflow-split-canvas-art="1"] canvas,.nf-vm-stage canvas,[data-novaflow-ui-design-block],[data-ui-workbench-block]';
  const FORBIDDEN=/登录|登出|退出账号|退出登录|密码|密钥|API\s*Key|充值|购买|会员|授权码|算力.*分享|分享.*算力|(?:清空|删除).*(?:全部|所有|账号|工程|项目)/i;
  const ids=new WeakMap(),elements=new Map(),materials=new Map();let sequence=0,nativePending=null,lastResult=null;
  const imageIds=new WeakMap();let imageSequence=0;
  function imageIdentity(item){if(!item||typeof item!=='object')return '';const url=item.dataUrl||item.imageUrl||'';let prior=imageIds.get(item);if(!prior||prior.url!==url){prior={url,id:'image-'+(++imageSequence)};imageIds.set(item,prior);}return prior.id;}
  function nativeResultExists(){const s=root.NovaFlowSpineSplitBridge?.getState?.();return !!(lastResult?.nativePartId?(s?.parts||[]).some(p=>p.id===lastResult.nativePartId):lastResult?.nativeSourceIdentity&&s?.source&&imageIdentity(s.source)===lastResult.nativeSourceIdentity);}
  async function rememberNativeResult(){
    const bridge=root.NovaFlowSpineSplitBridge,s=bridge?.getState?.(),part=(s?.parts||[]).find(p=>p.id===s.activePartId)||(s?.parts||[]).at(-1);
    let dataUrl=part?.dataUrl||s?.source?.dataUrl,name=part?.name||part?.label||s?.source?.fileName||'美工结果.png';
    if(bridge?.getUiLayerExport)try{const composite=await bridge.getUiLayerExport('png');dataUrl=composite.dataUrl;name=composite.name;}catch{}
    if(dataUrl)lastResult={id:'native-'+(part?'layer:'+part.id:'source:'+imageIdentity(s.source)),...(part?{nativePartId:part.id}:{nativeSourceIdentity:imageIdentity(s.source)}),name:name.replace(/\.(png|jpe?g|webp)$/i,'')+(/^data:image\/jpeg/.test(dataUrl)?'.jpg':/^data:image\/webp/.test(dataUrl)?'.webp':'.png'),imageUrl:dataUrl};
    return lastResult?{id:lastResult.id,name:lastResult.name}:null;
  }
  function setUploads(files=[]){for(const key of materials.keys())if(key.startsWith('upload-'))materials.delete(key);for(const [i,item] of files.entries())materials.set('upload-'+i,{...item,id:'upload-'+i});}
  async function referenceDataUrl(item){
    const data=item?.dataUrl||item?.imageUrl;if(/^data:image\/(png|jpeg|webp);base64,/.test(data||''))return data;
    if(typeof root.resolveReferenceDataUrl==='function')return root.resolveReferenceDataUrl(item);
    let file=item?.file;if(!file&&String(data||'').startsWith('blob:'))file=await(await root.fetch(data)).blob();
    if(file&&typeof root.FileReader==='function')return new Promise((resolve,reject)=>{const reader=new root.FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.onerror=()=>reject(new Error('图片原始字节读取失败'));reader.readAsDataURL(file);});
    fail('图片没有可读取的完整内容');
  }
  function materialList(){
    for(const key of materials.keys())if(!key.startsWith('upload-'))materials.delete(key);
    const state=root.NovaFlowSpineSplitBridge?.getState?.(),partExists=nativeResultExists(),generatedExists=root.__NovaFlowArtGenerate?.state.results?.some(r=>r.id===lastResult?.id);
    for(const result of [partExists||generatedExists?lastResult:null,root.__NovaFlowArtGenerate?.selectedResult?.()])if(result?.id&&result.imageUrl)materials.set('result-'+result.id,{id:'result-'+result.id,kind:'image',name:result.name||'上次成图.png',dataUrl:result.imageUrl});
    for(const part of (state?.parts||[]).slice(0,60))if(part.dataUrl)materials.set('layer-'+part.id+'-'+imageIdentity(part),{id:'layer-'+part.id+'-'+imageIdentity(part),kind:'image',name:(part.name||part.label||'图层').replace(/\.png$/i,'')+'.png',dataUrl:part.dataUrl});
    for(const source of (root.NovaFlowSpineSplitBridge?.getSourceResources?.()||[]).slice(-30))if(source.dataUrl)materials.set('source-'+source.id+'-'+imageIdentity(source),{id:'source-'+source.id+'-'+imageIdentity(source),kind:'image',name:source.fileName||source.name||'原图.png',dataUrl:source.dataUrl});
    for(const r of root.NovaFlowAudioStudio?.resources?.()||[])if(!r.pending&&r.blob)materials.set('audio-resource-'+r.id,{id:'audio-resource-'+r.id,kind:'audio',name:(r.name||'音频').replace(/\.wav$/i,'')+'.wav',blob:r.blob});
    for(const item of root.NovaFlowAiSequenceAssetBridge?.listResources?.()||[])materials.set('resource-'+item.id,{id:'resource-'+item.id,kind:/\.(wav|mp3|ogg|flac|m4a)$/i.test(item.name)?'audio':/\.(png|jpe?g|webp)$/i.test(item.name)?'image':'video',name:item.name,resourceId:item.id});
    return [...materials.values()].slice(0,100).map(({id,name,kind})=>({id,name,kind}));
  }
  async function materialFile(id){
    const item=materials.get(id);if(!item)fail('素材已不存在，请重新提供');
    if(item.file)return item.file;
    if(item.blob)return new root.File([item.blob],item.name,{type:item.blob.type||'audio/wav'});
    if(item.resourceId){const adapter=root.NovaFlowAiSequenceVideoMergeResourceBridge?.createAdapter?.({});if(!adapter)fail('资源解析工具尚未就绪');const descriptor=await adapter.resolveResource(item.resourceId);let file=descriptor.file||descriptor.blob;if(!file&&descriptor.localPath)file=root.NovaFlowWebRuntime?.fileForToken?.(descriptor.localPath)||root.NovaFlowWebRuntime?.videoOutputs?.get?.(descriptor.localPath)?.blob;if(!file&&descriptor.objectUrl)file=await(await root.fetch(descriptor.objectUrl)).blob();if(!file)fail('当前资源没有可读取的原始文件');return new root.File([file],descriptor.fileName||item.name||'resource.mp4',{type:file.type||descriptor.mimeType});}
    const dataUrl=item.dataUrl;if(!/^data:image\/(png|jpeg|webp);base64,/.test(dataUrl||''))fail('素材没有完整图片字节');
    const mime=dataUrl.slice(5,dataUrl.indexOf(';')),blob=await(await root.fetch(dataUrl)).blob();return new root.File([blob],item.name||'result.png',{type:mime});
  }
  function visible(el){if(!el)return false;const r=el.getBoundingClientRect?.(),style=root.getComputedStyle?.(el);return !!(el.isConnected&&r?.width>0&&r?.height>0&&!el.closest?.('[hidden],[aria-hidden="true"],#nf-xiaotao-art-root')&&style?.visibility!=='hidden'&&style?.display!=='none'&&style?.opacity!=='0');}
  function label(el){return String(el.getAttribute?.('aria-label')||el.getAttribute?.('title')||el.getAttribute?.('placeholder')||el.labels?.[0]?.textContent||el.getAttribute?.('data-novaflow-spine-split-control-action')||el.getAttribute?.('data-novaflow-spine-split-tool-action')||(["INPUT","SELECT","TEXTAREA"].includes(el.tagName)?el.previousElementSibling?.textContent:"")||el.textContent||el.name||el.id||el.previousElementSibling?.textContent||(el.tagName==='CANVAS'?'当前工具选区画布':'')).trim().replace(/\s+/g,' ').slice(0,120);}
  function catalog(){
    const doc=root.document;if(!doc)return [];
    const candidates=new Set(),audioOnly=root.NovaFlowAudioStudio?.isOpen?.()&&root.NovaFlowAudioStudio.sub()==='audio';
    for(const scope of doc.querySelectorAll(audioOnly?'#novaflow-audio-studio':SCOPE)){if(visible(scope)){if(scope.matches(ELEMENTS))candidates.add(scope);scope.querySelectorAll(ELEMENTS).forEach(el=>candidates.add(el));}}
    if(!audioOnly)for(const scope of doc.querySelectorAll('[data-novaflow-ai-video-merge-workspace="1"],.nf-ve-panel'))if(visible(scope))scope.querySelectorAll(ELEMENTS).forEach(el=>candidates.add(el));
    // Only Foart-owned production dialogs; never account, browser or OS dialogs.
    for(const scope of doc.querySelectorAll('[role="dialog"],[id*="dialog"],[class*="dialog"],[class*="modal"]')){
      if(visible(scope)&&/art|image|split|canvas|mask|upscale|outpaint|video|audio|ui-design|object-transfer|pose/.test(scope.id+' '+scope.className)&&!FORBIDDEN.test(scope.getAttribute('aria-label')||''))scope.querySelectorAll(ELEMENTS).forEach(el=>candidates.add(el));
    }
    elements.clear();const result=[];
    for(const el of candidates){
      const file=el.type==='file',exposed=visible(el)||file&&visible(el.parentElement);
      if(result.length>=240||!exposed||el.closest('#novaflow-web-account-header,[class*="auth"],[id*="auth"],[class*="account"],[id*="account"],[class*="login"],[id*="login"]')||['password','hidden'].includes(el.type))continue;
      const penCanvas=el.tagName==='CANVAS'&&!!el.closest('[data-novaflow-split-canvas-art="1"]');
      if(penCanvas&&!root.NovaFlowSpineSplitBridge?.getState?.()?.penTool?.active)continue;
      const videoMaskCanvas=el.tagName==='CANVAS'&&!!el.closest('.nf-vm-stage');
      if(videoMaskCanvas&&doc.body?.getAttribute('data-nf-ve-masking')!=='1')continue;
      const title=el.getAttribute('data-novaflow-ai-resource-card')==='1'?'加载资源：'+String(el.textContent||'').replace(/^×/,'').slice(0,110):penCanvas?'钢笔轮廓画布':videoMaskCanvas?'视频蒙版画布':label(el);if(!title||FORBIDDEN.test(title)||el.tagName==='A')continue;
      let id=ids.get(el);if(!id){id='control-'+(++sequence);ids.set(el,id);}elements.set(id,el);
      const tag=el.tagName?.toLowerCase(),role=el.getAttribute('role');
      const kind=file?'file':tag==='canvas'?'canvas':tag==='select'?'select':tag==='textarea'?'textarea':el.type==='checkbox'||role==='checkbox'?'checkbox':tag==='input'?'input':'button';
      const row={id,label:title,kind,disabled:!!el.disabled||!!el.readOnly||el.getAttribute('aria-disabled')==='true',dialog:!!el.closest('[role="dialog"],[id*="dialog"],[class*="dialog"],[class*="modal"]'),section:label(el.closest('.nf-panel')?.querySelector('.nf-panel-header')||el.closest('[role="dialog"]')||{textContent:''})};
      if(el.closest('[data-novaflow-art-generate-prompt-kind="positive"]')&&['textarea','input'].includes(kind))row.purpose='image_prompt';
      else if(el.closest('[data-novaflow-ai-prompt-kind="positive"]')&&['textarea','input'].includes(kind))row.purpose='video_prompt';
      if(el.hasAttribute?.('aria-expanded'))row.expanded=el.getAttribute('aria-expanded')==='true';
      if(el.hasAttribute?.('data-novaflow-ai-resource-id')){row.resourceId=el.getAttribute('data-novaflow-ai-resource-id');row.pressed=el.getAttribute('data-novaflow-ai-resource-card-active')==='1';}
      if(el.hasAttribute?.('aria-pressed'))row.pressed=el.getAttribute('aria-pressed')==='true';
      if(el.closest?.('[data-track-id]'))row.trackId=el.closest('[data-track-id]').getAttribute('data-track-id');
      if(penCanvas)row.pointerMode='points';
      if(['input','textarea','select'].includes(kind))row.value=String(el.value||'').slice(0,12000);
      if(kind==='checkbox')row.value=el.checked??el.getAttribute('aria-checked')==='true';
      if(tag==='select')row.options=Array.from(el.options).map(o=>({value:o.value,label:o.textContent,disabled:o.disabled}));
      if(file){row.accept=el.accept||'';row.multiple=!!el.multiple;}
      if(el.getAttribute('data-novaflow-ai-tool-heading')==='frame-edit'&&!root.NovaFlowVideoFrameEditTool?.isOpen?.()&&root.NovaFlowVideoFrameEditTool?.canOpen?.()===false)row.disabled=true;
      if(['number','range'].includes(el.type)){row.type=el.type;for(const key of ['min','max','step'])if(el.getAttribute(key)!==null&&Number.isFinite(Number(el[key])))row[key]=Number(el[key]);}
      result.push(row);
    }
    return result;
  }
  function imageBinding(rt){return JSON.stringify({settings:artSettings(rt.state),references:(rt.references?.()||[]).map(r=>r&&imageIdentity(r)),result:rt.selectedResult?.()?.id});}
  function capture(){
    const rt=root.__NovaFlowArtGenerate,s=root.NovaFlowSpineSplitBridge?.getState?.(),result=rt?.selectedResult?.();
    const rawMedia=root.NovaFlowMediaAgent?.capture?.().artContext;
    const media=rawMedia?.active?rawMedia.sub==='audio'?{surface:'media',active:true,sub:'audio',audio:rawMedia.audio,audioResources:rawMedia.audioResources,audioSettings:rawMedia.audioSettings}:{...rawMedia,audio:undefined,audioResources:undefined,audioSettings:undefined}:null;
    return {schema:contract().FOART_TOOL_SCHEMA,controls:catalog(),uploads:materialList(),
      art:rt?{surface:rt.captureContext?.().generationSurface,provider:rt.state.provider,mode:rt.state.mode,count:rt.state.count||1,prompt:rt.state.prompt||'',running:!!rt.state.running,error:rt.state.error||'',result:result?{id:result.id,name:result.name}:null,references:(rt.references?.()||[]).filter(Boolean).map((r,i)=>({index:i+1,identity:imageIdentity(r),name:r.name||r.file?.name||'',hasImage:!!r.dataUrl})),referenceLimit:rt.referenceLimit?.()}:null,
      artEditor:s?{busy:!!s.busy,action:s.busyAction||'',message:s.message||'',error:!!s.messageError,source:s.source?{identity:imageIdentity(s.source),name:s.source.fileName||'',hasImage:!!s.source.dataUrl}:null,size:s.sourceSize,selected:s.selectedPartIds||[],layers:(s.parts||[]).slice(0,60).map(p=>({id:p.id,identity:imageIdentity(p),label:p.label,visible:p.visible!==false})),tools:contract().FOART_ART_ACTIONS}:null,
      media,pose:root.NovaFlowPoseReferenceTool?.agentContext?.()||null,frameEditor:root.NovaFlowVideoFrameEditTool?.agentContext?.()||null,mediaActions:['generate_video','optimize_video_prompt','generate_music','generate_sfx','import_resource','select_clip','split','trim','move','rate','volume','fade','duplicate','remove','export','loops','play','pause','seek','track_gain','track_mute','track_solo','clip_transform','clip_visibility'],
      pending:nativePending?{id:nativePending.id,name:nativePending.name,state:nativePending.state,error:nativePending.error||''}:null,lastOutput:lastResult?{id:lastResult.id,name:lastResult.name}:null};
  }
  function click(el){const r=el.getBoundingClientRect(),init={bubbles:true,cancelable:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2,button:0,pointerId:1,pointerType:'mouse',isPrimary:true};for(const type of ['pointerdown','mousedown','pointerup','mouseup','click'])el.dispatchEvent(type.startsWith('pointer')?new root.PointerEvent(type,init):new root.MouseEvent(type,init));}
  async function open(surface){
    if(['audio','video'].includes(surface)){if(!root.NovaFlowAudioStudio)fail('音视工具尚未加载');root.NovaFlowAudioStudio.open(surface);}
    else{
      const nav=Array.from(root.document.querySelectorAll('[data-novaflow-primary-entry="1"]')).find(el=>/美工/.test(el.getAttribute('data-novaflow-primary-label')||el.getAttribute('aria-label')||el.textContent));if(!nav)fail('美工入口尚未就绪');click(nav);await sleep(80);
      const secondary=Array.from(root.document.querySelectorAll('[data-novaflow-secondary-entry="1"]')).find(el=>label(el)===(surface==='ui'?'UI':'绘图'));if(secondary)click(secondary);
      await sleep(80);if(surface==='drawing')root.__NovaFlowArtGenerate?.activate?.();
    }
    await sleep(100);
    if(['audio','video'].includes(surface)&&(root.NovaFlowAudioStudio?.isOpen?.()!==true||root.NovaFlowAudioStudio?.sub?.()!==surface))fail('音视入口未保持打开，请根据当前工作区重试');
    return {action:'open',phase:'opened',surface,message:'已打开'+({drawing:'绘图',ui:'UI设计',video:'视频',audio:'音频'}[surface])+'工具'};
  }
  async function useResult(){
    const rt=root.__NovaFlowArtGenerate,nativeStillExists=nativeResultExists();
    if((lastResult?.nativePartId||lastResult?.nativeSourceIdentity)&&!nativeStillExists)fail('上次制作的图片已不存在，请指定当前要修改的图片');
    if(nativeStillExists)await rememberNativeResult();
    const result=nativeStillExists?lastResult:rt?.selectedResult?.()||(rt?.state.results?.some(r=>r.id===lastResult?.id)?lastResult:null);if(!result?.imageUrl)fail('没有真实的上次成图，不能基于不存在的结果修改');
    if(rt.captureContext?.().generationSurface==='other')await open('drawing');
    rt.setMode('img2img');const count=(rt.references?.()||[]).length;rt.setReference(0,{dataUrl:result.imageUrl,name:result.name||'上次成图',sourceResultId:result.id});for(let i=1;i<count;i++)rt.setReference(i,null);rt.refreshReferences?.();rt.render?.({forceBottom:true});await sleep(100);
    if(rt.references?.()[0]?.dataUrl!==result.imageUrl)fail('上次成图未绑定到图生图输入');
    return {action:'use_result',phase:'applied',sourceResultId:result.id,name:result.name};
  }
  async function image(op,{signal,requirements,onStatus,provider}){
    if(signal?.aborted)fail('制作已停止');
    const rt=root.__NovaFlowArtGenerate;if(!rt)fail('绘图工具尚未就绪');if(rt.state.running)fail('已有绘图任务运行中');
    const ui=root.NovaFlowUiDesignDrawing?.isActive?.();
    if(!ui)await open('drawing');
    if(op.useResult)await useResult();
    rt.setMode(op.generationMode);await sleep(100);
    for(let i=0;rt.state.referenceSizeFillPending&&i<100;i++){if(signal?.aborted)fail('制作已停止');await sleep(50);}
    if(rt.state.referenceSizeFillPending)fail('参考图尺寸仍在读取，未提交旧尺寸方案');
    if(op.generationMode==='img2img'&&!(rt.references?.()||[]).filter(Boolean).length)fail('图生图缺少真实参考图片');
    const count=op.count??rt.state.count??1;if(!Number.isInteger(count)||count<1||count>10)fail('生成数量超出原有范围');
    if(op.count!==undefined){rt.state.count=count;rt.render?.({forceBottom:true});}
    const capability=root.NovaFlowArtGenerateModels?.capabilityFor?.(rt.state.provider,op.generationMode,rt.state);
    if(!ui&&rt.state.provider==='local'&&capability&&!['qwen-2.1','qwen-2.1-turbo'].includes(capability.engine)){
      rt.state.prompt=op.prompt;rt.render?.({forceBottom:true});
      if(op.action==='image_optimize'){
        const button=Array.from(root.document.querySelectorAll('#novaflow-art-generate-workspace button')).find(el=>visible(el)&&/AI\s*助手|优化提示词/.test(label(el)));
        if(!button)fail('该本地模型的原有优化入口不可用，未套用 Qwen 规则');click(button);return {action:op.action,phase:'opened',provider:'local',message:'已打开当前模型的原有提示词优化工具，尚未写入优化结果'};
      }
      const before=rt.selectedResult?.()?.id,sourceResultId=(rt.references?.()||[])[0]?.sourceResultId,abort=()=>{void rt.cancel?.();};signal?.addEventListener('abort',abort,{once:true});
      try{onStatus('正在使用当前本地模型的原有绘图流程…');await rt.run();if(signal?.aborted)fail('制作已停止');if(rt.state.error)fail(rt.state.error);const result=rt.selectedResult?.();if(!result?.id||result.id===before||!result.imageUrl)fail('原有模型没有返回新成图');lastResult=result;return {action:op.action,phase:'completed',provider:'local',mode:op.generationMode,id:result.id,name:result.name,sourceResultId:op.useResult?sourceResultId:undefined,optimization:{framework:'native-selected-model'}};}finally{signal?.removeEventListener('abort',abort);}
    }
    if(ui){
      rt.state.prompt=op.prompt;rt.render?.({forceBottom:true});onStatus('正在使用原有 UI 设计与布局规划流程…');
      const getCurrentContext=()=>rt.captureContext(),prepared=await root.NovaFlowUiDesignDrawing.prepare({...getCurrentContext(),getCurrentContext});prepared.state={...prepared.state,count};
      if(signal?.aborted){root.NovaFlowUiDesignDrawing.cancelPreparation?.();fail('UI 制作已停止');}
      if(op.action==='image_optimize'){rt.state.prompt=prepared.optimizedPrompt||prepared.promptSnapshot?.prompt||op.prompt;rt.render?.({forceBottom:true});return {action:op.action,phase:'applied',surface:'ui',prompt:rt.state.prompt,optimization:{framework:'native-ui-layout'}};}
      const before=rt.selectedResult?.()?.id,sourceResultId=(rt.references?.()||[])[0]?.sourceResultId;
      const abort=()=>{root.NovaFlowUiDesignDrawing.cancelPreparation?.();void rt.cancel?.();};signal?.addEventListener('abort',abort,{once:true});
      try{await rt.run({uiPrepared:prepared});if(signal?.aborted)fail('UI 制作已停止');if(rt.state.error)fail(rt.state.error);const result=rt.selectedResult?.();if(!result?.id||result.id===before||!result.imageUrl)fail('UI 工具没有返回新成图');lastResult=result;return {action:op.action,phase:'completed',surface:'ui',provider:rt.state.provider,mode:op.generationMode,id:result.id,name:result.name,sourceResultId:op.useResult?sourceResultId:undefined,optimization:{framework:'native-ui-layout'}};}finally{signal?.removeEventListener('abort',abort);}
    }
    const beforeBinding=imageBinding(rt),before=rt.selectedResult?.()?.id;
    const beforeIds=new Set((rt.state.results||[]).map(r=>r.id));
    let prompt=op.prompt,modelPrompt=op.prompt,negativePrompt=rt.state.negativePrompt||'',optimization;
    if(!ui){
      onStatus('正在按所选生图模型优化提示词…');
      if(rt.state.provider==='gpt'){
        const response=await root.electronAPI?.smartAiPromptOptimize?.({surface:'art',purpose:'optimize',targetEngine:'gpt-image-2.5',prompt:op.prompt,currentPrompt:op.prompt,requirements,negativePrompt:'',supportsNegativePrompt:false});
        if(!response?.ok)fail(response?.error||'GPT 原有提示词优化未完成');
        const result=response.result?.result||response.result?.data||response.result;
        prompt=String(result?.prompt||result?.prompt_text||'').trim();if(!prompt)fail('GPT 原有优化器没有返回完整提示词');modelPrompt=String(result.modelPrompt||prompt);optimization={framework:'original-art-grok',provider:'gpt'};
      }else{
        const optimized=await root.__NovaFlowSmartAI.optimizeForAgent({surface:'art',prompt:op.prompt,negativePrompt,requirements,generationMode:op.generationMode,engine:rt.state.localQwen21Variant==='turbo'?'qwen-2.1-turbo':'qwen-2.1',signal,onProgress:onStatus});
        prompt=optimized.displayPrompt||optimized.prompt;modelPrompt=optimized.prompt;negativePrompt=optimized.negativePrompt;optimization=optimized.optimization;
      }
    }
    if(signal?.aborted)fail('制作已停止');if(imageBinding(rt)!==beforeBinding)fail('绘图参数或素材在优化期间变化，未写入或生成');
    rt.state.prompt=prompt;if(rt.state.provider==='local')rt.state.negativePrompt=negativePrompt;rt.render?.({forceBottom:true});
    if(op.action==='image_optimize')return {action:op.action,phase:'applied',provider:rt.state.provider,prompt,modelPrompt,optimization};
    const state=copy({...artSettings(rt.state),running:false,count}),refs=op.generationMode==='txt2img'?[]:(rt.references?.()||[]).filter(Boolean),binding=imageBinding(rt);
    const prepared={state,promptSnapshot:{prompt:modelPrompt,negativePrompt},references:refs,direct:true,agentRun:true,plan:{schema:'nf.foart.native-image.v1'},originalPrompt:op.prompt,assertCurrent:()=>{if(imageBinding(rt)!==binding)fail('绘图内容已变化，本次方案已失效');},recordReview:()=>{}};
    const abort=()=>{void rt.cancel?.();};signal?.addEventListener('abort',abort,{once:true});
    try{
      onStatus('正在使用'+(rt.state.provider==='gpt'?'GPT Image 2.5':'Qwen')+'生成图片…');
      // UI keeps its original reference/layout planning, not the ordinary-image prepared path.
      await rt.run(ui?{}:{drawingPrepared:prepared});
      if(signal?.aborted)fail('制作已停止');if(rt.state.error)fail(rt.state.error);
      const result=rt.selectedResult?.();if(!result?.id||result.id===before||!result.imageUrl)fail('绘图工具没有返回新的真实成图');
      const outputs=(rt.state.results||[]).filter(r=>!beforeIds.has(r.id)).map(({id,name})=>({id,name}));
      const sourceResultId=op.useResult?refs[0]?.sourceResultId:undefined;lastResult=result;return {action:op.action,phase:'completed',provider:state.provider,mode:op.generationMode,id:result.id,name:result.name,sourceResultId,outputs:outputs.length?outputs:[{id:result.id,name:result.name}],prompt,modelPrompt,optimization};
    }finally{signal?.removeEventListener('abort',abort);}
  }
  function activity(){
    if(root.NovaFlowSpineSplitBridge?.getState?.()?.busy)return '美工处理';
    if(root.NovaFlowVideoFrameEditTool?.isBusy?.())return '视频帧编辑';
    if(root.NovaFlowAiSequenceVideoMergeWorkspace?.snapshot?.()?.exporting)return '视频导出';
    if(root.document.body?.getAttribute('data-novaflow-ai-cutout-saving')==='1')return '视频抠图保存';
    if([...root.document.querySelectorAll('[data-nf-color-correction-busy="1"]')].some(visible))return '颜色校正';
    const smart=root.document.querySelector('#novaflow-smart-ai-dialog-root');
    if(smart&&visible(smart)&&[...smart.querySelectorAll('button')].some(el=>el.disabled&&/处理中|优化中|分析中|生成中/.test(el.textContent)))return '原有提示词优化';
    return '';
  }
  async function waitNativeIdle(signal,onStatus){const start=Date.now();for(let busy=activity();busy;busy=activity()){if(signal?.aborted)fail('已停止等待，请以当前原生工具状态确认任务结果');if(Date.now()-start>30*60*1000)fail('原生工具等待超时，请检查该工具当前状态');onStatus('正在等待'+busy+'完成…');await sleep(300);}}
  function setControl(el,value){
    if(el.type==='checkbox'||el.getAttribute('role')==='checkbox'){const current=el.type==='checkbox'?el.checked:el.getAttribute('aria-checked')==='true'||el.getAttribute('aria-pressed')==='true';if(current!==!!value)click(el);return;}
    const proto=el.tagName==='TEXTAREA'?root.HTMLTextAreaElement.prototype:el.tagName==='SELECT'?root.HTMLSelectElement.prototype:root.HTMLInputElement.prototype;
    const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;if(!setter)fail('控件不支持写入');setter.call(el,String(value));
    el.dispatchEvent(new root.Event('input',{bubbles:true}));el.dispatchEvent(new root.Event('change',{bubbles:true}));
  }
  async function execute(op,{snapshot,fingerprint,signal,requirements='',optimizerRequirements=requirements,onStatus=()=>{},provider='local'}={}){
    if(signal?.aborted)fail('Foart 操作已停止');
    if(op.action==='open')return open(op.surface);
    if(op.action==='use_result')return useResult();
    if(op.action==='pose_select'){const selected=root.NovaFlowPoseReferenceTool?.agentSelectBone?.(op.boneName);if(!selected)fail('请先打开姿势参考工具');return {action:op.action,phase:'applied',...selected,message:'已选中姿势关节：'+selected.label};}
    if(op.action==='frame_select'){const tool=root.NovaFlowVideoFrameEditTool;if(!tool?.agentSelectRange)fail('帧编辑选择工具尚未加载');return {action:op.action,phase:'applied',...tool.agentSelectRange(op.startFrame,op.endFrame),message:'已选中第'+(op.startFrame+1)+'至'+(op.endFrame+1)+'帧'};}
    if(op.action.startsWith('image_'))return image(op,{signal,requirements:optimizerRequirements,onStatus,provider});
    if(op.action==='media'){
      await open(op.operation.target);
      const media=root.NovaFlowMediaAgent,context=media.capture();
      const result=await media.execute({planId:root.crypto.randomUUID(),contextFingerprint:await fingerprint(context),operations:[op.operation]},{snapshot:context,fingerprint,signal,requirements:optimizerRequirements,onOptimizationStatus:onStatus});
      return {action:'media',phase:'completed',results:result.results};
    }
    if(op.action==='art_action'){
      if(nativePending&&nativePending.state==='running')fail('上一个美工工具尚未完成');
      if(op.name==='export'&&!/导出|下载|PSD|保存.{0,8}文件/i.test(requirements))fail('本次仅要求保留资源，未额外导出文件');
      const latestRequirements=requirements.split('本次最新要求优先，替换与它冲突的旧描述：').at(-1);
      const formatRequest=latestRequirements.replace(/(?:不要|不用|无需|别)(?:导出|保存)?(?:为|成)?\s*(?:PNG|PSD|JSON)\b/gi,'');
      const requestedFormats=[...new Set((formatRequest.match(/\b(?:PNG|PSD|JSON)\b/gi)||[]).map(v=>v.toLowerCase()))];
      const requestedFormat=op.name==='export'&&requestedFormats.length===1?requestedFormats[0]:undefined;
      const exportFormat=requestedFormat||(op.format||'psd');
      await open('drawing');
      const category=['imageUpscale','imageOutpaint','imageAngleAdjust','objectTransfer','poseReference'].includes(op.name)?'enhance':['split','cutout','generativeSplit','penCutout'].includes(op.name)?'split':'edit';
      const panel=root.document.querySelector('[data-novaflow-spine-split-control-category="'+category+'"]');if(panel?.getAttribute('data-open')==='0'){const heading=panel.querySelector('.nf-panel-header');if(heading)click(heading);await sleep(80);}
      const bridge=root.NovaFlowSpineSplitBridge;if(typeof bridge?.agentAction!=='function')fail('美工工具控制入口尚未更新');
      if(op.uploadId){const file=await materialFile(op.uploadId);const dataUrl=await referenceDataUrl({file,mimeType:file.type});await bridge.importSourceDataUrl(file.name,dataUrl,{silent:true});}
      const toolLabel=op.name==='export'?exportFormat.toUpperCase()+'导出':root.document.querySelector('[data-novaflow-spine-split-control-action="'+op.name+'"]')?.textContent?.trim()||op.name;
      const pending={id:root.crypto.randomUUID(),name:op.name,label:toolLabel,state:'running'};nativePending=pending;
      Promise.resolve().then(()=>bridge.agentAction(op.name,{format:exportFormat})).then(value=>{pending.state='completed';pending.value=value;},error=>{pending.state='failed';pending.error=String(error?.message||error);});
      await sleep(120);return {action:op.action,phase:'started',taskId:pending.id,name:op.name,label:toolLabel,message:'已启动'+toolLabel+'，等待参数或实际结果'};
    }
    const el=elements.get(op.controlId);if(!el||!(visible(el)||op.action==='assign_upload'&&visible(el.parentElement))||el.disabled)fail('控件已变化，请重新读取工具目录');
    if(FORBIDDEN.test(label(el)))fail('该操作不属于美工或音视制作工具');
    if(op.action==='assign_upload'){
      if(el.type!=='file')fail('不是原生素材输入位置');const file=await materialFile(op.uploadId),inspected=root.NovaFlowXiaotaoUpload?.inspectUpload?.(file);if(inspected?.ok===false)fail(inspected.message);
      const accept=String(el.accept||'').toLowerCase();if(accept&&accept!=='*/*'&&!accept.split(',').some(t=>{t=t.trim();return t===file.type.toLowerCase()||t.endsWith('/*')&&file.type.toLowerCase().startsWith(t.slice(0,-1))||t.startsWith('.')&&file.name.toLowerCase().endsWith(t);}))fail('素材类型不符合该模式的原有输入规则');
      const transfer=new root.DataTransfer();transfer.items.add(file);el.files=transfer.files;el.dispatchEvent(new root.Event('change',{bubbles:true}));await sleep(100);return {action:op.action,phase:'applied',control:label(el),uploadId:op.uploadId,name:file.name};
    }
    if(op.action==='set_control'){
      if(el.closest('[data-novaflow-art-generate-prompt-kind="positive"],[data-novaflow-ai-prompt-kind="positive"]'))fail('请使用原有提示词优化工具，未直接改字段冒充优化');
      setControl(el,op.value);await sleep(60);
      if(el.isConnected&&el.type!=='checkbox'&&String(el.value)!==String(op.value))fail('参数未按要求写入');
      return {action:op.action,phase:'applied',control:label(el),value:op.value};
    }
    if(op.action==='activate_control'){
      if(el.getAttribute('data-novaflow-ai-tool-heading')==='frame-edit'&&!root.NovaFlowVideoFrameEditTool?.isOpen?.()&&root.NovaFlowVideoFrameEditTool?.canOpen?.()===false)fail('请先选择并加载对应视频资源，再打开帧编辑');
      if(/删除|移除|清空|清除/.test(label(el))&&!/删除|移除|清空|清除|重新选择|重画|重置/.test(requirements))fail('本次未要求删除或清空素材，未执行该操作');
      if(el.matches('[data-novaflow-art-generate-submit]')||/^(?:生成|开始生成|重新生成)(?:\s|·|$)/.test(label(el)))fail('请使用对应生成工具，以保留优化、引用和执行回执');
      const beforePrompt=root.__NovaFlowArtGenerate?.state.prompt,beforeMedia=new Set((root.NovaFlowMediaAgent?.capture?.().artContext.videoResources||[]).map(r=>r.id));
      const beforeSource=root.NovaFlowSpineSplitBridge?.getState?.()?.source?.dataUrl;
      const beforeLayers=(root.NovaFlowSpineSplitBridge?.getState?.()?.parts||[]).map(p=>p.id+':'+imageIdentity(p)).join('|');
      const resourceId=el.getAttribute('data-novaflow-ai-resource-id');
      if(resourceId&&root.NovaFlowAiSequenceAssetBridge?.loadResource)await root.NovaFlowAiSequenceAssetBridge.loadResource(resourceId);
      else click(el);
      await sleep(100);await waitNativeIdle(signal,onStatus);const afterPrompt=root.__NovaFlowArtGenerate?.state.prompt;
      const resources=(root.NovaFlowMediaAgent?.capture?.().artContext.videoResources||[]).filter(r=>!beforeMedia.has(r.id));
      const sourceChanged=beforeSource!==root.NovaFlowSpineSplitBridge?.getState?.()?.source?.dataUrl;
      const layers=(root.NovaFlowSpineSplitBridge?.getState?.()?.parts||[]),layersChanged=beforeLayers!==layers.map(p=>p.id+':'+imageIdentity(p)).join('|');
      const actualOutput=layersChanged||sourceChanged?await rememberNativeResult():null;
      return {action:op.action,phase:resources.length||sourceChanged||layersChanged?'completed':beforePrompt!==afterPrompt?'applied':'activated',control:label(el),...(actualOutput?{outputs:[actualOutput]}:{}),...(resources.length?{resources:resources.map(({id,name,promptId})=>({id,name,promptId})),message:'原生工具已返回新资源：'+resources.map(r=>r.name).join('、')}:layersChanged?{layers:layers.map(p=>({id:p.id,name:p.name||p.label})),message:'原生工具已更新实际图层：'+layers.map(p=>p.name||p.label||p.id).join('、')}:sourceChanged?{message:'原生工具已更新实际图片内容'}:beforePrompt!==afterPrompt?{nativePromptApplied:true,prompt:afterPrompt,message:'已将原生工具返回的新提示词写入绘图字段'}:{message:'已操作原生控件；生成或导出结果仍以实际回执为准'})};
    }
    if(op.action==='draw'){
      if(el.tagName!=='CANVAS')fail('当前不是可绘制选区');const r=el.getBoundingClientRect();
      const pen=!!el.closest('[data-novaflow-split-canvas-art="1"]');
      for(let i=0;i<op.points.length;i++){
        if(signal?.aborted)fail('绘制已停止');const [x,y]=op.points[i],types=pen?['pointerdown','pointerup']:[i===0?'pointerdown':i===op.points.length-1?'pointerup':'pointermove'];
        for(const type of types){el.dispatchEvent(new root.PointerEvent(type,{bubbles:true,cancelable:true,pointerId:1,pointerType:'mouse',isPrimary:true,button:0,buttons:type==='pointerup'?0:1,clientX:r.left+x*r.width,clientY:r.top+y*r.height}));await sleep(20);}
      }
      return {action:'draw',phase:'applied',control:pen?'钢笔轮廓画布':label(el),pointCount:op.points.length};
    }
    fail('Foart 工具操作不受支持');
  }
  async function images(){
    const result=[],rt=root.__NovaFlowArtGenerate,source=root.NovaFlowSpineSplitBridge?.getState?.()?.source;
    const pose=root.NovaFlowPoseReferenceTool?.getEditor?.();if(pose?.viewer){const dataUrl=await pose.capture();return [{role:'reference',dataUrl,name:'当前姿势人偶.png'}];}
    const frame=root.NovaFlowVideoFrameEditTool?.isOpen?.()&&root.document.querySelector('#novaflow-video-frame-edit-overlay .nf-vfe-stage canvas');
    if(frame?.width&&frame?.height)result.push({role:'reference',dataUrl:frame.toDataURL('image/png'),name:'当前视频帧.png'});
    const mediaActive=root.NovaFlowAudioStudio?.isOpen?.();
    if(mediaActive&&!frame&&root.NovaFlowAudioStudio.sub()==='video'){
      const video=[...root.document.querySelectorAll('video')].filter(v=>visible(v)&&v.readyState>=2&&v.videoWidth>0).sort((a,b)=>b.getBoundingClientRect().width*b.getBoundingClientRect().height-a.getBoundingClientRect().width*a.getBoundingClientRect().height)[0];
      if(video)try{const canvas=root.document.createElement('canvas'),scale=Math.min(1,960/video.videoWidth);canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);result.push({role:'reference',dataUrl:canvas.toDataURL('image/png'),name:'当前视频画面.png'});}catch{}
    }
    const nativeStillExists=nativeResultExists();
    const candidates=mediaActive?[...materials.values()].filter(m=>m.id.startsWith('upload-')&&m.kind==='image'):[nativeStillExists?lastResult:null,rt?.selectedResult?.(),...(rt?.references?.()||[]).filter(Boolean),source];
    for(const item of candidates.filter(Boolean)){
      let dataUrl=item.imageUrl||item.dataUrl;
      if(!dataUrl||result.some(r=>r.dataUrl===dataUrl))continue;
      if(!/^data:image\/(png|jpeg|webp);base64,/.test(dataUrl))dataUrl=await referenceDataUrl({...item,dataUrl});
      if(/^data:image\/(png|jpeg|webp);base64,/.test(dataUrl))result.push({role:item.imageUrl?'result':'reference',dataUrl,name:item.name||item.fileName||''});
      if(result.length===3)break;
    }
    return result;
  }
  async function settlePending({signal,onStatus=()=>{}}={}){
    if(!nativePending)return null;
    while(nativePending.state==='running'){
      if(signal?.aborted)fail('美工工具等待已停止，请在当前工具中确认任务状态');
      if(catalog().some(c=>c.dialog&&/取消|确认|执行|开始|应用|确定/.test(c.label)&&!c.disabled))return null;
      onStatus('正在等待'+nativePending.name+'原生工具处理…');await sleep(500);
    }
    const finished=nativePending;nativePending=null;
    if(finished.state==='failed')fail(finished.error);
    const state=root.NovaFlowSpineSplitBridge?.getState?.();if(state?.messageError)fail(state.message||'美工工具未完成');
    const actualOutput=finished.value?.layersChanged||finished.value?.sourceChanged?await rememberNativeResult():null;
    return {action:'art_action',phase:finished.value?.phase||'returned',name:finished.name,label:finished.label,taskId:finished.id,...(finished.value?.fileName?{fileName:finished.value.fileName}:{}),...(actualOutput?{outputs:[actualOutput]}:{}),message:state?.message||'原生工具已返回',result:finished.value,sources:root.NovaFlowSpineSplitBridge?.getSourceResources?.().map(r=>({id:r.id,name:r.fileName||r.name})),layers:(state?.parts||[]).map(p=>({id:p.id,label:p.label}))};
  }
  root.NovaFlowFoartTools=Object.freeze({capture,execute,images,settlePending,catalog,open,useResult,setUploads});
})(typeof window!=='undefined'?window:globalThis);
