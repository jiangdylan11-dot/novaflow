const fs=require('fs'),path=require('path'),cp=require('child_process');
const root=path.resolve(__dirname,'../..'),sharp=require(path.join(root,'particle-editor-desktop/node_modules/sharp'));
const ffmpeg=require(path.join(root,'particle-editor-desktop/node_modules/ffmpeg-static'));
const scene=path.join(root,'logs/divinepower-matting-study/background-check/background-fit.png');
const clips=JSON.parse(fs.readFileSync(path.join(root,'logs/cutout-four-video-20260913/full-clips.json')));
async function run(args){await new Promise((resolve,reject)=>{const p=cp.spawn(ffmpeg,['-v','error','-y',...args],{windowsHide:true});let error='';p.stderr.on('data',d=>error+=d);p.on('exit',c=>c?reject(Error(error)):resolve());});}
(async()=>{
 const available=clips.filter(c=>fs.existsSync(path.join(__dirname,c.id,'report.json')));
 for(const c of available){
  const r=JSON.parse(fs.readFileSync(path.join(__dirname,c.id,'report.json'))),w=r.w,h=r.h,ow=w===h?480:406,oh=w===h?480:720;
  if(!fs.existsSync(path.join(__dirname,c.id+'-review.mp4'))){
   const filter=`[0:v]split[a][b];color=c=0xeeeeee:s=${w}x${h}:r=24[g];[g][a]overlay=shortest=1,scale=${ow}:${oh}[left];[1:v]scale=${w}:${h}[scene];[scene][b]overlay=shortest=1,scale=${ow}:${oh}[right];[left][right]hstack[v]`;
   await run(['-framerate','24','-i',path.join(__dirname,c.id,'frames/clean_%04d.png'),'-loop','1','-i',scene,'-filter_complex',filter,'-map','[v]','-frames:v',String(r.count),'-c:v','libx264','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',path.join(__dirname,c.id+'-review.mp4')]);
  }
 }
 const panels=[];
 for(const [j,f] of ['docs/cutout-key-parity-20260914/athena-packaged/frames/clean_0064.png','docs/cutout-independent-key-20260914/athena/frames/clean_0064.png'].entries())
  panels.push({input:await sharp(path.join(root,f)).flatten({background:'#808080'}).extract({left:430,top:1450,width:400,height:260}).png().toBuffer(),left:j*400,top:30});
 panels.push({input:Buffer.from('<svg width="800" height="30"><rect width="800" height="30" fill="white"/><text x="12" y="22" font-size="18">Previous package</text><text x="412" y="22" font-size="18">Independent color key</text></svg>'),left:0,top:0});
 await sharp({create:{width:800,height:290,channels:3,background:'#808080'}}).composite(panels).png().toFile(path.join(__dirname,'fabric-detail.png'));
 const cards=available.sort((a,b)=>a.id==='athena'?-1:b.id==='athena'?1:0).map(c=>`<section><h2>${c.label}</h2><video controls loop preload="metadata" src="${c.id}-review.mp4"></video><p>左：浅色背景　右：场景背景。<a href="${c.id}/frames/clean_0000.png">透明 PNG</a></p></section>`).join('');
 fs.writeFileSync(path.join(__dirname,'index.html'),`<!doctype html><meta charset="utf-8"><title>独立色键与薄纱稳定性验收</title><style>body{background:#eee;color:#222;font:16px system-ui;max-width:1180px;margin:24px auto;padding:0 12px}section{background:white;padding:18px;margin:20px 0;border-radius:12px}video,img{max-width:100%}video{max-height:740px}a{color:#087e68}button{padding:6px 14px}</style><h1>独立色键 · 薄纱稳定性</h1><p>结果来自程序实际「色键抠图」按钮与 PNG 导出。光效透明保留、保留投影均开启；模型调用次数为零。展示仅将原始透明 PNG 合成到背景，没有额外去色、修图或对视频做平滑。</p><section><h2>薄纱同帧对比</h2><p>左：上个安装包，色键入口调用 AI 的结果。右：本次独立色键结果。</p><video controls loop src="fabric-before-after.mp4"></video><p><button onclick="document.querySelectorAll('video').forEach(v=>v.playbackRate=.5)">半速检查</button> <button onclick="document.querySelectorAll('video').forEach(v=>v.playbackRate=1)">正常速度</button></p><img src="fabric-detail.png"></section>${cards}`);
 console.log('review ready:',available.map(c=>c.id).join(', '));
})().catch(e=>{console.error(e);process.exitCode=1;});
