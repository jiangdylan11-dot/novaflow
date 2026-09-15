const fs=require('fs'),path=require('path'),cp=require('child_process');
const root=path.resolve(__dirname,'../..'),sharp=require(path.join(root,'particle-editor-desktop/node_modules/sharp'));
const ffmpeg=require(path.join(root,'particle-editor-desktop/node_modules/ffmpeg-static'));
const scene=path.join(root,'logs/divinepower-matting-study/background-check/background-fit.png');
const athenaFolder=fs.existsSync(path.join(__dirname,'athena-packaged/report.json'))?'athena-packaged':'athena';
const clips=JSON.parse(fs.readFileSync(path.join(root,'logs/cutout-four-video-20260913/full-clips.json')));
(async()=>{
 for(const clip of clips.filter(c=>process.argv.slice(2).includes(c.id))){
  const dir=path.join(__dirname,clip.id==='athena'?athenaFolder:clip.id),report=JSON.parse(fs.readFileSync(path.join(dir,'report.json'))),w=report.w,h=report.h;
  const outputWidth=w===h?480:406,outputHeight=w===h?480:720;
  const filter=`[0:v]split=2[a][b];color=c=0x808080:s=${w}x${h}:r=24[g];[g][a]overlay=shortest=1,scale=${outputWidth}:${outputHeight}[left];[1:v]scale=${w}:${h}[scene];[scene][b]overlay=shortest=1,scale=${outputWidth}:${outputHeight}[right];[left][right]hstack[v]`;
  await new Promise((resolve,reject)=>{const p=cp.spawn(ffmpeg,['-v','error','-y','-framerate','24','-i',path.join(dir,'frames/clean_%04d.png'),'-loop','1','-i',scene,'-filter_complex',filter,'-map','[v]','-frames:v',String(report.count),'-c:v','libx264','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',path.join(__dirname,clip.id+'-review.mp4')],{windowsHide:true});let stderr='';p.stderr.on('data',d=>stderr+=d);p.on('exit',c=>c===0?resolve():reject(Error(stderr)));});
  console.log('review',clip.id);
 }
 const m=JSON.parse(fs.readFileSync(path.join(__dirname,'user-frame-matches.json')))[0],index=m.source.match(/\d+/)[0],panels=[];
 for(const [i,file]of ['C:/Users/jiang/OneDrive/Desktop/新建文件夹 (2)/NovaFlow/'+m.user,path.join(__dirname,athenaFolder,'frames/clean_'+index+'.png')].entries())panels.push({input:await sharp(file).flatten({background:'#808080'}).extract({left:110,top:870,width:970,height:920}).resize(485,460).png().toBuffer(),left:485*i,top:34});
 panels.push({input:Buffer.from('<svg width="970" height="34"><rect width="970" height="34" fill="white"/><text x="14" y="24" font-size="20">Your PNG export</text><text x="499" y="24" font-size="20">Fixed color key - actual model / PNG export</text></svg>'),left:0,top:0});
 await sharp({create:{width:970,height:494,channels:3,background:'#808080'}}).composite(panels).png().toFile(path.join(__dirname,'comparison-detail.png'));
 const cards=clips.map(c=>`<section><h2>${c.id}</h2><video controls preload="metadata" src="${c.id}-review.mp4"></video><p>左：灰底　右：场景背景。<a href="${c.id==='athena'?athenaFolder:c.id}/frames/clean_0000.png">查看透明 PNG</a></p></section>`).join('');
 fs.writeFileSync(path.join(__dirname,'index.html'),`<!doctype html><meta charset="utf-8"><title>色键入口实际导出验收</title><style>body{background:#eee;color:#222;font:16px system-ui;margin:24px auto;max-width:1100px}section{background:white;padding:16px;margin:20px 0;border-radius:12px}video,img{max-width:100%;max-height:740px}a{color:#087e68}</style><h1>色键抠图 · 实际导出验收</h1><p>点击色键按钮，开启光效透明保留与保留投影。调用本机 RMBG-2.0 模型和程序实际 IPC、PNG 导出流程。展示视频由导出的透明 PNG 直接合成，没有额外去色或修图。</p><p>对比图左侧是你提供的序列帧，右侧是修复后按主体姿势匹配的帧；并非逐帧时间完全相同。</p><img src="comparison-detail.png">${cards}`);
})().catch(e=>{console.error(e);process.exitCode=1;});
