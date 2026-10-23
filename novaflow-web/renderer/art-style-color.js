// Optional color evidence from a detected face. The complete reference remains
// the generation input; no face patch or sampling board is made or uploaded.
export function skinMidtone(data) {
  const pixels=[];
  for(let i=0;i<data.length;i+=4){
    const r=data[i],g=data[i+1],b=data[i+2],maximum=Math.max(r,g,b),s=(maximum-Math.min(r,g,b))/maximum;
    // Separate supported peach/rose skin colors from gold hair, white surfaces,
    // dark linework and makeup. Unsupported colors are not lightened or guessed.
    if(data[i+3]>=128&&r>g+15&&r>b+15&&g>=b-8&&g-b<45&&r-g>.9*Math.max(5,g-b)&&r>140&&s<.55)pixels.push([r,g,b,.2126*r+.7152*g+.0722*b]);
  }
  const fraction=pixels.length/(data.length/4);
  if(pixels.length<100||fraction<.2)return undefined;
  pixels.sort((a,b)=>a[3]-b[3]);const middle=pixels.slice(Math.floor(pixels.length*.25),Math.ceil(pixels.length*.75));
  const rgb=[0,1,2].map(k=>Math.round(middle.reduce((sum,p)=>sum+p[k],0)/middle.length));
  const [r,g,b]=rgb,value=(.2126*r+.7152*g+.0722*b)/255,saturation=(Math.max(...rgb)-Math.min(...rgb))/Math.max(...rgb);
  const hue=g-b<10?'粉':g-b<28?'桃粉':'米';
  const description=`${value>.7?'明亮':value>.5?'中明度':'偏暗'}${saturation<.3?'低饱和':'中等饱和'}${hue}色肤色中间调`;
  return {rgb,fraction,pixels:pixels.length,value,saturation,hue,description};
}

function overlap(a,b){
  const intersection=Math.max(0,Math.min(a[2],b[2])-Math.max(a[0],b[0]))*Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1]));
  return intersection/Math.min((a[2]-a[0])*(a[3]-a[1]),(b[2]-b[0])*(b[3]-b[1]));
}

export function coherentSkinProfile(samples){
  const groups=[];
  for(const sample of samples.filter(s=>s?.profile)){
    const group=groups.find(g=>g.some(s=>overlap(s.box,sample.box)>.35));
    if(group)group.push(sample);else groups.push([sample]);
  }
  // Several distinct faces may intentionally have different palettes.
  if(groups.length!==1)return undefined;
  return groups[0].sort((a,b)=>b.profile.fraction-a.profile.fraction)[0].profile;
}

export async function observeStyleSkin(dataUrl){
  const {protectedFaceRegions}=await import('./art-reference-safety.js');
  const boxes=await protectedFaceRegions(dataUrl);if(!boxes.length)return undefined;
  const img=new Image();img.src=dataUrl;await img.decode();
  const ratio=Math.min(1,1536/Math.max(img.naturalWidth,img.naturalHeight)),c=document.createElement('canvas');
  c.width=Math.round(img.naturalWidth*ratio);c.height=Math.round(img.naturalHeight*ratio);const ctx=c.getContext('2d');ctx.drawImage(img,0,0,c.width,c.height);
  try{
    const samples=boxes.map(box=>{
      const [x1,y1,x2,y2]=box.map((v,i)=>v/1000*(i%2?c.height:c.width));
      const x=Math.max(0,Math.round(x1+(x2-x1)*.25)),y=Math.max(0,Math.round(y1+(y2-y1)*.4));
      const width=Math.min(c.width-x,Math.max(1,Math.round((x2-x1)*.5))),height=Math.min(c.height-y,Math.max(1,Math.round((y2-y1)*.45)));
      return {box,profile:width>0&&height>0?skinMidtone(ctx.getImageData(x,y,width,height).data):undefined};
    });
    return coherentSkinProfile(samples);
  }finally{c.width=c.height=1;img.src='';}
}
