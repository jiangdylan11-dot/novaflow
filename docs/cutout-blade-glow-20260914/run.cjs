const fs=require('fs'),path=require('path'),cp=require('child_process');
const root=path.resolve(__dirname,'../..');
const outputRoot=process.env.NF_REVIEW_ROOT||__dirname;
const clips=JSON.parse(fs.readFileSync(path.join(root,'logs/cutout-four-video-20260913/full-clips.json')));
const points={athena:[600,1380],gloweyes:[500,1290],blue:[475,550],minimax:[400,540],scatter:[450,470]};
(async()=>{const results=[];for(const id of (process.argv.length>2?process.argv.slice(2):['blue','minimax','scatter','gloweyes','athena'])){
const clip=clips.find(c=>c.id===id),baseline=path.join(root,'docs/cutout-key-parity-20260914',id==='athena'?'athena-packaged':id);
const job=fs.readdirSync(path.join(baseline,'backend')).find(x=>x.startsWith('job-'));
const masks=path.join(root,'logs/cutout-unified-20260914',id+'-masks');fs.mkdirSync(masks,{recursive:true});
for(const f of fs.readdirSync(path.join(baseline,'backend',job,'frames_out')).filter(f=>/^f_\d+\.png$/.test(f)))fs.copyFileSync(path.join(baseline,'backend',job,'frames_out',f),path.join(masks,'frame_'+String(Number(f.match(/\d+/)[0])).padStart(4,'0')+'.png'));
const log=fs.openSync(path.join(outputRoot,id+'.log'),'w'),start=Date.now();console.log('START',id);
const code=await new Promise((resolve,reject)=>{const p=cp.spawn(require(path.join(root,'particle-editor-desktop/node_modules/electron')),[path.join(root,'particle-editor-desktop/tests/ai-sequence-green-screen-video-smoke.cjs'),'--bundle',path.join(outputRoot,'tested-bundle.js'),'--live-backend','--save-captured-frames','--input',clip.file,'--output',path.join(outputRoot,id),'--brush-x',String(points[id][0]),'--brush-y',String(points[id][1])],{cwd:root,windowsHide:true,stdio:['ignore',log,log]});p.on('error',reject);p.on('exit',resolve);});
fs.closeSync(log);results.push({clip:id,code,seconds:(Date.now()-start)/1000});fs.writeFileSync(path.join(outputRoot,'results.json'),JSON.stringify(results,null,2));console.log('END',id,code);if(code!==0)throw Error(id+' failed');
}})().catch(e=>{console.error(e);process.exitCode=1;});
