import test from 'node:test';
import assert from 'node:assert/strict';
import {capturePose,comparePose,reliablePosePeople} from '../../renderer/art-pose-validation.js';
test('pose comparison ignores framing, resolution and limb length but rejects a different action',()=>{
  const tree={vectors:[[1,0],[0,-1],[-1,0],[0,-1],[-.8,.6],[.8,.6],[0,1],[0,1]]};
  const same=structuredClone(tree);
  assert.equal(comparePose([tree],[same]).pass,true);
  const warrior={vectors:[[-1,0],[-1,0],[1,0],[1,0],[-1,0],[0,1],[.8,.6],[.8,.6]]};
  assert.equal(comparePose([tree],[warrior]).pass,false);
  assert.equal(comparePose([tree],[]).pass,false);
  assert.equal(comparePose([tree],[{vectors:Array(8).fill(null)}]).pass,false);
});
test('real landmark vectors account for image aspect and discard hidden joints',()=>{
  const points=Array.from({length:33},(_,i)=>({x:i/100,y:i/100,visibility:1}));
  const geometry=capturePose([{points,imageAspect:2}]);
  assert.ok(Math.abs(geometry[0].vectors[0][0]-2/Math.sqrt(5))<.0001);
  points[13].visibility=.1;
  assert.equal(capturePose([{points,imageAspect:2}])[0].vectors[0],null);
});
test('a partial crop detection cannot become an extra pose person',()=>{
  const points=Array.from({length:33},(_,i)=>({x:i/100,y:i/100,visibility:1}));
  const partial=points.map((p,i)=>({...p,visibility:i<23?.1:1}));
  assert.equal(reliablePosePeople([{points:partial},{points}]).length,1);
  assert.equal(reliablePosePeople([{points},{points}]).length,2);
});
