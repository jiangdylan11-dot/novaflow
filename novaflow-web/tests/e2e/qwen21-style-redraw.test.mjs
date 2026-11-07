// Style redraw: the online brain writes three short texts, the program assembles the prompt, the local generator runs it at CFG 3.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import {styleHairColour,buildStyleLight,buildStyleDrawing,decideStyleTime,buildQwen21NativeRewrite,buildStyleRedrawPrompt,buildStyleRelight,compileQwen21NativeRewrite,isStyleRedrawRoles,QWEN21_NATIVE_REWRITE,QWEN21_STYLE_REDRAW_POLICY,STYLE_NEGATIVE,STYLE_POLISH} from '../../packages/shared/src/qwen21-native-rewrite.mjs';

let passed=0,failed=0;
async function test(name,fn){
  try{await fn();passed++;console.log('ok  '+name);}
  catch(error){failed++;console.error('FAIL '+name+'\n'+error.stack);}
}
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const input={promptContract:QWEN21_NATIVE_REWRITE,qwenPromptMode:'img2img',currentPrompt:'把人物转成这个风格',requirements:'',negativePrompt:'',supportsNegativePrompt:true};
const system=prepared=>prepared.body.input[0].content[0].text;
const description='flat cel-shaded illustration, clean thin line art, hard two-tone shadows, flat smooth skin, hair in crisp grouped strands, moderate detail';
const content='a young woman with long wavy auburn hair, winking with a soft smile, a small beauty mark on her cheek, wearing a striped top, holding up a plastic cup, seated in an airport terminal at night';
const mood='warm-neutral soft lamp key light from the side, neutral brown shadows, a dim cosy atmosphere, mild contrast';
const redraw=buildStyleRedrawPrompt(description,mood,content);
const answer=(style=description,text=content,light=mood)=>({output_text:JSON.stringify({style_description:style,mood_description:light,content_description:text})});
const compile=(overrides={},response=answer(),roles=['subject','style'])=>compileQwen21NativeRewrite(response,buildQwen21NativeRewrite({...input,...overrides},'model',roles));

