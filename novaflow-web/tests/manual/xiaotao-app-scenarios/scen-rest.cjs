const fs=require('fs');
const b64=(f,t)=>'data:'+t+';base64,'+fs.readFileSync(__dirname+'/'+f).toString('base64');
const PNG=b64('cat.png','image/png'),MP4=b64('clip.mp4','video/mp4'),BLK=b64('black.png','image/png');
const noErr=s=>({ok:!s.error,what:'no error',detail:s.error});
const boundary=s=>({ok:!s.error||/Runtime|算力|未连接|启动失败|Failed to fetch|节点|仍在运行|FFmpeg|ffmpeg/.test(s.error),what:'no error before compute',detail:s.error});
const last=s=>s.messages.filter(m=>m.role==='assistant').at(-1)?.content||'';
const cap=(p,k)=>p.evaluate(k=>window.NovaFlowFoartTools.capture()[k],k);
async function stage(p,name,data,type){await p.evaluate(async ([d,name,type])=>{const b=await (await fetch(d)).blob();await window.__xt.c.stageUploads([new File([b],name,{type})]);},[data,name,type]);}
const seq=steps=>(info,i)=>{const s=steps[i];if(!s)return H.done('完成。');return typeof s==='function'?s(info):s;};
const up=info=>info.context.uploads?.[0]?.id;
const clips=(info,t='video')=>info.context.media?.[t]?.tracks?.flatMap(x=>x.clips||[])||[];
const vres=info=>(info.context.media?.videoResources||[])[0]?.id;
const dump=(info,k)=>H.ask('缺少：'+k+' '+JSON.stringify(k.split('.').reduce((o,x)=>o?.[x],info.context)).slice(0,600));
const ctrl=(info,re,kind)=>info.context.controls.find(c=>re.test(c.label||'')&&(!kind||c.kind===kind));
const toolRun=(label,name,file,fname,type,msg)=>({name:'tools-'+name,message:[async p=>stage(p,fname,file,type),msg],
  plan:seq([H.act('打开工具。',{action:'open',surface:'tools'}),
   info=>{const c=ctrl(info,label);return c?H.act('切换。',{action:'activate_control',controlId:c.id}):H.ask('找不到工具按钮：'+info.context.controls.filter(c=>c.kind==='button').map(c=>c.label).join('|').slice(0,800));},
   info=>{const f=info.context.controls.find(x=>x.kind==='file');return f?H.act('放入。',{action:'assign_upload',controlId:f.id,uploadId:up(info)}):H.ask('无文件框 '+JSON.stringify(info.context.productionTools).slice(0,600));},
   info=>{const t=info.context.productionTools?.find(t=>t.name===name);return t?.items?.length?H.act('执行。',{action:'tool',name,operation:'run'}):H.ask('工具无输入 '+JSON.stringify(info.context.productionTools).slice(0,600));},H.done('完成。')]),
  check:async(p,s)=>[boundary(s),{ok:!/缺少|找不到|无文件框|工具无输入/.test(last(s)),what:'reached run',detail:last(s)}]});
