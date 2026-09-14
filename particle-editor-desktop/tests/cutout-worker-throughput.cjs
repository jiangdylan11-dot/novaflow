const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const {app,BrowserWindow}=require('electron'),sharp=require('sharp');
const root=path.resolve(__dirname,'../..'),arg=(key,value)=>{const i=process.argv.indexOf(key);return i<0?value:process.argv[i+1];};
const count=Number(arg('--workers','4')),out=path.resolve(arg('--output','logs/cutout-pipeline-20260914/workers-'+count));
app.setPath('userData',path.join(out,'profile'));
app.whenReady().then(async()=>{
 fs.mkdirSync(out,{recursive:true});
 const fixture=path.join(root,'docs/cutout-blade-glow-final-20260914/athena/backend/job-qt9Nlz');
 const input=[];for(let i=0;i<24;i++){const index=Math.round(i*116/23),name='f_'+String(index).padStart(6,'0')+'.png';const {data,info}=await sharp(path.join(fixture,'frames_in',name)).ensureAlpha().raw().toBuffer({resolveWithObject:true});const mask=await sharp(path.join(fixture,'frames_out',name)).ensureAlpha().extractChannel(3).raw().toBuffer();input.push({index,width:info.width,height:info.height,pixels:data.toString('base64'),mask:mask.toString('base64')});}
 let source=fs.readFileSync(path.join(root,'particle-editor/ai-sequence-green-screen-matting.js'),'utf8');
 const anchor='Math.min(8,Math.floor(cores/4),Math.floor(1024*1024*1024/Math.max(1,width*height*64)))';assert(source.includes(anchor));
 source=source.replace(anchor,`Math.min(${count},Math.floor(cores/2),Math.floor(1024*1024*1024/Math.max(1,width*height*64)))`);
 fs.writeFileSync(path.join(out,'ai-sequence-green-screen-matting.js'),source);fs.copyFileSync(path.join(root,'particle-editor/ai-sequence-matting-worker.js'),path.join(out,'ai-sequence-matting-worker.js'));
 const html=path.join(out,'test.html');fs.writeFileSync(html,'<!doctype html><script src="ai-sequence-green-screen-matting.js"></script>');
 const win=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});await win.loadFile(html);
 const report=await win.webContents.executeJavaScript(`(async()=>{
 const decode=s=>Uint8ClampedArray.from(atob(s),c=>c.charCodeAt(0)),api=NovaFlowGreenScreenMatting;
 const input=${JSON.stringify(input)}.map(f=>({...f,data:decode(f.pixels),alpha:decode(f.mask)}));
 const frames=new Map(input.map(f=>[f.index,{frame:f}])),masks=new Map(input.map(f=>[f.index,f.alpha]));
 const sequence={frames,masks,maskWidth:input[0].width,maskHeight:input[0].height};
 const canvas=f=>{const c=document.createElement('canvas');c.width=f.width;c.height=f.height;return c;};
 const hashes=[],started=performance.now();
 for(let offset=0;offset<input.length;offset+=${count}){
   const results=await Promise.all(input.slice(offset,offset+${count}).map(f=>api.renderAsync(f,{enabled:true,preserveShadow:false,requireSubjectMask:true,subjectMask:{data:f.alpha,width:f.width,height:f.height},sequence,maskCanvas:canvas(f),rgbaCanvas:canvas(f)})));
   for(const result of results){const data=result.rgbaCanvas.getContext('2d').getImageData(0,0,result.rgbaCanvas.width,result.rgbaCanvas.height).data;hashes.push([...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(v=>v.toString(16).padStart(2,'0')).join(''));}
 }
 return {workers:${count},frames:input.length,ms:performance.now()-started,hashes,stats:api.workerStats()};
 })()`);
 assert.equal(report.stats.failed,0);report.electronVersion=process.versions.electron;fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({workers:count,ms:report.ms,stats:report.stats}));win.destroy();app.quit();
}).catch(error=>{console.error(error);app.exit(1)});
