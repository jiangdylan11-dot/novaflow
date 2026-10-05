import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = name => readFileSync(new URL('../../renderer/' + name, import.meta.url), 'utf8');
function environment({ ui = true, references = [{id:'default-layout',role:'layout',dataUrl:'data:image/png;base64,default-layout'}], optimize, qwen = false } = {}) {
  const calls = [], failures = [], builds = [], uploads = [];
  const state = { provider:'local',mode:'img2img',prompt:'设计一个角色装备界面',negativePrompt:'不要模糊',width:1280,height:720,count:2,randomSeed:false,seed:17,nsfw:false,loras:[{name:'example',strength:0.7}],samplingOverrides:{'qwen-2.1:img2img':{steps:32,cfg:3}},results:[] };
  const noop = () => {};
  const sandbox = { AbortController, console, URLSearchParams, setTimeout, clearTimeout, ART_GENERATE_STATE:state,
    document:{ body:{classList:{contains:()=>ui}},querySelector:()=>ui ? {} : null },
    NovaFlowArtGenerateModels:{normalizeProvider:p=>p,capabilityFor:()=>({engine:qwen ? 'qwen-2.1' : ''})},
    NovaFlowUiDesignAssistantWorkflow:{run:async input=>{ calls.push('optimize'); return optimize ? optimize(input) : {prompt:'按参考图设计完整 UI',negativePrompt:'自动负面', ...(qwen ? {uiPlan:planFor(input.references)} : {})}; }},
    NovaFlowArtQualityProfile:{compileFinal:input=>{calls.push('drawing-quality');return input;}},
    captureArtGeneratePromptSnapshot:()=>({prompt:state.prompt,negativePrompt:state.negativePrompt}),
    artGenerateReferences:()=>references,artGenerateReferenceLimit:()=>10,artGenerateProviderTitle:p=>p,
    resetArtGenerateProgress:noop,setArtGenerateProgress:noop,setArtGenerateStatus:(text,error)=>{if(error)failures.push(text);},
    compileArtGeneratePromptMentions:(_refs,text,snapshot)=>({text,invalidTokens:[],snapshot}),addArtGeneratePromptHistory:noop,
    beginArtGenerateRun:()=>1,isArtGenerateRunCurrent:()=>true,detectArtGenerateBaseUrl:async()=> 'http://test',
    artDataUrlMime:()=> 'image/png',artUploadDataUrl:async(_base,name,dataUrl)=>{calls.push('upload');uploads.push({name,dataUrl});return name;},
    loadNovaflowArtExportImage:async()=>({naturalWidth:1024,naturalHeight:1024}),
    normalizeArtGenerateCount:n=>n,buildArtGenerateWorkflowWithSeed:(_seed,build)=>build(),
    buildArtGenerateRunWorkflow:(...args)=>{builds.push(args);return {workflow:{},modelKey:'drawing'};},
    applyArtReferenceControlNet:()=>({applied:0}),validateArtWorkflowNodes:async()=>{},
    withArtGenerateTimeout:task=>task(),artRequestJson:async(_base,path)=>{calls.push(path);return {ok:true,data:path==='/prompt'?{prompt_id:'test'}:{test:{}}};},
    artHistoryErrorMessage:()=>'',extractArtGenerateFiles:()=>[{filename:'result.png'}],artFetchBlob:async()=>({}),
    artBlobToDataUrl:async()=> 'data:image/png;base64,result',artWorkflowKey:()=> 'drawing',
    placeArtGenerateResultIntoSource:async()=>true,renderArtGenerateSurfaces:noop,clearArtGenerateBatch:noop,clearArtGenerateRunIfCurrent:noop,
    artGenerateBatchProgress:label=>({label,pct:0}),addEventListener:noop,removeEventListener:noop,
    ART_GENERATE_WORKFLOW_TIMEOUT_MS:1,ART_GENERATE_PROMPT_TIMEOUT_MS:1,ART_GENERATE_HISTORY_TIMEOUT_MS:1,ART_GENERATE_DOWNLOAD_TIMEOUT_MS:1,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source('ui-design-prompt.pipeline.js'),sandbox);
  vm.runInContext(source('ui-design.drawing.js'),sandbox);
  const brand = source('novaflow-brand-runtime.js');
  vm.runInContext(brand.slice(brand.indexOf('  function resolveArtGenerateReferenceInputs('), brand.indexOf('  async function runArtGenerate(')),sandbox);
  vm.runInContext(brand.slice(brand.indexOf('  async function runArtGenerate('), brand.indexOf('  function createArtGenerateExecutionBridge()')),sandbox);
  return { sandbox,state,calls,failures,builds,uploads,run:()=>sandbox.runArtGenerate(),adapter:sandbox.NovaFlowUiDesignDrawing };
}

test('UI uses the real drawing batch path and preserves sampling, LoRA, size, negative prompt and seeds',async()=>{
  const refs = [{id:'layout',uiLayoutId:'L',dataUrl:'data:image/png;base64,layout',uiStructure:{width:1280,height:720,regions:[{name:'角色',purpose:'展示人物',x:20,y:10,width:400,height:600}]}},{id:'style',dataUrl:'data:image/png;base64,style'}];
  const e = environment({references:refs});
  await e.run();
  assert.deepEqual(e.failures,[]);
  assert.equal(e.calls.filter(x=>x==='optimize').length,1);
  assert.equal(e.calls.filter(x=>x==='/prompt').length,2);
  assert.equal(e.calls.includes('drawing-quality'),false);
  assert.equal(e.builds.length,2);
  for (const [index,args] of e.builds.entries()) {
    assert.equal(args[1],'img2img');assert.equal(args[2].length,2);
    assert.match(args[4],/展示人物/);assert.equal(args[5],'不要模糊');
    assert.equal(args[8].width,1280);assert.equal(args[8].height,720);assert.equal(args[8].seed,17+index);
    assert.equal(args[8].samplingOverrides['qwen-2.1:img2img'].steps,32);assert.equal(args[8].loras[0].strength,0.7);
  }
  assert.equal(e.state.results.length,2);assert.equal(e.state.prompt,'设计一个角色装备界面');
});

function planFor(refs, patch={}) {
  return {version:1,layoutMode:refs.length ? 'preserve' : 'create',layoutReference:refs.length ? 1 : 0,
    visualMode:'theme-redesign',references:refs.map((r,i)=>({index:i+1,role:r.role === 'style' ? 'style' : r.role === 'layout' ? 'layout' : 'combined'})),layoutChanges:[],preserve:[],...patch};
}

