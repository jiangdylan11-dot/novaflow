import test from 'node:test';
import assert from 'node:assert/strict';
import {parseV3Capabilities} from '../supabase/functions/novaflow-companion/capabilities.mjs';

const names=['operation','recovery','art','vision','audioRewrite','videoRewrite','uiDraft','foartOpen','foartRotation','foartIdleDraft'];
const off=Object.fromEntries([...names,'foartAudioMusic','foartGeneral'].map(name=>[name,false]));
const parse=value=>parseV3Capabilities(JSON.stringify(value));

test('253 capability configuration defaults closed and is precise when enabled',()=>{
  assert.deepEqual(parseV3Capabilities(undefined),off);
  assert.deepEqual(parse({}),off);
  assert.deepEqual(parse({operation:true,recovery:true}),{...off,operation:true,recovery:true});
  assert.deepEqual(parse({recovery:true}),{...off,recovery:true});
  assert.deepEqual(parse({operation:true,recovery:true,videoRewrite:true}),{...off,operation:true,recovery:true,videoRewrite:true});
  assert.deepEqual(parse({operation:true,recovery:true,uiDraft:true}),{...off,operation:true,recovery:true,uiDraft:true});
  assert.deepEqual(parse({operation:true,recovery:true,vision:true,uiDraft:true}),{...off,operation:true,recovery:true,vision:true,uiDraft:true});
  assert.deepEqual(parse({operation:true,recovery:true,foartOpen:true,foartRotation:true}),
    {...off,operation:true,recovery:true,foartOpen:true,foartRotation:true});
  assert.deepEqual(parse({operation:true,recovery:true,foartOpen:true,foartIdleDraft:true}),
    {...off,operation:true,recovery:true,foartOpen:true,foartIdleDraft:true});
});

test('253 parser rejects malformed, ambiguous and unsafe capability combinations',()=>{
  for(const raw of ['','null','[]','true','{"operation":true,"operation":false}',
    '{"operation":true,"\\u006fperation":false}'])assert.throws(()=>parseV3Capabilities(raw));
  for(const value of [{operation:true},{recovery:true,uiDraft:true,vision:true},{recovery:true,videoRewrite:true},{recovery:true,vision:true},{operation:true,recovery:true,foartRotation:true},{operation:true,recovery:true,foartIdleDraft:true},
    {operation:true,recovery:true,unknown:true},{operation:'true',recovery:true}])assert.throws(()=>parse(value));
});
