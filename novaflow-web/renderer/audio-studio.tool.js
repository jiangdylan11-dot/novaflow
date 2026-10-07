// 音频 - a rail entry of its own under 动画: game background music loops and
// sound effects, generated on the local compute node, arranged on a timeline.
//
// The React bundle knows four sections and cannot be rebuilt, so this is an
// overlay that takes the 动画 section's skeleton: the left card (mode toggle +
// accordion rows), the stage with a top bar, a generation dock and a
// transport bar at its foot, and the resource list on the right. The page
// only ever sends a task type and business parameters; the graph lives on
// the worker.
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.NovaFlowAudioStudio) return;

  const LABEL = '音频';
  const CELL_ID = 'novaflow-primary-audio-cell';
  const MASK_ID = 'novaflow-primary-audio-mask';
  const ROOT_ID = 'novaflow-audio-studio';
  const STYLE_ID = 'novaflow-audio-studio-style';
  const BODY_CLASS = 'novaflow-primary-target-audio';
  const RAIL_AFTER = '动画';            // the entry the audio cell sits under
  const RAIL_PITCH = 70;               // PRIMARY_RAIL_ITEM_PITCH in the brand runtime
  const STAGE_TOP = 62;                // TOPBAR_HEIGHT + PRIMARY_PANEL_TOP_GAP
  const EDGE_GAP = 10;
  const SIDEBAR_W = 206;
  const TRANSPORT_H = 97;
  const DOCK_H = 213;
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
    ['auto', '按描述', ''], ['happy', '欢快', 'upbeat and cheerful'], ['heroic', '热血', 'heroic and energetic'], ['warm', '温暖', 'warm and cozy'],
    ['mystery', '神秘', 'mysterious and curious'], ['tense', '紧张', 'tense and suspenseful'], ['sad', '悲伤', 'melancholic and sad'],
    ['dreamy', '梦幻', 'dreamy and ethereal'], ['quirky', '搞怪', 'quirky and comedic'], ['grand', '恢弘', 'grand and epic'],
    ['calm', '平静', 'calm and peaceful']
  ];
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
    mode: 'music',                      // 'music' | 'sfx'
    open: 'generate',                   // which left row is expanded
    music: { style: 'auto', mood: 'auto', bpm: 100, seconds: 30, loop: true, text: '', rewrite: true },
    sfx: { category: 'auto', style: 'any', seconds: 2, count: 1, text: '', rewrite: true },
    resources: [],                      // {id, kind, name, buffer, blob, url, seconds, caption, label, task, loopable}
    running: new Map(),                 // task id -> {cancelled}
    counter: { music: 0, sfx: 0, import: 0 },
    boards: [], board: 0,
    maskTarget: null,
    preview: null
  };
  let ui = null;
  let editor = null;

  // ---- rail cell ---------------------------------------------------------------
  function railEntry(label) {
    const entry = document.querySelector('[data-novaflow-primary-entry="1"][data-novaflow-primary-label="' + label + '"]');
    if (!(entry instanceof HTMLElement)) return null;
    const cell = entry.closest('[data-novaflow-primary-cell="1"]');
    return cell instanceof HTMLElement ? cell : entry;
  }

  function ensureCell() {
    const anchor = railEntry(RAIL_AFTER);
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;
    let cell = document.getElementById(CELL_ID);
    if (!cell) {
      cell = document.createElement('div');
      cell.id = CELL_ID;
      // Not data-novaflow-primary-cell: that attribute invites the brand
      // runtime's own cell rules (padding, widths) on top of these. The extra
      // marker is what moves the entries after 动画 down one slot.
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
    const want = { left: Math.round(rect.left) + 'px', top: Math.round(rect.top + RAIL_PITCH) + 'px', width: Math.round(rect.width) + 'px', height: Math.round(rect.height) + 'px' };
    const style = cell.style;
    for (const key of Object.keys(want)) if (style.getPropertyValue(key) !== want[key]) style.setProperty(key, want[key], 'important');
    const rail = anchor.closest('[data-novaflow-primary-rail]');
    const zIndex = (rail && getComputedStyle(rail).zIndex !== 'auto' ? getComputedStyle(rail).zIndex : '') || getComputedStyle(anchor).zIndex;
    if (zIndex && zIndex !== 'auto' && style.zIndex !== zIndex) style.setProperty('z-index', zIndex, 'important');
    const radius = getComputedStyle(anchor).borderRadius;
    if (radius && style.borderRadius !== radius) style.setProperty('border-radius', radius, 'important');
  }

  function pressedRailEntry() {
    return Array.from(document.querySelectorAll('[data-novaflow-primary-entry="1"]'))
      .find((node) => node instanceof HTMLElement && node.getAttribute('aria-pressed') === 'true') || null;
  }

  // The React tab stays where it was (there is no fifth tab), so the brand
  // runtime keeps painting that entry as pressed. A cosmetic mask the size of
  // the cell covers it with the idle look while 音频 is open; a click on the
  // mask hands the full pointer sequence to the entry underneath.
  function railBackground(reference) {
    const rect = reference.getBoundingClientRect();
    for (const node of document.elementsFromPoint(rect.left + rect.width / 2, rect.bottom + 2)) {
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
        event.preventDefault(); event.stopPropagation();
        const target = state.maskTarget;
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

  // ---- activation ----------------------------------------------------------------
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
    editor.layout();
  }
  function deactivate() {
    if (!state.active) return;
    state.active = false;
    document.body.classList.remove(BODY_CLASS);
    const cell = document.getElementById(CELL_ID);
    if (cell) { cell.setAttribute('data-novaflow-primary-cell-active', '0'); cell.querySelector('button')?.setAttribute('aria-pressed', 'false'); }
    const root = document.getElementById(ROOT_ID);
    if (root) root.hidden = true;
    if (editor) editor.pause();
    stopPreview();
    syncMask();
    state.maskTarget = null;
  }
  document.addEventListener('click', (event) => {
    if (!state.active) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target && target.closest('[data-novaflow-primary-entry="1"]')) deactivate();
  }, true);
  // The rail's 导出 is the one export entry for every section. While 音频 is
  // open it renders the timeline mix; an unlicensed install keeps the
  // runtime's own licence prompt.
  document.addEventListener('click', (event) => {
    if (!state.active || !editor) return;
    const target = event.target instanceof Element ? event.target.closest('[data-novaflow-primary-export-entry="1"]') : null;
    if (!(target instanceof HTMLElement) || target.getAttribute('data-novaflow-primary-shortcut-locked') === '1') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    exportMix();
  }, true);

  // ---- styles --------------------------------------------------------------------
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

      #${ROOT_ID}{position:fixed;inset:0;z-index:130;pointer-events:none;color:#e8eaed;font-size:12px;font-weight:400;font-family:inherit}
      #${ROOT_ID}[hidden]{display:none!important}
      #${ROOT_ID} *{box-sizing:border-box;font-family:inherit}
      #${ROOT_ID} button{font-family:inherit;cursor:pointer;outline:0;transition:none}
      #${ROOT_ID} input,#${ROOT_ID} select,#${ROOT_ID} textarea{font-family:inherit}
      #${ROOT_ID} button:focus,#${ROOT_ID} textarea:focus,#${ROOT_ID} input:focus,#${ROOT_ID} select:focus{outline:0;box-shadow:none}
      #${ROOT_ID} > *{pointer-events:auto}
      .nf-as-left,.nf-as-stage,.nf-as-sidebar,.nf-as-dock,.nf-as-transport{position:fixed}
      /* left card: the section panel */
      .nf-as-left{background:#161616;border:1px solid #2e2e2e;border-radius:12px;padding:10px;overflow:hidden auto;display:flex;flex-direction:column;gap:0}
      .nf-as-mode{display:grid;grid-template-columns:1fr 1fr;gap:3px;padding:3px;background:#101010;border:1px solid #262626;border-radius:8px;margin:1px 0 12px}
      .nf-as-mode button{height:29px;border:0;border-radius:5px;background:transparent;color:#eaeaea;font-size:12px;font-weight:500;line-height:normal;padding:0 6px}
      .nf-as-mode button:hover{background:#2a2a2a}
      .nf-as-mode button[aria-pressed="true"]{background:#1c4136;color:#9be4cd;box-shadow:inset 0 0 0 1px #2c604f}
      /* rows: the animation section's collapse headings - icon plate and chevron are pseudo elements */
      .nf-as-rows{display:flex;flex-direction:column;gap:0}
      .nf-as-rows-tools{margin-top:3px;padding:3px 0;border-top:1px solid #272727;border-bottom:1px solid #272727;display:flex;flex-direction:column;gap:5px}
      .nf-as-row-head{position:relative;display:flex;align-items:center;width:100%;height:46px;padding:0 30px 0 40px;border:0;border-radius:7px;background:transparent;color:#d4d4d4;font-size:12px;font-weight:400;line-height:12px;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .nf-as-row[data-key="generate"] .nf-as-row-head{font-weight:500;letter-spacing:.18px;border-radius:6px}
      .nf-as-row-head::before{content:"";position:absolute;left:7px;top:11px;width:24px;height:24px;border-radius:5px;background:#292929 var(--nf-as-row-icon) center / 14px 14px no-repeat}
      .nf-as-row-head::after{content:"";position:absolute;right:12px;top:50%;width:7px;height:7px;border-right:1px solid rgba(238,244,252,.7);border-bottom:1px solid rgba(238,244,252,.7);transform:translateY(-50%) rotate(-45deg)}
      .nf-as-row[data-open="1"] .nf-as-row-head::after{transform:translateY(-70%) rotate(45deg)}
      .nf-as-row-head:hover{background:rgba(255,255,255,.043)}
      .nf-as-row-body{display:none;flex-direction:column;gap:9px;padding:4px 7px 16px}
      .nf-as-row[data-open="1"] .nf-as-row-body{display:flex}
      .nf-as-label{font-size:11px;color:#9f9f9f}
      .nf-as-field{display:flex;flex-direction:column;gap:5px}
      #${ROOT_ID} select,.nf-as-input{height:28px;border:1px solid #343434;border-radius:6px;background:#262626;color:#e9e9e9;font-size:11px;padding:0 8px;width:100%}
      #${ROOT_ID} select{appearance:none;-webkit-appearance:none;padding-right:26px;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%239f9f9f' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 8px center;background-size:12px}
      .nf-as-tools{display:grid;grid-template-columns:1fr 1fr;gap:6px}
      .nf-as-tools button,.nf-as-btn{height:28px;border:1px solid #343434;border-radius:6px;background:#262626;color:#e3e3e3;font-size:11px;padding:0 8px;white-space:nowrap}
      .nf-as-tools button:hover,.nf-as-btn:hover{background:#303030;color:#fff}
      .nf-as-tools button:disabled,.nf-as-btn:disabled{opacity:.45;cursor:default}
      .nf-as-tools button[aria-pressed="true"]{background:#1c4136;border-color:#29594a;color:#9be4cd}
      .nf-as-note{font-size:11px;line-height:1.6;color:#8b8b8b}
      .nf-as-inspector{display:flex;flex-direction:column;gap:7px;padding-top:4px;border-top:1px solid #272727;margin-top:2px}
      .nf-as-slider{display:grid;grid-template-columns:30px minmax(0,1fr) 42px;align-items:center;gap:6px;font-size:11px;color:#a9a9a9;height:24px}
      .nf-as-slider-value{text-align:right;color:#cfcfcf;font-variant-numeric:tabular-nums}
      .nf-as-slider input[type=range]{-webkit-appearance:none;appearance:none;width:100%;height:12px;margin:0;padding:0;border:0;background:linear-gradient(90deg,#20c997 0%,#20c997 var(--nf-range-pct,0%),#303030 var(--nf-range-pct,0%),#303030 100%) center / 100% 2px no-repeat}
      .nf-as-slider input[type=range]::-webkit-slider-runnable-track{height:2px;background:transparent}
      .nf-as-slider input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:12px;height:12px;margin-top:-5px;border-radius:50%;background:#dfe7ee;border:0}
      .nf-as-slider input[type=range]:disabled{opacity:.4}
      .nf-as-slider .nf-as-loop-count{width:100%;text-align:center;padding:0 4px}
      .nf-as-slider .nf-as-loop-count:disabled{opacity:.4}
      /* stage */
      /* opaque: nothing of the section underneath (the particle canvas and its dot grid) may show through */
      .nf-as-stage{background:#242424;border-radius:0;overflow:visible}
      .nf-as-topbar{position:absolute;left:0;top:7px;right:0;height:38px;pointer-events:none}
      .nf-as-topbar > *{pointer-events:auto;position:absolute;top:0}
      .nf-as-project{left:0;display:flex;align-items:center;gap:3px;height:38px;padding:4px;background:#161616;border:1px solid #333;border-radius:9px;box-shadow:0 3px 7px rgba(0,0,0,.133);white-space:nowrap}
      .nf-as-tabs{display:flex;gap:3px}
      .nf-as-project .nf-as-name{width:116px;height:28px;border:1px solid #343434;border-radius:6px;background:#262626;color:#e9e9e9;font-size:11px;padding:0 6px}
      .nf-as-project .nf-as-tab[aria-pressed="false"]{background:#252629;color:#969aa2;border-color:transparent}
      .nf-as-project .nf-as-tab{width:26px;height:28px;padding:4px 10px;display:flex;align-items:center;justify-content:center;border:1px solid #2c604f;border-radius:5px;background:#1c4136;color:#9be4cd;font-size:11px;font-weight:500}
      .nf-as-project .nf-as-tab-add,.nf-as-project .nf-as-tab-del{width:38px;height:28px;padding:4px 10px;display:flex;align-items:center;justify-content:center;border:1px solid transparent;border-radius:5px;background:transparent;color:#a0a0a0;font-size:11px;font-weight:500}
      .nf-as-project .nf-as-tab-add:hover{background:#2a2a2a;color:#fff}
      .nf-as-project .nf-as-tab-del{background:#252629;color:#969aa2}
      .nf-as-project .nf-as-tab-del:hover{background:#4a2323;color:#ffb4b4}
      .nf-as-project input{width:116px;height:28px;border:1px solid #343434;border-radius:6px;background:#262626;color:#e9e9e9;font-size:11px;padding:0 6px}
      .nf-as-zoom{right:0;display:flex;align-items:center;height:38px;padding:4px;gap:3px;margin-right:0;background:#161616;border:1px solid #333;border-radius:9px;box-shadow:0 3px 7px rgba(0,0,0,.133);white-space:nowrap}
      .nf-as-zoom span{min-width:44px;height:28px;display:grid;place-items:center;border-radius:5px;background:#262626;color:#e9e9e9;font-size:11px;padding:0 8px}
      .nf-as-zoom button{height:28px;border:1px solid transparent;border-radius:5px;background:transparent;color:#8a8a8a;font-size:11px;padding:0 10px}
      .nf-as-zoom button:hover{color:#fff;background:#2a2a2a}
      /* the timeline is a card in the same column as the dock and the transport: same edges, same surface */
      .nf-as-timeline{position:absolute;left:0;right:0;top:53px;bottom:8px;border-radius:10px;overflow:hidden;background:#161616;border:1px solid #343434}
      .nf-as-empty{position:absolute;inset:0;display:grid;place-items:center;text-align:center;color:#6f6f6f;font-size:12px;line-height:1.9;pointer-events:none}
      /* timeline editor */
      .nf-tl{position:absolute;inset:0;display:grid;grid-template-columns:132px minmax(0,1fr)}
      .nf-tl-headers{position:relative;background:#161616;border-right:1px solid #2a2a2a;overflow:hidden}
      .nf-tl-headers-top{height:24px;line-height:24px;padding:0 10px;font-size:10px;color:#8d8d8d;background:#161616;border-bottom:1px solid #2a2a2a}
      .nf-tl-header-list{will-change:transform}
      .nf-tl-header{display:flex;flex-direction:column;justify-content:center;gap:5px;padding:0 8px;margin-bottom:4px;border-bottom:1px solid #222}
      .nf-tl-track-name{height:22px;border:1px solid transparent;border-radius:5px;background:transparent;color:#e9e9e9;font-size:11px;font-weight:500;padding:0 5px;width:100%}
      .nf-tl-track-name:hover,.nf-tl-track-name:focus{background:#262626;border-color:#343434}
      .nf-tl-track-btns{display:flex;gap:4px}
      .nf-tl-track-btns button{width:24px;height:20px;border:1px solid #343434;border-radius:5px;background:#262626;color:#bdbdbd;font-size:10px;font-weight:600;padding:0}
      .nf-tl-track-btns button[aria-pressed="true"]{background:#1c4136;border-color:#29594a;color:#9be4cd}
      .nf-tl-track-btns .nf-tl-track-del{margin-left:auto;font-size:13px;font-weight:400}
      .nf-tl-track-btns .nf-tl-track-del:hover{background:#4a2323;color:#ffb4b4}
      .nf-tl-track-gain{-webkit-appearance:none;appearance:none;width:100%;height:10px;background:transparent;margin:0}
      .nf-tl-track-gain::-webkit-slider-runnable-track{height:2px;background:#3a3a3a;border-radius:1px}
      .nf-tl-track-gain::-webkit-slider-thumb{-webkit-appearance:none;width:10px;height:10px;margin-top:-4px;border-radius:50%;background:#dfe7ee;border:0}
      .nf-tl-scroller{position:relative;overflow:auto;background:#1d1d1d}
      .nf-tl-scroller::-webkit-scrollbar{width:8px;height:8px}.nf-tl-scroller::-webkit-scrollbar-thumb{background:#3a3a3a;border-radius:4px}
      .nf-tl-canvas{display:block}
      .nf-tl-playhead{position:absolute;top:0;width:2px;background:#ef4444;pointer-events:none}
      .nf-tl-playhead::before{content:"";position:absolute;left:-4px;top:0;border:5px solid transparent;border-top:8px solid #ef4444}
      /* generation dock */
      .nf-as-dock{background:#161616;border:1px solid #363636;border-radius:12px;padding:13px 14px;display:grid;grid-template-rows:32px 18px minmax(0,1fr);row-gap:11px}
      .nf-as-dock-row{display:flex;align-items:center;gap:10px;height:32px}
      .nf-as-dock-row .nf-as-label{white-space:nowrap;color:#a9a9a9}
      .nf-as-dock-row input[type=number]{width:49px;height:28px;border:1px solid #343434;border-radius:6px;background:#272727;color:#e9e9e9;font-size:11px;padding:0 6px;text-align:center}
      .nf-as-dock-row select{width:auto;min-width:72px}
      .nf-as-switch{width:27px;height:15px;border-radius:15px;border:0;background:#3a3a3a;position:relative;padding:0;flex:none}
      .nf-as-switch::after{content:"";position:absolute;top:3px;left:3px;width:9px;height:9px;border-radius:50%;background:#ddd}
      .nf-as-switch[aria-checked="true"]{background:#1ea672}.nf-as-switch[aria-checked="true"]::after{left:15px;background:#fff}
      .nf-as-go{margin-left:auto;width:104px;height:32px;border:1px solid #24b693;border-radius:7px;background:#1ea672;color:#fff;font-size:12px;font-weight:600;padding:5px 10px}
      .nf-as-go:hover{background:#22b87f}.nf-as-go:disabled{opacity:.45;cursor:default}
      .nf-as-status{display:flex;align-items:center;gap:8px;height:18px;font-size:11px;color:#9f9f9f}
      .nf-as-status .nf-as-pct{color:#cfcfcf}
      .nf-as-status .nf-as-err{color:#f09595;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
      .nf-as-cancel{margin-left:auto;height:18px;border:0;border-radius:7px;background:rgba(239,68,68,.18);color:#ffb4b4;font-size:11px;padding:0 8px}
      .nf-as-cancel[hidden]{display:none}
      .nf-as-prompt{display:grid;grid-template-rows:33px minmax(0,1fr);background:#202020;border:1px solid #353535;border-radius:8px;overflow:hidden;min-height:0}
      .nf-as-prompt-head{display:flex;align-items:center;justify-content:space-between;padding:4px 7px}
      .nf-as-prompt-head .nf-as-chip{height:24px;border:1px solid transparent;border-radius:7px;background:transparent;color:#9f9f9f;font-size:11px;font-weight:500;padding:3px 7px;display:flex;align-items:center;gap:7px}
      .nf-as-prompt-head button.nf-as-chip:hover{color:#fff;background:#2a2a2a}
      .nf-as-prompt-head button.nf-as-chip[aria-pressed="true"]{color:#9be4cd}
      .nf-as-prompt textarea{display:block;width:100%;height:100%;resize:none;border:0;background:#202020;color:#c9c9c9;font-size:12px;line-height:1.5;padding:12px 14px}
      .nf-as-prompt textarea::placeholder{color:#6e6e6e}
      /* transport */
      .nf-as-transport{background:#161616;border:1px solid #343434;border-radius:10px;padding:10px 12px;display:grid;grid-template-rows:30px 34px;row-gap:11px}
      .nf-as-tr-row{display:flex;align-items:center;gap:8px;flex-wrap:nowrap;white-space:nowrap;min-width:0}
      .nf-as-tr-row .nf-as-tbtn{width:30px;height:30px;border:1px solid transparent;border-radius:7px;background:#282828;color:#eaeaea;display:grid;place-items:center;padding:0}
      .nf-as-tr-row .nf-as-tbtn:hover{background:#343434}
      .nf-as-tr-row .nf-as-tbtn[aria-pressed="true"]{background:#193d33;color:#8ee0c5;border-color:#306553}
      .nf-as-tr-row .nf-as-tbtn svg{display:block;width:18px;height:18px}
      .nf-as-time{font-size:11px;color:#cfcfcf;min-width:110px;font-variant-numeric:tabular-nums;margin-left:6px}
      .nf-as-tr-row .nf-as-label{margin-left:10px}
      .nf-as-tr-row input[type=number]{width:49px;height:28px;border:1px solid #343434;border-radius:6px;background:#272727;color:#e9e9e9;font-size:11px;padding:0 6px;text-align:center}
      .nf-as-tr-row label.nf-as-check{display:flex;align-items:center;gap:5px;font-size:11px;color:#bdbdbd}
      .nf-as-tr-row input[type=checkbox]{width:13px;height:13px;accent-color:#1ea672}
      .nf-as-tr-right{margin-left:auto;display:flex;align-items:center;gap:8px}
      .nf-as-tr-right input[type=range]{-webkit-appearance:none;appearance:none;width:124px;height:12px;background:linear-gradient(90deg,#20c997 0%,#20c997 var(--nf-range-pct,0%),#303030 var(--nf-range-pct,0%),#303030 100%) center / 100% 2px no-repeat;margin:0}
      .nf-as-tr-right input[type=range]::-webkit-slider-runnable-track{height:2px;background:transparent}
      .nf-as-tr-right input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:12px;height:12px;margin-top:-5px;border-radius:50%;background:#dfe7ee;border:0}
      .nf-as-overview{position:relative;height:34px;border-radius:6px;background:#1d1d1d;overflow:hidden;cursor:col-resize}
      .nf-as-overview canvas{display:block;width:100%;height:100%}
      /* resource sidebar */
      .nf-as-sidebar{background:#161616;border:1px solid #2e2e2e;border-radius:12px;display:flex;flex-direction:column;overflow:hidden}
      .nf-as-side-head{display:flex;align-items:center;gap:8px;padding:14px 12px;font-size:13px}
      .nf-as-side-head .nf-as-count{color:#9aa0a6;font-size:12px;flex:1}
      .nf-as-side-head button{height:28px;border:1px solid #343434;border-radius:6px;background:#262626;color:#e3e3e3;font-size:11px;padding:0 10px}
      .nf-as-side-head button:hover{background:#303030;color:#fff}
      .nf-as-side-list{flex:1;min-height:0;overflow:auto;padding:0 8px 12px;display:flex;flex-direction:column;gap:6px}
      .nf-as-side-list::-webkit-scrollbar{width:6px}.nf-as-side-list::-webkit-scrollbar-thumb{background:#3a3a3a;border-radius:3px}
      .nf-as-side-empty{flex:1;display:grid;place-items:center;color:#777;font-size:11px}
      .nf-as-res{position:relative;border:1px solid #262626;border-radius:8px;background:#1b1b1b;padding:6px 7px 7px;cursor:grab}
      .nf-as-res:hover{border-color:#3a3a3a;background:#1f1f1f}
      .nf-as-res[data-selected="1"]{border-color:#29594a;background:#172a23}
      .nf-as-res[data-pending="1"]{cursor:default;opacity:.85}
      .nf-as-res canvas{display:block;width:100%;height:34px;border-radius:4px;background:#121212}
      .nf-as-res-name{display:flex;align-items:center;gap:6px;margin-top:5px;font-size:11px;color:#f1f1f1}
      .nf-as-res-name span:first-child{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .nf-as-res-name small{color:#9aa0a6;font-size:10px}
      .nf-as-res-tag{font-size:9px;padding:1px 5px;border-radius:4px;background:#1c4136;color:#9be4cd}
      .nf-as-res-tag[data-kind="sfx"]{background:#1d3660;color:#a9c8ff}.nf-as-res-tag[data-kind="import"]{background:#3f3612;color:#e9cf7a}
      .nf-as-res-actions{display:none;position:absolute;right:5px;top:5px;gap:3px}
      .nf-as-res:hover .nf-as-res-actions{display:flex}
      .nf-as-res-actions button{width:22px;height:22px;border:0;border-radius:5px;background:rgba(0,0,0,.55);color:#fff;font-size:11px;padding:0}
      .nf-as-res-actions button:hover{background:#1ea672}
      .nf-as-res-actions button.danger:hover{background:#b03a3a}
      .nf-as-res-progress{height:3px;border-radius:2px;background:#262626;overflow:hidden;margin-top:6px}
      .nf-as-res-progress i{display:block;height:100%;width:0;background:#1ea672}
    `;
    document.head.appendChild(style);
  }

  // ---- DOM helpers ---------------------------------------------------------------
  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function selectField(parent, label, options, value, onChange) {
    const field = el('div', 'nf-as-field');
    field.appendChild(el('div', 'nf-as-label', label));
    const select = el('select');
    for (const [key, text] of options) { const o = el('option', null, text); o.value = key; select.appendChild(o); }
    select.value = value;
    select.addEventListener('change', () => onChange(select.value));
    field.appendChild(select);
    parent.appendChild(field);
    return select;
  }
  // The transport glyphs are the animation section's own (18px, 78% white).
  const GLYPH = 'rgba(255,255,255,0.78)';
  const svgWrap = (inner) => '<svg width="18" height="18" viewBox="0 0 18 18" style="display:block" aria-hidden="true">' + inner + '</svg>';
  const bar = (x) => '<rect x="' + x + '" y="4" width="2" height="10" rx="0.5" fill="' + GLYPH + '"></rect>';
  const ICONS = {
    start: svgWrap(bar(3) + bar(6) + '<polygon points="15,4 15,14 9,9" fill="' + GLYPH + '"></polygon>'),
    back: svgWrap(bar(4) + '<polygon points="14,4 14,14 7,9" fill="' + GLYPH + '"></polygon>'),
    play: svgWrap('<polygon points="5.5,4 5.5,14 13.5,9" fill="' + GLYPH + '"></polygon>'),
    pause: svgWrap('<rect x="5" y="4" width="3" height="10" rx="0.5" fill="' + GLYPH + '"></rect><rect x="10" y="4" width="3" height="10" rx="0.5" fill="' + GLYPH + '"></rect>'),
    fwd: svgWrap(bar(12) + '<polygon points="4,4 4,14 11,9" fill="' + GLYPH + '"></polygon>'),
    end: svgWrap(bar(13) + bar(10) + '<polygon points="3,4 3,14 9,9" fill="' + GLYPH + '"></polygon>'),
    loop: svgWrap('<path d="M6.5 5.3c2.7-2 6.8-.4 7.3 2.8.5 3.2-3.1 5.8-6 4.4" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round"></path><path d="M7.2 4.2l-2.6 1.2 2.1 2.0" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>')
  };
  function svgIcon(icon) { return icon; }

  // ---- mount --------------------------------------------------------------------------
  function mount() {
    installStyle();
    let root = document.getElementById(ROOT_ID);
    if (root) { root.hidden = false; return; }
    root = el('section');
    root.id = ROOT_ID;
    root.setAttribute('data-novaflow-runtime-ignore', '1');
    root.setAttribute('aria-label', LABEL);
    ui = { root };

    // left card ---------------------------------------------------------------
    const left = el('div', 'nf-as-left');
    const mode = el('div', 'nf-as-mode');
    const modeMusic = el('button', null, '背景音乐'); modeMusic.type = 'button';
    const modeSfx = el('button', null, '音效'); modeSfx.type = 'button';
    modeMusic.addEventListener('click', () => setMode('music'));
    modeSfx.addEventListener('click', () => setMode('sfx'));
    mode.appendChild(modeMusic); mode.appendChild(modeSfx);
    left.appendChild(mode);
    ui.modeMusic = modeMusic; ui.modeSfx = modeSfx;

    const rows = el('div', 'nf-as-rows');
    left.appendChild(rows);
    const gen = row(rows, 'generate', '音频生成', ROW_ICONS.generate);
    ui.genBody = gen.body;
    const toolRows = el('div', 'nf-as-rows-tools');
    rows.appendChild(toolRows);
    const tools = row(toolRows, 'edit', '音轨编辑', ROW_ICONS.edit);
    const grid = el('div', 'nf-as-tools');
    const tool = (label, title, fn) => { const b = el('button', null, label); b.type = 'button'; b.title = title; b.addEventListener('click', fn); grid.appendChild(b); return b; };
    tool('分割', '在播放头处分割选中片段 (S)', () => editor.splitAtPlayhead());
    tool('删除', '删除选中片段 (Delete)', () => editor.deleteSelected());
    tool('复制', '在后面复制一份选中片段', () => editor.duplicateSelected());
    tool('新增音轨', '添加一条空音轨', () => editor.addTrack());
    tools.body.appendChild(grid);
    // selected clip: volume, fades, loop count
    const insp = el('div', 'nf-as-inspector');
    ui.inspTitle = el('div', 'nf-as-label', '未选中片段');
    insp.appendChild(ui.inspTitle);
    const slider = (label, min, max, step, format, apply) => {
      const rowEl = el('label', 'nf-as-slider');
      rowEl.appendChild(el('span', null, label));
      const input = el('input'); input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(min);
      const value = el('span', 'nf-as-slider-value', format(min));
      const paint = () => { const pct = (Number(input.value) - min) / (max - min) * 100; input.style.setProperty('--nf-range-pct', pct + '%'); value.textContent = format(Number(input.value)); };
      input.addEventListener('input', () => { paint(); const clip = editor.selectedClip(); if (clip) apply(clip, Number(input.value)); });
      rowEl.appendChild(input); rowEl.appendChild(value);
      insp.appendChild(rowEl);
      return { input, paint, set(v) { input.value = String(v); paint(); } };
    };
    ui.inspGain = slider('音量', 0, 200, 1, (v) => Math.round(v) + '%', (clip, v) => editor.setGain(clip.id, v / 100));
    ui.inspFadeIn = slider('淡入', 0, 5, 0.1, (v) => v.toFixed(1) + ' s', (clip, v) => editor.setFade(clip.id, v, undefined));
    ui.inspFadeOut = slider('淡出', 0, 5, 0.1, (v) => v.toFixed(1) + ' s', (clip, v) => editor.setFade(clip.id, undefined, v));
    const loopRow = el('label', 'nf-as-slider');
    loopRow.appendChild(el('span', null, '循环'));
    ui.inspLoop = el('input'); ui.inspLoop.type = 'number'; ui.inspLoop.min = '1'; ui.inspLoop.max = '50'; ui.inspLoop.value = '1'; ui.inspLoop.className = 'nf-as-input nf-as-loop-count'; ui.inspLoop.title = '片段在时间轴上重复的遍数';
    ui.inspLoop.addEventListener('change', () => { const clip = editor.selectedClip(); const n = Math.max(1, Math.min(50, Math.round(Number(ui.inspLoop.value) || 1))); ui.inspLoop.value = String(n); if (clip) editor.extendLoop(clip.id, n); });
    loopRow.appendChild(ui.inspLoop); loopRow.appendChild(el('span', 'nf-as-slider-value', '遍'));
    insp.appendChild(loopRow);
    tools.body.appendChild(insp);
    tools.body.appendChild(el('div', 'nf-as-note', '拖资源到音轨；拖片段边缘裁剪，拖过末尾即循环。'));
    syncInspector(null);
    root.appendChild(left);
    ui.left = left;

    // stage -----------------------------------------------------------------------
    const stage = el('div', 'nf-as-stage');
    const topbar = el('div', 'nf-as-topbar');
    const project = el('div', 'nf-as-project');
    ui.tabs = el('div', 'nf-as-tabs');
    const add = el('button', 'nf-as-tab-add', '+'); add.type = 'button'; add.title = '新建画板';
    add.addEventListener('click', () => createBoard());
    const del = el('button', 'nf-as-tab-del', '-'); del.type = 'button'; del.title = '删除当前画板';
    del.addEventListener('click', () => removeBoard(state.board));
    const name = el('input', 'nf-as-name'); name.value = 'audio_1'; name.title = '画板名称'; name.setAttribute('data-novaflow-runtime-ignore', '1');
    name.addEventListener('change', () => { const b = state.boards[state.board]; const v = name.value.trim().slice(0, 40) || ('audio_' + (state.board + 1)); name.value = v; if (b) b.name = v; });
    ui.boardName = name;
    project.appendChild(ui.tabs); project.appendChild(add); project.appendChild(del); project.appendChild(name);
    const zoom = el('div', 'nf-as-zoom');
    ui.zoomLabel = el('span', null, '100%');
    const fit = el('button', null, '自动适配'); fit.type = 'button'; fit.title = '缩放到整段可见'; fit.addEventListener('click', () => { editor.fitToWindow(); syncZoom(); });
    zoom.appendChild(ui.zoomLabel); zoom.appendChild(fit);
    topbar.appendChild(project); topbar.appendChild(zoom);
    stage.appendChild(topbar);
    const timelineHost = el('div', 'nf-as-timeline');
    stage.appendChild(timelineHost);
    ui.empty = el('div', 'nf-as-empty');
    ui.empty.innerHTML = '<div>时间轴还是空的<br><span style="color:#5a5a5a">展开左侧「音频生成」描述后生成，或从右侧资源列表拖入</span></div>';
    timelineHost.appendChild(ui.empty);
    root.appendChild(stage);
    ui.stage = stage;

    ui.timelineHost = timelineHost;
    ui.empty.style.zIndex = '2';
    createBoard();
    timelineHost.appendChild(ui.empty);

    // generation dock -----------------------------------------------------------
    const dock = el('div', 'nf-as-dock');
    ui.dockRow = el('div', 'nf-as-dock-row');
    dock.appendChild(ui.dockRow);
    const status = el('div', 'nf-as-status');
    ui.statusText = el('span', null, '等待生成');
    ui.statusPct = el('span', 'nf-as-pct', '');
    ui.statusErr = el('span', 'nf-as-err', '');
    ui.cancel = el('button', 'nf-as-cancel', '任务中止'); ui.cancel.type = 'button'; ui.cancel.hidden = true;
    ui.cancel.addEventListener('click', cancelRunning);
    status.appendChild(ui.statusText); status.appendChild(ui.statusPct); status.appendChild(ui.statusErr); status.appendChild(ui.cancel);
    dock.appendChild(status);
    const prompt = el('div', 'nf-as-prompt');
    const head = el('div', 'nf-as-prompt-head');
    ui.promptLabel = el('span', 'nf-as-chip', '音乐描述');
    const rewrite = el('button', 'nf-as-chip', 'AI 润色'); rewrite.type = 'button'; rewrite.title = '生成前由本机模型把描述改写成更完整的英文提示';
    rewrite.setAttribute('aria-pressed', 'true');
    rewrite.addEventListener('click', () => { const m = state[state.mode]; m.rewrite = !m.rewrite; rewrite.setAttribute('aria-pressed', String(m.rewrite)); });
    ui.rewrite = rewrite;
    head.appendChild(ui.promptLabel); head.appendChild(rewrite);
    ui.textarea = el('textarea');
    ui.textarea.addEventListener('input', () => { state[state.mode].text = ui.textarea.value; });
    prompt.appendChild(head); prompt.appendChild(ui.textarea);
    dock.appendChild(prompt);
    root.appendChild(dock);
    ui.dock = dock;

    // transport ---------------------------------------------------------------------
    const transport = el('div', 'nf-as-transport');
    const row1 = el('div', 'nf-as-tr-row');
    const tbtn = (icon, title, fn) => { const b = el('button', 'nf-as-tbtn'); b.type = 'button'; b.title = title; b.innerHTML = svgIcon(icon); b.addEventListener('click', fn); row1.appendChild(b); return b; };
    tbtn(ICONS.start, '回到开头', () => editor.seek(0));
    tbtn(ICONS.back, '后退 1 秒', () => editor.seek(editor.playhead() - 1));
    ui.play = tbtn(ICONS.play, '播放 (空格)', () => editor.toggle());
    tbtn(ICONS.fwd, '前进 1 秒', () => editor.seek(editor.playhead() + 1));
    tbtn(ICONS.end, '到结尾', () => editor.seek(editor.projectEnd()));
    ui.loop = tbtn(ICONS.loop, '循环播放整段', () => { editor.setLoop(!editor.state.loop); ui.loop.setAttribute('aria-pressed', String(editor.state.loop)); });
    ui.loop.setAttribute('aria-pressed', 'false');
    ui.time = el('span', 'nf-as-time', '0.0 / 0.0');
    row1.appendChild(ui.time);
    row1.appendChild(el('span', 'nf-as-label', '速度 BPM'));
    ui.bpm = el('input'); ui.bpm.type = 'number'; ui.bpm.min = '0'; ui.bpm.max = '300'; ui.bpm.value = '0'; ui.bpm.title = '时间轴网格的拍速；0 = 按秒';
    ui.bpm.addEventListener('change', () => { editor.setBpm(ui.bpm.value); ui.bpm.value = String(editor.state.bpm); });
    row1.appendChild(ui.bpm);
    const snap = el('label', 'nf-as-check');
    const snapBox = el('input'); snapBox.type = 'checkbox'; snapBox.checked = true;
    snapBox.addEventListener('change', () => editor.setSnap(snapBox.checked));
    snap.appendChild(snapBox); snap.appendChild(el('span', null, '吸附'));
    row1.appendChild(snap);
    const right = el('div', 'nf-as-tr-right');
    right.appendChild(el('span', 'nf-as-label', '缩放'));
    ui.zoomRange = el('input'); ui.zoomRange.type = 'range'; ui.zoomRange.min = '0'; ui.zoomRange.max = '100'; ui.zoomRange.value = '40';
    ui.zoomRange.addEventListener('input', () => { const v = Number(ui.zoomRange.value) / 100; editor.setZoom(6 * Math.pow(400 / 6, v)); });
    right.appendChild(ui.zoomRange);
    row1.appendChild(right);
    transport.appendChild(row1);
    const overview = el('div', 'nf-as-overview');
    ui.overview = el('canvas'); overview.appendChild(ui.overview);
    overview.addEventListener('pointerdown', (event) => { overviewSeek(event); overview.setPointerCapture(event.pointerId); overview.onpointermove = overviewSeek; });
    overview.addEventListener('pointerup', () => { overview.onpointermove = null; });
    transport.appendChild(overview);
    root.appendChild(transport);
    ui.transport = transport;

    // resource sidebar --------------------------------------------------------------
    const sidebar = el('div', 'nf-as-sidebar');
    const sideHead = el('div', 'nf-as-side-head');
    sideHead.appendChild(el('span', null, '资源列表'));
    ui.count = el('span', 'nf-as-count', '0');
    sideHead.appendChild(ui.count);
    const upload = el('button', null, '上传资源'); upload.type = 'button';
    const file = el('input'); file.type = 'file'; file.accept = 'audio/*,.wav,.mp3,.ogg,.flac,.m4a'; file.multiple = true; file.hidden = true;
    file.addEventListener('change', () => { for (const f of Array.from(file.files || [])) importFile(f); file.value = ''; });
    upload.addEventListener('click', () => file.click());
    sideHead.appendChild(upload); sideHead.appendChild(file);
    sidebar.appendChild(sideHead);
    ui.list = el('div', 'nf-as-side-list');
    sidebar.appendChild(ui.list);
    root.appendChild(sidebar);
    ui.sidebar = sidebar;

    document.body.appendChild(root);
    switchBoard(0);
    setMode(state.mode);
    renderRows();
    renderList();
    syncEmpty();
    syncTime();
    syncZoom();
  }

  // 16px outline icons on the row plate, the animation section's own look.
  const ROW_ICONS = {
    generate: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%23bdbdbd' stroke-width='1.3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 12.5V3.5l7-1.5v9'/%3E%3Ccircle cx='4' cy='12.5' r='2'/%3E%3Ccircle cx='11' cy='11' r='2'/%3E%3C/svg%3E\")",
    edit: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%23bdbdbd' stroke-width='1.3' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='4.5' cy='4.5' r='2'/%3E%3Ccircle cx='4.5' cy='11.5' r='2'/%3E%3Cpath d='M13.5 3 6 9.5M13.5 13 6 6.5'/%3E%3C/svg%3E\")",
    export: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%23bdbdbd' stroke-width='1.3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M8 2.5v8M4.5 7 8 10.5 11.5 7'/%3E%3Cpath d='M3 13.5h10'/%3E%3C/svg%3E\")"
  };
  function row(parent, key, title, icon) {
    const node = el('div', 'nf-as-row');
    node.dataset.key = key;
    const head = el('button', 'nf-as-row-head', title); head.type = 'button';
    head.style.setProperty('--nf-as-row-icon', icon);
    head.addEventListener('click', () => { state.open = state.open === key ? '' : key; renderRows(); layout(); });
    const body = el('div', 'nf-as-row-body');
    node.appendChild(head); node.appendChild(body);
    parent.appendChild(node);
    return { node, body };
  }
  function renderRows() {
    for (const node of ui.left.querySelectorAll('.nf-as-row')) node.setAttribute('data-open', state.open === node.dataset.key ? '1' : '0');
    // The dock belongs to 音频生成, as the animation dock belongs to 动画生成.
    ui.dock.hidden = state.open !== 'generate';
  }

  function setMode(mode) {
    state.mode = mode;
    ui.modeMusic.setAttribute('aria-pressed', String(mode === 'music'));
    ui.modeSfx.setAttribute('aria-pressed', String(mode === 'sfx'));
    const m = state[mode];
    // left row body
    ui.genBody.replaceChildren();
    if (mode === 'music') {
      selectField(ui.genBody, '风格', MUSIC_STYLES.map((s) => [s[0], s[1]]), m.style, (v) => { m.style = v; const s = MUSIC_STYLES.find((x) => x[0] === v); if (s && v !== 'auto') { m.bpm = s[3]; syncDockValues(); } });
      selectField(ui.genBody, '情绪', MOODS.map((s) => [s[0], s[1]]), m.mood, (v) => { m.mood = v; });
      ui.genBody.appendChild(el('div', 'nf-as-note', '循环版会按小节裁齐并做无缝接缝，生成后自动放到「音乐」音轨。'));
    } else {
      selectField(ui.genBody, '类别', SFX_CATEGORIES.map((s) => [s[0], s[1]]), m.category, (v) => { m.category = v; const c = SFX_CATEGORIES.find((x) => x[0] === v); if (c && v !== 'auto') { m.seconds = c[3]; syncDockValues(); } });
      selectField(ui.genBody, '风格', SFX_STYLES.map((s) => [s[0], s[1]]), m.style, (v) => { m.style = v; });
      ui.genBody.appendChild(el('div', 'nf-as-note', '多个会生成不同变体，都进资源列表，挑一个拖到音轨。'));
    }
    // dock row
    ui.dockRow.replaceChildren();
    const num = (label, value, min, max, onChange) => {
      ui.dockRow.appendChild(el('span', 'nf-as-label', label));
      const input = el('input'); input.type = 'number'; input.min = String(min); input.max = String(max); input.value = String(value);
      input.addEventListener('change', () => { const v = Math.min(max, Math.max(min, Number(input.value) || min)); input.value = String(v); onChange(v); });
      ui.dockRow.appendChild(input);
      return input;
    };
    const sw = (label, value, onChange) => {
      ui.dockRow.appendChild(el('span', 'nf-as-label', label));
      const b = el('button', 'nf-as-switch'); b.type = 'button'; b.setAttribute('role', 'switch'); b.setAttribute('aria-checked', String(value)); b.setAttribute('aria-label', label);
      b.addEventListener('click', () => { const next = b.getAttribute('aria-checked') !== 'true'; b.setAttribute('aria-checked', String(next)); onChange(next); });
      ui.dockRow.appendChild(b);
      return b;
    };
    if (mode === 'music') {
      ui.secondsInput = num('时长(秒)', m.seconds, 8, 300, (v) => { m.seconds = v; });
      ui.bpmInput = num('BPM', m.bpm, 40, 220, (v) => { m.bpm = v; });
      sw('无缝循环', m.loop, (v) => { m.loop = v; });
    } else {
      ui.secondsInput = num('时长(秒)', m.seconds, 1, 30, (v) => { m.seconds = v; });
      ui.dockRow.appendChild(el('span', 'nf-as-label', '数量'));
      const count = el('select');
      for (const n of [1, 2, 3, 4]) { const o = el('option', null, n + ' 个'); o.value = String(n); count.appendChild(o); }
      count.value = String(m.count);
      count.addEventListener('change', () => { m.count = Number(count.value); });
      ui.dockRow.appendChild(count);
    }
    const go = el('button', 'nf-as-go', '开始生成'); go.type = 'button';
    go.addEventListener('click', () => (mode === 'music' ? submitMusic() : submitSfx()));
    ui.dockRow.appendChild(go);
    ui.go = go;
    ui.promptLabel.textContent = mode === 'music' ? '音乐描述' : '音效描述';
    ui.textarea.placeholder = mode === 'music' ? '输入音乐描述，例如：森林关卡，轻松又带点神秘，竖琴和长笛' : '输入音效描述，例如：打开木门，吱呀一声，有点回音';
    ui.textarea.value = m.text;
    ui.rewrite.setAttribute('aria-pressed', String(m.rewrite));
    refreshCapabilities();
  }
  function syncDockValues() {
    const m = state[state.mode];
    if (ui.secondsInput) ui.secondsInput.value = String(m.seconds);
    if (ui.bpmInput && state.mode === 'music') ui.bpmInput.value = String(m.bpm);
  }

  // ---- layout --------------------------------------------------------------------------
  function layout() {
    const root = document.getElementById(ROOT_ID);
    if (!root || !state.active) return;
    const column = document.querySelector('[data-novaflow-left-column]');
    const surface = document.querySelector('[data-novaflow-primary-surface="1"]');
    let cardLeft = 75, cardWidth = 218, stageLeft = 302;
    if (surface instanceof HTMLElement && surface.getBoundingClientRect().width > 100) {
      const r = surface.getBoundingClientRect(); cardLeft = Math.round(r.left); cardWidth = Math.round(r.width);
    } else if (column instanceof HTMLElement) {
      const r = column.getBoundingClientRect();
      const pad = parseFloat(getComputedStyle(column).paddingLeft) || 68;
      cardLeft = Math.round(r.left + pad); cardWidth = Math.round(r.width - pad - 9);
    }
    if (column instanceof HTMLElement) stageLeft = Math.round(column.getBoundingClientRect().right);
    const top = STAGE_TOP, bottom = window.innerHeight - EDGE_GAP, right = window.innerWidth - EDGE_GAP;
    const place = (node, x, y, w, h) => { node.style.left = x + 'px'; node.style.top = y + 'px'; node.style.width = w + 'px'; node.style.height = h + 'px'; };
    place(ui.left, cardLeft, top, cardWidth, bottom - top);
    place(ui.stage, stageLeft, top, right - stageLeft, bottom - top);
    place(ui.sidebar, right - SIDEBAR_W, top, SIDEBAR_W, bottom - top);
    const innerRight = right - SIDEBAR_W - EDGE_GAP;
    const transportTop = bottom - TRANSPORT_H;
    place(ui.transport, stageLeft, transportTop, innerRight - stageLeft, TRANSPORT_H);
    const dockVisible = !ui.dock.hidden;
    const dockTop = transportTop - 9 - DOCK_H;
    place(ui.dock, stageLeft, dockTop, innerRight - stageLeft, DOCK_H);
    // the timeline stops above whichever card comes first
    const timelineBottom = (dockVisible ? dockTop : transportTop) - 9;
    const tl = ui.stage.querySelector('.nf-as-timeline');
    tl.style.right = (right - innerRight) + 'px';
    tl.style.bottom = (bottom - timelineBottom) + 'px';
    ui.stage.querySelector('.nf-as-topbar').style.right = (right - innerRight) + 'px';
    syncMask();
    if (editor) { editor.layout(); drawOverview(); }
  }

  // ---- transport helpers -------------------------------------------------------------
  function syncInspector(clip) {
    if (!ui || !ui.inspGain) return;
    const has = Boolean(clip);
    ui.inspTitle.textContent = has ? clip.name + ' · ' + (editor ? editor.formatTime(clip.length) : '') : '未选中片段';
    for (const s of [ui.inspGain, ui.inspFadeIn, ui.inspFadeOut]) s.input.disabled = !has;
    ui.inspLoop.disabled = !has || !clip.loopable;
    if (!has) { ui.inspGain.set(100); ui.inspFadeIn.set(0); ui.inspFadeOut.set(0); ui.inspLoop.value = '1'; return; }
    ui.inspGain.set(Math.round(clip.gain * 100));
    ui.inspFadeIn.set(Math.round(clip.fadeIn * 10) / 10);
    ui.inspFadeOut.set(Math.round(clip.fadeOut * 10) / 10);
    ui.inspLoop.value = String(Math.max(1, Math.round(clip.length / clip.buffer.duration)));
  }
  function syncTime() {
    if (!ui || !editor || !ui.time) return;
    ui.time.textContent = editor.formatTime(editor.playhead()) + ' / ' + editor.formatTime(editor.projectEnd());
  }
  function syncZoom() {
    if (!ui || !editor || !ui.zoomRange) return;
    const z = editor.zoom();
    ui.zoomLabel.textContent = Math.round(z / 40 * 100) + '%';
    const v = Math.log(z / 6) / Math.log(400 / 6) * 100;
    ui.zoomRange.value = String(Math.round(v));
    ui.zoomRange.style.setProperty('--nf-range-pct', Math.round(v) + '%');
  }
  function syncEmpty() {
    if (!ui || !editor) return;
    ui.empty.style.display = editor.clipCount() ? 'none' : 'grid';
    syncTime();
  }
  function drawOverview() {
    if (!ui || !editor || !ui.overview) return;
    const canvas = ui.overview;
    const w = canvas.clientWidth || 300, h = canvas.clientHeight || 34;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#1d1d1d'; g.fillRect(0, 0, w, h);
    const end = Math.max(1, editor.projectEnd());
    const tracks = editor.state.tracks;
    const laneH = Math.max(3, (h - 12) / Math.max(1, tracks.length));
    tracks.forEach((track, i) => {
      for (const clip of track.clips) {
        g.fillStyle = clip.kind === 'sfx' ? '#3b6fc4' : clip.kind === 'music' ? '#1ea672' : '#c9a63a';
        g.fillRect(clip.start / end * w, 2 + i * laneH, Math.max(2, clip.length / end * w), laneH - 1);
      }
    });
    g.fillStyle = '#8d8d8d'; g.font = '10px system-ui, sans-serif'; g.textBaseline = 'bottom';
    const step = end > 120 ? 30 : end > 40 ? 10 : 5;
    for (let t = 0; t <= end; t += step) { const x = t / end * w; g.fillRect(x, h - 8, 1, 8); g.fillText(String(Math.round(t)), x + 3, h - 1); }
    const px = editor.playhead() / end * w;
    g.fillStyle = '#ef4444'; g.fillRect(px - 1, 0, 2, h);
  }
  function overviewSeek(event) {
    const r = ui.overview.getBoundingClientRect();
    editor.seek((event.clientX - r.left) / r.width * Math.max(1, editor.projectEnd()));
  }
  // ---- boards: the animation section's 1 / + / -, each with a timeline of its own
  let boardSerial = 0;
  function editorOptions(host) {
    return {
      host, context: audioContext,
      onChange: (what) => { if (what === 'model') { syncEmpty(); drawOverview(); } if (what === 'zoom') syncZoom(); },
      onTime: () => { syncTime(); drawOverview(); },
      onSelect: (clip) => syncInspector(clip),
      onTransport: (playing) => { ui.play.innerHTML = svgIcon(playing ? ICONS.pause : ICONS.play); ui.play.title = playing ? '暂停 (空格)' : '播放 (空格)'; },
      resolveDrop: (id) => { const r = state.resources.find((x) => x.id === id); return r && r.buffer ? { buffer: r.buffer, name: r.name, kind: r.kind, loopable: r.loopable } : null; }
    };
  }
  function createBoard() {
    const host = el('div', 'nf-as-board');
    host.style.cssText = 'position:absolute;inset:0;display:none';
    ui.timelineHost.appendChild(host);
    const board = { id: 'board-' + (++boardSerial), name: 'audio_' + boardSerial, host, editor: window.NovaFlowAudioTimeline.create(editorOptions(host)) };
    state.boards.push(board);
    // During mount the transport does not exist yet; mount switches to the first board itself.
    if (ui.time && ui.play) switchBoard(state.boards.length - 1); else renderTabs();
    return board;
  }
  function switchBoard(index) {
    if (editor) editor.pause();
    state.board = Math.max(0, Math.min(state.boards.length - 1, index));
    state.boards.forEach((b, i) => { b.host.style.display = i === state.board ? 'block' : 'none'; });
    editor = state.boards[state.board].editor;
    if (ui.loop) ui.loop.setAttribute('aria-pressed', String(editor.state.loop));
    if (ui.bpm) ui.bpm.value = String(editor.state.bpm);
    syncInspector(editor.selectedClip());
    if (ui.boardName) ui.boardName.value = state.boards[state.board].name;
    renderTabs(); syncEmpty(); syncTime(); syncZoom(); drawOverview();
    editor.layout();
  }
  function removeBoard(index) {
    const board = state.boards[index];
    if (!board) return;
    if (board.editor.clipCount() && !window.confirm('删除这个画板和它的时间轴？')) return;
    board.editor.destroy(); board.host.remove();
    state.boards.splice(index, 1);
    if (!state.boards.length) { createBoard(); return; }
    switchBoard(Math.min(index, state.boards.length - 1));
  }
  function renderTabs() {
    if (!ui.tabs) return;
    ui.tabs.replaceChildren();
    state.boards.forEach((b, i) => {
      const t = el('button', 'nf-as-tab', String(i + 1)); t.type = 'button'; t.title = '画板 ' + (i + 1);
      t.setAttribute('aria-pressed', String(i === state.board));
      t.addEventListener('click', () => switchBoard(i));
      ui.tabs.appendChild(t);
    });
  }

  // ---- keyboard ------------------------------------------------------------------------
  document.addEventListener('keydown', (event) => {
    if (!state.active || !editor) return;
    const t = event.target;
    if (t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (event.key === ' ') { event.preventDefault(); editor.toggle(); }
    else if (event.key === 'Delete' || event.key === 'Backspace') { if (editor.deleteSelected()) event.preventDefault(); }
    else if (event.key === 's' || event.key === 'S') { editor.splitAtPlayhead(); }
    else if (event.key === 'Home') { editor.seek(0); }
  });

  // ---- capabilities ----------------------------------------------------------------------
  let capabilityNote = '';
  async function refreshCapabilities() {
    const runtime = window.NovaFlowWebRuntime;
    if (!runtime || typeof runtime.control !== 'function') { capabilityNote = '网页运行时未就绪'; tell(); return; }
    try {
      const caps = await runtime.control('GET', '/api/web/capabilities');
      const types = Array.isArray(caps?.taskTypes) ? caps.taskTypes : [];
      const ok = (name) => { const t = types.find((x) => x.task_type === name); return t && Number(t.available_workers) > 0; };
      const ready = state.mode === 'music' ? ok('audio_music') : ok('audio_sfx');
      if (ui && ui.go) ui.go.disabled = !ready;
      capabilityNote = ready ? '' : '本机算力节点还没有音频模型就绪，稍后再试';
    } catch (error) {
      capabilityNote = '无法读取算力状态：' + String(error?.message || error);
    }
    tell();
    // The node reports its models on a timer; a runtime that was still
    // starting answers "not ready" once and "ready" a little later.
    clearTimeout(refreshCapabilities.timer);
    if (capabilityNote && state.active) refreshCapabilities.timer = setTimeout(refreshCapabilities, 15000);
  }
  function tell() {
    if (!ui) return;
    const running = state.running.size;
    ui.statusText.textContent = capabilityNote || (running ? running + ' 个任务生成中' : '等待生成');
    ui.statusErr.textContent = '';
    if (!running) ui.statusPct.textContent = '';
    ui.cancel.hidden = running === 0;
  }

  // ---- captions ----------------------------------------------------------------------
  function musicCaption() {
    const m = state.music;
    const style = MUSIC_STYLES.find((s) => s[0] === m.style) || MUSIC_STYLES[0];
    const mood = MOODS.find((s) => s[0] === m.mood) || MOODS[0];
    const text = translate(m.text);
    const parts = [];
    if (text) parts.push(text + (style[2] ? '' : ' game background music'));
    if (style[2]) parts.push(style[2]);
    if (!parts.length) parts.push('Game background music');
    if (mood[2]) parts.push('creating a ' + mood[2] + ' feel');
    parts.push('instrumental, steady tempo, consistent groove throughout');
    if (m.loop) parts.push('no intro, no outro, seamless loop');
    return parts.join(', ') + '. BPM: ' + m.bpm;
  }
  function sfxCaption() {
    const m = state.sfx;
    const cat = SFX_CATEGORIES.find((c) => c[0] === m.category) || SFX_CATEGORIES[0];
    const style = SFX_STYLES.find((s) => s[0] === m.style) || SFX_STYLES[0];
    const text = translate(m.text);
    const parts = [];
    if (text) parts.push(text);
    if (cat[2]) parts.push(cat[2]);
    if (!parts.length) parts.push('Short game sound effect');
    if (style[2]) parts.push(style[2]);
    parts.push('game sound effect, clean, no music');
    return parts.join(', ');
  }
  function describeMusic() {
    const m = state.music;
    const style = MUSIC_STYLES.find((s) => s[0] === m.style);
    const mood = MOODS.find((x) => x[0] === m.mood);
    return [m.text.trim(), style && style[2] ? style[1] : '', mood && mood[2] ? mood[1] : '', m.bpm + ' BPM', m.seconds + ' 秒', m.loop ? '循环' : ''].filter(Boolean).join(' · ');
  }
  function describeSfx() {
    const m = state.sfx;
    const cat = SFX_CATEGORIES.find((c) => c[0] === m.category);
    const style = SFX_STYLES.find((s) => s[0] === m.style);
    return [m.text.trim(), cat && cat[2] ? cat[1] : '', style && style[2] ? style[1] : '', m.seconds + ' 秒'].filter(Boolean).join(' · ');
  }

  // ---- tasks -----------------------------------------------------------------------------
  async function submitMusic() {
    const m = state.music;
    await submit('audio_music', 'music', describeMusic(), {
      prompt: musicCaption(), duration_seconds: m.seconds, bpm: m.bpm, loop: m.loop, crossfade_ms: 800, reprompt: m.rewrite
    });
  }
  async function submitSfx() {
    const m = state.sfx;
    const parameters = { prompt: sfxCaption(), duration_seconds: m.seconds, reprompt: m.rewrite };
    for (let i = 0; i < m.count; i += 1) submit('audio_sfx', 'sfx', describeSfx(), parameters);
  }
  async function submit(taskType, kind, label, parameters) {
    const runtime = window.NovaFlowWebRuntime;
    if (!runtime) return;
    const pending = { id: 'pending-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), kind, name: kind === 'music' ? '音乐 生成中' : '音效 生成中', label, pending: true, progress: 0 };
    state.resources.unshift(pending);
    renderList();
    let task;
    try {
      const created = await runtime.control('POST', '/api/web/tasks', { task_type: taskType, parameters });
      task = created?.task;
      if (!task?.id) throw new Error('任务未创建');
    } catch (error) {
      failPending(pending, String(error?.message || error));
      return;
    }
    const entry = { cancelled: false, pending };
    state.running.set(task.id, entry);
    pending.taskId = task.id;
    tell();
    try {
      const finished = await waitForTask(runtime, task.id, (t) => { pending.progress = Number(t.progress) || 0; ui.statusPct.textContent = Math.round(pending.progress) + '%'; renderProgress(pending); });
      if (entry.cancelled) return;
      if (finished.status !== 'completed') throw new Error(finished.error_message || ('任务' + finished.status));
      const files = (finished.output_manifest?.files || []).filter((f) => /\.(wav|flac|mp3|ogg)$/i.test(f.name));
      if (!files.length) throw new Error('没有产出音频文件');
      const bytes = await runtime.fetchTaskOutput(finished, files[0].name);
      const blob = new Blob([bytes], { type: 'audio/wav' });
      await completed(pending, kind, label, parameters, files[0], blob, finished);
    } catch (error) {
      if (!entry.cancelled) failPending(pending, String(error?.message || error));
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
  function cancelRunning() {
    const runtime = window.NovaFlowWebRuntime;
    for (const [id, entry] of state.running) {
      entry.cancelled = true;
      runtime?.control('POST', '/api/web/tasks/' + id + '/cancel').catch(() => {});
      state.resources = state.resources.filter((r) => r !== entry.pending);
    }
    state.running.clear();
    renderList(); tell();
  }
  function failPending(pending, message) {
    state.resources = state.resources.filter((r) => r !== pending);
    renderList();
    ui.statusErr.textContent = message;
    ui.statusErr.title = message;
  }
  async function completed(pending, kind, label, parameters, file, blob, task) {
    state.counter[kind] += 1;
    const serial = String(state.counter[kind]).padStart(3, '0');
    const name = (kind === 'music' ? 'Music_' : 'Sfx_') + serial;
    const buffer = await decode(blob);
    const resource = {
      id: 'res-' + task.id, kind, name, label, caption: String(file.caption || ''), parameters,
      seconds: buffer ? buffer.duration : Number(file.duration_seconds) || 0,
      blob, buffer, url: URL.createObjectURL(blob), task, loopable: kind === 'music' && parameters.loop !== false
    };
    const index = state.resources.indexOf(pending);
    if (index >= 0) state.resources.splice(index, 1, resource); else state.resources.unshift(resource);
    renderList();
    if (buffer) editor.addClip({ buffer, name, kind, loopable: resource.loopable });
    try { await window.NovaFlowWebWarehouse?.save?.({ blob, name: name + '.wav' }); } catch (_) { /* the warehouse reports its own state */ }
  }

  // ---- resources ---------------------------------------------------------------------------
  async function importFile(file) {
    try {
      const buffer = await decode(file);
      if (!buffer) throw new Error('无法解码 ' + file.name);
      state.counter.import += 1;
      const name = file.name.replace(/\.[^.]+$/, '').slice(0, 40) || ('导入_' + state.counter.import);
      const blob = file;
      state.resources.unshift({ id: 'res-import-' + Date.now() + '-' + state.counter.import, kind: 'import', name, label: file.name, seconds: buffer.duration, blob, buffer, url: URL.createObjectURL(blob), loopable: true });
      renderList();
    } catch (error) {
      ui.statusErr.textContent = String(error?.message || error);
    }
  }
  function renderList() {
    if (!ui) return;
    ui.list.replaceChildren();
    ui.count.textContent = String(state.resources.filter((r) => !r.pending).length);
    if (!state.resources.length) { ui.list.appendChild(el('div', 'nf-as-side-empty', '暂无内容')); return; }
    for (const res of state.resources) ui.list.appendChild(resourceCard(res));
  }
  function renderProgress(pending) {
    const bar = ui.list.querySelector('[data-res-id="' + pending.id + '"] .nf-as-res-progress i');
    if (bar) bar.style.width = Math.max(2, Math.min(99, pending.progress)) + '%';
  }
  function resourceCard(res) {
    const node = el('div', 'nf-as-res');
    node.dataset.resId = res.id;
    node.title = res.caption || res.label || res.name;
    if (res.pending) {
      node.setAttribute('data-pending', '1');
      node.appendChild(el('div', 'nf-as-res-name')).appendChild(el('span', null, res.name));
      node.appendChild(el('div', 'nf-as-note', res.label));
      const progress = el('div', 'nf-as-res-progress'); progress.appendChild(el('i'));
      node.appendChild(progress);
      return node;
    }
    const canvas = el('canvas');
    node.appendChild(canvas);
    const nameRow = el('div', 'nf-as-res-name');
    nameRow.appendChild(el('span', null, res.name));
    const tag = el('span', 'nf-as-res-tag', res.kind === 'music' ? '音乐' : res.kind === 'sfx' ? '音效' : '导入');
    tag.dataset.kind = res.kind;
    nameRow.appendChild(tag);
    nameRow.appendChild(el('small', null, editor.formatTime(res.seconds)));
    node.appendChild(nameRow);
    const actions = el('div', 'nf-as-res-actions');
    const act = (text, title, fn, cls) => { const b = el('button', cls || null, text); b.type = 'button'; b.title = title; b.addEventListener('click', (e) => { e.stopPropagation(); fn(); }); actions.appendChild(b); };
    act('▶', '试听', () => previewResource(res, node));
    act('+', '加到音轨播放头处', () => editor.addClip({ buffer: res.buffer, name: res.name, kind: res.kind, loopable: res.loopable, start: editor.playhead() }));
    act('⇩', '下载 WAV', () => download(res));
    act('×', '删除', () => removeResource(res), 'danger');
    node.appendChild(actions);
    node.draggable = true;
    node.addEventListener('dragstart', (event) => {
      event.dataTransfer.setData('application/x-novaflow-audio', res.id);
      event.dataTransfer.effectAllowed = 'copy';
    });
    node.addEventListener('dblclick', () => editor.addClip({ buffer: res.buffer, name: res.name, kind: res.kind, loopable: res.loopable }));
    node.addEventListener('click', () => { for (const n of ui.list.children) n.removeAttribute('data-selected'); node.setAttribute('data-selected', '1'); });
    requestAnimationFrame(() => drawThumb(canvas, res.buffer));
    return node;
  }
  function removeResource(res) {
    stopPreview();
    state.resources = state.resources.filter((r) => r !== res);
    if (res.url) URL.revokeObjectURL(res.url);
    renderList();
  }
  function download(res) {
    const link = document.createElement('a');
    link.href = res.url; link.download = res.name + '.wav'; document.body.appendChild(link); link.click(); link.remove();
  }
  function drawThumb(canvas, buffer) {
    const w = canvas.clientWidth || 180, h = canvas.clientHeight || 34;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#121212'; g.fillRect(0, 0, w, h);
    if (!buffer) return;
    const data = buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / w));
    g.fillStyle = '#1ea672';
    for (let x = 0; x < w; x += 1) {
      let peak = 0; const s = x * step;
      for (let i = 0; i < step && s + i < data.length; i += 4) { const v = Math.abs(data[s + i]); if (v > peak) peak = v; }
      const hh = Math.max(1, peak * (h - 4));
      g.fillRect(x, (h - hh) / 2, 1, hh);
    }
  }

  // ---- preview playback (resource list) ---------------------------------------------------
  let context = null;
  function audioContext() {
    if (!context) context = new (window.AudioContext || window.webkitAudioContext)();
    return context;
  }
  async function decode(blob) {
    try { return await audioContext().decodeAudioData(await blob.arrayBuffer()); } catch (_) { return null; }
  }
  function previewResource(res, node) {
    if (state.preview && state.preview.res === res) { stopPreview(); return; }
    stopPreview();
    if (!res.buffer) return;
    editor.pause();
    const ctx = audioContext();
    if (ctx.state === 'suspended') ctx.resume();
    const source = ctx.createBufferSource();
    source.buffer = res.buffer;
    source.loop = Boolean(res.loopable) && res.kind === 'music';
    source.connect(ctx.destination);
    source.onended = () => { if (state.preview && state.preview.source === source) { state.preview = null; node.removeAttribute('data-selected'); } };
    source.start();
    state.preview = { res, source, node };
    node.setAttribute('data-selected', '1');
  }
  function stopPreview() {
    const p = state.preview;
    if (!p) return;
    state.preview = null;
    try { p.source.stop(); } catch (_) { /* already stopped */ }
    p.node?.removeAttribute('data-selected');
  }

  // ---- export -------------------------------------------------------------------------------
  async function exportMix() {
    try {
      ui.statusErr.textContent = '';
      const blob = await editor.exportMix();
      const name = (state.boards[state.board]?.name || ('audio_' + (state.board + 1))).replace(/[\/:*?"<>|]/g, '_') + '_mix';
      state.counter.import += 1;
      const buffer = await decode(blob);
      state.resources.unshift({ id: 'res-mix-' + Date.now(), kind: 'import', name, label: '混音导出', seconds: buffer ? buffer.duration : 0, blob, buffer, url: URL.createObjectURL(blob), loopable: true });
      renderList();
      const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = name + '.wav'; document.body.appendChild(link); link.click(); link.remove();
      try { await window.NovaFlowWebWarehouse?.save?.({ blob, name: name + '.wav' }); } catch (_) { /* reported by the warehouse */ }
    } catch (error) {
      ui.statusErr.textContent = String(error?.message || error);
    }
  }
  async function exportSelected() {
    const clip = editor.selectedClip();
    if (!clip) { ui.statusErr.textContent = '先在时间轴上选中一个片段'; return; }
    const sr = clip.buffer.sampleRate;
    const off = new OfflineAudioContext(clip.buffer.numberOfChannels, Math.ceil(clip.length * sr), sr);
    const env = off.createGain(); env.connect(off.destination);
    env.gain.setValueAtTime(clip.fadeIn > 0 ? 0.0001 : clip.gain, 0);
    if (clip.fadeIn > 0) env.gain.linearRampToValueAtTime(clip.gain, clip.fadeIn);
    if (clip.fadeOut > 0) { env.gain.setValueAtTime(clip.gain, Math.max(0, clip.length - clip.fadeOut)); env.gain.linearRampToValueAtTime(0.0001, clip.length); }
    let rel = 0, pos = clip.offset;
    while (rel < clip.length - 1e-4) {
      const seg = Math.min(clip.buffer.duration - pos, clip.length - rel);
      const src = off.createBufferSource(); src.buffer = clip.buffer; src.connect(env); src.start(rel, pos, seg);
      rel += seg; pos = 0;
    }
    const rendered = await off.startRendering();
    const blob = window.NovaFlowAudioTimeline.encodeWav(rendered);
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = clip.name + '_clip.wav'; document.body.appendChild(link); link.click(); link.remove();
    try { await window.NovaFlowWebWarehouse?.save?.({ blob, name: clip.name + '_clip.wav' }); } catch (_) { /* reported by the warehouse */ }
  }

  // ---- keep the cell and the workspace in place ---------------------------------------------
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
    setMode,
    resources: () => state.resources.slice(),
    editor: () => editor,
    captions: { music: musicCaption, sfx: sfxCaption, translate }
  };
})();