const liveR1='Golden hour outdoor setting, with warm low-angle sunlight casting soft, elongated shadows. The key light is a rich golden tone from the side, shadows carry a gentle cool undertone, contrast is moderate, and the sky glows with a bright warm amber hue';
const noView={time_of_day:'golden_hour',sun_visible:false,sky_visible:false,sky_description:''};
await test('golden hour with no sun or sky in the picture becomes midday, keeping the rest of the light',()=>{
  const decided=decideStyleTime(liveR1,noView);
  assert.equal(decided.time,'midday');assert.doesNotMatch(decided.line+decided.mood,/\bsky\b|golden|amber|elongated|low-angle/iu);
  assert.equal(decided.line,'Time of day: bright midday daylight. Every existing window and opening of <image1> is filled with bright pale daylight. The layout, walls, ceiling and openings of <image1> stay exactly as they are.');
  assert.match(decided.mood,/gentle cool undertone/u);assert.match(decided.mood,/contrast is moderate/u);assert.match(decided.mood,/white-gold tone from above/u);
  assert.ok(buildStyleRelight(liveR1,'<image2>',noView).startsWith(decided.line+' Lighting: take only'));
});
await test('golden hour with a sky but no low sun is still midday, and its sky words go',()=>{
  const live='Golden hour outdoor setting, with low warm golden key light coming from a side angle. Shadows are deep cool blue, contrast is strong, and the sky is a dark star-dotted night sky';
  const decided=decideStyleTime(live,{time_of_day:'golden_hour',sun_visible:false,sky_visible:true,sky_description:'dark night sky'});
  assert.equal(decided.time,'midday');assert.doesNotMatch(decided.line+decided.mood,/\bsky\b|night|golden hour/iu);assert.match(decided.line,/bright pale daylight/u);assert.match(decided.mood,/deep cool blue/u);
  assert.equal(decideStyleTime('dusk, lamps on',{time_of_day:'dusk',sun_visible:false,sky_visible:true}).time,'dusk','dusk with a sky in view stands');
});
await test('daytime with no sky in view drops every sky phrase whole',()=>{
  const seen='Midday light with a strong key from the upper left, casting short hard shadows. Contrast is high. No sky is shown; the background sits in shaded foliage and wood.';
  assert.equal(decideStyleTime(seen,{time_of_day:'midday',sun_visible:false,sky_visible:false}).mood,'Midday light with a strong key from the upper left, casting short hard shadows. Contrast is high.');
  const cut=decideStyleTime('Golden hour lighting, with warm sunlight casting soft shadows, the sky is deep dark blue, with bright highlights. Gentle contrast.',{time_of_day:'golden_hour',sun_visible:false,sky_visible:false}).mood;
  assert.doesNotMatch(cut,/dark blue|\bsky\b/iu);assert.match(cut,/Gentle contrast/u);
});
await test('the picked hair word replaces a warm colour, and an unknown pick changes nothing',()=>{
  assert.equal(styleHairColour('long wavy reddish-brown hair, smiling','brown'),'long wavy brown hair, smiling');
  assert.equal(styleHairColour('copper-red hair','dark_brown'),'dark brown hair');
  assert.equal(styleHairColour('auburn hair','other'),'auburn hair');
  assert.equal(styleHairColour('a red scarf and black hair','brown'),'a red scarf and brown hair','only the word before hair changes');
});
await test('a cut never leaves stubs when the light choices remain',()=>{
  const light={key:'hard',direction:'side',contrast:'high',shadow:'warm',skin:'satin',hair_depth:'layered'};
  const mood=decideStyleTime(buildStyleLight(light,'Afternoon, warm sunlight with deep shadow and no open sky'),{time_of_day:'afternoon',sun_visible:false,sky_visible:false}).mood;
  assert.ok(mood.startsWith('A hard direct key light from the side'));assert.doesNotMatch(mood,/no open|\bsky\b/iu);
});
await test('a time that stands keeps the brain sentence',()=>{
  const golden=decideStyleTime(liveR1,{time_of_day:'golden_hour',sun_visible:true,sky_visible:true});assert.equal(golden.time,'golden_hour');assert.equal(golden.mood,liveR1);
  const moon='Nighttime rainy scene lit by cool pale blue moonlight, a deep dark blue sky with thin clouds';
  const night=decideStyleTime(moon,{time_of_day:'night',sun_visible:false,sky_visible:true});assert.equal(night.time,'night');assert.equal(night.mood,moon);assert.match(night.line,/Lamps are the main light/u);
  const day=decideStyleTime('Midday bright sunlight, vivid blue sky with white clouds, cool shadows',{time_of_day:'midday',sun_visible:true,sky_visible:true});
  assert.equal(day.time,'midday');assert.match(day.mood,/vivid blue sky with white clouds/u);assert.doesNotMatch(day.line,/\bsky\b|pale/iu);assert.match(day.line,/Daylight enters through the existing windows/u);
});
await test('missing facts fall back to the mood words and never overrule it',()=>{
  assert.equal(decideStyleTime(liveR1).time,'golden_hour');assert.equal(decideStyleTime('neutral key light from above'),null);
  assert.equal(decideStyleTime('dusk, soft lamps',{time_of_day:'teatime'}).time,'dusk','an unknown time is ignored');
});
await test('the choices become the drawing words, with free text only as an addition or a fallback',()=>{
  const flat={genre:'flat_cel',line:'thin_uniform',shading:'two_step',highlight:'angular',hair:'ribbon',colour_layout:'flat',surface:'smooth'};
  const text=buildStyleDrawing(flat,'tiny star highlights');
  assert.ok(text.startsWith('bright flat cel anime illustration, uniform thin clean ink outline, strictly two-step hard-edged shadow shapes with no gradients'));assert.ok(text.endsWith(', tiny star highlights'));
  assert.equal(buildStyleDrawing({genre:'x',line:'y'},'free text'),'free text','too few valid picks fall back to the text');
  assert.equal(buildStyleDrawing(undefined,'free text.'),'free text');
  assert.ok(!buildStyleDrawing({...flat,shading:'unknown'}).includes('unknown'),'an unknown value is skipped');
  const prepared=buildQwen21NativeRewrite({promptContract:QWEN21_NATIVE_REWRITE,qwenPromptMode:'img2img',currentPrompt:'换风格',requirements:'',negativePrompt:'',supportsNegativePrompt:true},'m',['subject','style']);
  assert.deepEqual(prepared.body.text.format.schema.properties.drawing.required,['genre','line','shading','highlight','hair','colour_layout','surface']);
  const result=compileQwen21NativeRewrite({output_text:JSON.stringify({drawing:flat,style_description:'',mood_description:mood,content_description:content})},prepared);
  assert.ok(result.modelPrompt.includes('in this style: bright flat cel anime illustration'));
});
await test('light choices follow the mood words, and too few valid ones keep the mood alone',()=>{
  const light={key:'hard',direction:'side',contrast:'high',shadow:'warm',skin:'satin',hair_depth:'layered'};
  assert.equal(buildStyleLight(light,'Bright midday'),'Bright midday. a hard direct key light from the side, very high contrast with deep shadow masses, warm brown shadows, softly lit satin skin, hair in many layered strands with deep darks between them');
  const dropped=decideStyleTime(buildStyleLight(light,'Bright midday, no sky is shown'),{time_of_day:'midday',sun_visible:false,sky_visible:false}).mood;assert.match(dropped,/a hard direct key light/iu);assert.doesNotMatch(dropped,/\bsky\b/iu);
  assert.equal(buildStyleLight({key:'odd'},'Night.'),'Night');assert.equal(buildStyleLight(undefined,'Night'),'Night');
});
await test('the style brain reads the request, not the last picture\'s prompt',()=>{
  const old='Time of day: bright midday. Sky: Vivid bright blue sky dotted with fluffy white cumulus clouds.';
  const body=input=>JSON.parse(buildQwen21NativeRewrite({promptContract:QWEN21_NATIVE_REWRITE,qwenPromptMode:'img2img',negativePrompt:'',supportsNegativePrompt:true,...input},'m',['subject','style']).body.input[1].content[0].text);
  const sent=body({currentPrompt:old,requirements:'换成@参考图2的风格，改成海边'});
  assert.equal(sent.current_instruction,'换成@参考图2的风格，改成海边');assert.doesNotMatch(JSON.stringify(sent),/midday|cumulus/u);
  assert.equal(body({currentPrompt:'换风格',requirements:''}).current_instruction,'换风格','with no request text the prompt is all there is');
});
await test('the brain facts reach the prompt through the compile step',()=>{
  const prepared=buildQwen21NativeRewrite({promptContract:QWEN21_NATIVE_REWRITE,qwenPromptMode:'img2img',currentPrompt:'换风格',requirements:'',negativePrompt:'',supportsNegativePrompt:true},'m',['subject','style']);
  const result=compileQwen21NativeRewrite({output_text:JSON.stringify({style_description:description,mood_description:liveR1,content_description:content,time_of_day:'golden_hour',sun_visible:false,sky_visible:false,sky_description:''})},prepared);
  assert.ok(result.modelPrompt.includes('Time of day: bright midday daylight. Every existing window and opening'));
});
await test('style mode is chosen only for one subject first followed by style references',()=>{
  for(const roles of [['subject','style'],['subject','style','style']]){
    const prepared=buildQwen21NativeRewrite(input,'model',roles);
    assert.equal(prepared.styleRedraw,true,roles.join());assert.equal(prepared.referenceCount,roles.length);assert.equal(prepared.body.temperature,0);
    assert.deepEqual(prepared.body.text.format.schema.required,['drawing','hair_colour','light','style_description','mood_description','content_description','time_of_day','sun_visible','sky_visible']);
  }
  for(const roles of [['subject'],['style'],['style','subject'],['subject','pose'],['subject','style','pose'],['subject','subject','style'],[]])
    assert.equal(buildQwen21NativeRewrite(input,'model',roles).styleRedraw,undefined,roles.join());
  assert.equal(buildQwen21NativeRewrite({...input,qwenPromptMode:'txt2img'},'model',['subject','style']).styleRedraw,undefined);
  assert.equal(isStyleRedrawRoles(['subject','style']),true);
});

