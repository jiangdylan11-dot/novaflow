import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../../renderer/novaflow-web-capabilities.js',import.meta.url),'utf8');
function boot(){const noop=()=>{},element=()=>({style:{setProperty:noop,removeProperty:noop},setAttribute:noop,getAttribute:()=>null,addEventListener:noop,appendChild:noop,remove:noop,click:noop,classList:{add:noop,remove:noop,contains:()=>false},querySelector:()=>null,querySelectorAll:()=>[]});const document={...element(),getElementById:()=>null,createElement:element,body:element(),documentElement:element(),baseURI:'https://test.local/',readyState:'complete'};const root={console,Map,Blob,Response,URL,DOMException,Uint8Array,ArrayBuffer,atob,setTimeout,clearTimeout,setInterval:()=>0,clearInterval:noop,document,location:{href:document.baseURI,pathname:'/',search:'',hash:''},navigator:{userAgent:'node'},localStorage:{getItem:()=>null,setItem:noop},sessionStorage:{getItem:()=>null,setItem:noop},NovaFlowWebRuntime:{},electronAPI:{},addEventListener:noop,removeEventListener:noop};root.window=root;root.self=root;vm.runInNewContext(source,root);return root;}
test('agent export keeps exact native bytes and relative paths without asking for filesystem access',async()=>{
 const root=boot();let pickerCalls=0;root.showDirectoryPicker=async()=>{pickerCalls++;throw Error('should not be called');};root.NovaFlowAgentExportSession={files:new Map()};
 const dir=await root.electronAPI.pickDirectory();assert.equal(dir.ok,true);
 for(const [name,bytes] of [['frame_0001.png',[1,2]],['frame_0002.png',[3,4]]]){const result=await root.electronAPI.writeBinaryFile({dir:dir.dir+'/NovaFlow/images',fileName:name,bytes});assert.equal(result.ok,true);}
 assert.equal(pickerCalls,0);assert.deepEqual([...root.NovaFlowAgentExportSession.files.keys()],['NovaFlow/images/frame_0001.png','NovaFlow/images/frame_0002.png']);assert.deepEqual([...new Uint8Array(await root.NovaFlowAgentExportSession.files.get('NovaFlow/images/frame_0001.png').arrayBuffer())],[1,2]);
});
test('only the explicit agent session intercepts original encoder save data',async()=>{
 const root=boot();let calls=0;root.showDirectoryPicker=async()=>{calls++;return {name:'manual-folder'};};const manual=await root.electronAPI.pickDirectory();assert.equal(manual.name,'manual-folder');assert.equal(calls,1);
 root.NovaFlowAgentExportSession={files:new Map()};const saved=await root.electronAPI.exportPickSaveFile({fileName:'effect.json',bytes:[123,125],mimeType:'application/json'});assert.equal(saved.ok,true);assert.equal(saved.result.queued,true);assert.equal(await root.NovaFlowAgentExportSession.files.get('effect.json').text(),'{}');
});
