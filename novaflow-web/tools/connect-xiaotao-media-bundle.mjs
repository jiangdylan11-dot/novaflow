// The maintained React bundle has no rebuildable AI-sequence TSX source.
// Keep its narrow closure adapter reproducible and fail on upstream drift.
import {readFile,writeFile} from 'node:fs/promises';
const file=new URL('../renderer/assets/index-BbIa-2NM.js',import.meta.url);
let source=await readFile(file,'utf8');
const marker='nfMediaAgentBridge=(window.NovaFlowAiSequenceGeneration=';
if(!source.includes(marker)) {
  const anchor=',[Rr,zr]=(0,_.useState)';
  if(source.split(anchor).length!==2)throw new Error('AI sequence generation closure changed');
  const adapter=`,nfMediaAgentBridge=(window.NovaFlowAiSequenceGeneration={
    capture:()=>({boardId:Jr,mode:ze,provider:ze==='cloud'?ot:'local',genType:Ve,prompt:Z,negativePrompt:it,
      width:yt,height:xt,frames:Ct,fps:Dt,steps:Tt,
      h3:ze==='minimax_h3_local'?{profile:nfH3Profile,seconds:nfH3DurationInput,fps:nfH3Fps,steps:nfH3Steps,width:nfH3Width,height:nfH3Height,ratio:nfH3AspectRatio,megapixels:nfH3Megapixels,custom:nfH3Custom}:null,
      cloud:ze==='cloud'?nfAiSeqPickLiveCloudParams():null,
      h3References:(window.NovaFlowH3Media?.store?.get(Jr)||[]).map(ref=>window.NovaFlowMediaAgent?.referenceStamp(ref)||null),
      references:[un,gn,Sn,nfJimengImage2Ref,nfJimengImage3Ref,nfJimengImage4Ref,nfJimengVideoRef,nfJimengAudioRef].map(ref=>window.NovaFlowMediaAgent?.referenceStamp(ref)||null)}),
    status:()=>({state:an?.state||'idle',message:an?.message||'',promptId:an?.promptId||''}),
    resources:()=>(Dn||[]).map(r=>({id:String(r.id),promptId:String(r.promptId||''),name:String(r.filename||''),kind:r.sourceKind||'video'})),
    setRequest:op=>{if(op.seconds!==undefined){if(ze==='minimax_h3_local'){window.NovaFlowAiSequenceMiniMaxH3Workflow.normalizeDuration({seconds:op.seconds,fps:nfH3Fps});nfSetH3DurationInput(String(op.seconds));}else if(ze==='cloud'){
      const spec=(_t?.[ot]?.params||[]).find(p=>p.key==='duration');if(!spec)throw Error('当前视频模型不支持直接设置时长，请先在视频参数中设置');mt('duration',op.seconds);
    }else{const frames=Math.round(op.seconds*Number(Dt));if(frames<1||frames>2000)throw Error('视频时长超出范围');wt(frames);Rt(String(frames));}}
      if(op.prompt!==undefined)Q(op.prompt);},
    submit:signal=>nfRunAiSeqGenerate(signal),cancel:()=>Dr()
  })`;
  source=source.replace(anchor,adapter+anchor);
}
source=source.replace('nfRunAiSeqGenerate=async()=>','nfRunAiSeqGenerate=async(nfMediaSignal)=>')
  .replace('submit:()=>nfRunAiSeqGenerate(),cancel:()=>Dr()','submit:signal=>nfRunAiSeqGenerate(signal),cancel:()=>Dr()')
  .replace('capture:()=>({mode:ze,provider:', 'capture:()=>({boardId:Jr,mode:ze,provider:')
  .replace("resources:()=>(Dn||[]).map(r=>({id:String(r.id),name:","resources:()=>(Dn||[]).map(r=>({id:String(r.id),promptId:String(r.promptId||''),name:")
  .replace("if(ze==='minimax_h3_local')nfSetH3DurationInput(String(op.seconds));", "if(ze==='minimax_h3_local'){window.NovaFlowAiSequenceMiniMaxH3Workflow.normalizeDuration({seconds:op.seconds,fps:nfH3Fps});nfSetH3DurationInput(String(op.seconds));}");
if(!source.includes("if(nfMediaSignal?.aborted)"))source=source.replace('Lr(),Er(nfH3SubmitSnapshot||void 0)',"if(nfMediaSignal?.aborted)throw Error('音视操作已停止');Lr(),Er(nfH3SubmitSnapshot||void 0)");
if(!source.includes('h3References:'))source=source.replace('references:[un,gn,Sn,nfJimengImage2Ref',"h3References:(window.NovaFlowH3Media?.store?.get(Jr)||[]).map(ref=>window.NovaFlowMediaAgent?.referenceStamp(ref)||null),references:[un,gn,Sn,nfJimengImage2Ref");
const assetAnchor='window.NovaFlowAiSequenceAssetBridge={version:';
if(!source.includes('listResources:()=>')) {
  if(source.split(assetAnchor).length!==2)throw new Error('AI sequence asset closure changed');
  source=source.replace(assetAnchor,`window.NovaFlowAiSequenceAssetBridge={listResources:()=>(et.current||[]).map(r=>({id:String(r.id),name:String(r.filename||r.file?.name||''),kind:r.sourceKind||'video'})),version:`);
}
await writeFile(file,source);
