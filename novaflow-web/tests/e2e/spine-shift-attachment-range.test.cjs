'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const src=fs.readFileSync(path.join(__dirname,'../../renderer/spine-skeleton-editor.js'),'utf8').replace(/\r\n/g,'\n')
const start=src.indexOf('  function visibleAttachments('),end=src.indexOf('  function propsKind()',start)
assert(start>=0&&end>start)
function fixture(){
 const rows=[['default','A','a0'],['default','A','a1'],['default','B','b0'],['other','B','hidden'],['default','B','b1']].map(([attSkin,attSlot,attName])=>({dataset:{attSkin,attSlot,attName}}))
 const state={attachmentAnchor:{kind:'att',skin:'default',slot:'A',name:'a0'},sel:{kind:'att',skin:'default',slot:'A',name:'a0'}};let selected
 const ctx={state,document:{querySelectorAll:()=>rows},sameAttachment:(a,b)=>!!a&&!!b&&a.skin===b.skin&&a.slot===b.slot&&a.name===b.name,select:(s,add,opts)=>{selected={s,add,opts}}}
 vm.runInNewContext(src.slice(start,end),ctx)
 return {ctx,state,rows,get:()=>selected}
}
const selectedNames=x=>Array.from(x.opts.attachments,a=>a.slot+'/'+a.name)
test('Shift selects visible attachments across slots within the same skin in either direction',()=>{
 const f=fixture(),target={kind:'att',skin:'default',slot:'B',name:'b1'}
 f.ctx.selectAttachment(target,{shiftKey:true});assert.deepEqual(selectedNames(f.get()),['A/a0','A/a1','B/b0','B/b1'])
 f.state.attachmentAnchor=target;f.ctx.selectAttachment({kind:'att',skin:'default',slot:'A',name:'a1'},{shiftKey:true});assert.deepEqual(selectedNames(f.get()),['A/a1','B/b0','B/b1'])
})
test('range uses only visible rows and preserves Ctrl+A same-slot scope',()=>{
 const f=fixture();f.rows.splice(1,1)
 f.ctx.selectAttachment({kind:'att',skin:'default',slot:'B',name:'b1'},{shiftKey:true});assert.deepEqual(selectedNames(f.get()),['A/a0','B/b0','B/b1'])
 assert.equal(f.ctx.selectAllAttachments(),true);assert.deepEqual(selectedNames(f.get()),['A/a0'])
})
test('unavailable anchor falls back to ordinary selection without fabricating range',()=>{
 const f=fixture();f.state.attachmentAnchor={kind:'att',skin:'default',slot:'X',name:'missing'}
 f.ctx.selectAttachment({kind:'att',skin:'default',slot:'B',name:'b1'},{shiftKey:true});assert.equal(f.get().opts.noReveal,true);assert.equal(f.get().opts.attachments,undefined)
})
