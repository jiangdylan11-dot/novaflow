// Validate the production background node against an existing H3 decode.
// No new model sampling, prompt rewrite, or foreground artwork replacement.
import fs from 'node:fs';
import path from 'node:path';
const input='C:/ProgramData/NovaFlow/AI-Runtime-H3/generated/input';
const output='C:/ProgramData/NovaFlow/AI-Runtime-H3/generated/output';
const from=path.resolve(process.argv[2]);
const out=path.resolve(process.argv[3]);
const old=JSON.parse(fs.readFileSync(path.join(from,'workflow.json'),'utf8'));
const history=JSON.parse(fs.readFileSync(path.join(from,'history.json'),'utf8'));
const source=Object.values(old).find(n=>n.class_type==='LoadVideo').inputs.file;
const media=Object.values(history.outputs).flatMap(n=>Object.values(n).flat()).find(v=>v?.filename?.endsWith('.mp4'));
const file='novaflow_background_probe_'+media.filename;
fs.copyFileSync(path.join(output,media.subfolder||'',media.filename),path.join(input,file));
const graph={
  1:{class_type:'LoadVideo',inputs:{file:source}},
  2:{class_type:'GetVideoComponents',inputs:{video:['1',0]}},
  3:{class_type:'NovaFlowH3ReferenceVideoFrames',inputs:{images:['2',0],source_fps:['2',2]}},
  4:{class_type:'LoadVideo',inputs:{file}},
  5:{class_type:'GetVideoComponents',inputs:{video:['4',0]}},
  6:{class_type:'NovaFlowH3RestoreReferenceBackground',inputs:{images:['5',0],reference_video:['3',0]}},
  7:{class_type:'CreateVideo',inputs:{images:['6',0],audio:['5',1],fps:['5',2],bit_depth:8}},
  8:{class_type:'SaveVideo',inputs:{video:['7',0],filename_prefix:'video/NovaFlow_H3_background_probe',format:'auto',codec:'auto'}},
};
const api=async(route,body)=>{const r=await fetch('http://127.0.0.1:8189'+route,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});if(!r.ok)throw Error(await r.text());return r.json();};
const q=await api('/queue');if(q.queue_running.length||q.queue_pending.length)throw Error('H3 is busy');
fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'workflow.json'),JSON.stringify(graph,null,2));
const submission=await api('/prompt',{prompt:graph,client_id:'novaflow-background-node-probe'});
fs.writeFileSync(path.join(out,'submission.json'),JSON.stringify(submission));
console.log('SUBMITTED',submission.prompt_id);
for(let i=0;i<150;i++){
  const h=(await api('/history/'+submission.prompt_id))[submission.prompt_id];
  if(h){fs.writeFileSync(path.join(out,'history.json'),JSON.stringify(h,null,2));console.log(h.status.status_str,JSON.stringify(h.outputs));process.exit(h.status.status_str==='success'?0:1);}
  await new Promise(r=>setTimeout(r,2000));
}
throw Error('History timeout; inspect existing submission before retrying');
