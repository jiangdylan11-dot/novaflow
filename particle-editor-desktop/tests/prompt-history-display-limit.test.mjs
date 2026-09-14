import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {patchPromptHistoryLimit} from '../../scripts/patch-prompt-history-limit.mjs';
const require = createRequire(import.meta.url);
const ts = require('../node_modules/typescript');
const source = fs.readFileSync(process.env.NOVAFLOW_HISTORY_TEST_BUNDLE || new URL('../../particle-editor/assets/index-BbIa-2NM.js',import.meta.url),'utf8');
const ast = ts.createSourceFile('bundle.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const components=[];
function visit(node) {
  if(ts.isFunctionExpression(node)) {
    const text=node.getText(ast);
    if(text.startsWith('function(e){let{title:t,value:n,onPick:r,history:i}') || text.startsWith('function(e){let{onPick:t,history:n}=e,r=!!e.inline')) {components.push(text);return;}
  }
  ts.forEachChild(node,visit);
}
visit(ast);
const historyDefinitions = {};
function findHistory(node) {
  if (ts.isVariableDeclaration(node) && ['Ga','Ka','qa','Ja'].includes(node.name.getText(ast)) && node.initializer && ts.isArrowFunction(node.initializer)) {
    historyDefinitions[node.name.getText(ast)] = node.initializer.getText(ast);
  }
  ts.forEachChild(node, findHistory);
}
findHistory(ast);

// Execute the shipped hook, including mount/load and every persistence effect.
function mountHistory(storage, name, options) {
  const slots=[], effects=[]; let cursor=0, dirty=true, result;
  const hooks={
    useState(initial) {
      const id=cursor++; if (!(id in slots)) slots[id]=initial;
      return [slots[id], next=>{const value=typeof next==='function'?next(slots[id]):next;if(value!==slots[id]){slots[id]=value;dirty=true;}}];
    },
    useEffect(callback,deps) {
      const id=cursor++, old=slots[id];
      if(!old || deps.some((value,i)=>!Object.is(value,old[i]))) {slots[id]=deps;effects.push(callback);}
    },
    useCallback(callback) {cursor++;return callback;}
  };
  const context=vm.createContext({_:hooks,localStorage:storage});
  vm.runInContext(Object.entries(historyDefinitions).map(([key,value])=>`var ${key}=${value};`).join('\n'),context);
  const flush=()=>{let guard=0;while(dirty){assert.ok(++guard<20,'effects settle');dirty=false;cursor=0;result=context.Ja(name,options);effects.splice(0).forEach(callback=>callback());}return result;};
  return {get current(){return flush();},call(method,text){flush()[method](text);return flush();}};
}

test('AI positive and negative history persist 15 combined entries through add, save, remove and remount',()=>{
  for(const name of ['ai_seq_prompt','ai_seq_negative_prompt']) {
    const match=source.match(new RegExp('Ja\\(`'+name+'`,\\{recentCap:(\\d+)\\}\\)'));
    assert.ok(match, name+' actual callsite');
    assert.equal(Number(match[1]),15);
    const values=new Map(),storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,String(value))};
    const options={recentCap:Number(match[1])};
    let mounted=mountHistory(storage,name,options);
    for(let i=0;i<22;i++) mounted.call('addRecent',`普通人物动作 ${i}：`+'完整提示词。'.repeat(100));
    assert.equal(mounted.current.recent.length,15);
    assert.match(mounted.current.recent[0].text,/动作 21/);
    assert.match(mounted.current.recent[14].text,/动作 7/);
    for(let i=0;i<5;i++) mounted.call('savePinned',`保存动作 ${i}`);
    assert.equal(mounted.current.recent.length,10);
    assert.equal(mounted.current.pinnedSlots.filter(Boolean).length,5);
    const stored=storage.getItem('nf_text_history:'+name);
    mounted=mountHistory(storage,name,options);
    assert.equal(mounted.current.recent.length,10);
    assert.equal(storage.getItem('nf_text_history:'+name),stored,'remount preserves exact persisted content');
    let states=0;
    const context={X:{jsx,jsxs:jsx},_:{useState:()=>[states++===0?true:{width:420,left:10,top:10,height:320},()=>{}],useRef:()=>({current:null}),useCallback:f=>f,useEffect:()=>{}},Xt:()=>{},Xa:()=>{},Jt:String,Yt:t=>t.slice(0,22),Ya:t=>t.slice(0,22)};
    const popup=vm.runInNewContext('('+components[1]+')',context);
    const tree=popup({inline:true,onPick:()=>{},history:mounted.current});
    assert.equal(flatten(tree).filter(node=>node.type==='button'&&node.props.style?.textOverflow==='ellipsis').length,15,'real persisted state renders 15 rows');
    mounted.call('clearPinnedSlot',2);
    mounted.call('addRecent','新增普通动作');
    assert.equal(mounted.current.recent.length,11);
    mounted.call('removeRecent','新增普通动作');
    assert.equal(mountHistory(storage,name,options).current.recent.length,10);
  }
});