await test('the style system asks only for the three texts and bans the wording that darkens the result',()=>{
  const text=system(buildQwen21NativeRewrite(input,'model',['subject','style']));
  for(const needle of ['40-80 words','pick the one closest value for each field','genre: flat_cel, painterly, glossy, soft or watercolour','shading: soft_gradient, two_step, three_step, brush, hatching or wash','deciding in this order','Flat colour areas with hard-edged shadows is flat_cel','under 20 words on anything special','key: hard, soft or diffuse','when unsure between glossy and another, pick the other','Skin with no visible shine is matte','layered only if separate locks can be counted','hair_depth: flat, two or layered','under 15 words','Short hard shadows mean midday','golden hour only if a low sun is actually visible','Never state its time of day, sky, lighting or what shows through its windows','exact hair colour','any wink','facial marks','requested_changes','never by tags or __NF...__ placeholders'])
    assert.ok(text.includes(needle),needle);
  assert.doesNotMatch(text,/rendering medium|rewritten_prompt/);
  assert.match(system(buildQwen21NativeRewrite(input,'model',['subject'])),/rendering medium/,'ordinary edits keep their own rule');
});

await test('the program assembles the prompt from the three slots, then the fixed lighting and finish blocks',()=>{
  assert.ok(redraw.startsWith('Loosely based on <image1> (use it only for the person, pose and scene;'));
  assert.ok(redraw.includes(`An illustration in this style: ${description}. ${content}. `));assert.doesNotMatch(redraw,/key visual|strong contrast|rich saturated/u);
  assert.ok(redraw.includes(`take only the lighting design from <image2>: ${mood}. Colour appears`));
  assert.ok(redraw.includes('exists at that single time of day'));assert.ok(redraw.includes('Artificial lights may be on at any time of day'));assert.ok(redraw.includes('Never mix a daytime sky with a night-dark room'));assert.ok(redraw.includes('a scene is never a single hue'));assert.ok(redraw.includes('Every window shows that same sky across all its panes'));assert.ok(redraw.includes('only when that time is dusk or night is the sky dark'));assert.ok(!redraw.includes('at dusk or night the sky is dark'));assert.ok(redraw.includes('never the same hue as the light'));assert.ok(redraw.includes('never yellow or orange skin'));assert.ok(redraw.includes('the hair keeps exactly the colour named in the content description'));assert.ok(redraw.includes('Colour appears only where light actually falls'));assert.ok(redraw.includes('take their colours from <image2>. Everything else keeps its own true colour'));assert.ok(redraw.includes('Never a uniform colour cast, tint, wash, filter or haze'));assert.equal(redraw.match(/Never a uniform|Never tint/g).length,1,'the rule is stated once');assert.doesNotMatch(redraw,/Full tonal range/u);assert.doesNotMatch(redraw,/overall colour temperature/);
  assert.ok(redraw.endsWith(`${buildStyleRelight(mood)} ${STYLE_POLISH}`));
  assert.doesNotMatch(redraw,/keep the real light sources/,'the photo\'s light is not kept');
  assert.doesNotMatch(STYLE_POLISH,/beauty mark|\bcup\b|terminal/,'the finish block fits any picture');
  assert.equal(buildStyleRedrawPrompt(description+'. ',mood+'.',content+'.'),redraw,'a closing full stop is not doubled');
  const several=buildStyleRedrawPrompt(description,mood,content,3);
  assert.ok(several.includes('lighting design from <image2> and <image3>:'));
  assert.equal(compile({},answer(),['subject','style','style']).modelPrompt,several);
});

