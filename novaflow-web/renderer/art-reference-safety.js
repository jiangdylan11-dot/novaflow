const cache = new Map();
export async function protectedFaceRegions(dataUrl) {
  if (cache.has(dataUrl)) return cache.get(dataUrl);
  const blob = await (await fetch(dataUrl)).blob();
  let image = await createImageBitmap(blob);
  if (Math.max(image.width,image.height)>1536) {
    const scale=1536/Math.max(image.width,image.height),small=await createImageBitmap(image,{resizeWidth:Math.round(image.width*scale),resizeHeight:Math.round(image.height*scale)});
    image.close();image=small;
  }
  const worker = new Worker(new URL('./art-reference-safety.worker.js',import.meta.url));
  try {
    const boxes = await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('风格参考人脸隔离超时，请重试')),30000);
      worker.onmessage=({data})=>{clearTimeout(timer);data.error?reject(new Error('风格参考人脸隔离失败：'+data.error)):resolve(data.boxes);};
      worker.onerror=()=>{clearTimeout(timer);reject(new Error('风格参考处理组件无法启动，请刷新后重试'));};
      worker.postMessage({id:1,image},[image]);
    });
    cache.set(dataUrl,boxes);if(cache.size>8)cache.delete(cache.keys().next().value);
    return boxes;
  } finally {worker.terminate();}
}