test('history default and legacy six-entry data grow to fifteen without padding missing records',()=>{
  const values=new Map([['nf_text_history:legacy',JSON.stringify({recent:Array.from({length:6},(_,i)=>({text:'旧记录'+i,at:i+1})),pinned:[]})]]);
  const storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,String(value))};
  const mounted=mountHistory(storage,'legacy');
  assert.equal(mounted.current.recent.length,6);
  for(let i=0;i<12;i++)mounted.call('addRecent','新记录'+i);
  assert.equal(mounted.current.recent.length,15);
  assert.equal(mountHistory(storage,'legacy').current.recent.length,15);
});
const jsx=(type,props,key)=>({type,props,key});
function flatten(node) {
  if(Array.isArray(node)) return node.flatMap(flatten);
  if(!node || typeof node!=='object') return [];
  return [node,...flatten(node.props?.children)];
}
test('both shipped history components cap rows and pick the full original text without changing storage',()=>{
  assert.equal(components.length,2);
  assert.equal(ast.parseDiagnostics.length,0);
  assert.equal(patchPromptHistoryLimit(source),source,'patch is idempotent');
  for(const [index,code] of components.entries()) for(const pinnedCount of [0,1,5,20]) for(const recentCount of [0,4,30]) {
    const make=(kind,n)=>Object.freeze(Array.from({length:n},(_,i)=>Object.freeze({at:i+1,text:kind+i+'：'+('完整提示词。'.repeat(100))})));
    const pinned=make('保存',pinnedCount),recent=make('历史',recentCount);
    const history=Object.freeze({pinned,pinnedSlots:pinned,recent,isPinned:()=>false});
    let picked=null,states=0;
    const context={X:{jsx,jsxs:jsx},_:{useState:()=>[states++===0?true:{width:420,left:10,top:10,height:320},()=>{}],useRef:()=>({current:null}),useCallback:f=>f,useEffect:()=>{}},Xt:()=>{},Xa:()=>{},Jt:String,Yt:t=>t.slice(0,22),Ya:t=>t.slice(0,22)};
    const component=vm.runInNewContext('('+code+')',context);
    const tree=component({title:'提示词',value:'',inline:true,onPick:text=>{picked=text;},history});
    const rows=flatten(tree).filter(node=>node.type==='button'&&node.props.style?.textOverflow==='ellipsis');
    assert.equal(rows.length,Math.min(15,pinnedCount+recentCount),`component ${index}, pinned ${pinnedCount}, recent ${recentCount}`);
    const expected=index===0?[...pinned,...recent]:[...recent.slice(-1),...pinned,...recent.slice(0,-1).reverse()];
    for(const [rowIndex,row] of rows.entries()) {
      row.props.onClick();
      assert.equal(picked,expected[rowIndex].text);
      assert.ok(picked.length>500);
    }
    assert.equal(history.recent,recent);assert.equal(history.pinned,pinned);
    assert.equal(recent.length,recentCount);assert.equal(pinned.length,pinnedCount);
  }
});
