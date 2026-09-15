const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const sharp=require('../particle-editor-desktop/node_modules/sharp');
const ffmpeg=require('../particle-editor-desktop/node_modules/ffmpeg-static');
const root=path.resolve(__dirname,'..');
const out=path.resolve(process.argv[2]);fs.mkdirSync(out,{recursive:true});
const bgPath=process.argv[3];
const oldDir=path.join(root,'logs/green-screen-video-final/frames');
const newDir=path.join(root,'logs/green-screen-soft-edge-final/frames');
const previewDir=path.join(root,'logs/vfx-bright-scene-frames');fs.mkdirSync(previewDir,{recursive:true});
const w=736,h=1280;
(async()=>{
  const bg=await sharp(bgPath).resize(w,h,{fit:'cover'}).removeAlpha().raw().toBuffer();
  let maxBlackDelta=0,blackDelta=0,channels=0,bodyOpaqueRegressions=0;
  const perFrame=[];
  for(let n=0;n<73;n++){
    const name=`clean_${String(n).padStart(4,'0')}.png`;
    const old=await sharp(path.join(oldDir,name)).ensureAlpha().raw().toBuffer();
    const fresh=await sharp(path.join(newDir,name)).ensureAlpha().raw().toBuffer();
    const before=Buffer.alloc(w*h*3),after=Buffer.alloc(w*h*3);
    let softened=0;
    for(let p=0,i=0;p<w*h;p++,i+=4){
      const a0=old[i+3]/255,a1=fresh[i+3]/255;
      if(a0>.85&&a1<a0-.1)softened++;
      const x=p%w,y=Math.floor(p/w);
      if(x>=80&&x<480&&y>=420&&y<650&&old[i+3]===255&&fresh[i+3]<250)bodyOpaqueRegressions++;
      for(let c=0;c<3;c++){
        const black0=old[i+c]*a0,black1=fresh[i+c]*a1,d=Math.abs(black1-black0);
        blackDelta+=d;maxBlackDelta=Math.max(maxBlackDelta,d);channels++;
        before[p*3+c]=Math.round(black0+bg[p*3+c]*(1-a0));
        after[p*3+c]=Math.round(black1+bg[p*3+c]*(1-a1));
      }
    }
    perFrame.push({frame:n,softenedDensePixels:softened});
    const crop={left:0,top:140,width:w,height:600};
    const a=await sharp(before,{raw:{width:w,height:h,channels:3}}).extract(crop).png().toBuffer();
    const b=await sharp(after,{raw:{width:w,height:h,channels:3}}).extract(crop).png().toBuffer();
    const frame=path.join(previewDir,`p_${String(n).padStart(4,'0')}.png`);
    await sharp({create:{width:w*2,height:600,channels:3,background:'#fff'}}).composite([{input:a,left:0,top:0},{input:b,left:w,top:0}]).png().toFile(frame);
    if(n===24)fs.copyFileSync(frame,path.join(out,'亮背景-旧版与修复版.png'));
  }
  const video=path.join(out,'亮背景-旧版与修复版.mp4');
  const r=spawnSync(ffmpeg,['-v','error','-y','-framerate','24','-i',path.join(previewDir,'p_%04d.png'),'-c:v','libx264','-crf','17','-pix_fmt','yuv420p','-movflags','+faststart',video],{maxBuffer:4*1024*1024});
  assert.equal(r.status,0,String(r.stderr));assert.equal(bodyOpaqueRegressions,0,'character core must not acquire transparency');
  // Compare premultiplied color contribution, which isolates the intended
  // alpha correction from color/shape damage on the already acceptable black.
  assert(blackDelta/channels<.2,'black-background appearance changed materially');
  const report={frames:73,background:bgPath,layout:'left=previous; right=soft-edge fix',blackMeanAbsoluteDelta:blackDelta/channels,maxBlackDelta,bodyOpaqueRegressions,perFrame};
  fs.writeFileSync(path.join(out,'bright-background-validation.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({...report,perFrame:undefined}));
})().catch(e=>{console.error(e);process.exit(1);});