await test('the compiled result carries the policy, the one prompt and a program-owned negative',()=>{
  assert.match(STYLE_NEGATIVE,/skin pores.*3d render.*grainy, noise.*uniform color wash.*yellow skin, orange skin.*amber tint.*yellow tint$/);
  const result=compile();
  assert.equal(result.modelPromptPolicy,QWEN21_STYLE_REDRAW_POLICY);assert.equal(result.promptContract,QWEN21_NATIVE_REWRITE);
  assert.equal(result.displayPrompt,redraw);assert.equal(result.modelPrompt,redraw);assert.equal(result.styleDescription,description);assert.equal(result.contentDescription,content);assert.equal(result.moodDescription,mood);
  assert.equal(result.translationValidation,'native-edit-and-literals');assert.equal(result.modelPromptLanguage,'en');
  assert.equal(result.hasNegativePrompt,true);assert.equal(result.negativePrompt,STYLE_NEGATIVE);
  assert.equal(compile({negativePrompt:'水印'}).negativePrompt,'水印, '+STYLE_NEGATIVE,'the user text comes first');
  const again='水印, '+STYLE_NEGATIVE;assert.equal(compile({negativePrompt:again}).negativePrompt,again,'a rerun does not grow the negative');
  assert.equal(compile({supportsNegativePrompt:false}).negativePrompt,undefined);
});

await test('an incomplete style answer is rejected before it can be applied',()=>{
  assert.throws(()=>compile({},answer(' ')),/style description missing/);
  assert.throws(()=>compile({},answer(description,' ')),/content description missing/);
  assert.throws(()=>compile({},{output_text:JSON.stringify({style_description:description,rewritten_prompt:redraw})}),/content description missing/);
  assert.throws(()=>compile({},{output_text:'not json'}),/complete JSON/);
  assert.throws(()=>compile({},{output_text:'[]'}),/fields invalid/);
});

await test('a loose brain answer is cleaned instead of refused',()=>{
  const reply=(style,text=content,light=mood)=>({style_description:style,mood_description:light,content_description:text});
  const fenced=compile({},{output_text:'好的，结果如下：\n```json\n'+JSON.stringify(reply(description))+'\n```'});
  assert.equal(fenced.modelPrompt,redraw,'fences and leading text');
  const extra=compile({},{output_text:JSON.stringify({...reply(description),note:'x'})});assert.equal(extra.modelPrompt,redraw,'extra fields');
  const missing=compile({},{output_text:JSON.stringify({style_description:description,content_description:content})});
  assert.ok(missing.moodDescription.startsWith('neutral key light'),'a missing mood gets the neutral default');
  const words=compile({},answer('warm-toned flat cel shading, cool palette, dark thin outlines, two-tone shadows'));
  assert.equal(words.styleDescription,'flat cel shading, thin outlines, two-tone shadows','colour words go, two-tone stays');
  const chinese=compile({},answer('平涂赛璐璐，细线条','一位红棕色长卷发的女生，在机场'));assert.ok(chinese.modelPrompt.includes('平涂赛璐璐'),'Chinese is accepted');
  const long=compile({},answer(description,content+' extra'.repeat(600)));assert.ok(long.contentDescription.length<=1500,'over-long text is trimmed');
  const tags=compile({currentPrompt:'__NF_REF_1__的风格换成__NF_REF_2__的风格',requirements:'“字样”'},answer(description,'<image1> with __NF_REF_1__ at the airport'));
  assert.doesNotMatch(tags.modelPrompt,/__NF/);assert.ok(tags.contentDescription.includes('the picture'),'tags in the request or the answer never fail it');
});

