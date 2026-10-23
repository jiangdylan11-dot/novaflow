import test from 'node:test';
import assert from 'node:assert/strict';
import {ART_EDIT_MODEL,ART_EDIT_SYSTEM,isArtEditRequest,parseArtEdit,buildArtEditGraph,planArtEdit,artEditRendering} from '../../worker/src/art-edit-planner.mjs';
function png(side){const b=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(b);b.writeUInt32BE(side,16);b.writeUInt32BE(side,20);return 'data:image/png;base64,'+b.toString('base64');}
const request=()=>({surface:'art',purpose:'art-director',visualSchema:'nf.art.direction.v1',currentPrompt:'@参考图5用@参考图2画风',images:[{dataUrl:png(32)},{dataUrl:png(32)}],artContext:{editEnhancer:'qwen21-pe-i2i',width:832,height:1216,references:[{source:2,roles:['style']},{source:5,roles:['subject']}]}});
const rewrite=()=>({rewritten_prompt:'将<image2>整体按<image1>的画法、配色与光感重绘，保留主要内容，造型允许重构。',wh_ratio:'13:19',ratio_follow:''});

test('PE is scoped to the opted-in local drawing content/style pair',()=>{
  const p=request();assert.equal(isArtEditRequest(p),true);
  assert.equal(isArtEditRequest({...p,surface:'ui-design'}),false);
  assert.equal(isArtEditRequest({...p,nsfw:true}),false);
  assert.equal(isArtEditRequest({...p,purpose:'art-director-review'}),false);
  p.artContext.references[0].roles=['pose'];assert.equal(isArtEditRequest(p),false);
});
test('drawing PE keeps its trained three-field contract, thinking and source-number mapping',()=>{
  const p=request(),g=buildArtEditGraph(['style.png','source.png'],{...p.artContext,userRequest:p.currentPrompt});
  assert.equal(g['1'].inputs.clip_name,ART_EDIT_MODEL);assert.equal(g['3'].inputs.thinking,true);
  assert.equal(g['3'].inputs.use_default_template,false);assert.match(g['3'].inputs.prompt,/<\|im_start\|>assistant\n<think>\n$/);
  assert.match(g['3'].inputs.prompt,/<image2>用<image1>画风/);assert.doesNotMatch(g['3'].inputs.prompt,/@参考图5/);
  const user=g['3'].inputs.prompt.split('<|im_start|>user\n')[1];
  assert.match(user,/按<image1>的五官塑造/);assert.match(user,/完整重构<image2>/);
  assert.match(user,/用户原始需求中的明确保留要求优先/);assert.match(user,/wh_ratio必须为"832:1216"/);
  assert.match(user,/同属动漫也要依据这张参考可见的脸部轮廓/);assert.match(user,/不强加细线描边、赛璐璐或固定动漫脸/);
  assert.match(ART_EDIT_SYSTEM,/not an OCR task/);assert.match(ART_EDIT_SYSTEM,/Closed eyes/);
  assert.match(ART_EDIT_SYSTEM,/Explicit user locks/);assert.match(ART_EDIT_SYSTEM,/proportions.*may change/);
  assert.ok(Object.values(g).every(n=>!n.class_type.includes('Crop')));
});
test('bad tags, ambiguous ratios and invented signage cannot become a rendered directive',()=>{
  assert.equal(parseArtEdit(JSON.stringify(rewrite()),2).wh_ratio,'13:19');
  assert.throws(()=>parseArtEdit(JSON.stringify({...rewrite(),rewritten_prompt:'按<image3>画风重绘<image1>'}),2),/参考图/);
  assert.throws(()=>parseArtEdit(JSON.stringify({...rewrite(),ratio_follow:'<image2>'}),2),/不完整/);
  assert.throws(()=>parseArtEdit(JSON.stringify({...rewrite(),wh_ratio:'0:19'}),2),/画布/);
  const guessed={...rewrite(),rewritten_prompt:rewrite().rewritten_prompt+'保留指示牌数字"08-25"。'};
  assert.throws(()=>parseArtEdit(JSON.stringify(guessed),2,'换画风'),/猜写/);
  assert.doesNotThrow(()=>parseArtEdit(JSON.stringify(guessed),2,'将指示牌数字改为08-25'));
});