test('single UI reference follows its layout role despite a wrong AI plan',async()=>{
  const refs=[{dataUrl:'data:image/png;base64,ref',role:'reference'}];
  const request='参考图1的布局，生成一个高质量的2次元风格，生肖牛主题的老虎机。';
  const e=environment({qwen:true,references:refs,optimize:async()=>({prompt:'将旧主题全部换成生肖牛主题。',uiPlan:{...planFor(refs),layoutMode:'create',layoutReference:0,references:[{index:1,role:'style'}],layoutChanges:['重新排版']}})});
  e.state.prompt=request;
  const prepared=await e.adapter.prepare({state:e.state,references:refs,referenceLimit:10});
  assert.equal(prepared.uiPlan.layoutMode,'preserve');
  assert.equal(prepared.uiPlan.layoutReference,1);
  assert.equal(prepared.uiPlan.visualMode,'theme-redesign');
  assert.equal(prepared.uiPlan.references[0].role,'layout');
  assert.deepEqual(Array.from(prepared.uiPlan.layoutChanges),[]);
  assert.equal(prepared.references.length,1);
  assert.match(prepared.promptSnapshot.prompt,/保留玩法拓扑、网格行列数量、控件数量与功能、信息层级及主要区域锚点/);
  assert.throws(()=>e.sandbox.NovaFlowUiDesignPromptPipeline.normalizeQwenPlan(null,{references:refs,prompt:'参考图1，人物缩小20%，其余布局一样。'}),/规划不完整/);
});

test('Qwen partial layout changes retain protected areas without a global position lock',async()=>{
  const refs=[{dataUrl:'data:image/png;base64,ref',role:'layout'}];
  const e=environment({qwen:true,references:refs,optimize:async()=>({prompt:'人物缩小20%，符号区上移，奖池和底部操作栏保持原位。',uiPlan:planFor(refs,{layoutMode:'partial',layoutChanges:['人物缩小20%','符号区上移'],preserve:['奖池和底部操作栏保持原位']})})});
  e.state.prompt='人物缩小20%，符号区上移，其他不变';await e.run();
  assert.deepEqual(e.failures,[]);assert.equal(e.builds[0][8].uiLayoutMode,'partial');
  assert.match(e.builds[0][4],/只调整这些布局项目：人物缩小20%；符号区上移/);
  assert.doesNotMatch(e.builds[0][4],/沿用布局参考图的全部区域|本次是局部修改，沿用全部/);
});

test('Qwen sends the second layout image first and retains the style image in native inputs',async()=>{
  const refs=[{dataUrl:'data:image/png;base64,style',role:'style'},{dataUrl:'data:image/png;base64,layout',role:'layout'}];
  const e=environment({qwen:true,references:refs,optimize:async()=>({prompt:'用@参考图1的卡通风格，沿用@参考图2的结构。',uiPlan:planFor(refs,{layoutReference:2})})});
  e.state.prompt='用@参考图1的卡通风格，沿用@参考图2的布局';
  const prepared=await e.adapter.prepare({state:e.state,references:refs,referenceLimit:10});
  assert.equal(prepared.references.length,2);assert.equal(prepared.references[0].role,'layout');
  assert.equal(prepared.references[1].dataUrl,refs[0].dataUrl);
  assert.match(prepared.promptSnapshot.prompt,/用<image2>的卡通风格，沿用<image1>的结构/);
  assert.doesNotMatch(prepared.promptSnapshot.prompt,/@参考图|用户设计需求|[\r\n]/);
  assert.equal(prepared.state.uiNativeEditPrompt,true);
  assert.equal(e.state.prompt,'用@参考图1的卡通风格，沿用@参考图2的布局');
});

test('Qwen treats its sole image as mandatory layout even when marked style or a planner requests creation',async()=>{
  const refs=[{dataUrl:'data:image/png;base64,style',role:'style'}];
  const e=environment({qwen:true,references:refs,optimize:async()=>({prompt:'按卡通视觉设计新页面。',uiPlan:planFor(refs,{layoutMode:'create',layoutReference:0})})});
  await e.run();assert.deepEqual(e.failures,[]);assert.equal(e.builds[0][8].uiPreserveLayout,true);
  assert.match(e.builds[0][4],/编辑画布，是唯一玩法结构与主要区域锚点依据/);
  assert.equal(e.builds[0][2].length,1);assert.equal(e.uploads[0].dataUrl,refs[0].dataUrl);
  for(const patch of [{uiPlan:null},{uiPlan:planFor(refs)}, {uiPlan:planFor(refs,{layoutMode:'partial',layoutChanges:['按钮上移'],preserve:[]})}]) {
    const recovered=environment({qwen:true,references:refs,optimize:async()=>({prompt:'设计',...patch})});
    await recovered.run();assert.deepEqual(recovered.failures,[]);assert.ok(recovered.builds.length>0);
    assert.equal(recovered.builds[0][8].uiPreserveLayout,true);
  }
});

test('Qwen planning cache separates generation engines and rejects missing references',()=>{
  const e=environment(),p=e.sandbox.NovaFlowUiDesignPromptPipeline;
  const input={references:[{role:'layout'}],prompt:'参考@参考图2'};
  assert.notEqual(p.key({...input,targetEngine:'qwen-2.1'}),p.key({...input,targetEngine:''}));
  assert.throws(()=>p.compileQwenPlan({prompt:'设计',uiPlan:planFor(input.references)},input),/不存在的参考图/);
});

test('Qwen native editing carries supplied layout facts and maps all image identifier forms once',()=>{
  const e=environment(),p=e.sandbox.NovaFlowUiDesignPromptPipeline;
  const references=[{role:'style'},{role:'layout'}];
  const input={references,prompt:'参考图2是画布，用<image1>的风格'};
  const result={prompt:'将参考图2改成海盗主题，图1只提供材质。',uiPlan:planFor(references,{layoutReference:2,preserve:['符号区6列5行','四个奖池','五个底部按钮']})};
  const compiled=p.compileQwenPlan(result,input);
  assert.match(compiled.prompt,/将<image1>改成海盗主题，<image2>只提供材质/);
  assert.match(compiled.prompt,/符号区6列5行；四个奖池；五个底部按钮/);
  assert.doesNotMatch(compiled.prompt,/@参考图|参考图2|[\r\n]/);
  assert.equal((compiled.prompt.match(/符号区6列5行/g)||[]).length,1);
  assert.throws(()=>p.compileQwenPlan({...result,prompt:'参考图3'},input),/不存在的参考图/);
  const single=p.compileQwenPlan({prompt:'编辑<image1>的按钮颜色',uiPlan:planFor([{role:'layout'}])},{references:[{role:'layout'}],prompt:'图1按钮变蓝'});
  assert.match(single.prompt,/编辑图片的按钮颜色/);
  assert.doesNotMatch(single.prompt,/<image/);
});

