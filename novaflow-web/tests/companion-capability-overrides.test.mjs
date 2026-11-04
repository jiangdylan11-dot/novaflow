import test from 'node:test';
import assert from 'node:assert/strict';
import {parseV3Capabilities} from '../../novaflow-web/supabase/functions/novaflow-companion/capabilities.mjs';
import {mergeCapabilityOverrides as merge,OPT_IN_KEYS as K} from '../supabase/functions/novaflow-companion/capability-overrides.mjs';

const base=JSON.stringify({operation:true,recovery:true,art:true,vision:false,foartOpen:true,foartRotation:true,foartIdleDraft:false});
test('no overrides preserves all existing capabilities and returns frozen value',()=>{
 const result=merge(base);assert.deepEqual(result,parseV3Capabilities(base));assert(Object.isFrozen(result));
});
test('absent fields may be individually opted in without changing vision, art or unrelated capabilities',()=>{
 const result=merge(base,{[K.audioRewrite]:'true',[K.videoRewrite]:'true',[K.uiDraft]:'true'});
 assert.equal(result.audioRewrite,true);assert.equal(result.videoRewrite,true);assert.equal(result.uiDraft,true);
 for(const key of ['operation','recovery','art','vision','foartOpen','foartRotation','foartIdleDraft'])assert.equal(result[key],parseV3Capabilities(base)[key]);
 assert.equal(result.vision,false); // image-bearing requests must still fail closed downstream
});
test('explicit original false and true both win over individually valid overrides',()=>{
 const input=JSON.stringify({operation:true,recovery:true,audioRewrite:false,videoRewrite:true,uiDraft:false});
 const result=merge(input,{[K.audioRewrite]:'true',[K.videoRewrite]:'false',[K.uiDraft]:'true'});
 assert.equal(result.audioRewrite,false);assert.equal(result.videoRewrite,true);assert.equal(result.uiDraft,false);
});
test('explicit false opt-in and absent opt-ins remain disabled',()=>{
 const result=merge(base,{[K.audioRewrite]:'false'});assert.equal(result.audioRewrite,false);assert.equal(result.videoRewrite,false);assert.equal(result.uiDraft,false);
});
test('an opt-in never turns on operation, recovery or vision',()=>{
 assert.throws(()=>merge(undefined,{[K.audioRewrite]:'true'}),{code:'operation-capability-config-invalid'});
 assert.throws(()=>merge('{"operation":true}',{[K.videoRewrite]:'true'}),{code:'operation-capability-config-invalid'});
 assert.equal(merge('{"operation":true,"recovery":true}',{[K.uiDraft]:'true'}).vision,false);
});
test('bad override values fail closed even for an explicit existing field',()=>{
 for(const value of ['', 'TRUE', '1', true, false, null, ' true ', 1])assert.throws(()=>merge('{"operation":true,"recovery":true,"uiDraft":false}',{[K.uiDraft]:value}),{code:'operation-capability-config-invalid'});
 assert.throws(()=>merge(base,null),{code:'operation-capability-config-invalid'});
});
test('strict existing parser still rejects unknown, malformed, invalid and duplicate JSON keys',()=>{
 for(const raw of ['{','[]','null','{"operation":1}','{"unknown":true}','{"operation":true,"operation":false}','{"operation":true,"operatio\\u006e":false}','{"operation":false,"vision":true}'])assert.throws(()=>merge(raw,{[K.uiDraft]:'true'}),{code:'operation-capability-config-invalid'});
});
test('unrelated override object properties are not consulted',()=>{
 const overrides={[K.audioRewrite]:'false'};Object.defineProperty(overrides,'secret',{get(){throw new Error('must not read');}});
 assert.equal(merge(base,overrides).audioRewrite,false);
});
test('an inherited opt-in is not treated as an explicit service setting',()=>{
 const overrides=Object.create({[K.uiDraft]:'true'});
 assert.equal(merge(base,overrides).uiDraft,false);
});


test('unknown override keys cannot silently change the trusted capability interface',()=>{
 assert.throws(()=>mergeCapabilityOverrides('{"operation":true,"recovery":true}',{UNRELATED_FLAG:'true'}));
});
