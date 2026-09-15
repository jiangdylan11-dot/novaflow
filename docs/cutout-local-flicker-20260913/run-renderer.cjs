const fs=require('fs'),path=require('path'),cp=require('child_process'),crypto=require('crypto');
const root=path.resolve(__dirname,'../..');
const clips=JSON.parse(fs.readFileSync(path.join(root,'logs/cutout-four-video-20260913/full-clips.json')));
const points={athena:[600,1380],gloweyes:[500,1290],blue:[475,550],minimax:[400,540],scatter:[450,470]};
const requested=process.argv.slice(2),queue=clips.filter(c=>!requested.length||requested.includes(c.id)).sort((a,b)=>['gloweyes','athena','blue','minimax','scatter'].indexOf(a.id)-['gloweyes','athena','blue','minimax','scatter'].indexOf(b.id));
const resultPath=path.join(__dirname,'renderer-results.json');
const results=fs.existsSync(resultPath)?JSON.parse(fs.readFileSync(resultPath)).filter(r=>!queue.some(c=>c.id===r.clip)):[];
const mattingSource=fs.readFileSync(path.join(root,'particle-editor/ai-sequence-green-screen-matting.js'));
const mattingSha256=crypto.createHash('sha256').update(mattingSource).digest('hex');
const snapshot=path.join(__dirname,'matting-'+mattingSha256.slice(0,12)+'.js');fs.writeFileSync(snapshot,mattingSource);
const manifest={mattingSha256,clips:[...clips],note:'Actual React PNG export; cached real AI masks matched to submitted RGB. No image retouching of exports.'};
fs.writeFileSync(path.join(__dirname,'manifest.json'),JSON.stringify(manifest,null,2));
async function worker(){while(queue.length){const clip=queue.shift(),out=path.join(__dirname,clip.id),log=fs.openSync(path.join(__dirname,clip.id+'.log'),'w');
 console.log('START',clip.id);const start=Date.now();
 const args=[path.join(root,'particle-editor-desktop/tests/ai-sequence-green-screen-video-smoke.cjs'),'--input',clip.file,'--output',out,'--matting',snapshot,'--ai-masks',clip.maskDir,'--ai-mask-source-frames',clip.sourceDir,'--save-captured-frames','--brush-x',String(points[clip.id][0]),'--brush-y',String(points[clip.id][1])];
 const code=await new Promise((resolve,reject)=>{const child=cp.spawn(path.join(root,'particle-editor-desktop/node_modules/electron/dist/electron.exe'),args,{cwd:root,windowsHide:true,stdio:['ignore',log,log]});child.on('error',reject);child.on('exit',resolve);});
 fs.closeSync(log);results.push({clip:clip.id,code,seconds:(Date.now()-start)/1000});console.log('END',clip.id,code,results.at(-1).seconds);fs.writeFileSync(path.join(__dirname,'renderer-results.json'),JSON.stringify(results,null,2));
}}
Promise.allSettled([worker(),worker()]).then(r=>{for(const x of r)if(x.status==='rejected'){console.error(x.reason);process.exitCode=1;}if(results.some(x=>x.code!==0))process.exitCode=1;});
