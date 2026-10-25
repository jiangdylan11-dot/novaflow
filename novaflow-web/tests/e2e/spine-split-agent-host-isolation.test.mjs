import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';

const source=readFileSync(new URL('../../renderer/spine-split-runtime.js',import.meta.url),'utf8');
function section(start,end){const first=source.indexOf(`  function ${start}(`),last=source.indexOf(`  function ${end}(`,first);assert.ok(first>=0&&last>first);return source.slice(first,last);}
const functions=section('isXiaotaoArtRuntimeElement','findLeftPanelRoot')+section('hideManagedNode','rightWorkspacePanelShellStyle')+section('ensureRightWorkspacePanelShell','hideUnderlyingPreviewControlsForSplitWorkspace');
const SPLIT='novaflow-spine-split-right-workspace',ROOT_ATTR='data-novaflow-spine-split-right-root',HIDDEN='data-novaflow-spine-split-hidden-display';

function environment(){
  class Element{
    constructor(tag='div',{id='',className='',rect={left:0,right:0,width:0,height:0},text=''}={}){Object.assign(this,{tagName:tag.toUpperCase(),id,className,rect,textContent:text,parentElement:null,children:[],style:{},attrs:new Map()});}
    matches(selector){return selector.split(',').some(raw=>{const s=raw.trim();if(s.startsWith('#'))return this.id===s.slice(1);if(s.startsWith('.'))return this.className.split(/\s+/).includes(s.slice(1));if(s.startsWith('[')){const m=s.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);return !!m&&this.attrs.has(m[1])&&(m[2]===undefined||this.attrs.get(m[1])===m[2]);}return this.tagName.toLowerCase()===s;});}
    closest(selector){for(let n=this;n;n=n.parentElement)if(n.matches(selector))return n;return null;}
    appendChild(child){if(child.parentElement)child.parentElement.children=child.parentElement.children.filter(node=>node!==child);child.parentElement=this;this.children.push(child);return child;}
    contains(other){return other===this||this.children.some(child=>child.contains(other));}
    querySelector(selector){return descend(this).find(node=>node!==this&&node.matches(selector))||null;}
    getBoundingClientRect(){return this.rect;}
    hasAttribute(name){return this.attrs.has(name);}
    getAttribute(name){return this.attrs.get(name)??null;}
    setAttribute(name,value){this.attrs.set(name,String(value));}
    removeAttribute(name){this.attrs.delete(name);}
  }
  function descend(node){return [node,...node.children.flatMap(descend)];}
  const body=new Element('body'),document={body,getElementById:id=>descend(body).find(node=>node.id===id)||null,querySelectorAll:selector=>descend(body).filter(node=>node!==body&&node.matches(selector))};
  const applied=[];
  const sandbox={HTMLElement:Element,document,window:{innerWidth:1280,getComputedStyle:node=>({display:node.style.display||'block',visibility:node.style.visibility||'visible'})},RIGHT_WORKSPACE_ID:SPLIT,WORKSPACE_OVERLAY_ID:'split-overlay',RIGHT_WORKSPACE_ROOT_ATTR:ROOT_ATTR,HIDDEN_ATTR:HIDDEN,mountedCard:null,textOf:node=>node.textContent,splitRightWorkspaceWidth:()=>280,ensureFallbackRightWorkspaceHost:()=>{throw new Error('Unexpected fallback');},uiTraceCurrent:()=>{},applyRightWorkspaceRootStyle:node=>applied.push(node),rightWorkspacePanelShellStyle:()=>({}),h:(tag,options)=>new Element(tag,{id:options.id})};
  const vm=createContext(sandbox);runInContext(functions,vm);
  const agentRect={left:872,right:1264,width:392,height:650},resourceRect={left:1000,right:1280,width:280,height:720};
  const agentHost=body.appendChild(new Element('div',{id:'nf-xiaotao-art-root'})),agent=agentHost.appendChild(new Element('aside',{id:'nf-xiaotao-art-panel',rect:agentRect,text:'小桃AI'}));
  const resource=body.appendChild(new Element('aside',{id:'real-resource-panel',rect:resourceRect,text:'资源和图层'}));
  return {api:vm,Element,body,agentHost,agent,resource,agentRect,applied};
}

test('a right-aligned 392 by 650 Agent tree is excluded while the resource column remains a valid host',()=>{
  const e=environment();
  assert.equal(e.api.isRightPanelRootCandidate(e.agent),false);
  const child=e.agent.appendChild(new e.Element('section',{rect:e.agentRect}));
  assert.equal(e.api.isRightPanelRootCandidate(child),false);
  assert.equal(e.api.isRightPanelRootCandidate(e.resource),true);
  assert.equal(e.api.findRightPanelRoot(),e.resource);
});

test('the Agent host class excludes its entire tree even without the standard host ID',()=>{
  const e=environment();e.agentHost.id='alternate-agent';e.agentHost.className='floating nf-xiaotao-art-root';
  assert.equal(e.api.isRightPanelRootCandidate(e.agent),false);
  const nested=e.agent.appendChild(new e.Element('div',{rect:e.agentRect}));
  assert.equal(e.api.isRightPanelRootCandidate(nested),false);
  assert.equal(e.api.findRightPanelRoot(),e.resource);
});

test('split hiding leaves Agent children untouched but still restores existing hidden-display pollution',()=>{
  const e=environment();
  for(const tag of ['header','section','footer']){
    const child=e.agent.appendChild(new e.Element(tag));child.style.display='flex';
    e.api.hideManagedNode(child,true);
    assert.equal(child.style.display,'flex');assert.equal(child.hasAttribute(HIDDEN),false);
    child.setAttribute(HIDDEN,'grid');child.style.display='none';
    e.api.hideManagedNode(child,false);
    assert.equal(child.style.display,'grid');assert.equal(child.hasAttribute(HIDDEN),false);
  }
  const ordinary=e.resource.appendChild(new e.Element('header'));ordinary.style.display='flex';
  e.api.hideManagedNode(ordinary,true);assert.equal(ordinary.style.display,'none');assert.equal(ordinary.getAttribute(HIDDEN),'flex');
  e.api.hideManagedNode(ordinary,false);assert.equal(ordinary.style.display,'flex');assert.equal(ordinary.hasAttribute(HIDDEN),false);
});

test('a reused and tagged Agent root is invalidated and the existing split shell relocates to the real resource column',()=>{
  const e=environment();e.agent.setAttribute(ROOT_ATTR,'1');
  const header=e.agent.appendChild(new e.Element('header'));
  const split=e.agent.appendChild(new e.Element('div',{id:SPLIT}));
  const realHeader=e.resource.appendChild(new e.Element('header'));
  assert.equal(e.api.findRightPanelRoot(),e.resource,'neither existing parent nor tagged-root reuse may select the Agent');
  assert.equal(e.api.ensureRightWorkspacePanelShell(e.api.findRightPanelRoot()),split);
  assert.equal(split.parentElement,e.resource);assert.equal(e.agent.children.includes(split),false);
  assert.equal(header.hasAttribute(HIDDEN),false);assert.equal(realHeader.getAttribute(HIDDEN),'');
  assert.equal(e.applied.at(-1),e.resource);
});