await test('the browser checks accept exactly the policy the server exports',()=>{
  for(const file of ['../../renderer/novaflow-smart-ai.js','../../renderer/novaflow-web-runtime.js'])assert.ok(read(file).includes(`'${QWEN21_STYLE_REDRAW_POLICY}'`),file);
});

const modelSandbox={module:{exports:{}}};
runInContext(read('../../renderer/art-generate-model.resource.js'),createContext(modelSandbox));
const models=modelSandbox.module.exports;
const styleRun={taskProfile:'art-direction',referenceRoles:['subject','style']};

await test('one role rule sets CFG 3 on both 2.1 routes unless the user typed a value',()=>{
  assert.equal(models.STYLE_REDRAW_CONTENT_PIXELS,250000);assert.equal(models.STYLE_REDRAW_WORKING_PIXELS,1536*1152);
  const turbo={provider:'local',localDrawEngine:'qwen-2.1',localQwen21Variant:'turbo'},full={provider:'local',localDrawEngine:'qwen-2.1'};
  assert.equal(models.localSamplingFor(turbo,'img2img','',undefined,'drawing',styleRun).cfg,3);
  assert.equal(models.localSamplingFor(full,'img2img','',undefined,'drawing',styleRun).cfg,3);
  assert.equal(models.localSamplingFor(turbo,'img2img','',undefined,'drawing',{...styleRun,referenceRoles:['subject','style','style']}).cfg,3);
  for(const policy of [undefined,{taskProfile:'art-direction',referenceRoles:['subject']},{...styleRun,referenceRoles:['style','subject']},{...styleRun,referenceRoles:['subject','pose']},{...styleRun,taskProfile:'ui-design'}])
    assert.equal(models.localSamplingFor(turbo,'img2img','',undefined,'drawing',policy).cfg,1);
  assert.equal(models.localSamplingFor(turbo,'txt2img','',undefined,'drawing',styleRun).cfg,1);
  assert.equal(models.localSamplingFor(turbo,'img2img','',undefined,'ui',styleRun).cfg,1);
  const manual={...turbo,samplingOverrides:{'qwen-2.1-turbo:img2img':{cfg:2}}};
  assert.equal(models.localSamplingFor(manual,'img2img','',undefined,'drawing',styleRun).cfg,2);
});

const source=read('../../renderer/novaflow-brand-runtime.js');
const builderCode=source.slice(source.indexOf('  const ART_QWEN21_TURBO_UNETS ='),source.indexOf('  // UI design on a Qwen-Image-2.1 node:'));
function build(options,{state={},sizes=[{width:2000,height:1500},{width:2000,height:3000}],names=['a.png','b.png']}={}){
  const info={NovaFlowGGUFBF16Loader:{input:{required:{unet_name:[['qwen-image-2.1-UC-BF16.gguf']]}}},UNETLoader:{input:{required:{unet_name:[['Qwen-Image-2.1-Turbo-INT8-ConvRot-comfy.safetensors']],weight_dtype:[['default']]}}},CLIPLoader:{input:{required:{clip_name:[['qwen3vl_8b_bf16_heretic.safetensors']]}}},VAELoader:{input:{required:{vae_name:[['qwen_image_2.1_vae_bf16.safetensors']]}}},TextEncodeQwenImage21:{},KSampler:{},VAEDecode:{},SaveImage:{},ImageScale:{}};
  const vm=createContext({});vm.window={electronAPI:{__objectInfoSync:()=>info},NovaFlowArtGenerateModels:models};
  runInContext(read('../../renderer/qwen21-turbo.workflow.js'),vm);vm.window.NovaFlowQwen21Turbo=vm.NovaFlowQwen21Turbo;
  runInContext(builderCode,vm);
  const run={width:1280,height:960,localQwen21Variant:'turbo',negativePrompt:STYLE_NEGATIVE,...state};
  vm.run=run;vm.names=names;vm.sizes=sizes;vm.options=options;vm.sampling=models.localSamplingFor({...run,provider:'local',localDrawEngine:'qwen-2.1'},'img2img',run.negativePrompt,undefined,'drawing',options);
  return runInContext("buildArtQwen21Workflow('img2img',names,'QA','prompt',run,sizes,options,run.negativePrompt,sampling)",vm).workflow;
}
const sampler=graph=>Object.values(graph).find(node=>node.class_type==='SamplerCustom');

