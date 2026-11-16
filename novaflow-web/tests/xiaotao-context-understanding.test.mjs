import test from 'node:test';
import assert from 'node:assert/strict';
import {probe} from './helpers/xiaotao-route-probe.mjs';

// What a sentence means depends on the page in front of the person and on what 小桃 just finished.
// Synthetic controller runs: no account, model or network.
const P='一只小猫在草地上奔跑，阳光明媚';
const videoTask={surface:'video',mode:'text_video',baseRequest:'生成一段小猫奔跑的视频',outputs:[{id:'r0',name:'cat.mp4'}]};
const imageTask={surface:'image',mode:'txt2img',baseRequest:'画一只小猫',outputs:[{id:'i0',name:'cat.png'}]};
const optimizeVideo=prompt=>({action:'media',operation:{action:'optimize_video_prompt',target:'video',prompt}});
const generateVideo=prompt=>({action:'media',operation:{action:'generate_video',target:'video',prompt}});

test('a change asked after a finished video is made, not written into the prompt box',async()=>{
  for(const words of ['改成夜晚','加入下雨的效果','猫跑得再快一点','让它跳起来','太暗了','优化一下','不够可爱，再可爱一点']){
    const p=await probe({page:'video',prompt:P,task:videoTask,plans:[optimizeVideo('夜晚的小猫')]});
    const r=await p.say(words);
    assert.equal(r.route,'planner',words);
    assert.deepEqual(r.ops,['generate_video'],words);
    assert.match(r.sent,/继续修改同一个视频任务[\s\S]*直接用生成操作出结果/,words);
  }
});
test('the same words with a prompt on the page and no task yet are still a request for the video',async()=>{
  for(const words of ['改成夜晚','换成一只小狗','再加点烟雾']){
    const p=await probe({page:'video',prompt:P,plans:[optimizeVideo('夜晚')]});
    const r=await p.say(words);
    assert.equal(r.route,'planner',words);assert.deepEqual(r.ops,['generate_video'],words);
  }
});
test('a plain description is about the page it is typed on',async()=>{
  const video=await probe({page:'video',plans:[optimizeVideo('小狗在海边奔跑')]});
  const r=await video.say('一只小狗在海边奔跑');
  assert.equal(r.route,'planner');assert.deepEqual(r.ops,['generate_video']);assert.match(r.sent,/视频生成页面/);
  const drawing=await probe({page:'drawing'});
  assert.match((await drawing.say('一只小狗在海边奔跑')).sent,/绘图页面[\s\S]*不要只优化提示词/);
  const audio=await probe({page:'audio'});
  assert.match((await audio.say('轻快的钢琴曲')).sent,/音频生成页面/);
});
test('only words about the prompt itself stay with the prompt box',async()=>{
  for(const words of ['优化提示词','帮我优化一下提示词','把提示词改成夜晚的版本'])
    assert.equal((await (await probe({page:'video',prompt:P,task:videoTask})).say(words)).route,'video-prompt',words);
  // With nothing made yet, "优化一下" can only mean the text in the box.
  assert.equal((await (await probe({page:'video',prompt:P})).say('优化一下')).route,'video-prompt');
});
test('a rewritten prompt offers the generation, and "好的" runs that draft as it is',async()=>{
  const p=await probe({page:'video',prompt:P,plans:[generateVideo('改写后的内容')]});
  const first=await p.say('优化提示词');
  assert.equal(first.route,'video-prompt');assert.match(first.reply,/要现在直接生成吗/);
  assert.equal(p.video.prompt,'【写好的视频稿】');
  const second=await p.say('好的');
  assert.equal(second.route,'planner');assert.deepEqual(second.ops,['generate_video']);
  assert.match(second.sent,/现在就开始/);
});
test('declining the offer costs nothing, and another request after it is read on its own',async()=>{
  const p=await probe({page:'video',prompt:P});
  await p.say('优化提示词');
  const no=await p.say('不用了');
  assert.equal(no.route,'reply');assert.equal(p.starts.length,0);
  const q=await probe({page:'video',prompt:P});
  await q.say('优化提示词');
  const other=await q.say('帮我画一张海报');
  assert.equal(other.route,'planner');assert.doesNotMatch(other.sent,/按页面上刚写好的视频提示词/);
});
test('"开始吧" runs the prompt waiting on the page; a thank-you stays a thank-you',async()=>{
  for(const words of ['开始吧','生成吧','好，做吧','那就开始']){
    const p=await probe({page:'video',prompt:P,plans:[generateVideo(P)]});
    const r=await p.say(words);
    assert.equal(r.route,'planner',words);assert.deepEqual(r.ops,['generate_video'],words);assert.match(r.sent,/现在就开始/,words);
  }
  for(const words of ['谢谢','好的','不错']){
    const r=await (await probe({page:'video',prompt:P,task:videoTask})).say(words);
    assert.notEqual(r.route,'planner',words);assert.deepEqual(r.ops,[],words);
  }
});
test('a finished task\'s prompt is not carried into a new topic, a new conversation or a new picture',async()=>{
  const p=await probe({page:'video',prompt:P,plans:[generateVideo(P)]});
  await p.say('生成吧');
  // Same conversation, a change to that video: its prompt is the base.
  const change=await p.say('再快一点');
  assert.equal(p.starts.at(-1).foartContext.media.generation.prompt,P);assert.doesNotMatch(change.sent,/旧提示词/);
  // A new conversation: the box still holds the old prompt, the new request does not get it.
  await p.c.send('新对话');
  const fresh=await p.say('一只小狗在海边奔跑');
  assert.equal(p.starts.at(-1).foartContext.media.generation.prompt,'');assert.match(fresh.sent,/旧提示词[\s\S]*不要沿用/);
  // Naming the prompt brings it back.
  const named=await p.say('按输入框里的提示词再生成一次');
  assert.equal(p.starts.at(-1).foartContext.media.generation.prompt,P);assert.doesNotMatch(named.sent,/旧提示词/);
});
test('a prompt typed by hand after the last result is the person\'s own and is kept',async()=>{
  const p=await probe({page:'video',prompt:P,plans:[generateVideo(P)]});
  await p.say('生成吧');await p.c.send('新对话');
  p.video.prompt='一条金鱼在水里游';
  await p.say('再加点水草');
  assert.equal(p.starts.at(-1).foartContext.media.generation.prompt,'一条金鱼在水里游');
});
test('other work named after a finished task is not treated as a change to it',async()=>{
  for(const words of ['切换成暗色主题','打开音频','帮我把这张图拆一下']){
    const r=await (await probe({page:'video',prompt:P,task:videoTask})).say(words);
    assert.equal(r.route,'planner',words);assert.doesNotMatch(r.sent,/继续修改同一个视频任务/,words);
  }
  const drawing=await (await probe({page:'drawing',prompt:P,task:imageTask})).say('这个要多少积分');
  assert.doesNotMatch(drawing.sent,/继续修改同一个/);
});
test('a picture brought with its own request is a new task, not a change to the last picture',async()=>{
  const p=await probe({page:'drawing',prompt:P,task:imageTask});
  const upload=p.root.NovaFlowXiaotaoUpload,page={surface:'image',mode:'img2img'},picture=[{kind:'image',name:'toy.png'}];
  assert.equal(upload.inferTask('把背景换成海边沙滩',picture,imageTask,page).revision,false);
  assert.equal(upload.inferTask('把背景换成海边沙滩',[],imageTask,page).revision,true);
  // Pointing back at the earlier picture keeps the thread.
  assert.equal(upload.inferTask('接着刚才那张，把背景换成这张图里的沙滩',picture,imageTask,page).revision,true);
});
test('the local brain keeps writing prompts: a change there is still a rewrite of the box',async()=>{
  const p=await probe({page:'video',prompt:P});
  const source=p.root.NovaFlowXiaotaoPromptSource;
  assert.equal(source.classifyPromptAction('改成夜晚',{promptBrain:true}),'optimize');
  assert.equal(source.classifyPromptAction('改成夜晚'),'none');
});
test('"怎么还没出来" after a finished result points at it instead of making it again',async()=>{
  const p=await probe({page:'video',prompt:P,task:videoTask});
  const r=await p.say('怎么还没出来');
  assert.equal(r.route,'reply');assert.match(r.reply,/cat\.mp4/);assert.equal(p.starts.length,0);
  // Nothing was made yet: the same words ask for it now.
  const q=await probe({page:'video',prompt:P,plans:[generateVideo(P)]});
  assert.deepEqual((await q.say('怎么还没生成')).ops,['generate_video']);
});
test('a finished generation keeps what the brain said in front of the receipt',async()=>{
  const p=await probe({page:'video',prompt:P,task:videoTask,plans:[generateVideo('更可爱Q弹的待机')]});
  const r=await p.say('动画太生硬了，要求可爱Q弹');
  assert.match(r.reply,/^开始\n\n已调用[\s\S]*out\.mp4/);
});
test('a size said in words is set by the app; with none said, the video takes its first picture\'s size',async()=>{
  const said=await probe({page:'video',prompt:P,task:videoTask,genType:'first_last',frame:{width:960,height:1280},plans:[generateVideo(P)]});
  const r=await said.say('960*960分辨率，重新做');
  assert.deepEqual(said.video.h3,{custom:true,width:'960',height:'960'});
  assert.match(r.sent,/视频分辨率已按用户说的设为 960×960/);assert.deepEqual(r.ops,['generate_video']);
  // A later change in the same task keeps the size the person chose.
  await said.say('再可爱一点');
  const unsaid=await probe({page:'video',genType:'image_video',frame:{width:960,height:1280},plans:[generateVideo('小猴子待机')]});
  await unsaid.say('做一个2秒循环待机动画，要求动画生动');
  assert.deepEqual(unsaid.video.h3,{custom:true,width:'960',height:'1280'});
  // A picture past the page's ceiling keeps its shape under it.
  const large=await probe({page:'video',genType:'image_video',frame:{width:3000,height:3000},plans:[generateVideo('小猴子待机')]});
  await large.say('让它动起来');
  assert.deepEqual(large.video.h3,{custom:true,width:'1440',height:'1440'});
});
test('a step that changes nothing is skipped with a word to the planner, and a stuck turn ends in plain words',async()=>{
  const width={id:'w1',label:'自定义宽',section:'视频',kind:'input',value:'960',scope:'video_generation'};
  const setWidth={action:'set_control',controlId:'w1',value:960};
  const p=await probe({page:'video',prompt:P,task:videoTask,controls:[width],plans:[setWidth,setWidth,setWidth,setWidth]});
  const r=await p.say('宽度设成九百六');
  assert.equal(r.error,'');assert.deepEqual(r.ops,[]);
  assert.match(r.reply,/后面的步骤这次没做完/);
});
test('a video draft that fails once is tried again instead of sending the planner\'s raw brief',async()=>{
  const p=await probe({page:'video',plans:[generateVideo('一只猴子站在画面中央')],draftFailures:1});
  const r=await p.say('做一个2秒循环待机动画，要求猴子表情丰富');
  assert.deepEqual(r.prompts,['【写好的视频稿】']);
});
