// Reuse the application's bundled BiRefNet weights. Release the GPU session
// before drawing starts; auxiliary foreground pixels never reach generation.
const asset=file=>new URL('./vendor/'+file,import.meta.url).href;
async function weights() {
  const url=asset('matting/model.bin'),key=url+'?v=2';let cache;
  try {cache=await caches.open('novaflow-models');const hit=await cache.match(key);if(hit)return new Uint8Array(await hit.arrayBuffer());}catch{}
  const manifest=await fetch(url+'.parts.json');let bytes;
  if(manifest.ok){
    const data=await manifest.json();
    if(!Array.isArray(data.parts)||!data.parts.length||data.parts.some(name=>!/^model\.bin\.part\d+$/.test(name)))throw new Error('前景识别模型清单无效');
    const parts=await Promise.all(data.parts.map(async name=>{const r=await fetch(new URL(name,url));if(!r.ok)throw new Error('前景识别模型未完整载入');return new Uint8Array(await r.arrayBuffer());}));
    bytes=new Uint8Array(parts.reduce((sum,p)=>sum+p.length,0));if(bytes.length!==data.bytes)throw new Error('前景识别模型不完整');
    let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  }else{const r=await fetch(url);if(!r.ok)throw new Error('前景识别模型未载入');bytes=new Uint8Array(await r.arrayBuffer());}
  try {await cache?.put(key,new Response(bytes));}catch{}return bytes;
}
export async function backgroundForegroundMask(dataUrl) {
  if(!await navigator.gpu?.requestAdapter())throw new Error('背景前景隔离需要支持 WebGPU 的 Chrome 或 Edge，请更换浏览器；本次未使用未隔离的原图');
  const ort=await import(asset('onnxruntime-web/ort.webgpu.min.mjs'));
  ort.env.wasm.wasmPaths=asset('onnxruntime-web/');ort.env.wasm.numThreads=1;
  let session,bitmap,tensor,output;
  try {
    session=await ort.InferenceSession.create(await weights(),{executionProviders:['webgpu'],graphOptimizationLevel:'all'});
    bitmap=await createImageBitmap(await (await fetch(dataUrl)).blob());
    if(Math.max(bitmap.width,bitmap.height)>1536){const scale=1536/Math.max(bitmap.width,bitmap.height),small=await createImageBitmap(bitmap,{resizeWidth:Math.round(bitmap.width*scale),resizeHeight:Math.round(bitmap.height*scale)});bitmap.close();bitmap=small;}
    const size=1024,area=size*size,c=new OffscreenCanvas(size,size),ctx=c.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(bitmap,0,0,size,size);const pixels=ctx.getImageData(0,0,size,size).data,input=new Float32Array(3*area),mean=[.485,.456,.406],std=[.229,.224,.225];
    for(let p=0;p<area;p++)for(let channel=0;channel<3;channel++)input[channel*area+p]=(pixels[p*4+channel]/255-mean[channel])/std[channel];
    tensor=new ort.Tensor('float32',input,[1,3,size,size]);output=await session.run({input:tensor});
    const mask=await output.mask.getData(),width=bitmap.width,height=bitmap.height,alpha=new Uint8Array(width*height);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const sx=Math.min(size-1,Math.floor(x*size/width)),sy=Math.min(size-1,Math.floor(y*size/height));
      // Include faint borders and a small outward margin so hair/props cannot
      // survive as recognizable fragments in a background reference.
      let keep=false;for(let dy=-2;dy<=2&&!keep;dy++)for(let dx=-2;dx<=2;dx++){if(mask[Math.max(0,Math.min(size-1,sy+dy))*size+Math.max(0,Math.min(size-1,sx+dx))]>.08){keep=true;break;}}
      if(keep)alpha[y*width+x]=255;
    }
    return {width,height,alpha};
  }finally{bitmap?.close();tensor?.dispose();for(const value of Object.values(output||{}))value.dispose?.();await session?.release();}
}