await test('the style run takes 0.25 MP content, a 1 MP style image, a 1536 x 1152 canvas delivered at W / H and CFG 3',()=>{
  const graph=build(styleRun);
  assert.equal(sampler(graph).inputs.cfg,3);assert.equal(graph['5'].inputs.negative_prompt,STYLE_NEGATIVE);
  assert.equal(graph['200'].inputs.width,576);assert.equal(graph['200'].inputs.height,416);
  assert.deepEqual(Array.from(sampler(graph).inputs.latent_image),['6',0]);assert.equal(graph['6'].inputs.width,1536);assert.equal(graph['6'].inputs.height,1152);
  assert.equal(graph['9'].inputs.width,1280);assert.equal(graph['9'].inputs.height,960);
  const tall=build(styleRun,{state:{width:960,height:1280}});assert.equal(tall['6'].inputs.width,1152);assert.equal(tall['6'].inputs.height,1536);
  const edit=build({taskProfile:'art-direction',referenceRoles:['subject','reference']});assert.equal(edit['9'],undefined,'an ordinary edit keeps its own working size');
  assert.ok(graph['201'].inputs.width*graph['201'].inputs.height<=1048576);assert.ok(graph['201'].inputs.width*graph['201'].inputs.height>700000);
  assert.equal(graph['5'].inputs.prompt,'prompt');
});

await test('several style images share the 1.5 MP total and an ordinary edit stays as it was',()=>{
  const graph=build({...styleRun,referenceRoles:['subject','style','style']},{sizes:[{width:2000,height:1500},{width:2000,height:3000},{width:3000,height:2000}],names:['a.png','b.png','c.png']});
  const pixels=id=>graph[id].inputs.width*graph[id].inputs.height;
  assert.ok(pixels('201')+pixels('202')<=1500000);assert.equal(sampler(graph).inputs.cfg,3);
  const edit=build({taskProfile:'art-direction',referenceRoles:['subject','reference']});
  assert.equal(sampler(edit).inputs.cfg,1);assert.ok(edit['201'].inputs.width*edit['201'].inputs.height<=500000);
});

await test('a reviewed draft reports the roles it will run with, and the draft prompt owns the role text',()=>{
  const box={NovaFlowArtGenerateModels:models};box.window=box;
  runInContext(read('../../renderer/art-prepare.workflow.js'),createContext(box));
  const draft={references:[{dataUrl:'x'},{dataUrl:'y'}],referenceRolePlan:{roles:['subject','style']}};
  assert.deepEqual(JSON.parse(JSON.stringify(box.NovaFlowArtPrepare.generationOptions(draft))),{taskProfile:'art-direction',referenceRoles:['subject','style'],styleRedraw:true});
  assert.match(source,/prepared\?\.promptOwnsReferenceRoles===true \? qualityCompiled\.prompt/);
});

