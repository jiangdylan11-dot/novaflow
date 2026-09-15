const fs=require('fs'),path=require('path'),cp=require('child_process');
const root=path.resolve(__dirname,'../..');
const clips=JSON.parse(fs.readFileSync(path.join(root,'logs/cutout-four-video-20260913/full-clips.json')));
const requested=process.argv.slice(2),points={athena:[600,1380],gloweyes:[500,1290],blue:[475,550],minimax:[400,540],scatter:[450,470]};
(async()=>{const results=[];for(const clip of clips.filter(c=>requested.includes(c.id))){
 const log=fs.openSync(path.join(__dirname,clip.id+'.log'),'w'),start=Date.now();console.log('START',clip.id);
 const code=await new Promise((resolve,reject)=>{const p=cp.spawn(path.join(root,'particle-editor-desktop/node_modules/electron/dist/electron.exe'),[path.join(root,'particle-editor-desktop/tests/ai-sequence-green-screen-video-smoke.cjs'),'--mode','key','--live-backend','--save-captured-frames','--input',clip.file,'--output',path.join(__dirname,clip.id),'--brush-x',String(points[clip.id][0]),'--brush-y',String(points[clip.id][1])],{cwd:root,windowsHide:true,stdio:['ignore',log,log]});p.on('error',reject);p.on('exit',resolve);});
 fs.closeSync(log);results.push({clip:clip.id,code,seconds:(Date.now()-start)/1000});fs.writeFileSync(path.join(__dirname,'live-results.json'),JSON.stringify(results,null,2));console.log('END',clip.id,code);if(code!==0)throw Error(clip.id+' failed');
}})().catch(e=>{console.error(e);process.exitCode=1;});
