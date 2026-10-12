(function(root){
  'use strict';
  const api=root.NovaFlowGreenScreenMatting;
  if(!api?.registerPreparedFrame)return;
  const same=(a,b)=>{if(!a||!b||a.length!==b.length)return false;for(let i=0;i<a.length;i++)if(a[i]!==b[i])return false;return true;};
  const canvas=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
  root.NovaFlowCutoutPipeline={create({frames,width,height,preserveShadow,cleanEdges=false,sheerMaterial=false,active,onPreview,preferredIndex=0}){
    const masks=new Map(),references=api.referenceFrameIndices(frames),cache=api.createFrameCache(),jobs=new Map(),remove=[];
    // Keep the provisional reference separate from normal rendering's cache;
    // a rejected partial mask must never leave a stale final reference behind.
    const sequence={frames:new Map(frames),masks,maskWidth:width,maskHeight:height};
    let stopped=false,committed=false,profile,referenceReady=false,running=0,completed=0,firstReadyMs=null,completedBeforeCommit=0;
    const started=performance.now(),limit=api.parallelism(width,height);
    const valid=()=>!stopped&&active();
    const report=()=>{root.__NOVAFLOW_CUTOUT_PIPELINE_METRICS__={received:masks.size,completed,running,firstReadyMs,committed,completedBeforeCommit};};
    const stop=()=>{stopped=true;cache?.clear();for(const dispose of remove)dispose();};
    async function read(index,options){
      if(!valid()||!committed||options.prewarm||options.globalEdit||options.frameEdit||options.preserveShadow!==preserveShadow||!!options.cleanEdges!==!!cleanEdges||!!options.sheerMaterial!==!!sheerMaterial)return null;
      if(!jobs.has(index)){jobs.set(index,{promise:Promise.resolve()});return null;}
      await jobs.get(index)?.promise;
      if(!valid())return null;
      const item=await cache?.get(String(index));
      if(!item)return null;
      cache.delete(String(index));
      const data=item.imageData.data,alpha=new Uint8ClampedArray(width*height),mask=new Uint8ClampedArray(data.length);
      for(let p=0,i=0;p<alpha.length;p++,i+=4){alpha[p]=data[i+3];mask[i]=mask[i+1]=mask[i+2]=255;mask[i+3]=alpha[p];}
      options.rgbaCanvas.getContext('2d',{willReadFrequently:true}).putImageData(item.imageData,0,0);
      options.maskCanvas.getContext('2d').putImageData(new ImageData(mask,width,height),0,0);
      return {maskCanvas:options.maskCanvas,rgbaCanvas:options.rgbaCanvas,finalAlpha:alpha,screen:item.screen,materialStats:item.materialStats};
    }
    for(const [index,entry] of frames)remove.push(api.registerPreparedFrame(entry.frame,options=>read(index,options)));
    function drain(){
      if(!valid()||!cache)return;
      if(!referenceReady){
        if(!references.every(index=>masks.has(index)))return;
        profile=api.prepareSequenceReference(sequence);referenceReady=true;
      }
      const ordered=[...frames.entries()].sort((a,b)=>(a[0]===preferredIndex?-1:b[0]===preferredIndex?1:0));
      for(const [index,entry] of ordered){
        if(running>=limit)break;
        if(!masks.has(index)||jobs.has(index))continue;
        running++;
        const job={promise:null};jobs.set(index,job);
        job.promise=(async()=>{
          try {
            const result=await api.renderAsync(entry.frame,{enabled:true,prewarm:true,preserveShadow,cleanEdges,sheerMaterial,subjectMask:{data:masks.get(index),width,height},requireSubjectMask:true,sequenceProfile:profile,sequence,maskCanvas:canvas(width,height),rgbaCanvas:canvas(width,height)});
            if(!valid()||!result)return;
            // Store the algorithm's bytes before Canvas premultiplication. A
            // second put/get round trip can change faint colored edge pixels.
            const imageData=new ImageData(result.rawPixels,width,height);
            await cache.put(String(index),{width,height,imageData,screen:result.screen,materialStats:result.materialStats});
            if(!valid())return;
            completed++;firstReadyMs??=performance.now()-started;
            onPreview?.(index,result.rgbaCanvas);
          }catch(error){console.warn('Cutout prewarm skipped frame',index,String(error));}
          finally{running--;report();drain();}
        })();
      }
    }
    return {
      references,
      add(chunk){
        if(!valid()||chunk.width!==width||chunk.height!==height)return;
        const ids=chunk.decodedFrameIndices,bytes=chunk.alphaBytes;
        if(!Array.isArray(ids)||!ArrayBuffer.isView(bytes)||bytes.byteLength!==ids.length*width*height)return;
        for(let i=0;i<ids.length;i++){
          const index=ids[i];if(!frames.has(index)||masks.has(index))continue;
          masks.set(index,new Uint8ClampedArray(bytes.buffer,bytes.byteOffset+i*width*height,width*height));
        }
        report();drain();
      },
      commit(finalMasks){
        if(!valid())return false;
        for(const [index,mask] of masks)if(!same(mask,finalMasks.get(index))){stop();return false;}
        for(const [index,mask] of finalMasks)masks.set(index,mask);
        completedBeforeCommit=completed;committed=true;report();drain();return true;
      },
      async waitForPreview(index=preferredIndex){
        drain();
        const job=jobs.get(index);
        if(!job||!valid())return false;
        await job.promise;
        return valid()&&!!(await cache?.get(String(index)));
      },
      stop,
      stats(){return {received:masks.size,completed,running,firstReadyMs,committed,cache:cache?.stats()};}
    };
  }};
})(window);
