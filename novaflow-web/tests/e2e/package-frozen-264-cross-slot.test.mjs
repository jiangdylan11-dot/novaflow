import test from 'node:test';
import assert from 'node:assert/strict';
import {assertSafeMember,onlyCrossSlotChange} from '../../tools/package-frozen-264-cross-slot.mjs';

test('frozen archive rejects path traversal and ambiguous filenames',()=>{
 assert.equal(assertSafeMember('vendor/test.js'),'vendor/test.js');
 for(const name of ['', '../x', 'a/../x', '/x', 'a\\x', 'C:/x', 'a//b', 'a/./b', 'a/\u0000b'])assert.throws(()=>assertSafeMember(name));
});
test('cross-slot verifier rejects unrelated source changes',()=>{
 const base='  function selectAttachment(sel, e) {\n      const rows = visibleAttachments(sel), anchor = state.attachmentAnchor || state.sel\n';
 const added="  function visibleAttachmentRange(sel) {\n    return [...document.querySelectorAll('#tree .row[data-att-name]')].map((row) => ({ kind: 'att', skin: row.dataset.attSkin, slot: row.dataset.attSlot, name: row.dataset.attName }))\n      .filter((a) => a.skin === sel.skin)\n  }\n\n";
 const modified=added+base.replace('const rows = visibleAttachments(sel)','const rows = visibleAttachmentRange(sel)');
 assert.doesNotThrow(()=>onlyCrossSlotChange(base,modified));
 assert.throws(()=>onlyCrossSlotChange(base,modified+'unexpected'));
 assert.throws(()=>onlyCrossSlotChange(base+base,modified));
});
