const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const renderer = path.resolve(__dirname, '../../renderer')
require(path.join(renderer, 'spine-structure.ops.js'))
const Ops = globalThis.NovaFlowSpineStructureOps
const src = fs.readFileSync(path.join(renderer, 'spine-skeleton-editor.js'), 'utf8').replace(/\r\n/g, '\n')
const section = (a, b) => src.slice(src.indexOf(a), src.indexOf(b, src.indexOf(a))) + '\n'

function fixture() {
  const j = Ops.prepare({ bones: [{ name: 'root' }], slots: [{ name: 'slot', bone: 'root' }], events: { end: {} }, animations: { idle: {} },
    skins: [{ name: 'default', attachments: { slot: { image: { width: 32, height: 32 }, mesh: { type: 'mesh' }, linked: { type: 'linkedmesh', parent: 'mesh' } } } },
      { name: 'blue', attachments: { slot: { placeholder: { type: 'mesh', path: 'blueImage' }, empty: { width: 32, height: 32 } } } },
      { name: 'red', attachments: { slot: { placeholder: { path: 'redImage', width: 32, height: 32 } } } }] })
  const state = { json: j, skin: 'blue', name: 'filter QA', filter: {}, collapsed: new Set(), sections: new Set(), hiddenSlots: new Set(), hiddenBones: new Set(),
    multi: [], multiSlots: [], roles: new Map(), search: '', sel: null }
  const tree = { scrollTop: 0, clientHeight: 60, append(n) { this.rows = n.kids; this.rows.forEach((r,i)=>{r.offsetTop=i*25}) }, textContent: '', querySelector() { return this.rows.find(r=>r.attrs['data-selected']==='1') || null } }
  const h = (tag, attrs, ...kids) => ({ tag, attrs: attrs || {}, kids: kids.flat(Infinity).filter(x => x != null), listeners:{},
    setAttribute(k,v) { this.attrs[k]=v }, addEventListener(k,v,capture) { (this.listeners[k] ||= []).push({fn:v,capture}) } })
  const ctx = vm.createContext({ state, Ops, rt: {}, h, $: () => tree, projects: [], activeProject: 0, KEY_COLOR: { event: '#fff' },
    ICON: new Proxy({}, { get: (_, key) => String(key) }), skinOf: name => j.skins.find(s => s.name === name),
    SLOT_TRACKS:()=>[], BONE_TRACKS:()=>[], wireAudioEventDrop() {}, keyBtn() {}, meshKeyEnd() {}, consKeyEnd() {},
    bone: name => j.bones.find(b => b.name === name), animOn: () => state.mode === 'animate', isSel: (kind,name) => state.sel?.kind===kind && state.sel?.name===name,
    selectedAttachments: () => [], selectedSkins: () => [], allConstraints: () => [{ kind: 'transform', c: { name: 'follow' } }],
    drawOrderNow: () => j.slots.map(s => s.name), clipRanges: () => new Map(), slotOf: name => j.slots.find(s => s.name === name),
    caret() {}, visDot(on,toggle) { return h('span', {class:'vis','data-on':on?'1':null,onclick(e){e.stopPropagation();toggle()}}) },
    wireDrag(row,payload) {row.dragPayload=payload}, boneIcon() {}, consOf: () => [], consRowEnd() {},
    select(sel) {state.sel=sel;state.multiSlots=[sel.name];ctx.revealInTree(sel);ctx.renderTree()}, refresh() {ctx.renderTree()},
    timeSec() {return 0.5}, edit(message,operation) { ctx.editCount=(ctx.editCount||0)+1; ctx.editResult=operation(state.json) },
    newSkin() {}, newEvent() {}, newAnimation() {},
    renderAudioNode: rows => rows.push(h('div', { class: 'row', 'data-key': 'audio' }, '音频')),
    renderImagesNode: rows => rows.push(h('div', { class: 'row', 'data-key': 'images' }, '图片')),
    closeMenu() {}, mountMenu: n => { ctx.menu = n }, innerHeight: 800,
  })
  vm.runInContext(section('  function revealInTree(', '  function isSel(')
    + section('  const TREE_FILTERS =', '\n\n  const $')
    + src.match(/^  const byName = .+$/m)[0] + '\n'
    + section('  function slotContents(', '  /** Drag & drop in the tree')
    + section('  function dropRules(', '  function wireDrag(')
    + section('  function searchMatches(', '  function focusRename(')
    + section('  function renderTree(', '  /** Enter in the search box:')
    + section('  function filterMenu(', '\n\n  /**'), ctx)
  vm.runInContext('state.filter = Object.fromEntries(TREE_FILTERS.map(([key]) => [key, true]))', ctx)
  return { state, ctx, tree, only(...keys) { for (const key in state.filter) state.filter[key] = keys.includes(key) },
    keys() { ctx.renderTree(); return tree.rows.map(r => r.attrs['data-key']).filter(Boolean) },
    rigKeys() { return this.keys().filter(k => /^(att:|ph:|b:|slot:)/.test(k)) },
    texts() { const text = n => typeof n === 'string' ? n : (n?.kids || []).map(text).join(' '); return tree.rows.map(text).join(' ') } }
}



