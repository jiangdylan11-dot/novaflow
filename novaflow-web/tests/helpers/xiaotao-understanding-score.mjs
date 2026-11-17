// Scores a reading of the understanding cases. A reading is {kind, surface, mode, first, last, seconds, size};
// a case is right when every field its `want` names matches.
import {createContext, runInContext} from 'node:vm';

export function isRight(got, want) {
  return Object.entries(want).every(([key, value]) => String(got?.[key] ?? '') === String(value));
}
export function score(cases, read) {
  const rows = cases.map(item => {const got = read(item); return {id: item.id, say: item.say, want: item.want, got, right: isRight(got, item.want)};});
  return {rows, right: rows.filter(row => row.right).length, total: rows.length};
}

// The app's own rule-based reading (xiaotao-upload.js + xiaotao-prompt-source.js, any version of their text),
// followed the way send() and consumeStaged() follow it.
export function ruleReader({upload, promptSource}) {
  const root = {}; root.window = root; createContext(root);
  runInContext(promptSource, root); runInContext(upload, root);
  const u = root.NovaFlowXiaotaoUpload, source = root.NovaFlowXiaotaoPromptSource;
  // send()'s old keyword gate between plain chat and the tools (2.0.363), kept for versions without smallTalk().
  const oldGate = /打开|关闭|进入|切换|操作|执行|调用|生成|制作|设计|新建|创建|建立|添加|增加|配上|配个|配一|配齐|特效|光效|动效|扫光|刀光|背光|转光|金币|做(?:一|个|张|段|套)|来(?:一|个|张|段)|配乐|配音|转成|转换|合成|渲染|改|换|抠|去掉|去除|擦|放大|扩|拆|补|裁|压缩|画|加上|加个|调整|编辑|删除|导入|导出|保存|播放|暂停|选择|选中|移动|旋转|缩放|画布|图层|时间轴|当前(?:页面|作品|工程|画面|图片|视频)|放(?:进|到|入)|加(?:进|到|入)|作为.{0,4}(?:参考|素材)|参考图|用这|拿这|做成|变成|换成|换掉|替换|迁移/;
  return item => {
    const files = item.files.map((kind, index) => ({kind, name: 'new' + (index + 1) + '.png'}));
    const page = item.page.surface === 'other' ? null : {surface: item.page.surface, mode: item.page.mode,
      sameFrames: item.page.frames?.length === 2 && item.page.frames[0] === item.page.frames[1]};
    const task = u.inferTask(item.say, files, item.last, page);
    const promptPage = item.page.surface !== 'other';
    let hasResult = !!item.last && item.last.surface === item.page.surface, action = 'none';
    try {action = promptPage ? source.classifyPromptAction(item.say, {hasResult}) : 'none';} catch {}
    const tool = u.toolRequest ? u.toolRequest(item.say) : /压缩|去黑|图集|查看器|粒子|模板/.test(item.say);
    const effects = u.effectsPanelRequest?.(item.say) === true;
    let kind;
    if (action === 'optimize' && (item.page.prompt || !files.length)) kind = 'prompt';
    else if (u.missedResultRequest?.(item.say) && item.last) kind = u.smallTalk ? 'talk' : 'make';
    else if (u.smallTalk ? u.smallTalk(item.say) || task.discussion && !task.revision : task.discussion || task.surface === 'chat' && !item.last && !files.length && !oldGate.test(item.say)) kind = 'talk';
    else if (tool || effects || task.surface === 'chat' || ['audio', 'animation'].includes(task.surface) && !/做|生成|来/.test(item.say)) kind = 'operate';
    else kind = 'make';
    const got = {kind};
    if (kind === 'make' || kind === 'prompt') {
      got.surface = kind === 'prompt' ? item.page.surface : task.surface; got.mode = task.mode;
      if (Number.isFinite(task.seconds) && /\d\s*秒/.test(item.say)) got.seconds = task.seconds;
      const size = /(\d{3,4})\s*[*x×X]\s*(\d{3,4})/.exec(item.say); if (size && u.goAhead) got.size = size[1] + 'x' + size[2];
      // consumeStaged(): a "production" request places nothing.
      const place = tool || effects ? [] : u.planRoutes(item.say, files, item.last, page).place;
      const slot = id => {const hit = place.find(entry => entry.destination.id === id); return hit ? hit.name.replace('.png', '') : '';};
      if (task.surface === 'video') {
        const kept = task.revision && item.page.frames?.length ? 'keep' : '';
        got.first = slot('first_frame') || slot('image_video') || kept; got.last = slot('last_frame') || (task.mode === 'first_last' ? kept : '');
        if (!got.first) delete got.first; if (!got.last) delete got.last;
      } else if (task.surface === 'image') {
        got.first = slot('img2img') || (task.revision && item.page.refs?.length ? 'keep' : ''); if (!got.first) delete got.first;
      }
    }
    return got;
  };
}
