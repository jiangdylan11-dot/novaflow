// Isolated model capability probes: native references, reviewed model prompt,
// no prompt assistant, motion neutralization, compositing, or app mutations.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
require('../particle-editor/ai-sequence-minimax-h3.workflow.js');
const build=globalThis.NovaFlowAiSequenceMiniMaxH3Workflow.buildWorkflow;
const args=process.argv.slice(2);
const name=args.find(v=>v.startsWith('--case='))?.slice(7)||'color';
const native=args.includes('--native');
const steps=Number(args.find(v=>v.startsWith('--steps='))?.slice(8)||(native?20:4));
const out=path.resolve(args.find(v=>v.startsWith('--out='))?.slice(6)||path.join('docs/h3-capability-20260915',`${name}-${native?'ref2va':'beta5'}-${steps}`));
fs.mkdirSync(out,{recursive:true});
const input='C:/ProgramData/NovaFlow/AI-Runtime-H3/generated/input';
const api=async(route,body)=>{const r=await fetch('http://127.0.0.1:8189'+route,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});if(!r.ok)throw Error(`${route}: ${r.status} ${await r.text()}`);return r.json();};
async function collect(id) {
 for(let n=0;n<1800;n++){
  const h=(await api('/history/'+id))[id];
  if(h){
   fs.writeFileSync(path.join(out,'history.json'),JSON.stringify(h,null,2));
   console.log('COMPLETE',h.status.status_str,JSON.stringify(h.outputs));
   if(h.status.status_str!=='success')process.exitCode=1;
   return;
  }
  await new Promise(r=>setTimeout(r,2000));
 }
 throw Error('Probe timeout; use --resume to collect the existing submission');
}
if(args.includes('--resume')) {
 const submitted=JSON.parse(fs.readFileSync(path.join(out,'submission.json'),'utf8'));
 console.log('COLLECTING EXISTING',submitted.prompt_id);
 await collect(submitted.prompt_id);
 process.exit();
}
const queue=await api('/queue');
if(queue.queue_running.length||queue.queue_pending.length)throw Error('H3 busy; not submitting probe');
const sources={color:'docs/cutout-key-parity-20260914/athena/backend/job-C6YUDk/src_green-screen.mp4',outfit:'docs/cutout-key-parity-20260914/athena/backend/job-C6YUDk/src_green-screen.mp4',ice:'docs/cutout-key-parity-20260914/blue/backend/job-sg5Pmq/src_green-screen.mp4',coin:'C:/Users/jiang/OneDrive/Desktop/kling_20260903_VIDEO_Video1视频中的_4542_0.mp4'};
if(!sources[name])throw Error('Unknown probe');
const video=`novaflow_capability_${name}_source.mp4`;
fs.copyFileSync(sources[name],path.join(input,video));
const clothes=['color','outfit'].includes(name),duration=clothes?4:3;
const descriptions={
 color:{subject:'the adult purple-haired fantasy woman in <Video 1>, including her white draped dress and gold accessories',edit:'Recolor only the white fabric of the woman\'s existing dress to saturated crimson red. Preserve the exact garment design, folds, coverage and fabric motion.',target:'The woman wears the same flowing draped dress, with all formerly white fabric now crimson red from the first frame through the last frame. Her purple hair, face, skin, gold armor and accessories retain their source colors.'},
 outfit:{subject:'the adult purple-haired fantasy woman in <Video 1>',edit:'Replace her white draped dress with a fitted long-sleeved dark-blue denim jacket and full-length dark-blue jeans. Keep her identity, purple hairstyle and body motion.',target:'The same woman now wears a buttoned dark-blue denim jacket and full-length jeans for the whole clip. The new clothes follow her torso, arms and legs naturally as she performs the source movement.'},
 ice:{subject:'the gold coin tree and pot in <Video 1>, including its floating gold particles',edit:'Transform the golden coin tree, pot and gold particle effect into an icy magical effect. Make the branches and pot translucent pale-blue ice, the coins faceted ice crystals and the particles blue-white frost sparkles.',target:'A translucent icy tree rises from a pale-blue ice pot. Faceted ice crystals occupy the former coin positions and blue-white frost sparkles follow the original gold particle trajectories. This is visible from the first frame and remains icy throughout.'},
 coin:{subject:'the replacement gold coin whose circular border and cat-outline emblem come from <Picture 1> and whose movement comes from the original coin in <Video 1>',edit:'Replace the original mask-emblem gold coin in <Video 1> with the cat-outline coin from <Picture 1>. Keep the target picture\'s cat-outline emblem and circular gold border throughout.',target:'The replacement coin is already visible at the first frame. It follows the original coin\'s rotation direction, speed, perspective, position and scale at each matching source timestamp. The old mask emblem is absent throughout.'},
};
const d=descriptions[name];
const promptPath=args.find(v=>v.startsWith('--prompt-file='))?.slice(14);
const policyPath=args.find(v=>v.startsWith('--policy-file='))?.slice(14);
const referenceEditPolicy=policyPath?JSON.parse(fs.readFileSync(policyPath,'utf8')):null;
const prompt=promptPath?fs.readFileSync(promptPath,'utf8'):`subject_definitions:\n<Subject 1> is ${d.subject}.\n<Video 1> is the original source video to edit, providing the existing shot, background and temporal motion.\n\nsummary:\n[video editing${name==='coin'?' + reference generation':''}] The target video is an edited version of <Video 1>. ${d.edit}\n\nretention_analysis:\n<Subject 1>: partially_preserved - ${d.edit}\n<Video 1>: fully_preserved - Retain the source camera, background, framing, subject placement, scale, action timing, direction and speed. Change only the explicitly requested appearance.\n\ndetailed_description:\n[Shot 1] At 0.000 seconds, ${d.target} Throughout the shot, follow the action, camera and timing of <Video 1> at the corresponding source timestamps. Preserve the source lighting, shadows, background and every unedited element. The camera follows the original source camera. At ${duration.toFixed(3)} seconds, the edited subject reaches the same pose and location as in the source at that time.\n\noverall_soundscape:\nN/A\n\nnon_diegetic_music:\nN/A`;
const g=build({profile:'beta5_int8',acceleration:'sage',mode:'r2v',prompt,referenceEditPolicy,aspectRatio:clothes?'9:16':'1:1',megapixels:.6,durationSeconds:duration,fps:24,steps:4,seed:1696013393,referenceImages:name==='coin'?['27_1789394327015_ac9a64.png']:[],referenceVideo:video,outputPrefix:`video/NovaFlow_H3_probe_${name}_${native?'ref2va':'beta5'}_${steps}`});
// Probe the model's own reference conditioning and decoded output, even for coins.
if(!policyPath){
 const components=Object.entries(g).find(([,n])=>n.class_type==='NovaFlowH3ReferenceVideoFrames')[0];
 g['5'].inputs['ref_videos.ref_video_0']=[components,0];
 g['13'].inputs.images=['11',0];
 for(const [id,n] of Object.entries(g))if(['NovaFlowH3PrepareMotionReference','NovaFlowH3MatchReferenceLayout'].includes(n.class_type))delete g[id];
}
if(native)g['1'].inputs.unet_name='Minimax_H3\\minimax_h3_ref2va_pruned_int8_convrot.safetensors';
g['6'].inputs.steps=steps;
if(native)g['6'].inputs.scheduler='beta';
fs.writeFileSync(path.join(out,'prompt.txt'),prompt);
fs.writeFileSync(path.join(out,'workflow.json'),JSON.stringify(g,null,2));
const submitted=await api('/prompt',{prompt:g,client_id:'novaflow-h3-native-capability-probe'});
fs.writeFileSync(path.join(out,'submission.json'),JSON.stringify(submitted,null,2));
console.log('SUBMITTED',submitted.prompt_id,`${g['5'].inputs.width}x${g['5'].inputs.height}`,g['5'].inputs.length,'frames');
await collect(submitted.prompt_id);
