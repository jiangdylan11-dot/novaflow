// What a person means, case by case: the sentences Dylan actually typed (2026-11-15…17) and the ways they vary
// (colloquial, clipped, typos). Each case says what the page shows, what was just made, what is attached and
// what the person wants. `want` is what a colleague would understand:
//   kind:   make (produce the result) | prompt (only rewrite the prompt box) | operate (use a tool or another
//           part of the app) | talk (answer in words)
//   surface/mode: where the result is made; first/last: which picture ends up in which frame
//           ('new1','new2' = this turn's pictures in order, 'keep' = what is already there)
//   seconds/size: only when the sentence sets them
const V = (mode = 'text_video', frames = []) => ({surface: 'video', mode, frames});
const D = (mode = 'txt2img', refs = []) => ({surface: 'image', mode, refs});
const loopTask = {surface: 'video', mode: 'first_last', loop: true};
const pairTask = {surface: 'video', mode: 'first_last', loop: false};
const imageVideoTask = {surface: 'video', mode: 'image_video'};
const textVideoTask = {surface: 'video', mode: 'text_video'};
const imageTask = {surface: 'image', mode: 'img2img'};
const pic = n => Array.from({length: n}, () => 'image');

export const CASES = [
  // --- first request with pictures, video page ---
  {id: 'loop-one-picture', page: V(), last: null, files: pic(1), say: '做一个2秒循环待机动画，要求动画生动',
    want: {kind: 'make', surface: 'video', mode: 'first_last', first: 'new1', last: 'new1', seconds: 2}},
  {id: 'loop-particles', page: V(), last: null, files: pic(1), say: '做一个2秒循环待机动画，要求白狒狒上下浮动，表情严肃，动画生动。前方粒子持续向上飘动消失',
    want: {kind: 'make', surface: 'video', mode: 'first_last', first: 'new1', last: 'new1', seconds: 2}},
  {id: 'loop-particles-doubao', page: V(), last: null, files: pic(1), say: '做1个2秒循环待机动画，要求猴子动作生动，表情丰富，粒子持续向上飘动',
    want: {kind: 'make', surface: 'video', mode: 'first_last', first: 'new1', last: 'new1', seconds: 2}},
  {id: 'loop-monkey-q', page: V(), last: null, files: pic(1), say: '做一个2秒循环待机动画，要求猴子表情丰富，轻微摇摆，Q弹可爱',
    want: {kind: 'make', surface: 'video', mode: 'first_last', first: 'new1', last: 'new1', seconds: 2}},
  {id: 'pair-becomes', page: V(), last: null, files: pic(2), say: '做一个1秒动画，@参考图1变成@参考图2，要求猴子动画生动，下面的石台快速出现，猴子跳到石台的后面，举牌趴下，小猴子举着牌子快速逐步快速叠加上去。',
    want: {kind: 'make', surface: 'video', mode: 'first_last', first: 'new1', last: 'new2', seconds: 1}},
  {id: 'pair-becomes-3-monkeys', page: V(), last: null, files: pic(2), say: '生成1秒动画，@参考图1变成@参考图2，要求猴子快速消失变成3个小猴子，动画生动Q弹，表情丰富',
    want: {kind: 'make', surface: 'video', mode: 'first_last', first: 'new1', last: 'new2', seconds: 1}},
  {id: 'pair-from-to-plain', page: V(), last: null, files: pic(2), say: '从第一张过渡到第二张，3秒',
    want: {kind: 'make', surface: 'video', mode: 'first_last', first: 'new1', last: 'new2', seconds: 3}},
  {id: 'pair-reversed', page: V(), last: null, files: pic(2), say: '用第二张开头，最后变成第一张',
    want: {kind: 'make', surface: 'video', mode: 'first_last', first: 'new2', last: 'new1'}},
  {id: 'one-picture-move', page: V(), last: null, files: pic(1), say: '让它动起来',
    want: {kind: 'make', surface: 'video', mode: 'image_video', first: 'new1'}},
  {id: 'one-picture-move-typo', page: V(), last: null, files: pic(1), say: '让他动一动，眨眨眼晴',
    want: {kind: 'make', surface: 'video', mode: 'image_video', first: 'new1'}},
  {id: 'one-picture-idle-other-page', page: {surface: 'other'}, last: null, files: pic(1), say: '给这张图做个待机动画，循环的',
    want: {kind: 'make', surface: 'video', mode: 'first_last', first: 'new1', last: 'new1'}},
  // --- plain descriptions, no pictures ---
  {id: 'describe-on-video', page: V(), last: null, files: [], say: '一只橘猫在草地上奔跑，3秒',
    want: {kind: 'make', surface: 'video', mode: 'text_video', seconds: 3}},
  {id: 'describe-on-drawing', page: D(), last: null, files: [], say: '一座海边的灯塔，黄昏',
    want: {kind: 'make', surface: 'image', mode: 'txt2img'}},
  {id: 'ask-video-anywhere', page: {surface: 'other'}, last: null, files: [], say: '帮我做一个小狗奔跑的动画',
    want: {kind: 'make', surface: 'video', mode: 'text_video'}},
  {id: 'ask-picture-on-video-page', page: V(), last: null, files: [], say: '帮我画一张海报',
    want: {kind: 'make', surface: 'image', mode: 'txt2img'}},
  // --- follow-ups after a loop made from one picture ---
  {id: 'again-no-picture', page: V('first_last', ['a.png', 'a.png']), last: loopTask, files: [], say: '再做一个1秒的循环动画。猴子向下坠落一下马上恢复原位，框子不动',
    want: {kind: 'make', surface: 'video', mode: 'first_last', first: 'keep', last: 'keep', seconds: 1}},
  {id: 'stiff-redo', page: V('first_last', ['a.png', 'a.png']), last: loopTask, files: [], say: '动画太生硬了。要求可爱Q弹。2秒待机动画',
    want: {kind: 'make', surface: 'video', mode: 'first_last', first: 'keep', last: 'keep', seconds: 2}},
  {id: 'size-redo', page: V('first_last', ['a.png', 'a.png']), last: loopTask, files: [], say: '960*960分辨率，重新做',
    want: {kind: 'make', surface: 'video', mode: 'first_last', first: 'keep', last: 'keep', size: '960x960'}},
  {id: 'back-to-2s', page: V('first_last', ['a.png', 'a.png']), last: loopTask, files: [], say: '改回2秒',
    want: {kind: 'make', surface: 'video', mode: 'first_last', first: 'keep', last: 'keep', seconds: 2}},
  {id: 'swap-picture-loop', page: V('first_last', ['a.png', 'a.png']), last: loopTask, files: pic(1), say: '换成这张图再做一个',
    want: {kind: 'make', surface: 'video', mode: 'first_last', first: 'new1', last: 'new1'}},
  {id: 'faster', page: V('first_last', ['a.png', 'a.png']), last: loopTask, files: [], say: '太慢了，再快一点',
    want: {kind: 'make', surface: 'video', mode: 'first_last', first: 'keep', last: 'keep'}},
  {id: 'particles-more', page: V('first_last', ['a.png', 'a.png']), last: loopTask, files: [], say: '粒子再多一点',
    want: {kind: 'make', surface: 'video', mode: 'first_last', first: 'keep', last: 'keep'}},
  {id: 'where-is-it', page: V('first_last', ['a.png', 'a.png']), last: loopTask, files: [], say: '怎么还没出来',
    want: {kind: 'talk'}},
  {id: 'thanks', page: V('first_last', ['a.png', 'a.png']), last: loopTask, files: [], say: '可以，谢谢',
    want: {kind: 'talk'}},
  {id: 'cant-you-upload', page: V('first_last', []), last: null, files: [], say: '你自己不会上传吗?',
    want: {kind: 'talk'}},
  // --- follow-ups after a first/last pair ---
  {id: 'pair-new-two', page: V('first_last', ['a.png', 'b.png']), last: pairTask, files: pic(2), say: '用这两张再做一个',
    want: {kind: 'make', surface: 'video', mode: 'first_last', first: 'new1', last: 'new2'}},
  {id: 'pair-new-last', page: V('first_last', ['a.png', 'b.png']), last: pairTask, files: pic(1), say: '把尾帧换成这张',
    want: {kind: 'make', surface: 'video', mode: 'first_last', first: 'keep', last: 'new1'}},
  {id: 'pair-new-first-colloquial', page: V('first_last', ['a.png', 'b.png']), last: pairTask, files: pic(1), say: '开头换这个',
    want: {kind: 'make', surface: 'video', mode: 'first_last', first: 'new1', last: 'keep'}},
  {id: 'pair-ending-colloquial', page: V('first_last', ['a.png', 'b.png']), last: pairTask, files: pic(1), say: '结尾用这张，别的不动',
    want: {kind: 'make', surface: 'video', mode: 'first_last', first: 'keep', last: 'new1'}},
  {id: 'pair-make-loop', page: V('first_last', ['a.png', 'b.png']), last: pairTask, files: [], say: '改成循环的，首尾都用第一张',
    want: {kind: 'make', surface: 'video', mode: 'first_last', first: 'keep', last: 'first'}},
  // --- after a text video ---
  {id: 'text-video-revise', page: V(), last: textVideoTask, files: [], say: '改成夜晚，下着小雨',
    want: {kind: 'make', surface: 'video', mode: 'text_video'}},
  {id: 'text-video-add-picture', page: V(), last: textVideoTask, files: pic(1), say: '用这张图当开头重做',
    want: {kind: 'make', surface: 'video', mode: 'image_video', first: 'new1'}},
  // --- prompt-only requests ---
  {id: 'optimize-prompt', page: {...V(), prompt: '一只小猫在草地上奔跑'}, last: null, files: [], say: '优化提示词',
    want: {kind: 'prompt', surface: 'video'}},
  {id: 'optimize-prompt-no-generate', page: {...V(), prompt: '一只小猫在草地上奔跑'}, last: null, files: [], say: '帮我把提示词写得更有电影感，先不要生成',
    want: {kind: 'prompt', surface: 'video'}},
  {id: 'go-ahead', page: {...V(), prompt: '一只小猫在草地上奔跑'}, last: null, files: [], say: '开始吧',
    want: {kind: 'make', surface: 'video', mode: 'text_video'}},
  // --- drawing ---
  {id: 'edit-new-picture', page: D('img2img', ['old.png']), last: imageTask, files: pic(1), say: '把背景换成海边沙滩',
    want: {kind: 'make', surface: 'image', mode: 'img2img', first: 'new1'}},
  {id: 'edit-last-result', page: D('img2img', ['old.png']), last: imageTask, files: [], say: '帽子换成红色的，再加一条围巾',
    want: {kind: 'make', surface: 'image', mode: 'img2img', first: 'keep'}},
  {id: 'new-topic-drawing', page: D('img2img', ['old.png']), last: null, files: [], say: '画一座海边的灯塔，黄昏',
    want: {kind: 'make', surface: 'image', mode: 'txt2img'}},
  {id: 'style-of-second', page: D(), last: null, files: pic(2), say: '把图1换成图2的风格',
    want: {kind: 'make', surface: 'image', mode: 'img2img'}},
  {id: 'picture-with-particles', page: D(), last: null, files: [], say: '画一个魔法师，周围有发光粒子环绕',
    want: {kind: 'make', surface: 'image', mode: 'txt2img'}},
  // --- tools and other parts of the app ---
  {id: 'compress', page: {surface: 'other'}, last: null, files: pic(1), say: '帮我压缩这张PNG', want: {kind: 'operate'}},
  {id: 'open-audio', page: V(), last: loopTask, files: [], say: '打开音频', want: {kind: 'operate'}},
  {id: 'theme', page: {surface: 'other'}, last: null, files: [], say: '切换成暗色主题', want: {kind: 'operate'}},
  {id: 'split-picture', page: D(), last: null, files: pic(1), say: '帮我把这张图拆一下', want: {kind: 'operate'}},
  {id: 'particle-editor', page: {surface: 'other'}, last: null, files: [], say: '打开粒子编辑，把发射率调高', want: {kind: 'operate'}},
  // Live 2.0.387: "打开绘图页面" was answered with two questions and the page never opened; the picture in the drawing
  // page's reference slot is "这张图"; a moving effect is a video, not a still.
  {id: 'open-drawing', page: {surface: 'other'}, last: null, files: [], say: '打开绘图页面', want: {kind: 'operate'}},
  {id: 'split-page-picture', page: D('img2img', ['white_baboon.png']), last: null, files: [], say: '帮我把这张图拆一下', want: {kind: 'operate'}},
  {id: 'coin-effect', page: D(), last: null, files: [], say: '做个金币掉落的特效', want: {kind: 'make', surface: 'video', mode: 'text_video'}},
  // An effect that is the thing to make is a video; an effect described inside a picture is that picture's content.
  // (Live: a rule that named effect words turned "画一个魔法师，周围有发光粒子环绕" into a video with DeepSeek.)
  {id: 'coin-effect-elsewhere', page: {surface: 'other'}, last: null, files: [], say: '做个金币掉落的特效', want: {kind: 'make', surface: 'video', mode: 'text_video'}},
  {id: 'explosion-effect', page: D(), last: null, files: [], say: '来个爆炸特效', want: {kind: 'make', surface: 'video', mode: 'text_video'}},
  {id: 'poster-with-coin-effect', page: D(), last: null, files: [], say: '画一张老虎机海报，上面有金币掉落的特效', want: {kind: 'make', surface: 'image', mode: 'txt2img'}},
  {id: 'dragon-flames-drawing', page: D(), last: null, files: [], say: '一条喷火的龙，火焰飘动，赛博朋克风格', want: {kind: 'make', surface: 'image', mode: 'txt2img'}},
  {id: 'dragon-flames-video', page: V(), last: null, files: [], say: '一条喷火的龙，火焰飘动，赛博朋克风格', want: {kind: 'make', surface: 'video', mode: 'text_video'}},
  {id: 'wizard-particles-video', page: V(), last: null, files: [], say: '一个魔法师，周围有发光粒子环绕', want: {kind: 'make', surface: 'video', mode: 'text_video'}},
  // Live 2.0.393: on the video page "画一只橘猫，Q版风格" was made as a 3-second video.
  {id: 'draw-cat-on-video-page', page: V(), last: null, files: [], say: '画一只橘猫，Q版风格', want: {kind: 'make', surface: 'image', mode: 'txt2img'}},
  {id: 'draw-cat-after-video', page: V('first_last', ['a.png', 'a.png']), last: loopTask, files: [], say: '帮我画个橘猫头像', want: {kind: 'make', surface: 'image', mode: 'txt2img'}},
  {id: 'cat-animation-on-drawing-page', page: D(), last: null, files: [], say: '做一个橘猫跑步的动画，2秒', want: {kind: 'make', surface: 'video', mode: 'text_video', seconds: 2}},
  // Live 2.0.393: after a 文生视频, a picture brought with "把背景换成海边" was made as another 文生视频, without it.
  {id: 'edit-brought-picture-after-text-video', page: V(), last: textVideoTask, files: pic(1), say: '把背景换成海边', want: {kind: 'make', surface: 'image', mode: 'img2img', first: 'new1'}},
  // --- not sure: one short question first (Dylan, 2026-11-17) ---
  {id: 'ask-two-pictures', page: V(), last: null, files: pic(2), say: '用这两张图做个东西', want: {kind: 'ask'}},
  {id: 'ask-which-frame', page: V('first_last', ['a.png', 'b.png']), last: pairTask, files: pic(1), say: '换一下', want: {kind: 'ask'}},
  {id: 'ask-handle-it', page: {surface: 'other'}, last: null, files: pic(1), say: '处理一下', want: {kind: 'ask'}},
  // --- talk ---
  {id: 'hello', page: V(), last: null, files: [], say: '你好', want: {kind: 'talk'}},
  {id: 'how-much', page: V(), last: loopTask, files: [], say: '这个要多少积分', want: {kind: 'talk'}},
  {id: 'what-can-you-do', page: D(), last: null, files: [], say: '你能做什么', want: {kind: 'talk'}},
  {id: 'why-text-video', page: V(), last: loopTask, files: [], say: '为什么变成了文生视频', want: {kind: 'talk'}},
];
