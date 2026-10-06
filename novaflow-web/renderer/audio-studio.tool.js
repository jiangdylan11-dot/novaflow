// 音频 - a fifth rail entry: game background music loops and sound effects,
// rendered on the local compute node from a text description.
//
// The React bundle knows four sections and cannot be rebuilt, so this is an
// overlay: a rail cell of its own below 工具 (the same shape as 仓库/导出) and
// a fixed workspace that covers the section panels while it is open. The
// page only ever sends a task type and business parameters; the graph lives
// on the worker.
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.NovaFlowAudioStudio) return;

  const LABEL = '音频';
  const CELL_ID = 'novaflow-primary-audio-cell';
  const ROOT_ID = 'novaflow-audio-studio';
  const STYLE_ID = 'novaflow-audio-studio-style';
  const BODY_CLASS = 'novaflow-primary-target-audio';
  const RAIL_PITCH = 70;              // PRIMARY_RAIL_ITEM_PITCH in the brand runtime
  const PANEL_WIDTH = 200;            // fallback; measured from the left column when it exists
  const PANEL_SEAM = 10;              // gap between the panel card and the stage
  const PANEL_TOP = 62;               // TOPBAR_HEIGHT + PRIMARY_PANEL_TOP_GAP
  const PANEL_BOTTOM_GAP = 10;
  const ICON = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M9 18V5l12-2v13'/%3E%3Ccircle cx='6' cy='18' r='3'/%3E%3Ccircle cx='18' cy='16' r='3'/%3E%3C/svg%3E\")";

  // ---- vocabulary: the page speaks Chinese, the model reads English --------
  const MUSIC_STYLES = [
    ['auto', '按描述', '', 100],
    ['chiptune', '像素复古', 'Chiptune 8-bit game music with a bright square-wave lead melody, arpeggiated pulse chords, triangle bass and crisp 8-bit drums', 140],
    ['casual', '轻松休闲', 'Light casual game music with bouncy ukulele, marimba, glockenspiel, soft claps and playful whistle melodies', 118],
    ['explore', '神秘探索', 'Mysterious exploration game music with soft harp arpeggios, airy flute, warm string pads, gentle hand percussion and distant bells', 88],
    ['orchestral', '史诗管弦', 'Epic orchestral game score with soaring strings, bold brass, french horns, taiko drums and timpani', 110],
    ['battle', '紧张战斗', 'Intense battle game music with driving electric guitar riffs, pounding drums, pulsing synth bass, staccato strings and brass stabs', 150],
    ['edm', '电子动感', 'Energetic electronic dance game music with punchy synth leads, side-chained bass, a four-on-the-floor kick and bright plucks', 128],
    ['lofi', '治愈放松', 'Lo-fi chill music with mellow electric piano, vinyl crackle, soft synth pads, low-pass filtered drums and plucked bass', 78],
    ['jazz', '爵士咖啡', 'Relaxed jazz lounge music with mellow electric piano, upright bass, brushed drums and soft saxophone', 95],
    ['guofeng', '国风古韵', 'Chinese traditional style game music with guzheng, dizi bamboo flute, erhu, pipa and soft hand drums', 84],
    ['horror', '恐怖氛围', 'Dark horror ambience music with dissonant strings, eerie piano stabs, low drones, distant whispers and sparse percussion', 70]
  ];
  const MOODS = [
    ['happy', '欢快', 'upbeat and cheerful'], ['heroic', '热血', 'heroic and energetic'], ['warm', '温暖', 'warm and cozy'],
    ['mystery', '神秘', 'mysterious and curious'], ['tense', '紧张', 'tense and suspenseful'], ['sad', '悲伤', 'melancholic and sad'],
    ['dreamy', '梦幻', 'dreamy and ethereal'], ['quirky', '搞怪', 'quirky and comedic'], ['grand', '恢弘', 'grand and epic'],
    ['calm', '平静', 'calm and peaceful']
  ];
  const MUSIC_DURATIONS = [15, 30, 45, 60, 90];
  const SFX_CATEGORIES = [
    ['auto', '按描述', '', 2],
    ['ui', '界面点击', 'Soft UI button click, a short clean tap with a subtle bright tick, dry and close', 1],
    ['coin', '拾取金币', 'Coin pickup chime, a bright short two-note bling with a quick sparkle, clean', 1],
    ['jump', '跳跃', 'Character jump, a quick rising boing with a springy attack and a short tail', 1],
    ['slash', '攻击挥砍', 'Sword swing whoosh through the air followed by a sharp metal slash impact with a short ringing decay', 2],
    ['hit', '命中受伤', 'Punch hit impact with a dull thud and a quick low knock, close perspective', 1],
    ['explosion', '爆炸', 'Explosion with a deep bass boom, scattering debris and a crackling tail, cinematic, medium distance', 3],
    ['steps', '脚步', 'Footsteps on gravel at a steady walking pace, four steps, close perspective', 3],
    ['magic', '魔法', 'Magical spell cast with shimmering sparkles, a rising tonal whoosh and a glittering tail', 3],
    ['levelup', '升级奖励', 'Level up reward chime, a bright ascending arpeggio with a rewarding shimmer, fantasy RPG style', 2],
    ['chest', '开门宝箱', 'Wooden treasure chest lid creaking open followed by a soft magical sparkle', 3],
    ['ambience', '环境氛围', 'Ambient background of a quiet forest with birds chirping, soft wind through leaves and a distant stream', 10],
    ['error', '失败错误', 'Error buzzer, a short low digital buzz, UI feedback', 1]
  ];
  const SFX_STYLES = [
    ['any', '默认', ''], ['8bit', '8位复古', '8-bit retro arcade style'], ['realistic', '写实', 'realistic, natural recording'],
    ['cartoon', '卡通', 'cartoon style, exaggerated and playful'], ['scifi', '科幻', 'sci-fi, synthetic and futuristic'],
    ['fantasy', '奇幻', 'fantasy, magical']
  ];
  const SFX_DURATIONS = [1, 2, 3, 5, 10];
  // Words a game maker types in Chinese; the rest of a sentence passes through
  // and the rewrite on the node turns it into the model's own phrasing.
  const ZH = [
    ['背景音乐', 'background music'], ['无缝循环', 'seamless loop'], ['循环', 'loop'], ['中国风', 'Chinese traditional style'], ['国风', 'Chinese traditional style'],
    ['日式', 'Japanese style'], ['中世纪', 'medieval'], ['蒸汽朋克', 'steampunk'], ['赛博朋克', 'cyberpunk'], ['像素', 'pixel 8-bit'], ['复古', 'retro'],
    ['卡通', 'cartoon'], ['科幻', 'sci-fi'], ['奇幻', 'fantasy'], ['恐怖', 'horror'], ['史诗', 'epic'], ['管弦', 'orchestral'], ['电子', 'electronic'],
    ['爵士', 'jazz'], ['摇滚', 'rock'], ['钢琴', 'piano'], ['吉他', 'guitar'], ['小提琴', 'violin'], ['大提琴', 'cello'], ['鼓', 'drums'], ['笛子', 'flute'],
    ['长笛', 'flute'], ['竖琴', 'harp'], ['古筝', 'guzheng'], ['二胡', 'erhu'], ['琵琶', 'pipa'], ['合成器', 'synth'], ['贝斯', 'bass'], ['小号', 'trumpet'],
    ['森林', 'forest'], ['雨', 'rain'], ['雷', 'thunder'], ['风', 'wind'], ['海浪', 'ocean waves'], ['海', 'sea'], ['火', 'fire'], ['水', 'water'],
    ['洞穴', 'cave'], ['城堡', 'castle'], ['村庄', 'village'], ['城市', 'city'], ['太空', 'space'], ['沙漠', 'desert'], ['雪', 'snow'], ['夜晚', 'night'],
    ['清晨', 'morning'], ['机器人', 'robot'], ['怪物', 'monster'], ['龙', 'dragon'], ['剑', 'sword'], ['枪', 'gun'], ['激光', 'laser'], ['爆炸', 'explosion'],
    ['跳跃', 'jump'], ['金币', 'coin'], ['宝箱', 'treasure chest'], ['门', 'door'], ['脚步', 'footsteps'], ['魔法', 'magic'], ['升级', 'level up'],
    ['胜利', 'victory'], ['失败', 'defeat'], ['战斗', 'battle'], ['首领', 'boss'], ['冒险', 'adventure'], ['探索', 'exploration'], ['关卡', 'level'],
    ['商店', 'shop'], ['标题', 'title screen'], ['菜单', 'menu'], ['按钮', 'button'], ['点击', 'click'], ['提示', 'notification'], ['警报', 'alarm'],
    ['心跳', 'heartbeat'], ['鸟叫', 'birds chirping'], ['猫', 'cat'], ['狗', 'dog'], ['马', 'horse'], ['汽车', 'car'], ['飞机', 'airplane'],
    ['神秘', 'mysterious'], ['欢快', 'cheerful'], ['紧张', 'tense'], ['悲伤', 'sad'], ['温暖', 'warm'], ['轻松', 'relaxed'], ['治愈', 'soothing'],
    ['热血', 'heroic'], ['梦幻', 'dreamy'], ['搞怪', 'quirky'], ['恢弘', 'grand'], ['平静', 'calm'], ['快', 'fast'], ['慢', 'slow'], ['安静', 'quiet'],
    ['响亮', 'loud'], ['低沉', 'deep'], ['清脆', 'crisp'], ['金属', 'metal'], ['木头', 'wood'], ['玻璃', 'glass'], ['石头', 'stone'], ['笑', 'laugh'],
    ['哭', 'cry'], ['呼吸', 'breathing'], ['游戏', 'game'], ['音效', 'sound effect'], ['音乐', 'music']
  ].sort((a, b) => b[0].length - a[0].length);

  function translate(text) {
    let out = String(text || '').replace(/\s+/g, ' ').trim();
    if (!/[㐀-鿿]/.test(out)) return out;
    for (const [zh, en] of ZH) out = out.split(zh).join(' ' + en + ' ');
    return out.replace(/[，、]/g, ', ').replace(/。/g, '. ').replace(/\s+/g, ' ').replace(/\s+([,.])/g, '$1').trim();
  }

  // ---- state -----------------------------------------------------------------
  const state = {
    active: false,
    demoted: null,            // the React rail button whose pressed look was taken away
    results: [],              // {id, kind, name, caption, prompt, seconds, blob, buffer, url, task}
    running: new Map(),       // task id -> {card, cancelled}
    music: { style: 'auto', moods: new Set(), bpm: 100, seconds: 30, loop: true, text: '' },
    sfx: { category: 'auto', style: 'any', seconds: 2, count: 1, text: '' },
    maskTarget: null,
    open: 'music',
    counter: { music: 0, sfx: 0 },
    player: null
  };

  // ---- rail cell -------------------------------------------------------------
  function findToolsCell() {
    const entry = document.querySelector('[data-novaflow-primary-entry="1"][data-novaflow-primary-label="工具"]');
    if (!(entry instanceof HTMLElement)) return null;
    const cell = entry.closest('[data-novaflow-primary-cell="1"]');
    return cell instanceof HTMLElement ? cell : entry;
  }

  function ensureCell() {
    const tools = findToolsCell();
    if (!tools) return;
    const rect = tools.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;
    let cell = document.getElementById(CELL_ID);
    if (!cell) {
      cell = document.createElement('div');
      cell.id = CELL_ID;
      // Not data-novaflow-primary-cell: that attribute invites the brand
      // runtime's own cell rules (padding, widths) on top of these.
      cell.setAttribute('data-novaflow-primary-extra-cell', '1');
      cell.setAttribute('data-novaflow-runtime-ignore', '1');
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('data-novaflow-audio-entry', '1');
      button.setAttribute('data-novaflow-primary-label', LABEL);
      button.setAttribute('aria-label', LABEL);
      button.setAttribute('aria-pressed', 'false');
      button.title = LABEL;
      button.style.setProperty('--nf-rail-icon', ICON);
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
        button.addEventListener(type, (event) => { event.stopPropagation(); }, true);
      }
      button.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); activate(); }, true);
      cell.appendChild(button);
      document.body.appendChild(cell);
    }
    const top = Math.round(rect.top + RAIL_PITCH);
    const style = cell.style;
    const want = { left: Math.round(rect.left) + 'px', top: top + 'px', width: Math.round(rect.width) + 'px', height: Math.round(rect.height) + 'px' };
    for (const key of Object.keys(want)) if (style.getPropertyValue(key) !== want[key]) style.setProperty(key, want[key], 'important');
    // The entries live inside the rail's stacking context; a body-level cell
    // needs the rail's own z-index to sit at the same depth.
    const rail = tools.closest('[data-novaflow-primary-rail]');
    const zIndex = (rail && getComputedStyle(rail).zIndex !== 'auto' ? getComputedStyle(rail).zIndex : '') || getComputedStyle(tools).zIndex;
    if (zIndex && zIndex !== 'auto' && style.zIndex !== zIndex) style.setProperty('z-index', zIndex, 'important');
    const radius = getComputedStyle(tools).borderRadius;
    if (radius && style.borderRadius !== radius) style.setProperty('border-radius', radius, 'important');
  }

  function pressedRailEntry() {
    return Array.from(document.querySelectorAll('[data-novaflow-primary-entry="1"]'))
      .find((node) => node instanceof HTMLElement && node.getAttribute('aria-pressed') === 'true') || null;
  }

  // ---- activation --------------------------------------------------------------
  // The React tab stays where it was (there is no fifth tab to switch to), so
  // the brand runtime keeps painting that entry as pressed. A cosmetic mask the
  // size of the cell covers it with the idle look while 音频 is open; a click
  // on the mask hands the full pointer sequence to the entry underneath, which
  // is what switches a section (a bare click() does nothing there).
  const MASK_ID = 'novaflow-primary-audio-mask';
  function railBackground(reference) {
    const rect = reference.getBoundingClientRect();
    const x = rect.left + rect.width / 2, y = rect.bottom + 2;
    for (const node of document.elementsFromPoint(x, y)) {
      if (node === reference || node.id === MASK_ID) continue;
      const color = getComputedStyle(node).backgroundColor;
      if (color && color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') return color;
    }
    return '#161616';
  }

  function syncMask() {
    const pressed = state.active ? pressedRailEntry() : null;
    let mask = document.getElementById(MASK_ID);
    if (!pressed) { if (mask) mask.remove(); return; }
    const host = pressed.closest('[data-novaflow-primary-cell="1"]') || pressed;
    const rect = host.getBoundingClientRect();
    if (!mask) {
      mask = document.createElement('button');
      mask.id = MASK_ID;
      mask.type = 'button';
      mask.setAttribute('data-novaflow-runtime-ignore', '1');
      mask.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const target = state.maskTarget;
        state.demoted = null;
        deactivate();
        if (!(target instanceof HTMLElement) || !target.isConnected) return;
        const r = target.getBoundingClientRect();
        const init = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true };
        for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
          target.dispatchEvent(type.startsWith('pointer') && window.PointerEvent ? new PointerEvent(type, init) : new MouseEvent(type, init));
        }
      });
      document.body.appendChild(mask);
    }
    state.maskTarget = pressed;
    mask.setAttribute('data-novaflow-primary-label', pressed.getAttribute('data-novaflow-primary-label') || '');
    mask.setAttribute('aria-label', pressed.getAttribute('aria-label') || '');
    const icon = getComputedStyle(pressed).getPropertyValue('--nf-rail-icon');
    if (icon) mask.style.setProperty('--nf-rail-icon', icon);
    // The entries sit inside the rail's own stacking context: the mask has to
    // clear the rail, not the entry.
    const rail = pressed.closest('[data-novaflow-primary-rail]');
    const railZ = rail ? Number(getComputedStyle(rail).zIndex) : NaN;
    const hostZ = Number(getComputedStyle(host).zIndex);
    const zIndex = Math.min(2147483646, Math.max(Number.isFinite(railZ) ? railZ : 0, Number.isFinite(hostZ) ? hostZ : 0, 90000) + 1);
    const want = {
      left: Math.round(rect.left) + 'px', top: Math.round(rect.top) + 'px', width: Math.round(rect.width) + 'px', height: Math.round(rect.height) + 'px',
      'border-radius': getComputedStyle(host).borderRadius, 'z-index': String(zIndex), background: railBackground(host)
    };
    for (const key of Object.keys(want)) if (mask.style.getPropertyValue(key) !== want[key]) mask.style.setProperty(key, want[key], 'important');
  }

  function activate() {
    if (state.active) return;
    state.active = true;
    document.body.classList.add(BODY_CLASS);
    const cell = document.getElementById(CELL_ID);
    if (cell) { cell.setAttribute('data-novaflow-primary-cell-active', '1'); cell.querySelector('button')?.setAttribute('aria-pressed', 'true'); }
    mount();
    layout();
    syncMask();
    refreshCapabilities();
  }

  function deactivate() {
    if (!state.active) return;
    state.active = false;
    document.body.classList.remove(BODY_CLASS);
    const cell = document.getElementById(CELL_ID);
    if (cell) { cell.setAttribute('data-novaflow-primary-cell-active', '0'); cell.querySelector('button')?.setAttribute('aria-pressed', 'false'); }
    const root = document.getElementById(ROOT_ID);
    if (root) root.hidden = true;
    stopPlayback();
    syncMask();
    state.maskTarget = null;
  }

  document.addEventListener('click', (event) => {
    if (!state.active) return;
    const target = event.target instanceof Element ? event.target : null;
    const entry = target ? target.closest('[data-novaflow-primary-entry="1"]') : null;
    if (entry instanceof HTMLElement) deactivate();
  }, true);

  // ---- workspace --------------------------------------------------------------
  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${CELL_ID}{position:fixed;display:block;overflow:hidden;background:var(--nf-rail-entry-bg,transparent);box-sizing:border-box}
      #${CELL_ID} button{-webkit-appearance:none;appearance:none;width:100%;height:100%;min-width:0;border:0;border-radius:inherit;box-shadow:none;outline:0;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:0 6px;margin:0;font-size:11px;font-weight:500;line-height:1.2;color:#9c9c9c;background:transparent;cursor:pointer;font-family:inherit}
      #${CELL_ID} button::before{content:"";display:block;flex:0 0 auto;width:19px;height:19px;background-color:currentColor;-webkit-mask:var(--nf-rail-icon) center / contain no-repeat;mask:var(--nf-rail-icon) center / contain no-repeat}
      #${CELL_ID} button::after{content:attr(data-novaflow-primary-label);display:block;white-space:nowrap}
      #${CELL_ID}[data-novaflow-primary-cell-active="0"] button:hover{background:#373737;color:#ffffff}
      #${CELL_ID}[data-novaflow-primary-cell-active="1"]{background:#1b4035;box-shadow:inset 0 0 0 1px #306553}
      #${CELL_ID}[data-novaflow-primary-cell-active="1"] button{color:#8cdec3}
      #${MASK_ID}{position:fixed;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;margin:0;padding:0 6px;border:0;outline:0;box-shadow:none;color:#9c9c9c;font-size:11px;font-weight:500;line-height:1.2;cursor:pointer;font-family:inherit;box-sizing:border-box}
      #${MASK_ID}::before{content:"";display:block;width:19px;height:19px;background-color:currentColor;-webkit-mask:var(--nf-rail-icon) center / contain no-repeat;mask:var(--nf-rail-icon) center / contain no-repeat}
      #${MASK_ID}::after{content:attr(data-novaflow-primary-label);display:block;white-space:nowrap}
      #${MASK_ID}:hover{background:#373737!important;color:#ffffff}
      #${ROOT_ID}{position:fixed;z-index:130;display:grid;grid-template-columns:${PANEL_WIDTH}px minmax(0,1fr);column-gap:var(--nf-audio-gap,10px);color:#e8eaed;font-size:12px;font-weight:400;box-sizing:border-box}
      #${ROOT_ID}[hidden]{display:none!important}
      #${ROOT_ID} *{box-sizing:border-box;font-family:inherit}
      #${ROOT_ID} button{font:inherit;cursor:pointer;outline:0}
      #${ROOT_ID} button:focus,#${ROOT_ID} textarea:focus,#${ROOT_ID} input:focus{outline:0;box-shadow:none}
      .nf-audio-panel{min-height:0;display:flex;flex-direction:column;background:#161616;border:1px solid #2e2e2e;border-radius:11px;overflow:hidden auto;padding:6px 0 10px}
      .nf-audio-card{border-bottom:1px solid #272727}
      .nf-audio-head{display:flex;align-items:center;gap:8px;width:100%;height:46px;padding:0 7px;border:0;background:transparent;color:#e8eaed;font-size:12px;font-weight:500;text-align:left}
      .nf-audio-head:hover{background:#222222}
      .nf-audio-head .nf-audio-plate{width:24px;height:24px;display:grid;place-items:center;border-radius:5px;background:#292929;color:#cfcfcf;font-size:12px}
      .nf-audio-head .nf-audio-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .nf-audio-head .nf-audio-chev{width:12px;opacity:.7;font-size:12px;transition:none}
      .nf-audio-card[data-open="1"] .nf-audio-chev{transform:rotate(90deg)}
      .nf-audio-body{display:none;padding:5px 7px 17px;gap:9px;flex-direction:column}
      .nf-audio-card[data-open="1"] .nf-audio-body{display:flex}
      .nf-audio-label{font-size:11px;color:#9aa0a6;margin:2px 0 -3px}
      .nf-audio-text{width:100%;min-height:54px;resize:vertical;border:1px solid #303338;border-radius:6px;background:#1f1f1f;color:#e8eaed;font-size:12px;line-height:1.5;padding:7px 8px}
      .nf-audio-text::placeholder{color:#6e6e6e}
      .nf-audio-chips{display:flex;flex-wrap:wrap;gap:5px}
      .nf-audio-chip{height:24px;padding:0 9px;border:1px solid #303338;border-radius:6px;background:#1f1f1f;color:#c9c9c9;font-size:11px;line-height:22px;white-space:nowrap}
      .nf-audio-chip:hover{background:#2a2a2a;color:#fff}
      .nf-audio-chip[aria-pressed="true"]{background:#1C4136;border-color:#29594A;color:#6FD9B8}
      .nf-audio-row{display:flex;align-items:center;gap:8px;font-size:11px;color:#c9c9c9}
      .nf-audio-row input[type=number]{width:64px;height:26px;border:1px solid #303338;border-radius:6px;background:#1f1f1f;color:#e8eaed;font-size:12px;padding:0 6px;text-align:center}
      .nf-audio-row input[type=number]::-webkit-inner-spin-button{opacity:.5}
      .nf-audio-switch{margin-left:auto;width:34px;height:18px;border-radius:9px;border:0;background:#3a3a3a;position:relative;padding:0}
      .nf-audio-switch::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#ddd;transition:none}
      .nf-audio-switch[aria-checked="true"]{background:#1EA672}.nf-audio-switch[aria-checked="true"]::after{left:18px;background:#fff}
      .nf-audio-go{width:100%;height:36px;border:0;border-radius:8px;background:#1EA672;color:#effcf5;font-size:13px;font-weight:500}
      .nf-audio-go:hover{background:#22B87F}.nf-audio-go:disabled{opacity:.45;cursor:default}
      .nf-audio-note{font-size:11px;line-height:1.6;color:#8b8b8b}
      .nf-audio-stage{min-width:0;min-height:0;display:grid;grid-template-rows:44px minmax(0,1fr);background:#111111;border-radius:11px;overflow:hidden}
      .nf-audio-stage-head{display:flex;align-items:center;gap:12px;padding:0 16px;border-bottom:1px solid #222}
      .nf-audio-stage-head h2{margin:0;font-size:13px;font-weight:500;color:#e8eaed}
      .nf-audio-stage-head span{font-size:11px;color:#9aa0a6}
      .nf-audio-list{min-height:0;overflow:auto;padding:12px 16px 20px;display:grid;align-content:start;gap:10px}
      .nf-audio-empty{height:100%;min-height:240px;display:grid;place-items:center;text-align:center;color:#777;font-size:12px;line-height:1.9}
      .nf-audio-item{display:grid;grid-template-columns:40px minmax(0,1fr);column-gap:12px;align-items:center;padding:10px 12px;border-radius:9px;background:#181818;border:1px solid #242424}
      .nf-audio-item[data-kind="music"]{border-left:3px solid #1EA672}.nf-audio-item[data-kind="sfx"]{border-left:3px solid #5b8def}
      .nf-audio-play{width:40px;height:40px;border-radius:50%;border:0;background:#262626;color:#fff;font-size:14px;display:grid;place-items:center}
      .nf-audio-play:hover{background:#333}.nf-audio-play[data-playing="1"]{background:#1EA672}
      .nf-audio-meta{min-width:0;display:grid;gap:4px}
      .nf-audio-name{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:500;color:#f3f3f3}
      .nf-audio-name small{font-size:11px;font-weight:400;color:#9aa0a6}
      .nf-audio-caption{font-size:11px;color:#9aa0a6;line-height:1.5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .nf-audio-wave{display:block;width:100%;height:44px;border-radius:4px;background:#101010}
      .nf-audio-progress{height:4px;border-radius:2px;background:#262626;overflow:hidden}.nf-audio-progress i{display:block;height:100%;width:0;background:#1EA672}
      .nf-audio-actions{display:flex;gap:6px;margin-top:2px}
      .nf-audio-actions button{height:26px;padding:0 10px;border:0;border-radius:6px;background:rgba(255,255,255,.06);color:#d9d9d9;font-size:11px}
      .nf-audio-actions button:hover{background:rgba(255,255,255,.11);color:#fff}
      .nf-audio-actions button.danger:hover{background:#4a2323;color:#ffb4b4}
      .nf-audio-error{font-size:11px;color:#f09595;line-height:1.5;white-space:pre-wrap}
    `;
    document.head.appendChild(style);
  }

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function chips(parent, items, isOn, onPick) {
    const wrap = el('div', 'nf-audio-chips');
    for (const item of items) {
      const chip = el('button', 'nf-audio-chip', item.label);
      chip.type = 'button';
      chip.setAttribute('aria-pressed', isOn(item) ? 'true' : 'false');
      chip.addEventListener('click', () => { onPick(item); refreshChips(wrap, items, isOn); });
      chip._item = item;
      wrap.appendChild(chip);
    }
    parent.appendChild(wrap);
    return wrap;
  }
  function refreshChips(wrap, items, isOn) {
    for (const chip of wrap.children) chip.setAttribute('aria-pressed', isOn(chip._item) ? 'true' : 'false');
  }

  let ui = null;
  function mount() {
    installStyle();
    let root = document.getElementById(ROOT_ID);
    if (root) { root.hidden = false; return; }
    root = el('section');
    root.id = ROOT_ID;
    root.setAttribute('data-novaflow-runtime-ignore', '1');
    root.setAttribute('aria-label', LABEL);

    const panel = el('div', 'nf-audio-panel');
    root.appendChild(panel);
    ui = { root, panel, cards: {} };

    // 背景音乐
    const music = card(panel, 'music', '背景音乐', '♪');
    const musicText = el('textarea', 'nf-audio-text');
    musicText.placeholder = '描述这段音乐的用途和感觉，例如：森林关卡，轻松又带点神秘，竖琴和长笛';
    musicText.rows = 3;
    musicText.addEventListener('input', () => { state.music.text = musicText.value; });
    music.body.appendChild(el('div', 'nf-audio-label', '描述'));
    music.body.appendChild(musicText);
    music.body.appendChild(el('div', 'nf-audio-label', '风格'));
    const bpmInput = el('input');
    bpmInput.type = 'number'; bpmInput.min = '40'; bpmInput.max = '220'; bpmInput.value = String(state.music.bpm);
    bpmInput.addEventListener('change', () => { state.music.bpm = Math.min(220, Math.max(40, Number(bpmInput.value) || 120)); bpmInput.value = String(state.music.bpm); });
    chips(music.body, MUSIC_STYLES.map(([key, label, phrase, bpm]) => ({ key, label, phrase, bpm })),
      (item) => item.key === state.music.style,
      (item) => { state.music.style = item.key; state.music.bpm = item.bpm; bpmInput.value = String(item.bpm); });
    music.body.appendChild(el('div', 'nf-audio-label', '情绪（可多选）'));
    chips(music.body, MOODS.map(([key, label, phrase]) => ({ key, label, phrase })),
      (item) => state.music.moods.has(item.key),
      (item) => { if (state.music.moods.has(item.key)) state.music.moods.delete(item.key); else state.music.moods.add(item.key); });
    const bpmRow = el('div', 'nf-audio-row');
    bpmRow.appendChild(el('span', null, '速度 BPM'));
    bpmRow.appendChild(bpmInput);
    music.body.appendChild(bpmRow);
    music.body.appendChild(el('div', 'nf-audio-label', '时长'));
    chips(music.body, MUSIC_DURATIONS.map((s) => ({ key: s, label: s + ' 秒' })),
      (item) => item.key === state.music.seconds, (item) => { state.music.seconds = item.key; });
    const loopRow = el('div', 'nf-audio-row');
    loopRow.appendChild(el('span', null, '无缝循环'));
    const loopSwitch = el('button', 'nf-audio-switch');
    loopSwitch.type = 'button'; loopSwitch.setAttribute('role', 'switch'); loopSwitch.setAttribute('aria-checked', 'true'); loopSwitch.setAttribute('aria-label', '无缝循环');
    loopSwitch.addEventListener('click', () => { state.music.loop = !state.music.loop; loopSwitch.setAttribute('aria-checked', String(state.music.loop)); });
    loopRow.appendChild(loopSwitch);
    music.body.appendChild(loopRow);
    const musicGo = el('button', 'nf-audio-go', '生成音乐');
    musicGo.type = 'button';
    musicGo.addEventListener('click', () => submitMusic());
    music.body.appendChild(musicGo);
    music.body.appendChild(el('div', 'nf-audio-note', '循环版会按小节裁齐并做无缝接缝，直接可用于关卡背景。'));
    ui.musicGo = musicGo;

    // 音效
    const sfx = card(panel, 'sfx', '音效', '◆');
    const sfxText = el('textarea', 'nf-audio-text');
    sfxText.placeholder = '描述这个音效，例如：打开木门，吱呀一声，有点回音';
    sfxText.rows = 3;
    sfxText.addEventListener('input', () => { state.sfx.text = sfxText.value; });
    sfx.body.appendChild(el('div', 'nf-audio-label', '描述'));
    sfx.body.appendChild(sfxText);
    sfx.body.appendChild(el('div', 'nf-audio-label', '类别'));
    chips(sfx.body, SFX_CATEGORIES.map(([key, label, phrase, seconds]) => ({ key, label, phrase, seconds })),
      (item) => item.key === state.sfx.category,
      (item) => { state.sfx.category = item.key; state.sfx.seconds = item.seconds; refreshChips(sfxDur, sfxDurItems, (d) => d.key === state.sfx.seconds); });
    sfx.body.appendChild(el('div', 'nf-audio-label', '风格'));
    chips(sfx.body, SFX_STYLES.map(([key, label, phrase]) => ({ key, label, phrase })),
      (item) => item.key === state.sfx.style, (item) => { state.sfx.style = item.key; });
    sfx.body.appendChild(el('div', 'nf-audio-label', '时长'));
    const sfxDurItems = SFX_DURATIONS.map((s) => ({ key: s, label: s + ' 秒' }));
    const sfxDur = chips(sfx.body, sfxDurItems, (item) => item.key === state.sfx.seconds, (item) => { state.sfx.seconds = item.key; });
    sfx.body.appendChild(el('div', 'nf-audio-label', '数量'));
    chips(sfx.body, [1, 2, 3, 4].map((n) => ({ key: n, label: n + ' 个' })), (item) => item.key === state.sfx.count, (item) => { state.sfx.count = item.key; });
    const sfxGo = el('button', 'nf-audio-go', '生成音效');
    sfxGo.type = 'button';
    sfxGo.addEventListener('click', () => submitSfx());
    sfx.body.appendChild(sfxGo);
    sfx.body.appendChild(el('div', 'nf-audio-note', '多个会生成不同变体，挑一个最合适的。'));
    ui.sfxGo = sfxGo;

    // stage
    const stage = el('div', 'nf-audio-stage');
    const head = el('div', 'nf-audio-stage-head');
    head.appendChild(el('h2', null, '音频'));
    ui.status = el('span', null, '');
    head.appendChild(ui.status);
    stage.appendChild(head);
    ui.list = el('div', 'nf-audio-list');
    stage.appendChild(ui.list);
    root.appendChild(stage);
    document.body.appendChild(root);
    renderList();
  }

  function card(panel, key, title, glyph) {
    const node = el('div', 'nf-audio-card');
    node.setAttribute('data-open', state.open === key ? '1' : '0');
    const head = el('button', 'nf-audio-head');
    head.type = 'button';
    head.appendChild(el('span', 'nf-audio-plate', glyph));
    head.appendChild(el('span', 'nf-audio-title', title));
    head.appendChild(el('span', 'nf-audio-chev', '›'));
    head.addEventListener('click', () => {
      state.open = state.open === key ? '' : key;
      for (const [k, c] of Object.entries(ui.cards)) c.node.setAttribute('data-open', state.open === k ? '1' : '0');
    });
    const body = el('div', 'nf-audio-body');
    node.appendChild(head); node.appendChild(body);
    panel.appendChild(node);
    ui.cards[key] = { node, body };
    return ui.cards[key];
  }

  function layout() {
    const root = document.getElementById(ROOT_ID);
    if (!root || !state.active) return;
    const column = document.querySelector('[data-novaflow-left-column]');
    let left = 68, stageLeft = 268, panelWidth = PANEL_WIDTH;
    if (column instanceof HTMLElement) {
      const rect = column.getBoundingClientRect();
      const pad = parseFloat(getComputedStyle(column).paddingLeft) || 0;
      left = Math.round(rect.left + pad);
      stageLeft = Math.round(rect.right);
      // The column holds the panel plus the seam to the stage.
      panelWidth = Math.max(160, Math.round(rect.width - pad - PANEL_SEAM));
    }
    const top = PANEL_TOP;
    root.style.left = left + 'px';
    root.style.top = top + 'px';
    root.style.width = Math.max(300, window.innerWidth - left - PANEL_BOTTOM_GAP) + 'px';
    root.style.height = Math.max(200, window.innerHeight - top - PANEL_BOTTOM_GAP) + 'px';
    root.style.gridTemplateColumns = panelWidth + 'px minmax(0,1fr)';
    root.style.setProperty('--nf-audio-gap', Math.max(4, stageLeft - left - panelWidth) + 'px');
    syncMask();
  }

  // ---- capabilities ------------------------------------------------------------
  let capabilityNote = '';
  async function refreshCapabilities() {
    const runtime = window.NovaFlowWebRuntime;
    if (!runtime || typeof runtime.control !== 'function') { capabilityNote = '网页运行时未就绪'; tell(); return; }
    try {
      const caps = await runtime.control('GET', '/api/web/capabilities');
      const types = Array.isArray(caps?.taskTypes) ? caps.taskTypes : [];
      const music = types.find((t) => t.task_type === 'audio_music');
      const sfx = types.find((t) => t.task_type === 'audio_sfx');
      const ok = (t) => t && Number(t.available_workers) > 0;
      if (ui) { ui.musicGo.disabled = !ok(music); ui.sfxGo.disabled = !ok(sfx); }
      capabilityNote = ok(music) && ok(sfx) ? '' : '本机算力节点还没有音频模型';
    } catch (error) {
      capabilityNote = '无法读取算力状态：' + String(error?.message || error);
    }
    tell();
  }

  function tell() {
    if (!ui) return;
    const running = state.running.size;
    ui.status.textContent = capabilityNote || (running ? running + ' 个任务生成中' : state.results.length ? state.results.length + ' 个结果' : '本机生成，结果自动存入仓库');
  }

  // ---- captions ------------------------------------------------------------------
  function musicCaption() {
    const style = MUSIC_STYLES.find((s) => s[0] === state.music.style) || MUSIC_STYLES[0];
    const moods = MOODS.filter((m) => state.music.moods.has(m[0])).map((m) => m[2]);
    const text = translate(state.music.text);
    const parts = [];
    if (text) parts.push(text + (style[2] ? '' : ' game background music'));
    if (style[2]) parts.push(style[2]);
    if (!parts.length) parts.push('Game background music');
    if (moods.length) parts.push('creating a ' + moods.join(', ') + ' feel');
    parts.push('instrumental, steady tempo, consistent groove throughout');
    if (state.music.loop) parts.push('no intro, no outro, seamless loop');
    return parts.join(', ') + '. BPM: ' + state.music.bpm;
  }

  function sfxCaption() {
    const cat = SFX_CATEGORIES.find((c) => c[0] === state.sfx.category) || SFX_CATEGORIES[0];
    const style = SFX_STYLES.find((s) => s[0] === state.sfx.style) || SFX_STYLES[0];
    const text = translate(state.sfx.text);
    const parts = [];
    if (text) parts.push(text);
    if (cat[2]) parts.push(cat[2]);
    if (!parts.length) parts.push('Short game sound effect');
    if (style[2]) parts.push(style[2]);
    parts.push('game sound effect, clean, no music');
    return parts.join(', ');
  }

  // ---- tasks ----------------------------------------------------------------------
  function describeMusic() {
    const style = MUSIC_STYLES.find((s) => s[0] === state.music.style);
    const moods = MOODS.filter((m) => state.music.moods.has(m[0])).map((m) => m[1]);
    return [style ? style[1] : '', moods.join('·'), state.music.bpm + ' BPM', state.music.seconds + ' 秒', state.music.loop ? '循环' : '', state.music.text.trim()].filter(Boolean).join(' · ');
  }
  function describeSfx() {
    const cat = SFX_CATEGORIES.find((c) => c[0] === state.sfx.category);
    const style = SFX_STYLES.find((s) => s[0] === state.sfx.style);
    return [cat ? cat[1] : '', style && style[2] ? style[1] : '', state.sfx.seconds + ' 秒', state.sfx.text.trim()].filter(Boolean).join(' · ');
  }

  async function submitMusic() {
    await submit('audio_music', 'music', describeMusic(), {
      prompt: musicCaption(),
      duration_seconds: state.music.seconds,
      bpm: state.music.bpm,
      loop: state.music.loop,
      crossfade_ms: 800
    });
  }

  async function submitSfx() {
    const count = state.sfx.count;
    const label = describeSfx();
    const parameters = { prompt: sfxCaption(), duration_seconds: state.sfx.seconds };
    for (let i = 0; i < count; i += 1) await submit('audio_sfx', 'sfx', label, parameters, { silentQueue: i > 0 });
  }

  async function submit(taskType, kind, label, parameters) {
    const runtime = window.NovaFlowWebRuntime;
    if (!runtime) return;
    const card = pendingCard(kind, label);
    ui.list.prepend(card.node);
    removeEmpty();
    let task;
    try {
      const created = await runtime.control('POST', '/api/web/tasks', { task_type: taskType, parameters });
      task = created?.task;
      if (!task?.id) throw new Error('任务未创建');
    } catch (error) {
      card.fail(String(error?.message || error));
      return;
    }
    const entry = { card, cancelled: false };
    state.running.set(task.id, entry);
    card.onCancel(async () => {
      entry.cancelled = true;
      try { await runtime.control('POST', '/api/web/tasks/' + task.id + '/cancel'); } catch { /* already finished */ }
      card.node.remove();
      state.running.delete(task.id);
      tell();
      if (!ui.list.children.length) renderList();
    });
    tell();
    try {
      const finished = await waitForTask(runtime, task.id, (t) => card.progress(t));
      if (entry.cancelled) return;
      if (finished.status !== 'completed') throw new Error(finished.error_message || ('任务' + finished.status));
      const files = (finished.output_manifest?.files || []).filter((f) => /\.(wav|flac|mp3|ogg)$/i.test(f.name));
      if (!files.length) throw new Error('没有产出音频文件');
      const bytes = await runtime.fetchTaskOutput(finished, files[0].name);
      const blob = new Blob([bytes], { type: 'audio/wav' });
      await completed(card, kind, label, parameters.prompt, files[0], blob, finished);
    } catch (error) {
      if (!entry.cancelled) card.fail(String(error?.message || error));
    } finally {
      state.running.delete(task.id);
      tell();
    }
  }

  async function waitForTask(runtime, id, onTick) {
    const started = Date.now();
    for (;;) {
      await new Promise((r) => setTimeout(r, 1000));
      const { task } = await runtime.control('GET', '/api/web/tasks/' + id);
      if (!task) throw new Error('任务不存在');
      onTick(task);
      if (['completed', 'failed', 'cancelled', 'expired'].includes(task.status)) return task;
      if (Date.now() - started > 15 * 60 * 1000) throw new Error('任务超时');
    }
  }

  function pendingCard(kind, label) {
    const node = el('div', 'nf-audio-item');
    node.setAttribute('data-kind', kind);
    const play = el('button', 'nf-audio-play', '…');
    play.type = 'button'; play.disabled = true;
    node.appendChild(play);
    const meta = el('div', 'nf-audio-meta');
    const name = el('div', 'nf-audio-name', kind === 'music' ? '音乐 生成中' : '音效 生成中');
    const caption = el('div', 'nf-audio-caption', label);
    const progress = el('div', 'nf-audio-progress');
    const bar = el('i');
    progress.appendChild(bar);
    const actions = el('div', 'nf-audio-actions');
    const cancel = el('button', null, '任务中止');
    cancel.type = 'button'; cancel.className = 'danger';
    actions.appendChild(cancel);
    meta.appendChild(name); meta.appendChild(caption); meta.appendChild(progress); meta.appendChild(actions);
    node.appendChild(meta);
    return {
      node,
      progress(task) {
        const pct = Math.max(2, Math.min(99, Number(task.progress) || 0));
        bar.style.width = pct + '%';
        name.textContent = (kind === 'music' ? '音乐' : '音效') + ' 生成中 ' + Math.round(pct) + '%';
      },
      fail(message) {
        name.textContent = (kind === 'music' ? '音乐' : '音效') + ' 失败';
        progress.remove();
        const error = el('div', 'nf-audio-error', message);
        meta.insertBefore(error, actions);
        cancel.textContent = '移除';
        cancel.onclick = () => { node.remove(); if (!ui.list.children.length) renderList(); };
      },
      onCancel(fn) { cancel.onclick = fn; }
    };
  }

  async function completed(card, kind, label, prompt, file, blob, task) {
    state.counter[kind] += 1;
    const serial = String(state.counter[kind]).padStart(3, '0');
    const name = (kind === 'music' ? 'Music_' : 'Sfx_') + serial + '.wav';
    const buffer = await decode(blob);
    const result = {
      id: task.id, kind, name, label, caption: String(file.caption || ''), prompt,
      seconds: buffer ? buffer.duration : Number(file.duration_seconds) || 0,
      blob, buffer, url: URL.createObjectURL(blob), task
    };
    state.results.unshift(result);
    const node = resultCard(result);
    card.node.replaceWith(node);
    try { await window.NovaFlowWebWarehouse?.save?.({ blob, name }); } catch { /* the warehouse reports its own state */ }
  }

  function resultCard(result) {
    const node = el('div', 'nf-audio-item');
    node.setAttribute('data-kind', result.kind);
    node.setAttribute('data-result-id', result.id);
    const play = el('button', 'nf-audio-play', '▶');
    play.type = 'button'; play.setAttribute('aria-label', '播放');
    play.addEventListener('click', () => togglePlay(result, play));
    node.appendChild(play);
    const meta = el('div', 'nf-audio-meta');
    const name = el('div', 'nf-audio-name');
    name.appendChild(el('span', null, (result.kind === 'music' ? '音乐 ' : '音效 ') + result.name.replace(/^\w+_/, '').replace(/\.wav$/, '')));
    name.appendChild(el('small', null, formatSeconds(result.seconds) + (result.kind === 'music' && result.task?.parameters?.loop !== false ? ' · 无缝循环' : '')));
    meta.appendChild(name);
    const caption = el('div', 'nf-audio-caption', result.label);
    caption.title = result.caption || result.prompt || '';
    meta.appendChild(caption);
    const wave = el('canvas', 'nf-audio-wave');
    meta.appendChild(wave);
    const actions = el('div', 'nf-audio-actions');
    const download = el('button', null, '下载 WAV');
    download.type = 'button';
    download.addEventListener('click', () => {
      const link = document.createElement('a');
      link.href = result.url; link.download = result.name; document.body.appendChild(link); link.click(); link.remove();
    });
    const again = el('button', null, '再来一个');
    again.type = 'button';
    again.addEventListener('click', () => {
      if (result.kind === 'music') submit('audio_music', 'music', result.label, { ...result.task.parameters, seed: -1 });
      else submit('audio_sfx', 'sfx', result.label, { ...result.task.parameters, seed: -1 });
    });
    const remove = el('button', 'danger', '删除');
    remove.type = 'button';
    remove.addEventListener('click', () => {
      if (state.player?.result === result) stopPlayback();
      state.results = state.results.filter((r) => r !== result);
      URL.revokeObjectURL(result.url);
      node.remove();
      if (!ui.list.children.length) renderList();
      tell();
    });
    actions.appendChild(download); actions.appendChild(again); actions.appendChild(remove);
    meta.appendChild(actions);
    node.appendChild(meta);
    requestAnimationFrame(() => drawWave(wave, result.buffer));
    return node;
  }

  function renderList() {
    if (!ui) return;
    ui.list.replaceChildren();
    if (!state.results.length && !state.running.size) {
      const empty = el('div', 'nf-audio-empty');
      empty.innerHTML = '<div>还没有音频<br><span style="color:#5f5f5f">左侧选择「背景音乐」或「音效」，描述后点生成</span></div>';
      ui.list.appendChild(empty);
      return;
    }
    for (const result of state.results) ui.list.appendChild(resultCard(result));
  }
  function removeEmpty() { ui.list.querySelector('.nf-audio-empty')?.remove(); }

  function formatSeconds(seconds) {
    const s = Number(seconds) || 0;
    return s >= 10 ? Math.round(s) + ' 秒' : (Math.round(s * 10) / 10) + ' 秒';
  }

  // ---- playback: Web Audio, so a loop plays gapless and the seam is audible ----
  let context = null;
  function audioContext() {
    if (!context) context = new (window.AudioContext || window.webkitAudioContext)();
    return context;
  }
  async function decode(blob) {
    try { return await audioContext().decodeAudioData(await blob.arrayBuffer()); } catch { return null; }
  }
  function togglePlay(result, button) {
    if (state.player?.result === result) { stopPlayback(); return; }
    stopPlayback();
    if (!result.buffer) return;
    const ctx = audioContext();
    if (ctx.state === 'suspended') ctx.resume();
    const source = ctx.createBufferSource();
    source.buffer = result.buffer;
    source.loop = result.kind === 'music' && result.task?.parameters?.loop !== false;
    source.connect(ctx.destination);
    source.onended = () => { if (state.player?.source === source) { state.player = null; button.textContent = '▶'; button.removeAttribute('data-playing'); } };
    source.start();
    state.player = { result, source, button };
    button.textContent = '❚❚';
    button.setAttribute('data-playing', '1');
  }
  function stopPlayback() {
    const player = state.player;
    if (!player) return;
    state.player = null;
    try { player.source.stop(); } catch { /* already stopped */ }
    player.button.textContent = '▶';
    player.button.removeAttribute('data-playing');
  }

  function drawWave(canvas, buffer) {
    const width = canvas.clientWidth || 400, height = canvas.clientHeight || 44;
    canvas.width = width * (window.devicePixelRatio || 1);
    canvas.height = height * (window.devicePixelRatio || 1);
    const ctx = canvas.getContext('2d');
    ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
    ctx.fillStyle = '#101010'; ctx.fillRect(0, 0, width, height);
    if (!buffer) return;
    const data = buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / width));
    ctx.fillStyle = '#1EA672';
    for (let x = 0; x < width; x += 1) {
      let peak = 0;
      const start = x * step;
      for (let i = 0; i < step && start + i < data.length; i += 4) { const v = Math.abs(data[start + i]); if (v > peak) peak = v; }
      const h = Math.max(1, peak * (height - 4));
      ctx.fillRect(x, (height - h) / 2, 1, h);
    }
  }

  // ---- keep the cell and the workspace in place ----------------------------------
  let railTimer = 0;
  function tick() {
    ensureCell();
    if (state.active) layout();
  }
  function start() {
    if (railTimer) return;
    installStyle();
    tick();
    railTimer = window.setInterval(tick, 1000);
    window.addEventListener('resize', tick);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.NovaFlowAudioStudio = {
    open: activate, close: deactivate,
    isOpen: () => state.active,
    results: () => state.results.slice(),
    captions: { music: musicCaption, sfx: sfxCaption, translate }
  };
})();
