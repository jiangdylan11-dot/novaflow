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

  const LABEL = '音视';                // the rail entry; its two sub-entries are 视频 (the AI sequence section) and 音频 (this overlay)
  const SUB_VIDEO_CLASS = 'novaflow-primary-target-av-video';
  const SUB_TOGGLE_ID = 'novaflow-av-sub-toggle';
  const SECONDARY_SHELL_H = 37;        // SECONDARY_GROUP_HEIGHT in the brand runtime
  const CELL_ID = 'novaflow-primary-audio-cell';
  const MASK_ID = 'novaflow-primary-audio-mask';
  const ROOT_ID = 'novaflow-audio-studio';
  const STYLE_ID = 'novaflow-audio-studio-style';
  const BODY_CLASS = 'novaflow-primary-target-audio';
  const RAIL_AFTER = '特效';            // the entry the 音视 cell sits under
  const RAIL_PITCH = 70;               // PRIMARY_RAIL_ITEM_PITCH in the brand runtime
  const STAGE_TOP = 62;                // TOPBAR_HEIGHT + PRIMARY_PANEL_TOP_GAP
  const EDGE_GAP = 10;
  const SIDEBAR_W = 206;
  // The brand runtime's layout tiers: wide (>1400), narrow (720..1400) and
  // stack (<720, every card full width under the section panel). The side
  // gap and the resource column follow the tier; the stack tier stacks.
  const TIERS = { wide: { resources: 206, gap: 10 }, narrow: { resources: 172, gap: 8 }, stack: { resources: 172, gap: 8, resourcesHeight: 140 } };
  function layoutTier() { const t = document.documentElement.getAttribute('data-novaflow-layout-tier'); return TIERS[t] ? t : 'wide'; }
  const TRANSPORT_H = 50;
  const DOCK_H = 213;
  const STACK_STAGE_MIN = 320;         // stack tier: the stage (top bar + timeline) never shrinks below this
  // 音视: a clapper board with a note
  const ICON = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='8' width='18' height='12' rx='2'/%3E%3Cpath d='M3 8l3-4h12l3 4'/%3E%3Cpath d='M8 4l2 4M13 4l2 4'/%3E%3Cpath d='M10 17v-4l4-1v4'/%3E%3Ccircle cx='9' cy='17' r='1.2'/%3E%3Ccircle cx='13' cy='16' r='1.2'/%3E%3C/svg%3E\")";

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
    sub: 'video',                       // 'video' (the AI sequence section under 音视) | 'audio' (this overlay)
    mode: 'music',                      // 'music' | 'sfx'
    open: 'generate',                   // which left row is expanded
    music: { style: 'auto', mood: 'auto', bpm: 100, seconds: 30, loop: true, text: '', rewrite: true },
    sfx: { category: 'auto', style: 'any', seconds: 2, count: 1, text: '', rewrite: true },
    resources: [],                      // {id, kind, name, buffer, blob, url, seconds, caption, label, task, loopable}
    running: new Map(),                 // task id -> {cancelled}
    counter: { music: 0, sfx: 0, import: 0 },
    boards: [], board: 0,
    maskTarget: null,
    preview: null,
    refPreview: { enabled: false, item: null, durationSec: 0 }   // 音频编辑's reference video
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
      cell.setAttribute('data-novaflow-primary-cell-active', '0');
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
      // entering 音视 from the rail always lands on 视频
      button.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); activate('video'); }, true);
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
    copyCellLook(cell);
  }
  // The rail's own pressed / idle look (fill, stroke, shadow, label colour) off
  // a React entry in the same state, so 音视 never drifts from its neighbours.
  const CELL_PROPS = ['background-color', 'background-image', 'border', 'box-shadow', 'outline', 'border-radius'];
  // the colour goes through --nf-cell-color (not an inline !important) so the hover's white wins
  const CELL_BUTTON_PROPS = ['font-size', 'font-weight', 'letter-spacing', 'font-family', 'gap', 'padding'];
  function copyCellLook(cell) {
    const entries = Array.from(document.querySelectorAll('[data-novaflow-primary-entry="1"]'));
    // never off a hovered entry: its hover fill was copied and 音视 lit up with it
    const calm = entries.filter((e) => !(e.closest('[data-novaflow-primary-cell="1"]') || e).matches(':hover'));
    const pressed = calm.find((e) => e.getAttribute('aria-pressed') === 'true');
    const idle = calm.find((e) => e.getAttribute('aria-pressed') !== 'true');
    const ref = state.active ? (pressed || idle) : (idle || pressed);
    if (!ref) return;
    const host = ref.closest('[data-novaflow-primary-cell="1"]') || ref;
    const button = cell.querySelector('button');
    const hs = getComputedStyle(host), bs = getComputedStyle(ref);
    for (const prop of CELL_PROPS) { const v = hs.getPropertyValue(prop); if (cell.style.getPropertyValue(prop) !== v) cell.style.setProperty(prop, v, 'important'); }
    if (host !== ref) {
      // the stroke may sit on the entry button itself
      for (const prop of ['border', 'box-shadow', 'outline']) { const v = bs.getPropertyValue(prop); if (v && !/none|0px/.test(v.split(' ')[0]) && button.style.getPropertyValue(prop) !== v) button.style.setProperty(prop, v, 'important'); else if (button.style.getPropertyValue(prop) && (!v || /none|0px/.test(v.split(' ')[0]))) button.style.removeProperty(prop); }
      const bg = bs.getPropertyValue('background-color');
      if (bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) button.style.setProperty('background-color', bg, 'important'); else button.style.removeProperty('background-color');
    }
    for (const prop of CELL_BUTTON_PROPS) { const v = bs.getPropertyValue(prop); if (button.style.getPropertyValue(prop) !== v) button.style.setProperty(prop, v, 'important'); }
    const color = bs.getPropertyValue('color');
    if (button.style.getPropertyValue('--nf-cell-color') !== color) button.style.setProperty('--nf-cell-color', color);
    if (button.style.getPropertyValue('color')) button.style.removeProperty('color');
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
    const opaque = (color) => color && color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent';
    // The rail panel behind the entries is the runtime's own surface element,
    // pointer-events:none, so elementsFromPoint never lists it and sampling the
    // page gave the body colour: a lighter box where the pressed entry was.
    const surface = document.getElementById('novaflow-primary-rail-surface');
    if (surface instanceof HTMLElement && surface.getBoundingClientRect().width > 0) {
      const color = getComputedStyle(surface).backgroundColor;
      if (opaque(color)) return color;
    }
    // Otherwise the idle look is what an unpressed entry (or its cell) paints.
    for (const entry of document.querySelectorAll('[data-novaflow-primary-entry="1"]')) {
      if (!(entry instanceof HTMLElement) || entry === reference || entry.getAttribute('aria-pressed') === 'true') continue;
      const host = entry.closest('[data-novaflow-primary-cell="1"]') || entry;
      for (const node of [entry, host]) { const color = getComputedStyle(node).backgroundColor; if (opaque(color)) return color; }
    }
    for (let node = reference.parentElement; node; node = node.parentElement) {
      const color = getComputedStyle(node).backgroundColor;
      if (opaque(color)) return color;
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
      mask.appendChild(document.createElement('i'));
      // 动画 is React's pressed entry already: deactivating flips the mode to
      // 骨骼 through the runtime; replaying the click on the entry only made the
      // runtime run its 200 ms primary-entry commit again
      mask.addEventListener('click', (event) => {
        event.preventDefault(); event.stopPropagation();
        deactivate();
      });
      document.body.appendChild(mask);
    }
    state.maskTarget = pressed;
    // not data-novaflow-primary-label / aria-label: the runtime's primary-intent
    // listeners resolved the mask as the 动画 entry and ran its entry commit again
    mask.setAttribute('data-nf-mask-label', pressed.getAttribute('data-novaflow-primary-label') || '');
    const icon = getComputedStyle(pressed).getPropertyValue('--nf-rail-icon');
    if (icon) mask.style.setProperty('--nf-rail-icon', icon);
    const rail = pressed.closest('[data-novaflow-primary-rail]');
    const railZ = rail ? Number(getComputedStyle(rail).zIndex) : NaN;
    const hostZ = Number(getComputedStyle(host).zIndex);
    const zIndex = Math.min(2147483646, Math.max(Number.isFinite(railZ) ? railZ : 0, Number.isFinite(hostZ) ? hostZ : 0, 90000) + 1);
    // one pixel past the entry on every side: the pressed entry under it is a
    // rounded box whose antialiased edge showed through a same-radius mask
    const want = {
      left: Math.round(rect.left) - 1 + 'px', top: Math.round(rect.top) - 1 + 'px', width: Math.round(rect.width) + 2 + 'px', height: Math.round(rect.height) + 2 + 'px',
      'z-index': String(zIndex), '--nf-mask-bg': railBackground(host), '--nf-mask-radius': getComputedStyle(host).borderRadius
    };
    for (const key of Object.keys(want)) if (mask.style.getPropertyValue(key) !== want[key]) mask.style.setProperty(key, want[key], 'important');
  }

  // ---- activation ----------------------------------------------------------------
  function setAnimationSecondaryFlag() {
    const want = state.active ? 'ai' : 'skeleton';
    if (document.body.getAttribute('data-nf-animation-secondary') === want) return;
    document.body.setAttribute('data-nf-animation-secondary', want);
    // the runtime switches the mode and re-lays the column in its own cycle; nudge it when 动画 is already on
    const runtime = window.NovaFlowBrandRuntimeAnimation;
    if (runtime && animationEntry()?.getAttribute('aria-pressed') === 'true') { runtime.syncSecondary(); runtime.relayout(); }
  }
  function activate(sub) {
    sub = sub === 'audio' || sub === 'video' ? sub : state.sub;
    if (state.active && state.sub === sub) return;
    cancelPendingTeardown();
    state.active = true;
    state.sub = sub;
    setAnimationSecondaryFlag();
    const cell = document.getElementById(CELL_ID);
    if (cell) { cell.setAttribute('data-novaflow-primary-cell-active', '1'); cell.querySelector('button')?.setAttribute('aria-pressed', 'true'); }
    if (sub === 'audio') {
      document.body.classList.add(BODY_CLASS);
      document.body.classList.remove(SUB_VIDEO_CLASS);
      mount();
      // entering 音频 always opens 音频生成
      if (state.open !== 'generate') { state.open = 'generate'; renderRows(); }
      layout();
      syncMask();
      refreshCapabilities();
      if (editor) editor.layout();
    } else {
      // 视频: the React AI sequence section shows through; only the rail cell and the sub toggle are ours
      document.body.classList.remove(BODY_CLASS);
      document.body.classList.add(SUB_VIDEO_CLASS);
      const root = document.getElementById(ROOT_ID);
      if (root) root.hidden = true;
      closeDropdown();
      if (editor) editor.pause();
      stopPreview();
      ensureAnimationSection();
      syncMask();
    }
    syncSubToggle();
    ensureCell(); // the cell's pressed look now, not at the next tick
  }
  function deactivateSilently() { deactivate(true); }
  // React renders the 骨骼 page asynchronously after the mode flips: the 音视 page
  // (its classes, the 视频|音频 toggle, the 音频 root) stays as it is until the 骨骼
  // rows are in the column, then goes in the same frame they first paint
  let pendingTeardown = null;
  function cancelPendingTeardown() {
    if (!pendingTeardown) return;
    pendingTeardown.observer.disconnect();
    window.clearTimeout(pendingTeardown.timer);
    pendingTeardown = null;
  }
  function teardownPage() {
    cancelPendingTeardown();
    document.body.classList.remove(BODY_CLASS);
    document.body.classList.remove(SUB_VIDEO_CLASS);
    syncSubToggle();
    const root = document.getElementById(ROOT_ID);
    if (root) root.hidden = true;
    window.NovaFlowBrandRuntimeAnimation?.relayout();
  }
  // React has swapped the column: its AI rows are gone (the hidden 导入工程 panel is
  // runtime-made and sits in the column in both modes, so it cannot be the sign)
  function skeletonRowsMounted() {
    const rows = document.querySelector('[data-novaflow-ai-mode-section="1"], [data-novaflow-ai-post-section="1"]');
    return !(rows && rows.getClientRects().length);
  }
  function teardownWhenSkeletonMounted() {
    cancelPendingTeardown();
    if (skeletonRowsMounted()) { teardownPage(); return; }
    const observer = new MutationObserver(() => { if (skeletonRowsMounted()) teardownPage(); });
    observer.observe(document.body, { childList: true, subtree: true });
    pendingTeardown = { observer, timer: window.setTimeout(teardownPage, 1200) };
  }
  function deactivate(silent) {
    if (!state.active) return;
    state.active = false;
    setAnimationSecondaryFlag();
    // leaving 音视 for 动画 itself: the pointerdown above already covers and switches
    const toSkeleton = silent !== true && animationEntry()?.getAttribute('aria-pressed') === 'true';
    if (toSkeleton) { beginSwitch('skeleton'); teardownWhenSkeletonMounted(); } else teardownPage();
    const cell = document.getElementById(CELL_ID);
    if (cell) { cell.setAttribute('data-novaflow-primary-cell-active', '0'); cell.querySelector('button')?.setAttribute('aria-pressed', 'false'); }
    closeDropdown();
    if (editor) editor.pause();
    stopPreview();
    syncMask();
    state.maskTarget = null;
    ensureCell(); // the idle look now - it lagged a tick behind the rail
  }
  // ---- the React 动画 section ---------------------------------------------------------------
  // Under 音视 / 视频 it runs as AI序列动画; entered from its own rail entry it is
  // 骨骼动画 only. Its AI序列动画 / 骨骼动画 toggle stays hidden either way.
  function animationEntry() { return document.querySelector('[data-novaflow-primary-entry="1"][data-novaflow-primary-label="动画"]'); }
  function secondaryButton(label) {
    return Array.from(document.querySelectorAll('[data-novaflow-secondary-entry="1"]')).find((b) => (b.textContent || '').trim() === label) || null;
  }
  let replaying = false;
  function replayClick(target) {
    if (!(target instanceof HTMLElement)) return;
    replaying = true;
    try { replayClickNow(target); } finally { replaying = false; }
  }
  function replayClickNow(target) {
    const r = target.getBoundingClientRect();
    const init = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true };
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      target.dispatchEvent(type.startsWith('pointer') ? new PointerEvent(type, init) : new MouseEvent(type, init));
    }
  }
  // The React AI序列动画 / 骨骼动画 group: the brand runtime paints it invisible
  // and decides from body[data-nf-animation-secondary] whether the content
  // starts at its spot (动画 alone) or below it (音视 / 视频, our toggle on top).
  function animationGroup() {
    const ai = secondaryButton('AI序列动画') || secondaryButton('骨骼动画');
    return (ai && ai.closest('[data-novaflow-secondary-group="1"]')) || null;
  }
  function secondaryActive(button) {
    return button.getAttribute('data-novaflow-secondary-active') === '1' || button.getAttribute('aria-pressed') === 'true';
  }
  // Entering 动画 (骨骼) or 音视 / 视频 (AI序列): nothing is covered or hidden
  // (a board over the content was itself a blank frame - recorded on the
  // screencast; without it the first painted frame is the finished page).
  // A MutationObserver only waits for React to show the wanted mode, then
  // our toggle / mask follow and the runtime gets one pass.
  let switching = null;
  function endSwitch() {
    if (!switching) return;
    switching.observer.disconnect();
    window.clearTimeout(switching.deadline);
    switching = null;
    syncSubToggle();
    syncMask();
    // one runtime pass after the mode landed (a switch interrupted mid-way skips its own)
    window.NovaFlowBrandRuntimeAnimation?.relayout();
  }
  // The AI sequence section without the runtime's layout (a switch interrupted
  // by the next click): the body lacks the class the runtime adds with it.
  let healAt = 0;
  function rawAnimationPanelShowing() {
    const root = document.querySelector('[data-novaflow-left-content-root="1"]');
    if (!root) return false;
    for (const node of root.querySelectorAll('div, span, label')) {
      if (node.childElementCount) continue;
      const t = (node.textContent || '').trim();
      if ((t === '模式选择' || t === '模型方式') && node.getBoundingClientRect().height > 10) return true;
    }
    return false;
  }
  function healAnimationLayout() {
    const entry = animationEntry();
    if (!entry || entry.getAttribute('aria-pressed') !== 'true' || switching) return;
    const now = performance.now();
    if (now - healAt < 900) return;
    // the mode the section should be in (a burst of clicks can leave the other one)
    const want = state.active ? 'AI序列动画' : '骨骼动画';
    const wanted = secondaryButton(want);
    if (wanted && !secondaryActive(wanted)) { healAt = now; window.NovaFlowBrandRuntimeAnimation?.syncSecondary(); return; }
    const ai = secondaryButton('AI序列动画');
    if (!ai || !secondaryActive(ai)) return;
    // the AI sequence section without the runtime's layout
    if (!document.body.classList.contains('novaflow-ai-animation-section-layers') || rawAnimationPanelShowing()) { healAt = now; window.NovaFlowBrandRuntimeAnimation?.relayout(); }
  }
  function beginSwitch(mode) {
    endSwitch();
    const wantLabel = mode === 'skeleton' ? '骨骼动画' : 'AI序列动画';
    const settle = () => {
      if (!switching) return;
      if (animationEntry()?.getAttribute('aria-pressed') !== 'true') return;
      const button = secondaryButton(wantLabel);
      if (!button) return;
      // the brand runtime switches the mode itself (data-nf-animation-secondary)
      if (!secondaryActive(button)) return;
      endSwitch();
    };
    const observer = new MutationObserver(settle);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-novaflow-secondary-active', 'aria-pressed'] });
    switching = { observer, deadline: window.setTimeout(endSwitch, 1000) };
    settle();
  }
  function ensureAnimationSection() {
    const entry = animationEntry();
    if (!entry) return;
    beginSwitch('ai');
    if (entry.getAttribute('aria-pressed') !== 'true') replayClick(entry);
  }
  // a user's click on 动画 enters it as 骨骼 under the cover
  document.addEventListener('pointerdown', (event) => {
    if (replaying) return;
    const target = event.target instanceof Element ? event.target : null;
    const entry = target && target.closest('[data-novaflow-primary-entry="1"][data-novaflow-primary-label="动画"]');
    if (!entry) return;
    if (state.active) deactivateSilently();
    beginSwitch('skeleton');
  }, true);
  // 视频 | 音频 over the React toggle's spot while 音视 / 视频 is active
  function syncSubToggle() {
    let toggle = document.getElementById(SUB_TOGGLE_ID);
    if (!(state.active && state.sub === 'video')) { if (toggle) toggle.remove(); return; }
    const group = animationGroup();
    if (!group) { if (toggle) toggle.hidden = true; return; }
    if (!toggle) {
      toggle = el('div', 'nf-as-mode');
      toggle.id = SUB_TOGGLE_ID;
      toggle.setAttribute('data-novaflow-runtime-ignore', '1');
      const video = el('button', null, '视频'); video.type = 'button'; video.setAttribute('aria-pressed', 'true'); video.setAttribute('data-novaflow-source-layout', '1'); video.style.setProperty('border-radius', '5px', 'important');
      const audio = el('button', null, '音频'); audio.type = 'button'; audio.setAttribute('aria-pressed', 'false'); audio.setAttribute('data-novaflow-source-layout', '1'); audio.style.setProperty('border-radius', '5px', 'important');
      audio.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); activate('audio'); });
      for (const b of [video, audio]) for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) b.addEventListener(type, (e) => e.stopPropagation(), true);
      toggle.appendChild(video); toggle.appendChild(audio);
      document.body.appendChild(toggle);
    }
    toggle.hidden = false;
    const r = group.getBoundingClientRect();
    if (r.width < 10) { toggle.hidden = true; return; }
    const want = { left: Math.round(r.left) + 'px', top: Math.round(r.top) + 'px', width: Math.round(r.width) + 'px', height: Math.round(r.height) + 'px' };
    for (const key of Object.keys(want)) if (toggle.style.getPropertyValue(key) !== want[key]) toggle.style.setProperty(key, want[key], 'important');
  }
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    // any rail or secondary click: settle the 动画 mode once React has switched
    if (!state.active || replaying) return;
    if (target && target.closest('[data-novaflow-primary-entry="1"]')) deactivate();
  }, true);
  // The rail's 导出 is the one export entry for every section. While 音频 is
  // open it renders the timeline mix; an unlicensed install keeps the
  // runtime's own licence prompt.
  document.addEventListener('click', (event) => {
    // only while 音频 is showing: under 视频 the export is the board's own video
    if (!state.active || state.sub !== 'audio' || !editor) return;
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
      #${CELL_ID} button{color:var(--nf-cell-color,#9c9c9c)!important}
      #${CELL_ID} button::before{content:"";display:block;flex:0 0 auto;width:19px;height:19px;background-color:currentColor;-webkit-mask:var(--nf-rail-icon) center / contain no-repeat;mask:var(--nf-rail-icon) center / contain no-repeat}
      #${CELL_ID} button::after{content:attr(data-novaflow-primary-label);display:block;white-space:nowrap}
      #${CELL_ID}[data-novaflow-primary-cell-active="0"] button:hover{background:#373737!important;background-color:#373737!important;color:#ffffff!important}
      /* the pressed / idle look is copied from the React entries at runtime (copyCellLook) */
      #${MASK_ID}{position:fixed;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;margin:0;padding:0 6px;border:0;outline:0;box-shadow:none;background:var(--nf-mask-bg,#161616);background-clip:padding-box;color:#9c9c9c;font-size:11px;font-weight:500;line-height:1.2;cursor:pointer;font-family:inherit;box-sizing:border-box;isolation:isolate}
      /* the hover fill is a rounded face one pixel inside the square mask */
      #${MASK_ID} > i{position:absolute;inset:1px;border-radius:var(--nf-mask-radius,7px);background:transparent;z-index:-1}
      #${MASK_ID}::before{content:"";display:block;width:19px;height:19px;background-color:currentColor;-webkit-mask:var(--nf-rail-icon) center / contain no-repeat;mask:var(--nf-rail-icon) center / contain no-repeat}
      #${MASK_ID}::after{content:attr(data-nf-mask-label);display:block;white-space:nowrap}
      #${MASK_ID}:hover{color:#ffffff}
      #${MASK_ID}:hover > i{background:#373737}

      /* above every section's own layers (美工 lifts its panel to 2147483621), below the rail shortcuts, the warehouse and the modal layer */
      #${ROOT_ID}{position:fixed;inset:0;z-index:2147483625;pointer-events:none;color:#e8eaed;font-size:12px;font-weight:400;font-family:inherit}
      #${ROOT_ID}[hidden]{display:none!important}
      #${ROOT_ID} *{box-sizing:border-box;font-family:inherit}
      #${ROOT_ID} button{font-family:inherit;cursor:pointer;outline:0;transition:none}
      #${ROOT_ID} input,#${ROOT_ID} textarea{font-family:inherit}
      #${ROOT_ID} button:focus,#${ROOT_ID} textarea:focus,#${ROOT_ID} input:focus{outline:0;box-shadow:none}
      #${ROOT_ID} > *{pointer-events:auto}
      #${ROOT_ID} [data-nf-label]::after{content:attr(data-nf-label)}
      .nf-as-left,.nf-as-stage,.nf-as-sidebar,.nf-as-dock,.nf-as-transport,.nf-as-backdrop{position:fixed}
      .nf-as-backdrop{pointer-events:auto}
      /* the cards' container: see-through in the wide and narrow tiers; in the
         stack tier a scrolling column under the top bar, so the timeline keeps
         a working height and the rest scrolls instead of piling up */
      #${ROOT_ID} > .nf-as-scroller{position:fixed;inset:0;pointer-events:none;overflow:visible}
      .nf-as-scroller > *{pointer-events:auto}
      #${ROOT_ID} > .nf-as-scroller.nf-as-stacked{inset:auto;pointer-events:auto;overflow:hidden auto;overscroll-behavior:contain}
      .nf-as-stacked > .nf-as-left,.nf-as-stacked > .nf-as-stage,.nf-as-stacked > .nf-as-sidebar,.nf-as-stacked > .nf-as-dock,.nf-as-stacked > .nf-as-transport,.nf-as-stacked > .nf-as-backdrop{position:absolute}
      .nf-as-spacer{position:absolute;left:0;top:0;width:1px;height:0;pointer-events:none}
      .nf-as-scroller::-webkit-scrollbar{width:6px}.nf-as-scroller::-webkit-scrollbar-thumb{background:#3a3a3a}
      /* left card: the section panel */
      .nf-as-left{background:var(--nf-ref-panel,#161616);border:1px solid var(--nf-ref-line,#2e2e2e);border-radius:var(--nf-ref-radius-panel,12px);padding:10px 9px 9px;overflow:hidden auto;display:flex;flex-direction:column;gap:0}
      /* the runtime's secondary group: #101010 / #262626 / 8px, 3px pad and gap, 29px pills (5px), active #1c4136 + #9be4cd with a #2c604f ring */
      #${ROOT_ID} .nf-as-mode,#${SUB_TOGGLE_ID}{display:grid!important;grid-template-columns:1fr 1fr!important;gap:3px!important;padding:3px!important;background:#101010!important;border:1px solid #262626!important;border-radius:8px!important;box-sizing:border-box!important;height:37px!important;align-items:center!important;box-shadow:none!important}
      #${ROOT_ID} .nf-as-mode{margin:0 0 17px}
      #${ROOT_ID} .nf-as-mode button,#${SUB_TOGGLE_ID} button{height:29px!important;min-height:29px!important;max-height:29px!important;min-width:0!important;width:auto!important;margin:0!important;border:0!important;border-radius:5px!important;background:transparent!important;color:#eaeaea!important;font-size:12px!important;font-weight:500!important;line-height:normal!important;padding:0 6px!important;box-shadow:none!important;letter-spacing:normal!important;outline:0!important}
      .nf-as-mode-kind button:hover{--nf-mode-bg:#373737;--nf-mode-c:#fff}
      #${ROOT_ID} .nf-as-mode button:hover,#${SUB_TOGGLE_ID} button:hover{background:#373737!important;color:#fff!important}
      #${ROOT_ID} .nf-as-mode button[aria-pressed="true"],#${SUB_TOGGLE_ID} button[aria-pressed="true"]{background:#1c4136!important;color:#9be4cd!important;box-shadow:none!important}
      .nf-as-mode.nf-as-mode-kind{margin:0 0 4px}
      /* the React AI序列动画 / 骨骼动画 toggle never shows: 动画 is 骨骼 only, 音视 / 视频 floats its own */
      #${SUB_TOGGLE_ID}{position:fixed;z-index:2147483000;margin:0;box-sizing:border-box}
      /* rows: the animation section's collapse headings - icon plate and chevron are pseudo elements */
      .nf-as-rows{display:flex;flex-direction:column;gap:0}
      .nf-as-row{padding:3px 0;border-bottom:1px solid #272727}
      .nf-as-rows > .nf-as-row:last-child,.nf-as-rows-tools > .nf-as-row:last-child{border-bottom:0}
      .nf-as-rows-tools{margin:0;padding:0;border:0;display:flex;flex-direction:column;gap:0}
      .nf-as-row-head{position:relative;display:flex;align-items:center;width:100%;height:46px;padding:0 30px 0 40px;border:0;border-radius:7px;background:transparent;color:#d4d4d4;font-size:12px;font-weight:400;line-height:12px;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .nf-as-row[data-key="generate"] .nf-as-row-head{font-weight:500;letter-spacing:.18px;border-radius:6px}
      .nf-as-row-head::before{content:"";position:absolute;left:7px;top:11px;width:24px;height:24px;border-radius:5px;background:#292929 var(--nf-as-row-icon) center / 14px 14px no-repeat}
      .nf-as-row-head::after{content:"";position:absolute;right:12px;top:50%;width:7px;height:7px;border-right:1px solid #797979;border-bottom:1px solid #797979;transform:translateY(-3.5px) rotate(-45deg)}
      .nf-as-row[data-open="1"] .nf-as-row-head::after{transform:translateY(-3.5px) rotate(45deg)}
      .nf-as-row-head:hover{background:#222222}
      .nf-as-row-body{display:none;flex-direction:column;gap:9px;padding:4px 7px 16px}
      .nf-as-row[data-open="1"] .nf-as-row-body{display:flex}
      .nf-as-label{font-size:11px;color:#9f9f9f}
      .nf-as-field{display:flex;flex-direction:column;gap:5px}
      .nf-as-input{height:28px;border:1px solid var(--nf-ref-soft,#343434);border-radius:var(--nf-r-control,6px);background:#262626;color:#e9e9e9;font-size:11px;padding:0 8px;width:100%}
      .nf-as-select{display:flex;align-items:center;width:100%;height:32px;min-height:32px;border:1px solid var(--nf-ref-soft,#343434);border-radius:var(--nf-r-control,6px);background:#262626 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='rgba(238,244,252,0.68)' stroke-width='1.35' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") calc(100% - 10px) 50% / 10px 6px no-repeat;color:#e9e9e9;font-size:12px;font-weight:400;line-height:normal;padding:0 26px 0 10px;text-align:left}
      .nf-as-select:hover{background-color:#2c2c2c}
      .nf-as-select[aria-expanded="true"]{border-color:#3d3d3d}
      .nf-as-select-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .nf-as-select-inline{width:auto;min-width:72px}
      .nf-as-ai-root{position:fixed;inset:0;z-index:8;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.58)}
      .nf-as-ai-dialog{position:relative;width:min(422px,calc(100vw - 36px));max-height:calc(100vh - 36px);display:flex;flex-direction:column;border:1px solid rgba(255,255,255,.10);border-radius:6px;background:#202020;box-shadow:0 22px 60px rgba(0,0,0,.48);overflow:hidden;color:#e8eaed}
      .nf-as-ai-header{height:50px;min-height:50px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 8px 0 16px;border-bottom:1px solid rgba(255,255,255,.09)}
      .nf-as-ai-title{font-size:14px;font-weight:400;line-height:1}
      .nf-as-ai-close{width:40px;height:40px;flex:0 0 40px;display:grid;place-items:center;padding:0;border:0;border-radius:6px;background:transparent;color:rgba(255,255,255,.62);font-size:18px;line-height:1}
      .nf-as-ai-close:hover{background:rgba(255,255,255,.08);color:#fff}
      .nf-as-ai-body{display:grid;gap:12px;padding:18px 14px 12px;overflow-y:auto}
      .nf-as-ai-section{display:flex;flex-direction:column;gap:10px}
      .nf-as-ai-label{color:rgba(229,231,235,.72);font-size:12px;font-weight:400;line-height:1}
      .nf-as-ai-engine-row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
      .nf-as-ai-engine-option{display:flex;align-items:center;gap:8px;min-height:42px;padding:8px 10px;border:1px solid rgba(255,255,255,.08);border-radius:6px;background:rgba(255,255,255,.035);color:rgba(232,237,242,.88);font-size:12px;cursor:pointer}
      .nf-as-ai-engine-option input{accent-color:#23c489;margin:0}
      .nf-as-ai-engine-meta{display:block;margin-top:2px;color:rgba(232,237,242,.46);font-size:11px}
      .nf-as-ai-textarea{width:100%;height:118px;min-height:92px;max-height:160px;resize:vertical;padding:10px 12px;border:1px solid rgba(255,255,255,.08);border-radius:6px;background:#050505;color:#edf2f7;font-size:12px;line-height:1.45}
      .nf-as-ai-textarea::placeholder{color:#6e6e6e}
      .nf-as-ai-note{color:rgba(232,237,242,.56);font-size:12px;line-height:18px}
      .nf-as-ai-message{display:none;margin:0 14px 8px;min-height:17px;padding:8px 10px;border:1px solid rgba(255,255,255,.08);border-radius:6px;background:rgba(255,255,255,.035);color:rgba(160,160,160,.96);font-size:11px;line-height:17px;white-space:pre-line;overflow-wrap:anywhere}
      .nf-as-ai-message[data-visible="1"]{display:block}
      .nf-as-ai-message[data-tone="error"]{border-color:rgba(248,113,113,.42);background:rgba(127,29,29,.18);color:rgba(254,202,202,.98)}
      .nf-as-ai-footer{display:grid;grid-template-columns:minmax(0,1fr);gap:10px;padding:0 14px 14px}
      .nf-as-ai-footer[data-busy="1"]{grid-template-columns:repeat(2,minmax(0,1fr))}
      .nf-as-ai-submit{width:100%;min-width:0;height:44px;padding:0 16px;border:0;border-radius:6px;background:#1f7a58;color:#fff;font-size:13px;font-weight:400;line-height:1}
      .nf-as-ai-submit:hover{background:#20b886}
      .nf-as-ai-submit:disabled{cursor:not-allowed;opacity:.62}
      .nf-as-ai-stop{width:100%;min-width:0;height:44px;padding:0 16px;border:1px solid rgba(239,68,68,.55);border-radius:6px;background:rgba(239,68,68,.18);color:#fff;font-size:13px;font-weight:500;line-height:1}
      .nf-as-ai-stop:hover{background:rgba(239,68,68,.28)}
      .nf-as-ai-stop[hidden]{display:none!important}
      .nf-as-dd-dim{position:fixed;inset:0;background:rgba(0,0,0,.58);z-index:5}
      .nf-as-dd-panel{position:fixed;z-index:6;overflow:auto;background:#1b1b1b;border:1px solid rgba(255,255,255,.18);border-radius:0;box-shadow:0 18px 48px rgba(0,0,0,.55);color:rgba(255,255,255,.88);font-size:12px;line-height:26px}
      .nf-as-dd-panel::-webkit-scrollbar{width:6px}.nf-as-dd-panel::-webkit-scrollbar-thumb{background:#3a3a3a}
      .nf-as-dd-item{height:26px;padding:0 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}
      .nf-as-dd-item:hover{background:rgba(255,255,255,.08)}
      .nf-as-dd-item[aria-selected="true"]{background:var(--foart-action-green,rgba(30,166,114,.24));color:#9be4cd}
      .nf-as-tools{display:grid;grid-template-columns:1fr 1fr;gap:6px}
      .nf-as-tools .nf-as-tool-primary{background:linear-gradient(135deg,#1ea672,#188f64)!important;border-color:rgba(84,234,178,.3)!important;color:#effcf6!important;font-weight:600}
      .nf-as-tools .nf-as-tool-primary:hover:not(:disabled){background:linear-gradient(135deg,#22b980,#1ea672)!important;color:#fff!important}
      .nf-as-edit-sec{display:flex;flex-direction:column;gap:6px}
      .nf-as-sidebar[hidden]{display:none!important}
      .nf-as-refswitch{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11px;color:rgba(255,255,255,.8);cursor:pointer}
      .nf-as-refswitch .nf-as-switch-text{flex:1 1 auto;min-width:0;white-space:nowrap}
      .nf-as-refswitch i{position:relative;flex:0 0 34px;width:34px;height:18px;border-radius:9px;background:#3a3a3a;transition:background .15s}
      .nf-as-refswitch i::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#ddd;transition:left .15s}
      .nf-as-refswitch[aria-checked="true"] i{background:#1EA672}.nf-as-refswitch[aria-checked="true"] i::after{left:18px}
      .nf-as-ref{position:absolute;left:0;display:grid;place-items:center;overflow:hidden;border-radius:var(--nf-ref-radius-panel,12px);background:#000;border:1px solid var(--nf-ref-line,#2e2e2e)}
      .nf-as-ref[hidden]{display:none}
      /* always fitted whole inside the preview box (a grid row grew to the video's own height) */
      .nf-as-ref video{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;max-width:none!important;max-height:none!important;object-fit:contain!important;transform:none!important}
      .nf-as-ref-empty{color:#6a6a6a;font-size:12px}
      .nf-as-ref-empty[hidden]{display:none}
      .nf-as-ref[data-drop="1"]::after{content:"释放以置入参照视频";position:absolute;inset:12px;display:flex;align-items:center;justify-content:center;border:2px dashed rgba(91,224,173,.85);border-radius:12px;background:rgba(10,61,44,.48);color:#d9fff0;font-size:13px;font-weight:600;pointer-events:none}
      .nf-as-tr-row .nf-as-tbtn.nf-as-tbtn-text{width:auto;padding:0 10px;font-size:11px}
      .nf-tl-add-track{margin-left:auto;height:18px;padding:0 4px;border:1px solid #343434;border-radius:4px;background:#262626;color:#bdbdbd;font-size:11px;line-height:16px;white-space:nowrap;flex:none;cursor:pointer}
      .nf-tl-add-track:hover{border-color:#1EA672;color:#9be4cd}
      .nf-as-busy-mask{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.55)}
      .nf-as-busy{position:fixed;left:50%;top:50%;z-index:2147483001;transform:translate(-50%,-50%);min-width:300px;max-width:440px;padding:14px 16px;border:1px solid #3c3c3c;border-radius:12px;background:rgba(29,29,29,.96);color:#eaeaea;font-size:13px;box-shadow:0 12px 32px rgba(0,0,0,.45);display:grid;gap:8px}
      .nf-as-busy[hidden],.nf-as-busy-mask[hidden]{display:none!important}
      .nf-as-busy .row{display:flex;align-items:center;gap:8px;padding-right:26px}
      .nf-as-busy .spin{width:14px;height:14px;flex:0 0 14px;border-radius:50%;border:2px solid rgba(255,255,255,.18);border-top-color:#25bc84;animation:nf-as-spin .8s linear infinite}
      .nf-as-busy[data-kind="done"] .spin,.nf-as-busy[data-kind="error"] .spin{display:none}
      @keyframes nf-as-spin{to{transform:rotate(360deg)}}
      .nf-as-busy .title{font-size:13px;font-weight:600}.nf-as-busy[data-kind="done"] .title{color:#8ff0c7}.nf-as-busy[data-kind="error"] .title{color:#fca5a5}
      .nf-as-busy .msg{color:#bdbdbd;line-height:1.5;word-break:break-word}
      .nf-as-busy .close{position:absolute;top:8px;right:8px;width:22px;height:22px;padding:0;border:1px solid #454545;border-radius:50%;background:#333;color:#ddd;font-size:13px;line-height:20px;text-align:center;cursor:pointer}
      .nf-as-busy .close:hover{background:#4a2323;border-color:#6a3030;color:#ffb4b4}
      .nf-as-tools .nf-as-tool-wide{grid-column:1 / -1}
      .nf-as-tools button,.nf-as-btn{height:32px;border:1px solid var(--nf-ref-soft,#343434);border-radius:var(--nf-r-control,6px);background:#262626;color:#e3e3e3;font-size:12px;padding:0 8px;white-space:nowrap}
      .nf-as-row[data-key="edit"] input[type=number]{height:32px;min-height:32px}
      .nf-as-tools button:hover,.nf-as-btn:hover{background:#373737;color:#fff}
      .nf-as-tools button:disabled,.nf-as-btn:disabled{opacity:.45;cursor:default}
      .nf-as-tools button[aria-pressed="true"]{background:#1c4136;border-color:#29594a;color:#9be4cd}
      .nf-as-note:empty{display:none}.nf-as-note{font-size:11px;line-height:1.6;color:#8b8b8b}
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
      .nf-as-project{left:0;display:flex;align-items:center;gap:3px;height:38px;padding:4px;background:var(--nf-ref-panel,#161616);border:1px solid var(--nf-ref-bar-line,#333333);border-radius:var(--nf-ref-radius-bar,9px);box-shadow:0 3px 7px rgba(0,0,0,.133);white-space:nowrap}
      .nf-as-tabs{display:flex;gap:3px}
      .nf-as-project .nf-as-name{width:116px;height:28px;border:1px solid var(--nf-ref-soft,#343434);border-radius:var(--nf-r-control,6px);background:#262626;color:#e9e9e9;font-size:11px;padding:0 6px}
      #${ROOT_ID} .nf-as-project .nf-as-tab[aria-pressed="false"]{background:#252629;color:#969aa2;border-color:transparent!important}
      /* under the root id: the runtime clears every button's border while the AI workspace layers are up */
      #${ROOT_ID} .nf-as-project .nf-as-tab{width:26px;height:28px;padding:4px 10px;display:flex;align-items:center;justify-content:center;border:1px solid #2c604f!important;border-radius:5px;background:#1c4136;color:#9be4cd;font-size:11px;font-weight:500}
      .nf-as-project .nf-as-tab-add,.nf-as-project .nf-as-tab-del{width:38px;height:28px;padding:4px 10px;display:flex;align-items:center;justify-content:center;border:1px solid transparent;border-radius:5px;background:transparent;color:#a0a0a0;font-size:11px;font-weight:500}
      .nf-as-project .nf-as-tab-add:hover{background:#373737;color:#fff}
      .nf-as-project .nf-as-tab-del:hover{background:#4a2323;color:#ffb4b4}
      .nf-as-project .nf-as-tab-del:disabled{background:#252629;color:#969aa2;opacity:.38!important;cursor:not-allowed}
      .nf-as-project input{width:116px;height:28px;border:1px solid #343434;border-radius:6px;background:#262626;color:#e9e9e9;font-size:11px;padding:0 6px}
      .nf-as-zoom{right:0;display:flex;align-items:center;height:38px;padding:4px;gap:3px;margin-right:0;background:var(--nf-ref-panel,#161616);border:1px solid var(--nf-ref-bar-line,#333333);border-radius:var(--nf-ref-radius-bar,9px);box-shadow:0 3px 7px rgba(0,0,0,.133);white-space:nowrap}
      .nf-as-zoom span{min-width:44px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:7px;background:transparent;color:#9a9a9a;font-size:11px;font-weight:500;padding:0}
      .nf-as-zoom button{height:28px;border:1px solid transparent;border-radius:5px;background:transparent;color:#a0a0a0;font-size:11px;font-weight:500;padding:4px 10px}
      .nf-as-zoom button:hover{background:#373737;color:#fff}
      .nf-as-zoom button[disabled]{opacity:.38!important;cursor:default}
      .nf-as-zoom button[disabled]:hover{color:#a0a0a0;background:transparent}
      /* the timeline is a card in the same column as the dock and the transport: same edges, same surface */
      .nf-as-timeline{position:absolute;left:0;right:0;top:53px;bottom:8px;border-radius:var(--nf-ref-radius-panel,12px);overflow:hidden;background:var(--nf-ref-panel,#161616);border:1px solid var(--nf-ref-line,#2e2e2e)}
      .nf-as-empty{position:absolute;left:132px;top:24px;right:0;bottom:0;display:grid;place-items:center;text-align:center;color:#6f6f6f;font-size:12px;line-height:1.9;pointer-events:none;padding:0 12px}
      /* timeline editor */
      .nf-tl{position:absolute;inset:0;display:grid;grid-template-columns:132px minmax(0,1fr)}
      .nf-tl-headers{position:relative;background:#161616;border-right:1px solid #2a2a2a;overflow:hidden}
      .nf-tl-headers-top{height:24px;line-height:24px;padding:0 6px 0 10px;font-size:11px;color:#8d8d8d;background:#161616;border-bottom:1px solid #2a2a2a;display:flex;align-items:center;gap:4px}
      .nf-tl-header-list{will-change:transform}
      .nf-tl-header{display:flex;flex-direction:column;justify-content:center;gap:5px;padding:0 8px;margin-bottom:4px;border-bottom:1px solid #222}
      .nf-tl-track-name{height:22px;border:1px solid transparent;border-radius:5px;background:transparent;color:#e9e9e9;font-size:11px;font-weight:500;padding:0 5px;width:100%}
      .nf-tl-track-name:hover,.nf-tl-track-name:focus{background:#262626;border-color:#343434}
      .nf-tl-track-btns{display:flex;gap:4px}
      .nf-tl-track-btns button{width:24px;height:20px;border:1px solid #343434;border-radius:5px;background:#262626;color:#bdbdbd;font-size:11px;font-weight:600;padding:0}
      .nf-tl-track-btns button[aria-pressed="true"]{background:#1c4136;border-color:#29594a;color:#9be4cd}
      .nf-tl-track-btns .nf-tl-track-del{margin-left:auto;font-size:13px;font-weight:400}
      .nf-tl-track-btns button:hover{background:#373737;color:#fff}
      .nf-tl-track-btns button[aria-pressed="true"]:hover{background:#235242;color:#b8f0dd}
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
      .nf-as-dock{background:var(--nf-ref-panel,#161616);border:1px solid var(--nf-ref-dock-line,#363636);border-radius:var(--nf-ref-radius-panel,12px);padding:13px 14px;display:grid;grid-template-rows:auto 18px 1px minmax(0,1fr);row-gap:9px}
      .nf-as-dock-progress{height:1px;border-radius:0;background:#2d2d2d;overflow:hidden}
      .nf-as-dock-progress i{display:block;height:100%;width:0;background:#1ea672;transition:width .3s linear}
      .nf-as-dock[hidden]{display:none!important}
      .nf-as-dock-row{display:flex;align-items:center;flex-wrap:wrap;gap:8px 10px;min-height:32px}
      .nf-as-dock-row .nf-as-label{white-space:nowrap;color:#a9a9a9}
      .nf-as-dock-row input[type=number]{width:49px;height:28px;border:1px solid var(--nf-ref-soft,#343434);border-radius:var(--nf-r-control,6px);background:#272727;color:#e9e9e9;font-size:11px;padding:0 6px;text-align:center}
      .nf-as-switch{width:27px;height:15px;border-radius:15px;border:0;background:#3a3a3a;position:relative;padding:0;flex:none}
      .nf-as-switch::after{content:"";position:absolute;top:3px;left:3px;width:9px;height:9px;border-radius:50%;background:#ddd}
      .nf-as-switch[aria-checked="true"]{background:#1ea672}.nf-as-switch[aria-checked="true"]::after{left:15px;background:#fff}
      .nf-as-go{margin-left:auto;width:104px;height:32px;border:1px solid #24b693;border-radius:var(--nf-ref-radius-control,7px);background:#1ea672;color:#fff;font-size:12px;font-weight:600;padding:5px 10px;display:inline-flex;align-items:center;justify-content:center;gap:6px}
      .nf-as-go::before{content:"";display:block;flex:0 0 auto;width:14px;height:14px;background-color:currentColor;-webkit-mask:var(--nf-as-go-icon) center/contain no-repeat;mask:var(--nf-as-go-icon) center/contain no-repeat}
      .nf-as-go:hover{background:#22b87f}.nf-as-go:disabled{opacity:.45;cursor:default}
      .nf-as-status{display:flex;align-items:center;gap:8px;height:18px;font-size:11px;color:#7a7a7a}
      .nf-as-status .nf-as-pct{color:#cfcfcf}
      .nf-as-status .nf-as-err{color:#f09595;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
      .nf-as-cancel{margin-left:auto;height:18px;border:0;border-radius:7px;background:rgba(239,68,68,.18);color:#ffb4b4;font-size:11px;padding:0 8px}
      .nf-as-cancel[hidden]{display:none}
      .nf-as-prompt{display:grid;grid-template-rows:33px minmax(0,1fr);background:#202020;border:1px solid #353535;border-radius:8px;overflow:hidden;min-height:0;margin-top:-3px;width:100%;min-width:0;max-width:none;box-sizing:border-box}
      .nf-as-prompt-head{display:flex;align-items:center;justify-content:space-between;padding:4px 7px;border-bottom:1px solid rgba(255,255,255,.22)}
      .nf-as-prompt:focus-within .nf-as-prompt-head{border-bottom-color:#1ea672}
      .nf-as-prompt-head .nf-as-chip{height:24px;border:1px solid transparent;border-radius:7px;background:transparent;color:#9f9f9f;font-size:11px;font-weight:500;padding:3px 7px;display:flex;align-items:center;gap:7px}
      .nf-as-prompt-head button.nf-as-chip:hover{background:#373737;color:#fff}
      .nf-as-prompt-head button.nf-as-chip[aria-pressed="true"]{color:#9be4cd}
      .nf-as-prompt textarea{display:block;width:100%;height:100%;resize:none;border:0;background:#202020;color:#c9c9c9;font-size:12px;line-height:1.5;padding:12px 14px}
      .nf-as-prompt textarea::placeholder{color:#6e6e6e}
      /* transport */
      .nf-as-transport{background:var(--nf-ref-panel,#161616);border:1px solid var(--nf-ref-line,#2e2e2e);border-radius:var(--nf-ref-radius-panel,12px);padding:9px 12px;display:flex;flex-direction:column;justify-content:flex-start}
      .nf-as-tr-row{display:flex;align-items:center;gap:8px 8px;flex-wrap:wrap;white-space:nowrap;min-width:0;min-height:30px;flex:0 0 auto}
      .nf-as-tr-row .nf-as-tbtn{width:30px;height:30px;border:1px solid transparent;border-radius:var(--nf-ref-radius-control,7px);background:#282828;color:#eaeaea;display:grid;place-items:center;padding:0}
      .nf-as-tr-row .nf-as-tbtn:hover{background:#373737;color:#fff}
      .nf-as-tr-row .nf-as-tbtn[aria-pressed="true"]{background:#193d33;color:#8ee0c5;border-color:#306553}
      .nf-as-tr-row .nf-as-tbtn svg{display:block;width:18px;height:18px}
      .nf-as-time{font-size:11px;color:#cfcfcf;min-width:110px;font-variant-numeric:tabular-nums;margin-left:6px}
      .nf-as-tr-row .nf-as-label{margin-left:10px}
      .nf-as-tr-row input[type=number]{width:49px;height:28px;border:1px solid var(--nf-ref-soft,#343434);border-radius:var(--nf-r-control,6px);background:#272727;color:#e9e9e9;font-size:11px;padding:0 6px;text-align:center}
      .nf-as-tr-row label.nf-as-check{display:flex;align-items:center;gap:5px;font-size:11px;color:#bdbdbd}
      .nf-as-tr-row input[type=checkbox]{width:13px;height:13px;accent-color:#1ea672}
      .nf-as-tr-right{margin-left:auto;display:flex;align-items:center;gap:8px}
      .nf-as-tr-right input[type=range]{-webkit-appearance:none;appearance:none;width:124px;height:12px;background:linear-gradient(90deg,#20c997 0%,#20c997 var(--nf-range-pct,0%),#303030 var(--nf-range-pct,0%),#303030 100%) center / 100% 2px no-repeat;margin:0}
      .nf-as-tr-right input[type=range]::-webkit-slider-runnable-track{height:2px;background:transparent}
      .nf-as-tr-right input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:12px;height:12px;margin-top:-5px;border-radius:50%;background:#dfe7ee;border:0}
      /* resource sidebar */
      .nf-as-sidebar{background:var(--nf-ref-panel,#161616);border:1px solid var(--nf-ref-line,#2e2e2e);border-radius:var(--nf-ref-radius-panel,12px);display:flex;flex-direction:column;overflow:hidden}
      .nf-as-side-head{display:flex;align-items:center;gap:8px;padding:14px 12px;font-size:13px}
      .nf-as-side-head .nf-as-count{color:#9aa0a6;font-size:12px;flex:1}
      .nf-as-side-head button{height:28px;border:1px solid var(--nf-ref-soft,#343434);border-radius:var(--nf-r-control,6px);background:#262626;color:#e3e3e3;font-size:11px;padding:0 10px}
      .nf-as-side-head button:hover{background:#373737;color:#fff}
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
      .nf-as-res-name small{color:#9aa0a6;font-size:11px}
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
  // The global sheet flattens every button to 400/no shadow with !important;
  // the native panel gets its 500 and the selected inset line written inline
  // by the brand runtime, so these are written inline too.
  function imp(node, styles) {
    for (const [key, value] of Object.entries(styles)) node.style.setProperty(key, value, 'important');
  }
  // The brand runtime restyles controls it recognises by their text
  // (自动适配, a percent next to it, 开始生成, 任务中止, 上传资源) and would take
  // this panel's over as the animation page's own. Those labels are drawn by
  // CSS from an attribute, so the text never sits in the DOM.
  function label(node, text) {
    node.textContent = '';
    node.setAttribute('data-nf-label', text);
    node.setAttribute('aria-label', text);
    return node;
  }
  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  // A native <select> is portalled by the brand runtime into its global
  // dropdown layer, which also lifts the section underneath over this panel.
  // This dropdown draws the same field and the same panel (#1b1b1b, 26px
  // rows, the selected row in green) inside the overlay instead.
  function dropdown(options, value, onChange, cls) {
    const trigger = el('button', 'nf-as-select' + (cls ? ' ' + cls : '')); trigger.type = 'button';
    const text = el('span', 'nf-as-select-text');
    trigger.appendChild(text);
    const api = {
      trigger, options, value,
      set(next) { api.value = next; const item = options.find((o) => String(o[0]) === String(next)) || options[0]; text.textContent = item ? item[1] : ''; },
      get() { return api.value; }
    };
    api.set(value);
    trigger.addEventListener('click', (event) => { event.stopPropagation(); if (openDropdown && openDropdown.api === api) closeDropdown(); else showDropdown(api, (next) => { api.set(next); onChange(next); }); });
    return api;
  }
  let openDropdown = null;
  function showDropdown(api, pick) {
    closeDropdown();
    const rect = api.trigger.getBoundingClientRect();
    const dim = el('div', 'nf-as-dd-dim');
    const panel = el('div', 'nf-as-dd-panel');
    panel.setAttribute('role', 'listbox');
    for (const [key, label] of api.options) {
      const item = el('div', 'nf-as-dd-item', label);
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(String(key) === String(api.value)));
      item.addEventListener('click', (event) => { event.stopPropagation(); closeDropdown(); pick(key); });
      panel.appendChild(item);
    }
    const width = Math.max(160, Math.round(rect.width));
    const height = Math.min(api.options.length * 26 + 2, Math.max(120, window.innerHeight - rect.bottom - 16));
    const top = rect.bottom + 4 + height <= window.innerHeight ? rect.bottom + 4 : Math.max(8, rect.top - 4 - height);
    panel.style.left = Math.round(Math.min(rect.left, window.innerWidth - width - 8)) + 'px';
    panel.style.top = Math.round(top) + 'px';
    panel.style.width = width + 'px';
    panel.style.maxHeight = height + 'px';
    dim.addEventListener('click', closeDropdown);
    ui.root.appendChild(dim); ui.root.appendChild(panel);
    api.trigger.setAttribute('aria-expanded', 'true');
    openDropdown = { api, dim, panel };
  }
  function closeDropdown() {
    if (!openDropdown) return;
    openDropdown.dim.remove(); openDropdown.panel.remove();
    openDropdown.api.trigger.setAttribute('aria-expanded', 'false');
    openDropdown = null;
  }
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (openDropdown) { closeDropdown(); event.stopPropagation(); }
  }, true);
  function selectField(parent, label, options, value, onChange) {
    const field = el('div', 'nf-as-field');
    field.appendChild(el('div', 'nf-as-label', label));
    const api = dropdown(options, value, onChange);
    field.appendChild(api.trigger);
    parent.appendChild(field);
    return api;
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
  // the sparkle on the React 开始生成 button (its ::before mask)
  const GO_ICON = "url(\"data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22black%22%3E%3Cpath d=%22M11 2.5l1.8 5.2 5.2 1.8-5.2 1.8L11 16.5l-1.8-5.2L4 9.5l5.2-1.8z%22/%3E%3Cpath d=%22M18.5 14l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z%22/%3E%3C/svg%3E\")";
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
    ui.scroller = el('div', 'nf-as-scroller');
    root.appendChild(ui.scroller);
    ui.backdrop = el('div', 'nf-as-backdrop');
    ui.scroller.appendChild(ui.backdrop);
    ui.spacer = el('div', 'nf-as-spacer');
    ui.scroller.appendChild(ui.spacer);

    // left card ---------------------------------------------------------------
    const left = el('div', 'nf-as-left');
    // 音视's sub-entries: 视频 hands over to the AI sequence section, 音频 is this overlay
    // (data-novaflow-source-layout: the runtime's page-wide rules - font-weight 400 on
    // everything not source-owned, disabled opacity - skip elements that carry it)
    const sub = el('div', 'nf-as-mode');
    const subVideo = el('button', null, '视频'); subVideo.type = 'button'; subVideo.setAttribute('data-novaflow-source-layout', '1'); subVideo.style.setProperty('border-radius', '5px', 'important'); subVideo.setAttribute('aria-pressed', 'false');
    const subAudio = el('button', null, '音频'); subAudio.type = 'button'; subAudio.setAttribute('data-novaflow-source-layout', '1'); subAudio.style.setProperty('border-radius', '5px', 'important'); subAudio.setAttribute('aria-pressed', 'true');
    subVideo.addEventListener('click', () => activate('video'));
    sub.appendChild(subVideo); sub.appendChild(subAudio);
    left.appendChild(sub);
    ui.subToggle = sub;

    const rows = el('div', 'nf-as-rows');
    left.appendChild(rows);
    const gen = row(rows, 'generate', '音频生成', ROW_ICONS.generate);
    ui.genBody = gen.body;
    // 背景音乐 | 音效 lives inside 音频生成
    const mode = el('div', 'nf-as-mode nf-as-mode-kind');
    const modeMusic = el('button', null, '背景音乐'); modeMusic.type = 'button'; modeMusic.setAttribute('data-novaflow-source-layout', '1'); modeMusic.style.setProperty('border-radius', '5px', 'important');
    const modeSfx = el('button', null, '音效'); modeSfx.type = 'button'; modeSfx.setAttribute('data-novaflow-source-layout', '1'); modeSfx.style.setProperty('border-radius', '5px', 'important');
    modeMusic.addEventListener('click', () => setMode('music'));
    modeSfx.addEventListener('click', () => setMode('sfx'));
    mode.appendChild(modeMusic); mode.appendChild(modeSfx);
    gen.body.appendChild(mode);
    ui.modeMusic = modeMusic; ui.modeSfx = modeSfx; ui.modeKind = mode;
    const toolRows = el('div', 'nf-as-rows-tools');
    rows.appendChild(toolRows);
    const tools = row(toolRows, 'edit', '音频编辑', ROW_ICONS.edit);
    // 视频预览: a reference video over the timeline, dragged in from the resource list
    const previewSec = el('div', 'nf-as-edit-sec');
    previewSec.appendChild(el('div', 'nf-as-label', '视频预览'));
    const previewRow = el('div', 'nf-as-refswitch'); previewRow.setAttribute('role', 'switch'); previewRow.setAttribute('aria-checked', 'false');
    previewRow.appendChild(el('div', 'nf-as-switch-text', '置入视频预览')); previewRow.appendChild(el('i'));
    previewRow.addEventListener('click', () => setReferencePreview(!state.refPreview.enabled));
    previewSec.appendChild(previewRow);
    ui.previewSwitch = previewRow;
    ui.previewName = el('div', 'nf-as-note', '');
    previewSec.title = '把资源列表里的视频拖到舞台上方置入';
    previewSec.appendChild(ui.previewName);
    tools.body.appendChild(previewSec);
    // selected clip: volume and fades
    const insp = el('div', 'nf-as-inspector');
    ui.inspTitle = el('div', 'nf-as-label', '未选中片段');
    insp.appendChild(ui.inspTitle);
    const gainRow = el('label', 'nf-as-slider');
    gainRow.appendChild(el('span', null, '音量'));
    ui.inspGain = el('input'); ui.inspGain.type = 'number'; ui.inspGain.min = '0'; ui.inspGain.max = '200'; ui.inspGain.step = '1'; ui.inspGain.value = '100'; ui.inspGain.className = 'nf-as-input nf-as-loop-count';
    ui.inspGain.addEventListener('input', () => { const clip = editor.selectedClip(); if (clip) editor.setGain(clip.id, Math.max(0, Math.min(200, Number(ui.inspGain.value) || 0)) / 100); });
    gainRow.appendChild(ui.inspGain); gainRow.appendChild(el('span', 'nf-as-slider-value', '%'));
    // the clip 音量 row stays out of the panel (the track slider is the volume); the input lives on for the state sync
    const slider = (label, min, max, step, format, apply) => {
      const rowEl = el('label', 'nf-as-slider');
      rowEl.appendChild(el('span', null, label));
      const input = el('input'); input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(min);
      const value = el('span', 'nf-as-slider-value', format(min));
      const paint = () => { const lo = Number(input.min), hi = Number(input.max); const pct = hi > lo ? (Number(input.value) - lo) / (hi - lo) * 100 : 0; input.style.setProperty('--nf-range-pct', pct + '%'); value.textContent = format(Number(input.value)); };
      input.addEventListener('input', () => { paint(); const clip = editor.selectedClip(); if (clip) apply(clip, Number(input.value)); });
      rowEl.appendChild(input); rowEl.appendChild(value);
      insp.appendChild(rowEl);
      return { input, paint, set(v) { input.value = String(v); paint(); }, range(lo, hi) { input.min = String(lo); input.max = String(hi); paint(); } };
    };
    ui.inspFadeIn = slider('淡入', 0, 30, 0.1, (v) => v.toFixed(1) + ' s', (clip, v) => editor.setFade(clip.id, v, undefined));
    ui.inspFadeOut = slider('淡出', 0, 30, 0.1, (v) => v.toFixed(1) + ' s', (clip, v) => editor.setFade(clip.id, undefined, v));
    const delRow = el('div', 'nf-as-tools');
    const delClip = el('button', null, '删除'); delClip.type = 'button'; delClip.title = '删除选中片段 (Delete)'; delClip.classList.add('nf-as-tool-wide');
    delClip.addEventListener('click', () => editor.deleteSelected());
    delRow.appendChild(delClip);
    insp.appendChild(delRow);
    tools.body.appendChild(insp);
    // 保存: the mixdown into the resource list and the warehouse; with a reference video also the video carrying it
    const saveSec = el('div', 'nf-as-edit-sec');
    saveSec.appendChild(el('div', 'nf-as-label', '保存'));
    const saveGrid = el('div', 'nf-as-tools');
    const save = el('button', null, '保存到资源列表'); save.type = 'button'; save.classList.add('nf-as-tool-wide'); save.setAttribute('data-foart-action', 'neutral');
    save.addEventListener('click', () => saveMix());
    saveGrid.appendChild(save);
    saveSec.appendChild(saveGrid);
    ui.saveNote = el('div', 'nf-as-note', '');
    save.title = '混音存入资源列表和仓库；置入视频后同时再存一份带混音的视频。';
    saveSec.appendChild(ui.saveNote);
    saveSec.title = '快捷键：空格 播放/暂停 · S 分割 · Delete 删除 · Ctrl+C / Ctrl+V 复制粘贴 · Ctrl+A 全选 · Ctrl/Shift 点选多选 · 空白处拖动框选 · Ctrl+滚轮 缩放 · Home 回到开头';
    tools.body.appendChild(saveSec);
    const closeSec = el('div', 'nf-as-edit-sec');
    const closeGrid = el('div', 'nf-as-tools');
    const closeRow = el('button', null, '关闭'); closeRow.type = 'button'; closeRow.classList.add('nf-as-tool-wide');
    closeRow.addEventListener('click', () => { state.open = ''; renderRows(); layout(); });
    closeGrid.appendChild(closeRow); closeSec.appendChild(closeGrid); tools.body.appendChild(closeSec);
    syncInspector(null);
    ui.scroller.appendChild(left);
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
    ui.boardDel = del;
    const name = el('input', 'nf-as-name'); name.value = 'audio_1'; name.title = '画板名称'; name.setAttribute('data-novaflow-runtime-ignore', '1');
    name.addEventListener('change', () => { const b = state.boards[state.board]; const v = name.value.trim().slice(0, 40) || ('audio_' + (state.board + 1)); name.value = v; if (b) b.name = v; });
    ui.boardName = name;
    project.appendChild(ui.tabs); project.appendChild(add); project.appendChild(del); project.appendChild(name);
    const zoom = el('div', 'nf-as-zoom');
    ui.zoomLabel = label(el('span'), '100%');
    const fit = label(el('button'), '自动适配'); fit.type = 'button'; fit.setAttribute('data-novaflow-source-layout', '1'); fit.title = '缩放到整段可见'; fit.addEventListener('click', () => { editor.fitToWindow(); syncZoom(); });
    zoom.appendChild(ui.zoomLabel); zoom.appendChild(fit); ui.fitButton = fit;
    topbar.appendChild(project); topbar.appendChild(zoom);
    stage.appendChild(topbar);
    const refStage = el('div', 'nf-as-ref'); refStage.hidden = true;
    ui.refEmpty = el('div', 'nf-as-ref-empty', '把资源列表里的视频拖到这里置入参照视频');
    ui.refVideo = el('video'); ui.refVideo.muted = true; ui.refVideo.playsInline = true; ui.refVideo.hidden = true;
    refStage.appendChild(ui.refEmpty); refStage.appendChild(ui.refVideo);
    refStage.addEventListener('dragover', (event) => { if (readResourceDragId(event) || Array.from(event.dataTransfer?.types || []).includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; refStage.setAttribute('data-drop', '1'); } });
    refStage.addEventListener('dragleave', () => refStage.removeAttribute('data-drop'));
    refStage.addEventListener('drop', async (event) => {
      refStage.removeAttribute('data-drop');
      const id = readResourceDragId(event);
      const file = Array.from(event.dataTransfer?.files || []).find((f) => /^video\//.test(f.type || '') || VIDEO_FILE.test(f.name || ''));
      if (!id && !file) return;
      event.preventDefault(); event.stopPropagation();
      try { await setReferenceVideo(id ? await resolveResourceMedia(id) : { blob: file, fileName: file.name, url: URL.createObjectURL(file) }); }
      catch (error) { ui.statusErr.textContent = String(error?.message || error); }
    });
    stage.appendChild(refStage);
    ui.refStage = refStage;
    const timelineHost = el('div', 'nf-as-timeline');
    stage.appendChild(timelineHost);
    timelineHost.addEventListener('dragover', (event) => { if (Array.from(event.dataTransfer?.types || []).includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } });
    timelineHost.addEventListener('drop', async (event) => {
      const files = droppedMediaFiles(event);
      if (!files.length) return;
      event.preventDefault(); event.stopPropagation();
      for (const f of files) { const res = await importFile(f); if (res) editor.addClip({ buffer: res.buffer, name: res.name, kind: res.kind, loopable: res.loopable, start: editor.playhead() }); }
    });
    ui.empty = el('div', 'nf-as-empty');
    ui.empty.innerHTML = '<div>时间轴还是空的<br><span style="color:#5a5a5a">生成后自动放入，或从资源列表拖入</span></div>';
    timelineHost.appendChild(ui.empty);
    ui.scroller.appendChild(stage);
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
    ui.cancel = label(el('button', 'nf-as-cancel'), '任务中止'); ui.cancel.type = 'button'; ui.cancel.hidden = true;
    ui.cancel.addEventListener('click', cancelRunning);
    status.appendChild(ui.statusText); status.appendChild(ui.statusPct); status.appendChild(ui.statusErr); status.appendChild(ui.cancel);
    dock.appendChild(status);
    ui.progress = el('div', 'nf-as-dock-progress');
    ui.progressBar = el('i');
    ui.progress.appendChild(ui.progressBar);
    dock.appendChild(ui.progress);
    const prompt = el('div', 'nf-as-prompt');
    const head = el('div', 'nf-as-prompt-head');
    ui.promptLabel = el('span', 'nf-as-chip', '音乐描述');
    head.appendChild(ui.promptLabel);
    ui.textarea = el('textarea');
    ui.textarea.addEventListener('input', () => { state[state.mode].text = ui.textarea.value; });
    prompt.appendChild(head); prompt.appendChild(ui.textarea);
    dock.appendChild(prompt);
    ui.scroller.appendChild(dock);
    ui.dock = dock;

    // transport ---------------------------------------------------------------------
    const transport = el('div', 'nf-as-transport');
    const row1 = el('div', 'nf-as-tr-row');
    ui.trRow = row1;
    const tbtn = (icon, title, fn) => { const b = el('button', 'nf-as-tbtn'); b.type = 'button'; b.title = title; b.innerHTML = svgIcon(icon); b.addEventListener('click', fn); row1.appendChild(b); return b; };
    tbtn(ICONS.start, '回到开头 (Home)', () => editor.seek(0));
    tbtn(ICONS.back, '后退 1 秒', () => editor.seek(editor.playhead() - 1));
    ui.play = tbtn(ICONS.play, '播放 (空格)', () => editor.toggle());
    tbtn(ICONS.fwd, '前进 1 秒', () => editor.seek(editor.playhead() + 1));
    tbtn(ICONS.end, '到结尾', () => editor.seek(editor.projectEnd()));
    ui.loop = tbtn(ICONS.loop, '循环播放整段', () => { editor.setLoop(!editor.state.loop); ui.loop.setAttribute('aria-pressed', String(editor.state.loop)); });
    ui.loop.setAttribute('aria-pressed', 'false');
    ui.time = el('span', 'nf-as-time', '0.0 / 0.0');
    row1.appendChild(ui.time);
    const textButton = (text, title, fn) => { const b = el('button', 'nf-as-tbtn nf-as-tbtn-text', text); b.type = 'button'; b.title = title; b.addEventListener('click', fn); row1.appendChild(b); return b; };
    textButton('分割', '在播放头处分割选中片段 (S)', () => editor.splitAtPlayhead());
    textButton('复制', '复制选中片段到播放头 (Ctrl+C / Ctrl+V)', () => { if (copySelectedClip()) pasteClipAtPlayhead(); });
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
    ui.scroller.appendChild(transport);
    ui.transport = transport;

    // resource list: the 动画 section's own list shows through on the right (shared
    // with 视频编辑); this sidebar is kept only as the file-input host for uploads
    const sidebar = el('div', 'nf-as-sidebar'); sidebar.hidden = true;
    const sideHead = el('div', 'nf-as-side-head');
    sideHead.appendChild(label(el('span'), '资源列表'));
    ui.count = el('span', 'nf-as-count', '0');
    sideHead.appendChild(ui.count);
    const upload = label(el('button'), '上传资源'); upload.type = 'button'; upload.title = '音频文件直接导入；视频文件只保留音轨';
    const file = el('input'); file.type = 'file'; file.accept = 'audio/*,video/*,.wav,.mp3,.ogg,.flac,.m4a,.mp4,.mov,.webm,.mkv'; file.multiple = true; file.hidden = true;
    file.addEventListener('change', () => { for (const f of Array.from(file.files || [])) importFile(f); file.value = ''; });
    upload.addEventListener('click', () => file.click());
    sideHead.appendChild(upload); sideHead.appendChild(file);
    sidebar.appendChild(sideHead);
    ui.list = el('div', 'nf-as-side-list');
    sidebar.appendChild(ui.list);
    sidebar.addEventListener('dragover', (event) => { if (droppedMediaFiles(event).length || Array.from(event.dataTransfer?.types || []).includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } });
    sidebar.addEventListener('drop', (event) => { const files = droppedMediaFiles(event); if (!files.length) return; event.preventDefault(); for (const f of files) importFile(f); });
    ui.scroller.appendChild(sidebar);
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
    imp(head, { 'font-size': '12px', 'font-weight': key === 'generate' ? '500' : '400', 'line-height': '12px', 'box-shadow': 'none' });
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
    closeDropdown();
    state.mode = mode;
    ui.modeMusic.setAttribute('aria-pressed', String(mode === 'music'));
    ui.modeSfx.setAttribute('aria-pressed', String(mode === 'sfx'));
    for (const b of [ui.modeMusic, ui.modeSfx]) {
      const on = b.getAttribute('aria-pressed') === 'true';
      imp(b, { 'font-weight': '500', 'font-size': '12px', 'box-shadow': 'none', background: on ? '#1c4136' : 'var(--nf-mode-bg, transparent)', color: on ? '#9be4cd' : 'var(--nf-mode-c, #eaeaea)' });
    }
    const m = state[mode];
    // left row body
    ui.genBody.replaceChildren(ui.modeKind);   // the 背景音乐 | 音效 toggle stays on top of the row
    if (mode === 'music') {
      selectField(ui.genBody, '风格', MUSIC_STYLES.map((s) => [s[0], s[1]]), m.style, (v) => { m.style = v; const s = MUSIC_STYLES.find((x) => x[0] === v); if (s && v !== 'auto') { m.bpm = s[3]; syncDockValues(); } });
      selectField(ui.genBody, '情绪', MOODS.map((s) => [s[0], s[1]]), m.mood, (v) => { m.mood = v; });
      ui.genBody.title = '循环版会按小节裁齐并做无缝接缝，生成后自动放到「音乐」音轨。';
    } else {
      selectField(ui.genBody, '类别', SFX_CATEGORIES.map((s) => [s[0], s[1]]), m.category, (v) => { m.category = v; const c = SFX_CATEGORIES.find((x) => x[0] === v); if (c && v !== 'auto') { m.seconds = c[3]; syncDockValues(); } });
      selectField(ui.genBody, '风格', SFX_STYLES.map((s) => [s[0], s[1]]), m.style, (v) => { m.style = v; });
      ui.genBody.title = '多个会生成不同变体，都进资源列表，挑一个拖到音轨。';
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
      const count = dropdown([1, 2, 3, 4].map((n) => [String(n), n + ' 个']), String(m.count), (v) => { m.count = Number(v); }, 'nf-as-select-inline');
      ui.dockRow.appendChild(count.trigger);
    }
    const go = label(el('button', 'nf-as-go'), '开始生成'); go.type = 'button'; go.setAttribute('data-novaflow-source-layout', '1'); go.style.setProperty('border', '0', 'important'); go.style.setProperty('--nf-as-go-icon', GO_ICON);
    go.addEventListener('click', () => (mode === 'music' ? submitMusic() : submitSfx()));
    ui.dockRow.appendChild(go);
    ui.go = go;
    ui.promptLabel.textContent = mode === 'music' ? '音乐描述' : '音效描述';
    ui.textarea.placeholder = mode === 'music' ? '输入音乐描述，例如：森林关卡，轻松又带点神秘，竖琴和长笛' : '输入音效描述，例如：打开木门，吱呀一声，有点回音';
    ui.textarea.value = m.text;
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
    const surface = document.getElementById('novaflow-primary-left-surface');
    let cardLeft = 75, cardWidth = 218, stageLeft = 302;
    if (surface instanceof HTMLElement && surface.getBoundingClientRect().width > 100) {
      const r = surface.getBoundingClientRect(); cardLeft = Math.round(r.left); cardWidth = Math.round(r.width);
    } else if (column instanceof HTMLElement) {
      const r = column.getBoundingClientRect();
      const pad = parseFloat(getComputedStyle(column).paddingLeft) || 68;
      cardLeft = Math.round(r.left + pad); cardWidth = Math.round(r.width - pad - 9);
    }
    if (column instanceof HTMLElement) stageLeft = Math.round(column.getBoundingClientRect().right);
    // The native card's own top and bottom (the brand runtime sets them per layout tier).
    const sr = surface instanceof HTMLElement && surface.getBoundingClientRect().width > 100 ? surface.getBoundingClientRect() : null;
    const tier = TIERS[layoutTier()];
    const gap = tier.gap;
    const top = sr ? Math.round(sr.top) : STAGE_TOP, bottom = sr ? Math.round(sr.bottom) : window.innerHeight - gap, right = window.innerWidth - gap;
    const place = (node, x, y, w, h) => { node.style.left = x + 'px'; node.style.top = y + 'px'; node.style.width = w + 'px'; node.style.height = h + 'px'; };
    const dockVisible = !ui.dock.hidden;
    // The control row wraps when the column is narrow; the dock grows by the
    // wrapped height (measured at the width it is about to get).
    const dockHeightFor = (width) => { ui.dock.style.width = width + 'px'; return DOCK_H - 32 + Math.max(32, ui.dockRow.offsetHeight); };
    const transportHeightFor = (width) => { ui.transport.style.width = width + 'px'; ui.transport.style.height = 'auto'; return TRANSPORT_H - 30 + Math.max(30, ui.trRow.offsetHeight); };
    // the page's own background, read from behind the section panel
    let backdropColor = '#1b1b1b';
    for (let node = surface instanceof HTMLElement ? surface.parentElement : document.body; node; node = node.parentElement) {
      const color = getComputedStyle(node).backgroundColor;
      if (color && color !== 'transparent' && !/rgba\(0, 0, 0, 0\)/.test(color)) { backdropColor = color; break; }
    }
    const tl = ui.stage.querySelector('.nf-as-timeline');
    const topbar = ui.stage.querySelector('.nf-as-topbar');
    const scroller = ui.scroller;
    if (tier.resourcesHeight) {
      // stack tier: a scrolling column from under the top bar; the section
      // panel keeps its own box, then stage, dock, transport and the resource
      // list follow at the panel's width. The stage never goes below
      // STACK_STAGE_MIN; a short window scrolls instead.
      const scLeft = cardLeft - 2, scTop = Math.max(0, top - 8);
      scroller.classList.add('nf-as-stacked');
      scroller.style.left = scLeft + 'px'; scroller.style.top = scTop + 'px';
      scroller.style.width = (window.innerWidth - scLeft) + 'px'; scroller.style.height = (window.innerHeight - scTop) + 'px';
      scroller.style.background = backdropColor;
      const x = cardLeft - scLeft, w = cardWidth;
      let y = top - scTop;
      place(ui.left, x, y, w, bottom - top); y += bottom - top + 8;
      const transportH = transportHeightFor(w);
      const dockH = dockHeightFor(w);
      const rest = (dockVisible ? dockH + 8 : 0) + transportH + 8 + tier.resourcesHeight + gap;
      const stageH = Math.max(STACK_STAGE_MIN, window.innerHeight - scTop - y - 8 - rest);
      place(ui.stage, x, y, w, stageH); y += stageH + 8;
      if (dockVisible) { place(ui.dock, x, y, w, dockH); y += dockH + 8; } else place(ui.dock, x, y, w, dockH);
      place(ui.transport, x, y, w, transportH); y += transportH + 8;
      ui.spacer.style.height = y + 'px';
      place(ui.backdrop, 0, 0, window.innerWidth - scLeft, y);
      tl.style.right = '0px'; tl.style.bottom = '0px'; topbar.style.right = '0px';
    } else {
      scroller.classList.remove('nf-as-stacked');
      scroller.style.cssText = '';
      ui.spacer.style.height = '0px';
      ui.backdrop.style.background = backdropColor;
      // the shared resource list sits to the right; everything of ours stops before it
      const sidebarPanel = document.querySelector('[data-novaflow-ai-resource-sidebar-panel="1"]');
      const sidebarLeft = sidebarPanel instanceof HTMLElement && sidebarPanel.getBoundingClientRect().width > 40 ? Math.round(sidebarPanel.getBoundingClientRect().left) : right - tier.resources;
      const innerRight = sidebarLeft - gap;
      place(ui.backdrop, cardLeft - 2, Math.max(0, top - 8), innerRight + gap - (cardLeft - 2), window.innerHeight - Math.max(0, top - 8));
      place(ui.left, cardLeft, top, cardWidth, bottom - top);
      place(ui.stage, stageLeft, top, innerRight - stageLeft, bottom - top);
      const transportH = transportHeightFor(innerRight - stageLeft);
      const transportTop = bottom - transportH;
      place(ui.transport, stageLeft, transportTop, innerRight - stageLeft, transportH);
      const dockH = dockHeightFor(innerRight - stageLeft);
      const dockTop = transportTop - 9 - dockH;
      place(ui.dock, stageLeft, dockTop, innerRight - stageLeft, dockH);
      // the timeline stops above whichever card comes first
      const timelineBottom = (dockVisible ? dockTop : transportTop) - 9;
      tl.style.right = '0px';
      tl.style.bottom = (bottom - timelineBottom) + 'px';
      topbar.style.right = '0px';
      // 视频预览: the reference video takes the upper part of the stage, the timeline the rest
      if (state.refPreview.enabled) {
        const refTop = 53, refH = Math.max(140, Math.round((timelineBottom - top - refTop) * 0.5));
        ui.refStage.hidden = false;
        ui.refStage.style.right = '0px'; ui.refStage.style.top = refTop + 'px'; ui.refStage.style.height = refH + 'px';
        tl.style.top = (refTop + refH + 8) + 'px';
      } else { ui.refStage.hidden = true; tl.style.top = '53px'; }
    }
    syncMask();
    if (editor) { editor.layout(); drawOverview(); }
  }

  // ---- transport helpers -------------------------------------------------------------
  function syncInspector(clip) {
    if (!ui || !ui.inspFadeIn) return;
    const has = Boolean(clip);
    ui.inspTitle.textContent = has ? clip.name + ' · ' + (editor ? editor.formatTime(clip.length) : '') : '未选中片段';
    for (const s of [ui.inspFadeIn, ui.inspFadeOut]) s.input.disabled = !has;
    ui.inspGain.disabled = !has;
    if (!has) { ui.inspFadeIn.range(0, 1); ui.inspFadeOut.range(0, 1); ui.inspFadeIn.set(0); ui.inspFadeOut.set(0); ui.inspGain.value = '100'; return; }
    // A fade can cover the whole clip, so each slider runs to the clip's length.
    const whole = Math.max(0.1, Math.round(clip.length * 10) / 10);
    ui.inspFadeIn.range(0, whole); ui.inspFadeOut.range(0, whole);
    ui.inspFadeIn.set(Math.round(clip.fadeIn * 10) / 10);
    ui.inspFadeOut.set(Math.round(clip.fadeOut * 10) / 10);
    if (document.activeElement !== ui.inspGain) ui.inspGain.value = String(Math.round(clip.gain * 100));
  }
  function syncTime() {
    if (!ui || !editor || !ui.time) return;
    ui.time.textContent = editor.formatTime(editor.playhead()) + ' / ' + editor.formatTime(editor.projectEnd());
  }
  function syncZoom() {
    if (!ui || !editor || !ui.zoomRange) return;
    if (ui.fitButton) { const empty = !(editor.state && editor.state.tracks || []).some((track) => track.clips && track.clips.length); ui.fitButton.disabled = empty; ui.fitButton.style.setProperty('opacity', empty ? '0.38' : '1', 'important'); }
    const z = editor.zoom();
    ui.zoomLabel.setAttribute('data-nf-label', Math.round(z / 40 * 100) + '%');
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
    return; // the timeline's ruler and playhead are the only transport readout
    // eslint-disable-next-line no-unreachable
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
  // ---- boards: the animation section's 1 / + / -, each with a timeline of its own
  let boardSerial = 0;
  function editorOptions(host) {
    return {
      host, context: audioContext,
      onChange: (what) => { if (what === 'model') { syncEmpty(); syncInspector(editor && editor.selectedClip()); } if (what === 'zoom') syncZoom(); },
      onTime: (t) => { syncTime(); syncReferenceVideo(t); },
      onSelect: (clip) => syncInspector(clip),
      onTransport: (playing) => { ui.play.innerHTML = svgIcon(playing ? ICONS.pause : ICONS.play); ui.play.title = playing ? '暂停 (空格)' : '播放 (空格)'; if (!playing) ui.refVideo?.pause(); else syncReferenceVideo(editor.playhead()); },
      dropPayload: (event) => readResourceDragId(event),
      resolveDrop: async (id) => {
        const local = state.resources.find((x) => x.id === id);
        if (local && local.buffer) return { buffer: local.buffer, name: local.name, kind: local.kind, loopable: local.loopable };
        try {
          const res = await resourceAudio(id);
          return res ? { buffer: res.buffer, name: res.name, kind: res.kind, loopable: res.loopable } : null;
        } catch (error) { ui.statusErr.textContent = String(error?.message || error); return null; }
      }
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
    if (ui.boardDel) { ui.boardDel.disabled = state.boards.length <= 1; ui.boardDel.setAttribute('aria-disabled', String(state.boards.length <= 1)); }
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
    if (!state.active || state.sub !== 'audio' || !editor) return;
    const t = event.target;
    // Only typing fields keep their keys; a slider, a checkbox or a button that
    // still has focus after a click must not swallow Space (play / pause).
    const typing = t instanceof HTMLElement && (t.tagName === 'TEXTAREA' || t.isContentEditable
      || (t.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes(String(t.type).toLowerCase())));
    if (event.key === ' ' && !typing) { event.preventDefault(); editor.toggle(); return; }
    if (typing || (t instanceof HTMLElement && t.tagName === 'INPUT')) return;
    if ((event.ctrlKey || event.metaKey) && (event.key === 'c' || event.key === 'C')) { if (copySelectedClip()) event.preventDefault(); return; }
    if ((event.ctrlKey || event.metaKey) && (event.key === 'v' || event.key === 'V')) { if (pasteClipAtPlayhead()) event.preventDefault(); return; }
    if ((event.ctrlKey || event.metaKey) && (event.key === 'a' || event.key === 'A')) { event.preventDefault(); editor.selectAll(); return; }
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
  function setProgress(pct) {
    if (!ui || !ui.progressBar) return;
    ui.progressBar.style.width = pct === null ? '0' : Math.max(2, Math.min(100, pct)) + '%';
  }
  function tell() {
    if (!ui) return;
    const running = state.running.size;
    if (!running) setProgress(null);
    ui.statusText.textContent = capabilityNote || (running ? running + ' 个任务生成中' : '等待生成');
    ui.statusErr.textContent = '';
    if (!running) ui.statusPct.textContent = '';
    ui.cancel.hidden = running === 0;
  }

  // ---- captions ----------------------------------------------------------------------
  // The AI 助手 writes a finished English caption; it goes to the audio model as
  // written (length and BPM are still appended there), and the pipeline's own
  // rewrite is skipped for it. Edited afterwards, it is ordinary text again.
  function optimizedCaption(m) { const text = String(m.text || '').trim(); return text && m.optimized === text ? text : ''; }
  function musicCaption() {
    const m = state.music;
    if (optimizedCaption(m)) return optimizedCaption(m);
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
    if (optimizedCaption(m)) return optimizedCaption(m);
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
      prompt: musicCaption(), duration_seconds: m.seconds, bpm: m.bpm, loop: m.loop, crossfade_ms: 800, reprompt: m.rewrite && !optimizedCaption(m)
    });
  }
  async function submitSfx() {
    const m = state.sfx;
    const parameters = { prompt: sfxCaption(), duration_seconds: m.seconds, reprompt: m.rewrite && !optimizedCaption(m) };
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
      const finished = await waitForTask(runtime, task.id, (t) => { pending.progress = Number(t.progress) || 0; ui.statusPct.textContent = Math.round(pending.progress) + '%'; setProgress(pending.progress); renderProgress(pending); });
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
    await publishAudio(resource, name + '.wav');
    try { await window.NovaFlowWebWarehouse?.save?.({ blob, name: name + '.wav' }); } catch (_) { /* the warehouse reports its own state */ }
  }

  // ---- the shared resource list -----------------------------------------------------------
  // Audio from here (generated, imported, mixed) is published to the 动画 section's
  // list through the same bridge 视频编辑 uses; a card dragged back is decoded on
  // demand (a video card gives its sound track).
  function readResourceDragId(event) {
    const bridge = window.NovaFlowAiSequenceVideoMergeResourceBridge;
    return bridge && typeof bridge.readResourceId === 'function' ? bridge.readResourceId(event?.dataTransfer) : '';
  }
  let publishSeq = 0;
  async function publishAudio(resource, fileName) {
    const bridge = window.NovaFlowAiSequenceAssetBridge;
    const outputs = window.NovaFlowWebRuntime && window.NovaFlowWebRuntime.videoOutputs;
    if (!bridge || typeof bridge.publishVideoResource !== 'function' || !outputs || !resource.blob) return null;
    const token = 'web-audio://' + (++publishSeq) + '/' + fileName;
    outputs.set(token, { tool: 'audio', token, blob: resource.blob, fileName, url: resource.url || URL.createObjectURL(resource.blob) });
    try {
      const published = await bridge.publishVideoResource({ filePath: token, fileName, mimeType: resource.blob.type || 'audio/wav' }, { sourceKind: 'audio_output' });
      const id = String(published?.resourceId || '');
      if (id) { resource.publishedId = id; }
      return id;
    } catch (error) { ui.statusErr.textContent = String(error?.message || error); return null; }
  }
  async function resolveResourceMedia(resourceId) {
    const local = state.resources.find((x) => x.publishedId === resourceId || x.id === resourceId);
    if (local && local.blob) return { blob: local.blob, fileName: local.name + '.wav', url: local.url, buffer: local.buffer, name: local.name };
    const bridge = window.NovaFlowAiSequenceVideoMergeResourceBridge;
    const adapter = bridge && bridge.createAdapter ? bridge.createAdapter({}) : null;
    if (!adapter) throw new Error('资源桥未加载');
    const d = await adapter.resolveResource(resourceId);
    let blob = d.file || d.blob || null;
    if (!blob && d.localPath) { const runtime = window.NovaFlowWebRuntime; blob = runtime?.fileForToken?.(d.localPath) || runtime?.videoOutputs?.get?.(d.localPath)?.blob || null; }
    if (!blob && d.objectUrl) blob = await (await fetch(d.objectUrl)).blob();
    if (!blob) throw new Error('资源没有可读取的文件');
    return { blob, fileName: d.fileName || 'clip.mp4', url: d.objectUrl || URL.createObjectURL(blob), name: String(d.fileName || 'clip').replace(/\.[^.]+$/, '') };
  }
  async function resourceAudio(resourceId) {
    const media = await resolveResourceMedia(resourceId);
    if (media.buffer) return { buffer: media.buffer, name: media.name, kind: 'import', loopable: true };
    let buffer = await decode(media.blob);
    if (!buffer) {
      const extract = window.electronAPI && typeof window.electronAPI.extractAudioTrack === 'function' ? window.electronAPI.extractAudioTrack : null;
      if (!extract) throw new Error('这个资源没有可用的音轨');
      const result = await extract({ file: media.blob });
      if (!result || !result.ok) throw new Error((result && result.error) || '无法提取音轨');
      buffer = await decode(result.blob);
      if (!buffer) throw new Error('提取出的音轨无法解码');
    }
    return { buffer, name: media.name, kind: /\.(mp4|webm|mov|m4v)$/i.test(media.fileName) ? 'sfx' : 'import', loopable: true };
  }

  // ---- 视频预览: the reference video follows the playhead ----------------------------------
  async function setReferenceVideo(media) {
    state.refPreview.item = media;
    ui.refVideo.src = media.url; ui.refVideo.hidden = false; ui.refEmpty.hidden = true;
    ui.previewName.textContent = '参照视频：' + (media.fileName || media.name || '');
    await new Promise((resolve) => { ui.refVideo.onloadedmetadata = resolve; ui.refVideo.onerror = resolve; });
    state.refPreview.durationSec = Number(ui.refVideo.duration) || 0;
    syncReferenceVideo(editor ? editor.playhead() : 0);
  }
  function setReferencePreview(enabled) {
    state.refPreview.enabled = Boolean(enabled);
    ui.previewSwitch.setAttribute('aria-checked', String(state.refPreview.enabled));
    if (!state.refPreview.enabled) ui.refVideo.pause();
    layout();
    if (state.refPreview.enabled) syncReferenceVideo(editor ? editor.playhead() : 0);
  }
  function syncReferenceVideo(t) {
    if (!state.refPreview.enabled || !state.refPreview.item || !ui.refVideo.src) return;
    const v = ui.refVideo;
    if (t > (state.refPreview.durationSec || 0)) { v.pause(); return; }
    if (editor && editor.isPlaying()) {
      if (v.paused) { v.currentTime = t; v.play().catch(() => {}); }
      else if (Math.abs(v.currentTime - t) > 0.08) v.currentTime = t;
    } else if (Math.abs(v.currentTime - t) > 0.02) v.currentTime = t;
  }

  // ---- copy / paste on the audio timeline ------------------------------------------------------
  let clipboardClip = null;
  function copySelectedClip() { const clip = editor && editor.selectedClip(); if (!clip) return false; clipboardClip = clip; return true; }
  function pasteClipAtPlayhead() {
    if (!editor || !clipboardClip) return false;
    const src = clipboardClip;
    const pasted = editor.addClip({ buffer: src.buffer, name: src.name, kind: src.kind, trackId: src.trackId, start: editor.playhead(), fadeIn: src.fadeIn, fadeOut: src.fadeOut, loopable: src.loopable });
    pasted.offset = src.offset; pasted.end = src.end; pasted.loops = src.loops; pasted.rate = src.rate; pasted.gain = src.gain;
    editor.syncLength(pasted); editor.select(pasted.id); editor.layout();
    return true;
  }

  // ---- resources ---------------------------------------------------------------------------
  const VIDEO_FILE = /\.(mp4|m4v|mov|webm|mkv|avi|ogv)$/i;
  async function importFile(file) {
    const isVideo = /^video\//.test(file.type || '') || VIDEO_FILE.test(file.name || '');
    const pending = { id: 'pending-import-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), kind: 'import', name: isVideo ? '提取音轨中' : '导入中', label: file.name, pending: true, progress: 30 };
    state.resources.unshift(pending);
    renderList();
    try {
      // The browser decodes most containers itself (an MP4's AAC track included);
      // anything it refuses goes through the site's ffmpeg, video first.
      let blob = file;
      let buffer = isVideo ? null : await decode(file);
      if (!buffer) {
        const extract = window.electronAPI && typeof window.electronAPI.extractAudioTrack === 'function' ? window.electronAPI.extractAudioTrack : null;
        if (!extract) throw new Error('无法解码 ' + file.name);
        const result = await extract({ file });
        if (!result || !result.ok) throw new Error((result && result.error) || ('无法提取 ' + file.name + ' 的音轨'));
        blob = result.blob;
        buffer = await decode(blob);
        if (!buffer) throw new Error('提取出的音轨无法解码');
      }
      state.counter.import += 1;
      const name = file.name.replace(/\.[^.]+$/, '').slice(0, 40) || ('导入_' + state.counter.import);
      const resource = { id: 'res-import-' + Date.now() + '-' + state.counter.import, kind: 'import', source: isVideo ? 'video' : 'audio', name, label: file.name + (isVideo ? '（视频音轨）' : ''), seconds: buffer.duration, blob, buffer, url: URL.createObjectURL(blob), loopable: true };
      const index = state.resources.indexOf(pending);
      if (index >= 0) state.resources.splice(index, 1, resource); else state.resources.unshift(resource);
      renderList();
      await publishAudio(resource, name + '.wav');
      return resource;
    } catch (error) {
      state.resources = state.resources.filter((r) => r !== pending);
      renderList();
      ui.statusErr.textContent = String(error?.message || error);
      return null;
    }
  }
  function droppedMediaFiles(event) {
    const files = Array.from(event.dataTransfer?.files || []);
    return files.filter((f) => /^(audio|video)\//.test(f.type || '') || VIDEO_FILE.test(f.name || '') || /\.(wav|mp3|ogg|flac|m4a|aac|opus)$/i.test(f.name || ''));
  }
  function renderList() {
    if (!ui || !ui.list || ui.sidebar?.hidden) return;
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
    const tag = el('span', 'nf-as-res-tag', res.kind === 'music' ? '音乐' : res.kind === 'sfx' ? '音效' : res.source === 'video' ? '视频音轨' : '导入');
    tag.dataset.kind = res.kind;
    nameRow.appendChild(tag);
    nameRow.appendChild(el('small', null, editor.formatTime(res.seconds)));
    node.appendChild(nameRow);
    const actions = el('div', 'nf-as-res-actions');
    const act = (text, title, fn, cls) => { const b = el('button', cls || null, text); b.type = 'button'; b.title = title; b.addEventListener('click', (e) => { e.stopPropagation(); fn(); }); actions.appendChild(b); };
    act('▶', '试听', () => previewResource(res, node));
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
  async function mixdown() {
    if (!editor.clipCount()) throw new Error('时间轴还是空的');
    const blob = await editor.exportMix();
    const name = (state.boards[state.board]?.name || ('audio_' + (state.board + 1))).replace(/[\/:*?"<>|]/g, '_') + '_mix';
    return { blob, name };
  }
  // 导出 (the rail entry): the mixdown as a download and into the warehouse.
  async function exportMix() {
    try {
      ui.statusErr.textContent = '';
      const { blob, name } = await mixdown();
      const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = name + '.wav'; document.body.appendChild(link); link.click(); link.remove();
      try { await window.NovaFlowWebWarehouse?.save?.({ blob, name: name + '.wav' }); } catch (_) { /* reported by the warehouse */ }
    } catch (error) {
      ui.statusErr.textContent = String(error?.message || error);
    }
  }
  // 保存到资源列表 (音频编辑): the mixdown into the shared resource list and the
  // warehouse; with a reference video placed, that video with the mix as its sound too.
  async function saveMix() {
    if (saving) return;
    saving = true;
    try {
      ui.statusErr.textContent = '';
      busy('working', '正在混音', '', null);
      const { blob, name } = await mixdown();
      state.counter.import += 1;
      const buffer = await decode(blob);
      const resource = { id: 'res-mix-' + Date.now(), kind: 'import', name, label: '混音', seconds: buffer ? buffer.duration : 0, blob, buffer, url: URL.createObjectURL(blob), loopable: true };
      state.resources.unshift(resource);
      renderList();
      await publishAudio(resource, name + '.wav');
      try { await window.NovaFlowWebWarehouse?.save?.({ blob, name: name + '.wav' }); } catch (_) { /* reported by the warehouse */ }
      let note = '已存入资源列表和仓库：' + name + '.wav（' + (blob.size / 1024 / 1024).toFixed(2) + ' MB）';
      const ref = state.refPreview.enabled ? state.refPreview.item : null;
      const mux = window.electronAPI && typeof window.electronAPI.videoEditorMux === 'function' ? window.electronAPI.videoEditorMux : null;
      if (ref && mux) {
        busy('working', '正在封装混合视频', '', null);
        let token = '';
        if (typeof window.electronAPI.aiSeqCacheReserveOutput === 'function') { const r = await window.electronAPI.aiSeqCacheReserveOutput({ format: 'mp4', baseName: name + '_video' }); token = String(r?.path || r?.filePath || ''); }
        const result = await mux({ video: { blob: ref.blob, url: ref.url, fileName: ref.fileName, durationSec: state.refPreview.durationSec }, audio: blob, format: 'mp4', filePath: token });
        if (!result || result.ok === false) throw new Error(result?.error || '混合视频失败');
        const bridge = window.NovaFlowAiSequenceAssetBridge;
        if (bridge && typeof bridge.publishVideoResource === 'function') await bridge.publishVideoResource({ filePath: String(result.filePath || result.path || token), fileName: result.fileName, mimeType: 'video/mp4' }, { sourceKind: 'audio_mix_output' });
        note += '；带混音的视频：' + String(result.fileName || '') + '（' + ((Number(result.bytes) || 0) / 1024 / 1024).toFixed(2) + ' MB）';
      }
      ui.saveNote.textContent = note;
      busy('done', '已保存', note, null);
    } catch (error) {
      const message = String(error?.message || error);
      ui.statusErr.textContent = message;
      busy('error', '保存失败', message, null);
    } finally { saving = false; }
  }
  let saving = false;
  // the busy dialog with its mask and the top-right ×, the same as 视频编辑's
  let busyTimer = 0;
  function busyNodes() {
    let mask = document.getElementById('novaflow-audio-busy-mask'), box = document.getElementById('novaflow-audio-busy');
    if (!box) {
      mask = el('div', 'nf-as-busy-mask'); mask.id = 'novaflow-audio-busy-mask'; mask.hidden = true;
      box = el('div', 'nf-as-busy'); box.id = 'novaflow-audio-busy'; box.hidden = true;
      box.innerHTML = '<div class="row"><i class="spin"></i><div class="title"></div></div><div class="msg"></div><button type="button" class="close" title="关闭" hidden>×</button>';
      box.querySelector('.close').addEventListener('click', closeBusy);
      mask.addEventListener('click', () => { if (box.dataset.kind !== 'working') closeBusy(); });
      document.body.appendChild(mask); document.body.appendChild(box);
    }
    return { mask, box };
  }
  function closeBusy() { const { mask, box } = busyNodes(); mask.hidden = true; box.hidden = true; }
  function busy(kind, title, message) {
    const { mask, box } = busyNodes();
    window.clearTimeout(busyTimer);
    mask.hidden = false; box.hidden = false; box.dataset.kind = kind;
    box.querySelector('.title').textContent = title; box.querySelector('.msg').textContent = message || '';
    box.querySelector('.close').hidden = kind === 'working';
    if (kind === 'done') busyTimer = window.setTimeout(closeBusy, 3000);
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
    if (state.active && state.sub === 'audio') layout();
    if (state.active && state.sub === 'video') { syncSubToggle(); syncMask(); }
    healAnimationLayout();
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
  setAnimationSecondaryFlag();

  window.NovaFlowAudioStudio = {
    open: activate, close: deactivate,
    isOpen: () => state.active,
    sub: () => (state.active ? state.sub : ''),
    setMode,
    resources: () => state.resources.slice(),
    importFile,
    editor: () => editor,
    captions: { music: musicCaption, sfx: sfxCaption, translate }
  };
})();
