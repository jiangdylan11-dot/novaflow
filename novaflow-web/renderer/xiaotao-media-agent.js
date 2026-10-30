(function(root) {
  'use strict';
  const fail = message => {throw new Error(message);};
  const clone = value => JSON.parse(JSON.stringify(value));
  const references = new WeakMap(), usedPlans=new Set(); let referenceSerial=0;
  function referenceStamp(ref) {
    if(!ref || typeof ref!=='object')return null;
    let stamp=references.get(ref);
    const url=ref.dataUrl || ref.objectUrl || '';
    if(!stamp || stamp.url!==url || stamp.blob!==ref.blob){stamp={url,blob:ref.blob,id:++referenceSerial};references.set(ref,stamp);}
    return {id:String(stamp.id),name:String(ref.fileName || ref.name || ''),kind:ref.kind || '',width:ref.w || ref.width || 0,height:ref.h || ref.height || 0};
  }
  function h3ReferenceContext(items=[]) {
    const media=root.NovaFlowH3Media;
    if(!media?.resources)return [];
    return media.resources(items).map((resource,i)=>({...referenceStamp(items[i]),sourceId:resource.sourceId,
      key:resource.key,label:resource.label,modelToken:resource.modelToken,seconds:resource.durationSec || 0}));
  }
  function h3PromptProtocol(mode) {
    const workflow=root.NovaFlowAiSequenceMiniMaxH3PromptWorkflow;
    const definition=workflow?.getModeDefinition?.(mode);
    return definition ? {mode:definition.value,name:definition.protocolName,fields:definition.fieldOrder,
      slots:definition.slots.map(slot=>({key:slot.key,label:slot.label,kind:slot.kind,modelToken:slot.fixedModelToken})),
      ...(definition.value==='multi_reference'?{relations:workflow.REFERENCE_RELATIONS}: {})} : null;
  }
  const allClips=editor => editor?.state?.tracks?.flatMap(t=>t.clips || []) || [];
  function timeline(editor) {
    return {selected:editor?.selectedClip?.()?.id || '',canvas:editor?.state?.canvas?clone(editor.state.canvas):null,tracks:(editor?.state?.tracks || []).map(t=>({id:t.id,kind:t.kind,gain:t.gain ?? 1,mute:!!t.mute,solo:!!t.solo,visible:t.visible!==false,
      clips:(t.clips || []).map(c=>({id:c.id,name:c.name,kind:c.kind || '',start:c.start,offset:c.offset,end:c.end,length:c.length,
        rate:c.rate || 1,gain:c.gain ?? 1,loops:c.loops || 1,fadeIn:c.fadeIn || 0,fadeOut:c.fadeOut || 0,visible:c.visible!==false,audioDetached:!!c.audioDetached,
        transform:c.transform?clone(c.transform):null,maskRevision:c.maskRevision || 0,sourceIdentity:referenceStamp(c.source || c.buffer),sourceName:c.source?.fileName || '',sourceSeconds:c.source?.durationSec || c.buffer?.duration || 0}))}))};
  }
  function capture() {
    const audio=root.NovaFlowAudioStudio, video=root.NovaFlowAiSequenceVideoMergeWorkspace, gen=root.NovaFlowAiSequenceGeneration;
    return {artContext:{surface:'media',sub:audio?.sub?.() || 'video',
      generation:gen?.capture?.() || null,
      video:timeline(video?.editor?.()),audio:timeline(audio?.editor?.()),
      videoResources:root.NovaFlowAiSequenceAssetBridge?.listResources?.() || [],
      audioResources:(audio?.resources?.() || []).filter(r=>!r.pending).map(r=>({id:r.id,name:r.name,seconds:r.seconds,kind:r.kind})),
      audioSettings:audio?.agentSettings?.() || null},images:[]};
  }
  function wantsMedia(message) {
    const audio=root.NovaFlowAudioStudio;
    return Boolean(audio?.isOpen?.() || root.NovaFlowAiSequenceVideoMergeWorkspace?.isOpen?.()
      || /视频|音频|音效|音乐|配乐|剪辑|时间轴|淡入|淡出|音轨|音视/.test(message));
  }
  function discussionOnly(message) {
    return !/(?:请|帮我|给我|把|将|生成|制作|开始|执行|裁切|剪辑|分割|剪掉|截取|移动|变速|调|设置|导入|导出|复制|删除|移除|淡入|淡出|增大|减小|小点|大点|处理)|\b(?:generate|create|trim|split|move|set|export|import|delete|duplicate|fade|adjust)\b/i.test(message)
      || /[?？]|(?:能不能|可不可以|能否|是否|怎么|如何|为什么)|吗[。！!]?\s*$|(?:不要|不用|别|先不|暂不|只需|只要).{0,10}(?:生成|执行|剪辑|修改|导出|处理)|(?:只|仅).{0,6}(?:提示词|方案|建议|聊聊|讨论|解释)/.test(message)
      || /(?:给我|提供|输出|写).{0,10}(?:提示词|方案|建议)/.test(message) && !/并生成|直接生成|执行|写入|填入/.test(message);
  }
  async function openEditor(target) {
    const audio=root.NovaFlowAudioStudio;
    if(!audio)fail('音视版块尚未加载，请刷新页面');
    if(target==='audio') {audio.open('audio');return audio.editor?.() || fail('音频编辑器尚未就绪');}
    audio.open('video');
    const workspace=root.NovaFlowAiSequenceVideoMergeWorkspace;
    if(!workspace?.isOpen?.()) {
      const heading=root.document?.querySelector('[data-novaflow-ai-tool-heading="video-merge"]');
      if(!heading)fail('请先打开音视的视频编辑页面');
      const rect=heading.getBoundingClientRect(),init={bubbles:true,cancelable:true,clientX:rect.left+rect.width/2,clientY:rect.top+rect.height/2,button:0};
      for(const type of ['pointerdown','mousedown','pointerup','mouseup','click'])heading.dispatchEvent(type.startsWith('pointer')?new root.PointerEvent(type,init):new root.MouseEvent(type,init));
    }
    for(let i=0;i<40;i++){const editor=workspace?.editor?.();if(editor)return editor;await new Promise(r=>root.setTimeout(r,50));}
    fail('视频编辑器尚未就绪');
  }
  const numeric=(v,min,max,label)=>{if(typeof v!=='number' || !Number.isFinite(v) || v<min || v>max)fail(label+'超出允许范围');return v;};
  function edit(editor,op) {
    const clips=allClips(editor),clip=op.clipId ? clips.find(c=>c.id===op.clipId) : editor.selectedClip?.();
    if(!clip)fail('未找到要编辑的片段，请先选择片段或指定当前片段编号');
    editor.pause();
    if(op.action==='split') {
      const at=numeric(op.at,clip.start+.021,clip.start+clip.length-.021,'分割位置');
      if((clip.loops || 1)>1)fail('循环片段请先取消循环再分割');
      editor.select(clip.id);editor.seek(at);if(!editor.splitAtPlayhead())fail('片段未分割');
    } else if(op.action==='duplicate') {editor.select(clip.id);if(!editor.duplicateSelected())fail('片段未复制');}
    else if(op.action==='remove') {if(!editor.removeClip(clip.id))fail('片段未移除');}
    else if(op.action==='fade') {
      if(op.fadeIn===undefined && op.fadeOut===undefined)fail('缺少淡入淡出时长');
      const fadeIn=op.fadeIn ?? clip.fadeIn ?? 0,fadeOut=op.fadeOut ?? clip.fadeOut ?? 0;
      numeric(fadeIn,0,clip.length,'淡入时长');numeric(fadeOut,0,clip.length-fadeIn,'淡出时长');editor.setFade(clip.id,fadeIn,fadeOut);
    } else if(op.action==='volume') {
      const gain=numeric(op.value,0,2,'音量');
      if(!editor.setGain)fail('请将音轨导入音频编辑器后调整音量');
      editor.setGain(clip.id,gain);
    } else if(['trim','move','rate'].includes(op.action)) {
      const rate=op.action==='rate'?numeric(op.value,.5,2,'速度'):clip.rate || 1;
      const maxSource=clip.source?.durationSec || clip.buffer?.duration || clip.end;
      const offset=op.action==='trim'?numeric(op.start,0,maxSource,'裁切起点'):clip.offset;
      const end=op.action==='trim'?numeric(op.end,offset+.05,maxSource,'裁切终点'):clip.end;
      const start=op.action==='move'?numeric(op.at,0,86400,'片段位置'):clip.start;
      const length=(end-offset)*(clip.loops || 1)/rate;
      const track=editor.state.tracks.find(t=>t.id===clip.trackId) || editor.state.tracks.find(t=>t.clips.includes(clip));
      if(track.clips.some(c=>c!==clip && start<c.start+c.length-1e-6 && start+length>c.start+1e-6))fail('调整会与同轨片段重叠，请先移动到空闲位置');
      Object.assign(clip,{start,offset,end,rate});editor.syncLength(clip);refresh(editor);
    } else fail('不支持的时间轴操作');
    return {ok:true,action:op.action,target:op.target,clipId:clip.id,timeline:timeline(editor)};
  }
  function refresh(editor) {editor.commitEdit();editor.select(editor.selectedClip?.()?.id || null);root.NovaFlowAiSequenceVideoMergeWorkspace?.refresh?.();}
  async function generateVideo(op,signal,{snapshot,fingerprint,requirements,onOptimizationStatus}={}) {
    root.NovaFlowAudioStudio?.open('video');
    let gen=root.NovaFlowAiSequenceGeneration;
    if(!gen)fail('视频生成接口尚未就绪');
    if(gen.status()?.state==='running')fail('已有视频任务在执行，请等待完成');
    if(typeof root.__NovaFlowSmartAI?.optimizeForAgent!=='function' || typeof gen.optimizationContext!=='function')fail('原有视频提示词优化框架尚未就绪，请刷新页面');
    const videoContext=await gen.optimizationContext();
    videoContext.durationSeconds=op.seconds ?? videoContext.durationSeconds;
    const optimized=await root.__NovaFlowSmartAI.optimizeForAgent({surface:'animation',videoContext,prompt:op.prompt || gen.capture().prompt,requirements,signal,onProgress:onOptimizationStatus});
    if(signal?.aborted)fail('本次视频生成已停止');
    if(await fingerprint(capture())!==await fingerprint(snapshot))fail('视频素材或参数在优化期间变化，未写入或生成');
    op={...op,prompt:optimized.displayPrompt || optimized.prompt};
    gen=root.NovaFlowAiSequenceGeneration;
    const before=new Set((gen.resources() || []).map(r=>r.id));
    gen.setRequest(op);
    await new Promise(r=>root.setTimeout(r,100));
    if(signal?.aborted)fail('音视操作已停止');
    gen=root.NovaFlowAiSequenceGeneration;
    if(gen.capture().prompt!==op.prompt)fail('视频优化提示词未完整写入，未开始生成');
    onOptimizationStatus?.('提示词已优化，正在生成视频…');
    const started=Date.now(),initialStatus=gen.status(),initial=JSON.stringify(initialStatus);
    let changed=false;
    const abort=()=>{void Promise.resolve(root.NovaFlowAiSequenceGeneration?.cancel?.()).catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
    try {
      await gen.submit(signal);
      for(;;) {
        if(signal?.aborted)fail('本次视频生成已停止');
        const current=root.NovaFlowAiSequenceGeneration,status=current.status();
        if(JSON.stringify(status)!==initial)changed=true;
        if(changed && status?.state==='error')fail(status.message || '视频生成失败');
        const added=current.resources().filter(r=>!before.has(r.id));
        const produced=status?.promptId && status.promptId!==initialStatus?.promptId
          ? added.filter(r=>r.promptId===status.promptId || r.id.startsWith(status.promptId+':')) : [];
        if(changed && status?.state==='done' && produced.length)return {ok:true,action:op.action,resources:produced,optimization:optimized.optimization,executedPrompt:optimized.prompt};
        if(!changed && Date.now()-started>15000)fail('视频任务未启动，请检查模型、素材和连接状态');
        if(Date.now()-started>30*60*1000)fail('视频生成等待超时，请在视频任务中检查状态');
        await new Promise(r=>root.setTimeout(r,500));
      }
    } finally {signal?.removeEventListener('abort',abort);}
  }
  async function execute(plan,{snapshot,fingerprint,signal,requirements='',onOptimizationStatus=()=>{},onProgress=()=>{}}={}) {
    if(!plan || !Array.isArray(plan.operations) || !plan.operations.length || plan.operations.length>12)fail('音视执行方案无效');
    if(typeof plan.planId!=='string' || usedPlans.has(plan.planId))fail('这份音视方案已执行或编号无效，请重新发送需求');
    if(plan.contextFingerprint!==await fingerprint(snapshot) || plan.contextFingerprint!==await fingerprint(capture()))fail('音视内容已变化，请重新发送需求');
    usedPlans.add(plan.planId);if(usedPlans.size>512)usedPlans.delete(usedPlans.values().next().value);
    const results=[];
    for(const op of plan.operations) {
      if(signal?.aborted)fail('音视操作已停止');
      if(!['video','audio'].includes(op.target))fail('音视操作目标无效');
      onProgress(op,results.length);
      try {
        if(op.action==='generate_video')results.push(await generateVideo(op,signal,{snapshot,fingerprint,requirements,onOptimizationStatus}));
        else if(['generate_music','generate_sfx'].includes(op.action)) {
          root.NovaFlowAudioStudio.open('audio');
          results.push(await root.NovaFlowAudioStudio.agentGenerate(op,{signal}));
        } else {
          const editor=await openEditor(op.target);
          if(signal?.aborted)fail('音视操作已停止');
          if(op.action==='import_resource') {
            const context=capture().artContext;
            const known=op.target==='video'?context.videoResources:[...context.audioResources,...context.videoResources];
            if(!known.some(r=>r.id===op.resourceId))fail('当前资源列表中找不到这个素材');
            const before=editor.clipCount();
            if(op.target==='video')await root.NovaFlowAiSequenceVideoMergeWorkspace.importResource(op.resourceId,{signal});
            else await root.NovaFlowAudioStudio.agentImportResource(op.resourceId,{signal});
            if(editor.clipCount()<=before)fail('素材未导入时间轴');
            results.push({ok:true,action:op.action,target:op.target,timeline:timeline(editor)});
          } else if(op.action==='export') {
            if(op.target==='video') {const result=await root.NovaFlowAiSequenceVideoMergeWorkspace.exportToFile();if(!result?.ok)fail(result?.error || '视频导出未完成');results.push({ok:true,action:'export',target:'video',fileName:result.fileName || '',bytes:result.bytes || 0});}
            else results.push(await root.NovaFlowAudioStudio.agentExport());
          } else results.push(edit(editor,op));
        }
      } catch(error) {throw Object.assign(new Error((results.length?'已完成 '+results.length+' 步；':'')+String(error.message || error)),{completed:clone(results)});}
    }
    return {ok:true,results};
  }
  root.NovaFlowMediaAgent={capture,wantsMedia,discussionOnly,execute,referenceStamp,h3ReferenceContext,h3PromptProtocol,timeline,edit};
})(typeof window!=='undefined'?window:globalThis);