test('vision grid estimates never become a template while explicit user changes survive',()=>{
  const e=environment(),p=e.sandbox.NovaFlowUiDesignPromptPipeline;
  const references=[{role:'layout'}];
  const result={prompt:'将符号区调整为4列3行，其他区域不变。',uiPlan:planFor(references,{layoutMode:'partial',layoutChanges:['符号区调整为4列3行'],preserve:['其余区域不变'],grids:[{description:'模型估计的符号区',columns:6,rows:7}]})};
  const compiled=p.compileQwenPlan(result,{references,prompt:'符号区改成4列3行'});
  assert.match(compiled.prompt,/4列3行/);
  assert.doesNotMatch(compiled.prompt,/6列7行|42个位置|网格保持/);
});

test('anchored Qwen edits preserve style pixels and isolate layout authority in native editing',async()=>{
  const refs=[{dataUrl:'data:image/png;base64,style',role:'style'},{dataUrl:'data:image/png;base64,layout',role:'layout'}];
  const e=environment({qwen:true,references:refs,optimize:async()=>({prompt:'将图1的水彩纸纹与柔和光影用于图2，保留图2每个角色物品。',uiPlan:planFor(refs,{layoutReference:2,visualMode:'style-transfer',grids:[{description:'物品格',columns:6,rows:5}]})})});
  const prepared=await e.adapter.prepare({state:e.state,references:refs,referenceLimit:10});
  assert.equal(prepared.references.length,2);assert.equal(prepared.references[0].role,'layout');
  assert.equal(prepared.references[1].role,'style');
  assert.match(prepared.promptSnapshot.prompt,/水彩纸纹与柔和光影/);
  assert.match(prepared.promptSnapshot.prompt,/<image2>是风格来源/);
  assert.match(prepared.promptSnapshot.prompt,/唯一几何布局依据/);
  assert.doesNotMatch(prepared.promptSnapshot.prompt,/@参考图|布局来源，美术按需求重做/);
  assert.equal(prepared.uiPlan.references.length,2);assert.equal(prepared.analysisUiPlan.references.length,2);
});

test('single-image whole-screen style transfer preserves the source pixels and human scope despite a valid wrong plan',async()=>{
  const refs=[{id:'original-ui',dataUrl:'data:image/png;base64,original-ui-pixels',role:'reference'}];
  const e=environment({qwen:true,references:refs,optimize:async()=>({prompt:'把整个界面统一换成手绘水彩纸纹。',
    uiPlan:planFor(refs,{layoutMode:'reflow',visualMode:'theme-redesign',layoutChanges:['改成通用格子模板']})})});
  e.state.prompt='参考图1，布局不变，只把整个界面风格换成手绘水彩';
  const prepared=await e.adapter.prepare({state:e.state,references:refs,referenceLimit:10});
  assert.equal(prepared.uiPlan.layoutMode,'preserve');assert.equal(prepared.uiPlan.visualMode,'style-transfer');
  assert.deepEqual(Array.from(prepared.uiPlan.layoutChanges),[]);
  assert.match(prepared.promptSnapshot.prompt,/保留画布内的原人物与物品身份、文案和功能/);
  assert.doesNotMatch(prepared.promptSnapshot.prompt,/改成通用格子模板/);
  await e.run();assert.deepEqual(e.failures,[]);
  assert.equal(e.uploads.length,1);assert.equal(e.uploads[0].dataUrl,refs[0].dataUrl);
  assert.equal(e.builds[0][2].length,1);assert.equal(e.builds[0][8].uiPreserveLayout,true);
  assert.equal(e.builds[0][8].uiRunIntent,'style-transfer');
});

test('explicit new theme keeps gameplay anchors and replaces content despite the style selector and a wrong assistant plan',async()=>{
  const refs=[{id:'old-western-ui',dataUrl:'data:image/png;base64,old-western-original-pixels',role:'layout'}];
  const e=environment({qwen:true,references:refs,optimize:async()=>({prompt:'将图1的人物改为深海美人鱼，15格替换为9类海底物件，标题改为ABYSS GARDEN，做精致3D；保持金额与控制。',
    uiPlan:planFor(refs,{layoutMode:'reflow',visualMode:'style-transfer',layoutChanges:['新主题使用通用竖屏模板'],preserve:['符号区5列3行，共15格','原人物身份保持不变','原物品身份与顺序保持不变','原标题SUNSET OUTLAWS不变','人物展示区位置保持不变','金额和五个控制功能不变','新主题物品身份按用户指定的9类海底序列保持一致']})})});
  e.state.prompt='保留图1布局，换主题为深海美人鱼，人物、物品和标题全部替换，并把风格换成3D，金额与控制保持。';
  assert.equal(e.adapter.inputFor({state:e.state,references:refs,referenceLimit:10}).generationIntent,'style-transfer','the generic selector can still label this as a style edit');
  const prepared=await e.adapter.prepare({state:e.state,references:refs,referenceLimit:10});
  assert.equal(prepared.uiPlan.layoutMode,'preserve');assert.equal(prepared.uiPlan.visualMode,'theme-redesign');
  assert.deepEqual(Array.from(prepared.uiPlan.layoutChanges),[]);
  assert.match(prepared.promptSnapshot.prompt,/人物、背景、玩法物品和标题按用户的新主题要求重做/);
  assert.match(prepared.promptSnapshot.prompt,/深海美人鱼.*15格.*9类海底物件.*ABYSS GARDEN/);
  assert.match(prepared.promptSnapshot.prompt,/符号区5列3行，共15格；人物展示区位置保持不变；金额和五个控制功能不变/);
  assert.match(prepared.promptSnapshot.prompt,/新主题物品身份按用户指定的9类海底序列保持一致/);
  assert.doesNotMatch(prepared.promptSnapshot.prompt,/原人物身份保持不变|原物品身份与顺序保持不变|原标题SUNSET OUTLAWS|保留画布内的原人物与物品身份|通用竖屏模板/);
  await e.run();assert.deepEqual(e.failures,[]);
  assert.equal(e.builds[0][8].uiPreserveLayout,true);assert.equal(e.builds[0][8].uiLayoutMode,'preserve');
  assert.equal(e.builds[0][8].uiRunIntent,'redesign');
  assert.equal(e.uploads[0].dataUrl,refs[0].dataUrl);assert.match(e.builds[0][4],/本次是主题重设/);
  assert.match(e.builds[0][4],/标题、主框、奖励栏和按钮的轮廓、尺寸比例与装饰负形/);
  assert.doesNotMatch(e.builds[0][4],/沿用布局参考的区域位置、面积比例|保留几何布局和功能/);
});

