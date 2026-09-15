const fs=require('fs'),path=require('path'),assert=require('assert/strict'),cp=require('child_process');
const sharp=require('../particle-editor-desktop/node_modules/sharp'),ff=require('../particle-editor-desktop/node_modules/ffmpeg-static');
const holder={exports:{}};new Function('module',fs.readFileSync(path.resolve(__dirname,'../particle-editor/ai-sequence-green-screen-matting.js'),'utf8'))(holder);
const {removeShadowAlpha}=holder.exports;
const root=path.resolve(__dirname,'..'),D=path.join(root,'logs/cutout-four-video-20260913'),E=path.join(root,'logs/shadow-toggle-20260913');
const clips=JSON.parse(fs.readFileSync(path.join(D,'full-clips.json'),'utf8'));
const fontSvg=(label,w,h)=>Buffer.from(`<svg width="${w}" height="${h}"><rect width="100%" height="100%" fill="#ececec"/><text x="14" y="24" font-size="20" font-family="Microsoft YaHei" fill="#171717">${label}</text></svg>`);
async function raw(p){return sharp(p).ensureAlpha().raw().toBuffer({resolveWithObject:true});}
(async()=>{
 fs.mkdirSync(E,{recursive:true});const records=[];
 const bgFile=path.join(root,'logs/divinepower-matting-study/background-check/background-fit.png');
 for(const c of clips){
  const bg=await sharp(bgFile).resize(c.width,c.height).removeAlpha().raw().toBuffer();
  const [x0,y0,x1,y1]=c.reviewCrop;const crop={left:x0,top:y0,width:x1-x0,height:y1-y0};
  const folder=path.join(E,'samples',c.id);fs.mkdirSync(folder,{recursive:true});
  for(let n=0;n<c.frames;n++){
   const name=`frame_${String(n).padStart(4,'0')}.png`;
   const [{data:source},{data:on},mask]=await Promise.all([raw(path.join(c.sourceDir,name)),raw(path.join(D,'edge-spill-v2/full',c.id,'frames',name)),sharp(path.join(c.maskDir,name)).extractChannel(3).raw().toBuffer()]);
   const alpha=new Uint8ClampedArray(c.width*c.height);for(let p=0;p<alpha.length;p++)alpha[p]=on[p*4+3];
   assert.equal(removeShadowAlpha({width:c.width,height:c.height,data:source},alpha,{preserveShadow:true}),alpha);
   const started=performance.now(),result=removeShadowAlpha({width:c.width,height:c.height,data:source},alpha,{preserveShadow:false,foregroundData:on,subjectMask:{width:c.width,height:c.height,data:mask}}),seconds=(performance.now()-started)/1000;
   const off=Buffer.from(on);let removed=0,protectedChanged=0,shadowBefore=0,shadowAfter=0;
   for(let p=0;p<alpha.length;p++){
    const i=p*4;off[i+3]=result[p];if(!result[p])off[i]=off[i+1]=off[i+2]=0;
    if(result[p]<alpha[p])removed++;if(mask[p]>=31&&result[p]!==alpha[p])protectedChanged++;
    if(mask[p]<4&&Math.max(on[i],on[i+1],on[i+2])<3){shadowBefore+=alpha[p];shadowAfter+=result[p];}
   }
   assert.equal(protectedChanged,0,`${c.id} ${n}: subject/fabric alpha changed`);
   records.push({id:c.id,frame:n,removed,protectedChanged,shadowBefore,shadowAfter,seconds});
   if(c.id==='gloweyes'||c.sampleFrames.includes(n)){
    const layers=[];
    for(let j=0;j<4;j++){
     const rgba=j%2?off:on,composite=Buffer.alloc(c.width*c.height*3);
     for(let p=0;p<alpha.length;p++){const a=rgba[p*4+3]/255;for(let k=0;k<3;k++)composite[p*3+k]=Math.round(rgba[p*4+k]*a+(j<2?235:bg[p*3+k])*(1-a));}
     const panel=await sharp(composite,{raw:{width:c.width,height:c.height,channels:3}}).extract(crop).resize(620,450,{fit:'contain',background:'#ececec'}).png().toBuffer();
     layers.push({input:fontSvg((j%2?'关闭投影':'保留投影')+(j<2?' · 浅色背景':' · 场景背景'),640,500),left:j%2*640,top:Math.floor(j/2)*500});
     layers.push({input:panel,left:j%2*640+10,top:Math.floor(j/2)*500+40});
    }
    const board=await sharp({create:{width:1280,height:1000,channels:3,background:'#ececec'}}).composite(layers).png().toBuffer();
    fs.writeFileSync(path.join(folder,name),board);
    if(c.id==='gloweyes'&&n===0){await sharp(off,{raw:{width:c.width,height:c.height,channels:4}}).png().toFile(path.join(E,'Gloweyes_关闭投影.png'));await sharp(on,{raw:{width:c.width,height:c.height,channels:4}}).png().toFile(path.join(E,'Gloweyes_保留投影.png'));}
   }
   if(n%24===0)console.log(c.id,n+1,'/',c.frames);
  }
 }
 const video=path.join(E,'Gloweyes_投影开关对比.mp4');const r=cp.spawnSync(ff,['-hide_banner','-loglevel','error','-y','-framerate','24','-i',path.join(E,'samples/gloweyes/frame_%04d.png'),'-c:v','libx264','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',video],{windowsHide:true});assert.equal(r.status,0,r.stderr?.toString());
 const summary=clips.map(c=>{const a=records.filter(r=>r.id===c.id);return{id:c.id,frames:a.length,removedPixels:a.reduce((s,r)=>s+r.removed,0),protectedAlphaChanges:a.reduce((s,r)=>s+r.protectedChanged,0),shadowAlphaRemaining:a.reduce((s,r)=>s+r.shadowAfter,0)/Math.max(1,a.reduce((s,r)=>s+r.shadowBefore,0)),meanSeconds:a.reduce((s,r)=>s+r.seconds,0)/a.length};});
 fs.writeFileSync(path.join(E,'real-video-metrics.json'),JSON.stringify({sameRulesAllClips:true,inputMatte:'Previously delivered edge-spill-v2 offline candidate; shadow operator is the actual JS runtime implementation.',summary,frames:records},null,2));console.log(JSON.stringify(summary));
})().catch(e=>{console.error(e);process.exit(1);});
