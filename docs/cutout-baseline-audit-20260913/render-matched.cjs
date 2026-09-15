const fs=require('fs'),path=require('path'),cp=require('child_process'),assert=require('assert/strict');
const root=path.resolve(__dirname,'../..'),sharp=require(path.join(root,'particle-editor-desktop/node_modules/sharp'));
const ffmpeg=require(path.join(root,'particle-editor-desktop/node_modules/ffmpeg-static'));
const title=t=>Buffer.from(`<svg width="660" height="40"><rect width="100%" height="100%" fill="#eee"/><text x="12" y="28" font-family="Microsoft YaHei" font-size="20">${t}</text></svg>`);
(async()=>{
 const dir=path.join(__dirname,'scatter-pairs');fs.mkdirSync(dir,{recursive:true});
 const crop={left:70,top:220,width:820,height:520};
 for(let n=0;n<73;n++){
  const name=`clean_${String(n).padStart(4,'0')}.png`,panels=[];
  const files=[path.join(root,'docs/cutout-review-current-20260913/scatter/frames',name),path.join(__dirname,'matched/frames',name)];
  for(let j=0;j<2;j++)panels.push({input:await sharp(files[j]).flatten({background:'#fff'}).extract(crop).resize(660,420,{fit:'fill'}).png().toBuffer(),left:j*660,top:40});
  const out=await sharp({create:{width:1320,height:460,channels:3,background:'#fff'}}).composite([{input:title(`上次测试：遮罩错配 · ${n}`),left:0,top:0},{input:title(`本次测试：按实际画面匹配 · ${n}`),left:660,top:0},...panels]).png().toBuffer();
  fs.writeFileSync(path.join(dir,String(n).padStart(4,'0')+'.png'),out);
  if([11,19,32,34,37,54].includes(n))fs.writeFileSync(path.join(__dirname,`scatter-matched-${n}.png`),out);
 }
 const r=cp.spawnSync(ffmpeg,['-y','-hide_banner','-loglevel','error','-framerate','24','-i',path.join(dir,'%04d.png'),'-c:v','libx264','-crf','16','-pix_fmt','yuv420p','-movflags','+faststart',path.join(__dirname,'Scatter_遮罩错配校正_对比.mp4')],{windowsHide:true,encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 console.log('Rendered all 73 actual React exports. Production matting algorithm unchanged.');
})().catch(e=>{console.error(e);process.exit(1)});
