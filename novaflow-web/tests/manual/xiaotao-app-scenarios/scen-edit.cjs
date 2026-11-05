const fs=require('fs');
const PNG='data:image/png;base64,'+fs.readFileSync(__dirname+'/cat.png').toString('base64');
const MP4='data:video/mp4;base64,'+fs.readFileSync(__dirname+'/clip.mp4').toString('base64');
const WAV='data:audio/wav;base64,'+fs.readFileSync(__dirname+'/tone.wav').toString('base64');
const noErr=s=>({ok:!s.error,what:'no error',detail:s.error});
const boundary=s=>({ok:!s.error||/Runtime|算力|未连接|启动失败|Failed to fetch|节点|仍在运行/.test(s.error),what:'no error before compute',detail:s.error});
const last=s=>s.messages.filter(m=>m.role==='assistant').at(-1)?.content||'';
const cap=(p,k)=>p.evaluate(k=>window.NovaFlowFoartTools.capture()[k],k);
async function stage(p,name,data,type){await p.evaluate(async ([d,name,type])=>{const b=await (await fetch(d)).blob();await window.__xt.c.stageUploads([new File([b],name,{type})]);},[data,name,type]);}
const seq=steps=>(info,i)=>{const s=steps[i];if(!s)return H.done('完成。');return typeof s==='function'?s(info):s;};
const up=info=>info.context.uploads?.[0]?.id;
module.exports=[
 {name:'art-cutout',message:[async p=>stage(p,'cat.png',PNG,'image/png'),'把这张图里的猫抠出来'],chat:()=>'{"box":[0.2,0.2,0.8,0.8]}',
  plan:seq([info=>H.act('抠图。',{action:'art_action',name:'cutout',uploadId:up(info)}),info=>H.act('执行。',{action:'art_action',name:'cutout'}),H.done('已抠出。')]),
  check:async(p,s)=>[boundary(s),{ok:/涂|抠|遮罩/.test(last(s))||!!s.error,what:'cutout reply',detail:last(s)}]},
 {name:'art-outpaint',message:[async p=>stage(p,'cat.png',PNG,'image/png'),'把这张图扩成1024x512，两边补成草地'],
  plan:seq([info=>H.act('扩图。',{action:'art_outpaint',uploadId:up(info),width:1024,height:512,anchor:'center',prompt:'把两侧灰色区域补成延续的绿色草地'}),H.done('完成。')]),
  check:async(p,s)=>[boundary(s)]},
 {name:'art-split',message:[async p=>stage(p,'cat.png',PNG,'image/png'),'把这张图一键拆图'],
  plan:seq([info=>H.act('拆图。',{action:'art_action',name:'split',uploadId:up(info)}),H.done('完成。')]),
  check:async(p,s)=>[boundary(s)]},
 {name:'art-angle',message:[async p=>stage(p,'cat.png',PNG,'image/png'),'把这只猫转成侧面角度'],
  plan:seq([info=>H.act('角度。',{action:'art_action',name:'imageAngleAdjust',uploadId:up(info)}),H.done('完成。')]),
  check:async(p,s)=>[boundary(s)]},
 {name:'art-inpaint-edit',message:[async p=>stage(p,'cat.png',PNG,'image/png'),'把猫的眼睛改成蓝色'],chat:()=>'{"box":[0.4,0.3,0.6,0.4]}',
  plan:seq([info=>H.act('局部编辑。',{action:'art_action',name:'inpaintEdit',uploadId:up(info)}),info=>H.act('执行。',{action:'art_action',name:'inpaintEdit'}),H.done('完成。')]),
  check:async(p,s)=>[boundary(s)]},
 {name:'video-edit-trim',message:[async p=>stage(p,'clip.mp4',MP4,'video/mp4'),'把这个视频只保留前1秒'],
  plan:seq([info=>H.act('导入。',{action:'media',operation:{action:'import_resource',target:'video',resourceId:(info.context.media?.videoResources||[])[0]?.id||up(info)}}),
   info=>{const clip=info.context.media?.video?.tracks?.flatMap(t=>t.clips||[])[0];return clip?H.act('裁剪。',{action:'media',operation:{action:'trim',target:'video',clipId:clip.id,start:0,end:1}}):H.ask('没有找到片段：'+JSON.stringify(info.context.media?.video).slice(0,200));},H.done('完成。')]),
  check:async(p,s)=>{const v=await cap(p,'media');const c=v?.video?.tracks?.flatMap(t=>t.clips||[])[0];return [noErr(s),{ok:!!c&&Math.abs((c.end??c.sourceEnd??c.duration??0)-1)<0.2||!!c&&JSON.stringify(c).includes('"duration":1'),what:'clip trimmed to 1s',detail:JSON.stringify(c||v?.video).slice(0,400)}];}},
 {name:'audio-edit-volume',message:[async p=>stage(p,'tone.wav',WAV,'audio/wav'),'把这段音频音量调到一半，加1秒淡出'],
  plan:seq([info=>H.act('导入。',{action:'media',operation:{action:'import_resource',target:'audio',resourceId:(info.context.media?.audioResources||[])[0]?.id||up(info)}}),
   info=>{const clip=info.context.media?.audio?.tracks?.flatMap(t=>t.clips||[])[0];return clip?H.act('调整。',{action:'media',operation:{action:'volume',target:'audio',clipId:clip.id,value:0.5}},{action:'media',operation:{action:'fade',target:'audio',clipId:clip.id,fadeOut:1}}):H.ask('没有片段：'+JSON.stringify(info.context.media).slice(0,300));},H.done('完成。')]),
  check:async(p,s)=>{const m=await cap(p,'media');const c=m?.audio?.tracks?.flatMap(t=>t.clips||[])[0];return [noErr(s),{ok:!!c&&/0\.5/.test(JSON.stringify(c)),what:'volume 0.5 + fade',detail:JSON.stringify(c||m).slice(0,400)}];}},
];
