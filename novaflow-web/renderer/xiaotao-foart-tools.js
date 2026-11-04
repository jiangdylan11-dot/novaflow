(function(root){
  'use strict';
  const fail=message=>{throw new Error(message);},copy=v=>JSON.parse(JSON.stringify(v)),sleep=ms=>new Promise(r=>root.setTimeout(r,ms));
  const reviewUncertain=message=>{throw Object.assign(new Error(message),{code:'foart-review-state-uncertain'});};
  let pendingImageReview=null,imageReviewUndo=null;
  // Two-image Qwen style fidelity has not passed real-model verification.
  const ART_SETTINGS=['provider','mode','prompt','negativePrompt','width','height','steps','cfg','seed','randomSeed','count','nsfw','samplingOverrides','loras','localDrawEngine','localQwen21Variant','drawingTask','drawingAnalysisEngine','localTextQuality','localEditStrength','localUiEngine','gptQualityTxt2img','gptQualityImg2img','gptSize','gptCustomWidth','gptCustomHeight','uiRunIntent','uiPreserveLayout','uiLayoutMode','uiNativeEditPrompt','iterationReferenceCount'];
  const artSettings=state=>Object.fromEntries(ART_SETTINGS.filter(key=>state[key]!==undefined).map(key=>[key,state[key]]));
  const contract=()=>root.NovaFlowFoartToolContract;
  const SCOPE='[data-novaflow-art-drawing-host="1"],[data-novaflow-art-ui-host="1"],#novaflow-art-generate-workspace,#novaflow-spine-split-workspace-overlay,#novaflow-spine-split-right-workspace,[data-novaflow-spine-split],#novaflow-audio-studio,[data-novaflow-ai-main-stage="1"],[data-novaflow-ai-resource-card="1"],[data-novaflow-ai-bottom-workspace="1"],[data-nf-color-correction-panel],[data-novaflow-ai-cutout-detail],[data-novaflow-ai-cutout-edit-canvas],[data-novaflow-ai-settings-fields],[data-novaflow-ai-top-mode-tabs],[data-novaflow-ai-generation-panel],[data-nf-ve-shell],.nf-ve-shell,[data-novaflow-ai-tool-heading],[data-novaflow-ai-mode-section="1"],[data-novaflow-ai-prompt-dock],[data-novaflow-ai-mode-controls],[data-novaflow-pose-reference="1"],#novaflow-video-frame-edit-overlay,[data-novaflow-video-frame-edit-panel],[data-novaflow-ai-post-section="1"],[data-novaflow-ui-design-inspector="1"],[data-novaflow-ui-layer-properties="1"],[data-novaflow-ui-design-workspace="1"],.nf-panel,[data-novaflow-spine-split-control-category]';
  const ELEMENTS='[data-novaflow-ai-resource-card="1"],button,input,textarea,select,[role="button"],[role="checkbox"],[role="option"],.nf-panel-header,svg[data-svg],[data-novaflow-spine-split-tool-action],[data-novaflow-selection-tool-canvas],canvas[data-novaflow-ai-cutout-edit-canvas],canvas[data-novaflow-mask-tool-canvas],[data-novaflow-split-canvas-art="1"] canvas,.nf-vm-stage canvas,[data-novaflow-ui-design-block],[data-ui-workbench-block],[data-novaflow-spine-split-control-action]';
  const PRODUCTION_SCOPE='#novaflow-aifx-mvp,.fxm-overlay,#novaflow-png-remove-black-root,#novaflow-mp4-compress-root,#novaflow-video-format-convert-root,#novaflow-spine-atlas-webp-root,#novaflow-spine-viewer-root,[data-novaflow-tools-workspace],[data-novaflow-tools-left-panel],[data-novaflow-tools-entry]';
  const productionTools=()=>Object.values(root.NovaFlowProductionTools||{}).map(t=>t.snapshot()).filter(t=>t.active);
  const uiLayout=()=>{if(!root.NovaFlowUiDesignDrawing?.isActive?.())return null;const node=root.NovaFlowUiDesignBridge?.getAgentLayout?.();return {active:true,selectedBlockId:root.NovaFlowUiDesignDrawing.agentSelection?.()?.blockId,partialEditEngine:'qwen-2.1',id:node?.id,width:node?.data?.canvasSize?.width,height:node?.data?.canvasSize?.height,blocks:(node?.data?.blocks||[]).map(({id,name,purpose,requirements,x,y,width,height})=>({id,name,purpose,requirements,x,y,width,height}))};};
  const particle=()=>{if(!root.document.body?.classList?.contains('novaflow-primary-target-particle')||root.NovaFlowAifxMvp?.isOpen?.())return null;const snapshot=root.NovaFlowParticleAgent?.snapshot?.();return snapshot?{...snapshot,exportSettings:root.NovaFlowParticleExportAgent?.snapshot?.()}:null;};
  const effectIds=new WeakMap();let effectSequence=0;
  function effects(){const tool=root.NovaFlowAifxMvp;if(!tool?.isOpen?.())return null;const s=tool.getState();if(s.source&&!effectIds.has(s.source))effectIds.set(s.source,'effect-source-'+(++effectSequence));return {active:true,busy:s.isGenerating,status:s.status,detail:s.detail,source:s.source?{id:effectIds.get(s.source),name:s.source.fileName,bytes:s.source.blob?.size,width:s.source.width,height:s.source.height,duration:s.source.duration,frames:s.sourceFrames.length}:null,reference:s.reference?{name:s.reference.fileName,materialState:s.reference.materialState}:null,attribute:s.attribute,attributeLabel:root.NovaFlowAifxRestyleWorkflow?.getPreset?.(s.attribute)?.label||'',strength:s.strength??root.NovaFlowAifxRestyleWorkflow?.defaultStrengthFor?.(s.reference?'':s.attribute,s.lifecycle,Boolean(String(s.supplement||'').trim())),presetStrength:root.NovaFlowAifxRestyleWorkflow?.defaultStrengthFor?.(s.reference?'':s.attribute,s.lifecycle,false),shape:tool.detectedShape?.()||null,supplement:s.supplement,count:s.candidateCount,selected:s.selectedCandidate,candidates:s.candidates.map(c=>{if(!effectIds.has(c))effectIds.set(c,'effect-'+(++effectSequence));return {id:effectIds.get(c),seed:c.seed,frames:c.result?.frames?.length||0};}),displayedSource:s.finalProduct?.source};}
  const FORBIDDEN=/登录|登出|退出账号|退出登录|密码|密钥|API\s*Key|充值|购买|会员|授权码|算力.*分享|分享.*算力|(?:清空|删除).*(?:全部|所有|账号|工程|项目)/i;
  const ids=new WeakMap(),elements=new Map(),materials=new Map();let sequence=0,nativePending=null,lastResult=null,lastToolOutput=null;
  const imageIds=new WeakMap();let imageSequence=0;
  function imageIdentity(item){if(!item||typeof item!=='object')return '';const url=item.dataUrl||item.imageUrl||'';let prior=imageIds.get(item);if(!prior||prior.url!==url){prior={url,id:'image-'+(++imageSequence)};imageIds.set(item,prior);}return prior.id;}
  function nativeResultExists(){const s=root.NovaFlowSpineSplitBridge?.getState?.();return !!(lastResult?.nativePartId?(s?.parts||[]).some(p=>p.id===lastResult.nativePartId):lastResult?.nativeSourceIdentity&&s?.source&&imageIdentity(s.source)===lastResult.nativeSourceIdentity);}
  async function rememberNativeResult(){
    const bridge=root.NovaFlowSpineSplitBridge,s=bridge?.getState?.(),part=(s?.parts||[]).find(p=>p.id===s.activePartId)||(s?.parts||[]).at(-1);
    let dataUrl=part?.dataUrl||s?.source?.dataUrl,name=part?.name||part?.label||s?.source?.fileName||'美工结果.png';
    if(root.NovaFlowUiDesignDrawing?.isActive?.()&&bridge?.getUiLayerExport)try{const composite=await bridge.getUiLayerExport('png');dataUrl=composite.dataUrl;name=composite.name;}catch{}
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
    for(const key of materials.keys())if(!key.startsWith('upload-')&&!key.startsWith('tool-result-'))materials.delete(key);
    const state=root.NovaFlowSpineSplitBridge?.getState?.(),partExists=nativeResultExists(),generatedExists=root.__NovaFlowArtGenerate?.state.results?.some(r=>r.id===lastResult?.id);
    for(const result of [partExists||generatedExists?lastResult:null,root.__NovaFlowArtGenerate?.selectedResult?.()])if(result?.id&&result.imageUrl)materials.set('result-'+result.id,{id:'result-'+result.id,kind:'image',name:result.name||'上次成图.png',dataUrl:result.imageUrl});
    for(const part of (state?.parts||[]).slice(0,60))if(part.dataUrl)materials.set('layer-'+part.id+'-'+imageIdentity(part),{id:'layer-'+part.id+'-'+imageIdentity(part),kind:'image',name:(part.name||part.label||'图层').replace(/\.png$/i,'')+'.png',dataUrl:part.dataUrl});
    for(const source of (root.NovaFlowSpineSplitBridge?.getSourceResources?.()||[]).slice(-30))if(source.dataUrl)materials.set('source-'+source.id,{id:'source-'+source.id,kind:'image',name:source.fileName||source.name||'原图.png',dataUrl:source.dataUrl});
    for(const r of root.NovaFlowAudioStudio?.resources?.()||[])if(!r.pending&&r.blob)materials.set('audio-resource-'+r.id,{id:'audio-resource-'+r.id,kind:'audio',name:(r.name||'音频').replace(/\.wav$/i,'')+'.wav',blob:r.blob});
    for(const item of root.NovaFlowAiSequenceAssetBridge?.listResources?.()||[])materials.set('resource-'+item.id,{id:'resource-'+item.id,kind:/\.(wav|mp3|ogg|flac|m4a)$/i.test(item.name)?'audio':/\.(png|jpe?g|webp)$/i.test(item.name)?'image':'video',name:item.name,resourceId:item.id});
    const effect=effects(),candidate=effect?.candidates?.[effect.selected];
    if(candidate?.frames&&root.NovaFlowAifxMvp.getState().result)materials.set('effect-result-'+candidate.id,{id:'effect-result-'+candidate.id,kind:'video',name:candidate.id+'.mp4',effectResultId:candidate.id});
    for(const [name,tool] of Object.entries(root.NovaFlowProductionTools||{}))for(const item of tool.files?.()||[])materials.set('tool-'+name+'-'+item.id,{...item,id:'tool-'+name+'-'+item.id,kind:/\.(atlas|json|skel)$/i.test(item.name)?'tool':/\.(png|jpe?g|webp)$/i.test(item.name)?'image':/\.(wav|mp3|flac|ogg)$/i.test(item.name)?'audio':'video'});
    return [...materials.values()].sort((a,b)=>Number(b.id===lastToolOutput?.id)-Number(a.id===lastToolOutput?.id)).slice(0,100).map(({id,name,kind,resourceId})=>({id,name,kind,...(resourceId?{resourceId}:{})}));
  }
  async function materialFile(id){
    const item=materials.get(id);if(!item)fail('素材已不存在，请重新提供');
    if(item.effectResultId){const current=effects();if(current?.candidates?.[current.selected]?.id!==item.effectResultId)fail('所选特效结果已变化，请重新确认当前结果');const result=await root.NovaFlowAifxMvp.agentResultFile();return new root.File([result.blob],result.name,{type:result.blob.type});}
    if(item.file)return item.file;
    if(item.blob)return new root.File([item.blob],item.name,{type:item.blob.type||'audio/wav'});
    if(item.url){const blob=await(await root.fetch(item.url)).blob();return new root.File([blob],item.name,{type:blob.type});}
    if(item.resourceId){const adapter=root.NovaFlowAiSequenceVideoMergeResourceBridge?.createAdapter?.({allowAudio:true,allowImages:true});if(!adapter)fail('资源解析工具尚未就绪');const descriptor=await adapter.resolveResource(item.resourceId);let file=descriptor.file||descriptor.blob;if(!file&&descriptor.localPath)file=root.NovaFlowWebRuntime?.fileForToken?.(descriptor.localPath)||root.NovaFlowWebRuntime?.videoOutputs?.get?.(descriptor.localPath)?.blob;if(!file&&descriptor.objectUrl)file=await(await root.fetch(descriptor.objectUrl)).blob();if(!file)fail('当前资源没有可读取的原始文件');return new root.File([file],descriptor.fileName||item.name||'resource.mp4',{type:file.type||descriptor.mimeType});}
    const dataUrl=item.dataUrl;if(!/^data:image\/(png|jpeg|webp);base64,/.test(dataUrl||''))fail('素材没有完整图片字节');
    const mime=dataUrl.slice(5,dataUrl.indexOf(';')),blob=await(await root.fetch(dataUrl)).blob();return new root.File([blob],item.name||'result.png',{type:mime});
  }
  function visible(el){if(!el)return false;const r=el.getBoundingClientRect?.(),style=root.getComputedStyle?.(el);return !!(el.isConnected&&r?.width>0&&r?.height>0&&!el.closest?.('[hidden],[aria-hidden="true"],#nf-xiaotao-art-root')&&style?.visibility!=='hidden'&&style?.display!=='none'&&style?.opacity!=='0');}
  function fieldLabel(el){
    if(!['INPUT','SELECT','TEXTAREA'].includes(el.tagName))return '';
    let parent=el.parentElement;
    for(let level=0;parent&&level<3;level++,parent=parent.parentElement){const text=String(parent.textContent||'').trim().replace(/\s+/g,' ');if(text&&text.length<=100&&!/^(?:s|ms|px|%|\/s|°|x|y|z|r|g|b|a)$/i.test(text))return text;}
    return '';
  }
  function label(el){const reference=el?.tagName==='BUTTON'&&/^[×✕]$/.test(String(el.textContent||'').trim())?el.closest?.('[data-novaflow-h3-source-id]'):null;if(reference)return '移除'+String(reference.getAttribute('aria-label')||reference.getAttribute('data-novaflow-h3-filename')||'多参引用').slice(0,110);return String(el.getAttribute?.('aria-label')||el.getAttribute?.('title')||el.getAttribute?.('placeholder')||el.labels?.[0]?.textContent||el.getAttribute?.('data-novaflow-spine-split-control-action')||el.getAttribute?.('data-novaflow-spine-split-tool-action')||(["INPUT","SELECT","TEXTAREA"].includes(el.tagName)?el.previousElementSibling?.textContent:"")||el.textContent||el.name||el.id||el.previousElementSibling?.textContent||(el.tagName==='CANVAS'?'当前工具选区画布':'')).trim().replace(/\s+/g,' ').slice(0,120);}
  function catalog(){
    const doc=root.document;if(!doc)return [];
    const candidates=new Set(),mediaOpen=root.NovaFlowAudioStudio?.isOpen?.(),audioOnly=mediaOpen&&root.NovaFlowAudioStudio.sub()==='audio';
    const animationActive=doc.body?.classList?.contains('novaflow-primary-target-animation')&&!mediaOpen;
    const productionActive=!!effects()||productionTools().length>0||doc.body?.classList?.contains('novaflow-primary-target-tools');
    for(const scope of doc.querySelectorAll(audioOnly?'#novaflow-audio-studio':productionActive?PRODUCTION_SCOPE:SCOPE)){if(visible(scope)){if(scope.matches(ELEMENTS))candidates.add(scope);scope.querySelectorAll(ELEMENTS).forEach(el=>candidates.add(el));}}
    if(particle())for(const scope of doc.querySelectorAll('[data-novaflow-template-manager],[data-novaflow-template-popup-layer="1"],[data-novaflow-bottom-controls="1"],[data-novaflow-canvas-bar-button],[aria-label="画布宽度"],[aria-label="画布高度"]'))if(visible(scope)){if(scope.matches(ELEMENTS))candidates.add(scope);scope.querySelectorAll(ELEMENTS).forEach(el=>candidates.add(el));}
    const skeletonFrame=animationActive?doc.querySelector('#novaflow-skeleton-editor-frame'):null;
    if(skeletonFrame&&visible(skeletonFrame))skeletonFrame.contentDocument?.querySelectorAll('button,input,select,textarea,.row[data-key],.row.node,canvas#overlay,.wrow[data-bone]').forEach(el=>candidates.add(el));
    const viewer=doc.querySelector('#novaflow-spine-viewer-root:not([hidden]) iframe');
    if(viewer&&visible(viewer))viewer.contentDocument?.querySelectorAll('button,input,select,textarea').forEach(el=>candidates.add(el));
    if(!audioOnly)for(const scope of doc.querySelectorAll('[data-novaflow-ai-video-merge-workspace="1"],.nf-ve-panel'))if(visible(scope))scope.querySelectorAll(ELEMENTS).forEach(el=>candidates.add(el));
    // Only Foart-owned production dialogs; never account, browser or OS dialogs.
    for(const scope of doc.querySelectorAll('[role="dialog"],[id*="dialog"],[class*="dialog"],[class*="modal"],.aifx-library,[data-novaflow-export-modal-root="1"]')){
      if(scope===doc.body||scope===doc.documentElement||scope.id==='root')continue;
      if(visible(scope)&&(/art|image|split|canvas|mask|upscale|outpaint|video|audio|ui-design|object-transfer|pose|aifx|export/.test(scope.id+' '+scope.className)||scope.matches('[data-novaflow-export-modal-root="1"]'))&&!FORBIDDEN.test(scope.getAttribute('aria-label')||''))scope.querySelectorAll(ELEMENTS).forEach(el=>candidates.add(el));
    }
    elements.clear();const result=[];
    const activeModal=[...doc.querySelectorAll('[role="dialog"][aria-modal="true"],[data-novaflow-export-modal-root="1"]'),...(skeletonFrame?.contentDocument?.querySelectorAll('[role="dialog"],.mask .dialog,.modal,#menu')||[])].filter(el=>visible(el)&&!el.closest('#nf-xiaotao-art-root')).at(-1);
    const modalScope='[role="dialog"],[data-novaflow-export-modal-root="1"],.fxm-overlay,.aifx-library,#menu';
    const orderedCandidates=[...candidates].sort((a,b)=>Number(!!b.closest(modalScope))-Number(!!a.closest(modalScope)));
    for(const el of orderedCandidates){
      if(skeletonFrame&&el.ownerDocument!==skeletonFrame.contentDocument){const r=el.getBoundingClientRect(),f=skeletonFrame.getBoundingClientRect();const x=r.left+r.width/2,y=r.top+r.height/2;if(x>=f.left&&x<=f.right&&y>=f.top&&y<=f.bottom)continue;}
      // A modal covers the workspace in the real UI. Do not offer covered
      // sidebar actions as an alternative to confirming its current fields.
      if(activeModal&&!activeModal.contains(el))continue;
      const file=el.type==='file',exposed=visible(el)||file&&(visible(el.parentElement)||productionActive&&!!el.closest(PRODUCTION_SCOPE)||!!viewer&&el.ownerDocument===viewer.contentDocument||!!skeletonFrame&&el.ownerDocument===skeletonFrame.contentDocument);
      if(result.length>=240||!exposed||el.closest('#novaflow-web-account-header,[class*="auth"],[id*="auth"],[class*="account"],[id*="account"],[class*="login"],[id*="login"]')||['password','hidden'].includes(el.type))continue;
      const animationCanvas=!!skeletonFrame&&el.ownerDocument===skeletonFrame.contentDocument&&el.tagName==='CANVAS'&&el.id==='overlay';
      const artMaskCanvas=el.matches('canvas[data-novaflow-mask-tool-canvas]');
      const artSelectionCanvas=el.matches('canvas[data-novaflow-selection-tool-canvas]');
      if(el.tagName==='CANVAS'&&root.getComputedStyle?.(el)?.pointerEvents==='none')continue;
      const penCanvas=el.tagName==='CANVAS'&&!artMaskCanvas&&!artSelectionCanvas&&!!el.closest('[data-novaflow-split-canvas-art="1"]');
      if(penCanvas&&!root.NovaFlowSpineSplitBridge?.getState?.()?.penTool?.active)continue;
      const videoMaskCanvas=el.tagName==='CANVAS'&&!!el.closest('.nf-vm-stage');
      if(videoMaskCanvas&&doc.body?.getAttribute('data-nf-ve-masking')!=='1')continue;
      const makerCanvas=el.matches('svg[data-svg]');
      const title=animationCanvas?'骨骼动画原生画布（与当前画板预览坐标一致）':makerCanvas?'特效模板轮廓画布':file?(el.getAttribute('aria-label')||el.accept||'原生素材输入'):el.getAttribute('data-novaflow-ai-resource-card')==='1'?'加载资源：'+String(el.textContent||'').replace(/^×/,'').slice(0,110):artMaskCanvas?'美工蒙版画布（原图坐标）':artSelectionCanvas?'美工局部选区画布（原图坐标）':penCanvas?'钢笔轮廓画布':videoMaskCanvas?'视频蒙版画布':label(el)||fieldLabel(el);if(!title||FORBIDDEN.test(title)||el.tagName==='A')continue;
      let id=ids.get(el);if(!id){id='control-'+(++sequence);ids.set(el,id);}elements.set(id,el);
      const tag=el.tagName?.toLowerCase(),role=el.getAttribute('role');
      const kind=file?'file':tag==='canvas'||makerCanvas?'canvas':tag==='select'?'select':tag==='textarea'?'textarea':['checkbox','radio'].includes(el.type)||role==='checkbox'?'checkbox':tag==='input'?'input':'button';
      const row={id,label:title,kind,disabled:!!el.disabled||!!el.readOnly||el.getAttribute('aria-disabled')==='true',dialog:!!el.closest('[role="dialog"],[id*="dialog"],[class*="dialog"],[class*="modal"]'),section:label(el.closest('.nf-panel')?.querySelector('.nf-panel-header')||el.closest('[role="dialog"]')||{textContent:''})};
      if(particle()&&['input','select','checkbox'].includes(kind))row.group=fieldLabel(el);
      if(el.closest('[data-novaflow-art-generate-prompt-kind="positive"]')&&['textarea','input'].includes(kind))row.purpose='image_prompt';
      else if(el.closest('[data-novaflow-ai-prompt-kind="positive"]')&&['textarea','input'].includes(kind))row.purpose='video_prompt';
      if(el.hasAttribute?.('aria-expanded'))row.expanded=el.getAttribute('aria-expanded')==='true';
      if(el.matches('.nf-panel-header')&&!el.hasAttribute('aria-expanded'))row.expanded=visible(el.nextElementSibling);
      if(el.hasAttribute?.('data-novaflow-ai-resource-id')){row.resourceId=el.getAttribute('data-novaflow-ai-resource-id');row.pressed=el.getAttribute('data-novaflow-ai-resource-card-active')==='1';}
      if(el.hasAttribute?.('aria-pressed'))row.pressed=el.getAttribute('aria-pressed')==='true';
      if(skeletonFrame&&el.ownerDocument===skeletonFrame.contentDocument&&el.hasAttribute?.('data-selected'))row.pressed=el.getAttribute('data-selected')==='1';
      if(el.closest?.('[data-track-id]'))row.trackId=el.closest('[data-track-id]').getAttribute('data-track-id');
      if(penCanvas)row.pointerMode='points';
      if(kind==='canvas'){row.width=el.width;row.height=el.height;}
      if(animationCanvas)row.surface='animation';
      if(artMaskCanvas||artSelectionCanvas){const rect=el.getBoundingClientRect();row.displayWidth=rect.width;row.displayHeight=rect.height;row.brushSizeUnit='screen_pixels';row.sourcePixelsPerBrushPixel=el.width/Math.max(1,rect.width);}
      if(mediaOpen&&root.NovaFlowAudioStudio.sub()==='video'&&!el.closest('.nf-ve-shell,[data-nf-ve-shell],#novaflow-video-frame-edit-overlay,[data-novaflow-ai-cutout-detail]')&&el.closest('[data-novaflow-ai-generation-panel],[data-novaflow-ai-prompt-dock],[data-novaflow-ai-mode-controls],[data-novaflow-ai-settings-fields],[data-novaflow-ai-bottom-workspace]'))row.scope='video_generation';
      if(el.type==='range'&&Number(el.min)===.2&&Number(el.max)===5&&el.closest('[data-novaflow-ai-bottom-workspace]'))row.label='视频时间轴缩放';
      if(makerCanvas&&root.__NovaFlowFxMakerOpen?.state?.drawing)row.pointerMode='points';
      if(['input','textarea','select'].includes(kind))row.value=String(el.value||'').slice(0,12000);
      if(kind==='checkbox')row.value=el.checked??el.getAttribute('aria-checked')==='true';
      if(tag==='select')row.options=Array.from(el.options).map(o=>({value:o.value,label:o.textContent,disabled:o.disabled}));
      if(file){row.accept=el.accept||'';row.multiple=!!el.multiple;}
      if(el.getAttribute('data-novaflow-ai-tool-heading')==='frame-edit'&&!root.NovaFlowVideoFrameEditTool?.isOpen?.()&&root.NovaFlowVideoFrameEditTool?.canOpen?.()===false)row.disabled=true;
      if(['number','range'].includes(el.type)){row.type=el.type;for(const key of ['min','max','step'])if(el.getAttribute(key)!==null&&Number.isFinite(Number(el[key])))row[key]=Number(el[key]);}
      if(el.type==='color')row.type='color';
      if(el.matches('[data-novaflow-timeline-time-display]')||el.type==='range'&&el.closest('[data-novaflow-bottom-controls="1"]')&&el.parentElement?.querySelector('[data-novaflow-playback-icon]')){row.volatile=true;row.label='预览播放时间（秒）';row.purpose='preview_time';}
      if(particle()&&el.querySelector('.fa-copy'))row.label='复制当前粒子系统';
      result.push(row);
    }
    return result;
  }
  function imageBinding(rt){return JSON.stringify({settings:artSettings(rt.state),referenceSizeFillPending:rt.state.referenceSizeFillPending??null,references:(rt.references?.()||[]).map(r=>r&&({identity:imageIdentity(r),drawingRole:r.drawingRole??null,role:r.role??null,name:r.name??null,width:r.width??null,height:r.height??null,sourceResultId:r.sourceResultId??null})),result:rt.selectedResult?.()?.id});}
  // Descriptors only: source selection never reads or uploads image bytes.
  const prepareUploadReferenceTransaction=(()=>{
// Isolated prototype: one user-confirmed prompt + reference insertion.
// The caller must supply a project/selection guard; this is not a published API.
const MAX=20*1024*1024;
const ROLES=new Set(['subject','style','pose','background','material','color','composition','lighting','object','result','output','attachment','reference']);
const UI_ROLES=new Set(['layout','style','content','asset','combined','color','material','character','subject','reference']);
const KEYS=['provider','mode','prompt','negativePrompt','width','height','gptSize','gptCustomWidth','gptCustomHeight','referenceSizeFillPending','count'];
const META=['dataUrl','name','role','drawingRole','width','height','sourceResultId'];
const stateValue=s=>Object.fromEntries(KEYS.map(key=>[key,s[key]]));
const refValue=r=>r?Object.fromEntries(META.map(key=>[key,r[key]])):null;
const encode=x=>JSON.stringify(x);
const fail=m=>{throw new Error(m)};

async function prepareUploadReferenceTransaction({runtime:rt,uploads,isProjectCurrent,decodeImage,replaceExisting=false,uiReferenceOnly=false}){
  if(!rt||typeof isProjectCurrent!=='function'||typeof decodeImage!=='function'||
     typeof rt.references!=='function'||typeof rt.referenceLimit!=='function'||typeof rt.setReference!=='function'||typeof rt.isReferenceSizePending!=='function'||
     typeof rt.captureAgentPreparedSnapshot!=='function'||typeof rt.replaceAgentPrepared!=='function'||
     typeof rt.restoreAgentPrepared!=='function'||typeof rt.isAgentPreparedReplacementCurrent!=='function')fail('reference-transaction-unavailable');
  if(uiReferenceOnly&&(typeof rt?.isAgentPreparedSnapshotEmptyAndCurrent!=='function'||
      root.NovaFlowUiDesignDrawing?.isActive?.()!==true||rt.captureContext?.()?.generationSurface!=='ui'))fail('UI reference context unavailable');
  const uiContextCurrent=()=>!uiReferenceOnly||(root.NovaFlowUiDesignDrawing?.isActive?.()===true&&rt.captureContext?.()?.generationSurface==='ui');
  if(!Array.isArray(uploads)||uploads.length<1||uploads.length>3)fail('invalid-reference-count');
  if(rt.state?.mode!=='img2img'||rt.state.running||rt.state.referenceSizeFillPending||isProjectCurrent()!==true)fail('reference-context-unavailable');
  const originalRefs=rt.references().slice(),originalRef=rt.state.reference,originalState=stateValue(rt.state);
  const originalPresence=Object.fromEntries(KEYS.map(key=>[key,Object.hasOwn(rt.state,key)])),hadReference=Object.hasOwn(rt.state,'reference');
  const originalObjects=originalRefs.slice(),originalMeta=encode(originalRefs.map(refValue));
  const limit=rt.referenceLimit();if(!Number.isSafeInteger(limit)||limit<1||limit>16)fail('invalid-reference-limit');
  const existing=originalRefs.filter(Boolean);
  if(existing.length&&replaceExisting!==true)fail('replacement-confirmation-required');
  if(originalRefs.slice(3).some(Boolean)||uploads.length>Math.min(limit,3))fail('reference-capacity-unsupported');
  const slots=Array.from({length:uploads.length},(_,i)=>i);
  // Preserve exact old objects/metadata and never revoke a blob which might be
  // shared elsewhere. This initial replacement path accepts only data URLs.
  const originalFull=JSON.stringify(originalRefs);
  const noPending=()=>originalRefs.every((ref,index)=>!ref||!rt.isReferenceSizePending(index,ref.dataUrl))&&sources.every((image,index)=>!rt.isReferenceSizePending(index,image.dataUrl));
  if(existing.some(ref=>typeof ref.dataUrl!=='string'||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(ref.dataUrl)))fail('原参考图无法安全保存或解码，未提交或扣费');
  if(existing.reduce((total,ref)=>total+Math.ceil(ref.dataUrl.length*3/4),0)>MAX)fail('原参考图过大，暂不能安全替换，未提交或扣费');
  const preparedSnapshot=rt.captureAgentPreparedSnapshot();
  if(uiReferenceOnly&&!rt.isAgentPreparedSnapshotEmptyAndCurrent(preparedSnapshot))fail('UI drawing preparation is not empty');
  const preparedCurrent=()=>!uiReferenceOnly||rt.isAgentPreparedSnapshotEmptyAndCurrent(preparedSnapshot)===true;
  const isOriginal=()=>{
    try{const current=rt.references();return isProjectCurrent()===true&&uiContextCurrent()&&preparedCurrent()&&!rt.state.running&&encode(stateValue(rt.state))===encode(originalState)
      &&noPending()&&rt.referenceLimit()===limit&&rt.state.reference===originalRef&&current.length===originalObjects.length&&current.every((x,i)=>x===originalObjects[i])&&encode(current.map(refValue))===originalMeta&&JSON.stringify(current)===originalFull;}
    catch{return false;}
  };
  // Validate every previous source before any side effect. A failed decode or
  // changing workspace never replaces even a single original slot.
  const sources=uploads.map(image=>Object.freeze({id:image?.id,role:image?.role,dataUrl:image?.dataUrl,name:image?.name}));
  if(uiReferenceOnly&&(sources.some(image=>typeof image.id!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(image.id))||new Set(sources.map(image=>image.id)).size!==sources.length))fail('invalid-reference-identity');
  for(const ref of existing){const size=await decodeImage(ref.dataUrl);if(!isOriginal())fail('reference-context-changed');
    if(!size||!Number.isSafeInteger(size.width)||!Number.isSafeInteger(size.height)||size.width<1||size.height<1)fail('原参考图无法安全保存或解码，未提交或扣费');}
  let total=0;
  const copies=[];
  for(const image of sources){
    if(!image||typeof image!=='object'||!(uiReferenceOnly?UI_ROLES:ROLES).has(image.role)||typeof image.dataUrl!=='string')fail('invalid-reference-role');
    const match=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image.dataUrl);
    if(!match||match[2].length%4)fail('invalid-reference-format');
    const bytes=match[2].length/4*3-(match[2].endsWith('==')?2:match[2].endsWith('=')?1:0);total+=bytes;
    if(bytes<1||total>MAX)fail('invalid-reference-size');
    const size=await decodeImage(image.dataUrl);if(!isOriginal())fail('reference-context-changed');
    if(!size||!Number.isSafeInteger(size.width)||!Number.isSafeInteger(size.height)||size.width<1||size.height<1||size.width>32768||size.height>32768)fail('reference-decode-failed');
    copies.push({...(uiReferenceOnly?{id:image.id}:{}),name:String(image.name||'reference').slice(0,180),dataUrl:image.dataUrl,role:image.role,drawingRole:image.role,width:size.width,height:size.height});
  }
  if(!isOriginal())fail('reference-context-changed');
  let phase='ready',undoToken=null,appliedState=null,appliedRefs=null,appliedMeta=null,appliedReference=null;
  function restoreOriginal(){rt.state.references=originalRefs.slice();if(hadReference)rt.state.reference=originalRef;else delete rt.state.reference;
    for(const [key,value] of Object.entries(originalState)){if(originalPresence[key])rt.state[key]=value;else delete rt.state[key];}}
  function isApplied(){try{const refs=rt.references();return isProjectCurrent()===true&&uiContextCurrent()&&preparedCurrent()&&!rt.state.running&&encode(stateValue(rt.state))===encode(appliedState)
    &&noPending()&&JSON.stringify(originalRefs)===originalFull&&rt.referenceLimit()===limit&&rt.state.reference===appliedReference&&refs.length===appliedRefs.length&&refs.every((x,i)=>x===appliedRefs[i])&&encode(refs.map(refValue))===appliedMeta&&(uiReferenceOnly||rt.isAgentPreparedReplacementCurrent(undoToken)===true);}catch{return false;}}
  return Object.freeze({
    ...(uiReferenceOnly?{requestReferences:Object.freeze(copies.map(ref=>Object.freeze({id:ref.id,role:ref.role,dataUrl:ref.dataUrl})))}:{}),
    apply({prompt,negativePrompt,createPrepared}){
      if(phase!=='ready'||!isOriginal()||typeof prompt!=='string'||!prompt.trim()||typeof negativePrompt!=='string'||(!uiReferenceOnly&&typeof createPrepared!=='function'))fail('reference-context-changed');
      let expectedState=stateValue(rt.state),expectedRefs=rt.references().slice(),expectedMeta=encode(expectedRefs.map(refValue)),expectedReference=rt.state.reference;
      const matchesExpected=()=>{try{const refs=rt.references();return isProjectCurrent()===true&&uiContextCurrent()&&preparedCurrent()&&!rt.state.running&&encode(stateValue(rt.state))===encode(expectedState)&&noPending()&&rt.referenceLimit()===limit&&rt.state.reference===expectedReference&&refs.length===expectedRefs.length&&refs.every((x,i)=>x===expectedRefs[i])&&encode(refs.map(refValue))===expectedMeta;}catch{return false;}};
      try{
        for(let i=0;i<slots.length;i++){
          rt.setReference(slots[i],copies[i]);
          while(expectedRefs.length<=slots[i])expectedRefs.push(null);
          expectedRefs[slots[i]]=copies[i];
          if(slots[i]===0)expectedReference=copies[i];
          if(slots[i]===0){const pending=rt.state.referenceSizeFillPending;if(pending!==originalState.referenceSizeFillPending&&pending!==''&&pending!==copies[i].dataUrl)fail('reference-commit-unconfirmed');expectedState.referenceSizeFillPending=pending;}
          expectedMeta=encode(expectedRefs.map(refValue));
          if(!matchesExpected())fail('reference-commit-unconfirmed');
        }
        // Remove any old trailing slots after installing the uploaded images.
        // Every original item was verified as a data URL, so no shared blob is revoked.
        if(replaceExisting){for(let index=slots.length;index<Math.min(limit,3);index++){
          if(!expectedRefs[index])continue;
          rt.setReference(index,null);expectedRefs[index]=null;expectedMeta=encode(expectedRefs.map(refValue));
          if(!matchesExpected())fail('reference-commit-unconfirmed');
        }}
        // Image dimensions were decoded before commit, and
        // no previous size-fill was pending. Do not schedule a new fill.
        rt.state.referenceSizeFillPending=originalState.referenceSizeFillPending;expectedState.referenceSizeFillPending=originalState.referenceSizeFillPending;
        rt.state.prompt=prompt;rt.state.negativePrompt=negativePrompt;expectedState.prompt=prompt;expectedState.negativePrompt=negativePrompt;
        if(!matchesExpected())fail('reference-commit-unconfirmed');
        if(!uiReferenceOnly){
          const prepared=createPrepared({references:rt.references().slice(),slots:slots.slice()});
          if(!matchesExpected())fail('reference-commit-unconfirmed');
          undoToken=rt.replaceAgentPrepared(preparedSnapshot,prepared);
          if(!matchesExpected())fail('reference-commit-unconfirmed');
        }
        appliedState=stateValue(rt.state);appliedRefs=rt.references().slice();appliedMeta=encode(appliedRefs.map(refValue));appliedReference=rt.state.reference;
        if(!isApplied())fail('reference-commit-unconfirmed');phase='applied';return {slots:slots.slice()};
      }catch(error){
        if(!matchesExpected())fail('reference-rollback-unconfirmed');
        if(undoToken){if(!rt.isAgentPreparedReplacementCurrent(undoToken))fail('reference-rollback-unconfirmed');rt.restoreAgentPrepared(undoToken);}
        restoreOriginal();phase='closed';throw error;
      }
    },
    undo(){if(phase!=='applied'||!isApplied())fail('reference-context-changed');if(!uiReferenceOnly)rt.restoreAgentPrepared(undoToken);restoreOriginal();phase='closed';return true;},
    isCurrent(){return phase==='applied'&&isApplied()},
    cancel(){if(phase!=='ready')return false;phase='closed';return true;}
  });
}

    return prepareUploadReferenceTransaction;
  })();
  function captureDrawingReferenceRoles(){
    const rt=root.__NovaFlowArtGenerate,ctx=rt?.captureContext?.();
    if(ctx?.generationSurface!=='drawing'||rt?.state?.mode!=='img2img'||typeof rt.references!=='function')fail('请先打开图生图页面');
    const refs=Array.from(rt.references()),last=refs.findLastIndex(Boolean);
    if(last<0||last>=3||refs.slice(0,last+1).some(r=>!r))fail('请确认一至三张连续参考图');
    return refs.slice(0,last+1).map((r,i)=>Object.freeze({index:i+1,identity:imageIdentity(r),role:r.drawingRole??r.role??'auto'}));
  }
  function capture(){
    const rt=root.__NovaFlowArtGenerate,s=root.NovaFlowSpineSplitBridge?.getState?.(),result=rt?.selectedResult?.();
    const rawMedia=root.NovaFlowMediaAgent?.capture?.().artContext;
    const media=rawMedia?.active?rawMedia.sub==='audio'?{surface:'media',active:true,sub:'audio',audio:rawMedia.audio,audioResources:rawMedia.audioResources,videoResources:rawMedia.videoResources,audioSettings:rawMedia.audioSettings}:{...rawMedia,audio:undefined,audioResources:undefined,audioSettings:undefined}:null;
    const generationSurface=rt?.captureContext?.().generationSurface,artActive=!media&&['drawing','ui'].includes(generationSurface);
    return {schema:contract().FOART_TOOL_SCHEMA,controls:catalog(),uploads:materialList(),
      art:rt&&artActive?{surface:generationSurface,provider:rt.state.provider,mode:rt.state.mode,count:rt.state.count||1,prompt:rt.state.prompt||'',running:!!rt.state.running,error:rt.state.error||'',result:result?{id:result.id,name:result.name,width:result.width,height:result.height,requestedWidth:result.requestedWidth,requestedHeight:result.requestedHeight,placedInSource:result.placedInSource}:null,references:(rt.references?.()||[]).filter(Boolean).map((r,i)=>({index:i+1,identity:imageIdentity(r),name:r.name||r.file?.name||'',drawingRole:r.drawingRole??null,role:r.role??null,hasImage:!!r.dataUrl})),referenceLimit:rt.referenceLimit?.()}:rt?{surface:'inactive',provider:rt.state.provider,result:result?{id:result.id,name:result.name}:null}:null,
      artEditor:s&&artActive?{busy:!!s.busy,action:s.busyAction||'',editingTool:s.maskEditor?.active?'mask':s.selectionTool?.active?'selection':s.penTool?.active?'pen':s.objectTransfer?.active?'objectTransfer':null,editingAction:s.maskEditor?.active?'mask':s.selectionTool?.active?(s.selectionTool.mode==='inpaint'?{edit:'inpaintEdit',repair:'inpaintRepair',completion:'inpaintCompletion'}[s.selectionTool.inpaintMode]||'inpaintCompletion':s.selectionTool.generativeSplit?'generativeSplit':'cutout'):s.penTool?.active?(s.penTool.mode==='fill'?'penFill':'penCutout'):s.objectTransfer?.active?'objectTransfer':null,objectTransfer:root.NovaFlowSpineSplitBridge?.agentTransferContext?.()||null,message:s.message||'',error:!!s.messageError,source:s.source?{identity:imageIdentity(s.source),name:s.source.fileName||'',hasImage:!!s.source.dataUrl}:null,size:s.sourceSize,selected:s.selectedPartIds||[],layers:(s.parts||[]).slice(0,60).map(p=>({id:p.id,identity:imageIdentity(p),name:p.name||p.label||p.id,label:p.name||p.label||p.id,visible:p.visible!==false,locked:!!p.locked})),tools:contract().FOART_ART_ACTIONS}:null,
      media,animation:!media&&root.NovaFlowSkeletonEditor?.active?.()?root.NovaFlowSkeletonEditor.api()?.agentContext?.()||null:null,uiLayout:uiLayout(),particle:particle(),effects:effects(),productionTools:productionTools(),pose:root.NovaFlowPoseReferenceTool?.agentContext?.()||null,frameEditor:root.NovaFlowVideoFrameEditTool?.agentContext?.()||null,mediaActions:['generate_video','optimize_video_prompt','generate_music','generate_sfx','import_resource','select_clip','split','trim','move','rate','volume','fade','duplicate','remove','export','save_mix','loops','play','pause','seek','track_gain','track_mute','track_solo','clip_transform','clip_visibility'],
      lastToolOutput:lastToolOutput?{...lastToolOutput}:null,pending:nativePending?{id:nativePending.id,name:nativePending.name,state:nativePending.state,error:nativePending.error||''}:null,lastOutput:lastResult?{id:lastResult.id,name:lastResult.name}:null};
  }
  function click(el){const r=el.getBoundingClientRect(),init={bubbles:true,cancelable:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2,button:0,pointerId:1,pointerType:'mouse',isPrimary:true};for(const type of ['pointerdown','mousedown','pointerup','mouseup','click'])el.dispatchEvent(type.startsWith('pointer')?new root.PointerEvent(type,init):new root.MouseEvent(type,init));}
  async function open(surface,{signal}={}){
    if(surface==='tools'&&signal?.aborted)fail('操作已停止，请确认当前工作区。');
    const toolsReady=()=>root.NovaFlowAudioStudio?.isOpen?.()!==true&&root.document.body?.classList?.contains('novaflow-primary-target-tools')===true;
    const mediaOpen=root.NovaFlowAudioStudio?.isOpen?.()===true;
    const drawingReady=()=>{
      if(root.__NovaFlowArtGenerate?.captureContext?.().generationSurface!=='drawing')return false;
      const split=root.NovaFlowSpineSplitBridge?.getState?.();
      const editing=split&&(split.maskEditor?.active||split.selectionTool?.active||split.penTool?.active||split.objectTransfer?.active
        ||(split.source&&root.document.getElementById('novaflow-spine-split-workspace-overlay')));
      return !!editing||root.__NovaFlowArtGenerate?.state?.active===true
        &&!!root.document.getElementById('novaflow-art-generate-workspace');
    };
    const uiReady=()=>root.__NovaFlowArtGenerate?.captureContext?.().generationSurface==='ui'&&root.NovaFlowUiDesignDrawing?.isActive?.()===true;
    const beforeUiSurface=surface==='ui'?root.__NovaFlowArtGenerate?.captureContext?.().generationSurface:null;
    const drawingCurrent=surface==='drawing'&&!mediaOpen&&root.__NovaFlowArtGenerate?.captureContext?.().generationSurface==='drawing';
    const alreadyOpen=(surface==='drawing'&&!mediaOpen&&drawingReady())
      ||(surface==='ui'&&!mediaOpen&&uiReady())
      ||surface==='animation'&&!mediaOpen&&root.NovaFlowSkeletonEditor?.active?.()
      ||surface==='tools'&&!mediaOpen&&root.document.body?.classList?.contains('novaflow-primary-target-tools')
      ||surface==='effects'&&!mediaOpen&&!!effects()
      ||surface==='particle'&&!mediaOpen&&!!particle()
      ||['audio','video'].includes(surface)&&mediaOpen&&root.NovaFlowAudioStudio.sub()===surface;
    // Re-clicking the current art entry reactivates generation and discards an
    // in-progress mask. A tool handoff within the same surface must preserve it.
    if(alreadyOpen)return {action:'open',phase:'opened',surface,reused:true,message:'已在当前'+({drawing:'绘图',ui:'UI设计',animation:'动画',video:'视频',audio:'音频',tools:'工具版块',effects:'AI特效',particle:'粒子特效'}[surface])+'工具中继续'};
    if(surface==='animation'){
      root.NovaFlowAudioStudio?.close?.();
      let primaryAttempts=0,idleSamples=0,selectedSecondary=false;
      for(let i=0;i<60&&!root.NovaFlowSkeletonEditor?.active?.();i++){
        const inAnimation=root.document.body?.classList?.contains('novaflow-primary-target-animation');
        if(!inAnimation){
          const settling=root.NovaFlowPrimaryAnimationEntrySettling?.();
          if(primaryAttempts===0 || (primaryAttempts===1 && settling===false && ++idleSamples>=3)){
            const nav=Array.from(root.document.querySelectorAll('[data-novaflow-primary-entry="1"]')).find(el=>label(el)==='动画'&&visible(el));
            if(nav){click(nav);primaryAttempts++;idleSamples=0;}
          }
          if(settling!==false)idleSamples=0;
        } else if(!selectedSecondary && root.NovaFlowPrimaryAnimationEntrySettling?.() !== true){
          const secondary=Array.from(root.document.querySelectorAll('[data-novaflow-secondary-entry="1"]')).find(el=>label(el)==='骨骼动画'&&visible(el));
          if(secondary){const selected=secondary.getAttribute('aria-pressed')==='true'||secondary.getAttribute('data-novaflow-secondary-active')==='1';if(!selected)click(secondary);selectedSecondary=true;}
        }
        await sleep(100);
      }
      if(!root.NovaFlowSkeletonEditor?.active?.())fail('动画编辑器尚未就绪');
    }
    else if(['audio','video'].includes(surface)){if(!root.NovaFlowAudioStudio)fail('音视工具尚未加载');root.NovaFlowAudioStudio.open(surface);}
    else if(['effects','particle','tools'].includes(surface)){
      root.NovaFlowAudioStudio?.close?.();
      const title=surface==='tools'?'工具':'特效';
      const nav=Array.from(root.document.querySelectorAll('[data-novaflow-primary-entry="1"]')).find(el=>(el.getAttribute('data-novaflow-primary-label')||el.getAttribute('aria-label')||el.textContent).trim()===title);if(!nav)fail(title+'入口尚未就绪');click(nav);await sleep(100);
      if(surface==='tools'){
        for(let attempt=0;attempt<30&&!toolsReady();attempt++){
          if(signal?.aborted)fail('操作已停止，请确认当前工作区。');
          await sleep(100);
        }
        if(signal?.aborted||!toolsReady())fail('工具工作区尚未准备完成，请重试。');
      }
      if(surface==='effects')await root.NovaFlowAifxMvp?.open?.();
      if(surface==='particle'){const tab=Array.from(root.document.querySelectorAll('[data-novaflow-secondary-entry="1"]')).find(el=>label(el)==='粒子特效');if(!tab)fail('粒子特效入口尚未就绪');click(tab);}
    }
    else{
      if(!drawingCurrent){
        const nav=Array.from(root.document.querySelectorAll('[data-novaflow-primary-entry="1"]')).find(el=>/美工/.test(el.getAttribute('data-novaflow-primary-label')||el.getAttribute('aria-label')||el.textContent));if(!nav)fail('美工入口尚未就绪');click(nav);await sleep(80);
        if(surface==='ui'&&signal?.aborted)fail('操作已停止，请确认当前工作区。');
        const afterPrimary=surface==='ui'?root.__NovaFlowArtGenerate?.captureContext?.().generationSurface:null;
        if(surface==='ui'&&afterPrimary&&afterPrimary!==beforeUiSurface&&afterPrimary!=='drawing'&&afterPrimary!=='ui')fail('已切换工作区，请重新打开 UI 设计。');
        const secondary=Array.from(root.document.querySelectorAll('[data-novaflow-secondary-entry="1"]')).find(el=>label(el)===(surface==='ui'?'UI':'绘图'));if(secondary)click(secondary);
        await sleep(80);
      }
      if(surface==='ui'){
        for(let attempt=0;attempt<30&&!uiReady();attempt++){
          if(signal?.aborted)fail('操作已停止，请确认当前工作区。');
          const current=root.__NovaFlowArtGenerate?.captureContext?.().generationSurface;
          if(current&&current!=='ui'&&current!=='drawing')fail('已切换工作区，请重新打开 UI 设计。');
          await sleep(100);
        }
        if(signal?.aborted)fail('操作已停止，请确认当前工作区。');
        if(!uiReady())fail('UI 设计工作区尚未准备完成，请重试。');
      }
      if(surface==='drawing'){
        // A route class alone does not mean the drawing workspace has mounted.
        // Only retry while it is absent; reactivating an open workspace can reset edits.
        let reachedDrawing=drawingCurrent;
        for(let attempt=0;attempt<100&&!drawingReady();attempt++){
          const rt=root.__NovaFlowArtGenerate;
          const current=rt?.captureContext?.().generationSurface;
          if(current==='drawing')reachedDrawing=true;
          else if(reachedDrawing&&current)fail('已切换工作区，请重新打开绘图。');
          if(current==='drawing'&&attempt%3===0){
            if(rt.state?.active!==true)rt.activate?.();
            else if(!root.document.getElementById('novaflow-art-generate-workspace'))rt.render?.();
          }
          if(!drawingReady())await sleep(100);
        }
        if(!drawingReady())fail('绘图工作区尚未准备完成，请重试。');
      }
    }
    await sleep(100);
    if(surface==='tools'&&(signal?.aborted||!toolsReady()))fail('工具工作区已变更或停止，请确认当前页面。');
    if(surface==='ui'&&(signal?.aborted||!uiReady()))fail('UI 设计工作区已变更或停止，请确认当前页面。');
    if(['audio','video'].includes(surface)&&(root.NovaFlowAudioStudio?.isOpen?.()!==true||root.NovaFlowAudioStudio?.sub?.()!==surface))fail('音视入口未保持打开，请根据当前工作区重试');
    return {action:'open',phase:'opened',surface,message:surface==='tools'?'已打开工具版块':'已打开'+({drawing:'绘图',ui:'UI设计',video:'视频',audio:'音频',effects:'AI特效',particle:'粒子特效',animation:'动画'}[surface])+'工具'};
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
  async function loadNativeResourceCard(resourceId,{signal}={}){
    const card=()=>[...root.document.querySelectorAll('[data-novaflow-ai-resource-card="1"]')].find(el=>el.getAttribute('data-novaflow-ai-resource-id')===resourceId);
    const resource=root.NovaFlowAiSequenceAssetBridge?.listResources?.().find(r=>r.id===resourceId);
    for(let i=0;i<60&&!visible(card());i++){if(signal?.aborted)fail('已停止载入资源');await sleep(50);}
    const initial=card();
    if(!resource||!visible(initial))fail('指定资源卡尚未就绪，未选择其他文件');
    // The original card events update both its board session and the React
    // media. Calling only the low-level loader leaves the old board selected.
    click(initial);
    const matches=()=>{const selected=card();if(selected?.getAttribute('data-novaflow-ai-resource-card-active')!=='1')return false;if(!/\.(mp4|webm)$/i.test(resource.name||''))return true;const preview=root.NovaFlowVideoFrameEditTool?.previewContext?.();return preview?.resourceId===resourceId&&preview.ready;};
    for(let i=0;i<60&&!matches();i++){if(signal?.aborted)fail('已停止载入资源');await sleep(50);}
    if(!matches())fail('指定资源与画板来源尚未同步，未继续操作其他文件');
    return resource;
  }
  async function frameOpen(resourceId,{signal,onStatus}){
    const resource=capture().media?.videoResources?.find(r=>r.id===resourceId),tool=root.NovaFlowVideoFrameEditTool;
    if(!resource||!tool?.agentOpen)fail('当前视频或原生帧编辑器不存在或尚未更新');
    const activeCard=()=>[...root.document.querySelectorAll('[data-novaflow-ai-resource-card="1"]')].find(el=>el.getAttribute('data-novaflow-ai-resource-id')===resourceId&&el.getAttribute('data-novaflow-ai-resource-card-active')==='1');
    if(tool.isOpen?.()){
      const current=tool.agentContext?.();
      if(!activeCard()||current?.sourceName!==resource.name)fail('另一个视频帧编辑仍打开，请先完成或退出，未覆盖当前帧编辑');
      return {action:'frame_open',phase:'opened',resourceId,name:resource.name,...current,message:'已在当前视频帧编辑器中继续：'+resource.name+'（'+current.frames+' 帧）'};
    }
    if(root.NovaFlowAiSequenceVideoMergeWorkspace?.isOpen?.())fail('视频剪辑工作区仍打开，请先将需要编辑的剪辑保存为资源，未关闭或丢弃当前时间轴');
    await open('video');
    onStatus('正在载入指定视频的原生帧编辑器…');
    await loadNativeResourceCard(resourceId,{signal});
    if(!activeCard()||tool.canOpen?.()===false)fail('指定视频尚未加载到画板，未打开其他视频的帧');
    // The native agent entry expands its own original tool group and returns
    // errors inline, instead of leaving the whole page blocked by window.alert.
    await tool.agentOpen();await waitNativeIdle(signal,onStatus);
    if(!tool.isOpen?.())fail('原生帧编辑未能打开指定视频');
    const actual=tool.agentContext?.();if(!actual||actual.sourceName!==resource.name||!actual.frames)fail('帧编辑实际来源与指定视频不一致，未继续修改');
    return {action:'frame_open',phase:'opened',resourceId,name:resource.name,...actual,message:'已打开指定视频帧编辑：'+actual.sourceName+'（'+actual.frames+' 帧，'+actual.fps+' fps，'+actual.width+'×'+actual.height+'）'};
  }
  async function image(op,{signal,requirements,onStatus,provider,modelId,onlineBusiness,selectionStillCurrent,currentDrawingTextOnly,currentDrawingVisionOnly,referenceSource,projectStillCurrent,referenceRoles,uploadReferences,attachmentStillCurrent,replacePageReferencesConfirmed}){
    const scopedText=currentDrawingTextOnly===true;
    const scopedVision=currentDrawingVisionOnly===true;
    const scopedUploads=scopedVision&&referenceSource==='uploads';
    if(scopedText&&scopedVision)fail('绘图优化范围冲突，未提交或扣费。');
    if(scopedVision&&(provider!=='api'||op.action!=='image_optimize'||op.generationMode!=='img2img'||!['page','uploads'].includes(referenceSource)))
      fail('请先在绘图页面确认参考图来源和用途，未提交或扣费。');
    if(scopedText&&(provider!=='api'||op.action!=='image_optimize'||op.generationMode!=='txt2img'))
      fail('该入口只支持当前绘图的纯文字提示词优化，未提交或扣费。');
    const selectedOnlineArt=provider==='api'&&(scopedText
      ?root.electronAPI?.onlineTextArtAvailableSync?.()===true
      :scopedVision?root.electronAPI?.onlineVisionArtAvailableSync?.()===true
      :root.electronAPI?.onlineBusinessAvailableSync?.()===true);
    if(scopedText&&!selectedOnlineArt)fail('在线纯文字绘图优化尚未开通，未提交或扣费。');
    if(scopedVision&&!selectedOnlineArt)fail('所选模型的参考图提示词优化尚未开通，未提交或扣费。');
    const selectedLocalArt=provider==='local'&&modelId==='qwen3.5-9b-heretic'&&root.electronAPI?.qwenBusinessAvailableSync?.()===true;
    if(provider==='api'){
      const selected=root.NovaFlowXiaotaoArtAgent?.panel?.controller?.businessModelSnapshot?.();
      if(!selected||selected.provider!=='api'||!selected.modelId||(modelId&&selected.modelId!==modelId))fail('当前模型选择无法确认，未提交或扣费。');
      if(scopedText&&(!modelId||!Number.isSafeInteger(selected.epoch)))fail('当前模型选择无法确认，未提交或扣费。');
      modelId=selected.modelId;
    }
    if(provider==='local' && modelId==='qwen3.5-9b-heretic' && !selectedLocalArt)fail('Qwen 9B 的提示词优化节点尚未就绪，未提交或切换模型。');
    if(signal?.aborted)fail('制作已停止');
    const rt=root.__NovaFlowArtGenerate;if(!rt)fail('绘图工具尚未就绪');if(rt.state.running)fail('已有绘图任务运行中');
    const ui=root.NovaFlowUiDesignDrawing?.isActive?.();
    if(scopedVision){
      const selectedCurrent=selectionStillCurrent,initialRoute=rt.captureContext?.()?.routeRevision;
      if(!Number.isSafeInteger(initialRoute))fail('页面状态无法核验，请重新打开后重试');
      if(typeof selectedCurrent!=='function'||typeof projectStillCurrent!=='function')fail('无法验证当前模型与页面，未提交或扣费。');
      selectionStillCurrent=()=>{try{return selectedCurrent()===true&&projectStillCurrent()===true&&root.__NovaFlowArtGenerate===rt&&root.NovaFlowUiDesignDrawing?.isActive?.()!==true&&rt.captureContext?.()?.generationSurface==='drawing'&&rt.captureContext?.()?.routeRevision===initialRoute&&rt.state.active===true;}catch{return false;}};
      if(!selectionStillCurrent())fail('请回到当前绘图页面选择参考图，未提交或扣费。');
    }
    if(scopedText&&(ui||rt.state.mode!=='txt2img'||typeof rt.references!=='function'||Array.from(rt.references()).some(Boolean)))
      fail('该入口不支持参考图片或图生图，未提交或扣费。');
    if(!ui&&provider==='local'&&!selectedLocalArt&&rt.state.provider==='gpt')
      fail('本地小桃大脑尚未接通该绘图优化，未调用在线优化器或扣费。');
    const localReferenceSlots=Array.from(rt.references?.()||[]),localReferences=localReferenceSlots.filter(Boolean);
    if(scopedText&&localReferences.length)fail('参考图状态已变化，未提交或扣费。');
    let inferredLocalRoles=null;
    if(selectedLocalArt&&op.generationMode==='img2img'&&localReferences.length===2&&typeof root.NovaFlowArtDirection?.input==='function'){
      const resolved=root.NovaFlowArtDirection.input({state:{...rt.state,prompt:op.prompt},references:localReferenceSlots}).references;
      if(resolved.length===2&&resolved.every(ref=>ref.roles?.length===1)&&resolved.map(ref=>ref.roles[0]).sort().join(',')==='style,subject')
        inferredLocalRoles=new Map(resolved.map(ref=>[ref.source,ref.roles[0]]));
    }
    const localPair=Boolean(inferredLocalRoles);
    const localImageEdit=selectedLocalArt&&op.generationMode==='img2img'&&localReferences.length>=1&&localReferences.length<=3&&root.electronAPI?.qwen21LocalImageEditAvailableSync?.()===true;
    if(localImageEdit){
      const selectedCurrent=selectionStillCurrent,context=rt.captureContext?.(),route=context?.routeRevision,revision=context?.referenceRevision;
      if(rt.state.nsfw===true||typeof selectedCurrent!=='function'||!Number.isSafeInteger(route)||!Number.isSafeInteger(revision)||context?.generationSurface!=='drawing'||context.state!==rt.state||rt.state.active!==true)
        fail('当前绘图页面、参考图或内容状态无法核验，未提交。');
      selectionStillCurrent=()=>{try{const now=rt.captureContext();return selectedCurrent()===true&&root.__NovaFlowArtGenerate===rt&&now.state===rt.state&&rt.state.active===true&&now.generationSurface==='drawing'&&now.routeRevision===route&&now.referenceRevision===revision;}catch{return false;}};
      if(!selectionStillCurrent())fail('绘图页面或参考图已变化，未提交。');
    }
    if(localPair&&!localImageEdit)fail('当前节点的参考图优化尚未就绪，未提交。');
    if(selectedLocalArt && (ui||op.action!=='image_optimize'||!(op.generationMode==='txt2img'&&!localReferences.length||localPair||localImageEdit)))
      fail('本地节点仅在能力就绪时支持 1–3 张参考图优化；请检查图片数量和节点版本。');
    if(!ui&&(selectedOnlineArt||selectedLocalArt)){
      if((selectedOnlineArt&&!onlineBusiness)||typeof selectionStillCurrent!=='function')fail('\u6240\u9009\u6a21\u578b\u7684\u786e\u8ba4\u7ec4\u4ef6\u4e0d\u53ef\u7528\uff0c\u672a\u63d0\u4ea4\u3002');
      const selected=root.NovaFlowXiaotaoArtAgent?.panel?.controller?.businessModelSnapshot?.(),sessionStillCurrent=root.electronAPI?.captureFoartSessionGuard?.();
      if(selected?.provider!==provider||selected?.modelId!==modelId||typeof sessionStillCurrent!=='function'||!sessionStillCurrent())fail('\u6a21\u578b\u6216\u8d26\u53f7\u4f1a\u8bdd\u4e0d\u53ef\u9a8c\u8bc1\uff0c\u672a\u63d0\u4ea4\u3002');
      const gptDrawing=rt.state.provider==='gpt';
      if(selectedLocalArt&&gptDrawing)fail('Qwen 9B 目前只能优化 Qwen 绘图模型的文字提示词，未提交。');
      if(!gptDrawing&&rt.state.provider!=='local')fail('当前绘图模型未接通所选小桃大脑，未提交。');
      const requestedText=String(requirements||'');
      const requestedGpt=/GPT\s*(?:Image\s*)?2[.．]5/i.test(requestedText),requestedQwen=/Qwen|千问/i.test(requestedText);
      if(requestedGpt&&requestedQwen)fail('请明确本次使用哪个绘图模型，未提交优化。');
      if(!gptDrawing&&requestedGpt)
        fail('请先在绘图面板选择 GPT Image 2.5，未提交优化。');
      if(gptDrawing&&requestedQwen)fail('请先在绘图面板选择 Qwen 绘图模型，未提交优化。');
      if(op.useResult)fail('请先在绘图界面手动选好要使用的结果，再提交优化。');
      if(rt.state.mode!==op.generationMode)fail('请先在绘图界面切换到所需模式，再提交优化。');
      const capability=root.NovaFlowArtGenerateModels?.capabilityFor?.(rt.state.provider,op.generationMode,rt.state);
      if(!capability||(gptDrawing?capability.negativePrompt!==false:!['qwen-2.1','qwen-2.1-turbo'].includes(capability.engine)))
        fail('当前绘图引擎尚未接入所选小桃在线模型，未提交优化或生成。');
      if(rt.state.referenceSizeFillPending)fail('参考图尺寸仍在读取，未提交优化。');
      const referenceSlots=Array.from(rt.references?.()||[]), lastReference=referenceSlots.findLastIndex(Boolean);
      if(scopedUploads&&lastReference>=0&&replacePageReferencesConfirmed!==true)fail('请先确认使用上传图替换页面参考；当前内容保留，未提交或扣费。');
      if(scopedUploads&&(typeof attachmentStillCurrent!=='function'||attachmentStillCurrent()!==true))fail('上传图片已变化，请重新选择；未提交或扣费。');
      if(scopedVision&&!scopedUploads&&lastReference<0)fail('请先把要使用的参考图放入绘图参考槽，未提交或扣费。');
      if(scopedText&&lastReference>=0)fail('参考图状态已变化，未提交或扣费。');
      if(lastReference>=3||referenceSlots.slice(0,lastReference+1).some(ref=>!ref))fail('参考图最多三张，且请先填满前面的参考图位置；未提交优化。');
      const sizes=[...new Set([...String(requirements||'').matchAll(/\b(\d{2,4})\s*[×xX*＊]\s*(\d{2,4})\b/g)].map(m=>m[1]+'x'+m[2]))];
      const currentSize=gptDrawing?(rt.state.gptSize==='Custom'?String(rt.state.gptCustomWidth)+'x'+String(rt.state.gptCustomHeight):String(rt.state.gptSize||'')):String(rt.state.width)+'x'+String(rt.state.height);
      if(sizes.length>1||sizes.length===1&&sizes[0]!==currentSize)
        fail('请先在绘图界面设置所需尺寸，再提交优化。');
      const countMatch=/(?:生成|来|画|出图)[^数字\n]{0,16}?(\d{1,2}|一|两|二|三|四|五|六|七|八|九|十)\s*张/.exec(String(requirements||''));
      const countWord=countMatch?.[1],requestedCount=countWord?({一:1,两:2,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10}[countWord]??Number(countWord)):undefined;
      if((op.count!==undefined&&op.count!==rt.state.count)||(requestedCount!==undefined&&requestedCount!==rt.state.count))fail('请先在绘图界面设置所需数量，再提交优化。');
      const count=rt.state.count??1;
      if(!Number.isInteger(count)||count<1||count>10)fail('绘图数量不在原有范围内。');
      if(typeof rt.captureAgentPreparedSnapshot!=='function'||typeof rt.replaceAgentPrepared!=='function'||typeof rt.restoreAgentPrepared!=='function'||typeof rt.isAgentPreparedReplacementCurrent!=='function'||typeof selectionStillCurrent!=='function')
        fail('当前绘图版本缺少安全审核接口，未提交优化。');
      if(!selectionStillCurrent())fail('模型选择已变化，未提交优化。');
      const beforeBinding=imageBinding(rt),preparedSnapshot=rt.captureAgentPreparedSnapshot();
      const roleMap=scopedVision?(Array.isArray(referenceRoles)?referenceRoles.map(entry=>({index:entry?.index,identity:entry?.identity,id:entry?.id,role:entry?.role})):null):null;
      if(scopedVision&&!scopedUploads&&(!roleMap||roleMap.length!==lastReference+1))fail('请先确认每张参考图的用途');
      const images=[];let uploadTransaction=null,uploadCommitted=false;
      if(scopedUploads){
        if(!Array.isArray(uploadReferences)||uploadReferences.length<1||uploadReferences.length>3||!roleMap||roleMap.length!==uploadReferences.length)fail('请先确认一至三张上传图片及用途，未提交或扣费。');
        const seen=new Set();
        for(const [i,item] of uploadReferences.entries()){
          const choice=roleMap[i];
          if(!item||typeof item.id!=='string'||!item.id||seen.has(item.id)||!choice||choice.index!==i+1||choice.id!==item.id||typeof choice.role!=='string'||!/^image\/(png|jpeg|webp)$/.test(item.mimeType||'')||typeof item.previewUrl!=='string'||!Number.isFinite(item.size)||item.size<1)fail('上传图片或用途无法核验，未提交或扣费。');
          seen.add(item.id);const dataUrl=await referenceDataUrl({dataUrl:item.previewUrl});
          if(signal?.aborted||!selectionStillCurrent()||!sessionStillCurrent()||!attachmentStillCurrent()||imageBinding(rt)!==beforeBinding)fail('上传图片或绘图状态已变化，未提交或扣费。');
          if(!dataUrl.startsWith('data:'+item.mimeType+';base64,'))fail('上传图片格式不一致，未提交或扣费。');
          images.push({role:choice.role,dataUrl,name:item.name});
        }
        const decodeImage=dataUrl=>new Promise((resolve,reject)=>{const img=new root.Image();img.onload=()=>resolve({width:img.naturalWidth||img.width,height:img.naturalHeight||img.height});img.onerror=()=>reject(new Error('图片解码失败，未提交或扣费。'));img.src=dataUrl;});
        uploadTransaction=await prepareUploadReferenceTransaction({runtime:rt,uploads:images,decodeImage,replaceExisting:lastReference>=0&&replacePageReferencesConfirmed===true,isProjectCurrent:()=>selectionStillCurrent()&&sessionStillCurrent()&&(uploadCommitted||attachmentStillCurrent())});
      } else for(const [refIndex,ref] of referenceSlots.slice(0,lastReference+1).entries()){
        const drawingRole=ref.drawingRole??null,genericRole=ref.role??null;
        const normalizeRole=value=>value==='auto'?'reference':value;
        if(drawingRole!==null&&genericRole!==null&&normalizeRole(drawingRole)!==normalizeRole(genericRole))
          fail('参考图角色信息冲突，请重新选择用途；未提交优化。');
        let role=localPair&&!localImageEdit?inferredLocalRoles.get(refIndex+1):normalizeRole(drawingRole??genericRole??'auto');
        if(localImageEdit&&localPair&&(!drawingRole||drawingRole==='auto')&&(!genericRole||genericRole==='auto'))role=inferredLocalRoles.get(refIndex+1);
        if(scopedVision){
          const choice=roleMap[refIndex],prior=drawingRole??genericRole??'auto';
          if(!choice||choice.index!==refIndex+1||choice.identity!==imageIdentity(ref)||typeof choice.role!=='string'||
            (prior!=='auto'&&prior!==''&&prior!==choice.role))fail('参考图或用途已变化，请重新确认');
          role=choice.role;
        }
        if(role==='none')fail('参考图设置为不使用，请移除该参考或更改用途后重试；未提交优化。');
        if(!['subject','style','pose','background','material','color','composition','lighting','object','result','output','attachment','reference'].includes(role))
          fail('参考图角色不受支持，未提交优化。');
        const dataUrl=await referenceDataUrl(ref);
        if(signal?.aborted||!selectionStillCurrent()||!sessionStillCurrent()||imageBinding(rt)!==beforeBinding)fail('绘图内容或模型选择已变化，未提交优化。');
        images.push({role,dataUrl});
      }
      if(scopedVision){
        const subjects=images.filter(image=>image.role==='subject').length,styles=images.filter(image=>image.role==='style').length;
        // 风格参考可以有多张，一起作为画风来源；有风格参考时仍要一张明确的主体。
        if(styles>0&&subjects!==1)fail('有风格参考时请明确指定一张主体图，未提交或扣费。');
        if(op.generationMode==='img2img'&&subjects!==1)fail('请明确指定一张主体图，未提交或扣费。');
      }
      onStatus('正在按所选模型优化提示词。');
      if(localPair&&!localImageEdit){
        if(rt.state.nsfw===true||!['auto','style',undefined,''].includes(rt.state.drawingTask))fail('当前双图分析只支持普通主体与风格参考，未提交。');
        const direction=root.NovaFlowArtDirection;
        if(typeof direction?.prepare!=='function')fail('双图专业分析框架尚未就绪，未提交。');
        const shadow={...rt.state,prompt:op.prompt,drawingAnalysisEngine:'local'};
        const references=images.map((item,index)=>({...referenceSlots[index],dataUrl:item.dataUrl,drawingRole:item.role}));
        const isStillCurrent=()=>!signal?.aborted&&selectionStillCurrent()&&sessionStillCurrent()&&imageBinding(rt)===beforeBinding;
        const ctx={state:shadow,references,referenceLimit:3,assistantSelection:selected,assistantRequirements:String(requirements||''),signal,isStillCurrent,onProgress:onStatus};
        ctx.getCurrentContext=()=>ctx;
        const preparedAgent=await direction.prepare(ctx);
        if(!isStillCurrent())fail('绘图内容或模型选择已变化，未写入。');
        const native=preparedAgent?.nativeExecution;
        if(native?.analysisBackend!=='qwen-cpu'||native?.modelIdentity?.id!=='qwen35-heretic'||native.resourcesReleased!==true||native.generationReady!==true||preparedAgent.references?.length!==2||preparedAgent.referencePolicy?.stylePriority!==true)
          fail('双图模型身份或专业参考规则未确认，未写入。');
        const modelPrompt=preparedAgent.promptSnapshot.prompt,negativePrompt=preparedAgent.promptSnapshot.negativePrompt;
        const prompt=String(modelPrompt||'').replace(/<image(\d+)>/g,(tag,n)=>`@参考图${preparedAgent.references[Number(n)-1]?.sourceNumber||n}`);
        if(!prompt.trim()||typeof negativePrompt!=='string'||typeof root.crypto?.randomUUID!=='function')fail('双图审核草稿不完整，未写入。');
        const reviewId=root.crypto.randomUUID(),optimization={schema:'nf.agent.prompt-optimization.v1',framework:'native-style-pair',analysisProvider:'local',analysisBackend:'qwen-cpu',modelIdentity:native.modelIdentity,reviewRequired:true,modelPromptLanguage:'en'};
        pendingImageReview={reviewId,rt,beforeBinding,preparedSnapshot,prompt,modelPrompt,negativePrompt,preparedAgent,op:copy(op),count,selectionStillCurrent,sessionStillCurrent};
        return {action:op.action,phase:'review',provider:rt.state.provider,prompt,modelPrompt,negativePrompt,optimization,reviewId};
      }
      const optimized=await root.__NovaFlowSmartAI.optimizeForAgent({assistantSelectionScope:'xiaotao',surface:'art',prompt:op.prompt,plannerBrief:op.plannerBrief===true,
        negativePrompt:rt.state.negativePrompt||'',requirements,generationMode:op.generationMode,
        engine:gptDrawing?'gpt-image-2.5':rt.state.localQwen21Variant==='turbo'?'qwen-2.1-turbo':'qwen-2.1',supportsNegativePrompt:!gptDrawing,signal,onProgress:onStatus,...onlineBusiness,images,
        selectionStillCurrent,isImageInputCurrent:()=>imageBinding(rt)===beforeBinding&&(!scopedUploads||attachmentStillCurrent()),...(scopedText?{currentDrawingTextOnly:true}:{}),...(scopedVision?{currentDrawingVisionOnly:true}:{})});
      if(signal?.aborted||!selectionStillCurrent()||!sessionStillCurrent()||(scopedUploads&&!attachmentStillCurrent())||imageBinding(rt)!==beforeBinding)fail('绘图内容或模型选择已变化，未写入。');
      const prompt=optimized.displayPrompt||optimized.prompt,modelPrompt=optimized.prompt,negativePrompt=optimized.negativePrompt;
      const localPolicy=optimized.optimization?.modelPromptPolicy;
      const validLocalPolicy=localPolicy==='qwen21-task-policy-v1'||((op.generationMode==='txt2img'||localImageEdit)&&localPolicy==='qwen21-native-rewrite-v3');
      if(selectedLocalArt&&(optimized.analysisBackend!=='qwen-cpu'||optimized.optimization?.modelIdentity?.id!=='qwen35-heretic'||!validLocalPolicy))fail('本地优化模型或专业规则未确认，未写入。');
      if(selectedLocalArt&&(typeof prompt!=='string'||!prompt.trim()||typeof modelPrompt!=='string'||!modelPrompt.trim()))fail('审核草稿不完整，未写入。');
      const optimization=selectedLocalArt?{...optimized.optimization,reviewRequired:true,modelPromptLanguage:localImageEdit?optimized.optimization.modelPromptLanguage:'en'}:optimized.optimization;
      if(optimization?.reviewRequired!==true||typeof prompt!=='string'||typeof modelPrompt!=='string'||typeof negativePrompt!=='string'||typeof root.crypto?.randomUUID!=='function')
        fail('审核草稿不完整，未写入。');
      let generationBinding=null;
      const proof=optimized.compilerBinding;
      if(gptDrawing&&op.generationMode==='img2img'&&count===1&&proof&&typeof proof.proof==='string'&&proof.proof&&
         proof.modelPrompt===modelPrompt&&proof.modelId===selected.modelId&&proof.epoch===selected.epoch&&
         Array.isArray(proof.images)&&proof.images.length===images.length&&[1,2].includes(images.length)&&
         proof.images.every((item,index)=>item.role===images[index].role&&item.dataUrl===images[index].dataUrl)&&
         images[0].role==='subject'&&(images.length===1||images[1].role==='style')&&root.crypto?.subtle?.digest){
        const hash=await root.crypto.subtle.digest('SHA-256',new TextEncoder().encode(beforeBinding));
        if(signal?.aborted||!selectionStillCurrent()||!sessionStillCurrent()||(scopedUploads&&!attachmentStillCurrent())||imageBinding(rt)!==beforeBinding)fail('绘图数据、账号或模型已变化，未应用草稿。');
        const pageHash=Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('');
        generationBinding=Object.freeze({compilerBinding:proof,confirmationPageHash:pageHash,confirmedBoundGeneration:true});
      }
      const generationAvailable=!!generationBinding&&root.electronAPI?.confirmedArtImageAvailableSync?.()===true;
      const reviewId=root.crypto.randomUUID();
      pendingImageReview={generationBinding,reviewId,rt,beforeBinding,preparedSnapshot,prompt,modelPrompt,negativePrompt,referenceRoles:(gptDrawing||scopedVision||localImageEdit)?images.map(image=>image.role):null,op:copy(op),count,selectionStillCurrent,sessionStillCurrent,...(scopedUploads?{uploadTransaction,attachmentStillCurrent,markUploadCommitted:()=>{uploadCommitted=true}}:{})};
      return {action:op.action,phase:'review',provider:rt.state.provider,prompt,modelPrompt,negativePrompt,optimization,reviewId,generationAvailable};
    }
    // The legacy online optimizer can finish after the model or account changes.
    fail('绘图优化入口不可用，未提交或扣费。');
  }
  function activity(){
    if([...root.document.querySelectorAll('[data-novaflow-export-blocking]')].some(visible))return '原生导出';
    if(root.__NovaFlowFxMakerOpen?.state?.busy)return '特效模板制作';
    if(effects()?.busy)return 'AI特效生成';
    if(productionTools().some(t=>t.busy))return '实用工具处理';
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
  const downloads=new Map();let downloadSequence=0;
  function downloadFile(id){return downloads.get(id)||null;}
  async function downloadFiles(files,baseName){
    if(!files?.length||files.length>65535)fail('没有可下载的实际文件，或文件数超出 ZIP 范围');
    const usedNames=new Set(),entries=[];
    for(const item of files){const blob=item.blob||await(await root.fetch(item.url)).blob();if(!blob?.size)fail('导出结果为空');const original=String(item.name).replace(/\\/g,'/').split('/').filter(part=>part&&part!=='.'&&part!=='..'&&!/^[a-z]:$/i.test(part)).join('/');if(!original)fail('导出文件名为空');let name=original,index=2;while(usedNames.has(name)){const dot=original.lastIndexOf('.'),hasExt=dot>original.lastIndexOf('/')+1;name=(hasExt?original.slice(0,dot):original)+' ('+(index++)+')'+(hasExt?original.slice(dot):'');}usedNames.add(name);entries.push({name,blob});}
    let name=entries[0].name,blob=entries[0].blob;
    if(entries.length>1){
      const locals=[],central=[];let offset=0;
      for(const item of entries){const bytes=new Uint8Array(await item.blob.arrayBuffer()),label=new TextEncoder().encode(item.name);let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}crc=(crc^0xffffffff)>>>0;
        const header=new Uint8Array(30+label.length),view=new DataView(header.buffer);view.setUint32(0,0x04034b50,true);view.setUint16(4,20,true);view.setUint16(6,0x800,true);view.setUint32(14,crc,true);view.setUint32(18,bytes.length,true);view.setUint32(22,bytes.length,true);view.setUint16(26,label.length,true);header.set(label,30);locals.push(header,bytes);
        const entry=new Uint8Array(46+label.length),ev=new DataView(entry.buffer);ev.setUint32(0,0x02014b50,true);ev.setUint16(4,20,true);ev.setUint16(6,20,true);ev.setUint16(8,0x800,true);ev.setUint32(16,crc,true);ev.setUint32(20,bytes.length,true);ev.setUint32(24,bytes.length,true);ev.setUint16(28,label.length,true);ev.setUint32(42,offset,true);entry.set(label,46);central.push(entry);offset+=header.length+bytes.length;
      }
      const end=new Uint8Array(22),v=new DataView(end.buffer);v.setUint32(0,0x06054b50,true);v.setUint16(8,entries.length,true);v.setUint16(10,entries.length,true);v.setUint32(12,central.reduce((n,e)=>n+e.length,0),true);v.setUint32(16,offset,true);blob=new root.Blob([...locals,...central,end],{type:'application/zip'});name=baseName+'.zip';
    }
    const url=root.URL.createObjectURL(blob),downloadId='download-'+(++downloadSequence),a=root.document.createElement('a');a.href=url;a.download=name;
    // Keep a real file link in the reply when an asynchronous browser download
    // is blocked or the user needs to download it again. Bound session memory.
    downloads.set(downloadId,{url,name,bytes:blob.size});
    let retained=0;for(const item of downloads.values())retained+=item.bytes;
    while(downloads.size>1&&(downloads.size>5||retained>256*1024*1024)){const [id,item]=downloads.entries().next().value;downloads.delete(id);retained-=item.bytes;root.URL.revokeObjectURL(item.url);}
    a.click();
    return {name,bytes:blob.size,count:entries.length,downloadId,downloadInitiated:true};
  }
  function setControl(el,value){
    if(el.matches?.('[data-novaflow-export-name-input="1"]')&&root.NovaFlowAgentExportSession?.purpose==='particle-export'){if(root.NovaFlowExportDialogAgent?.setName(el,value)!==true)fail('原生粒子导出名称未写入');return;}
    if(el.type==='radio'){if(!value&&el.checked)fail('单选参数请改选另一项');if(value&&!el.checked)click(el);return;}
    if(el.type==='checkbox'||el.getAttribute('role')==='checkbox'){const current=el.type==='checkbox'?el.checked:el.getAttribute('aria-checked')==='true'||el.getAttribute('aria-pressed')==='true';if(current!==!!value)click(el);return;}
    const proto=el.tagName==='TEXTAREA'?root.HTMLTextAreaElement.prototype:el.tagName==='SELECT'?root.HTMLSelectElement.prototype:root.HTMLInputElement.prototype;
    const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;if(!setter)fail('控件不支持写入');setter.call(el,String(value));
    el.dispatchEvent(new root.Event('input',{bubbles:true}));el.dispatchEvent(new root.Event('change',{bubbles:true}));
    el.dispatchEvent(new root.Event('focusout',{bubbles:true}));
  }
  async function execute(op,{snapshot,fingerprint,signal,requirements='',optimizerRequirements=requirements,onStatus=()=>{},provider='local',modelId,selectionStillCurrent,onlineBusiness,currentDrawingTextOnly,currentDrawingVisionOnly,referenceSource,projectStillCurrent,referenceRoles,uploadReferences,attachmentStillCurrent,replacePageReferencesConfirmed}={}){
    if(currentDrawingTextOnly===true&&op?.action!=='image_optimize')
      fail('该入口只支持当前绘图的纯文字提示词优化，未提交或扣费。');
    if(signal?.aborted)fail('Foart 操作已停止');
    if(op.action==='open')return open(op.surface,{signal});
    if(op.action==='ui_layout'){
      if(!uiLayout())fail('请先打开UI设计');
      const result=await root.NovaFlowUiDesignBridge.applyAgentLayout({width:op.width,height:op.height,blocks:copy(op.blocks)});
      const refs=root.__NovaFlowArtGenerate?.references?.()||[];if(!refs.some(ref=>ref?.uiLayoutId===result?.id&&ref.dataUrl))fail('原生布局参考未生成，尚不能制作UI');
      return {action:op.action,phase:'applied',uiLayout:uiLayout(),message:'已创建并启用原生布局参考，共 '+result.data.blocks.length+' 个模块；尚未生成最终UI图片'};
    }
    if(op.action==='particle'){
      if(!particle())fail('请先打开粒子特效');if(!/导出|下载|保存/.test(requirements))fail('本次未要求导出粒子');
      if(op.operation==='export_config'){const value=root.NovaFlowParticleAgent[op.all?'exportAllConfigs':'exportConfig'](),output=await downloadFiles([{name:'Foart-粒子配置.json',blob:new root.Blob([value],{type:'application/json'})}],'Foart-粒子配置');return {action:op.action,phase:'completed',outputs:[output],message:'已发起粒子配置下载：'+output.name};}
      const session={files:new Map(),purpose:'particle-export'};root.NovaFlowAgentExportSession=session;let retainSession=false;
      try{
      if(![...root.document.querySelectorAll('[data-novaflow-export-modal-root="1"]')].some(visible)){const button=root.document.querySelector('[data-novaflow-primary-export-entry="1"]');if(!button)fail('原生导出入口尚未就绪');click(button);await sleep(120);}
      if(![...root.document.querySelectorAll('[data-novaflow-export-modal-root="1"]')].some(visible))fail('原生导出对话框未打开，请检查当前账号导出权限');
      if(op.operation==='open_export'){retainSession=true;return {action:op.action,phase:'opened',message:'已打开原生粒子导出参数，尚未导出文件'};}
      const agent=root.NovaFlowParticleExportAgent;if(!agent)fail('粒子原生导出接口尚未就绪');
      const settings=Object.fromEntries(['fps','seconds','width','height','scale','transparent','format'].filter(key=>op[key]!==undefined).map(key=>[key,op[key]]));
      if(op.operation==='export_video'&&op.transparent===true&&!settings.format)settings.format='webm';
      agent.configure(settings);let actual;
      for(let i=0;i<100;i++){if(signal?.aborted)fail('粒子导出已停止');await sleep(50);actual=root.NovaFlowParticleExportAgent.snapshot();if(Object.entries(settings).every(([key,value])=>actual[key]===value))break;}
      if(!Object.entries(settings).every(([key,value])=>actual[key]===value))fail('粒子导出参数尚未写入原生设置，未开始编码');
      if(op.fileName){const input=root.document.querySelector('[data-novaflow-export-name-input="1"]');if(!input)fail('原生导出名称输入框尚未就绪');setControl(input,op.fileName);await sleep(80);if(input.value!==op.fileName)fail('原生导出名称未生效，未开始编码');}
        onStatus('正在使用原生粒子渲染器编码导出…');await root.NovaFlowParticleExportAgent[op.operation==='export_sequence'?'sequence':'video']();await waitNativeIdle(signal,onStatus);
        if(signal?.aborted)fail('已停止等待粒子导出');
        const files=[...session.files].map(([name,blob])=>({name,blob}));if(!files.length)fail('原生粒子导出没有返回实际文件');
        const pngs=files.filter(file=>/\.png$/i.test(file.name)),metadata={fps:actual.fps,frames:pngs.length};
        if(pngs.length){const bytes=await pngs[0].blob.slice(0,24).arrayBuffer(),view=new DataView(bytes);if(view.byteLength<24||view.getUint32(0)!==0x89504e47)fail('原生导出返回的PNG文件头无效');metadata.width=view.getUint32(16);metadata.height=view.getUint32(20);metadata.seconds=pngs.length/actual.fps;}
        const output=await downloadFiles(files,op.fileName||'Foart-粒子'+(op.operation==='export_sequence'?'序列帧':'视频'));root.NovaFlowParticleExportAgent.close();
        return {action:'particle',operation:op.operation,phase:'completed',outputs:[output],exportSettings:actual,...metadata,message:'原生粒子导出已返回 '+files.length+' 个文件，已发起下载：'+output.name+'（'+output.bytes+' 字节）'};
      }finally{if(!retainSession&&root.NovaFlowAgentExportSession===session)root.NovaFlowAgentExportSession=null;}
    }
    if(op.action==='tool'){
      let tool=root.NovaFlowProductionTools?.[op.name],before=tool?.snapshot();if(!before?.active||before.busy)fail('请先打开对应工具并等待就绪');
      let inputIds=op.inputIds||(op.name!=='spine_atlas'&&before.selectedId&&/同一张|这张|刚才|上一步|上次|实际结果|这一个|这个结果/.test(requirements)&&!/全部|批量|所有/.test(requirements)?[before.selectedId]:undefined);
      const latestRequirements=requirements.split('本次最新要求优先，替换与它冲突的旧描述：').at(-1);
      const continueOutput=op.operation==='run'&&lastToolOutput&&/(?:刚才|上次|上一|实际结果|压缩结果)/.test(latestRequirements)&&/(?:结果|输出)/.test(latestRequirements)&&!/全部|批量|所有/.test(latestRequirements);
      if(continueOutput){
        const expected=lastToolOutput.id;
        let bound=before.items.find(item=>item.sourceMaterialId===expected);
        if(!bound){
          const file=await materialFile(expected);file.__nfFoartMaterialId=expected;
          const previousIds=new Set(before.items.map(item=>item.id));
          onStatus('正在把上一份实际输出交给'+op.name+'原生输入…');
          if(typeof tool.addFiles==='function')await tool.addFiles([file]);
          else{
            const accepts=control=>!control.accept||control.accept.split(',').some(token=>{token=token.trim().toLowerCase();return token==='*/*'||token===file.type.toLowerCase()||token.endsWith('/*')&&file.type.toLowerCase().startsWith(token.slice(0,-1))||token.startsWith('.')&&file.name.toLowerCase().endsWith(token);});
            const inputs=catalog().filter(control=>control.kind==='file'&&!control.disabled&&accepts(control));
            if(inputs.length!==1)fail('上一份输出的原生输入位置不唯一，未处理旧素材');
            await execute({action:'assign_upload',controlId:inputs[0].id,uploadId:expected},{signal,requirements,onStatus,provider});
          }
          for(let attempt=0;attempt<30;attempt++){
            await sleep(50);tool=root.NovaFlowProductionTools[op.name];before=tool.snapshot();
            bound=before.items.find(item=>item.sourceMaterialId===expected)||before.items.find(item=>!previousIds.has(item.id)&&item.name===file.name&&item.inputBytes===file.size);
            if(bound)break;
          }
        }
        if(!bound)fail('上一份实际输出尚未进入当前工具，未处理旧素材');
        inputIds=[bound.id];
      }
      if(inputIds?.some(id=>!before.items.some(item=>item.id===id)))fail('要处理的工具素材已不存在');
      if(op.operation==='export'&&!/导出|下载|保存/.test(requirements))fail('本次未要求导出文件');
      if(op.operation==='run'&&!before.items?.length)fail('请先提供该工具需要的素材');
      if(op.operation==='export'){const files=(await tool.files()).filter(file=>!inputIds||inputIds.includes(file.id)),result=await downloadFiles(files,op.name);return {action:'tool',name:op.name,operation:'export',phase:'completed',outputs:[result],message:'已发起下载：'+result.name+'（'+result.bytes+' 字节）'};}
      onStatus('正在使用原生工具处理…');await tool.run(inputIds);await sleep(60);await waitNativeIdle(signal,onStatus);
      const after=root.NovaFlowProductionTools[op.name].snapshot(),targetItems=after.items?.filter(i=>!inputIds||inputIds.includes(i.id))||[],outputs=targetItems.filter(i=>i.output&&i.status!=='error').map(i=>i.output);
      const failed=targetItems.filter(i=>!i.output||i.status==='error');
      if(op.operation==='run'&&(!outputs.length||failed.length))fail(failed.map(i=>i.name+'：'+(i.message||i.status)).join('；')||'原生工具未返回实际输出');
      if(outputs.length===1){
        const actual=(await root.NovaFlowProductionTools[op.name].files?.()||[]).find(file=>file.id===outputs[0].id);
        if(actual&&(actual.blob||actual.url)){
          const id='tool-result-'+root.crypto.randomUUID(),kind=/\.(png|jpe?g|webp)$/i.test(actual.name)?'image':/\.(mp4|webm|mov)$/i.test(actual.name)?'video':'tool';
          materials.set(id,{...actual,id,kind});for(const key of [...materials.keys()].filter(key=>key.startsWith('tool-result-')).slice(0,-8))materials.delete(key);lastToolOutput={id,tool:op.name,name:actual.name,bytes:outputs[0].bytes};outputs[0]={...outputs[0],uploadId:id};
        }
      }
      const inputs=before.items.filter(item=>!inputIds||inputIds.includes(item.id)).map(item=>({id:item.id,name:item.name,bytes:item.inputBytes,sourceMaterialId:item.sourceMaterialId}));
      return {action:'tool',name:op.name,operation:op.operation,phase:op.operation==='run'?'completed':'returned',inputs,outputs,atlases:after.atlases,message:op.operation==='run'?'原生工具已返回实际结果':'已调用原生导出，请以工具保存状态为准'};
    }
    if(op.action==='effect_generate'){
      const tool=root.NovaFlowAifxMvp,before=effects();if(!before?.source||before.busy)fail('特效素材尚未就绪');
      const abort=()=>tool.cancel?.();signal?.addEventListener('abort',abort,{once:true});
      try{onStatus('正在按原有特效材质、形状和运动规则编译并生成…');const selected=root.NovaFlowXiaotaoArtAgent?.panel?.controller?.businessModelSnapshot?.();await tool.runProductionPipeline({model:selected?.provider==='api'?selected.modelId:''});if(signal?.aborted)fail('已停止特效生成');const after=effects(),ids=new Set(before.candidates.map(c=>c.id)),outputs=after.candidates.filter(c=>!ids.has(c.id)&&c.frames>0);if(!outputs.length)fail('AI特效没有返回新结果');return {action:op.action,phase:'completed',outputs,selected:after.selected,displayedSource:after.displayedSource,attributeLabel:after.attributeLabel,strength:after.strength,message:'已用'+(after.attributeLabel||'当前材质')+'生成 '+outputs.length+' 个新特效候选（'+outputs.map(o=>o.frames+' 帧').join('、')+'）'+(after.displayedSource==='result'?'，结果已显示在画板。':'。'),optimization:{framework:'native-aifx-material-shape-lifecycle'}};}finally{signal?.removeEventListener('abort',abort);}
    }
    if(op.action==='effect_export'){
      if(!/导出|下载|保存/.test(requirements))fail('本次未要求导出特效');
      const before=effects();if(!before||before.busy)fail('特效尚未准备好导出');
      const candidateId=before.displayedSource==='result'?before.candidates[before.selected]?.id:null;
      if(/(?:当前|选中|生成).{0,8}(?:候选|结果)|不(?:要)?导出源/.test(requirements)&&before.displayedSource!=='result')fail('当前预览是原素材，尚未选中要导出的生成候选');
      const files=await root.NovaFlowAifxMvp.agentFiles(op.format),after=effects();
      if(after?.displayedSource!==before.displayedSource||candidateId&&after.candidates[after.selected]?.id!==candidateId)fail('导出期间所选特效已变化，未下载旧候选');
      const result=await downloadFiles(files,'Foart-特效序列帧');
      return {action:op.action,phase:'completed',format:op.format,exportSource:before.displayedSource,candidateId,outputs:[result],message:'已将'+(candidateId?'当前生成候选':'原素材')+'导出为'+(op.format==='seq'?result.count+' 张透明 PNG 序列帧':'视频')+'，已发起下载：'+result.name+'（'+result.bytes+' 字节）'};
    }
    if(op.action==='ui_select'){const selected=root.NovaFlowUiDesignDrawing?.selectAgentBlock(op.blockId);if(!selected)fail('UI修改区域未选中');return {action:op.action,phase:'applied',blockId:selected.blockId,name:selected.block.name,message:'已选中UI模块：'+selected.block.name};}
    if(op.action==='animation'){const api=root.NovaFlowSkeletonEditor?.active?.()&&root.NovaFlowSkeletonEditor.api();if(!api?.agentAction)fail('动画编辑器尚未就绪');if(op.operation==='inspect_project'){
      if(typeof api.agentInspectProject!=='function')fail('当前动画编辑器不支持只读工程检查');
      const inspection=api.agentInspectProject();return {action:'animation',operation:op.operation,phase:'observed',inspection,message:'已读取当前动画工程状态'};
    }if(op.operation==='inspect_bones'){
      if(typeof api.agentInspectBones!=='function')fail('当前动画编辑器不支持只读关键帧检查');
      const inspection=api.agentInspectBones(op);
      return {action:'animation',operation:op.operation,phase:'observed',inspection,message:inspection.complete?'已读取当前动画的目标骨骼关键帧':'关键帧信息不完整，不能据此执行相对修改'};
    }if(['export_project','export_media'].includes(op.operation)){
      const positive=root.NovaFlowXiaotaoUpload?.positiveTaskText?.(requirements)??requirements.replace(/(?:不要|不用|无需|不需要|不导出)[^，。；,;\n]*/g,'');
      if(!/导出|下载|export/i.test(positive))fail('本次未要求导出动画');
      const files=[],write=async(name,bytes)=>{files.push({name,blob:new root.Blob([bytes],{type:/\.png$/i.test(name)?'image/png':'application/octet-stream'})})};
      onStatus('正在使用原生动画导出器编码实际文件…');
      const result=op.operation==='export_project'?await api.exportSelectedProjects({version:op.version||api.agentContext().exportVersion,skel:op.format==='skel',packed:op.packed!==false,write}):await api.exportMedia({kind:op.kind==='sequence'?'frames':'video',format:op.format||'mp4',mode:op.mode||'independent',name:op.name,transparent:op.transparent??(op.kind==='sequence'),encoder:root.electronAPI,write});
      if(signal?.aborted)fail('已停止等待动画导出');if(result?.canceled||!files.length)fail('原生动画导出未返回文件');
      const output=await downloadFiles(files,op.name||'Foart-动画'+(op.operation==='export_project'?'工程':op.kind==='sequence'?'序列帧':'视频'));
      return {action:'animation',operation:op.operation,phase:'completed',projects:result.projects?.map(p=>({name:p.name,images:p.images,missing:p.missing})),outputs:[output],message:'原生动画导出已返回 '+files.length+' 个实际文件，已发起下载：'+output.name+'（'+output.bytes+' 字节）'};
    }if(op.operation==='new_project'){if(!/新建|新工程|创建.{0,6}工程|new project/i.test(requirements))fail('本次未要求新建动画工程');const result=await api.newProject(op.name,{operation:'append'});if(!result||!api.loaded())fail('原生动画工程未建立');return {action:op.action,phase:'completed',operation:op.operation,context:api.agentContext(),message:'已新增独立动画工程：'+result.name};}if(op.operation==='auto_rig'){if(!/自动(?:架设|骨骼|绑定|搭建)|auto.?rig/i.test(requirements))fail('未要求自动架设，未替换当前骨架');if(typeof api.autoRig!=='function')fail('原生自动架设尚未就绪');onStatus('正在运行原生自动架设…');const result=await api.autoRig(onStatus);if(!result||!(result.bones>0))fail('原生自动架设没有返回骨架结果');return {action:'animation',operation:'auto_rig',phase:'applied',...result,context:api.agentContext(),message:'原生自动架设已完成：'+result.bones+' 根骨骼、'+result.ik+' 个IK约束、'+result.layers+' 个图层'};}const result=await api.agentAction(op);return {action:op.action,...result,message:result.slot?(op.operation==='create_slot'?'已新建':op.operation==='update_slot'?'已修改':'已选中')+'原生插槽：'+result.slot.name+'，父骨骼 '+result.slot.bone:result.skin?(op.operation==='create_skin'?'已新建':'已选中')+'原生皮肤：'+result.skin.name:result.constraint?(op.operation==='create_constraint'?'已建立':op.operation==='update_constraint'?'已修改':'已选中')+'原生'+({ik:'IK',transform:'变换',path:'路径'}[op.constraintKind]||'')+'约束“'+result.constraint.name+'”：'+result.constraint.bones.join(' → ')+'，目标 '+result.constraint.target+(op.constraintKind==='ik'?'，混合 '+(result.constraint.mix??1):''):result.attachment?(op.operation==='auto_mesh'?'已运行原生自动蒙皮：':op.operation==='auto_weights'?'已运行原生自动权重：':'已打开原生附件：')+result.attachment.name+'（'+result.attachment.vertexCount+' 个顶点）':op.operation==='key_bones'?'已向原生动画写入 '+result.keyCount+' 组骨骼关键帧':op.operation==='seek'?'已定位到第 '+op.frame+' 帧':op.operation==='select_bone'?'已选中骨骼：'+op.boneName:op.operation==='create_bone'?'已新建骨骼：'+op.name:op.operation==='update_bone'?(result.changed===false?'骨骼参数已符合要求，未重复修改：':'已修改骨骼：')+op.boneName:op.operation==='create_animation'?'已新建动画：'+op.name:op.operation==='select_animation'?'已切换动画：'+op.name:({play:'已播放动画',pause:'已暂停动画',undo:'已撤销上一步动画修改',redo:'已重做动画修改'}[op.operation]||'已更新原生动画')};}
    if(op.action==='use_result')return useResult();
    if(op.action==='pose_select'){const selected=root.NovaFlowPoseReferenceTool?.agentSelectBone?.(op.boneName);if(!selected)fail('请先打开姿势参考工具');return {action:op.action,phase:'applied',...selected,message:'已选中姿势关节：'+selected.label};}
    if(op.action==='frame_open')return frameOpen(op.resourceId,{signal,onStatus});
    if(op.action==='frame_select'){const tool=root.NovaFlowVideoFrameEditTool;if(!tool?.agentSelectRange)fail('帧编辑选择工具尚未加载');return {action:op.action,phase:'applied',...tool.agentSelectRange(op.startFrame,op.endFrame),message:'已选中第'+(op.startFrame+1)+'至'+(op.endFrame+1)+'帧'};}
    if(op.action.startsWith('image_'))return image(op,{signal,requirements:optimizerRequirements,onStatus,provider,modelId,onlineBusiness,selectionStillCurrent,currentDrawingTextOnly,currentDrawingVisionOnly,referenceSource,projectStillCurrent,referenceRoles,uploadReferences,attachmentStillCurrent,replacePageReferencesConfirmed});
    if(op.action==='media'){
      await open(op.operation.target);
      const media=root.NovaFlowMediaAgent,context=media.capture();
      const result=await media.execute({planId:root.crypto.randomUUID(),contextFingerprint:await fingerprint(context),operations:[op.operation]},{snapshot:context,fingerprint,signal,requirements:optimizerRequirements,analysisProvider:provider,assistantSelectionScope:'xiaotao',selectionStillCurrent,onOptimizationStatus:onStatus});
      return {action:'media',phase:'completed',results:result.results};
    }
    if(op.action==='art_transfer_place'){const bridge=root.NovaFlowSpineSplitBridge;if(typeof bridge?.agentPlaceTransfer!=='function')fail('万物迁移位置接口尚未就绪');const result=bridge.agentPlaceTransfer({x:op.x,y:op.y,scale:op.scale});return {action:op.action,...result,message:'已按原生规则放置参考物：X '+result.placement.x+'，Y '+result.placement.y+'，缩放 '+result.placement.scale};}
    if(op.action==='art_layer'){
      if(op.operation==='select'){
        const bridge=root.NovaFlowSpineSplitBridge;if(typeof bridge?.agentSelectLayers!=='function')fail('图层选择入口尚未更新');
        const actual=await bridge.agentSelectLayers(op.layerIds);return {action:op.action,operation:op.operation,...actual,message:'已选中图层：'+actual.selectedLayerNames.join('、')};
      }
      const bridge=root.NovaFlowSpineSplitBridge;if(typeof bridge?.agentLayerAction!=='function')fail('图层操作入口尚未更新');
      const actual=await bridge.agentLayerAction(op);
      return {action:op.action,...actual,message:op.operation==='rename'?'已将实际图层命名为“'+actual.name+'”':(actual.visible?'已显示图层“':'已隐藏图层“')+actual.name+'”'};
    }
    if(op.action==='art_action'){
      if(nativePending&&nativePending.state==='running')fail('上一个美工工具尚未完成');
      if(op.name==='export'&&!/导出|下载|PSD|保存.{0,8}文件/i.test(requirements))fail('本次仅要求保留资源，未额外导出文件');
      const latestRequirements=requirements.split('本次最新要求优先，替换与它冲突的旧描述：').at(-1);
      const formatRequest=latestRequirements.replace(/(?:不要|不用|无需|别)(?:导出|保存)?(?:为|成)?\s*(?:PNG|PSD|JSON)\b/gi,'');
      const requestedFormats=[...new Set((formatRequest.match(/\b(?:PNG|PSD|JSON)\b/gi)||[]).map(v=>v.toLowerCase()))];
      const requestedFormat=op.name==='export'&&requestedFormats.length===1?requestedFormats[0]:undefined;
      const exportFormat=op.format==='layer'?'layer':requestedFormat||(op.format||'psd');
      await open('drawing');
      const category=['imageUpscale','imageOutpaint','imageAngleAdjust','objectTransfer','poseReference'].includes(op.name)?'enhance':['split','cutout','generativeSplit','penCutout'].includes(op.name)?'split':'edit';
      const panel=root.document.querySelector('[data-novaflow-spine-split-control-category="'+category+'"]');if(panel?.getAttribute('data-open')==='0'){const heading=panel.querySelector('.nf-panel-header');if(heading)click(heading);await sleep(80);}
      const bridge=root.NovaFlowSpineSplitBridge;if(typeof bridge?.agentAction!=='function')fail('美工工具控制入口尚未更新');
      const imageUploads=[...materials.values()].filter(item=>item.id.startsWith('upload-')&&item.kind==='image');
      const referenceOnly=op.name==='objectTransfer'&&bridge.getState?.()?.source?.dataUrl&&/参考物|迁移到当前|放入当前/.test(latestRequirements);
      const sourceUpload=referenceOnly?null:op.uploadId||(!bridge.getState?.()?.source?.dataUrl&&imageUploads.length===1&&!['export','poseReference','merge'].includes(op.name)?imageUploads[0].id:null);
      if(sourceUpload){const file=await materialFile(sourceUpload);const dataUrl=await referenceDataUrl({file,mimeType:file.type});await bridge.importSourceDataUrl(file.name,dataUrl,{silent:true});}
      const toolLabel=op.name==='export'?exportFormat.toUpperCase()+'导出':root.document.querySelector('[data-novaflow-spine-split-control-action="'+op.name+'"]')?.textContent?.trim()||({imageUpscale:'高清放大',imageOutpaint:'无限扩图',imageAngleAdjust:'角度调整',objectTransfer:'万物迁移',poseReference:'姿势参考',canvasResize:'画布调整',split:'一键拆图',cutout:'智能抠图',penCutout:'钢笔抠图',generativeSplit:'对象分离',inpaintCompletion:'智能补图',inpaintEdit:'局部编辑',inpaintRepair:'去除物体',merge:'合并图层',mask:'蒙版'}[op.name]||'美工工具');
      const pending={id:root.crypto.randomUUID(),name:op.name,label:toolLabel,state:'running'};nativePending=pending;
      Promise.resolve().then(()=>bridge.agentAction(op.name,{format:exportFormat,...(op.name==='export'?{deliverFile:file=>downloadFiles([file],'Foart-美工导出')}:{}),...(op.name==='imageOutpaint'&&op.prompt?{outpaintPrompt:op.prompt}:{}),...(['canvasResize','imageOutpaint'].includes(op.name)&&op.width!==undefined?{canvasResize:{width:op.width,height:op.height,anchor:op.anchor||'center'}}:{})})).then(value=>{pending.state='completed';pending.value=value;},error=>{pending.state='failed';pending.error=String(error?.message||error);});
      await sleep(120);return {action:op.action,phase:'started',taskId:pending.id,name:op.name,label:toolLabel,message:'已启动'+toolLabel+'，等待参数或实际结果'};
    }
    const el=elements.get(op.controlId);if(!el||!(visible(el)||op.action==='assign_upload'&&(visible(el.parentElement)||el.closest(PRODUCTION_SCOPE)||el.ownerDocument!==root.document))||el.disabled)fail('控件已变化，请重新读取工具目录');
    if(FORBIDDEN.test(label(el)))fail('该操作不属于美工或音视制作工具');
    if(op.action==='assign_upload'){
      if(el.type!=='file')fail('不是原生素材输入位置');const uploadIds=op.uploadIds||[op.uploadId],files=[];
      const compressionInput=productionTools().find(tool=>['png_compress','jpg_compress'].includes(tool.name));
      if(uploadIds.length>1&&!el.multiple)fail('该原生位置只接收一个文件');
      for(const id of uploadIds){const file=await materialFile(id),inspected=root.NovaFlowXiaotaoUpload?.inspectUpload?.(file);if(inspected?.ok===false)fail(inspected.message);file.__nfFoartMaterialId=id;
        const accept=String(el.accept||'').toLowerCase();if(accept&&accept!=='*/*'&&!accept.split(',').some(t=>{t=t.trim();return t===file.type.toLowerCase()||t.endsWith('/*')&&file.type.toLowerCase().startsWith(t.slice(0,-1))||t.startsWith('.')&&file.name.toLowerCase().endsWith(t);}))fail('素材类型不符合该模式的原有输入规则');files.push(file);}
      // The upload router may already have placed this picture; the planner must not add it twice.
      if(/^novaflow-art-generate-reference-input/.test(el.id||'')&&files.length===1){
        const placed=Array.from(root.__NovaFlowArtGenerate?.references?.()||[]).some(ref=>ref?.name===files[0].name&&(!ref.file?.size||ref.file.size===files[0].size));
        if(placed)return {action:op.action,phase:'applied',control:label(el)||'参考图',uploadId:uploadIds[0],name:files[0].name,files:[{name:files[0].name,uploadId:uploadIds[0]}],message:files[0].name+' 已在参考图中'};
      }
      const nativeKey=el.closest('#novaflow-png-remove-black-root')?'png_remove_black':el.closest('#novaflow-mp4-compress-root')?'mp4_compress':el.closest('#novaflow-video-format-convert-root')?'video_format_convert':el.closest('#novaflow-spine-atlas-webp-root')?'spine_atlas':null;
      const viewerImport=el.ownerDocument!==root.document&&typeof el.ownerDocument.defaultView?.NovaFlowSpineViewer?.importFiles==='function';
      if(nativeKey)await root.NovaFlowProductionTools[nativeKey].addFiles(files);
      else if(viewerImport)await el.ownerDocument.defaultView.NovaFlowSpineViewer.importFiles(files);
      else if(el.matches('[data-template-input]'))await root.NovaFlowAifxMvp.loadSourceFiles(files);
      else if(el.matches('[data-style-input]'))await root.NovaFlowAifxMvp.loadStyleFiles(files);
      else{const transfer=new root.DataTransfer();files.forEach(file=>transfer.items.add(file));el.files=transfer.files;el.dispatchEvent(new root.Event('change',{bubbles:true}));}
      if(compressionInput){
        let ready=false;
        for(let attempt=0;attempt<100;attempt++){
          const actual=root.NovaFlowProductionTools[compressionInput.name]?.snapshot();
          ready=uploadIds.every(id=>actual?.items?.some(item=>item.sourceMaterialId===id));
          if(ready)break;if(signal?.aborted)fail('已停止等待工具素材导入');await sleep(50);
        }
        if(!ready)fail('图片仍未进入原生压缩工具，未在导入完成前执行处理');
      }
      await sleep(100);return {action:op.action,phase:'applied',control:label(el)||el.accept||'原生素材输入',...(files.length===1?{uploadId:uploadIds[0],name:files[0].name}:{}),files:files.map((file,i)=>({name:file.name,uploadId:uploadIds[i]})),message:'已将 '+files.map(f=>f.name).join('、')+' 交给当前原生工具',...(viewerImport?{viewer:root.NovaFlowProductionTools.spine_viewer.snapshot().viewer}:{})};
    }
    if(op.action==='set_control'){
      if((el.matches('[data-novaflow-timeline-time-display]')||el.type==='range'&&el.closest('[data-novaflow-bottom-controls="1"]')&&el.parentElement?.querySelector('[data-novaflow-playback-icon]'))&&!/播放(?:位置|进度|时间)|定位(?:到|至)|跳(?:到|至)|预览.{0,4}(?:到|至)/.test(requirements))fail('这是预览播放时间，不是粒子的生命周期参数；请使用基础属性中的生命周期');
      if(el.closest('[data-novaflow-art-generate-prompt-kind="positive"],[data-novaflow-ai-prompt-kind="positive"]'))fail('请使用原有提示词优化工具，未直接改字段冒充优化');
      setControl(el,op.value);await sleep(60);
      if(el.isConnected&&el.type!=='checkbox'&&String(el.value)!==String(op.value))fail('参数“'+(label(el)||fieldLabel(el))+'”未按要求写入：要求 '+String(op.value)+'，当前 '+String(el.value));
      return {action:op.action,phase:'applied',control:label(el)||fieldLabel(el),value:op.value,...(particle()?{particle:particle()}:{})};
    }
    if(op.action==='activate_control'){
      const artAction=el.getAttribute('data-novaflow-spine-split-control-action');
      if(['inpaintEdit','inpaintRepair','inpaintCompletion','cutout','generativeSplit','penCutout','penFill','objectTransfer'].includes(artAction))return execute({action:'art_action',name:artAction},{signal,requirements,optimizerRequirements,onStatus,provider});
      if(el.getAttribute('data-novaflow-ai-tool-heading')==='frame-edit'&&!root.NovaFlowVideoFrameEditTool?.isOpen?.()&&root.NovaFlowVideoFrameEditTool?.canOpen?.()===false)fail('请先选择并加载对应视频资源，再打开帧编辑');
      if(/删除|移除|清空|清除/.test(label(el))&&!/删除|移除|清空|清除|重新选择|重画|重置/.test(requirements))fail('本次未要求删除或清空素材，未执行该操作');
      // A native art wrapper can pause in its own parameter dialog. Its submit
      // resumes that same optimized task and receipt; it is not a bypass of the
      // ordinary image/video generation wrappers.
      const nativeArtConfirmation=nativePending?.state==='running'&&!!el.closest('#novaflow-spine-split-mode-dialog[role="dialog"]');
      if(el.matches('[data-novaflow-art-generate-submit]')||!nativeArtConfirmation&&/^(?:生成|开始生成|重新生成)(?:\s|·|$)/.test(label(el)))fail('请使用对应生成工具，以保留优化、引用和执行回执');
      if(el.matches('#novaflow-aifx-mvp [data-action="generate"],[data-prb-run],[data-mp4-run],[data-vfc-run],[data-saw-run]')||el.closest('[data-novaflow-tools-workspace]')&&/开始压缩/.test(label(el)))fail('请使用特效或工具执行操作，以核对实际输出');
      const referenceCard=/^移除/.test(label(el))?el.closest('[data-novaflow-h3-source-id]'):null;
      const removedReference=referenceCard?{sourceId:referenceCard.getAttribute('data-novaflow-h3-source-id'),name:referenceCard.getAttribute('data-novaflow-h3-filename'),label:referenceCard.getAttribute('aria-label'),boardId:referenceCard.closest('[data-novaflow-h3-media-panel]')?.getAttribute('data-board-id')}:null;
      const beforePrompt=root.__NovaFlowArtGenerate?.state.prompt,beforeMedia=new Set((root.NovaFlowMediaAgent?.capture?.().artContext.videoResources||[]).map(r=>r.id));
      const beforeEffect=effects()?.source?.id,beforeParticle=JSON.stringify(particle());
      const beforeSource=root.NovaFlowSpineSplitBridge?.getState?.()?.source?.dataUrl;
      const beforeLayers=(root.NovaFlowSpineSplitBridge?.getState?.()?.parts||[]).map(p=>p.id+':'+imageIdentity(p)).join('|');
      const resourceId=el.getAttribute('data-novaflow-ai-resource-id');
      const loadedResource=resourceId?await loadNativeResourceCard(resourceId,{signal}):null;
      if(loadedResource){await waitNativeIdle(signal,onStatus);return {action:op.action,phase:'applied',resourceId,name:loadedResource.name,control:label(el),message:'已按原生画板流程加载资源：'+loadedResource.name+'；资源卡与画板来源已同步'};}
      else click(el);
      await sleep(100);await waitNativeIdle(signal,onStatus);const afterPrompt=root.__NovaFlowArtGenerate?.state.prompt;
      if(removedReference){
        const references=await root.NovaFlowH3Media?.snapshot?.(removedReference.boardId);
        if(!Array.isArray(references)||references.some(ref=>ref.sourceId===removedReference.sourceId))fail('该多参引用尚未移除，未报告完成');
        return {action:op.action,phase:'applied',control:label(el),message:'已移除引用绑定：'+removedReference.label+'；原始文件保留',sources:references.map(ref=>({id:ref.sourceId,name:ref.fileName,label:ref.label,kind:ref.kind}))};
      }
      const exportSession=root.NovaFlowAgentExportSession;
      if(exportSession?.files?.size){
        const output=await downloadFiles([...exportSession.files].map(([name,blob])=>({name,blob})),'Foart-粒子导出');root.NovaFlowAgentExportSession=null;
        return {action:op.action,phase:'completed',control:label(el),outputs:[output],message:'原生导出已编码 '+output.count+' 个文件，已发起下载：'+output.name+'（'+output.bytes+' 字节）'};
      }
      const afterEffect=effects();
      if(afterEffect?.source?.id&&afterEffect.source.id!==beforeEffect&&afterEffect.source.frames>0)return {action:op.action,phase:'completed',control:label(el),outputs:[afterEffect.source],message:'已制作并写入特效素材：'+afterEffect.source.name+'（'+afterEffect.source.frames+' 帧，'+afterEffect.source.bytes+' 字节）'};
      const afterParticle=particle();if(afterParticle&&JSON.stringify(afterParticle)!==beforeParticle)return {action:op.action,phase:'applied',control:label(el),particle:afterParticle,message:'已更新粒子工具：'+label(el)};
      const resources=(root.NovaFlowMediaAgent?.capture?.().artContext.videoResources||[]).filter(r=>!beforeMedia.has(r.id));
      const frameResult=root.NovaFlowVideoFrameEditTool?.lastResult?.();
      if(frameResult&&resources.some(r=>r.name===frameResult.fileName)){
        const actualResource=resources.find(r=>r.name===frameResult.fileName);let stageActivated=true,activationError='';
        try{await loadNativeResourceCard(actualResource.id,{signal});}catch(error){stageActivated=false;activationError=String(error.message||error).slice(0,200);}
        return {action:op.action,phase:'completed',control:label(el),stageActivated,resources:resources.map(r=>r.name===frameResult.fileName?{...r,...frameResult}:r),message:'原生帧编辑已返回新资源：'+frameResult.fileName+'（'+frameResult.frames+' 帧，'+frameResult.fps+' fps，'+frameResult.width+'×'+frameResult.height+'）；原片 '+frameResult.sourceFrames+' 帧'+(stageActivated?'；新资源已选中并加载到画板':'；新资源已保留，但画板切换尚未完成：'+activationError)};
      }
      const sourceChanged=beforeSource!==root.NovaFlowSpineSplitBridge?.getState?.()?.source?.dataUrl;
      const layers=(root.NovaFlowSpineSplitBridge?.getState?.()?.parts||[]),layersChanged=beforeLayers!==layers.map(p=>p.id+':'+imageIdentity(p)).join('|');
      const actualOutput=layersChanged||sourceChanged?await rememberNativeResult():null;
      return {action:op.action,phase:resources.length||sourceChanged||layersChanged?'completed':beforePrompt!==afterPrompt?'applied':'activated',control:label(el),...(actualOutput?{outputs:[actualOutput]}:{}),...(resources.length?{resources:resources.map(({id,name,promptId})=>({id,name,promptId})),message:'原生工具已返回新资源：'+resources.map(r=>r.name).join('、')}:layersChanged?{layers:layers.map(p=>({id:p.id,name:p.name||p.label})),message:'原生工具已更新实际图层：'+layers.map(p=>p.name||p.label||p.id).join('、')}:sourceChanged?{message:'原生工具已更新实际图片内容'}:beforePrompt!==afterPrompt?{nativePromptApplied:true,prompt:afterPrompt,message:'已将原生工具返回的新提示词写入绘图字段'}:{message:'已操作原生控件；生成或导出结果仍以实际回执为准'})};
    }
    if(op.action==='draw'){
      if(el.tagName!=='CANVAS'&&!el.matches('svg[data-svg]'))fail('当前不是可绘制选区');const r=el.getBoundingClientRect();
      const animationCanvas=el.tagName==='CANVAS'&&el.id==='overlay'&&el.ownerDocument!==root.document;
      const animationApi=animationCanvas&&root.NovaFlowSkeletonEditor?.api?.(),animationBefore=animationApi?.agentContext?.();
      const pen=!!el.closest('[data-novaflow-split-canvas-art="1"]')&&!el.matches('canvas[data-novaflow-mask-tool-canvas]')&&!el.matches('canvas[data-novaflow-selection-tool-canvas]')||el.matches('svg[data-svg]')&&!!root.__NovaFlowFxMakerOpen?.state?.drawing;
      for(let i=0;i<op.points.length;i++){
        if(signal?.aborted)fail('绘制已停止');const [x,y]=op.points[i],types=pen?['pointerdown','pointerup']:i===0?['pointerdown']:i===op.points.length-1?['pointermove','pointerup']:['pointermove'];
        for(const type of types){el.dispatchEvent(new root.PointerEvent(type,{bubbles:true,cancelable:true,pointerId:1,pointerType:'mouse',isPrimary:true,button:0,buttons:type==='pointerup'?0:1,clientX:r.left+x*r.width,clientY:r.top+y*r.height}));await sleep(20);}
      }
      if(animationCanvas){const context=animationApi.agentContext();const changed=context.revision!==animationBefore.revision;const vertexChanges=(context.editingVertices||[]).flatMap(vertex=>{const before=animationBefore.editingVertices?.find(item=>item.index===vertex.index);return before&&(Math.abs(before.x-vertex.x)>1e-7||Math.abs(before.y-vertex.y)>1e-7)?[{index:vertex.index,before:{x:before.x,y:before.y},after:{x:vertex.x,y:vertex.y}}]:[];});const weightChanges=(context.editingVertices||[]).filter(vertex=>{const before=animationBefore.editingVertices?.find(item=>item.index===vertex.index);return before&&JSON.stringify(before.weights)!==JSON.stringify(vertex.weights);}).map(vertex=>({index:vertex.index,weights:vertex.weights}));return {action:'draw',phase:'applied',surface:'animation',changed,pointCount:op.points.length,strokeBounds:{x:[Math.min(...op.points.map(p=>p[0])),Math.max(...op.points.map(p=>p[0]))],y:[Math.min(...op.points.map(p=>p[1])),Math.max(...op.points.map(p=>p[1]))]},weightChanges,vertexChanges,context,message:changed?'原生骨骼画布操作已修改当前工程':'已操作原生骨骼画布，尚未检测到工程数据修改'};}
      return {action:'draw',phase:'applied',control:pen?'钢笔轮廓画布':label(el),pointCount:op.points.length};
    }
    fail('Foart 工具操作不受支持');
  }
  async function images({requirements='',preferUploads=false}={}){
    await root.NovaFlowMediaAgent?.prepareCapture?.();
    const result=[],rt=root.__NovaFlowArtGenerate,artState=root.NovaFlowSpineSplitBridge?.getState?.(),source=artState?.source;
    if(preferUploads)for(const item of [...materials.values()].filter(m=>m.id.startsWith('upload-')&&m.kind==='image').slice(0,3))result.push({role:'attachment',name:item.name,dataUrl:await referenceDataUrl(item)});
    const animationApi=root.NovaFlowSkeletonEditor?.active?.()&&root.NovaFlowSkeletonEditor.api?.();
    if(animationApi?.agentContext?.().loaded&&typeof animationApi.agentPreview==='function'){
      const dataUrl=animationApi.agentPreview();if(dataUrl)result.unshift({role:'result',name:'当前骨骼动画画板.png',dataUrl});
      return result.slice(0,3);
    }
    if(particle()){
      if(/发射率|发射速率|寿命|生命周期|画板|画布|FPS|帧率|导出|下载|保存|透明|重力|噪声|速度|缩放|角度|着色|颜色/i.test(requirements)&&!/分析|看看|看一下|评价|根据|参考|像|匹配|设计|制作|画出|做出|优化外观/.test(requirements))return result;
      const canvas=[...root.document.querySelectorAll('canvas')].filter(visible).sort((a,b)=>b.width*b.height-a.width*a.height)[0];
      if(canvas)result.push({role:'reference',name:'当前粒子特效.png',dataUrl:canvas.toDataURL('image/png')});return result.slice(0,3);
    }
    if(effects()){
      const state=root.NovaFlowAifxMvp.getState();
      for(const [name,image] of [['当前特效素材.png',state.sourceFrames?.[0]],['当前特效结果.png',state.resultFrames?.[0]],['材质参考.png',state.reference?.image]])if(image){const canvas=root.document.createElement('canvas');canvas.width=image.naturalWidth||image.width;canvas.height=image.naturalHeight||image.height;canvas.getContext('2d').drawImage(image,0,0);result.push({role:'reference',name,dataUrl:canvas.toDataURL('image/png')});}
      return result.slice(0,3);
    }
    if(productionTools().length||root.document.body?.classList?.contains('novaflow-primary-target-tools')){
      if(!/分析|识别|看看|检查画面|检查效果|主体/.test(requirements))return result;
      const activeNames=productionTools().map(t=>t.name),allImages=[...materials.values()].filter(m=>m.kind==='image'),current=allImages.filter(m=>activeNames.some(name=>m.id.startsWith('tool-'+name+'-'))),references=allImages.filter(m=>m.id.startsWith('upload-'));
      for(const item of [...current,...references].slice(0,3)){try{const file=await materialFile(item.id);result.push({role:'reference',name:item.name,dataUrl:await referenceDataUrl({file})});}catch{}}
      return result.slice(0,3);
    }
    const pose=root.NovaFlowPoseReferenceTool?.getEditor?.();if(pose?.viewer){const dataUrl=await pose.capture();return [...result,{role:'reference',dataUrl,name:'当前姿势人偶.png'}].slice(0,3);}
    const frame=root.NovaFlowVideoFrameEditTool?.isOpen?.()&&root.document.querySelector('#novaflow-video-frame-edit-overlay .nf-vfe-stage canvas');
    if(frame?.width&&frame?.height)result.push({role:'reference',dataUrl:frame.toDataURL('image/png'),name:'当前视频帧.png'});
    const mediaActive=root.NovaFlowAudioStudio?.isOpen?.();
    if(!mediaActive&&root.NovaFlowSpineSplitBridge?.getState?.()?.maskEditor?.active){
      const live=root.document.querySelector('canvas[data-novaflow-mask-live-canvas]');
      if(live?.width&&live?.height&&visible(live))result.push({role:'result',name:'当前蒙版实际预览.png',dataUrl:live.toDataURL('image/png')});
    }
    if(mediaActive&&!frame&&root.NovaFlowAudioStudio.sub()==='video'){
      const video=[...root.document.querySelectorAll('video')].filter(v=>visible(v)&&v.readyState>=2&&v.videoWidth>0).sort((a,b)=>b.getBoundingClientRect().width*b.getBoundingClientRect().height-a.getBoundingClientRect().width*a.getBoundingClientRect().height)[0];
      if(video)try{const canvas=root.document.createElement('canvas'),scale=Math.min(1,960/video.videoWidth);canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);result.push({role:'reference',dataUrl:canvas.toDataURL('image/png'),name:'当前视频画面.png'});}catch{}
    }
    // Explicit drawing references take priority over an automatically captured
    // result, which must not silently displace a selected third image.
    if(!mediaActive&&!frame&&rt?.captureContext?.().generationSurface==='drawing'){
      const slots=Array.from(rt.references?.()||[]),last=slots.findLastIndex(Boolean);
      if(last>=0){
        if(last>=3||slots.slice(0,last+1).some(ref=>!ref))fail('参考图最多三张且不能跳号，未提交。');
        const binding=imageBinding(rt),selected=[];
        for(const ref of slots.slice(0,last+1)){
          const drawingRole=ref.drawingRole??null,genericRole=ref.role??null,normalizeRole=value=>value==='auto'?'reference':value;
          if(drawingRole!==null&&genericRole!==null&&normalizeRole(drawingRole)!==normalizeRole(genericRole))fail('参考图角色信息冲突，未提交。');
          const role=normalizeRole(drawingRole??genericRole??'auto');
          if(role==='none')fail('参考图设为不使用，请移除该参考或选择用途后重试，未提交。');
          if(!['subject','style','pose','background','material','color','composition','lighting','object','result','output','attachment','reference'].includes(role))fail('参考图角色暂不支持，未提交。');
          const dataUrl=await referenceDataUrl(ref);if(imageBinding(rt)!==binding)fail('参考图已变化，未提交。');
          if(!/^data:image\/(png|jpeg|webp);base64,/.test(dataUrl))fail('参考图格式无效，未提交。');
          selected.push({role,dataUrl,name:ref.name||ref.file?.name||''});
        }
        const extras=result.filter(item=>!selected.some(ref=>ref.dataUrl===item.dataUrl));
        if(selected.length+extras.length>3)fail('所选图片超过三张，请减少素材后重试，未提交。');
        return [...selected,...extras];
      }
    }
    const nativeStillExists=nativeResultExists();
    const composite=artState?.viewMode==='parts'&&artState.splitPreviewDataUrl?{imageUrl:artState.splitPreviewDataUrl,name:'当前美工画板合成预览.png'}:null;
    const candidates=mediaActive?[...materials.values()].filter(m=>m.id.startsWith('upload-')&&m.kind==='image'):[composite,nativeStillExists?lastResult:null,rt?.selectedResult?.(),...(rt?.references?.()||[]).filter(Boolean),source];
    for(const item of candidates.filter(Boolean)){
      if(result.length>=3)break;
      let dataUrl=item.imageUrl||item.dataUrl;
      if(!dataUrl||result.some(r=>r.dataUrl===dataUrl))continue;
      if(!/^data:image\/(png|jpeg|webp);base64,/.test(dataUrl))dataUrl=await referenceDataUrl({...item,dataUrl});
      if(/^data:image\/(png|jpeg|webp);base64,/.test(dataUrl))result.push({role:item.imageUrl?'result':'reference',dataUrl,name:item.name||item.fileName||''});
      if(result.length===3)break;
    }
    return result.slice(0,3);
  }
  async function settlePending({signal,onStatus=()=>{}}={}){
    if(!nativePending)return null;
    while(nativePending.state==='running'){
      if(signal?.aborted)fail('美工工具等待已停止，请在当前工具中确认任务状态');
      if(catalog().some(c=>c.dialog&&!c.disabled))return null;
      onStatus('正在等待'+nativePending.label+'处理…');await sleep(500);
    }
    const finished=nativePending;nativePending=null;
    if(finished.state==='failed')fail(finished.error);
    const state=root.NovaFlowSpineSplitBridge?.getState?.();if(state?.messageError)fail(state.message||'美工工具未完成');
    const actualOutput=finished.value?.output||(finished.value?.phase==='completed'&&(finished.value?.layersChanged||finished.value?.sourceChanged)?await rememberNativeResult():null);
    return {action:'art_action',phase:finished.value?.phase||'returned',name:finished.name,label:finished.label,taskId:finished.id,...(finished.value?.fileName?{fileName:finished.value.fileName}:{}),...(actualOutput?{outputs:[actualOutput]}:{}),message:state?.message||'原生工具已返回',result:finished.value,sources:root.NovaFlowSpineSplitBridge?.getSourceResources?.().map(r=>({id:r.id,name:r.fileName||r.name})),layers:(state?.parts||[]).map(p=>({id:p.id,name:p.name||p.label||p.id,label:p.name||p.label||p.id}))};
  }
  // Keep the community selection capability separate from the general animation
  // action bridge: no generic agentAction call can serve as user approval.
  function communitySelection(method,...args) {
    const api=root.NovaFlowSkeletonEditor?.active?.() && root.NovaFlowSkeletonEditor.api();
    if(typeof api?.[method]!=='function')fail('当前动画编辑器尚不支持安全的骨骼选择预览');
    return api[method](...args);
  }
  function confirmImageReview(reviewId,{attachGenerationProof=false}={}){
    const review=pendingImageReview,rt=root.__NovaFlowArtGenerate;
    if(!review||review.reviewId!==reviewId||rt!==review.rt||rt.state.running||!review.selectionStillCurrent()||!review.sessionStillCurrent()||imageBinding(rt)!==review.beforeBinding)
      fail('绘图内容或模型选择已变化，审核稿未应用。');
    if(attachGenerationProof&&(!review.generationBinding||root.electronAPI?.confirmedArtImageAvailableSync?.()!==true))fail('当前生成验证不可用，请重新优化。');
    if(review.uploadTransaction){
      if(review.attachmentStillCurrent()!==true)fail('上传图片已变化，草稿未应用。');
      let binding='';
      review.uploadTransaction.apply({prompt:review.prompt,negativePrompt:review.negativePrompt,createPrepared({references}){
        binding=imageBinding(rt);
        return {...(attachGenerationProof?review.generationBinding:{}),state:copy({...artSettings(rt.state),running:false,count:review.count}),promptSnapshot:{prompt:review.modelPrompt,negativePrompt:review.negativePrompt},references:references.filter(Boolean),direct:true,agentRun:true,promptOnlyOptimization:!attachGenerationProof,
          referenceRolePlan:{roles:review.referenceRoles.slice(),conditioning:[],allowMultipleSubjects:true},plan:{schema:'nf.foart.native-image.v1'},originalPrompt:review.op.prompt,
          assertCurrent:()=>{if(!review.selectionStillCurrent()||!review.sessionStillCurrent()||imageBinding(rt)!==binding)fail('绘图内容或模型选择已变化，草稿失效。');},recordReview:()=>{}};
      }});
      review.markUploadCommitted();imageReviewUndo={reviewId,rt,binding,transaction:review.uploadTransaction,selectionStillCurrent:review.selectionStillCurrent,sessionStillCurrent:review.sessionStillCurrent};pendingImageReview=null;
      try{rt.render?.({forceBottom:true});if(!review.uploadTransaction.isCurrent()||imageBinding(rt)!==binding)throw Error('drawing changed');}
      catch{try{review.uploadTransaction.undo();imageReviewUndo=null}catch{reviewUncertain('草稿应用后状态变化，请核对绘图界面。')}fail('草稿应用失败，写入已撤销。');}
      return {phase:'applied',reviewId};
    }
    const previous={prompt:rt.state.prompt,negativePrompt:rt.state.negativePrompt};let undoToken,writtenBinding=null;
    try{
      rt.state.prompt=review.prompt;rt.state.negativePrompt=review.negativePrompt;
      const binding=imageBinding(rt),refs=review.op.generationMode==='txt2img'?[]:(rt.references?.()||[]).filter(Boolean);writtenBinding=binding;
      const prepared={...(review.preparedAgent||{}),...(attachGenerationProof?review.generationBinding:{}),state:copy({...artSettings(rt.state),...(review.preparedAgent?.state||{}),running:false,count:review.count}),
        promptSnapshot:{prompt:review.modelPrompt,negativePrompt:review.negativePrompt},references:review.preparedAgent?.references||refs,direct:review.preparedAgent?false:true,agentRun:true,promptOnlyOptimization:!attachGenerationProof,
        ...(review.referenceRoles&&review.op.generationMode==='img2img'?{referenceRolePlan:{roles:review.referenceRoles.slice(),conditioning:[],allowMultipleSubjects:true}}:{}),
        plan:review.preparedAgent?.plan||{schema:'nf.foart.native-image.v1'},originalPrompt:review.op.prompt,
        assertCurrent:()=>{if(!review.selectionStillCurrent()||!review.sessionStillCurrent()||imageBinding(rt)!==binding)fail('绘图内容或模型选择已变化，审核稿失效。');},recordReview:()=>{}};
      undoToken=rt.replaceAgentPrepared(review.preparedSnapshot,prepared);
      imageReviewUndo={reviewId,rt,binding,undoToken,previous,selectionStillCurrent:review.selectionStillCurrent,sessionStillCurrent:review.sessionStillCurrent};pendingImageReview=null;
    }catch(error){
      let canRestore=false;try{canRestore=!!writtenBinding&&imageBinding(rt)===writtenBinding;}catch{}
      if(!canRestore)reviewUncertain('审核时绘图状态已变化，请核对当前内容。');
      rt.state.prompt=previous.prompt;rt.state.negativePrompt=previous.negativePrompt;throw error;
    }
    try{
      rt.render?.({forceBottom:true});
      if(!review.selectionStillCurrent()||!review.sessionStillCurrent()||imageBinding(rt)!==imageReviewUndo.binding||!rt.isAgentPreparedReplacementCurrent(undoToken))
        fail('审核稿应用后状态已变化，请核对绘图界面。');
    }
    catch(error){
      try{
        if(imageBinding(rt)!==imageReviewUndo.binding)throw Error('drawing changed');
        rt.restoreAgentPrepared(imageReviewUndo.undoToken);
        rt.state.prompt=previous.prompt;rt.state.negativePrompt=previous.negativePrompt;imageReviewUndo=null;
      }catch{reviewUncertain('审核稿可能已写入且状态发生变化，请先核对绘图界面。');}
      fail('显示审核稿失败，本次写入已撤销。');
    }
    return {phase:'applied',reviewId};
  }
  let confirmedImageGenerationInFlight=false;
  async function confirmImageReviewAndGenerate(reviewId,event){
    if(confirmedImageGenerationInFlight||!root.Event||!(event instanceof root.Event)||event.isTrusted!==true||
      event.currentTarget?.getAttribute?.('data-nf-xiaotao-art-generate')!=='1'||
      root.navigator?.userActivation?.isActive!==true||root.document?.contains?.(event.currentTarget)!==true)
      fail('请在小桃面板中由用户确认生成。');
    const review=pendingImageReview,rt=root.__NovaFlowArtGenerate,ctx=rt?.captureContext?.();
    if(!review||review.reviewId!==reviewId||rt!==review.rt||!ctx||ctx.state!==rt.state||
      ctx.generationSurface!=='drawing'||ctx.state.active!==true||!Number.isSafeInteger(ctx.routeRevision)||
      review.count!==1||!review.selectionStillCurrent()||!review.sessionStillCurrent())fail('当前绘图、账号或模型已变化，未生成。');
    const revision=ctx.routeRevision,previous=rt.selectedResult?.()?.id??null,
      beforeIds=new Set((rt.state.results||[]).map(row=>row?.id).filter(Boolean)),
      selected=root.NovaFlowXiaotaoArtAgent?.panel?.controller?.businessModelSnapshot?.();
    if(!selected||selected.provider!=='api'||!selected.modelId||!Number.isSafeInteger(selected.epoch))fail('当前模型状态不可验证，未生成。');
    if(!review.generationBinding||root.electronAPI?.confirmedArtImageAvailableSync?.()!==true||rt.state.provider!=='gpt')fail('当前生成验证不可用，请重新优化。');
    confirmedImageGenerationInFlight=true;
    try{
      const applied=confirmImageReview(reviewId,{attachGenerationProof:true});
      if(applied?.phase!=='applied'||applied.reviewId!==reviewId)fail('审核稿应用未确认。');
      const now=rt.captureContext?.();
      if(now?.state!==rt.state||now?.generationSurface!=='drawing'||now?.routeRevision!==revision||
        !review.selectionStillCurrent()||!review.sessionStillCurrent())return {phase:'applied-not-started',reviewId};
      try{
        // Reuse the native generation entry and its existing task/credit checks.
        // An unknown outcome is never automatically re-submitted.
        const runResult=await rt.run();
        if(runResult?.phase==='cancelled-before-dispatch')return {phase:'cancelled-before-dispatch',reviewId};
        const result=rt.selectedResult?.(),after=rt.captureContext?.(),
          selectedAfter=root.NovaFlowXiaotaoArtAgent?.panel?.controller?.businessModelSnapshot?.();
        // Successful native placement legitimately invalidates the original
        // project guard. The native prepared assertion already checks that
        // guard before placement; after run compare session/model/route instead.
        if(root.__NovaFlowArtGenerate!==rt||!review.sessionStillCurrent()||after?.generationSurface!=='drawing'||after?.routeRevision!==revision||
           selectedAfter?.provider!==selected.provider||selectedAfter?.modelId!==selected.modelId||selectedAfter?.epoch!==selected.epoch)return {phase:'unknown',reviewId};
        if(result?.id&&result.id!==previous&&!beforeIds.has(result.id)&&result.imageUrl)
          return {phase:result.placedInSource===true?'completed':'completed-not-placed',reviewId,id:result.id,name:result.name,imageUrl:result.imageUrl};
        return {phase:'unknown',reviewId};
      }catch{return {phase:'unknown',reviewId};}
    }finally{confirmedImageGenerationInFlight=false;}
  }
  function undoImageReview(reviewId){
    const undo=imageReviewUndo,rt=root.__NovaFlowArtGenerate;
    if(!undo||undo.reviewId!==reviewId||rt!==undo.rt||rt.state.running||!undo.selectionStillCurrent()||!undo.sessionStillCurrent()||imageBinding(rt)!==undo.binding)
      fail('绘图内容已变化，不能覆盖当前内容进行撤销。');
    if(undo.transaction){undo.transaction.undo();imageReviewUndo=null;try{rt.render?.({forceBottom:true});return {phase:'undone',reviewId};}catch{return {phase:'undone',reviewId,warning:'撤销已恢复，请刷新查看。'};}}
    rt.restoreAgentPrepared(undo.undoToken);
    try{rt.state.prompt=undo.previous.prompt;rt.state.negativePrompt=undo.previous.negativePrompt;}
    catch{imageReviewUndo=null;reviewUncertain('准备态已恢复，提示词恢复未确认，请核对绘图界面。');}
    imageReviewUndo=null;
    try{rt.render?.({forceBottom:true});return {phase:'undone',reviewId};}
    catch{return {phase:'undone',reviewId,warning:'内容已恢复，但绘图界面刷新失败，请手动刷新。'};}
  }
  function cancelImageReview(reviewId){
    if(!pendingImageReview||pendingImageReview.reviewId!==reviewId)return false;
    pendingImageReview.uploadTransaction?.cancel();pendingImageReview=null;return true;
  }
  root.NovaFlowFoartTools=Object.freeze({capture,captureDrawingReferenceRoles,prepareUploadReferenceTransaction,execute,images,settlePending,catalog,open,useResult,setUploads,downloadFiles,downloadFile,confirmImageReview,confirmImageReviewAndGenerate,undoImageReview,cancelImageReview});
})(typeof window!=='undefined'?window:globalThis);
