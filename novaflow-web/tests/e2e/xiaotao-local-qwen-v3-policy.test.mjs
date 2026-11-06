import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';

const toolsSource=await readFile(new URL('../../renderer/xiaotao-foart-tools.js',import.meta.url),'utf8');
const agentSource=await readFile(new URL('../../renderer/xiaotao-art-agent.js',import.meta.url),'utf8');

function fixture(policy,backend='qwen-cpu',identity='qwen35-heretic') {
  let prepared=null,revision=0,calls=0;
  const rt={state:{provider:'local',mode:'txt2img',prompt:'一只小猫',negativePrompt:'',width:512,height:512,count:1,running:false},references:()=>[],selectedResult:()=>null,
    captureAgentPreparedSnapshot(){return {revision,prepared};},replaceAgentPrepared(handle,value){assert.equal(handle.revision,revision);prepared=value;return {revision:++revision,prepared:value};},
    restoreAgentPrepared(){},isAgentPreparedReplacementCurrent:()=>true,render(){}};
  const storage={getItem:()=>null,setItem(){}};
  const root={crypto:webcrypto,console,AbortController,setTimeout,clearTimeout,localStorage:storage,__NovaFlowArtGenerate:rt,
    NovaFlowArtGenerateModels:{capabilityFor:()=>({engine:'qwen-2.1'})},
    electronAPI:{qwenBusinessAvailableSync:()=>true,captureFoartSessionGuard:()=>()=>true,promptAssistantGetStatus:async()=>({ok:true,result:{available:true,features:{qwen35CpuTrial:true}}})},
    __NovaFlowSmartAI:{optimizeForAgent:async()=>{calls++;return {analysisBackend:backend,displayPrompt:'优化后小猫',prompt:'A kitten.',negativePrompt:'negative',optimization:{modelIdentity:{id:identity},modelPromptPolicy:policy}};}}};
  root.window=root;vm.createContext(root);vm.runInContext(toolsSource,root);vm.runInContext(agentSource,root);
  const bridge={clearPrepared(){},capture(){throw Error('unexpected capture');},async captureChat(){return {artContext:{surface:'other'},images:[]};}};
  const controller=root.NovaFlowXiaotaoArtAgent.createController({bridge,storage,api:()=>root.electronAPI});root.NovaFlowXiaotaoArtAgent.panel={controller};
  controller.setModel('qwen3.5-9b-heretic'); // 小桃 opens on 豆包 since 2.0.321; these are local-brain cases
  return {controller,rt,get calls(){return calls;}};
}

test('local text drawing accepts the v3 framework and keeps identity and policy guards',async()=>{
  for(const [policy,backend,identity,accepted] of [
    ['qwen21-native-rewrite-v3','qwen-cpu','qwen35-heretic',true],
    ['qwen21-task-policy-v1','qwen-cpu','qwen35-heretic',true],
    ['unknown','qwen-cpu','qwen35-heretic',false],
    ['qwen21-native-rewrite-v3','remote','qwen35-heretic',false],
    ['qwen21-native-rewrite-v3','qwen-cpu','other-model',false]
  ]) {
    const f=fixture(policy,backend,identity);await f.controller.calibrateLocalStatus();
    assert.equal(await f.controller.send('请优化当前绘图提示词'),accepted,`${policy}/${backend}/${identity}`);
    assert.equal(f.calls,1);assert.equal(f.rt.state.prompt,accepted?'优化后小猫':'一只小猫');
  }
});
