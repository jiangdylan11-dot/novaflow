import test from 'node:test';
import assert from 'node:assert/strict';
import { createStrataPromptAssistant } from '../../worker/src/strata-prompt-assistant.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('pooled 小桃 owns its current worker slot and releases Flash before returning',async()=>{
  let released=false;
  const assistant=createStrataPromptAssistant({config:{expectedModel:{ids:['pool-flash']}},lifecycle:{load:async()=>{},unload:async()=>({released:true})},worker:{getState:()=>({currentTaskId:'own'})},comfyUrls:[],
    sessionFactory:()=>({withSession:async callback=>{const value=await callback({identity:{id:'pool-flash'},inferConversation:async()=>({model:'pool-flash',requestId:'actual-pool-inference',finishReason:'stop',message:{role:'assistant',content:'已连接算力节点。'}})});released=true;return {value,identity:{id:'pool-flash'},timing:{},resourcesReleased:true};}}),legacyApi:{stop:async()=>{}}});
  const result=await assistant.runForTask('own','artAgentChat',{requestId:'pooled-chat-request',mode:'chat',message:'你好',history:[]});
  assert.equal(result.ok,true);assert.equal(result.data.reply,'已连接算力节点。');assert.equal(released,true);assert.equal(result.resourcesReleased,true);
});

test('two coordinators cannot release each other: busy failure and unused stop preserve active owner',async()=>{
  let activeToken=null;const loads=[],unloads=[],entered=deferred(),gate=deferred();
  const lifecycle={
    async load({ownerToken}){loads.push(ownerToken);if(activeToken)throw Error('runtime-busy');activeToken=ownerToken;return {ok:true,ownerToken};},
    async unload({ownerToken}){unloads.push(ownerToken);if(activeToken!==ownerToken)return {ok:true,released:true,notOwned:true};activeToken=null;return {ok:true,released:true};}
  };
  const config={expectedModel:{ids:['flash-owner-fixture']}};
  const create=run=>createStrataPromptAssistant({config,lifecycle,comfyUrls:[],
    fetchImpl:async url=>Response.json(url.endsWith('/v1/models')?{data:[{id:'flash-owner-fixture'}]}:{}),
    legacyApi:{runWithFlashSession:run,stop:async()=>{}}});
  const a=create(async()=>{entered.resolve();await gate.promise;return {ok:true,data:{}};});
  const b=create(async()=>assert.fail('Busy B cannot reach inference'));
  const idle=create(async()=>({ok:true,data:{}}));
  await idle.stop();assert.equal(unloads.length,0,'Never-loaded stop owns no runtime');
  const running=a.optimizePrompt({prompt:'A'});await entered.promise;const aToken=activeToken;
  const result=await b.optimizePrompt({prompt:'B'});assert.equal(result.ok,false);assert.equal(result.errorCode,'strata-load-failed');
  assert.equal(activeToken,aToken);assert.notEqual(loads[1],aToken);
  assert.deepEqual(unloads,[loads[1]],'Failed B cleanup carries B token only');
  await b.stop();assert.equal(activeToken,aToken);assert.deepEqual(unloads,[loads[1]],'B stop cannot issue an unscoped unload');
  gate.resolve();assert.equal((await running).resourcesReleased,true);assert.equal(activeToken,null);
  assert.equal(unloads.at(-1),aToken);await a.stop();assert.equal(unloads.length,2);
});