test('rendering guidance requires a positive anime target, never a donor prohibition or semi-real CG',()=>{
  assert.equal(artEditRendering('将照片改为二维动漫插画画风，不保留摄影质感。'),'anime');
  assert.equal(artEditRendering('重绘为半写实游戏CG，不采用动漫插画。'),'other');
  assert.equal(artEditRendering('不要二维动漫，采用油画。'),'other');
  assert.equal(artEditRendering('将照片画成动漫游戏CG，厚涂体块与材质塑造。'),'other');
  assert.equal(artEditRendering('动漫插画式人物，三维渲染质感。'),'animated-3d');
  assert.equal(artEditRendering('半写实3D动画电影角色，立体皮肤与材质高光。'),'animated-3d');
  assert.equal(artEditRendering('建筑三维渲染，金属与混凝土材质。'),'other');
});

test('a requested semi-real 3D finish cannot be rewritten as flat 2D, while facial stylization and negative exclusions remain valid',()=>{
  const flat={...rewrite(),rewritten_prompt:'将<image2>按<image1>画风转换为二维动漫插画，采用纯平涂。'};
  assert.throws(()=>parseArtEdit(JSON.stringify(flat),2,'图2用图1画风，半写实3D质感'),/改成了二维平涂/);
  assert.doesNotThrow(()=>parseArtEdit(JSON.stringify({...flat,rewritten_prompt:'将<image2>按<image1>的半写实3D质感重建，不采用二维插画，不强加赛璐璐渲染。'}),2,'半写实3D质感'));
  assert.doesNotThrow(()=>parseArtEdit(JSON.stringify(flat),2,'不要3D，采用二维动漫'));
});

