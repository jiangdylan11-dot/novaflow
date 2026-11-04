const fs=require('fs');
const ctl=(ctx,re)=>(ctx.controls||[]).find(c=>re.test(c.label));
const noErr=s=>({ok:!s.error,what:'no error',detail:s.error});
const lastSays=(s,re,what)=>({ok:re.test(s.messages.at(-1)?.content||''),what:what||('last reply ~ '+re),detail:s.messages.at(-1)?.content});
const art=async p=>p.evaluate(()=>{const rt=window.__NovaFlowArtGenerate;return rt?{mode:rt.state.mode,prompt:rt.state.prompt,count:rt.state.count,width:rt.state.width,height:rt.state.height,runs:window.__runs||[]}:null;});
const PNG='data:image/png;base64,'+fs.readFileSync(__dirname+'/cat.png').toString('base64');
async function stubRun(p){await p.evaluate(()=>{const rt=window.__NovaFlowArtGenerate;window.__runs=[];rt.run=async()=>{for(let i=0;i<(rt.state.count||1);i++)rt.state.results.unshift({id:'r'+Date.now()+'-'+i+'-'+Math.random(),name:'成图-'+(window.__runs.length+1)+'-'+(i+1)+'.png'});window.__runs.push({mode:rt.state.mode,prompt:rt.state.prompt,count:rt.state.count,w:rt.state.width,h:rt.state.height});};});}
async function stage(p,name='cat.png'){await p.evaluate(async ([d,name])=>{const b=await (await fetch(d)).blob();const f=new File([b],name,{type:'image/png'});await window.__xt.c.stageUploads([f]);},[PNG,name]);}
module.exports=[
 {name:'art-txt2img',setup:stubRun,message:'帮我画一只橘猫坐在窗台上，阳光照进来',
  plan(info,i){const {act,done}=H;
   if(i===0)return act('我先打开美工，再生成图片。',{action:'open',surface:'drawing'});
   if(i===1)return act('开始生成。',{action:'image_generate',prompt:'一只橘猫坐在窗台上，午后阳光从窗外照进来，温暖柔和的光线',generationMode:'txt2img',useResult:false,count:1});
   return done('已按描述提交生成。');},
  async check(p,s){const a=await art(p);return [noErr(s),{ok:a?.runs?.length===1&&/橘猫/.test(a.runs[0].prompt),what:'generation ran once with optimized prompt',detail:JSON.stringify(a)}];}},
 {name:'art-count3',setup:stubRun,message:'帮我画3张橘猫',
  plan(info,i){const {act,done}=H;
   if(i===0)return act('打开美工。',{action:'open',surface:'drawing'});
   if(i===1)return act('生成3张。',{action:'image_generate',prompt:'一只可爱的橘猫',generationMode:'txt2img',useResult:false,count:3});
   return done('已提交。');},
  async check(p,s){const a=await art(p);return [noErr(s),{ok:a?.runs?.[0]?.count===3,what:'3 images requested',detail:JSON.stringify(a)}];}},
 {name:'art-size',setup:stubRun,message:'画一张1024x1536的竖版海报，主题是赛博朋克城市',
  plan(info,i){const {act,done}=H;
   if(i===0)return act('打开美工。',{action:'open',surface:'drawing'});
   if(i===1)return act('生成。',{action:'image_generate',prompt:'赛博朋克城市竖版海报，霓虹灯，雨夜街道',generationMode:'txt2img',useResult:false});
   return done('已提交。');},
  async check(p,s){const a=await art(p);return [noErr(s),{ok:a?.runs?.[0]?.w===1024&&a.runs[0].h===1536,what:'size 1024x1536',detail:JSON.stringify(a)}];}},
 {name:'art-upload-img2img',setup:async p=>{await stubRun(p);await stage(p);},message:'把这张图改成水彩画风格',
  plan(info,i){const {act,done}=H;
   if(i===0)return act('改成水彩。',{action:'image_generate',prompt:'把@参考图1改成水彩画风格，保留猫的姿势和构图',generationMode:'img2img',useResult:false});
   return done('已提交。');},
  async check(p,s){const a=await art(p);return [noErr(s),{ok:a?.runs?.[0]?.mode==='img2img',what:'img2img run',detail:JSON.stringify(a)}];}},
 {name:'art-optimize-only',setup:async p=>{await stubRun(p);await p.evaluate(()=>window.NovaFlowFoartTools.execute({action:'open',surface:'drawing'},{}));await p.evaluate(()=>{const rt=window.__NovaFlowArtGenerate;rt.state.prompt='一个女孩在花园里';});},message:'帮我优化一下提示词，先别生成',
  plan(info,i){const {act,done}=H;
   if(i===0)return act('优化提示词。',{action:'image_optimize',prompt:'一个女孩在花园里',generationMode:'txt2img',useResult:false});
   return done('已优化。');},
  async check(p,s){const a=await art(p);return [noErr(s),{ok:!a.runs.length,what:'no generation',detail:JSON.stringify(a)},{ok:/细节丰富/.test(a.prompt),what:'prompt box updated',detail:a.prompt}];}},
];
