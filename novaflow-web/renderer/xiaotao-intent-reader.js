(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FoartXiaotaoIntent = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // The brain reads the turn. One request carries what a colleague at the screen would know: the conversation,
  // what the page shows, what was just made, this turn's pictures (it sees them) and the sentence. It answers
  // with what the person wants as a small JSON, and the app carries that out. Keyword rules no longer decide
  // what a sentence means; they only stand in when this reading cannot be had.
  const KINDS = ['make', 'prompt', 'operate', 'talk'];
  const SURFACES = ['video', 'image', 'audio', 'other'];
  const MODES = {video: ['text_video', 'image_video', 'first_last', 'multi_reference'], image: ['txt2img', 'img2img'], audio: ['music', 'sfx'], other: []};
  const MODE_NAMES = {text_video: '文生视频', image_video: '图生视频', first_last: '首尾帧视频', multi_reference: '多参视频', txt2img: '文生图', img2img: '图生图'};
  const clip = (value, size) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, size);

  function describePage(page) {
    if (!page || !page.surface || page.surface === 'other') return '用户当前不在生成页面。';
    if (page.surface === 'video') {
      const frames = (page.frames || []).filter(Boolean);
      return '用户正停在视频生成页面，当前模式：' + (MODE_NAMES[page.mode] || page.mode || '未知')
        + (page.mode === 'first_last' ? '；首帧位置：' + (frames[0] || '空') + '，尾帧位置：' + (frames[1] || '空')
          : page.mode === 'image_video' ? '；参考图位置：' + (frames[0] || '空') : '')
        + (page.seconds ? '；时长 ' + page.seconds + ' 秒' : '') + (page.width && page.height ? '；尺寸 ' + page.width + '×' + page.height : '')
        + (page.prompt ? '；输入框里的提示词：' + clip(page.prompt, 300) : '；输入框里没有提示词') + '。';
    }
    if (page.surface === 'image') {
      const refs = (page.refs || []).filter(Boolean);
      return '用户正停在绘图页面，当前模式：' + (MODE_NAMES[page.mode] || page.mode || '未知') + '；参考图位置：' + (refs.length ? refs.join('、') : '空')
        + (page.prompt ? '；输入框里的提示词：' + clip(page.prompt, 300) : '；输入框里没有提示词') + '。';
    }
    return '用户正停在音频生成页面。';
  }
  function describeLast(last) {
    if (!last || !last.surface) return '这次对话里还没有做出过成品。';
    return '这次对话里上一个做完的任务：' + ({video: '视频', image: '图片', audio: '音频'}[last.surface] || last.surface)
      + (last.mode ? '（' + (MODE_NAMES[last.mode] || last.mode) + (last.loop ? '，循环' : '') + '）' : '')
      + (last.request ? '，当时的要求：' + clip(last.request, 200) : '') + (last.outputs && last.outputs.length ? '，成品：' + last.outputs.slice(-2).join('、') : '') + '。';
  }
  function buildQuestion({message, history = [], page = null, last = null, pictureCount = 0} = {}) {
    const talk = history.slice(-6).map(item => (item.role === 'user' ? '用户：' : '小桃：') + clip(item.content, 220)).join('\n');
    return [
      '你是 Foart 里的助手小桃。下面是用户刚说的一句话，以及你作为同事坐在他屏幕前能看到的一切。请像人一样理解他真正要什么，然后只输出一个 JSON，不要解释。',
      '',
      '【页面】' + describePage(page),
      '【上一个任务】' + describeLast(last),
      talk ? '【之前的对话】\n' + talk : '【之前的对话】无',
      '【这一句带的图片】' + (pictureCount ? pictureCount + ' 张，按顺序是 图1' + (pictureCount > 1 ? ' 到 图' + pictureCount : '') + '，你能直接看到它们。' : '没有带图片。'),
      '【用户这一句】' + clip(message, 1200),
      '',
      '理解时注意：',
      '- 用户描述画面、提修改、说“再做一个/重做/开始吧”，要的是成品（make），不是只改提示词；只有他明说“提示词”或“先不要生成”才是 prompt。',
      '- 话里出现的“粒子、特效、模板、压缩”等词，如果是在描述画面内容，就只是内容，不是要去用那个工具；明确要用工具或去别的版块才是 operate。',
      '- 软件里有这些现成的工具和版块，用户要用它们就是 operate，不是生成：一键拆图（把图拆成图层）、抠图、高清放大、扩图、压缩、格式转换、图集、粒子编辑、骨骼动画编辑、音视频剪辑、导出、打开或切换版块、UI 换主题（“切换成某某主题”）。',
      '- 寒暄、道谢、提问、抱怨“怎么没出来”是 talk；但“太慢了，再快一点”这类是对上一个成品的修改，属于 make。',
      '- 没带新图而接着上一个任务说，就沿用页面上已有的图和模式（first/last 写 keep）。',
      '- 用户要的是全新的画面、和页面上留着的图无关时，用 txt2img 或 text_video，不要沿用那张旧图。',
      '- 尾帧要和首帧用同一张图时，last 写 first。',
      '- 带了新图，要判断每张图的用途：一张图做循环待机，就首帧尾帧都用它；“图1变成图2/从…到…”是 图1 首帧、图2 尾帧，顺序以用户的话为准；只说换某一帧，就只换那一帧，另一帧 keep。',
      '- 视频模式：没有图用 text_video；一张图让它动起来用 image_video；只要说了“循环”或“待机”，或者有首有尾，就用 first_last（循环待机时首帧尾帧是同一张图）。',
      '- 绘图：这一句带了图并要改图，改的就是带来的这张新图（first 写 new1），用 img2img；没带图而是改上一张成品，first 写 keep；全新画面用 txt2img。绘图没有别的模式。',
      '- 用户明说了时长、尺寸才填 seconds / width / height，没说就填 null。',
      '',
      'JSON 字段：',
      '{"kind":"make|prompt|operate|talk","surface":"video|image|audio|other","mode":"text_video|image_video|first_last|multi_reference|txt2img|img2img|music|sfx|",',
      '"first":"new1|new2|new3|keep|none","last":"new1|new2|new3|keep|first|none","loop":true|false,"seconds":数字或null,"width":数字或null,"height":数字或null,',
      '"pictures":["图1里实际有什么（不超过五十字）", …],"brief":"用一两句话复述他要的成品画面和动作，只写画面内容"}',
    ].join('\n');
  }

  // Reads the brain's answer. Anything outside what the app can carry out makes the whole reading void (null):
  // a half-understood turn is handed to the rules, never guessed.
  function parseReading(text, {pictureCount = 0} = {}) {
    // The first complete {...} in the answer: a brain may add a sentence, a fence or a second object after it.
    const raw = String(text || ''), start = raw.indexOf('{');
    if (start < 0) return null;
    let depth = 0, end = -1, quoted = false;
    for (let i = start; i < raw.length; i += 1) {
      const ch = raw[i];
      if (quoted) {if (ch === '\\') i += 1; else if (ch === '"') quoted = false; continue;}
      if (ch === '"') quoted = true; else if (ch === '{') depth += 1; else if (ch === '}' && --depth === 0) {end = i; break;}
    }
    if (end < 0) return null;
    let data; try {data = JSON.parse(raw.slice(start, end + 1));} catch {return null;}
    if (!data || typeof data !== 'object' || !KINDS.includes(data.kind)) return null;
    const reading = {kind: data.kind};
    if (data.kind === 'talk') return reading;
    const surface = SURFACES.includes(data.surface) ? data.surface : 'other';
    reading.surface = surface;
    if (data.kind === 'operate') return reading;
    if (surface === 'other') return null;
    // A picture job has two modes; a brain that names another one for it still told us whether pictures are used.
    const mode = MODES[surface].includes(data.mode) ? data.mode : surface === 'image' ? (pictureCount || data.first === 'keep' ? 'img2img' : 'txt2img') : '';
    if (data.kind === 'prompt') return {...reading, mode};
    if (!mode) return null;
    reading.mode = mode;
    const slot = (value, extra) => {
      const name = String(value || 'none');
      const picked = /^new([1-9])$/.exec(name);
      if (picked) return Number(picked[1]) <= pictureCount ? name : null;
      // Anything else names what is already on the page (a brain sometimes writes the file's name): that is keep.
      return ['keep', 'none', ...extra].includes(name) ? name : /^new/i.test(name) ? null : 'keep';
    };
    // Slots only matter where the mode has them: a 文生 job that names a slot is still a 文生 job.
    const slotless = mode === 'text_video' || mode === 'txt2img';
    const first = slotless ? 'none' : slot(data.first, []), last = slotless || mode === 'image_video' || surface === 'image' ? 'none' : slot(data.last, ['first']);
    if (first === null || last === null) return null;
    if (surface === 'video') {
      if (mode === 'text_video') {reading.first = 'none'; reading.last = 'none';}
      else if (mode === 'image_video') {if (first === 'none') return null; reading.first = first; reading.last = 'none';}
      else if (mode === 'first_last') {
        if (first === 'none') return null;
        // "first" with a kept first frame means: copy that frame to the end. With a new picture it is simply that picture.
        reading.first = first; reading.last = last === 'none' ? first : last === 'first' ? (first === 'keep' ? 'first' : first) : last;
      } else {reading.first = first; reading.last = last;}
      reading.loop = data.loop === true || (mode === 'first_last' && (reading.first === reading.last || reading.last === 'first'));
    } else if (surface === 'image') {
      reading.first = mode === 'txt2img' ? 'none' : first === 'none' ? (pictureCount ? 'new1' : 'keep') : first;
    }
    const number = (value, low, high) => {const n = Number(value); return value !== null && value !== '' && Number.isFinite(n) && n >= low && n <= high ? n : null;};
    reading.seconds = number(data.seconds, 1, 30);
    reading.width = number(data.width, 64, 4096); reading.height = number(data.height, 64, 4096);
    if (reading.width === null || reading.height === null) {reading.width = null; reading.height = null;}
    reading.pictures = Array.isArray(data.pictures) ? data.pictures.slice(0, pictureCount).map(item => clip(item, 120)) : [];
    reading.brief = clip(data.brief, 600);
    return reading;
  }
  return Object.freeze({buildQuestion, parseReading, describePage, describeLast});
});
