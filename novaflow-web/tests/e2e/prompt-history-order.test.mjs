import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {patchPromptHistoryOrder} from '../../../scripts/patch-prompt-history-order.mjs';
const require = createRequire(import.meta.url), acorn = require('acorn');
const bundle = readFileSync(new URL('../../renderer/assets/index-BbIa-2NM.js', import.meta.url), 'utf8');
const brand = readFileSync(new URL('../../renderer/novaflow-brand-runtime.js', import.meta.url), 'utf8');
const components = [], definitions = {}, functions = {};
function walk(node, visit) {
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(child => child?.type && walk(child, visit));
    else if (value?.type) walk(value, visit);
  }
}
walk(acorn.parse(bundle, {ecmaVersion:'latest', sourceType:'module'}), node => {
  if (node.type === 'FunctionExpression' && /^function\(e\)\{let\{(?:title:t,value:n,onPick:r,history:i|onPick:t,history:n)/.test(bundle.slice(node.start, node.end))) components.push(bundle.slice(node.start, node.end));
  if (node.type === 'VariableDeclarator' && ['Ga','Ka','qa','Ja'].includes(node.id.name) && node.init?.type === 'ArrowFunctionExpression') definitions[node.id.name] = bundle.slice(node.init.start, node.init.end);
});
walk(acorn.parse(brand, {ecmaVersion:'latest'}), node => {
  if (node.type === 'FunctionDeclaration') functions[node.id.name] = brand.slice(node.start, node.end);
});
const jsx = (type, props, key) => ({type, props, key});
const flat = node => Array.isArray(node) ? node.flatMap(flat) : !node || typeof node !== 'object' ? [] : [node, ...flat(node.props?.children)];
const item = (text, at) => Object.freeze({text, at});
function render(index, history, value) {
  let state = 0, picked;
  const context = {X:{jsx,jsxs:jsx}, _:{useState:()=>[state++ === 0 ? true : {width:520,left:10,top:10,height:528},()=>{}],useRef:()=>({current:null}),useEffect:()=>{},useCallback:f=>f},Xt:()=>{},Xa:()=>{},Jt:t=>String(t||'').replace(/\s+/g,' ').trim(),Yt:String,Ya:String};
  const component = vm.runInNewContext('('+components[index]+')', context);
  const tree = component({inline:true, title:'正向提示词历史', value, history, onPick:text=>{picked=text;}});
  const rows = flat(tree).filter(node => node.type === 'div' && node.props?.children && flat(node.props.children).some(child => child.type === 'button' && child.props?.style?.textOverflow === 'ellipsis') && node.props.style?.display === 'flex' && node.props.style?.gap === 8);
  return {rows, get picked(){return picked;}};
}
test('all shipped history rows keep saved entries first, then recent entries newest first', () => {
  assert.equal(components.length, 2);
  assert.equal(patchPromptHistoryOrder(bundle), bundle);
  for (const index of [0,1]) {
    const pinned = Object.freeze([item('已保存 A',2), item('已保存 B',1)]), recent = Object.freeze([item('较早',10), item('最新',30), item('中间',20)]);
    const history = {pinned,pinnedSlots:pinned,recent,isPinned:()=>false,addRecent:()=>{}};
    const {rows} = render(index, history, '中间');
    assert.deepEqual(rows.map(row=>flat(row).find(n=>n.type==='button'&&n.props.style?.textOverflow==='ellipsis').props.title), ['已保存 A','已保存 B','最新','中间','较早']);
    assert.equal(rows.filter(row=>row.props['data-novaflow-history-current']==='1').length, 1);
    assert.equal(flat(rows[3]).find(n=>n.props?.['data-novaflow-history-current-badge']==='1').props.children, '当前');
    assert.equal(history.recent, recent);
  }
});
test('current saved record stays above newest recent, and picking moves the full prompt into recent history', () => {
  for (const index of [0,1]) {
    const text = '完整提示词。'.repeat(100), picked = [];
    const history = {pinned:[item('收藏',1)],pinnedSlots:[item('收藏',1)],recent:[item(text,2)],isPinned:()=>false,addRecent:t=>picked.push(t)};
    const output = render(index, history, '收藏');
    assert.equal(output.rows[0].props['data-novaflow-history-current'], '1');
    assert.equal(output.rows[1].props['data-novaflow-history-current'], '0');
    flat(output.rows[1]).find(n=>n.type==='button'&&n.props.style?.textOverflow==='ellipsis').props.onClick();
    assert.equal(output.picked, text); assert.deepEqual(picked,[text]);
    assert.equal(render(index,history,'').rows.filter(r=>r.props['data-novaflow-history-current']==='1').length,0);
  }
});
function mountHistory(storage) {
  const slots=[], effects=[]; let cursor=0, dirty=true, result;
  const hooks={useState(initial){const id=cursor++;if(!(id in slots))slots[id]=initial;return[slots[id],next=>{slots[id]=typeof next==='function'?next(slots[id]):next;dirty=true;}];},useEffect(fn,deps){const id=cursor++,old=slots[id];if(!old||deps.some((v,i)=>!Object.is(v,old[i]))){slots[id]=deps;effects.push(fn);}},useCallback(fn){cursor++;return fn;}};
  const context=vm.createContext({_:hooks,localStorage:storage});
  vm.runInContext(Object.entries(definitions).map(([key,value])=>`var ${key}=${value};`).join('\n'),context);
  function flush(){let count=0;while(dirty){assert(++count<20);dirty=false;cursor=0;result=context.Ja('ai_seq_prompt',{recentCap:15});effects.splice(0).forEach(fn=>fn());}return result;}
  return {get current(){return flush();},call(name,text){flush()[name](text);return flush();}};
}
test('save, delete, reselect and reload retain ordering, fixed saved slots and the 15 record budget',()=>{
  const values=new Map(), storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v))};
  let mounted=mountHistory(storage);
  for(let i=0;i<20;i++)mounted.call('addRecent','记录 '+i);
  mounted.call('savePinned','固定 A'); mounted.call('savePinned','固定 B');
  mounted.call('addRecent','记录 10');
  let rows=render(1,mounted.current,'记录 10').rows;
  const titles=rows=>rows.map(r=>flat(r).find(n=>n.type==='button'&&n.props.style?.textOverflow==='ellipsis').props.title);
  assert.equal(rows.length,15);assert.deepEqual(titles(rows).slice(0,3),['固定 A','固定 B','记录 10']);
  mounted=mountHistory(storage);assert.deepEqual(titles(render(1,mounted.current,'记录 10').rows),titles(rows));
  mounted.call('clearPinnedSlot',0);mounted.call('removeRecent','记录 10');
  assert.equal(titles(render(1,mounted.current,'固定 B').rows)[0],'固定 B');
  assert(!titles(render(1,mounted.current,'').rows).includes('记录 10'));
});
const artFunctions=['normalizeArtGeneratePromptHistoryText','artGeneratePromptHistoryCompareKey','createEmptyArtGeneratePromptHistorySlots','countArtGeneratePromptHistoryPinned','getArtGeneratePromptHistoryRecentCap','normalizeArtGeneratePromptHistoryItem','normalizeArtGeneratePromptHistoryItems','normalizeArtGeneratePromptHistorySlots','normalizeArtGeneratePromptHistoryGroup','artGeneratePromptHistoryStateKeys','ensureArtGeneratePromptHistoryLoaded','saveArtGeneratePromptHistory','getArtGeneratePromptHistoryGroup','addArtGeneratePromptHistoryValue','saveArtGeneratePromptHistorySlot','removeArtGeneratePromptHistoryRecent','clearArtGeneratePromptHistorySlot','buildArtGeneratePromptHistoryPopoverEntries'];
function art(storage) {
  const ctx=vm.createContext({Date,localStorage:storage,console});
  vm.runInContext(['const ART_GENERATE_PROMPT_HISTORY_STORAGE_KEY="novaflow_art_generate_prompt_history_v1",ART_GENERATE_PROMPT_HISTORY_SLOT_COUNT=5,ART_GENERATE_PROMPT_HISTORY_TOTAL_CAP=15;','const ART_GENERATE_STATE={prompt:"",negativePrompt:"",promptHistory:[],negativePromptHistory:[],promptPinnedSlots:[],negativePromptPinnedSlots:[],historyLoaded:false};',...artFunctions.map(n=>functions[n]),'this.api={'+artFunctions.join(',')+',ART_GENERATE_STATE};'].join('\n'),ctx);
  return ctx.api;
}
test('drawing positive and negative histories use the same saved-first order and identify the actual current record',()=>{
  const values=new Map(), storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v))};
  let api=art(storage);
  for(const key of ['prompt','negativePrompt']) {
    for(let i=0;i<20;i++)api.addArtGeneratePromptHistoryValue(key,'历史 '+i);
    api.saveArtGeneratePromptHistorySlot(key,'保存 A');api.saveArtGeneratePromptHistorySlot(key,'保存 B');
    api.addArtGeneratePromptHistoryValue(key,'最近使用');
    let rows=api.buildArtGeneratePromptHistoryPopoverEntries(key);
    assert.equal(rows.length,15);assert.deepEqual(Array.from(rows.slice(0,3),r=>r.item.text),['保存 A','保存 B','最近使用']);
    assert.equal(rows[2].options.primary,true);assert.equal(rows[2].options.current,true);
    api.ART_GENERATE_STATE[key]='保存 B';rows=api.buildArtGeneratePromptHistoryPopoverEntries(key);
    assert.equal(rows[1].options.current,true);assert.equal(rows[2].options.current,false);
    api.clearArtGeneratePromptHistorySlot(key,0);api.removeArtGeneratePromptHistoryRecent(key,'最近使用');
    assert.equal(api.buildArtGeneratePromptHistoryPopoverEntries(key)[0].item.text,'保存 B');
  }
  const reloaded=art(storage);
  for(const key of ['prompt','negativePrompt'])assert.equal(reloaded.buildArtGeneratePromptHistoryPopoverEntries(key)[0].item.text,'保存 B');
});
test('drawing history selection updates the mounted input before render or a following blur can read it',()=>{
  class Textarea {value='旧文字';}
  const input=new Textarea(), state={prompt:'旧文字'}, calls=[];
  const ctx=vm.createContext({HTMLTextAreaElement:Textarea,ART_GENERATE_WORKSPACE_ID:'workspace',ART_GENERATE_STATE:state,document:{querySelectorAll:()=>[input]},normalizeArtGeneratePromptHistoryText:t=>String(t).trim(),addArtGeneratePromptHistoryValue:(key,text)=>{assert.equal(input.value,text);calls.push(['recent',key,text]);},closeArtGeneratePromptHistoryPopover:()=>{},renderArtGenerateSurfaces:()=>{assert.equal(input.value,state.prompt);calls.push(['render']);}});
  vm.runInContext(functions.pickArtGeneratePromptHistoryValue,ctx);
  ctx.pickArtGeneratePromptHistoryValue('prompt','  选中的保存记录  ');
  assert.equal(input.value,'选中的保存记录');assert.equal(state.prompt,input.value);assert.equal(calls.length,2);
});
test('video history chrome targets the text button rather than the new current badge',()=>{
  class Element {constructor(text){this.textContent=text;}setAttribute(name,value){this[name]=value;}querySelectorAll(){return [];}hasAttribute(name){return name==='aria-pressed';}}
  class Button extends Element {}
  const badge=new Element('当前'),text=new Button('完整历史提示词'), row=new Element('row');row.children=[badge,text];
  const popup=new Element('popup');popup.querySelectorAll=()=>[row];
  const reset=[];
  const ctx=vm.createContext({HTMLElement:Element,HTMLButtonElement:Button,document:{body:{classList:{contains:()=>true}}},getAiAnimationPromptHistoryPopovers:()=>[popup],prepareAiAnimationPromptHistoryPopoverInPlace:()=>{},isAiAnimationHistoryPopoverActionText:()=>true,applyAiAnimationHistoryTextChromeReset:e=>reset.push(e),positionAiAnimationPromptHistoryPopover:()=>{}});
  vm.runInContext(functions.styleAiAnimationPromptHistoryPopovers,ctx);ctx.styleAiAnimationPromptHistoryPopovers();
  assert.deepEqual(reset,[text]);assert.equal(badge['data-novaflow-ai-history-popover-text'],undefined);assert.equal(text['data-novaflow-ai-history-popover-text'],'1');
});