test('partial owner load is cleaned and release-fault recovery retries only that operation',async()=>{
  let activeToken=null,failRelease=true;const loads=[],unloads=[];
  const lifecycle={load:async({ownerToken})=>{activeToken=ownerToken;loads.push(ownerToken);throw Error('partial load');},
    unload:async({ownerToken})=>{unloads.push(ownerToken);assert.equal(ownerToken,activeToken);if(failRelease)throw Error('exit pending');activeToken=null;return {released:true};}};
  const assistant=createStrataPromptAssistant({config:{expectedModel:{ids:['fixture']}},lifecycle,comfyUrls:[],legacyApi:{stop:async()=>{}}});
  const result=await assistant.optimizePrompt({prompt:'x'});assert.equal(result.errorCode,'strata-release-unconfirmed');assert.equal(activeToken,loads[0]);
  failRelease=false;await assistant.stop();assert.equal(activeToken,null);assert.deepEqual(unloads,[loads[0],loads[0]]);
});
function fixture({run,infer,queueBusy=false,releaseError=false,workerState={}}={}) {
  const events=[];
  const assistant=createStrataPromptAssistant({config:{expectedModel:{ids:['flash-fixture']}},
    lifecycle:{load:async()=>{},unload:async()=>({released:true})},worker:{getState:()=>workerState},comfyUrls:['http://127.0.0.1:9999'],
    fetchImpl:async(url)=>{if(url.endsWith('/queue')){events.push('queue');return Response.json({queue_running:queueBusy?[[]]:[],queue_pending:[]});}events.push('free');return Response.json({});},
    sessionFactory:()=>({withSession:async(callback,{signal})=>{events.push('load');
      const value=await callback({identity:{id:'flash-fixture',verification:'server-weight-path'},infer:infer || (async()=>({text:'Instrumental harp loop. BPM: 90',model:'flash-fixture'}))});
      if(value?.data?.artDirection?.editEnhancer)assert.equal(value.data.artDirection.editEnhancer.resourcesReleased,undefined);
      events.push('unload');if(releaseError)throw Object.assign(Error('release failed'),{errorCode:'strata-release-unconfirmed'});
      if(signal.aborted)throw Object.assign(Error('cancelled'),{errorCode:'strata-aborted'});
      return {value,identity:{id:'flash-fixture'},timing:{loadMs:1,unloadMs:1},resourcesReleased:true,generationReady:true};}}),
    legacyApi:{runWithFlashSession:async(flash,method,payload,context)=>{events.push({method,payload,context,model:flash.identity.id});return run?run({flash,method,payload,context}):{ok:true,data:{prompt:'compiled'}};},uiDesignCpu:async p=>({ok:true,data:p}),stop:async()=>{}}
  });return {assistant,events};
}

