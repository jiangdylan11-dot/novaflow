const base=require('./scenarios.cjs');
const noErr=s=>({ok:!s.error||/Runtime（8189）|音频算力接口尚未就绪|生成服务启动失败|音频.{0,8}(?:算力|节点|未连接)|Failed to fetch/.test(s.error),what:'no error (compute boundary ok)',detail:s.error});
const gen=async p=>p.evaluate(()=>window.NovaFlowFoartTools.capture().media);
module.exports=[
 {name:'video-t2v',message:'做一个5秒的海边日落视频，镜头慢慢推进',
  plan(info,i){const {act,done}=H;
   if(i===0)return act('开始生成视频。',{action:'media',operation:{action:'generate_video',target:'video',prompt:'海边日落，金色阳光洒在海面上，镜头缓慢向前推进',seconds:5}});
   return done('已提交。');},
  async check(p,s){const m=await gen(p);return [noErr(s),{ok:/海边|日落|sunset/i.test(m?.generation?.prompt||''),what:'video prompt box filled',detail:JSON.stringify(m?.generation).slice(0,300)}];}},
 {name:'video-prompt-only',message:'帮我写一个视频提示词：女孩回头微笑，先不要生成',
  plan(info,i){const {act,done}=H;
   if(i===0)return act('写提示词。',{action:'media',operation:{action:'optimize_video_prompt',target:'video',prompt:'女孩回头微笑，长发随风飘动'}});
   return done('已写好。');},
  async check(p,s){const m=await gen(p);return [noErr(s),{ok:/女孩|girl/i.test(m?.generation?.prompt||''),what:'video prompt box filled',detail:JSON.stringify(m?.generation).slice(0,300)}];}},
 {name:'audio-music',message:'生成一段30秒轻快的背景音乐',
  plan(info,i){const {act,done}=H;
   if(i===0)return act('生成音乐。',{action:'media',operation:{action:'generate_music',target:'audio',prompt:'轻快明亮的背景音乐，木吉他和口哨',seconds:30}});
   return done('已提交。');},
  async check(p,s){const m=await gen(p);return [noErr(s),{ok:!!m?.audioSettings,what:'audio opened',detail:JSON.stringify(m?.audioSettings).slice(0,300)}];}},
 {name:'audio-sfx',message:'做一个爆炸音效',
  plan(info,i){const {act,done}=H;
   if(i===0)return act('生成音效。',{action:'media',operation:{action:'generate_sfx',target:'audio',prompt:'近距离爆炸，低频轰鸣带碎片声',seconds:2}});
   return done('已提交。');},
  async check(p,s){const m=await gen(p);return [noErr(s),{ok:m?.audioSettings?.mode==='sfx',what:'sfx mode',detail:JSON.stringify(m?.audioSettings).slice(0,300)}];}},
];