test('theme form redesign releases planner frame measurements but preserves gameplay and human constraints',()=>{
  const e=environment(),p=e.sandbox.NovaFlowUiDesignPromptPipeline;
  const refs=[{role:'layout'}],prompt='保留图1的玩法布局，换成深海主题，标题主框奖励栏和按钮要有新的造型；用户明确要求主按钮直径120像素';
  const preserve=['符号区5列3行，共15格','五个底部控件的功能保持不变','标题在上方，金额信息层级保持不变','原主框矩形轮廓与宽高比例保持不变','奖励栏原尺寸和面积占比不变','按钮圆角和边框保持原样','用户明确要求主按钮直径120像素'];
  const input={references:refs,prompt,preserveLayout:true,generationIntent:'redesign',structure:{width:1000,height:1000,regions:[{purpose:'玩法区域',x:50,y:200,width:900,height:550}]}};
  const compiled=p.compileQwenPlan({prompt:'将图1重设为深海主题，保留玩法和金额。',uiPlan:planFor(refs,{preserve})},input);
  assert.deepEqual(Array.from(compiled.plan.preserve),preserve.filter(f=>!/原主框|奖励栏原尺寸|按钮圆角/.test(f)));
  assert.match(compiled.prompt,/玩法拓扑、网格行列数量、控件数量与功能、信息层级及主要区域锚点/);
  assert.match(compiled.prompt,/锚定区域内可创意重设计标题、主框、奖励栏和按钮的轮廓、尺寸比例与装饰负形/);
  assert.match(compiled.prompt,/点击目标可辨识，装饰不得遮挡玩法内容或控件/);
  assert.match(compiled.prompt,/主要区域锚点与用途（定位范围，不锁定组件外轮廓或尺寸比例）/);
  assert.match(compiled.prompt,/符号区5列3行，共15格；五个底部控件的功能保持不变；标题在上方，金额信息层级保持不变；用户明确要求主按钮直径120像素/);
  assert.doesNotMatch(compiled.prompt,/原主框矩形轮廓|奖励栏原尺寸|按钮圆角和边框|区域位置、面积比例|保留几何布局和功能|保留参考的整体构图、区域衔接与叠放关系/);
  // The image and native edit strategy stay anchored while its frame artwork changes.
  assert.equal(compiled.references[0],refs[0]);assert.equal(compiled.plan.layoutMode,'preserve');
  const guide=p.compileQwenPlan({prompt:'按定位图换成深海主题',uiPlan:planFor(refs,{preserve})},{...input,references:[{...refs[0],uiLayoutId:'guide'}]});
  assert.match(guide.prompt,/锚定区域内可创意重设计/);assert.match(guide.prompt,/不保留灰块和占位框/);
});

test('form freedom is scoped to theme redesign and never loosens style transfer or partial occupancy',()=>{
  const e=environment(),p=e.sandbox.NovaFlowUiDesignPromptPipeline,refs=[{role:'layout'}];
  const preserve=['原主框矩形轮廓与宽高比例保持不变','奖励栏原尺寸和面积占比不变','五个底部按钮功能不变'];
  const style=p.compileQwenPlan({prompt:'只把图1材质换成羊毛毡',uiPlan:planFor(refs,{visualMode:'theme-redesign',preserve})},{references:refs,prompt:'不换主题，只换风格为羊毛毡',preserveLayout:true,generationIntent:'style-transfer'});
  assert.equal(style.plan.visualMode,'style-transfer');assert.deepEqual(Array.from(style.plan.preserve),preserve);
  assert.match(style.prompt,/沿用布局参考的区域位置、面积比例、网格行列及功能数量；在原位置逐区处理视觉/);
  assert.doesNotMatch(style.prompt,/锚定区域内可创意重设计|不要求逐像素复刻原框体/);
  const partial=p.compileQwenPlan({prompt:'只修改奖励栏，其他区域保持不变',uiPlan:planFor(refs,{layoutMode:'partial',visualMode:'partial',layoutChanges:['奖励栏颜色'],preserve})},{references:refs,prompt:'只修改奖励栏颜色，其他区域保持不变',generationIntent:'iteration'});
  assert.equal(partial.plan.layoutMode,'partial');assert.deepEqual(Array.from(partial.plan.preserve),preserve);
  assert.match(partial.prompt,/其余区域的位置、占比、数量和功能关系保持参考图/);
  assert.doesNotMatch(partial.prompt,/锚定区域内可创意重设计|不要求逐像素复刻原框体/);
});

test('component redesign removes unrequested source construction from both planner facts and its editing directive',()=>{
  const e=environment(),p=e.sandbox.NovaFlowUiDesignPromptPipeline,refs=[{role:'layout'}];
  const preserve=['符号区5列3行，共15格','金额1000和四档奖励不变，四角铆钉保持原样','奖励牌原连接方式与底座保持不变','用户明确指定四角圆点保持不变','五个控制功能及选中状态不变'];
  const compiled=p.compileQwenPlan({prompt:'将图1换成深海主题，保留四角铆钉，原奖励牌的连接方式不变，金额1000保持正确，主框承托结构重新设计。',uiPlan:planFor(refs,{preserve})},
    {references:refs,prompt:'保留玩法和金额，将图1换成深海主题，组件构造重新设计',preserveLayout:true,generationIntent:'redesign'});
  assert.deepEqual(Array.from(compiled.plan.preserve),['符号区5列3行，共15格','金额1000和四档奖励不变','五个控制功能及选中状态不变']);
  assert.match(compiled.prompt,/主框承托结构重新设计/);assert.match(compiled.prompt,/金额1000保持正确/);
  assert.match(compiled.prompt,/组件构造、边框组织、连接方式、装饰承托与支撑结构、层间叠放和负空间/);
  assert.match(compiled.prompt,/保持目标完整画风与配色，并完成材质和光影/);
  assert.match(compiled.prompt,/通过轮廓、承托与连接关系的具体变化辨认新构造/);
  assert.doesNotMatch(compiled.prompt,/去掉颜色|去色|灰度输出|grayscale/);
  assert.doesNotMatch(compiled.prompt,/保留四角铆钉|四角铆钉保持原样|原奖励牌的连接方式不变|奖励牌原连接方式与底座|用户明确指定四角圆点保持不变/);
});

test('releasing a button diameter preserves balance and bet values from the same fact and directive',()=>{
  const e=environment(),p=e.sandbox.NovaFlowUiDesignPromptPipeline,refs=[{role:'layout'}];
  const compiled=p.compileQwenPlan({prompt:'换成深海主题，按钮直径120、余额1000和下注100保持不变。',uiPlan:planFor(refs,{preserve:['按钮直径120、余额1000和下注100保持不变']})},
    {references:refs,prompt:'保留玩法和金额，换成深海主题，组件构造重新设计',preserveLayout:true,generationIntent:'redesign'});
  assert.match(compiled.plan.preserve.join('；'),/余额1000保持不变.*下注100保持不变/);
  assert.match(compiled.prompt,/余额1000保持不变.*下注100保持不变/);
  assert.doesNotMatch(compiled.prompt,/按钮直径120/);
});