module.exports=[
 {name:'video-edit-split-rate',message:[async p=>stage(p,'clip.mp4',MP4,'video/mp4'),'把这个视频从0.5秒处切开，后半段改成1.5倍速，再复制一份'],
  plan:seq([info=>H.act('导入。',{action:'media',operation:{action:'import_resource',target:'video',resourceId:vres(info)||up(info)}}),
   info=>{const c=clips(info)[0];return c?H.act('切开。',{action:'media',operation:{action:'split',target:'video',clipId:c.id,at:0.5}}):dump(info,'media.video');},
   info=>{const c=clips(info);return c.length>=2?H.act('变速。',{action:'media',operation:{action:'rate',target:'video',clipId:c.at(-1).id,value:1.5}},{action:'media',operation:{action:'duplicate',target:'video',clipId:c.at(-1).id}}):dump(info,'media.video');},H.done('完成。')]),
  check:async(p,s)=>{const m=await cap(p,'media');const c=m?.video?.tracks?.flatMap(t=>t.clips||[])||[];return [noErr(s),{ok:c.length>=3&&/1\.5/.test(JSON.stringify(c)),what:'3 clips, rate 1.5',detail:JSON.stringify(c).slice(0,500)}];}},
 {name:'frame-edit',message:[async p=>stage(p,'clip.mp4',MP4,'video/mp4'),'打开这个视频的帧编辑，选中前3帧'],
  plan:seq([info=>vres(info)?H.act('打开帧编辑。',{action:'frame_open',resourceId:vres(info)}):dump(info,'media'),
   info=>info.context.frameEditor?.frames?H.act('选帧。',{action:'frame_select',startFrame:0,endFrame:2}):dump(info,'frameEditor'),H.done('已选中前3帧。')]),
  check:async(p,s)=>{const f=await cap(p,'frameEditor');return [boundary(s),{ok:!!f&&f.frames>0||/ffmpeg/.test(s.error),what:'frame editor open',detail:JSON.stringify(f).slice(0,300)}];}},
 toolRun(/MP4/,'mp4_compress',MP4,'clip.mp4','video/mp4','把这个视频压缩一下'),
 toolRun(/格式转换|转换/,'video_format_convert',MP4,'clip.mp4','video/mp4','把这个视频转成webm格式'),
 toolRun(/去黑/,'png_remove_black',BLK,'fire.png','image/png','把这张黑底图去黑'),
 {name:'art-pose',message:[async p=>stage(p,'cat.png',PNG,'image/png'),'用姿势参考把这只猫的头抬起来'],
  plan:seq([info=>H.act('姿势参考。',{action:'art_action',name:'poseReference',uploadId:up(info)}),
   info=>{const b=info.context.pose?.bones?.[0];return b?H.act('选关节。',{action:'pose_select',boneName:b.name}):dump(info,'pose');},H.done('已选中关节。')]),
  check:async(p,s)=>[boundary(s),{ok:!/缺少/.test(last(s))||!!s.error,what:'pose state',detail:last(s)}]},
 {name:'art-transfer',message:[async p=>stage(p,'cat.png',PNG,'image/png'),'用万物迁移把这只猫放到画面左上角'],
  plan:seq([info=>H.act('万物迁移。',{action:'art_action',name:'objectTransfer',uploadId:up(info)}),
   info=>{const t=info.context.artEditor?.objectTransfer;return t?.active?H.act('摆放。',{action:'art_transfer_place',x:0,y:0,scale:0.5}):H.ask('需要再上传一张要迁移的物体图。'+JSON.stringify(info.context.artEditor).slice(0,300));},H.done('完成。')]),
  check:async(p,s)=>[boundary(s)]},
 {name:'effect-generate',message:[async p=>stage(p,'clip.mp4',MP4,'video/mp4'),'用这段黑底视频生成一个火焰特效'],
  plan:seq([H.act('打开特效。',{action:'open',surface:'effects'}),
   info=>{const f=info.context.controls.find(x=>x.kind==='file');return info.context.effects?.source?H.act('生成。',{action:'effect_generate'}):f?H.act('放入。',{action:'assign_upload',controlId:f.id,uploadId:up(info)}):dump(info,'effects');},
   info=>info.context.effects?.source?H.act('生成。',{action:'effect_generate'}):dump(info,'effects'),H.done('完成。')]),
  check:async(p,s)=>[{ok:!s.error&&(s.pending?/生成/.test(s.status):true)||boundary(s).ok,what:'reached effect generation',detail:s.error||s.status},{ok:!/缺少/.test(last(s)),what:'effect source',detail:last(s)}]},
 {name:'particle-seq',message:'把当前粒子导出成PNG序列，10帧每秒，0.5秒',
  plan:seq([H.act('打开粒子。',{action:'open',surface:'particle'}),H.act('导出。',{action:'particle',operation:'export_sequence',fps:10,seconds:0.5}),H.done('已导出。')]),
  check:async(p,s)=>[boundary(s),{ok:/导出|下载/.test(last(s))||!!s.error,what:'seq export',detail:last(s)}]},
];
module.exports.push(
 {name:'anim-export-seq',message:['新建一个动画工程，加一根手臂骨骼，做一个挥手动画','把这个动画导出成PNG序列帧'],
  plan:seq([H.act('新建工程。',{action:'animation',operation:'new_project',name:'挥手'}),
   H.act('骨骼。',{action:'animation',operation:'create_bone',name:'arm',parentBoneName:'root',values:{length:80,rotation:30}}),
   H.act('建动画。',{action:'animation',operation:'create_animation',name:'wave'}),
   H.act('关键帧。',{action:'animation',operation:'key_bones',name:'wave',keys:[{boneName:'arm',frame:0,values:{rotation:30}},{boneName:'arm',frame:15,values:{rotation:80}}]}),
   H.done('已做好。'),
   H.act('导出。',{action:'animation',operation:'export_media',kind:'sequence'}),H.done('已导出。')]),
  check:async(p,s)=>[{ok:/没有可导出的可见图片/.test(s.error),what:'bones-only project: says no visible picture',detail:s.error}]},
 {name:'anim-export-gif',message:['新建一个动画工程，加一根手臂骨骼，做一个挥手动画','导出成GIF'],
  plan:seq([H.act('新建工程。',{action:'animation',operation:'new_project',name:'挥手'}),
   H.act('骨骼。',{action:'animation',operation:'create_bone',name:'arm',parentBoneName:'root',values:{length:80,rotation:30}}),
   H.act('建动画。',{action:'animation',operation:'create_animation',name:'wave'}),
   H.act('关键帧。',{action:'animation',operation:'key_bones',name:'wave',keys:[{boneName:'arm',frame:0,values:{rotation:30}},{boneName:'arm',frame:15,values:{rotation:80}}]}),
   H.done('已做好。'),
   H.act('导出。',{action:'animation',operation:'export_media',kind:'video',format:'gif'}),H.done('已导出。')]),
  check:async(p,s)=>[{ok:/没有可导出的可见图片/.test(s.error),what:'bones-only project: says no visible picture',detail:s.error}]});
