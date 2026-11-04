const fs=require('fs');
const PNG='data:image/png;base64,'+fs.readFileSync(__dirname+'/cat.png').toString('base64');
const noErr=s=>({ok:!s.error,what:'no error',detail:s.error});
const last=s=>s.messages.filter(m=>m.role==='assistant').at(-1)?.content||'';
async function stubRun(p){await p.evaluate(()=>{const rt=window.__NovaFlowArtGenerate;window.__runs=[];rt.run=async()=>{for(let i=0;i<(rt.state.count||1);i++)rt.state.results.unshift({id:'r'+Date.now()+'-'+i+'-'+Math.random(),name:'成图-'+(window.__runs.length+1)+'-'+(i+1)+'.png'});window.__runs.push({mode:rt.state.mode,prompt:rt.state.prompt,count:rt.state.count});};});}
async function stage(p,name='cat.png'){await p.evaluate(async ([d,name])=>{const b=await (await fetch(d)).blob();await window.__xt.c.stageUploads([new File([b],name,{type:'image/png'})]);},[PNG,name]);}
async function pageRef(p){await p.evaluate(()=>window.NovaFlowFoartTools.execute({action:'open',surface:'drawing'},{}));await p.evaluate(async d=>{const rt=window.__NovaFlowArtGenerate;rt.setMode?.('img2img');await rt.setReference(0,{name:'girl.png',dataUrl:d});},PNG);await p.waitForTimeout(400);}
module.exports=[
 {name:'offtopic',message:'今天北京天气怎么样',chat:()=>'我只协助使用 Foart 制作内容，有什么想做的图片或视频吗？',plan(){return H.say('我只协助使用 Foart 制作内容，有什么想做的图片或视频吗？');},
  check:(p,s)=>[noErr(s),{ok:/Foart/.test(last(s)),what:'polite refusal shown',detail:last(s)}]},
 {name:'clarify-then-1',setup:stubRun,message:['帮我画个头像','1'],
  plan(info,i){const {act,ask,done}=H;
   if(i===0)return ask('想要哪种风格？1. 写实 2. 动漫 3. 像素风');
   if(i===1){if(!/用户回答：1/.test(info.message||''))throw Error('answer not threaded: '+info.message);return act('写实头像。',{action:'open',surface:'drawing'});}
   if(i===2)return act('生成。',{action:'image_generate',prompt:'写实风格人物头像，柔和光线',generationMode:'txt2img',useResult:false});
   return done('ok');},
  check:async(p,s,r)=>[noErr(s),{ok:(await p.evaluate(()=>window.__runs?.length))===1,what:'answer 1 led to generation',detail:JSON.stringify(r.map(x=>x.message||x.round)).slice(0,500)}]},
 {name:'reverse-page-ref',setup:pageRef,message:'反推@参考图1',chat:()=> 'A girl with long hair standing by the window, soft light',plan(){throw Error('planner must not be used');},
  check:(p,s,r)=>[noErr(s),{ok:r.some(x=>x.chat&&x.chat.images===1),what:'one picture sent to image chat',detail:JSON.stringify(r).slice(0,300)}]},
 {name:'reverse-staged',message:[async p=>stage(p),'反推这张图的提示词'],chat:()=> '一只橘色的猫，暖色调',plan(info){return H.say('一只橘色的猫，暖色调');},
  check:(p,s,r)=>[noErr(s),{ok:/橘色/.test(last(s)),what:'reverse result shown',detail:last(s)+' | '+JSON.stringify(r).slice(0,300)}]},
 {name:'art-pageref-mode',setup:async p=>{await stubRun(p);await pageRef(p);await p.evaluate(()=>window.__NovaFlowArtGenerate.setMode('txt2img'));},message:'用参考图1生成一张水彩画',
  plan(info,i){const {act,done}=H;
   if(i===0)return act('图生图。',{action:'image_generate',prompt:'把@参考图1画成水彩画风格',generationMode:'img2img',useResult:false});
   return done('ok');},
  check:async(p,s)=>{const r=await p.evaluate(()=>window.__runs);return [noErr(s),{ok:r?.[0]?.mode==='img2img',what:'switched to img2img and ran',detail:JSON.stringify(r)}];}},
 {name:'tools-png',message:[async p=>stage(p,'icon.png'),'把这张PNG压缩一下'],
  plan(info,i){const {act,done}=H;const c=info.context;
   if(i===0)return act('打开工具。',{action:'open',surface:'tools'});
   if(i===1){const up=c.uploads?.[0];const f=c.controls.find(x=>x.kind==='file'&&/png/.test(x.label));return act('放入图片。',{action:'assign_upload',controlId:f.id,uploadId:up.id});}
   if(i===2)return act('压缩。',{action:'tool',name:'png_compress',operation:'run'});
   return done('已压缩');},
  check:(p,s,r)=>[noErr(s),{ok:r.length>=3,what:'went through tools flow',detail:JSON.stringify(r.map(x=>x.plan?.operations)).slice(0,500)}]},
 {name:'effects-open',message:'打开AI特效，我要做一个火焰特效',
  plan(info,i){const {act,ask}=H;
   if(i===0)return act('打开特效。',{action:'open',surface:'effects'});
   return ask('特效生成需要一段黑底特效素材，请上传一段黑底视频或PNG序列，或用特效模板先做一段。');},
  check:async(p,s)=>{const e=await p.evaluate(()=>window.NovaFlowFoartTools.capture().effects);return [noErr(s),{ok:e?.active===true,what:'effects opened',detail:JSON.stringify(e).slice(0,200)},{ok:/上传/.test(last(s)),what:'asks for material',detail:last(s)}];}},
];