test('releasing symbol size preserves the repeated symbol count and identity from their shared clause',()=>{
  const e=environment(),p=e.sandbox.NovaFlowUiDesignPromptPipeline,refs=[{role:'layout'}];
  const compiled=p.compileQwenPlan({prompt:'换成深海主题，15个符号的大小与身份保持不变。',uiPlan:planFor(refs,{preserve:['15个符号的大小与身份保持不变']})},
    {references:refs,prompt:'保留玩法布局，换成深海主题，组件构造重新设计',preserveLayout:true,generationIntent:'redesign'});
  assert.deepEqual(Array.from(compiled.plan.preserve),['15个符号的身份保持不变']);
  assert.match(compiled.prompt,/15个符号的身份保持不变/);
  assert.doesNotMatch(compiled.prompt,/15个符号的大小/);
});

test('form-only redesign keeps theme identities and actual human shape restrictions despite planner paraphrasing',()=>{
  const e=environment(),p=e.sandbox.NovaFlowUiDesignPromptPipeline,refs=[{role:'layout'}];
  const prompt='主题不变，人物物品和金额保持，重新设计奖励栏与按钮的构造和连接方式，主按钮必须保持圆形，奖励牌保留四角圆点';
  for(const uiPlan of [planFor(refs,{preserve:['原人物身份保持不变','金额1000和功能保持不变','用户明确要求主按钮为圆形','用户明确指定四角铆钉保持不变']}),null]) {
    const compiled=p.compileQwenPlan({prompt:'重新设计图1组件，保持原主题和人物，奖励栏旧连接结构保持不变。',uiPlan},
      {references:refs,prompt,preserveLayout:true,generationIntent:'style-transfer'});
    assert.equal(compiled.plan.visualMode,'style-transfer');assert.equal(compiled.plan.layoutMode,'preserve');
    assert.match(compiled.prompt,/本次仅按用户要求重设计组件造型与构造/);
    assert.match(compiled.prompt,/原主题、人物与物品身份、有效文案、金额、规则、控制功能及其状态保持正确/);
    assert.match(compiled.prompt,/主按钮必须保持圆形；奖励牌保留四角圆点/);
    assert.doesNotMatch(compiled.prompt,/奖励栏旧连接结构保持不变|用户明确指定四角铆钉保持不变|本次是主题重设|人物、背景、玩法物品和标题按用户的新主题要求重做/);
  }
});

test('negated form requests and local edits cannot turn style migration into whole-screen construction redesign',()=>{
  const e=environment(),p=e.sandbox.NovaFlowUiDesignPromptPipeline,refs=[{role:'layout'}];
  const preserve=['四角铆钉与原连接方式保持不变','金额1000和控制功能不变'];
  for(const prompt of ['只换画风，不要重新设计按钮造型','按钮造型不需要改变，只换材质','奖励栏构造不要重做，只换风格','Do not redesign button shapes; only restyle the materials']) {
    const compiled=p.compileQwenPlan({prompt:'只改材质',uiPlan:planFor(refs,{preserve})},{references:refs,prompt,preserveLayout:true,generationIntent:'style-transfer'});
    assert.deepEqual(Array.from(compiled.plan.preserve),preserve);
    assert.doesNotMatch(compiled.prompt,/本次仅按用户要求重设计组件造型|通过轮廓、承托与连接关系的具体变化辨认新构造/);
  }
  const local=p.compileQwenPlan({prompt:'只重做按钮造型，其余不变',uiPlan:planFor(refs,{layoutMode:'partial',visualMode:'partial',layoutChanges:['仅重做主按钮轮廓'],preserve})},
    {references:refs,prompt:'只重做按钮造型，其余不变',generationIntent:'iteration'});
  assert.match(local.prompt,/只调整这些布局项目：仅重做主按钮轮廓/);
  assert.doesNotMatch(local.prompt,/组件构造、边框组织、连接方式、装饰承托与支撑结构/);
});

test('English source construction is filtered without losing functional facts or the human keep request',()=>{
  const e=environment(),p=e.sandbox.NovaFlowUiDesignPromptPipeline,refs=[{role:'layout'}];
  const preserve=['Keep 5 columns and 3 rows with 15 symbols','Keep the four reward values and functional connections unchanged; preserve the original rectangular plaques and corner studs','Preserve original frame construction and connectors','Keep the main button circular'];
  const compiled=p.compileQwenPlan({prompt:'Change the theme to underwater. Preserve the original four-corner studs and rectangular plaques. Keep the main button circular. Rebuild the reward supports.',uiPlan:planFor(refs,{preserve})},
    {references:refs,prompt:'Change the theme to underwater; keep the gameplay and values; keep the main button circular',preserveLayout:true,generationIntent:'redesign'});
  assert.match(compiled.prompt,/Keep 5 columns and 3 rows with 15 symbols/);
  assert.match(compiled.prompt,/Keep the four reward values and functional connections unchanged/);
  assert.match(compiled.prompt,/Keep the main button circular/);
  assert.match(compiled.prompt,/Rebuild the reward supports/);
  assert.doesNotMatch(compiled.prompt,/Preserve the original four-corner studs|rectangular plaques|original frame construction and connectors/);
});

test('every native UI plan requires a layout image and rejects create or missing-layout bypasses',()=>{
  const e=environment(),p=e.sandbox.NovaFlowUiDesignPromptPipeline,refs=[{role:'style'}];
  const compiled=p.compileQwenPlan({prompt:'依据图1纸纹设计新界面，五列三行和四档奖励按用户需求安排。',uiPlan:planFor(refs,{layoutMode:'create',layoutReference:0})},
    {references:refs,prompt:'图1只提供剪纸材质，设计全新界面',preserveLayout:false,generationIntent:'redesign'});
  assert.equal(compiled.plan.layoutMode,'preserve');assert.equal(compiled.plan.layoutReference,1);
  assert.equal(compiled.plan.references[0].role,'layout');
  assert.match(compiled.prompt,/编辑画布，是唯一玩法结构与主要区域锚点依据/);
  assert.match(compiled.prompt,/组件构造、边框组织、连接方式、装饰承托与支撑结构/);
  assert.throws(()=>p.normalizeQwenPlan(planFor(refs,{layoutMode:'create',layoutReference:0}),{references:refs}),/规划不完整/);
  assert.throws(()=>p.compileQwenPlan({prompt:'纯文字创建UI',uiPlan:null},{references:[],prompt:'纯文字创建UI'}),/必须有布局图/);
  assert.throws(()=>p.compileQwenPlan({prompt:'素材创建UI',uiPlan:null},{references:[{role:'style'},{role:'asset'}],prompt:'素材创建UI'}),/缺少布局图/);
  const ordinary=[{id:'style',role:'style'},{id:'main',role:'reference'},{id:'other',role:'reference'}];
  const anchored=p.compileQwenPlan({prompt:'按主图布局重设计',uiPlan:null},{references:ordinary,prompt:'按主图布局重设计'});
  assert.equal(anchored.references[0].id,'main');assert.equal(anchored.analysisPlan.layoutReference,2);
});

