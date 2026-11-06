import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import {webcrypto} from 'node:crypto';

function fixture(reply='仅说明理解。') {
  const requests=[],executed=[];
  const root={console,TextEncoder,AbortController,crypto:webcrypto,setTimeout,clearTimeout,setInterval,clearInterval,
    localStorage:{getItem:()=>null,setItem(){}},atob:s=>Buffer.from(s,'base64').toString('binary')};
  root.window=root;
  const vm=createContext(root);
  for(const file of ['xiaotao-upload.js','foart-tool-contract.js'])
    runInContext(readFileSync(new URL('../../renderer/'+file,import.meta.url),'utf8'),vm);
  root.NovaFlowSkeletonEditor={active:()=>true};
  root.NovaFlowFoartTools={capture:()=>({schema:'nf.foart.tool-plan.v1',controls:[],animation:{active:true,loaded:true,bones:[{name:'hair'}],animations:['idle'],animation:'idle'}}),
    images:async()=>[],settlePending:async()=>null,setUploads(){},open:async()=>{executed.push('open');},execute:async op=>{executed.push(op);}};
  runInContext(readFileSync(new URL('../../renderer/xiaotao-art-agent.js',import.meta.url),'utf8'),vm);
  const bridge={clearPrepared(){},captureChat:()=>({artContext:{surface:'animation'},images:[]}),captureAny:()=>({artContext:{surface:'animation'},images:[]}),hasResult:()=>false};
  const api=()=>({promptAssistantGetStatus:async()=>({ok:true,result:{available:true,features:{qwen35CpuTrial:true}}}),artAgentChat:async payload=>{requests.push(JSON.parse(JSON.stringify(payload)));return {ok:true,data:{reply,history:[]}};}});
  const controller=root.NovaFlowXiaotaoArtAgent.createController({bridge,api});
  // 小桃 opens on 豆包 since 2.0.321; these cases are about the local brain, so pick it as a person would.
  controller.setModel('qwen3.5-9b-heretic');
  return {controller,requests,executed};
}

test('explicit no-tool explanations of quoted edits stay chat-only across turns',async()=>{
  const {controller,requests,executed}=fixture();await controller.calibrateLocalStatus();
  for(const text of [
    '这是虚构测试工程：动画30帧/秒、总时长2秒，身体、左侧头发和右侧头发是不同对象。用户说：“头发再飘一点，身体别动。”请用简短中文说明你理解的目标和必须保持不变的内容。没有工具，不要声称已经操作。',
    '更正：只动右侧头发，左侧头发和身体都不动，总时长仍为2秒。请根据这条更正简短复述最终目标和保持项；没有工具，不要声称已经操作。'
  ]) assert.equal(await controller.send(text),true,text);
  assert.deepEqual(requests.map(x=>x.mode),['chat','chat']);assert.deepEqual(executed,[]);
});

test('ordinary wording for explicit no-tool discussion remains available without tools',async()=>{
  const {controller,requests,executed}=fixture();await controller.calibrateLocalStatus();
  assert.equal(await controller.send('请解释“头发再飘一点，身体别动”的意思，不要使用工具，也不要实际操作。'),true);
  assert.equal(requests.length,1);assert.equal(requests[0].mode,'chat');assert.deepEqual(executed,[]);
});

test('unperformed colloquial deletion claims are rejected, ordinary explanations remain available',async()=>{
  for(const reply of ['我已经删掉身体了。','我把骨骼删了。']){
    const {controller,requests,executed}=fixture(reply);await controller.calibrateLocalStatus();
    assert.equal(await controller.send('请说明“头发再飘一点”的意思。没有工具，不要声称已经操作。'),false);
    assert.equal(requests.length,1);assert.equal(controller.state.error,'');assert.match(controller.state.messages.at(-1).content,/未经执行/);assert.deepEqual(executed,[]);
  }
  const safe=fixture('可以讨论删除骨骼的意思，我没有操作作品。');await safe.controller.calibrateLocalStatus();
  assert.equal(await safe.controller.send('请解释“删除骨骼”的意思，不要使用工具，也不要实际操作。'),true);
  assert.deepEqual(safe.executed,[]);
});
