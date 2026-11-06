// Ways people ask 小桃 for 美工 work. "brain" is the plan a correct online brain should send;
// "expect" is what the app must then do. tests/e2e/xiaotao-art-phrasings.test.mjs feeds the simulated
// plan through the real checks; tests/manual/xiaotao-style-phrasings.mjs asks the real brain.
const style=(subjectRef,styleRefs,extra={})=>({action:'image_generate',prompt:'风格转换',generationMode:'img2img',useResult:false,...(subjectRef?{subjectRef}:{}),styleRefs,...extra});
const draw=(extra={})=>({action:'image_generate',prompt:'一张图',generationMode:'txt2img',useResult:false,...extra});
const revise=(extra={})=>({action:'image_generate',prompt:'修改上一张',generationMode:'img2img',useResult:true,...extra});
const each={perStyle:true};
const run=(subjectSlot,styleSlots,perStyle)=>({run:{subjectSlot,styleSlots,perStyle}});
const none={run:null};

export const PHRASINGS=[
  // Dylan's own sentences
  {text:'@参考图1把风格换成@参考图2的风格，人物姿势不变',pictures:2,brain:style(1,[2],{extraInstructions:'人物姿势不变'}),expect:run(0,[1],false)},
  {text:'@参考图1的风格换成@参考图2的风格，人物姿势不变',pictures:2,brain:style(1,[2],{extraInstructions:'人物姿势不变'}),expect:run(0,[1],false)},
  {text:'分别用@参考图1@参考图2@参考图3各自生成一张',pictures:3,subject:true,brain:style(0,[1,2,3],each),expect:run(-1,[0,1,2],true)},
  {text:'主体还是刚才那张，继续用@参考图1@参考图2@参考图3各种再生成一次风格转换',pictures:3,subject:true,brain:style(0,[1,2,3],each),expect:run(-1,[0,1,2],true)},
  {text:'用@参考图1@参考图2@参考图3再各自生成一次',pictures:3,subject:true,brain:style(0,[1,2,3],each),expect:run(-1,[0,1,2],true)},
  // style, one run
  {text:'把@参考图1转成@参考图2的风格',pictures:2,brain:style(1,[2]),expect:run(0,[1],false)},
  {text:'参考图2的画风用到参考图1上',pictures:2,brain:style(1,[2]),expect:run(0,[1],false)},
  {text:'让图1变成图2那种画法',pictures:2,brain:style(1,[2]),expect:run(0,[1],false)},
  {text:'@参考图2是主体，用@参考图1的风格',pictures:2,brain:style(2,[1]),expect:run(1,[0],false)},
  {text:'make image 1 look like the style of image 2',pictures:2,brain:style(1,[2]),expect:run(0,[1],false)},
  {text:'restyle picture 2 using picture 1',pictures:2,brain:style(2,[1]),expect:run(1,[0],false)},
  {text:'把@参考图1转成@参考图2和@参考图3混合的风格',pictures:3,brain:style(1,[2,3]),expect:run(0,[1,2],false)},
  {text:'换成@参考图1的风格',pictures:1,subject:true,brain:style(0,[1]),expect:run(-1,[0],false)},
  {text:'换成这张的风格',pictures:1,subject:true,brain:style(0,[1]),expect:run(-1,[0],false)},
  {text:'再用这张的风格转一次',pictures:1,subject:true,brain:style(0,[1]),expect:run(-1,[0],false)},
  // style, one run per picture
  {text:'把@参考图1分别转成@参考图2@参考图3的风格',pictures:3,brain:style(1,[2,3],each),expect:run(0,[1,2],true)},
  {text:'@参考图1轮流用@参考图2@参考图3的风格各出一张',pictures:3,brain:style(1,[2,3],each),expect:run(0,[1,2],true)},
  {text:'这几张风格一张一张来',pictures:3,subject:true,brain:style(0,[1,2,3],each),expect:run(-1,[0,1,2],true)},
  {text:'挨个试一下这些风格',pictures:2,subject:true,brain:style(0,[1,2],each),expect:run(-1,[0,1],true)},
  {text:'每个风格都来一张',pictures:4,subject:true,brain:style(0,[1,2,3,4],each),expect:run(-1,[0,1,2,3],true)},
  {text:'依次换成这三种风格',pictures:3,subject:true,brain:style(0,[1,2,3],each),expect:run(-1,[0,1,2],true)},
  {text:'再来一轮，@参考图1@参考图2',pictures:2,subject:true,brain:style(0,[1,2],each),expect:run(-1,[0,1],true)},
  {text:'用@参考图2@参考图9各转一张',pictures:2,subject:true,brain:style(0,[2,9],each),expect:run(-1,[1],true)},
  {text:'one for each style please',pictures:2,subject:true,brain:style(0,[1,2],each),expect:run(-1,[0,1],true)},
  {text:'apply these styles one by one',pictures:3,subject:true,brain:style(0,[1,2,3],each),expect:run(-1,[0,1,2],true)},
  {text:'try each of these looks on her',pictures:2,subject:true,brain:style(0,[1,2],each),expect:run(-1,[0,1],true)},
  // limits become questions
  {text:'分别用这些风格各生成一张',pictures:3,brain:style(0,[1,2,3],each),expect:{ask:/主体图/}},
  {text:'换成这张的风格',pictures:1,brain:style(0,[1]),expect:{ask:/主体图/}},
  {text:'这五张风格各来一张',pictures:5,subject:true,brain:style(0,[1,2,3,4,5],each),expect:{ask:/最多用 4 张/}},
  {text:'把@参考图1转成@参考图2@参考图3@参考图4的风格',pictures:4,brain:style(1,[2,3,4]),expect:{ask:/混合成一张/}},
  // plain generation
  {text:'画一只猫',pictures:0,brain:draw(),expect:none},
  {text:'生成一张海边的女孩',pictures:0,brain:draw(),expect:none},
  {text:'来张赛博朋克城市',pictures:0,brain:draw(),expect:none},
  {text:'帮我出个图，主题是春天',pictures:0,brain:draw(),expect:none},
  {text:'draw a red dragon',pictures:0,brain:draw(),expect:none},
  {text:'generate a castle at night',pictures:0,brain:draw(),expect:none},
  // quantity
  {text:'画三张猫',pictures:0,brain:draw({count:3}),expect:{...none,count:3}},
  {text:'来 5 张不同的海报',pictures:0,brain:draw({count:5}),expect:{...none,count:5}},
  {text:'give me 4 variations',pictures:0,brain:draw({count:4}),expect:{...none,count:4}},
  {text:'多出几张，两张就行',pictures:0,brain:draw({count:2}),expect:{...none,count:2}},
  // again
  {text:'再来一张',pictures:0,brain:draw(),expect:none},
  {text:'继续',pictures:0,brain:draw(),expect:none},
  {text:'再生成一次',pictures:0,brain:draw(),expect:none},
  {text:'again',pictures:0,brain:draw(),expect:none},
  // change the last picture
  {text:'改一下上一张，把头发换成黑色',pictures:0,brain:revise(),expect:none},
  {text:'刚才那张背景换成海边',pictures:0,brain:revise(),expect:none},
  {text:'上一张再亮一点',pictures:0,brain:revise(),expect:none},
  {text:'把她的衣服改成红色',pictures:0,brain:revise(),expect:none},
  {text:'change the background of the last one to a beach',pictures:0,brain:revise(),expect:none},
  {text:'make it brighter',pictures:0,brain:revise(),expect:none},
  // this turn's pictures win over the last result
  {text:'把@参考图1的背景换成海边',pictures:1,attached:true,brain:revise(),expect:{...none,useResult:false}},
  {text:'用这张图换个背景',pictures:1,attached:true,brain:revise(),expect:{...none,useResult:false}},
  {text:'这张的衣服换成红色',pictures:1,attached:true,brain:revise(),expect:{...none,useResult:false}},
  {text:'把@参考图1和@参考图2合成一张',pictures:2,attached:true,brain:{action:'image_generate',prompt:'合成',generationMode:'img2img',useResult:false},expect:none},
  {text:'把这四张合成一张',pictures:4,attached:true,brain:{action:'image_generate',prompt:'合成',generationMode:'img2img',useResult:false},expect:{ask:/最多用 3 张/}},
  // size, undo and the rest are not image runs
  {text:'尺寸改成 1024',pictures:0,brain:{action:'set_control',controlId:'control-2',value:1024},expect:none},
  {text:'宽度设成 2048',pictures:0,brain:{action:'set_control',controlId:'control-2',value:2048},expect:none},
  {text:'set the size to 1024',pictures:0,brain:{action:'set_control',controlId:'control-2',value:1024},expect:none},
  {text:'撤销',pictures:0,brain:null,expect:none},
  {text:'撤销刚才的修改',pictures:0,brain:null,expect:none},
  {text:'undo that',pictures:0,brain:null,expect:none},
  {text:'新对话',pictures:0,brain:null,expect:{newConversation:true}},
  {text:'清空对话',pictures:0,brain:null,expect:{newConversation:true}},
  // a stray field never stops the run
  {text:'换成这张的风格，别的不变',pictures:1,subject:true,brain:style(0,[1],{mood:'x',subjectSlot:9}),expect:run(-1,[0],false)},
];
