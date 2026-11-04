import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {isolatedUiPlan,prepareIsolatedUiStage,inspectIsolatedUiInputs,permitIsolatedUiInput} from '../tools/isolated-ui-build-policy.mjs';

test('isolation is opt-in, validates exact tag and requires check before any output',()=>{
 assert.equal(isolatedUiPlan('/project',{},[]),null);
 assert.throws(()=>isolatedUiPlan('/project',{FOART_ISOLATED_BUILD_TAG:'../other',FOART_ISOLATED_UI_ONLY:'1'},['--check']),/tag/i);
 assert.throws(()=>isolatedUiPlan('/project',{FOART_ISOLATED_BUILD_TAG:'trial',FOART_ISOLATED_UI_ONLY:'1'},[]),/check/i);
 assert.throws(()=>isolatedUiPlan('/project',{FOART_ISOLATED_BUILD_TAG:'trial'},['--check']),/UI-only/i);
 assert.throws(()=>isolatedUiPlan('/project',{FOART_ISOLATED_UI_ONLY:'1'},['--check']),/tag/i);
 const plan=isolatedUiPlan('/project',{FOART_ISOLATED_BUILD_TAG:'trial',FOART_ISOLATED_UI_ONLY:'1'},['--check']);assert.equal(plan.tag,'trial');assert.match(plan.stage,/isolated-builds/);
});
test('isolated stage is fresh, contained, and refuses an existing stage or reparse parent',async t=>{
 const root=await mkdtemp(join(tmpdir(),'foart-stage-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const plan=isolatedUiPlan(root,{FOART_ISOLATED_BUILD_TAG:'trial',FOART_ISOLATED_UI_ONLY:'1'},['--check']);await prepareIsolatedUiStage(root,plan.tag);await assert.rejects(prepareIsolatedUiStage(root,plan.tag),/EEXIST/);
 const other=await mkdtemp(join(tmpdir(),'foart-stage-outside-'));t.after(()=>rm(other,{recursive:true,force:true}));const bad=await mkdtemp(join(tmpdir(),'foart-stage-parent-'));t.after(()=>rm(bad,{recursive:true,force:true}));
 await symlink(other,join(bad,'.artifacts'),process.platform==='win32'?'junction':'dir');await assert.rejects(prepareIsolatedUiStage(bad,'unsafe'),/unsafe|reparse/i);
});
test('input scan rejects reparse, unknown/private artifacts and excludes even known models',async t=>{
 const root=await mkdtemp(join(tmpdir(),'foart-input-test-'));t.after(()=>rm(root,{recursive:true,force:true}));for(const name of ['assets','templates','aifx-styles','vendor','public'])await mkdir(join(root,name));
 await writeFile(join(root,'assets','page.js'),'// public');await mkdir(join(root,'vendor','matting'));await writeFile(join(root,'vendor','matting','model.bin'),'not copied');
 const tracked=new Set(['assets/page.js']);const scan=()=>inspectIsolatedUiInputs(root,{tracked});const result=await scan();assert.ok(result.omitted.includes('vendor/matting'));assert.equal(await permitIsolatedUiInput(root,join(root,'assets','page.js'),result.approved),true);await writeFile(join(root,'assets','late.png'),'new');await assert.rejects(permitIsolatedUiInput(root,join(root,'assets','late.png'),result.approved),/changed|unapproved/i);await rm(join(root,'assets','late.png'));await assert.rejects(permitIsolatedUiInput(root,join(root,'..','outside.png'),result.approved),/unapproved/i); 
 await writeFile(join(root,'assets','private.gguf'),'not copied');await assert.rejects(scan(),/unapproved|private/i);await rm(join(root,'assets','private.gguf'));
 await writeFile(join(root,'assets','credentials.key'),'secret');await assert.rejects(scan(),/unapproved|private/i);await rm(join(root,'assets','credentials.key'));
 const target=await mkdtemp(join(tmpdir(),'foart-source-outside-'));t.after(()=>rm(target,{recursive:true,force:true}));await symlink(target,join(root,'vendor','outside'),process.platform==='win32'?'junction':'dir');await assert.rejects(scan(),/reparse|link/i);
});