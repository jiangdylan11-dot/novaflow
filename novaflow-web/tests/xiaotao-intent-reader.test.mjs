import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import {probe} from './helpers/xiaotao-route-probe.mjs';
import {CASES} from './fixtures/xiaotao-understanding-cases.mjs';
import {score,ruleReader,isRight} from './helpers/xiaotao-understanding-score.mjs';

// The brain reads the turn; the app carries the reading out. Synthetic: no account, model or network.
const source=name=>readFileSync(new URL('../renderer/'+name,import.meta.url),'utf8');
const root={};root.window=root;createContext(root);runInContext(source('xiaotao-intent-reader.js'),root);runInContext(source('xiaotao-upload.js'),root);
const reader=root.FoartXiaotaoIntent,upload=root.NovaFlowXiaotaoUpload;
const P='一只小猫在草地上奔跑，阳光明媚';

test('the question gives the brain what a colleague at the screen would know',()=>{
  const q=reader.buildQuestion({message:'再做一个1秒的循环动画',history:[{role:'user',content:'做一个2秒循环待机动画'},{role:'assistant',content:'已生成'}],
    page:{surface:'video',mode:'first_last',frames:['monkey.png','monkey.png'],seconds:2,prompt:P},last:{surface:'video',mode:'first_last',loop:true,request:'做一个2秒循环待机动画',outputs:['a.mp4']},pictureCount:0});
  for(const part of ['首尾帧视频','首帧位置：monkey.png','尾帧位置：monkey.png','上一个做完的任务：视频','没有带图片','再做一个1秒的循环动画','用户：做一个2秒循环待机动画'])assert.ok(q.includes(part),part);
  assert.ok(reader.buildQuestion({message:'x',pictureCount:2}).includes('2 张，按顺序是 图1 到 图2'));
});
test('a reading the app cannot carry out is no reading',()=>{
  const read=(data,pictureCount=0)=>reader.parseReading(typeof data==='string'?data:JSON.stringify(data),{pictureCount});
  assert.equal(read('好的，我来做'),null);
  assert.equal(read({kind:'dance'}),null);
  assert.equal(read({kind:'make',surface:'video',mode:'first_last',first:'new2',last:'new1'},1),null,'a picture that was not brought');
  assert.equal(read({kind:'make',surface:'video',mode:'image_video',first:'none'}),null);
  assert.equal(read({kind:'make',surface:'other',mode:''}),null);
  assert.equal(read({kind:'talk'}).kind,'talk');
  // A loop is one picture at both ends, however the brain wrote it.
  const loop=read('```json\n'+JSON.stringify({kind:'make',surface:'video',mode:'first_last',first:'new1',last:'first',seconds:2,width:null,height:null,pictures:['一只白狒狒'],brief:'白狒狒上下浮动'})+'\n```',1);
  assert.equal(loop.first,'new1');assert.equal(loop.last,'new1');assert.equal(loop.loop,true);assert.equal(loop.seconds,2);assert.equal(loop.width,null);
  assert.equal(read({kind:'make',surface:'video',mode:'text_video',first:'keep',last:'keep',seconds:99}).seconds,null);
});
test('a reading places the pictures of the turn exactly where it says',()=>{
  const files=[{kind:'image',name:'a.png'},{kind:'image',name:'b.png'}];
  const placed=reading=>upload.routeTo(files,reading).place.map(item=>item.destination.id+':'+item.name).join();
  assert.equal(placed({surface:'video',mode:'first_last',first:'new2',last:'new1'}),'first_frame:b.png,last_frame:a.png');
  assert.equal(placed({surface:'video',mode:'first_last',first:'keep',last:'new1'}),'last_frame:a.png');
  assert.equal(placed({surface:'video',mode:'first_last',first:'new1',last:'new1'}),'first_frame:a.png,last_frame:a.png');
  assert.equal(placed({surface:'video',mode:'image_video',first:'new1',last:'none'}),'image_video:a.png');
  assert.equal(placed({surface:'video',mode:'text_video',first:'none',last:'none'}),'');
  assert.equal(placed({surface:'image',mode:'img2img',first:'new1'}),'img2img:a.png,img2img:b.png');
});
test('the turn follows the reading: a follow-up keeps its frames, talk is answered in words',async()=>{
  const made={surface:'video',mode:'first_last',loop:true,baseRequest:'做一个2秒循环待机动画',outputs:[{id:'r0',name:'a.mp4'}]};
  const generate={action:'media',operation:{action:'generate_video',target:'video',prompt:'猴子向下坠落后恢复原位'}};
  const p=await probe({page:'video',genType:'first_last',frame:{width:480,height:640},prompt:P,task:made,plans:[generate],
    reading:{kind:'make',surface:'video',mode:'first_last',first:'keep',last:'keep',loop:true,seconds:1,width:null,height:null,pictures:[],brief:'猴子向下坠落一下马上恢复原位，框子不动'}});
  p.video.referenceSlots.push({...p.video.referenceSlots[0],key:'last_frame'});
  const r=await p.say('再做一个1秒的循环动画。猴子向下坠落一下马上恢复原位，框子不动');
  assert.equal(p.questions.length,1);assert.deepEqual(r.ops,['generate_video']);
  assert.match(r.sent,/继续修改同一个视频任务[\s\S]*这句话的意思（已结合对话、页面和图片读过）：猴子向下坠落/);
  const talk=await probe({page:'video',prompt:P,task:made,reading:{kind:'talk'}});
  await talk.say('为什么变成了文生视频');
  assert.equal(talk.starts.length,0);
  const tool=await probe({page:'video',prompt:P,task:made,reading:{kind:'operate',surface:'audio'}});
  await tool.say('打开音频');assert.equal(tool.starts.length,1);
});
test('with no usable reading the rules stand in, and the turn still runs',async()=>{
  const p=await probe({page:'video',plans:[{action:'media',operation:{action:'generate_video',target:'video',prompt:'小狗'}}],reading:()=>'not json'});
  const r=await p.say('一只小狗在海边奔跑');
  assert.deepEqual(r.ops,['generate_video']);assert.equal(r.error,'');
});
test('the rule-based reading of the understanding cases: where it stood and where it stands',()=>{
  const now=score(CASES,ruleReader({upload:source('xiaotao-upload.js'),promptSource:source('xiaotao-prompt-source.js')}));
  // 26/49 at 2.0.363, measured from that release's files. The rules are the stand-in now; they must not slip back.
  assert.ok(now.right>=40,'rules read '+now.right+'/'+now.total);
  assert.equal(isRight({kind:'make',surface:'video',mode:'first_last',first:'new2',last:'new1'},CASES.find(item=>item.id==='pair-reversed').want),true);
});
