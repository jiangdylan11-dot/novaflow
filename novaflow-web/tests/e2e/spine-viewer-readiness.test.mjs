import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../../renderer/spine-viewer.tool.js',import.meta.url),'utf8');
const handler=source.match(/frame\.addEventListener\('load', \(\) => \{([\s\S]*?)\n      \}\)/)?.[1];
test('viewer readiness completes when Chromium never dispatches a painting frame',()=>{
 const timers=[];let completed=0,failed='';const root={loadTimer:1,window:{setTimeout:callback=>{timers.push(callback);return timers.length;},clearTimeout(){},requestAnimationFrame(){}},completeFrame:()=>{completed++;return true;},failFrame:message=>{failed=message;}};
 root.frame={hasAttribute:()=>true};assert.ok(handler);vm.runInNewContext('this.onLoad=()=>{'+handler+'}',root);root.onLoad();assert.equal(completed,0);assert.equal(timers.length,1);timers[0]();assert.equal(completed,1);timers[0]();assert.equal(completed,1);assert.equal(failed,'');
});
test('a loaded document without the native viewer reports failure instead of fake readiness',()=>{
 const timers=[];let failed='';const root={loadTimer:1,window:{setTimeout:callback=>{timers.push(callback);return timers.length;},clearTimeout(){},requestAnimationFrame(){}},completeFrame:()=>false,failFrame:message=>{failed=message;}};
 root.frame={hasAttribute:()=>true};vm.runInNewContext('this.onLoad=()=>{'+handler+'}',root);root.onLoad();timers[0]();assert.match(failed,/未正常启动/);
});
