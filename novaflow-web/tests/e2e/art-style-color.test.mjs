import test from 'node:test';
import assert from 'node:assert/strict';
import {skinMidtone,coherentSkinProfile} from '../../renderer/art-style-color.js';
const pixels=(rgb,n=1000)=>new Uint8ClampedArray(Array.from({length:n},()=>[...rgb,255]).flat());

test('measured rose midtones cannot be replaced by neighboring gold hair or white highlights',()=>{
  const mixed=new Uint8ClampedArray([...pixels([236,202,198],600),...pixels([246,223,145],300),...pixels([255,255,255],100)]);
  const profile=skinMidtone(mixed);assert.deepEqual(profile.rgb,[236,202,198]);assert.equal(profile.hue,'粉');assert.equal(profile.fraction,.6);
  assert.equal(skinMidtone(pixels([246,223,145])),undefined);
});
test('unsupported or insufficient color evidence is skipped without whitening it',()=>{
  assert.equal(skinMidtone(pixels([60,48,38])),undefined);
  assert.equal(skinMidtone(pixels([130,160,200])),undefined);
  assert.equal(skinMidtone(new Uint8ClampedArray([...pixels([236,202,198],100),...pixels([246,223,145],900)])),undefined);
});
test('overlapping face detections agree but separate faces never become one imposed palette',()=>{
  const one=skinMidtone(pixels([236,202,198])),two={...one,rgb:[226,189,185],fraction:.6};
  assert.deepEqual(coherentSkinProfile([{box:[100,100,300,300],profile:one},{box:[120,120,290,290],profile:two}]).rgb,one.rgb);
  assert.equal(coherentSkinProfile([{box:[100,100,300,300],profile:one},{box:[650,100,850,300],profile:two}]),undefined);
});
