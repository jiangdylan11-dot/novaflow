import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {webcrypto} from 'node:crypto';import vm from 'node:vm';
const text=await readFile(new URL('../renderer/xiaotao-art-agent.js',import.meta.url),'utf8');
function documentFixture({fallback=false}={}){
 let copied='',selected=null;
 class Node{constructor(tag,text=''){this.tagName=tag.toUpperCase();this.children=[];this.value=text;this.attributes={};this.style={};}append(...nodes){this.children.push(...nodes);}set textContent(text){this.value=String(text);this.children=[];}get textContent(){return this.value+this.children.map(x=>x.textContent).join('');}setAttribute(k,v){this.attributes[k]=String(v);}focus(){}select(){selected=this.value;}remove(){} }
 const doc={createElement:t=>new Node(t),createTextNode:t=>new Node('#text',t),body:new Node('body'),execCommand:()=>{if(fallback){copied=selected;return true;}return false;},createRange:()=>({selectNodeContents(n){doc.target=n;}})};
 return {doc,get copied(){return copied;}};
}
function setup(){const root={console,crypto:webcrypto,AbortController,setTimeout,clearTimeout,localStorage:{getItem:()=>null,setItem(){}}};root.window=root;vm.createContext(root);vm.runInContext(text,root);const a=text.indexOf('  async function copyMessageText('),b=text.indexOf('  function renderConversationRow(',a);assert.ok(a>0&&b>a);vm.runInContext(text.slice(a,b)+'\nglobalThis.copyMessageText=copyMessageText;',root);return root;}
test('local chat and legacy displayed rows copy only the actual answer',async()=>{
 const root=setup(),api=()=>({artAgentChat:async()=>({ok:true,data:{reply:'你好，我能协助创作。',history:[],toolTrace:[]}})});
 const bridge={clearPrepared(){},captureChat:()=>({artContext:{surface:'other'},images:[]}),hasResult:()=>false};
 const c=root.NovaFlowXiaotaoArtAgent.createController({api,bridge});c.state.qwen35CpuTrialAvailable=true;
 assert.equal(await c.send('你好'),true);assert.equal(c.state.messages.at(-1).content,'你好，我能协助创作。');assert.equal(c.state.status,'已回复');
 const f=documentFixture(),writes=[],env={navigator:{clipboard:{writeText:async v=>writes.push(v)}}};
 for(const row of [root.NovaFlowXiaotaoArtAgent.conversationRows(c.state.messages).at(-1),root.NovaFlowXiaotaoArtAgent.conversationRows([{role:'assistant',content:'本次为文字或图片对话，未操作软件。\n\n你好，我能协助创作。'}])[0]]){
  const bubble=root.NovaFlowXiaotaoArtAgent.renderConversationRow(f.doc,row,{copyText:(text,button,target)=>root.copyMessageText(text,button,f.doc,env,target)});assert.equal(row.content,'你好，我能协助创作。');assert.equal(bubble.children[1].textContent,'你好，我能协助创作。');bubble.children[0].children[1].onclick();await new Promise(setImmediate);assert.equal(bubble.children[0].children[1].textContent,'已复制');
 }
 assert.deepEqual(writes,['你好，我能协助创作。','你好，我能协助创作。']);
});
test('clipboard denial uses fallback; complete failure selects answer and reports manual copy',async()=>{
 const root=setup();let f=documentFixture({fallback:true}),button={textContent:''};
 assert.equal(await root.copyMessageText('真实回答',button,f.doc,{navigator:{clipboard:{writeText:async()=>{throw Error('denied');}}}},{}),true);assert.equal(f.copied,'真实回答');assert.equal(button.textContent,'已复制');
 f=documentFixture();button={textContent:''};const target={},selection={removeAllRanges(){},addRange(){}};
 assert.equal(await root.copyMessageText('真实回答',button,f.doc,{navigator:{},getSelection:()=>selection},target),false);assert.equal(button.textContent,'请选中文字按 Ctrl+C');assert.equal(f.doc.target,target);
});