test('theme reset survives malformed planning and keeps style assets separate from the source geometry',()=>{
  const e=environment(),p=e.sandbox.NovaFlowUiDesignPromptPipeline;
  const refs=[{role:'style',id:'paper-material'},{role:'layout',id:'old-layout'}];
  for (const prompt of ['图2布局不变，主题重设为月宫灯会，图1只提供剪纸风格','保留图2布局，换成全新赛博主题，图1提供霓虹风格','图2布局不变，换个深海美人鱼主题','图2布局不变，换真正主题并替换人物和物品','不要旧主题，图2布局不变，换成深海主题','图2布局不变，将主题换成星际女驾驶员','Keep image2 layout; re-theme it with lunar characters, objects and title','Change the theme to an underwater world, replace characters and objects but keep layout']) {
    const output=p.compileQwenPlan({prompt,uiPlan:null},{references:refs,prompt,preserveLayout:true,generationIntent:'style-transfer'});
    assert.equal(output.plan.visualMode,'theme-redesign');assert.equal(output.plan.layoutMode,'preserve');
    assert.equal(output.references[0].id,'old-layout');assert.equal(output.references[1].id,'paper-material');
    assert.match(output.prompt,/<image2>是风格来源，只迁移美术表现/);
    assert.match(output.prompt,/本次是主题重设/);assert.doesNotMatch(output.prompt,/保留画布内的原人物与物品身份/);
  }
});

test('negated theme replacement remains a content-preserving style transfer',()=>{
  const e=environment(),p=e.sandbox.NovaFlowUiDesignPromptPipeline;
  const refs=[{role:'layout'}];
  for (const prompt of ['不换主题，只把风格换成羊毛毡','不要更换主题，人物物品与标题保持，只换画风','主题不变，换风格为明亮扁平','只换风格但保留原主题','只换画风，不改主题','不要换成深海主题，只把画风换成羊毛毡','不需要换新主题','无需更换主题','并非换主题','保留原主题，不要换一个新的主题','不要把主题换成深海，只换羊毛毡画风','Do not change the theme; only restyle the materials','No theme redesign, only a felt style transfer']) {
    const output=p.compileQwenPlan({prompt,uiPlan:planFor(refs,{visualMode:'theme-redesign'})},{references:refs,prompt,preserveLayout:true,generationIntent:'style-transfer'});
    assert.equal(output.plan.visualMode,'style-transfer');assert.match(output.prompt,/保留画布内的原人物与物品身份、文案和功能/);
    assert.doesNotMatch(output.prompt,/本次是主题重设/);
  }
});

test('layout plus style, color, material and scoped assets all reach the actual drawing upload path in native order',async()=>{
  const refs=['style','material','character','layout','color','content'].map(role=>({id:role,role,dataUrl:'data:image/png;base64,'+role+'-original-pixels'}));
  const uiPlan={version:1,layoutMode:'preserve',layoutReference:4,visualMode:'theme-redesign',
    references:['style','style','asset','layout','style','content'].map((role,i)=>({index:i+1,role})),layoutChanges:[],preserve:[]};
  const e=environment({qwen:true,references:refs,optimize:async()=>({prompt:'以图4布局完成全界面；图1提供美术，图2提供纸纹，图3的人物只融合左侧指定区域，图5提供配色，图6提供指定元素。',uiPlan})});
  e.state.prompt='沿用图4布局，用图1风格、图2纸纹、图5配色，人物图3和元素图6只用于左侧展示区';
  const prepared=await e.adapter.prepare({state:e.state,references:refs,referenceLimit:10});
  e.state.count=1;await e.run();assert.deepEqual(e.failures,[]);
  assert.deepEqual(e.uploads.map(u=>u.dataUrl),[refs[3],refs[0],refs[1],refs[2],refs[4],refs[5]].map(r=>r.dataUrl));
  assert.equal(e.builds[0][2].length,6);
  const native=e.builds[0][4];
  assert.match(native,/<image1>是编辑画布，是唯一玩法结构与主要区域锚点依据/);
  assert.match(native,/<image2>是风格来源/);assert.match(native,/<image3>是质感来源/);
  assert.match(native,/<image5>是配色来源/);
  assert.match(native,/<image4>是人物或元素素材来源，只融合用户指定区域/);
  assert.match(native,/<image6>是人物或元素素材来源，只融合用户指定区域/);
  assert.match(native,/不带入素材的背景、布局、文案或额外控件/);
  assert.equal((native.match(/唯一玩法结构与主要区域锚点依据/g)||[]).length,1);
  assert.equal(prepared.uiPlan.references.length,6);
  assert.equal(prepared.analysisUiPlan.layoutReference,4);
  assert.equal(e.state.results.length,1);
  assert.equal(e.state.prompt,'沿用图4布局，用图1风格、图2纸纹、图5配色，人物图3和元素图6只用于左侧展示区');
});
test('module names stay in the editor and never enter assistant or generation payloads',async()=>{
  const region = {name:'仅用户识别的内部标签',title:'旧标题',label:'旧标签',purpose:'辅助导航',requirements:'使用小号灰字',x:10,y:20,width:600,height:100,participates:false,locked:true};
  const refs = [{uiLayoutId:'L',dataUrl:'data:image/png;base64,layout',uiStructure:{width:1280,height:720,regions:[region]}}];
  let analysis;
  const e = environment({references:refs,optimize:async input=>{analysis=input;return {prompt:'生成 UI'};}});
  await e.run();
  assert.deepEqual(e.failures,[]);
  assert.doesNotMatch(JSON.stringify(analysis),/仅用户识别|旧标题|旧标签/);
  assert.equal(analysis.structure.regions[0].purpose,'辅助导航\n使用小号灰字');
  assert.equal(analysis.structure.regions[0].x,10);
  assert.doesNotMatch(e.builds[0][4],/仅用户识别|旧标题|旧标签/);
  assert.match(e.builds[0][4],/辅助导航/);
  assert.equal(region.name,'仅用户识别的内部标签','editor storage is untouched');
});

