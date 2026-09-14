export function patchCutoutMaskStream(source) {
  if(source.includes('nfMaskStreamV1'))return source;
  const replace=(a,b)=>{if(source.indexOf(a)<0||source.indexOf(a)!==source.lastIndexOf(a))throw Error('Mask stream anchor: '+a.slice(0,90));source=source.replace(a,b);};
  replace('pe=async n=>{let nfCaptureReader=null;', 'pe=async n=>{/* nfMaskStreamV1 */let nfCaptureReader=null,nfPrewarm=null,nfChunkUnsubscribe=null;');
  replace('requireSubjectMask:R===`ai`,sequence:R===`ai`', 'requireSubjectMask:R===`ai`,preparedFrame:R===`ai`?fe.current?.frames?.get(c)?.frame:null,sequence:R===`ai`');
  replace('let N=await E(new TextEncoder().encode(JSON.stringify(O))),P=await i.aiSeqRembgBatch({jobId:o,backend:B,kind:`video`,',
    'let N=await E(new TextEncoder().encode(JSON.stringify(O)));if(nfGreenScreen&&i.onAiSeqRembgMaskChunk&&window.NovaFlowCutoutPipeline){let nfShown=false;const nfPreferred=Number(k[Math.max(0,Math.min(d-1,Math.floor((Number(e.timeSec)||0)*c)))])||0;nfPrewarm=window.NovaFlowCutoutPipeline.create({frames:A,width:g,height:_,preserveShadow:nfPreserveShadow,active:()=>K.current===o,onPreview:(index,bitmap)=>{if(nfShown||index!==nfPreferred||K.current!==o||!en.current)return;const target=en.current,ctx=target.getContext(`2d`),rect=Vr(bitmap.width,bitmap.height,target.width,target.height);if(ctx){ctx.clearRect(0,0,target.width,target.height);ctx.drawImage(bitmap,rect.dx,rect.dy,rect.dw,rect.dh);nfShown=true;}}});nfChunkUnsubscribe=i.onAiSeqRembgMaskChunk(chunk=>{if(chunk?.jobId===o&&K.current===o)nfPrewarm.add(chunk);});}let P=await i.aiSeqRembgBatch({jobId:o,backend:B,kind:`video`,streamMasks:!!nfPrewarm,referenceDecodedFrameIndices:nfPrewarm?.references,');
  replace('G.current={fps:F,frames:d,timelineFrameCount:d,alphaFrames:ee,', 'nfPrewarm?.commit(U.current);G.current={fps:F,frames:d,timelineFrameCount:d,alphaFrames:ee,');
  replace(')}catch(e){K.current===o&&(H(!1),P(!1),nfReleaseCutoutSource()', ')}catch(e){nfPrewarm?.stop();K.current===o&&(H(!1),P(!1),nfReleaseCutoutSource()');
  replace('}finally{try{s?.()}catch{}nfCaptureReader?.release?.();W.current.delete(-1)}', '}finally{try{nfChunkUnsubscribe?.();s?.()}catch{}nfCaptureReader?.release?.();W.current.delete(-1)}');
  return source;
}
