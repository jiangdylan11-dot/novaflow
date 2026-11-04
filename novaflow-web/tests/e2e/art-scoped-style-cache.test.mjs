import test from 'node:test';
import assert from 'node:assert/strict';
import * as planner from '../../worker/src/art-edit-planner.mjs';
import {createPromptAssistant} from '../../worker/src/prompt-assistant.mjs';

// Header fixtures follow art-edit-planner.test.mjs; salt varies bytes without changing size.
function png(side,salt){
  const bytes=Buffer.alloc(32);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);
  bytes.writeUInt32BE(side,16);bytes.writeUInt32BE(side,20);bytes.writeUInt32BE(salt,24);
  return 'data:image/png;base64,'+bytes.toString('base64');
}
const profile=()=>({medium:'风格化CG',facialStyle:'概括鼻口与眼睑体积',markMaking:'成束发丝与细亮边缘',shading:'软体积过渡结合硬投影',surface:'细微表面细节与局部锐利反光',litPlanes:'夜间天空漫光形成的局部亮面',shadowPlanes:'较冷的紫灰暗面',edgeLight:'局部暖亮边光',palette:'冷暗面与暖亮面分离'});
function request(styleData,subjectData){return{surface:'art',purpose:'art-director',visualSchema:'nf.art.direction.v1',currentPrompt:'@参考图5用@参考图2画风',images:[{dataUrl:styleData},{dataUrl:subjectData}],artContext:{editEnhancer:'qwen21-pe-i2i',styleObservation:'scoped-style-v1',width:832,height:1216,references:[{source:2,roles:['style']},{source:5,roles:['subject']}]}};}
function fakeRuntime(){
  const graphs=[],uploads=[],calls=[];
  const fetchImpl=async(url,init={})=>{
    calls.push(url);let body;
    if(url.endsWith('/object_info/CLIPLoader')||url.endsWith('/object_info'))body={CLIPLoader:{input:{required:{clip_name:[[planner.ART_EDIT_MODEL]]}}},TextGenerate:{},LoadImage:{},PreviewAny:{}};
    else if(url.endsWith('/queue'))body={queue_running:[],queue_pending:[]};
    else if(url.endsWith('/upload/image')){const image=init.body.get('image');assert.ok(image,'multipart contains the actual style file');uploads.push(Buffer.from(await image.arrayBuffer()));body={name:'scoped-style-'+uploads.length+'.png'};}
    else if(url.endsWith('/prompt')){graphs.push(JSON.parse(init.body).prompt);body={prompt_id:'scoped-style-'+graphs.length};}
    else if(/\/history\/scoped-style-\d+$/.test(url)){const id=url.split('/').at(-1);body={[id]:{status:{status_str:'success',completed:true},outputs:{'4':{text:[JSON.stringify(profile())]}}}};}
    else assert.fail('Unexpected mocked request '+url);
    return new Response(JSON.stringify(body));
  };
  return{graphs,uploads,calls,fetchImpl};
}
function assertProfileRetained(result){
  const enhancer=result.artDirection.editEnhancer;
  assert.equal(enhancer.kind,'qwen21-scoped-style');assert.equal(enhancer.model,planner.ART_EDIT_MODEL);assert.equal(enhancer.renderingClass,'other');
  assert.deepEqual(enhancer.profile,profile(),'cached structured evidence retains all nine actual fields');
  for(const[key,value]of Object.entries(profile()))assert.ok(enhancer.prompt.includes(value),'compiled prompt retains '+key+' including medium');
}