await test('a style image in slot 1 still runs subject first, while the page keeps its own slot numbers',async()=>{
  const png=c=>'data:image/png;base64,'+c,refs=[{drawingRole:'style',dataUrl:png('AA=='),name:'style.png'},{drawingRole:'subject',dataUrl:png('BB=='),name:'photo.png'}];
  let prepared=null,request=null;
  const rt={state:{active:true,provider:'local',mode:'img2img',prompt:'用<image1>的风格重绘<image2>',negativePrompt:'',width:512,height:512,count:1,running:false,localQwen21Variant:'turbo'},references:()=>refs,selectedResult:()=>null,
    captureContext(){return {state:this.state,generationSurface:'drawing',routeRevision:1,referenceRevision:1};},captureAgentPreparedSnapshot:()=>({}),replaceAgentPrepared(_handle,value){prepared=value;return {};},restoreAgentPrepared(){},isAgentPreparedReplacementCurrent:()=>true,render(){}};
  const root={crypto:globalThis.crypto,console,TextEncoder,setTimeout,clearTimeout,__NovaFlowArtGenerate:rt,document:{querySelectorAll:()=>[]},NovaFlowArtGenerateModels:{capabilityFor:()=>({engine:'qwen-2.1-turbo'})},
    NovaFlowXiaotaoArtAgent:{panel:{controller:{businessModelSnapshot:()=>({provider:'api',modelId:'m',epoch:1})}}},electronAPI:{onlineVisionArtAvailableSync:()=>true,captureFoartSessionGuard:()=>()=>true},
    __NovaFlowSmartAI:{async optimizeForAgent(options){request=options;return {prompt:redraw,displayPrompt:redraw,negativePrompt:STYLE_NEGATIVE,analysisBackend:'runninghub',optimization:{reviewRequired:true,modelPromptPolicy:QWEN21_STYLE_REDRAW_POLICY}};}}};
  root.window=root;runInContext(read('../../renderer/xiaotao-foart-tools.js'),createContext(root));
  const tools=root.NovaFlowFoartTools,roles=Array.from(tools.captureDrawingReferenceRoles());
  const review=await tools.execute({action:'image_optimize',prompt:rt.state.prompt,generationMode:'img2img'},{provider:'api',modelId:'m',onlineBusiness:{},selectionStillCurrent:()=>true,projectStillCurrent:()=>true,currentDrawingVisionOnly:true,referenceSource:'page',referenceRoles:roles});
  assert.deepEqual(Array.from(request.images,image=>image.role),['subject','style']);assert.equal(request.prompt,'用<image2>的风格重绘<image1>');
  assert.equal(review.modelPrompt,redraw);assert.ok(review.prompt.startsWith('Loosely based on <image2> (use it'),'the page numbers the photo as slot 2');
  tools.confirmImageReview(review.reviewId);
  assert.deepEqual(Array.from(prepared.references,ref=>ref.name),['photo.png','style.png']);assert.deepEqual(Array.from(prepared.referenceRolePlan.roles),['subject','style']);
  assert.equal(prepared.promptSnapshot.prompt,redraw);assert.equal(prepared.promptOwnsReferenceRoles,true);assert.equal(rt.state.negativePrompt,STYLE_NEGATIVE);
});
await test('a request the edge runtime cut off is sent once more; any other failure is not',async()=>{
  const png=c=>'data:image/png;base64,'+c;
  const make=codes=>{
    const refs=[{drawingRole:'subject',dataUrl:png('AA=='),name:'photo.png'},{drawingRole:'style',dataUrl:png('BB=='),name:'style.png'}];let calls=0;const statuses=[];
    const rt={state:{active:true,provider:'local',mode:'img2img',prompt:'用<image2>的风格重绘<image1>',negativePrompt:'',width:512,height:512,count:1,running:false,localQwen21Variant:'turbo'},references:()=>refs,selectedResult:()=>null,
      captureContext(){return {state:this.state,generationSurface:'drawing',routeRevision:1,referenceRevision:1};},captureAgentPreparedSnapshot:()=>({}),replaceAgentPrepared(){return {};},restoreAgentPrepared(){},isAgentPreparedReplacementCurrent:()=>true,render(){}};
    const root={crypto:globalThis.crypto,console,TextEncoder,setTimeout,clearTimeout,__NovaFlowArtGenerate:rt,document:{querySelectorAll:()=>[]},NovaFlowArtGenerateModels:{capabilityFor:()=>({engine:'qwen-2.1-turbo'})},
      NovaFlowXiaotaoArtAgent:{panel:{controller:{businessModelSnapshot:()=>({provider:'api',modelId:'m',epoch:1})}}},electronAPI:{onlineVisionArtAvailableSync:()=>true,captureFoartSessionGuard:()=>()=>true},
      __NovaFlowSmartAI:{async optimizeForAgent(){const code=codes[calls++];if(code)throw Object.assign(Error('在线请求中断'),{code});
        return {prompt:redraw,displayPrompt:redraw,negativePrompt:STYLE_NEGATIVE,analysisBackend:'runninghub',optimization:{reviewRequired:true,modelPromptPolicy:QWEN21_STYLE_REDRAW_POLICY}};}}};
    root.window=root;runInContext(read('../../renderer/xiaotao-foart-tools.js'),createContext(root));
    const tools=root.NovaFlowFoartTools,roles=Array.from(tools.captureDrawingReferenceRoles());
    return {run:()=>tools.execute({action:'image_optimize',prompt:rt.state.prompt,generationMode:'img2img'},{provider:'api',modelId:'m',onlineBusiness:{},selectionStillCurrent:()=>true,projectStillCurrent:()=>true,currentDrawingVisionOnly:true,referenceSource:'page',referenceRoles:roles,onStatus:t=>statuses.push(t)}),calls:()=>calls,statuses};
  };
  const cut=make(['assistant-business-interrupted']);
  const review=await cut.run();assert.equal(review.modelPrompt,redraw);assert.equal(cut.calls(),2);assert.ok(cut.statuses.some(t=>/重新发送/.test(t)));
  const twice=make(['assistant-business-interrupted','assistant-business-interrupted']);
  await assert.rejects(twice.run(),e=>e.code==='assistant-business-interrupted');assert.equal(twice.calls(),2);
  const silent=make(['provider-failed']);
  assert.equal((await silent.run()).modelPrompt,redraw);assert.equal(silent.calls(),2);
  const other=make(['quote-changed']);
  await assert.rejects(other.run(),e=>e.code==='quote-changed');assert.equal(other.calls(),1);
});
await test('his exact words reach the workflow with a fenced, a long and a Chinese brain reply',async()=>{
  const words='@参考图1的风格换成@参考图2的风格，人物姿势不变';
  const agent=read('../../renderer/xiaotao-art-agent.js'),box={};createContext(box);
  runInContext(agent.slice(agent.indexOf('function styleSlots'),agent.indexOf('function createQwenNodeRecheck'))+';this.slots=(m,n)=>styleSlots(m,n);',box);
  const answers=[
    '以下是结果：\n```json\n'+JSON.stringify({style_description:description,mood_description:mood,content_description:content})+'\n```',
    JSON.stringify({style_description:description+', with warm palette '+'and fine detail '.repeat(40),mood_description:mood+' '+'soft glow '.repeat(40),content_description:content+' '+'and more scene '.repeat(60)}),
    JSON.stringify({style_description:'平涂赛璐璐，细线条',content_description:'一位红棕色长卷发的女生，眨眼微笑，在机场'}),
  ];
  assert.match(read('../../renderer/novaflow-smart-ai.js'),/const assembled=response\.modelPromptPolicy==='qwen21-style-redraw-v1'/);
  for(const output_text of answers){
    const png=c=>'data:image/png;base64,'+c,refs=[{drawingRole:'subject',dataUrl:png('AA=='),name:'photo.png'},{drawingRole:'subject',dataUrl:png('BB=='),name:'style.png'}];
    const styleAt=box.slots(words,refs.length);let seen=false;refs.forEach((ref,i)=>{if(styleAt.has(i))ref.drawingRole='style';else if(!seen){ref.drawingRole='subject';seen=true;}});
    assert.deepEqual(refs.map(ref=>ref.drawingRole),['subject','style']);
    let prepared=null;
    const rt={state:{active:true,provider:'local',mode:'img2img',prompt:words,negativePrompt:'',width:1280,height:960,count:1,running:false,localQwen21Variant:'turbo'},references:()=>refs,selectedResult:()=>null,
      captureContext(){return {state:this.state,generationSurface:'drawing',routeRevision:1,referenceRevision:1};},captureAgentPreparedSnapshot:()=>({}),replaceAgentPrepared(_handle,value){prepared=value;return {};},restoreAgentPrepared(){},isAgentPreparedReplacementCurrent:()=>true,render(){}};
    const root={crypto:globalThis.crypto,console,TextEncoder,setTimeout,clearTimeout,__NovaFlowArtGenerate:rt,document:{querySelectorAll:()=>[]},NovaFlowArtGenerateModels:{capabilityFor:()=>({engine:'qwen-2.1-turbo'})},
      NovaFlowXiaotaoArtAgent:{panel:{controller:{businessModelSnapshot:()=>({provider:'api',modelId:'m',epoch:1})}}},electronAPI:{onlineVisionArtAvailableSync:()=>true,captureFoartSessionGuard:()=>()=>true},
      __NovaFlowSmartAI:{async optimizeForAgent(options){
        const brief=buildQwen21NativeRewrite({...input,currentPrompt:'__NF_REF_1__的风格换成__NF_REF_2__的风格，人物姿势不变',negativePrompt:''},'m',Array.from(options.images,image=>image.role));
        const result=compileQwen21NativeRewrite({output_text},brief);
        return {prompt:result.modelPrompt,displayPrompt:result.displayPrompt,negativePrompt:result.negativePrompt,analysisBackend:'runninghub',optimization:{reviewRequired:true,modelPromptPolicy:result.modelPromptPolicy}};}}};
    root.window=root;runInContext(read('../../renderer/xiaotao-foart-tools.js'),createContext(root));
    const tools=root.NovaFlowFoartTools,roles=Array.from(tools.captureDrawingReferenceRoles());
    const review=await tools.execute({action:'image_optimize',prompt:words,generationMode:'img2img'},{provider:'api',modelId:'m',onlineBusiness:{},selectionStillCurrent:()=>true,projectStillCurrent:()=>true,currentDrawingVisionOnly:true,referenceSource:'page',referenceRoles:roles});
    tools.confirmImageReview(review.reviewId);
    assert.deepEqual(Array.from(prepared.referenceRolePlan.roles),['subject','style']);assert.equal(prepared.promptOwnsReferenceRoles,true);
    assert.ok(prepared.promptSnapshot.prompt.startsWith('Loosely based on <image1>'));
    const graph=build({taskProfile:'art-direction',referenceRoles:Array.from(prepared.referenceRolePlan.roles)});
    assert.equal(sampler(graph).inputs.cfg,3);assert.equal(graph['6'].inputs.width,1536);
  }
});
console.log(`${passed} passed, ${failed} failed`);
if(failed)process.exit(1);
