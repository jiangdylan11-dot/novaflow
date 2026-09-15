// Package real renderer-exported frames and verify the encoded alpha round trip.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const sharp=require(path.join(root,'particle-editor-desktop/node_modules/sharp'));
const ffmpeg=require(path.join(root,'particle-editor-desktop/node_modules/ffmpeg-static'));
const ffprobe=require(path.join(root,'particle-editor-desktop/node_modules/ffprobe-static')).path;
const input=process.argv[2],out=path.resolve(process.argv[3]);
const frames=path.resolve(process.argv[4]||path.join(root,'logs/green-screen-video-final/frames'));
const run=(exe,args)=>{const r=spawnSync(exe,args,{maxBuffer:16*1024*1024});if(r.status!==0)throw Error(String(r.stderr));return r.stdout;};
const ff=args=>run(ffmpeg,['-v','error','-y',...args]);
(async()=>{
  fs.mkdirSync(out,{recursive:true});const sequence=path.join(out,'PNG序列');fs.mkdirSync(sequence,{recursive:true});
  const names=fs.readdirSync(frames).filter(x=>/^clean_\d{4}\.png$/.test(x)).sort();if(names.length!==73)throw Error('Expected 73 actual renderer frames');
  for(const name of names)fs.copyFileSync(path.join(frames,name),path.join(sequence,name));
  const pattern=path.join(sequence,'clean_%04d.png');
  const sources=['-framerate','24','-start_number','0','-i',pattern,'-i',input,'-map','0:v:0','-map','1:a:0?'];
  const webm=path.join(out,'clean-alpha.webm'),mov=path.join(out,'clean-alpha.mov');
  ff([...sources,'-c:v','libvpx-vp9','-pix_fmt','yuva420p','-auto-alt-ref','0','-metadata:s:v:0','alpha_mode=1','-lossless','1','-c:a','libopus','-t',String(73/24),webm]);
  ff([...sources,'-c:v','prores_ks','-profile:v','4','-pix_fmt','yuva444p10le','-alpha_bits','16','-c:a','aac','-t',String(73/24),mov]);
  const decoded=path.join(root,'logs/green-screen-encoded-roundtrip');fs.mkdirSync(decoded,{recursive:true});
  ff(['-c:v','libvpx-vp9','-i',webm,'-vsync','0','-start_number','0',path.join(decoded,'f_%04d.png')]);
  const previewFrames=path.join(root,'logs/green-screen-preview-frames');fs.mkdirSync(previewFrames,{recursive:true});
  let alphaError=0,alphaMaxError=0,pixelCount=0,softCount=0,maxCornerAlpha=0;
  const perFrame=[];
  for(let n=0;n<names.length;n++){
    const src=path.join(sequence,names[n]),dec=path.join(decoded,`f_${String(n).padStart(4,'0')}.png`);
    const{data,info}=await sharp(src).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const d=await sharp(dec).ensureAlpha().raw().toBuffer();let soft=0,visible=0,corner=0;
    for(let i=3;i<data.length;i+=4){const error=Math.abs(data[i]-d[i]);alphaError+=error;alphaMaxError=Math.max(alphaMaxError,error);pixelCount++;if(data[i]>0)visible++;if(data[i]>0&&data[i]<255)soft++;}
    for(let y=0;y<100;y++)for(let x=0;x<100;x++)corner=Math.max(corner,data[(y*info.width+x)*4+3]);
    if(!visible||!soft)throw Error(`Frame ${n} lost foreground/soft alpha`);softCount+=soft;maxCornerAlpha=Math.max(maxCornerAlpha,corner);perFrame.push({frame:n,visible,soft,corner});
    const gray=await sharp(dec).flatten({background:'#808080'}).png().toBuffer(),white=await sharp(dec).flatten({background:'#ffffff'}).png().toBuffer();
    await sharp({create:{width:info.width*2,height:info.height,channels:3,background:'#808080'}}).composite([{input:gray,left:0,top:0},{input:white,left:info.width,top:0}]).png().toFile(path.join(previewFrames,`p_${String(n).padStart(4,'0')}.png`));
  }
  ff(['-framerate','24','-i',path.join(previewFrames,'p_%04d.png'),'-i',input,'-map','0:v:0','-map','1:a:0?','-c:v','libx264','-crf','17','-pix_fmt','yuv420p','-c:a','aac','-t',String(73/24),'-movflags','+faststart',path.join(out,'灰底-白底验收预览.mp4')]);
  const preview=path.join(out,'灰底-白底对比.png');
  await sharp(path.join(previewFrames,'p_0015.png')).extract({left:0,top:160,width:1472,height:580}).png().toFile(preview);
  const probe=p=>JSON.parse(run(ffprobe,['-v','error','-show_streams','-show_format','-of','json',p]));
  const report={frameCount:names.length,fps:24,alphaMeanAbsoluteError:alphaError/pixelCount,alphaMaxError,softPixelCount:softCount,maxCornerAlpha,perFrame,webm:probe(webm),mov:probe(mov)};
  // FFmpeg's alpha range conversion can round by one 8-bit level, including
  // when the VP9 encoder itself uses lossless mode.
  if(alphaMaxError>1)throw Error(`Alpha round-trip exceeded one quantization level: ${alphaMaxError}`);
  fs.writeFileSync(path.join(out,'validation.json'),JSON.stringify(report,null,2));
  fs.writeFileSync(path.join(out,'验收说明.txt'),'本片共 73 帧，736×1280，24 fps。\r\nclean-alpha.mov：ProRes 4444，供 AE 合成；Alpha 按直通（无蒙版）解释。\r\nclean-alpha.webm：VP9 + Alpha，供支持透明 WebM 的播放器或应用。\r\n灰底-白底验收预览.mp4：从透明 WebM 重新解码后，分别叠加灰底、白底，方便观察黑边；此预览本身不透明。\r\nPNG序列：NovaFlow 真实抠图组件导出的完整序列。\r\n检查剑光亮起、收回和转动的全过程；角色的黑色嘴巴、紫色暗部正常保留。\r\n此方案针对本片的均匀绿幕，保留软透明度并去除背景颜色污染。\r\n');
  console.log(JSON.stringify({out,frameCount:73,alphaMeanAbsoluteError:report.alphaMeanAbsoluteError,softPixelCount:softCount,maxCornerAlpha}));
})().catch(e=>{console.error(e);process.exit(1);});