test('opted-in scoped style observes one complete image once with native PE and retains all nine fields',async()=>{
  assert.equal(typeof planner.peekArtStyleCache,'function','synchronous style cache lookup is exported');
  const style=png(64,1701),payload=request(style,png(96,1702)),runtime=fakeRuntime();
  assert.equal(planner.isArtEditRequest(payload),true);assert.equal(planner.peekArtStyleCache(payload),null);
  const result=await planner.planArtEdit({baseUrl:'http://local',payload,fetchImpl:runtime.fetchImpl,pollMs:0});
  assert.equal(runtime.graphs.length,1,'one PE inference, without a routing/review inference');assert.equal(runtime.uploads.length,1,'only the complete style is uploaded');
  assert.deepEqual(runtime.uploads[0],Buffer.from(style.split(',')[1],'base64'));
  const graph=runtime.graphs[0],loads=Object.entries(graph).filter(([,n])=>n.class_type==='LoadImage'),encoders=Object.values(graph).filter(n=>n.class_type==='TextGenerate');
  assert.equal(loads.length,1);assert.equal(encoders.length,1);assert.ok(Object.values(graph).every(n=>!['ImageBatch','ImageCrop'].includes(n.class_type)));
  assert.equal(graph['1'].inputs.clip_name,planner.ART_EDIT_MODEL);assert.deepEqual(encoders[0].inputs.image,[loads[0][0],0]);
  assert.equal(encoders[0].inputs.use_default_template,true);assert.equal(encoders[0].inputs.thinking,false);assert.equal(encoders[0].inputs.max_length,2048);
  assertProfileRetained(result);assert.deepEqual(result.artDirection.editEnhancer.sourceOrder,[2,5]);assert.match(result.artDirection.editEnhancer.prompt,/将<image2>整幅按(?:完整)?<image1>/);
  assert.equal(planner.peekArtStyleCache(payload)?.analysisCacheHit,true);
});

test('scoped style cache survives new source/request/slots with zero fetches and different style bytes miss',async()=>{
  assert.equal(typeof planner.peekArtStyleCache,'function');
  const style=png(80,2701),payload=request(style,png(112,2702)),runtime=fakeRuntime();
  await planner.planArtEdit({baseUrl:'http://local',payload,fetchImpl:runtime.fetchImpl,pollMs:0});assert.equal(runtime.graphs.length,1);
  const changed={...payload,currentPrompt:'图7用图9画风，保留图7泪痣',negativePrompt:'不要文字',images:[{dataUrl:png(128,2703)},{dataUrl:style}],artContext:{...payload.artContext,width:1280,height:960,references:[{source:7,roles:['subject']},{source:9,roles:['style']}]}};
  const peeked=planner.peekArtStyleCache(changed);assert.ok(peeked);assert.equal(peeked.analysisCacheHit,true);assertProfileRetained(peeked);
  const cached=await planner.planArtEdit({baseUrl:'http://local',payload:changed,fetchImpl:()=>assert.fail('cache hit must do zero queue/catalog/upload/prompt/history requests')});
  assert.equal(cached.analysisCacheHit,true);assertProfileRetained(cached);assert.deepEqual(cached.artDirection.editEnhancer.sourceOrder,[7,9]);
  assert.deepEqual(cached.artDirection.references.map(r=>r.source),[7,9]);assert.equal(cached.artDirection.prompt,changed.currentPrompt);
  assert.match(cached.artDirection.editEnhancer.prompt,/将<image1>整幅按(?:完整)?<image2>/);assert.match(cached.artDirection.editEnhancer.prompt,/保留<image1>泪痣/);
  assert.doesNotMatch(cached.artDirection.editEnhancer.prompt,/@参考图5|@参考图2|图5|图2/);
  const originalFetch=globalThis.fetch;
  try{
    globalThis.fetch=()=>assert.fail('assistant cache hit must not inspect the model, queue, upload, release or infer');
    const assistant=createPromptAssistant({comfyUrls:['http://cache-hit-must-not-fetch']});
    const response=await assistant.reverseImagePrompt(changed);
    assert.equal(response.ok,true,JSON.stringify(response));assert.equal(response.data.analysisCacheHit,true);assertProfileRetained(response.data);
  }finally{globalThis.fetch=originalFetch;}
  const changedStyle={...changed,images:[changed.images[0],{dataUrl:png(80,2704)}]};
  assert.equal(planner.peekArtStyleCache(changedStyle),null,'same dimensions but new style bytes are a cache miss');
  const refreshed=await planner.planArtEdit({baseUrl:'http://local',payload:changedStyle,fetchImpl:runtime.fetchImpl,pollMs:0});
  assert.equal(runtime.graphs.length,2,'changed style submits exactly one new PE inference');assert.equal(runtime.uploads.length,2);assertProfileRetained(refreshed);
  assert.deepEqual(refreshed.artDirection.editEnhancer.sourceOrder,[7,9]);assert.equal(planner.peekArtStyleCache(changedStyle)?.analysisCacheHit,true);
});
