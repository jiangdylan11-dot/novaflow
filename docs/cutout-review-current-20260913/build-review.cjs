const fs=require('fs'),path=require('path'),cp=require('child_process'),assert=require('assert/strict');
const root=path.resolve(__dirname,'../..'),sharp=require(path.join(root,'particle-editor-desktop/node_modules/sharp'));
const ffmpeg=require(path.join(root,'particle-editor-desktop/node_modules/ffmpeg-static'));
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'render-manifest.json'))),clips=manifest.clips;
const userDir='C:/Users/jiang/OneDrive/Desktop/新建文件夹/NovaFlow';
const label=(width,text)=>Buffer.from(`<svg width="${width}" height="36"><rect width="100%" height="100%" fill="#24272d"/><text x="14" y="25" fill="#fff" font-family="Microsoft YaHei,Arial" font-size="18">${text}</text></svg>`);
const png=async file=>await sharp(file).ensureAlpha().png().toBuffer();
const cropFor=c=>({left:c.reviewCrop[0],top:c.reviewCrop[1],width:c.reviewCrop[2]-c.reviewCrop[0],height:c.reviewCrop[3]-c.reviewCrop[1]});
const tile=async(input,c,bg='#fff',width=512,height=540)=>await sharp(input).flatten({background:bg}).extract(cropFor(c)).resize(width,height,{fit:'contain',background:bg}).png().toBuffer();
async function encode(dir,out,w,h){
 const r=cp.spawnSync(ffmpeg,['-y','-hide_banner','-loglevel','error','-framerate','24','-i',path.join(dir,'%04d.png'),'-c:v','libx264','-crf','16','-pix_fmt','yuv420p','-movflags','+faststart',out],{windowsHide:true,encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);
}
async function main(){
 const summary=[];
 for(const c of clips){
  const report=JSON.parse(fs.readFileSync(path.join(__dirname,c.id,'report.json')));
  assert.equal(report.writes.filter(f=>f.endsWith('.png')).length,c.frames);
  assert.equal(report.errors.length,0);
  const framesDir=path.join(__dirname,c.id,'review-frames');fs.mkdirSync(framesDir,{recursive:true});
  const background=fs.existsSync(path.join(userDir,'images/bg.png'))?path.join(userDir,'images/bg.png'):path.join(root,'logs/divinepower-matting-study/background-check/background-fit.png');
  const scene=await sharp(background).resize(c.width,c.height,{fit:'cover'}).png().toBuffer();
  const headers=['原视频 · 区域放大','当前结果 · 白底','当前结果 · 黑底','当前结果 · 场景背景'].map(t=>label(512,t));
  const compareDir=path.join(__dirname,'scatter-compare-frames');if(c.id==='scatter')fs.mkdirSync(compareDir,{recursive:true});
  for(let n=0;n<c.frames;n++){
   const padded=String(n).padStart(4,'0');
   const original=await png(path.join(c.sourceDir,`frame_${padded}.png`));
   const result=await png(path.join(__dirname,c.id,'frames',`clean_${padded}.png`));
   const composite=await sharp(scene).composite([{input:result}]).png().toBuffer();
   const inputs=await Promise.all([tile(original,c,'#000'),tile(result,c,'#fff'),tile(result,c,'#000'),tile(composite,c,'#111')]);
   const items=[];for(let j=0;j<4;j++){const left=j%2*512,top=Math.floor(j/2)*576;items.push({input:headers[j],left,top},{input:inputs[j],left,top:top+36});}
   const grid=await sharp({create:{width:1024,height:1152,channels:3,background:'#111'}}).composite(items).png({compressionLevel:1}).toBuffer();
   fs.writeFileSync(path.join(framesDir,padded+'.png'),grid);
   if(n===(c.id==='gloweyes'?53:c.id==='scatter'?54:c.sampleFrames[2]))fs.writeFileSync(path.join(__dirname,c.id+'-current.png'),grid);
   if(c.id==='scatter'){
    const old=await png(path.join(userDir,`a_${padded}.png`));
    const pair=await sharp({create:{width:1200,height:540,channels:3,background:'#fff'}}).composite([
     {input:label(600,`你的导出 · a_${padded}.png`),left:0,top:0},{input:label(600,`当前 AI 抠图 · 同帧`),left:600,top:0},
     {input:await tile(old,c,'#fff',600,504),left:0,top:36},{input:await tile(result,c,'#fff',600,504),left:600,top:36}
    ]).png({compressionLevel:1}).toBuffer();
    fs.writeFileSync(path.join(compareDir,padded+'.png'),pair);
    if(n===54)fs.writeFileSync(path.join(__dirname,'黑底碎边_同帧对比.png'),pair);
   }
  }
  await encode(framesDir,path.join(__dirname,c.id+'-review.mp4'));
  if(c.id==='scatter')await encode(compareDir,path.join(__dirname,'黑底碎边_完整对比.mp4'));
  summary.push({id:c.id,frames:c.frames,fps:24,review:c.id+'-review.mp4',pngFolder:c.id+'/frames',previewCrop:c.reviewCrop});
  console.log('REVIEW',c.id,c.frames);
 }
 fs.writeFileSync(path.join(__dirname,'review-summary.json'),JSON.stringify(summary,null,2));
}
main().catch(e=>{console.error(e);process.exit(1)});