test('UI rejects missing layout before assistant calls or uploads and failures never submit generation',async()=>{
  const e = environment({references:[]});await e.run();assert.match(e.failures[0],/必须有布局图/);
  assert.equal(e.calls.filter(x=>x==='optimize').length,0);assert.equal(e.uploads.length,0);assert.equal(e.builds.length,0);
  const missing=environment({references:[{role:'style',dataUrl:'data:image/png;base64,style'},{role:'character',dataUrl:'data:image/png;base64,character'}]});
  await missing.run();assert.match(missing.failures[0],/缺少布局图/);
  assert.equal(missing.calls.filter(x=>x==='optimize').length,0);assert.equal(missing.uploads.length,0);assert.equal(missing.builds.length,0);
  const failed = environment({optimize:async()=>{throw Error('service unavailable');}});await failed.run();
  assert.deepEqual(failed.failures,['service unavailable']);assert.equal(failed.builds.length,0);assert.equal(failed.state.running,false);
});
test('drawing retains its existing pipeline and never invokes UI optimization',async()=>{
  const e = environment({ui:false,references:[{dataUrl:'data:image/png;base64,ref'}]});await e.run();
  assert.deepEqual(e.failures,[]);assert.equal(e.calls.includes('optimize'),false);assert.equal(e.calls.includes('drawing-quality'),true);assert.equal(e.builds.length,2);
});

test('ordinary drawing refuses overflow before uploads instead of generating from a truncated set', async()=>{
  const e=environment({ui:false,references:Array.from({length:11},()=>({dataUrl:'data:image/png;base64,ref'}))});
  await e.run();
  assert.match(e.failures[0],/最多支持 10 张.*当前 11 张/);
  assert.equal(e.calls.includes('upload'),false);
  assert.equal(e.builds.length,0);
});

test('UI generation disables inherited NSFW without changing the drawing setting',async()=>{
  const e=environment({references:[{dataUrl:'data:image/png;base64,ref'}]});
  e.state.nsfw=true;
  await e.run();
  assert.deepEqual(e.failures,[]);
  assert.equal(e.builds[0][8].nsfw,false);
  assert.equal(e.state.nsfw,true);
  assert.equal(e.calls.filter(x=>x==='optimize').length,1);
});

test('full UI redesign keeps the original instruction even when optimization carries old scenery back',async()=>{
  let input;
  const e=environment({references:[{dataUrl:'data:image/png;base64,ref'}],optimize:async value=>{
    input=value;return {prompt:'木乃伊法老站在黄昏海面与巨浪前'};
  }});
  e.state.prompt='参考@参考图1做一个埃及木乃伊主题的老虎机，不需要保留任何元素';
  await e.run();
  assert.deepEqual(e.failures,[]);
  assert.equal(input.generationIntent,'redesign');
  assert.equal(e.builds[0][8].uiRunIntent,'redesign');
  assert.equal(e.builds[0][8].uiPreserveLayout,true);
  assert.match(e.builds[0][4],/人物展示区.*图标区/);
  assert.match(e.builds[0][4],/用户原始需求（最高优先级）：参考@参考图1做一个埃及木乃伊主题的老虎机，不需要保留任何元素/);
  assert.match(e.builds[0][4],/全部视觉元素都要重新设计/);
});

test('explicit local editing retains iteration intent without making drawing a redesign',async()=>{
  const e=environment({references:[{dataUrl:'data:image/png;base64,ref'}]});
  e.state.prompt='只修改旋转按钮颜色，其他保持不变';
  await e.run();
  assert.equal(e.builds[0][8].uiRunIntent,'iteration');
  assert.match(e.builds[0][4],/本次是局部修改/);
});
test('style changes preserve the layout and content instead of becoming a theme redesign',async()=>{
  const e=environment({references:[{dataUrl:'data:image/png;base64,ref'}],optimize:async()=>({prompt:'[布局与功能]错误的3列4行\n[区域设计]不应引入的新人物\n[视觉规范]手绘水彩纸纹'})});
  e.state.prompt='参考图1，只把风格换成手绘水彩';
  await e.run();
  assert.equal(e.builds[0][8].uiRunIntent,'style-transfer');
  assert.equal(e.builds[0][8].uiPreserveLayout,true);
  assert.match(e.builds[0][4],/本次是风格迁移：保留内容参考图/);
  assert.doesNotMatch(e.builds[0][4],/本次是完整 UI 重新设计/);
  assert.doesNotMatch(e.builds[0][4],/错误的3列4行|不应引入的新人物/);
  assert.match(e.builds[0][4],/手绘水彩纸纹/);
});

for(const provider of ['gpt','google']) test(`${provider} UI submits through the registered Web settlement bridge`,async()=>{
  const e=environment({references:[{dataUrl:'data:image/png;base64,ref'}]});
  e.state.provider=provider;
  e.sandbox.electronAPI={runtimeProviderUsageSettlement:'web-control-plane-v1'};
  await e.run();
  assert.deepEqual(e.failures,[]);
  assert.equal(e.builds[0][0],provider);
  assert.equal(e.calls.filter(value=>value==='/prompt').length,2);
});