test('donor scenery cannot become a positive example of style while scoped source content and exclusions remain valid',()=>{
  const refs=[{roles:['subject']},{roles:['style']}];
  const leaked={...rewrite(),rewritten_prompt:'以<image2>画风重绘<image1>。<image2>的画法为树冠用墨色、草叶与花朵以点簇笔法塑造。'};
  assert.throws(()=>parseArtEdit(JSON.stringify(leaked),2,'图1用图2画风',refs),/供体景物/);
  assert.doesNotThrow(()=>parseArtEdit(JSON.stringify({...leaked,rewritten_prompt:'以<image2>的淡墨晕染和点簇笔触重绘<image1>。不得引入<image2>的树木、花朵和茅草屋。'}),2,'图1用图2画风',refs));
  assert.doesNotThrow(()=>parseArtEdit(JSON.stringify({...leaked,rewritten_prompt:'用<image2>画法重绘<image1>的树木与草叶，保留原场景类别。'}),2,'图1用图2画风',refs));
  assert.doesNotThrow(()=>parseArtEdit(JSON.stringify({...leaked,rewritten_prompt:'以<image2>画风重绘<image1>。采用<image2>画法并添加用户指定的花朵。'}),2,'图1用图2画风，添加花朵',refs));
});
test('unrequested photographic locks are rejected but explicit geometry locks still win',()=>{
  const locked={...rewrite(),rewritten_prompt:rewrite().rewritten_prompt+'保持<image2>全部内容不变，保留原布局和脸型。'};
  assert.throws(()=>parseArtEdit(JSON.stringify(locked),2,'图1用图2画风'),/过度锁定/);
  assert.doesNotThrow(()=>parseArtEdit(JSON.stringify(locked),2,'换画风，全部内容不变，保持脸型和布局'));
  const loose={...rewrite(),rewritten_prompt:rewrite().rewritten_prompt+'不要保持原布局和脸型，允许重新构图。'};
  assert.doesNotThrow(()=>parseArtEdit(JSON.stringify(loose),2,'换画风'));
  const eyeLock={...rewrite(),rewritten_prompt:rewrite().rewritten_prompt+'闭眼以弧形眼睑绘制，睁眼一只保持原有比例。'};
  assert.throws(()=>parseArtEdit(JSON.stringify(eyeLock),2,'换画风'),/过度锁定/);
  assert.doesNotThrow(()=>parseArtEdit(JSON.stringify(eyeLock),2,'换画风，保持眼睛比例'));
});
test('real adapter rejects a bad PE answer once, then returns original-role metadata without a UI catalog',async()=>{
  const calls=[],graphs=[];let attempts=0;
  const fake=async(url,init={})=>{calls.push(url);let data;
    if(url.endsWith('/queue'))data={queue_running:[],queue_pending:[]};
    else if(url.endsWith('/upload/image'))data={name:'complete-'+calls.length+'.png'};
    else if(url.endsWith('/prompt')){graphs.push(JSON.parse(init.body).prompt);attempts++;data={prompt_id:'proof-'+attempts};}
    else if(url.includes('/history/'))data={['proof-'+attempts]:{status:{status_str:'success'},outputs:{'4':{text:[JSON.stringify(attempts===1?{...rewrite(),rewritten_prompt:'遗漏参考图'}:rewrite())]}}}};
    else assert.fail(url);
    return new Response(JSON.stringify(data),{status:200});};
  const r=await planArtEdit({baseUrl:'http://local',payload:request(),fetchImpl:fake,pollMs:1});
  assert.equal(attempts,2);assert.match(graphs[1]['3'].inputs.prompt,/遗漏或错用了参考图/);
  assert.deepEqual(r.artDirection.references.map(r=>r.source),[2,5]);
  assert.deepEqual(r.artDirection.editEnhancer.sourceOrder,[2,5]);
  assert.equal(r.artDirection.editEnhancer.model,ART_EDIT_MODEL);assert.equal(calls.filter(x=>x.endsWith('/upload/image')).length,2);
});
test('unequal analysis previews never reach ImageBatch or sampling',async()=>{
  const p=request();p.images[1].dataUrl=png(64);let submitted=false;
  const fake=async(url)=>{if(url.endsWith('/prompt'))submitted=true;return new Response(JSON.stringify(url.endsWith('/queue')?{queue_running:[],queue_pending:[]}:{name:'complete.png'}));};
  await assert.rejects(planArtEdit({baseUrl:'http://local',payload:p,fetchImpl:fake}),/未执行中心裁剪/);
  assert.equal(submitted,false);
});
test('cancelling a pending PE job deletes only that job and never interrupts another generation',async()=>{
  let submitted=false,checks=0;const writes=[];
  const fake=async(url,init={})=>{
    if(init.method==='POST')writes.push([url,init.body]);
    if(url.endsWith('/queue')&&!init.method)return new Response(JSON.stringify(submitted?{queue_running:[[0,'other-user']],queue_pending:[[1,'own-pe']]}:{queue_running:[],queue_pending:[]}));
    if(url.endsWith('/upload/image'))return new Response(JSON.stringify({name:'complete.png'}));
    if(url.endsWith('/prompt')){submitted=true;return new Response(JSON.stringify({prompt_id:'own-pe'}));}
    if(url.endsWith('/queue'))return new Response(null,{status:200});
    assert.fail(url);
  };
  await assert.rejects(planArtEdit({baseUrl:'http://local',payload:request(),fetchImpl:fake,isCancelled:()=>++checks>2}),/已中止/);
  assert.equal(writes.some(([url])=>url.endsWith('/interrupt')),false);
  assert.deepEqual(JSON.parse(writes.find(([url])=>url.endsWith('/queue'))[1]),{delete:['own-pe']});
});
