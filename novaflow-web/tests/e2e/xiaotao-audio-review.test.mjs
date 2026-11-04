import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext,runInContext} from 'node:vm';
import {createDomSandbox} from '../../worker/src/comfy/dom-shim.mjs';

const audioSource=await readFile(new URL('../../renderer/audio-studio.tool.js',import.meta.url),'utf8');
const timelineSource=await readFile(new URL('../../renderer/audio-timeline.editor.js',import.meta.url),'utf8');
function fixture(){
  const root=createDomSandbox({});
  const createElement=root.document.createElement;
  root.document.createElement=(...args)=>{const el=createElement(...args);el.replaceChildren=()=>{};return el;};
  const context=createContext(root);
  runInContext(timelineSource,context,{filename:'audio-timeline.editor.js'});
  runInContext(audioSource,context,{filename:'audio-studio.tool.js'});
  root.NovaFlowAudioStudio.open('audio');
  return {root,api:root.NovaFlowAudioStudio};
}

test('music and sound-effect drafts compile selected text with native settings; apply and undo require confirmation',()=>{
  const {api}=fixture();
  for(const kind of ['music','sfx']){
    api.setMode(kind);
    const review=api.captureTextReview(kind),input=review.compileInput('soft wood sound');
    assert.match(input,/soft wood sound/);
    assert.match(input,kind==='music'?/instrumental.*seamless loop.*BPM: 100/:/game sound effect, clean, no music/);
    assert.throws(()=>review.applyDraft('new prompt'),/./);
    assert.throws(()=>review.applyDraft('new prompt',{userConfirmed:true,bindingCurrent:()=>false}),/./);
    assert.equal(review.applyDraft('new prompt',{userConfirmed:true,bindingCurrent:()=>true}).phase,'applied');
    assert.equal(api.agentSettings()[kind].text,'new prompt');
    assert.equal(api.agentSettings()[kind].optimized,'new prompt');
    assert.throws(()=>review.undoDraft({userConfirmed:false,bindingCurrent:()=>true}),/./);
    assert.equal(review.undoDraft({userConfirmed:true,bindingCurrent:()=>true}).phase,'undone');
    assert.equal(api.agentSettings()[kind].text,review.prompt);
  }
});

test('an audio draft cannot be applied after the workspace or mode changes and returns',()=>{
  const {api}=fixture();
  const review=api.captureTextReview('music');
  api.setMode('sfx');api.setMode('music');
  assert.equal(review.isCurrent(),false);
  assert.throws(()=>review.compileInput('soft sound'),/./);
  assert.throws(()=>review.applyDraft('new',{userConfirmed:true,bindingCurrent:()=>true}),/./);
  const next=api.captureTextReview('music');
  api.close();api.open('audio');
  assert.equal(next.isCurrent(),false);
});

test('a chosen chat source never contains the distinct page prompt and stale text cannot be overwritten',()=>{
  const {api}=fixture();
  const first=api.captureTextReview('music');
  first.applyDraft('old page melody',{userConfirmed:true,bindingCurrent:()=>true});
  const review=api.captureTextReview('music');
  assert.equal(review.prompt,'old page melody');
  const compiled=review.compileInput('new chat melody');
  assert.match(compiled,/new chat melody/);
  assert.doesNotMatch(compiled,/old page melody/);
  assert.equal(api.agentSettings().music.text,'old page melody');
  const later=api.captureTextReview('music');
  later.applyDraft('user changed text',{userConfirmed:true,bindingCurrent:()=>true});
  assert.equal(review.isCurrent(),false);
  assert.throws(()=>review.applyDraft('stale output',{userConfirmed:true,bindingCurrent:()=>true}),/./);
  assert.equal(api.agentSettings().music.text,'user changed text');
});

test('empty and over-limit source is rejected before any rewrite and audio-page data is unchanged',()=>{
  const {api}=fixture(),review=api.captureTextReview('music');
  assert.throws(()=>review.compileInput('   '),/./);
  assert.throws(()=>review.compileInput('x'.repeat(1501)),/./);
  assert.equal(api.agentSettings().music.text,'');
});

test('audio/video route revision advances on a round trip and never revives an old review',()=>{
  const {api}=fixture(),initial=api.routeRevision(),review=api.captureTextReview('music');
  api.open('video');const onVideo=api.routeRevision();
  api.open('audio');const backOnAudio=api.routeRevision();
  api.open('video');const backOnVideo=api.routeRevision();
  assert.ok(initial<onVideo&&onVideo<backOnAudio&&backOnAudio<backOnVideo);
  assert.equal(review.isCurrent(),false);
});
