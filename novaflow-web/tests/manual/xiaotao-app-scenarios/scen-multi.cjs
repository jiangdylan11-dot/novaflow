const noErr=s=>({ok:!s.error,what:'no error',detail:s.error});
const last=s=>s.messages.filter(m=>m.role==='assistant').at(-1)?.content||'';
const fs=require('fs');const PNG='data:image/png;base64,'+fs.readFileSync(__dirname+'/cat.png').toString('base64');
async function stubRun(p){await p.evaluate(d=>{window.__catPng=d;const rt=window.__NovaFlowArtGenerate||{};window.__runs=[];const hook=()=>{const rt=window.__NovaFlowArtGenerate;rt.run=async()=>{for(let i=0;i<(rt.state.count||1);i++)rt.state.results.unshift({id:'r'+Date.now()+'-'+i,name:'成图-'+(window.__runs.length+1)+'-'+(i+1)+'.png',imageUrl:window.__catPng});window.__runs.push({mode:rt.state.mode,prompt:rt.state.prompt,refs:rt.references().filter(Boolean).length});};};hook();},PNG);}
const first=(info,i)=>i===0?H.act('打开美工。',{action:'open',surface:'drawing'}):i===1?H.act('生成。',{action:'image_generate',prompt:'一只橘猫坐在草地上',generationMode:'txt2img',useResult:false}):null;
module.exports=[
 {name:'revise-useResult',setup:stubRun,message:['画一只橘猫坐在草地上','把背景改成蓝色天空'],
  plan(info,i){const {act,done}=H;const f=first(info,i);if(f)return f;
   if(i===2)return act('基于上一张修改。',{action:'image_generate',prompt:'保持橘猫不变，把背景改成蓝色天空',generationMode:'img2img',useResult:true});
   return done('已修改。');},
  check:async(p,s)=>{const r=await p.evaluate(()=>window.__runs);return [noErr(s),{ok:r?.length===2&&r[1].mode==='img2img',what:'second run is img2img on previous result',detail:JSON.stringify(r)}];}},
 {name:'revise-use_result-op',setup:stubRun,message:['画一只橘猫坐在草地上','把背景改成蓝色天空'],
  plan(info,i){const {act,done}=H;const f=first(info,i);if(f)return f;
   if(i===2)return act('先用上一张。',{action:'use_result'});
   if(i===3)return act('修改。',{action:'image_generate',prompt:'保持橘猫不变，把背景改成蓝色天空',generationMode:'img2img',useResult:false});
   return done('已修改。');},
  check:async(p,s)=>{const r=await p.evaluate(()=>window.__runs);return [noErr(s),{ok:r?.length===2&&r[1].mode==='img2img'&&r[1].refs>=1,what:'second run is img2img with result as reference',detail:JSON.stringify(r)}];}},
 {name:'img-then-video',setup:stubRun,message:'先画一只橘猫，然后把它做成3秒的视频',
  plan(info,i){const {act,done}=H;const f=first(info,i);if(f)return f;
   if(i===2)return act('用这张图生成视频。',{action:'media',operation:{action:'generate_video',target:'video',prompt:'橘猫在草地上伸懒腰，尾巴轻轻摆动',seconds:3}});
   return done('ok');},
  check:async(p,s,r)=>{const m=await p.evaluate(()=>window.NovaFlowFoartTools.capture().media?.generation);return [{ok:!s.error||/8189/.test(s.error),what:'reached video generation',detail:s.error},{ok:m?.genType==='image_video'&&m.h3References?.length>=0,what:'video uses 图生视频 with the cat',detail:String(JSON.stringify(m)).slice(0,400)}];}},
];
