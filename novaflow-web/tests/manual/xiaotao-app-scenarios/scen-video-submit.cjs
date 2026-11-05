// 视频页：有附图的"生成"请求必须用图生视频并提交生成；"继续生成"直接用已写好的稿子提交，不再重写。
const fs=require('fs');
const PNG='data:image/png;base64,'+fs.readFileSync(__dirname+'/cat.png').toString('base64');
async function stage(p,name='slot.png'){await p.evaluate(async ([d,name])=>{const b=await (await fetch(d)).blob();await window.__xt.c.stageUploads([new File([b],name,{type:'image/png'})]);},[PNG,name]);}
const openVideo=async p=>{await p.evaluate(async()=>{await window.NovaFlowFoartTools.execute({action:'open',surface:'video'},{snapshot:window.NovaFlowFoartTools.capture()});});await p.waitForTimeout(800);};
const gen=async p=>p.evaluate(()=>({media:window.NovaFlowFoartTools.capture().media?.generation,page:window.NovaFlowAiSequenceGeneration?.capture?.()}));
const calls=async p=>p.evaluate(()=>window.__xt.calls.map(c=>c[0]));
const ctl=(ctx,re)=>(ctx?.controls||[]).find(c=>re.test(c.label||''));
// What 豆包 answered: duration + prompt optimize, never generate_video.
const lazyPlan=(info,i)=>{const {act,done}=H;
  if(i===0){const d=ctl(info.context,/时长/);const ops=[];if(d)ops.push({action:'set_control',controlId:d.id,value:2});ops.push({action:'media',operation:{action:'optimize_video_prompt',target:'video',prompt:'2秒中奖动画，参考图的PG slot风格，BIG WIN金色大字弹出，金币飞溅，闪光爆发'}});return act('设置时长并写提示词。',...ops);}
  if(i===1)return act('再优化一次。',{action:'media',operation:{action:'optimize_video_prompt',target:'video',prompt:'2秒中奖动画，BIG WIN金色大字，金币飞溅'}});
  return done('已写好提示词。');};
const noErr=s=>({ok:!s.error||/MiniMax H3 Runtime|Runtime（8189）|生成服务启动失败|Failed to fetch|算力|节点/.test(s.error),what:'no error (compute boundary ok)',detail:s.error});
module.exports=[
 {name:'video-attach-generate',setup:openVideo,message:[async p=>stage(p),'帮我生成一段2秒中奖动画，根据pg slot 动画特效表现方式。'],
  plan:lazyPlan,
  async check(p,s,rounds){const g=await gen(p),c=await calls(p);const planRounds=rounds.filter(r=>!r.chat).length;
   const last=s.messages.at(-1)?.content||'';
   return [noErr(s),
    {ok:g.page?.genType==='image_video'||g.page?.genType==='multi_reference',what:'attached picture → 图生/多参, not 文生',detail:JSON.stringify({genType:g.page?.genType,refs:g.page?.references,h3:g.media?.h3References}).slice(0,400)},
    {ok:c.filter(x=>x==='promptAssistantVideoDraft').length===1,what:'video draft written once',detail:c.join(',')},
    {ok:!/文生视频/.test(last)&&!/已优化并写入.*\n.*已优化并写入/.test(last),what:'no 文生 receipt, no duplicate receipt',detail:last},
    {ok:/生成|提交|H3|算力|节点/.test(last+(s.error||''))&&!/^已优化并写入[^\n]*$/m.test(last)||/MiniMax H3 Runtime|算力|节点|生成服务/.test(s.error||''),what:'generation submitted (reached compute)',detail:last+' | '+s.error},
    {ok:planRounds<=1,what:'one planner round',detail:String(planRounds)}];}},
 {name:'video-continue-generate',setup:openVideo,message:[async p=>stage(p),'帮我写一个2秒中奖动画的视频提示词，先不要生成',
   async p=>p.evaluate(()=>{window.__xt.calls.length=0;}),'然后继续帮我生成视频。'],
  plan(info,i,rounds){const {act,done}=H;
   if(i===0)return act('写提示词。',{action:'media',operation:{action:'optimize_video_prompt',target:'video',prompt:'2秒中奖动画，BIG WIN金色大字，金币飞溅'}});
   if(i===1)return act('优化提示词。',{action:'media',operation:{action:'optimize_video_prompt',target:'video',prompt:'2秒中奖动画，BIG WIN金色大字，金币飞溅'}});
   return done('好了。');},
  async check(p,s){const c=await calls(p);const last=s.messages.at(-1)?.content||'';
   return [noErr(s),
    {ok:!c.includes('promptAssistantVideoDraft'),what:'continue does not rewrite the draft again',detail:c.join(',')},
    {ok:!/^已优化并写入[^\n]*$/m.test(last)||/MiniMax H3 Runtime|算力|节点|生成服务/.test(s.error||''),what:'continue submits generation',detail:last+' | '+s.error}];}},
];