test('drawing/video/UI/structured IR/style share Flash and preserve their task protocols',async()=>{
  const {assistant,events}=fixture();
  for(const [method,payload] of [['optimizePrompt',{surface:'animation',purpose:'minimax-h3',prompt:'镜头缓慢推进'}],['reverseImagePrompt',{surface:'ui-design',uiPlanner:'native-catalog-v3'}],['optimizePrompt',{surface:'art',promptSchema:'nf.art.prompt.v1',prompt:'一只猫'}],['describeArtStyle',{purpose:'aifx-material',dataUrl:'fixture'}]]){
    const r=await assistant[method](payload);assert.equal(r.ok,true);assert.equal(r.modelIdentity.id,'flash-fixture');assert.equal(r.resourcesReleased,true);assert.equal(r.data.analysisBackend,'strata');
    const seen=events.findLast(x=>typeof x==='object');assert.deepEqual(seen.payload,payload);assert.equal(seen.method,method);assert.equal(seen.model,'flash-fixture');assert.equal(events.at(-1),'unload');
  }
  assert.equal(assistant.status().otherBackend,'strata');assert.equal(assistant.status().supportsStructuredPromptIR,true);
});
test('busy Comfy prevents every Flash load',async()=>{const {assistant,events}=fixture({queueBusy:true});const r=await assistant.optimizePrompt({prompt:'x'});assert.equal(r.errorCode,'runtime-generation-busy');assert.deepEqual(events,['queue']);});
test('pool task may hold its own worker slot while another task is refused',async()=>{const {assistant}=fixture({workerState:{currentTaskId:'own'}});assert.equal((await assistant.optimizePrompt({prompt:'x'})).errorCode,'runtime-generation-busy');assert.equal((await assistant.runForTask('own','reverseImagePrompt',{surface:'ui-design'})).ok,true);});
test('same-tick calls cannot overlap the shared lease',async()=>{const entered=deferred(),gate=deferred();const {assistant}=fixture({run:async()=>{entered.resolve();await gate.promise;return {ok:true,data:{}};}});const first=assistant.optimizePrompt({prompt:'a'});await entered.promise;assert.equal((await assistant.reverseImagePrompt({})).errorCode,'prompt-assistant-busy');gate.resolve();assert.equal((await first).ok,true);});
test('generation waits for inference and release then excludes unrelated local AI',async()=>{const gate=deferred(),entered=deferred();const {assistant}=fixture({run:async()=>{entered.resolve();await gate.promise;return {ok:true,data:{}};}});const first=assistant.optimizePrompt({});await entered.promise;let acquired=false;const reservation=assistant.acquireGeneration('draw').then(release=>{acquired=true;return release;});await new Promise(r=>setTimeout(r,10));assert.equal(acquired,false);gate.resolve();await first;const release=await reservation;assert.equal((await assistant.optimizePrompt({})).errorCode,'prompt-assistant-busy');release();assert.equal((await assistant.optimizePrompt({})).ok,true);});
test('release failure blocks subsequent inference and generation',async()=>{const {assistant}=fixture({releaseError:true});assert.equal((await assistant.optimizePrompt({})).errorCode,'strata-release-unconfirmed');assert.equal((await assistant.optimizePrompt({})).errorCode,'strata-release-unconfirmed');await assert.rejects(assistant.acquireGeneration('draw'),/资源/);});
test('audio shares the lease and returns only a cleaned caption after release',async()=>{const {assistant,events}=fixture();const r=await assistant.rewriteAudioPrompt({kind:'music',input:'竖琴循环',seconds:30});assert.equal(r.prompt,'Instrumental harp loop. BPM: 90');assert.equal(r.resourcesReleased,true);assert.equal(events.at(-1),'unload');});
test('UI CPU compilers do not cold-load a language model',async()=>{const {assistant,events}=fixture();const r=await assistant.uiDesignCpu({surface:'ui-design',action:'native-ui-cloud'});assert.equal(r.ok,true);assert.deepEqual(events,[]);});

test('native style pair bypasses old business rewriters and receives nested credentials only after release',async()=>{
  const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
  let calls=0;
  const infer=async()=>{calls++;return {model:'flash-fixture',requestId:'native-proof',text:JSON.stringify({sourceContent:'An actual content anchor.',prompt:'Redraw <image1> using <image2>.',renderingClass:'other'})};};
  const payload={surface:'art',purpose:'art-director',visualSchema:'nf.art.direction.v1',images:[{dataUrl:png},{dataUrl:png}],artContext:{task:'style',references:[{source:1,roles:['subject']},{source:2,roles:['style']}]}};
  const {assistant,events}=fixture({infer});const r=await assistant.reverseImagePrompt(payload);
  assert.equal(r.ok,true);assert.equal(calls,1);assert.equal(events.some(e=>typeof e==='object'),false);
  assert.equal(events.at(-1),'unload');assert.equal(r.data.artDirection.editEnhancer.resourcesReleased,true);
  assert.equal(r.data.artDirection.editEnhancer.generationReady,true);assert.equal(r.data.artDirection.editEnhancer.modelIdentity.id,'flash-fixture');
  assert.equal(r.data.artDirection.prompt,'Redraw <image1> using <image2>.');
  const failed=await fixture({infer,releaseError:true}).assistant.reverseImagePrompt(payload);
  assert.equal(failed.ok,false);assert.equal(failed.data,undefined);assert.equal(failed.resourcesReleased,undefined);
});

test('rejected business output does not grant generation-ready status',async()=>{
  const {assistant}=fixture({run:async()=>({ok:false,error:'invalid source layout'})});
  const r=await assistant.reverseImagePrompt({surface:'ui-design'});
  assert.equal(r.ok,false);assert.equal(r.resourcesReleased,true);assert.equal(r.generationReady,false);
});
