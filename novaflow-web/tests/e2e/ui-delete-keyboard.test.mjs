import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=name=>readFileSync(new URL('../../renderer/'+name,import.meta.url),'utf8');
const native=source('spine-split-runtime.js'),smart=source('ui-design.smart-split.js'),work=source('ui-design.workbench.js');
class Element {
 constructor(tag='div',attrs={},parent=null){this.tagName=tag.toUpperCase();this.attrs=attrs;this.parentElement=parent;}
 get isContentEditable(){return this.attrs.contenteditable==='true'||this.attrs.contenteditable===''||this.attrs.contenteditable==='plaintext-only'||!!this.parentElement?.isContentEditable;}
 matches(selector){if(selector[0]==='#')return this.attrs.id===selector.slice(1);if(selector[0]==='['){const m=selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);return m&&m[1] in this.attrs&&(m[2]===undefined||this.attrs[m[1]]===m[2]);}return this.tagName.toLowerCase()===selector;}
 closest(selector){for(let n=this;n;n=n.parentElement)if(selector.split(',').some(s=>n.matches(s.trim())))return n;return null;}
}
const el=(attrs,parent)=>new Element('div',attrs,parent),event=(target,extra={})=>({key:'Delete',target,ctrlKey:false,metaKey:false,altKey:false,shiftKey:false,prevented:0,stopped:0,preventDefault(){this.prevented++},stopPropagation(){this.stopped++},stopImmediatePropagation(){throw Error('Global immediate propagation blocking is forbidden')},...extra});
function nativeContext(){const c={Element,state:{selectedPartIds:['background','object']},LAYER_ROW_ATTR:'data-novaflow-spine-split-layer-row',WORKSPACE_CONTENT_ID:'novaflow-spine-split-workspace-content',isMountedCardVisible:()=>true,isMaskStencilActive:()=>false,isSplitEditToolActive:()=>false,deleted:0,deleteSelectedParts(){c.deleted++}};vm.createContext(c);vm.runInContext(native.slice(native.indexOf('  function isTextEditingTarget('),native.indexOf('  async function runLocalSplitSmokeTest(')),c);return c;}
test('native Delete requires native focus and yields to nested editor owners',()=>{
 for(const owner of ['data-ui-layout-editor','data-novaflow-ui-layout-section','data-novaflow-ui-split-preview','data-novaflow-ui-smart-split']){
  const c=nativeContext(),canvas=el({id:'novaflow-spine-split-workspace-content'}),target=el({},el({[owner]:'1'},canvas)),e=event(target);c.handleLayerHotkeys(e);assert.equal(c.deleted,0,owner);assert.equal(e.prevented,0);assert.equal(e.stopped,0);
 }
 for(const attrs of [{id:'novaflow-spine-split-workspace-content'},{'data-novaflow-spine-split-layer-row':'object'},{'data-novaflow-layer-scroll':'1'}]){const c=nativeContext(),e=event(el({},el(attrs)));c.handleLayerHotkeys(e);assert.equal(c.deleted,1);assert.equal(e.prevented,1);}
 const c=nativeContext();c.handleLayerHotkeys(event(el({})));assert.equal(c.deleted,0,'unrelated/body focus cannot delete a stale layer selection');
});
test('native Delete preserves all text-editing targets and empty/inactive selections',()=>{
 for(const target of [new Element('input'),new Element('textarea'),new Element('select'),el({},el({contenteditable:'true'})),el({contenteditable:'plaintext-only'})]){target.parentElement??=el({'data-novaflow-spine-split-layer-row':'object'});const c=nativeContext(),e=event(target);c.handleLayerHotkeys(e);assert.equal(c.deleted,0);assert.equal(e.prevented,0);}
 const c=nativeContext();c.state.selectedPartIds=[];const e=event(el({'data-novaflow-spine-split-layer-row':'object'}));c.handleLayerHotkeys(e);assert.equal(c.deleted,0);assert.equal(e.prevented,0);c.isMountedCardVisible=()=>false;c.state.selectedPartIds=['object'];c.handleLayerHotkeys(e);assert.equal(c.deleted,0);
});
function candidateContext(){const c={opened:true,busy:false,drag:null,proposal:{regions:[{id:'a',selected:true},{id:'b',selected:true},{id:'c',selected:false}]},manualActions:0,mode:'select',leftHost:{getAttribute:()=> '1'},renders:0,render(){c.renders++},selected:()=>c.proposal.regions.filter(x=>x.selected)};vm.createContext(c);vm.runInContext(smart.slice(smart.indexOf('    function removeSelectedCandidates()'),smart.indexOf("    overlay.addEventListener('keydown'")),c);return c;}
test('candidate Delete removes only its multiple selected candidates and counts one action',()=>{const c=candidateContext(),e=event(el({}));c.handleCandidateDelete(e);assert.deepEqual(Array.from(c.proposal.regions,r=>r.id),['c']);assert.equal(c.manualActions,1);assert.equal(e.prevented,1);c.handleCandidateDelete(event(el({})));assert.equal(c.manualActions,1,'empty selection is a no-op');});
test('candidate Delete is inert while closed, busy, dragging, outside UI, or editing text',()=>{
 for(const patch of [{opened:false},{busy:true},{drag:{}},{leftHost:{getAttribute:()=> '0'}}]){const c=Object.assign(candidateContext(),patch),e=event(el({}));c.handleCandidateDelete(e);assert.equal(c.proposal.regions.length,3);assert.equal(c.manualActions,0);assert.equal(e.prevented,0);}
 for(const target of [new Element('input'),new Element('textarea'),new Element('select'),el({},el({contenteditable:'true'}))]){const c=candidateContext(),e=event(target);c.handleCandidateDelete(e);assert.equal(c.proposal.regions.length,3);assert.equal(e.prevented,0);}
 for(const extra of [{ctrlKey:true},{metaKey:true},{altKey:true},{key:'Backspace'}]){const c=candidateContext();c.handleCandidateDelete(event(el({}),extra));assert.equal(c.proposal.regions.length,3);}
});
function layoutHandler(selected=true){let callback;const c={stage:{addEventListener(_,fn){callback=fn}},removed:0,removeSelection(){if(!selected)return false;c.removed++;selected=false;return true}};const start=work.indexOf("    stage.addEventListener('keydown', e => {"),end=work.indexOf("    shell.addEventListener('dragover'",start);vm.runInNewContext(work.slice(start,end),c);return {c,callback};}
test('layout Delete handles focused block descendants and empty selection without affecting other owners',()=>{const {c,callback}=layoutHandler(),e=event(el({'data-ui-workbench-block':'a'}));callback(e);assert.equal(c.removed,1);assert.equal(e.prevented,1);callback(event(el({})));assert.equal(c.removed,1);});
test('layout Delete preserves text input and modified key editing',()=>{for(const target of [new Element('input'),new Element('textarea'),new Element('select'),el({},el({contenteditable:''}))]){const {c,callback}=layoutHandler();callback(event(target));assert.equal(c.removed,0);}for(const extra of [{ctrlKey:true},{altKey:true},{metaKey:true},{key:'Backspace'}]){const {c,callback}=layoutHandler();callback(event(el({}),extra));assert.equal(c.removed,0);}});
