const fs=require('node:fs'),path=require('node:path'),sharp=require('sharp');
function createCutoutMaskStream({jobId,sender,frames,duplicates,outDir,width,height}) {
  const aliases=new Map((duplicates||[]).map(p=>[p.duplicateName,p.sourceName]));
  const sent=new Set();let pending=null,stopped=false;
  async function pump(all=false) {
    if(pending){if(!all)return pending;await pending;}
    if(stopped)return;
    pending=(async()=>{
      do {
        const ready=frames.filter(f=>!sent.has(f.decodedFrameIndex)&&fs.existsSync(path.join(outDir,aliases.get(f.outputFilename)||f.outputFilename))).slice(0,4);
        if(!ready.length)return;
        const masks=[];
        for(const f of ready){const {data,info}=await sharp(path.join(outDir,aliases.get(f.outputFilename)||f.outputFilename)).ensureAlpha().extractChannel(3).raw().toBuffer({resolveWithObject:true});if(info.width!==width||info.height!==height||data.length!==width*height)throw Error('Partial alpha dimensions differ');masks.push(data);}
        if(stopped)return;
        sender.send('ai-seq-rembg-mask-chunk',{jobId,width,height,decodedFrameIndices:ready.map(f=>f.decodedFrameIndex),alphaBytes:new Uint8Array(Buffer.concat(masks))});
        for(const f of ready)sent.add(f.decodedFrameIndex);
      } while(all);
    })();
    try{await pending}finally{pending=null}
  }
  return {pump,stop(){stopped=true},get count(){return sent.size}};
}
module.exports={createCutoutMaskStream};