const findRow = (f,key) => f.tree.rows.find(r=>r.attrs['data-key']===key)
const allKids = node => [node, ...(node?.kids||[]).flatMap(allKids)]
const stopEvent = () => ({ stopped:false, stopPropagation(){this.stopped=true} })
test('draw-order and ordinary rows share slot visibility in both directions without edits', () => {
 const f=fixture(); f.keys();
 let order=findRow(f,'order:slot'), normal=findRow(f,'slot:slot');
 const dot = row => allKids(row).find(n=>n?.attrs?.class==='vis');
 assert.equal(dot(order).attrs['data-on'],'1'); assert.equal(dot(normal).attrs['data-on'],'1');
 const e=stopEvent(); dot(order).attrs.onclick(e); assert(e.stopped); assert(f.state.hiddenSlots.has('slot'));
 order=findRow(f,'order:slot'); normal=findRow(f,'slot:slot');
 assert.equal(order.attrs['data-hidden'],'1'); assert.equal(normal.attrs['data-hidden'],'1');
 dot(normal).attrs.onclick(stopEvent()); assert(!f.state.hiddenSlots.has('slot'));
 assert.equal(dot(findRow(f,'order:slot')).attrs['data-on'],'1');
})
test('jump selects slot, opens collapsed ancestor and scrolls the ordinary tree row', () => {
 const f=fixture(); f.state.json.bones.push({name:'parent',parent:'root'}); f.state.json.slots[0].bone='parent';
 f.state.collapsed.add('b:root'); f.state.collapsed.add('b:parent'); f.keys();
 const order=findRow(f,'order:slot'); assert(order);
 const jump=allKids(order).find(n=>n?.tag==='button'&&n?.attrs?.['data-order-control']!==undefined);
 assert(jump); const e=stopEvent(); jump.attrs.onclick(e); assert(e.stopped);
 assert.equal(f.state.sel.kind,'slot');assert.equal(f.state.sel.name,'slot');
 assert(!f.state.collapsed.has('b:root'));assert(!f.state.collapsed.has('b:parent'));
 assert.equal(findRow(f,'slot:slot').attrs['data-selected'],'1');
 assert(f.tree.scrollTop>0,'scroll should move toward ordinary slot row');
})
test('order controls prevent drag while ordinary row remains reorderable; filter behavior preserved', () => {
 const f=fixture();f.keys();const order=findRow(f,'order:slot');
 const pointer = order.attrs.onpointerdown;
 const guard = order.attrs.ondragstart;
 pointer({target:{closest:()=>true}});let prevented=false,stopped=false;
 guard({preventDefault(){prevented=true},stopImmediatePropagation(){stopped=true}});
 assert(prevented&&stopped);assert.equal(order.dragPayload.type,'order');
 pointer({target:{closest:()=>null}});prevented=false;stopped=false;
 guard({preventDefault(){prevented=true},stopImmediatePropagation(){stopped=true}});assert(!prevented&&!stopped);
 f.only('slots');assert(!f.keys().includes('order:slot'));
 f.only('bones','slots');assert(f.keys().includes('order:slot'));
 f.state.search='slot';assert(!f.keys().includes('order:slot'));assert(f.keys().includes('slot:slot'));
 f.state.search='';assert(f.keys().includes('order:slot'));
})
test('controls never key animation; original drag rule still changes order and keys it in animation', () => {
 const f=fixture(); f.state.mode='animate'; f.state.anim='idle'; f.state.json.slots.push({name:'slot2',bone:'root'}); f.keys();
 const before=JSON.stringify(f.state.json.animations), row=findRow(f,'order:slot');
 allKids(row).find(n=>n?.attrs?.class==='vis').attrs.onclick(stopEvent());
 const jump=allKids(findRow(f,'order:slot')).find(n=>n?.tag==='button'&&n?.attrs?.['data-order-control']!==undefined);
 jump.attrs.onclick(stopEvent()); assert.equal(f.ctx.editCount||0,0); assert.equal(JSON.stringify(f.state.json.animations),before);
 const rule=f.ctx.dropRules({type:'order',name:'slot'}, {type:'order',name:'slot2'}); assert(rule); rule.run({},false);
 assert.equal(f.ctx.editCount,1); assert(f.ctx.editResult.json.animations.idle.drawOrder?.length>0);
})
