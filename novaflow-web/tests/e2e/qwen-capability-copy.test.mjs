import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createContext,runInContext} from 'node:vm';import {webcrypto} from 'node:crypto';
const text=readFileSync(new URL('../../renderer/xiaotao-art-agent.js',import.meta.url),'utf8');
test('ordinary local chat displays only the actual answer',async()=>{
 const root={console,crypto:webcrypto,AbortController,setTimeout,clearTimeout,localStorage:{getItem:()=>null,setItem(){}}};root.window=root;
 runInContext(text,createContext(root));const api=()=>({artAgentChat:async()=>({ok:true,data:{reply:'你好',history:[],toolTrace:[]}})});
 const bridge={clearPrepared(){},captureChat:()=>({artContext:{surface:'other'},images:[]}),hasResult:()=>false};
 const c=root.NovaFlowXiaotaoArtAgent.createController({api,bridge});c.state.qwen35CpuTrialAvailable=true;
 assert.equal(await c.send('你好'),true);assert.equal(c.state.messages.at(-1).content,'你好');assert.equal(c.state.status,'已回复');
});
