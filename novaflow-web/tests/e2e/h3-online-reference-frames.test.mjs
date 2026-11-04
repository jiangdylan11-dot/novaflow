import test from 'node:test';
import assert from 'node:assert/strict';
import {referenceFrames} from '../../../supabase/functions/novaflow-backend/h3-prompt-enhance.mjs';
test('online H3 accepts the same nine images and three nine-frame videos as the native reference workflow',()=>{
 const frames=[...Array.from({length:9},(_,i)=>({label:`<Picture ${i+1}>`,dataUrl:'data:image/jpeg;base64,AA=='})),...Array.from({length:3},(_,v)=>Array.from({length:9},(_,i)=>({label:`<Video ${v+1}>`,timeSeconds:i/8,dataUrl:'data:image/jpeg;base64,AA=='}))).flat()];
 const requirements='Available resource labels: '+[...new Set(frames.map(f=>f.label))].join(', ');
 assert.equal(referenceFrames(frames,requirements).length,36);assert.throws(()=>referenceFrames([...frames,frames[0]],requirements));
 assert.throws(()=>referenceFrames([{...frames[0],label:'<Picture 10>'}],requirements));
 assert.throws(()=>referenceFrames([frames[9],frames[9]],requirements));
 assert.throws(()=>referenceFrames([{...frames[0],dataUrl:'data:image/jpeg;base64,'+'A'.repeat(2500001)}],requirements));
});
