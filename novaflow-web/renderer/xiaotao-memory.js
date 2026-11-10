// 小桃记忆: each account's own short preference list, kept on the server so the
// site, the compute assistant, online models and the local model share it.
// Only preference text is stored, never chat logs or pictures. Writes are
// conservative: the user says 记住/以后都…, or adopts a result and 小桃 keeps the
// model line, style words, duration or format that the adopted turn used.
(function (root) {
  'use strict';
  const LABELS = {model:'模型', art:'画风画法', video:'视频', audio:'音频', ui:'UI 排版', export:'导出', chat:'说话习惯', avoid:'不要'};
  const ORDER = ['model','art','video','audio','ui','export','chat','avoid'];
  const LIMIT = 20;
  const state = {loaded:false, available:false, enabled:true, items:[], error:''};
  const listeners = new Set();
  const notify = () => { for (const fn of listeners) { try { fn(snapshot()); } catch {} } };
  const snapshot = () => ({loaded:state.loaded, available:state.available, enabled:state.enabled, items:state.items.slice(), error:state.error});
  const call = async (op, body) => {
    const fn = root.electronAPI?.xiaotaoMemory;
    if (typeof fn !== 'function') return {ok:false, error:'记忆功能未加载'};
    try { return await fn(op, body) || {ok:false, error:'记忆服务没有回应'}; } catch (error) { return {ok:false, error:String(error?.message || error)}; }
  };

  // ---- understanding what to keep --------------------------------------------------
  const hash = text => { let h = 2166136261; for (const ch of String(text)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h.toString(36); };
  const NEGATIVE = /(?:不要|别再?|不想|不用|讨厌|不喜欢|禁止|去掉|不加|不需要|少用)/;
  // [slot, pattern]; the first match names the kind of preference, so a newer one replaces it.
  const TOPICS = [
    ['chat.name', /叫我|称呼我?/],
    ['audio.music', /背景音乐|配乐|BGM|音乐/i],
    ['audio.voice', /音色|配音|人声|嗓音/],
    ['audio.speed', /语速/],
    ['video.duration', /时长|\d+\s*(?:秒|s\b)/i],
    ['video.camera', /镜头|运镜|机位/],
    ['video.pace', /节奏|快慢|慢动作/],
    ['export.format', /\b(?:png|jpe?g|webp|gif|mp4|webm|mov|wav|mp3|ogg|spine|psd)\b|格式/i],
    ['export.size', /分辨率|尺寸|宽高|比例|\d{3,4}\s*[x×*]\s*\d{3,4}|竖屏|横屏|方图/i],
    ['ui.color', /(?:界面|UI|按钮|主题).{0,6}(?:颜色|配色|深色|浅色|暗色)|(?:深色|浅色|暗色)(?:主题|界面|UI)/i],
    ['ui.layout', /UI|界面|按钮|排版|布局|图标|圆角|间距|字号/i],
    ['chat.reply', /回复|回答|说话|语气|简短|啰嗦|详细|解释/],
    ['art.color', /色调|暖色|冷色|配色|颜色|饱和|明亮|暗调|光影/],
    ['art.style', /画风|风格|画法|厚涂|平涂|二次元|写实|像素|水彩|油画|赛博|国风|日系|韩系|美式|Q版|3D|三渲二|卡通|线稿|动漫|插画|水墨|扁平|手绘|游戏/i],
    ['art.subject', /人物|角色|背景|构图|景别|特写|全身|半身/]
  ];
  const MODEL_WORDS = /GPT\s*Image|Nano\s*Banana|Grok|Qwen|DeepSeek|Gemini|GPT|Claude|Kimi|豆包|本地模型|在线模型|模型|线路/i;
  function modelSlot(text) {
    if (/视频|动画|镜头/.test(text)) return 'model.video';
    if (/音频|音效|音乐|配音|配乐/.test(text)) return 'model.audio';
    if (/聊天|对话|回答|问答/.test(text)) return 'model.chat';
    return 'model.image';
  }
  function classify(text) {
    const negative = NEGATIVE.test(text);
    if (!negative && MODEL_WORDS.test(text)) return {category:'model', slot:modelSlot(text)};
    const topic = TOPICS.find(([, re]) => re.test(text));
    if (negative) return {category:'avoid', slot:topic ? topic[0] : 'avoid.' + hash(text)};
    if (!topic) return {category:/画|图/.test(text) ? 'art' : 'chat', slot:'note.' + hash(text)};
    return {category:topic[0].split('.')[0], slot:topic[0]};
  }
  const tidy = text => String(text || '').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').replace(/^[：:，,、\s]+|[。！!？?；;，,\s]+$/g, '').trim();
  const unsafe = text => /data:|https?:\/\/|www\.|Bearer\s|nfw_|sk-[A-Za-z0-9]|@[A-Za-z0-9-]+\.[A-Za-z]/i.test(text);
  const LEAD = /^(?:请|麻烦|你)?(?:帮我)?(?:记住|记一下|记下来?|要记得|请记得)(?:一下)?[：:，,\s]*/;
  const STANDING = /(?:以后|今后|往后|之后|下次|每次|一直|永远|始终)(?:都|也|一律|统一|默认|就|全部|总是|还是)?/;
  // An explicit request to remember. `only` means the message is just that, so
  // 小桃 can answer it without a model call.
  function explicitMemory(message) {
    const text = tidy(message);
    if (!text || text.length > 160) return null;
    if (LEAD.test(text)) {
      const body = tidy(text.replace(LEAD, '').replace(/^我(?=(?:比较|最|更)?(?:喜欢|偏好|习惯|不喜欢|讨厌|想要|要|爱))/, ''));
      if (body.length < 2 || body.length > 80 || unsafe(body)) return null;
      return {text:body, ...classify(body), only:true};
    }
    const clause = text.split(/[。！!；;\n]/).map(tidy).find(part => STANDING.test(part) &&
      /(?:用|要|给我|帮我|按|是|不要|别|做|画|出|生成|配|加|导出|存|叫我|回复|回答|保持|选)/.test(part.replace(STANDING, '')));
    if (!clause || clause.length < 4 || clause.length > 80 || unsafe(clause)) return null;
    return {text:clause, ...classify(clause), only:false};
  }

  const STYLE_WORDS = ['二次元','厚涂','平涂','写实','像素','水彩','油画','赛博朋克','国风','日系','韩系','美式','Q版','3D','三渲二','卡通','线稿','动漫','插画','水墨','扁平','手绘','暖色','冷色','高饱和','低饱和','暗调','明亮','电影感','复古','极简','可爱','科幻','奇幻'];
  const IMAGE_ACTIONS = /image|art|draw|generate|paint/i;
  function receiptsOf(content) {
    const at = String(content || '').indexOf('实际工具回执：');
    if (at < 0) return [];
    try { const rows = JSON.parse(String(content).slice(at + 7)); return Array.isArray(rows) ? rows.flatMap(r => [r, ...(Array.isArray(r?.results) ? r.results : [])]) : []; } catch { return []; }
  }
  // The adopted turn: the user's requests since the last adoption, plus what the
  // tools actually used. Returns at most two preferences, each one the user can undo.
  function fromAdoption(history) {
    const rows = Array.isArray(history) ? history.slice(-8) : [];
    const asks = rows.filter(r => r?.role === 'user').map(r => String(r.content || '')).join('\n');
    const receipts = rows.filter(r => r?.role === 'assistant').flatMap(r => receiptsOf(r.content));
    const found = [];
    const imageModel = [...receipts].reverse().find(r => r && r.modelLabel && IMAGE_ACTIONS.test(String(r.action || '') + String(r.surface || '')))?.modelLabel;
    if (imageModel && !unsafe(imageModel)) found.push({category:'model', slot:'model.image', text:'画图常用 ' + tidy(imageModel).slice(0, 40)});
    const styles = STYLE_WORDS.filter(word => asks.toLowerCase().includes(word.toLowerCase())).filter(word => !new RegExp('(?:不要|别|不想|去掉)[^，,。]{0,6}' + word).test(asks));
    if (styles.length) found.push({category:'art', slot:'art.style', text:'喜欢的画风：' + styles.slice(0, 4).join('、')});
    if (found.length < 2) {
      const seconds = [...receipts].reverse().find(r => Number(r?.seconds) > 0 && /video/i.test(String(r.surface || '') + String(r.action || '')))?.seconds;
      if (seconds) found.push({category:'video', slot:'video.duration', text:'视频时长常用 ' + Math.round(Number(seconds)) + ' 秒'});
    }
    if (found.length < 2) {
      const format = [...receipts].reverse().find(r => r?.format && /export|save|download/i.test(String(r.action || '')))?.format;
      if (format && /^[A-Za-z0-9]{2,6}$/.test(String(format))) found.push({category:'export', slot:'export.format', text:'导出常用 ' + String(format).toUpperCase() + ' 格式'});
    }
    return found.slice(0, 2).map(item => ({...item, source:'adopted'}))
      .filter(item => !state.items.some(old => old.slot === item.slot && old.text === item.text));
  }

  // ---- what the model reads ----------------------------------------------------------
  function summaryText(items = state.items) {
    const usable = state.enabled ? items.filter(item => item && item.text) : [];
    if (!usable.length) return '';
    const lines = [];
    for (const category of ORDER) {
      const texts = usable.filter(item => item.category === category).map(item => item.text);
      if (texts.length) lines.push('- ' + LABELS[category] + '：' + texts.join('；'));
    }
    return (MEMORY_HEAD + '之前确认过的习惯，按这些来；我这次说的和它冲突时以这次为准）：\n' + lines.join('\n')).slice(0, 700);
  }
  // The memory travels as the first exchange of the history, so online models,
  // the tool planner and the local model all read it the same way.
  const MEMORY_HEAD = '我的偏好记忆（', MEMORY_ACK = '好的，我会按你的这些偏好来做；你这次说的优先。';
  function stripMemory(history) {
    return (Array.isArray(history) ? history : []).filter(row => !(row && typeof row.content === 'string' &&
      ((row.role === 'user' && row.content.startsWith(MEMORY_HEAD)) || (row.role === 'assistant' && row.content === MEMORY_ACK))));
  }
  function withMemory(history) {
    const rows = stripMemory(history);
    const text = summaryText();
    if (!text) return rows;
    return [{role:'user', content:text}, {role:'assistant', content:MEMORY_ACK}, ...rows.slice(-10)];
  }
  function withMemoryText(historyText) {
    const text = summaryText();
    return text ? text + (historyText ? '\n' + historyText : '') : historyText;
  }

  // ---- server ---------------------------------------------------------------------
  async function load() {
    const result = await call('list');
    state.loaded = true;
    if (result?.ok) { state.available = true; state.enabled = result.enabled !== false; state.items = Array.isArray(result.items) ? result.items.slice(0, LIMIT) : []; state.error = ''; }
    else { state.available = false; state.items = []; state.error = result?.status === 401 ? '登录后可以使用记忆' : '记忆暂不可用'; }
    notify();
    return snapshot();
  }
  async function save(items) {
    if (!state.available || !state.enabled) return [];
    const saved = [];
    for (const item of items) {
      const result = await call('save', {category:item.category, slot:item.slot, text:item.text, source:item.source || 'explicit'});
      if (!result?.ok || !result.item) continue;
      // A newer preference of the same kind replaces the opposite one too
      // (以后都加背景音乐 replaces 不要背景音乐).
      for (const old of state.items.filter(row => row.slot === result.item.slot && row.id !== result.item.id)) await call('delete', {id:old.id});
      state.items = [result.item, ...state.items.filter(row => row.slot !== result.item.slot && row.id !== result.item.id)].slice(0, LIMIT);
      saved.push(result.item);
    }
    if (saved.length) notify();
    return saved;
  }
  async function remove(id) {
    const result = await call('delete', {id});
    if (result?.ok) { state.items = state.items.filter(item => item.id !== id); notify(); }
    return result?.ok === true;
  }
  async function clear() {
    const result = await call('delete', {all:true});
    if (result?.ok) { state.items = []; notify(); }
    return result?.ok === true;
  }
  async function setEnabled(enabled) {
    const result = await call('settings', {enabled:enabled === true});
    if (result?.ok) { state.enabled = result.enabled === true; notify(); }
    return result?.ok === true;
  }
  const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };

  root.NovaFlowXiaotaoMemory = Object.freeze({LABELS, ORDER, LIMIT, explicitMemory, classify, fromAdoption, summaryText, stripMemory, withMemory, withMemoryText,
    load, save, remove, clear, setEnabled, subscribe, snapshot, ready:() => state.available && state.enabled});
})(typeof globalThis !== 'undefined' ? globalThis : window);
