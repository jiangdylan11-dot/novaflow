// 色调跟随参考图: the pure colour step behind the style redraw's tone slider.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';

let passed=0,failed=0;
function test(name,fn){
  try{fn();passed++;console.log('ok  '+name);}
  catch(error){failed++;console.error('FAIL '+name+'\n'+error.stack);}
}
const box={module:{exports:{}}};
runInContext(readFileSync(new URL('../../renderer/art-tone-match.js',import.meta.url),'utf8'),createContext(box));
const tone=box.module.exports;

// A vertical ramp in one colour, so every brightness band has pixels.
function ramp([r,g,b],width=48,height=48){
  const data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const k=0.25+0.75*y/(height-1),at=(y*width+x)*4;
    data[at]=r*k;data[at+1]=g*k;data[at+2]=b*k;data[at+3]=255;
  }
  return {data,width,height};
}
const mean=(data,channel)=>{let sum=0;for(let i=channel;i<data.length;i+=4)sum+=data[i];return sum/(data.length/4);};
const blue=ramp([70,110,200]),warm=ramp([230,150,70]);

test('strength 0 returns the picture unchanged',()=>{
  assert.deepEqual(Array.from(tone.matchTone(blue,warm,0)),Array.from(blue.data));
});

test('colour moves toward the reference, further at higher strength',()=>{
  const weak=tone.matchTone(blue,warm,0.3),strong=tone.matchTone(blue,warm,0.8);
  assert.ok(mean(weak,0)>mean(blue.data,0),'red rises');assert.ok(mean(strong,0)>mean(weak,0));
  assert.ok(mean(weak,2)<mean(blue.data,2),'blue falls');assert.ok(mean(strong,2)<mean(weak,2));
});

test('alpha is left alone',()=>{
  const out=tone.matchTone(blue,warm,0.5);
  for(let i=3;i<out.length;i+=4)assert.equal(out[i],255);
});

test('the skin mask finds skin colours and not the rest',()=>{
  const skin=tone.skinMask(ramp([235,170,140]).data,48,48),sky=tone.skinMask(blue.data,48,48);
  assert.ok(skin[48*40+24]>0.9);assert.ok(sky[48*40+24]<0.1);
});

test('skin moves about half as far as it would unguarded',()=>{
  const skin=ramp([235,170,140]),reference=ramp([70,110,200]);
  const start=mean(skin.data,2),guarded=mean(tone.matchTone(skin,reference,0.6),2)-start,open=mean(tone.matchTone(skin,reference,0.6,{skinGuard:false}),2)-start;
  assert.ok(open>0&&guarded>0);assert.ok(guarded<open*0.75,`${guarded} of ${open}`);
});

test('a reference with nothing between white and black leaves the picture alone',()=>{
  const white={data:new Uint8ClampedArray(64*4).fill(255),width:8,height:8};
  assert.deepEqual(Array.from(tone.matchTone(blue,white,0.5)),Array.from(blue.data));
});

test('the panel limits stay what was agreed',()=>{
  assert.equal(tone.DEFAULT_STRENGTH,0.5);assert.equal(tone.MAX_STRENGTH,0.8);
});

console.log(`art-tone-match: ${passed} passed, ${failed} failed`);
if(failed)process.exit(1);