test('cloud UI still refuses an unknown settlement bridge before submitting a generation',async()=>{
  const e=environment();e.state.provider='gpt';
  await e.run();
  assert.deepEqual(e.failures,['当前网页生成接口未就绪，请刷新页面后重试']);
  assert.equal(e.builds.length,0);
});
test('cancel during UI preparation stops before uploads and repeat click does not start a second run',async()=>{
  let resolve;
  const e = environment({optimize:()=>new Promise(r=>{resolve=r;})});
  const pending = e.run();await Promise.resolve();await Promise.resolve();await e.run();
  assert.equal(e.calls.filter(x=>x==='optimize').length,1);
  assert.equal(e.adapter.cancelPreparation(),true);await pending;
  resolve({prompt:'late'});assert.equal(e.builds.length,0);assert.equal(e.state.running,false);
});
test('reference gaps map to uploaded image order; overflow and missing mentions fail explicitly',()=>{
  const e = environment(), ref={dataUrl:'data:image/png;base64,a'};
  const input=e.adapter.inputFor({state:{prompt:'图3是风格图'},references:[ref,null,{...ref,id:'b'}],referenceLimit:10});
  assert.equal(input.prompt,'@参考图2是风格图');
  assert.throws(()=>e.adapter.inputFor({state:{prompt:'图2是风格'},references:[ref,null],referenceLimit:10}),/已移除/);
  assert.throws(()=>e.adapter.inputFor({state:{},references:[ref,ref],referenceLimit:1}),/最多支持/);
  const cloud=e.adapter.inputFor({state:{provider:'gpt',gptSize:'1536x1024'},references:[ref],referenceLimit:10});
  assert.equal(cloud.size.width,1536);assert.equal(cloud.size.height,1024);
  const partial=e.adapter.inputFor({state:{prompt:'只修改背景，不保留旧背景，其他部分保持不变'},references:[ref],referenceLimit:10});
  assert.equal(partial.generationIntent,'iteration');
  const reflow=e.adapter.inputFor({state:{prompt:'参考图1换新主题，并重新排版'},references:[ref],referenceLimit:10});
  assert.equal(reflow.preserveLayout,false);
  const keep=e.adapter.inputFor({state:{prompt:'只换风格，不改变布局，不要重新排版'},references:[ref],referenceLimit:10});
  assert.equal(keep.preserveLayout,true);
});
test('edits made while optimization is pending cannot change its parameter or original-text snapshot',async()=>{
  let finish;
  const e=environment({optimize:()=>new Promise(resolve=>{finish=resolve;})});
  const pending=e.adapter.prepare({state:e.state,references:[{role:'layout',dataUrl:'data:image/png;base64,ref'}],referenceLimit:10});
  await Promise.resolve();await Promise.resolve();
  e.state.width=2048;e.state.prompt='下一张的需求';e.state.samplingOverrides['qwen-2.1:img2img'].steps=50;
  finish({prompt:'优化指令'});
  const prepared=await pending;
  assert.equal(prepared.state.width,1280);assert.equal(prepared.state.samplingOverrides['qwen-2.1:img2img'].steps,32);
  assert.equal(prepared.originalPrompt,'设计一个角色装备界面');
});

test('only an already published matching layout is refreshed without appending a hidden guide',()=>{
 const e=environment({qwen:true}),structures=[];
 e.sandbox.NovaFlowUiDesignLayoutGuide={createCleanLayoutGuide:s=>{structures.push(s);return {dataUrl:'data:image/png;base64,current-layout'}}};
 const structure={width:1200,height:800,regions:[{x:70,y:90,width:400,height:600,purpose:'人物'}]};
 const refs=[{id:'style',role:'style',dataUrl:'data:image/png;base64,style'}];
 const unchanged=e.adapter.snapshotLayoutReferences(refs,'L',structure,1);
 assert.equal(unchanged.length,1);assert.equal(unchanged[0].id,'style');assert.equal(structures.length,0);
 const published={id:'published-layout',uiLayoutId:'L',role:'layout',dataUrl:'data:image/png;base64,stale'};
 const refreshed=e.adapter.snapshotLayoutReferences([published,refs[0]],'L',structure,2);
 assert.equal(refreshed.length,2);assert.equal(refreshed[0].dataUrl,'data:image/png;base64,current-layout');
 assert.equal(refreshed[0].id,'published-layout');assert.equal(refreshed[0].uiStructure.regions[0].x,70);
 assert.equal(published.dataUrl,'data:image/png;base64,stale');assert.equal(refs.length,1);
 assert.throws(()=>e.adapter.snapshotLayoutReferences([published,refs[0]],'L',structure,1),/包含自建布局图/);
 const input=e.adapter.inputFor({state:{...e.state,prompt:'图3是风格'},references:[null,null,refs[0]],referenceLimit:2});
 assert.equal(input.prompt,'@参考图1是风格');assert.equal(input.references.length,1);
 assert.equal(structures[0].blocks[0].purpose,'人物');
});

test('native Qwen treats a user layout as spatial guidance instead of preserving placeholder artwork',()=>{
 const e=environment({qwen:true}),p=e.sandbox.NovaFlowUiDesignPromptPipeline;
 const refs=[{role:'style'},{role:'layout',uiLayoutId:'L',uiStructure:{regions:[{}]}}];
 const input={references:refs,prompt:'按图2布局，用图1风格',structure:{width:1000,height:1000,regions:[{x:50,y:50,width:400,height:800,purpose:'人物展示'}]}};
 const output=p.compileQwenPlan({prompt:'设计完整角色界面',uiPlan:planFor(refs,{layoutReference:2,visualMode:'style-transfer'})},input);
 assert.equal(output.references.length,2);assert.equal(output.references[0].uiLayoutId,'L');
 assert.match(output.prompt,/自建布局定位图/);assert.match(output.prompt,/不保留灰块和占位框/);
 assert.match(output.prompt,/只呈现用户需求指定的最终文案、物品图案与功能控件/);
 assert.match(output.prompt,/区域名、诊断编号、示例文字、灰块与空白占位仅用于定位/);
 assert.match(output.prompt,/不得输出缺少功能图标的空白按钮/);
 assert.doesNotMatch(output.prompt,/保留画布内的原人物与物品身份、文案和功能|保留未要求修改的文字与功能/);
 assert.doesNotMatch(output.prompt,/拆.{0,3}素材|逐个生成/);
 const recovered=p.compileQwenPlan({prompt:'设计',uiPlan:planFor(refs,{layoutReference:1})},input);
 assert.equal(recovered.analysisPlan.layoutReference,2);
 assert.equal(recovered.references[0].uiLayoutId,'L');
});

test('native Qwen preserves finished screenshot copy but never diagnostic guide copy',()=>{
 const e=environment({qwen:true}),p=e.sandbox.NovaFlowUiDesignPromptPipeline;
 const refs=[{role:'layout',uiLayoutId:'guide-20',dataUrl:'data:image/png;base64,guide'},{role:'style',dataUrl:'data:image/png;base64,style'}];
 const input={references:refs,prompt:'图1提供20格位置，图2提供质感；成品标题JADE FORTUNE，不显示COMPACT SCENERY、R1C1；5按钮要有图标',preserveLayout:true,generationIntent:'style-transfer'};
 const result={prompt:input.prompt,uiPlan:planFor(refs,{visualMode:'style-transfer'})};
 const guide=p.compileQwenPlan(result,input);
 assert.equal(guide.references.length,2);assert.equal(guide.plan.layoutMode,'preserve');
 assert.match(guide.prompt,/最终文案、物品图案与功能控件/);
 assert.doesNotMatch(guide.prompt,/保留画布内的原人物与物品身份、文案和功能|保留未要求修改的文字与功能/);
 assert.ok(guide.prompt.endsWith('不得输出缺少功能图标的空白按钮。'));
 const screenshot=p.compileQwenPlan(result,{...input,references:refs.map(r=>({...r,uiLayoutId:undefined}))});
 assert.match(screenshot.prompt,/保留画布内的原人物与物品身份、文案和功能/);
 assert.ok(screenshot.prompt.endsWith('保留未要求修改的文字与功能。'));
});
