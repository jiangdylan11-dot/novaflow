// 视频编辑 - the 音视 / 视频 tool that replaced 视频合并. Tracks of video,
// image and audio clips on a timeline (video-editor.timeline.js), a
// compositing stage (video-editor.preview.js), per-clip masks from the
// production mask tool, and one 保存到资源列表 that renders through
// electronAPI.videoEditorExport (ffmpeg.wasm in novaflow-web-capabilities.js)
// into the resource list and the warehouse.
//
// Keeps the NovaFlowAiSequenceVideoMergeWorkspace contract that
// ai-sequence-video-merge.tool.js and the brand runtime drive:
//   open({ previewHost, postSection, boardId, electronAPI, assetBridge, ... })
//   close() / saveAndClose() / exportToFile() / isOpen()
(function (root, factory) {
  const api = factory(root)
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowAiSequenceVideoMergeWorkspace = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict'

  const WORKSPACE_ATTRIBUTE = 'data-novaflow-ai-video-merge-workspace'
  const HOST_ACTIVE_ATTRIBUTE = 'data-novaflow-ai-video-merge-host-active'
  const RESOURCE_IMPORT_EVENT = 'novaflow:ai-sequence-video-merge-import-resource'
  const PANEL_ATTRIBUTES = {
    'data-novaflow-runtime-ignore': '1',
    'data-novaflow-ai-video-merge-layer-panel': '1',
    'data-novaflow-ai-video-merge-control-panel': '1',
  }
  const CANVAS_PRESETS = [['1280x720', '1280 × 720'], ['1920x1080', '1920 × 1080'], ['1080x1920', '1080 × 1920（竖）'], ['1024x1024', '1024 × 1024'], ['custom', '自定义']]
  let activeHandle = null

  const CSS = `
    [${WORKSPACE_ATTRIBUTE}="1"]{position:absolute;top:0;bottom:0;left:0;right:var(--novaflow-ai-preview-right,calc(var(--novaflow-ai-resource-sidebar-width,260px) + var(--novaflow-ai-resource-sidebar-gap,8px)));z-index:120;display:block;min-width:0;overflow:hidden;background:transparent;color:#f5f5f5;font-family:Inter,"Microsoft YaHei",sans-serif;box-sizing:border-box}
    [${HOST_ACTIVE_ATTRIBUTE}="1"] [data-novaflow-ai-board-controls-top-left="1"]{display:none!important}
    [${WORKSPACE_ATTRIBUTE}="1"] *,.nf-ve-panel *{box-sizing:border-box}
    [${WORKSPACE_ATTRIBUTE}="1"] button,[${WORKSPACE_ATTRIBUTE}="1"] input,.nf-ve-panel button,.nf-ve-panel input,.nf-ve-panel select{font:inherit;color:inherit}
    [${WORKSPACE_ATTRIBUTE}="1"] button:focus,.nf-ve-panel button:focus,.nf-ve-panel input:focus{outline:0}
    .nf-vm-body{height:100%;min-height:0;display:grid;grid-template-rows:minmax(120px,1fr) 300px auto;gap:8px;background:#242424}
    .nf-vm-center{display:contents}
    .nf-vm-stage{min-width:0;min-height:0;position:relative;overflow:hidden;border-radius:10px;background:var(--novaflow-ai-preview-color,#242424)}
    .nf-vm-stage[data-drop-active="1"]::after{content:"释放以加入画板（起点 = 播放头）";position:absolute;inset:12px;z-index:3;display:flex;align-items:center;justify-content:center;border:2px dashed rgba(91,224,173,.85);border-radius:12px;background:rgba(10,61,44,.48);color:#d9fff0;font-size:13px;font-weight:600;pointer-events:none}
    .nf-ve-canvas{display:block;width:100%;height:100%}
    .nf-ve-brush{position:absolute;z-index:4;border:1.5px solid #27c889;border-radius:50%;pointer-events:none}
    .nf-ve-brush-feather{position:absolute;z-index:4;border:1px dashed rgba(255,255,255,.45);border-radius:50%;pointer-events:none}
    .nf-vm-timeline{position:relative;overflow:hidden;min-height:0;border-radius:10px;background:#161616;border:1px solid #2e2e2e}
    .nf-ve-transport{display:flex;align-items:center;gap:8px;min-height:50px;padding:9px 12px;border:1px solid #343434;border-radius:10px;background:#161616}
    .nf-ve-transport .tb{width:30px;height:30px;padding:0;border:1px solid transparent;border-radius:7px;background:#282828;color:#eaeaea;display:grid;place-items:center;cursor:pointer}
    .nf-ve-transport .tb:hover{background:#333}
    .nf-ve-transport .tb[aria-pressed="true"]{background:#1c4136;border-color:#29594a;color:#9be4cd}
    .nf-ve-transport .time{min-width:84px;font-variant-numeric:tabular-nums;color:#ccc;font-size:11px}
    .nf-ve-transport .sep{width:1px;height:20px;background:#333}
    .nf-ve-transport .check{display:flex;align-items:center;gap:6px;color:rgba(255,255,255,.8);font-size:11px}
    .nf-ve-transport .check input{accent-color:#1EA672}
    .nf-ve-transport .zoom{margin-left:auto;display:flex;align-items:center;gap:8px;color:#9a9a9a;font-size:11px}
    .nf-ve-transport .zoom input{width:120px}
    .nf-ve-btn{min-height:32px;height:32px;padding:0 10px;border:1px solid #343434;border-radius:6px;background:#262626;color:#e3e3e3;font-size:12px;cursor:pointer;white-space:nowrap}
    .nf-ve-btn:hover:not(:disabled){background:#303030;color:#fff}.nf-ve-btn:disabled{opacity:.5;cursor:not-allowed}
    .nf-ve-btn.primary{background:linear-gradient(135deg,#1ea672,#188f64);border-color:rgba(84,234,178,.3);color:#effcf6;font-weight:600}
    /* the left panel under the 视频编辑 row */
    .nf-ve-panel{width:calc(100% - 22px);min-width:0;margin:0 11px;padding:6px 0 8px;background:transparent;color:#f5f5f5;font-family:Inter,"Microsoft YaHei",sans-serif;font-size:12px}
    .nf-ve-sec{margin:0 0 8px}.nf-ve-sec:last-child{margin-bottom:0}
    .nf-ve-sec h4{margin:0 0 5px;color:rgba(255,255,255,.72);font-size:11px;font-weight:600;letter-spacing:.04em}
    .nf-ve-line{display:grid;gap:5px;align-items:center;margin:4px 0;min-width:0}
    .nf-ve-line label,.nf-ve-line .readout{color:rgba(255,255,255,.7);font-size:10px;white-space:nowrap}
    .nf-ve-line .readout{color:#9a9a9a;text-align:right;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis}
    .nf-ve-line input[type=number]{width:100%;min-width:0;height:32px;padding:0 6px;border:1px solid #343434;border-radius:6px;background:#262626;color:#e9e9e9;font-size:12px;text-align:center;-moz-appearance:textfield;appearance:textfield}
    .nf-ve-line input[type=number]::-webkit-inner-spin-button,.nf-ve-line input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
    .nf-ve-btn.sm{padding:0 8px;font-size:11px}
    .nf-ve-range{-webkit-appearance:none;appearance:none;width:100%;min-width:0;height:16px;margin:0;padding:0;border:0;background:linear-gradient(to right,#1fc896 0%,#1fc896 var(--fill,0%),#333 var(--fill,0%),#333 100%) center/100% 2px no-repeat;cursor:pointer}
    .nf-ve-range::-webkit-slider-runnable-track{height:2px;background:transparent}
    .nf-ve-range::-webkit-slider-thumb{-webkit-appearance:none;width:12px;height:12px;margin-top:-5px;border-radius:50%;background:#d9e2e8;border:0}
    .nf-ve-name{width:100%;height:24px;padding:0 6px;border:1px solid transparent;border-radius:5px;background:#272727;color:#fff;font-size:11px}
    .nf-ve-btns{display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-top:5px}.nf-ve-btns .wide{grid-column:1/-1}
    .nf-ve-btns .nf-ve-btn{padding:0 8px;font-size:12px}
    .nf-ve-status{min-height:0;margin-top:6px;padding:0;border-radius:0;background:transparent;color:#8b8b8b;font-size:11px;line-height:1.6;word-break:break-word}
    .nf-ve-status[data-error="1"]{color:#f09595}.nf-ve-status[data-success="1"]{color:#8ff0c7}
    .nf-ve-hint{margin-top:4px;color:rgba(255,255,255,.43);font-size:9px;line-height:1.5}
    .nf-ve-mask{margin-top:6px;padding:6px;border-radius:7px;background:#1a1a1a}
    .nf-ve-mode{display:grid;grid-template-columns:1fr 1fr;gap:3px;padding:3px;border:1px solid #262626;border-radius:7px;background:#101010;margin:0 0 4px}
    .nf-ve-mode button{height:24px;border:0;border-radius:6px;background:transparent;color:#eaeaea;font-size:12px;cursor:pointer}
    .nf-ve-mode button[aria-pressed="true"]{background:#1c4136;color:#9be4cd;box-shadow:inset 0 0 0 1px #2c604f}
    /* dropdown: the product's masked menu */
    .nf-ve-dd-trigger{width:100%;height:32px;padding:0 28px 0 10px;border:1px solid #343434;border-radius:6px;background:#262626;color:#e9e9e9;font-size:12px;text-align:left;position:relative;cursor:pointer}
    .nf-ve-dd-trigger::after,.nf-ve-dd-trigger::before{content:none!important}
    .nf-ve-dd-trigger > i{position:absolute;right:10px;top:50%;width:6px;height:6px;margin-top:-5px;border-right:1.5px solid #9a9a9a;border-bottom:1.5px solid #9a9a9a;transform:rotate(45deg);pointer-events:none}
    .nf-ve-dd-trigger[data-open="1"]{position:relative;z-index:2147483002;border-color:#1EA672}
    .nf-ve-dd-overlay{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.58)}
    .nf-ve-dd-panel{position:fixed;z-index:2147483001;background:#1b1b1b;border:1px solid rgba(255,255,255,.18);box-shadow:0 18px 48px rgba(0,0,0,.55);color:rgba(255,255,255,.88);font-size:12px;line-height:26px;overflow:hidden auto;max-height:60vh}
    .nf-ve-dd-item{height:26px;padding:0 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;user-select:none}
    .nf-ve-dd-item:hover{background:rgba(255,255,255,.08)}.nf-ve-dd-item[data-selected="1"]{background:#1EA672;color:#fff}
    /* busy dialog with its mask */
    .nf-ve-busy-mask{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.55)}
    .nf-ve-busy[hidden],.nf-ve-busy-mask[hidden],.nf-ve-panel [hidden],.nf-ve-transport [hidden]{display:none!important}
    body[data-nf-ve-masking="1"] .nf-ve-panel .nf-ve-sec:not(:has(#ve-mask-box)),
    body[data-nf-ve-masking="1"] .nf-ve-panel .nf-ve-sec:has(#ve-mask-box) > :not(#ve-clip-box),
    body[data-nf-ve-masking="1"] .nf-ve-panel #ve-clip-box > :not(#ve-mask-box),
    body[data-nf-ve-masking="1"] .nf-ve-transport > *,
    body[data-nf-ve-masking="1"] .nf-vm-timeline,
    body[data-nf-ve-masking="1"] [data-novaflow-ai-resource-card="1"],
    body[data-nf-ve-masking="1"] [data-novaflow-ai-collapse-heading],
    body[data-nf-ve-masking="1"] [data-novaflow-ai-tool-heading],
    body[data-nf-ve-masking="1"] #novaflow-av-sub-toggle,
    body[data-nf-ve-masking="1"] .nf-vm-zoom-hud{pointer-events:none!important;opacity:.4!important}
    .nf-ve-busy{position:fixed;left:50%;top:50%;z-index:2147483001;transform:translate(-50%,-50%);min-width:300px;max-width:440px;padding:14px 16px;border:1px solid #3c3c3c;border-radius:12px;background:rgba(29,29,29,.96);color:#eaeaea;font-size:13px;box-shadow:0 12px 32px rgba(0,0,0,.45);display:grid;gap:8px;font-family:Inter,"Microsoft YaHei",sans-serif}
    .nf-ve-busy .row{display:flex;align-items:center;gap:8px}
    .nf-ve-busy .spin{width:14px;height:14px;flex:0 0 14px;border-radius:50%;border:2px solid rgba(255,255,255,.18);border-top-color:#25bc84;animation:nf-ve-spin .8s linear infinite}
    .nf-ve-busy[data-kind="done"] .spin,.nf-ve-busy[data-kind="error"] .spin,.nf-ve-busy[data-kind="done"] .bar,.nf-ve-busy[data-kind="error"] .bar{display:none}
    @keyframes nf-ve-spin{to{transform:rotate(360deg)}}
    .nf-ve-busy .title{font-size:13px;font-weight:600}.nf-ve-busy[data-kind="done"] .title{color:#8ff0c7}.nf-ve-busy[data-kind="error"] .title{color:#fca5a5}
    .nf-ve-busy .msg{color:#bdbdbd;line-height:1.5;word-break:break-word}
    .nf-ve-busy .bar{height:3px;border-radius:2px;background:rgba(255,255,255,.1);overflow:hidden}.nf-ve-busy .bar>i{display:block;height:100%;width:0;background:#25bc84;transition:width .2s linear}
    .nf-ve-busy .close{position:absolute;top:8px;right:8px;width:22px;height:22px;padding:0;border:1px solid #454545;border-radius:50%;background:#333;color:#ddd;font-size:13px;line-height:20px;text-align:center;cursor:pointer}
    .nf-ve-busy .close:hover{background:#4a2323;border-color:#6a3030;color:#ffb4b4}
    .nf-ve-busy .row{padding-right:26px}
    /* timeline editor (the 音频 section sheet) */
    .nf-tl{position:absolute;inset:0;display:grid;grid-template-columns:132px minmax(0,1fr)}
    .nf-tl-headers{position:relative;background:#161616;border-right:1px solid #2a2a2a;overflow:hidden}
    .nf-tl-headers-top{height:24px;line-height:24px;padding:0 6px 0 8px;font-size:10px;color:#8d8d8d;background:#161616;border-bottom:1px solid #2a2a2a;display:flex;align-items:center;gap:4px;white-space:nowrap}
    .nf-tl-add-track{margin-left:auto;height:18px;padding:0 4px;border:1px solid #343434;border-radius:4px;background:#262626;color:#bdbdbd;font-size:10px;line-height:16px;white-space:nowrap;flex:none;cursor:pointer}
    .nf-tl-add-track + .nf-tl-add-track{margin-left:0}.nf-tl-add-track:hover{border-color:#1EA672;color:#9be4cd}
    .nf-tl-header-list{will-change:transform}
    .nf-tl-header{display:flex;flex-direction:column;justify-content:center;gap:5px;padding:0 8px;margin-bottom:4px;border-bottom:1px solid #222;cursor:grab}
    .nf-tl-header[data-kind="audio"]{background:#1a1915}.nf-tl-header.nf-tl-header-dragging{opacity:.5}.nf-tl-header.nf-tl-header-over{box-shadow:inset 0 2px 0 #1EA672}
    .nf-tl-track-name{height:22px;border:1px solid transparent;border-radius:5px;background:transparent;color:#e9e9e9;font-size:11px;font-weight:500;padding:0 5px;width:100%}
    .nf-tl-track-name:hover,.nf-tl-track-name:focus{background:#262626;border-color:#343434}
    .nf-tl-track-btns{display:flex;gap:4px}
    .nf-tl-track-btns button{width:24px;height:20px;border:1px solid #343434;border-radius:5px;background:#262626;color:#bdbdbd;font-size:10px;font-weight:600;padding:0;cursor:pointer}
    .nf-tl-track-btns button[aria-pressed="true"]{background:#1c4136;border-color:#29594a;color:#9be4cd}
    .nf-tl-track-btns button[hidden]{display:none}
    .nf-tl-track-btns .nf-tl-track-del{margin-left:auto;font-size:13px;font-weight:400}.nf-tl-track-btns .nf-tl-track-del:hover{background:#4a2323;color:#ffb4b4}
    .nf-tl-track-btns .nf-tl-track-detach{color:#9be4cd;font-weight:400}.nf-tl-track-btns .nf-tl-track-detach:hover{border-color:#1EA672}
    .nf-tl-scroller{position:relative;overflow:auto;background:#1d1d1d}
    .nf-tl-scroller::-webkit-scrollbar{width:8px;height:8px}.nf-tl-scroller::-webkit-scrollbar-thumb{background:#3a3a3a;border-radius:4px}
    .nf-tl-canvas{display:block}
    .nf-tl-playhead{position:absolute;top:0;width:2px;background:#ef4444;pointer-events:none}
    .nf-tl-playhead::before{content:"";position:absolute;left:-4px;top:0;border:5px solid transparent;border-top:8px solid #ef4444}
  `

  function finite(value, fallback) { const n = Number(value); return Number.isFinite(n) ? n : fallback }
  function text(value, fallback) { const s = String(value == null ? '' : value).trim(); return s || fallback }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)) }
  function el(documentRef, tag, className, textContent) {
    const node = documentRef.createElement(tag)
    if (className) node.className = className
    if (textContent != null) node.textContent = textContent
    return node
  }

  function dependencies() {
    const timeline = root?.NovaFlowVideoTimeline
    const preview = root?.NovaFlowVideoEditorPreview
    const mask = root?.NovaFlowAiSequenceVideoMergeMaskTool
    const bridge = root?.NovaFlowAiSequenceVideoMergeResourceBridge
    if (!timeline?.create) throw new Error('视频编辑时间轴模块未加载')
    if (!preview?.mount) throw new Error('视频编辑预览模块未加载')
    if (!mask?.createSurface) throw new Error('视频编辑蒙版模块未加载')
    if (!bridge?.createAdapter) throw new Error('视频编辑资源桥未加载')
    return { timeline, preview, mask, bridge }
  }

  // ---- sources: a dropped / clicked resource or file -> { kind, url, durationSec, width, height, hasAudio, blob, fileName }
  function probeVideo(url) {
    return new Promise((resolve, reject) => {
      const v = document.createElement('video'); v.preload = 'auto'; v.muted = true; v.playsInline = true; v.src = url
      const timer = setTimeout(() => reject(new Error('视频读取超时')), 15000)
      v.addEventListener('loadedmetadata', async () => { clearTimeout(timer); const meta = { width: v.videoWidth, height: v.videoHeight, durationSec: v.duration }; let fps = 0; try { fps = await measureFps(v) } catch { fps = 0 } try { v.pause(); v.removeAttribute('src'); v.load() } catch {} resolve({ ...meta, fps }) }, { once: true })
      v.addEventListener('error', () => { clearTimeout(timer); reject(new Error('无法读取视频')) }, { once: true })
    })
  }
  // The file's own frame rate, from the media times of its first frames during a short
  // muted play (a <video> does not state it). Snapped to the usual rates; 0 if unknown.
  function measureFps(v) {
    return new Promise((resolve) => {
      if (typeof v.requestVideoFrameCallback !== 'function') { resolve(0); return }
      const times = []; let done = false
      const finish = () => { if (done) return; done = true; try { v.pause() } catch {} let fps = 0; if (times.length >= 4) { const span = times[times.length - 1] - times[0]; if (span > 0) fps = (times.length - 1) / span } const usual = [24, 25, 30, 48, 50, 60, 120]; const near = usual.find((r) => Math.abs(r - fps) <= 0.6); resolve(fps > 0 ? (near || Math.round(fps)) : 0) }
      const tick = (_now, m) => { if (done) return; if (!times.length || m.mediaTime > times[times.length - 1]) times.push(m.mediaTime); if (times.length >= 12 || (times.length >= 4 && times[times.length - 1] - times[0] >= 0.5)) finish(); else v.requestVideoFrameCallback(tick) }
      setTimeout(finish, 1500)
      v.currentTime = 0
      const started = v.play()
      if (started && typeof started.then === 'function') started.then(() => v.requestVideoFrameCallback(tick)).catch(() => finish())
      else v.requestVideoFrameCallback(tick)
    })
  }
  function probeImage(url) {
    return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight }); img.onerror = () => reject(new Error('无法读取图片')); img.src = url })
  }
  function peaksOf(buffer, bins) {
    bins = bins || 2000
    const n = buffer.length, ch = buffer.numberOfChannels, out = new Float32Array(bins), step = Math.max(1, Math.floor(n / bins))
    const data = []; for (let c = 0; c < ch; c += 1) data.push(buffer.getChannelData(c))
    for (let b = 0; b < bins; b += 1) { const s = b * step, e = Math.min(n, s + step); let peak = 0; for (let i = s; i < e; i += 2) for (let c = 0; c < ch; c += 1) { const v = Math.abs(data[c][i]); if (v > peak) peak = v } out[b] = peak }
    return out
  }
  const isImageName = (name) => /\.(png|jpe?g|webp|gif|bmp)$/i.test(name || '')
  const isAudioName = (name) => /\.(wav|mp3|ogg|flac|m4a|aac)$/i.test(name || '')

  const TRANSPORT_GLYPH = 'rgba(255,255,255,0.78)'
  const transportSvg = (inner) => '<svg width="18" height="18" viewBox="0 0 18 18" style="display:block" aria-hidden="true">' + inner + '</svg>'
  const transportBar = (x) => '<rect x="' + x + '" y="4" width="2" height="10" rx="0.5" fill="' + TRANSPORT_GLYPH + '"></rect>'
  const TRANSPORT_ICONS = {
    start: transportSvg(transportBar(3) + transportBar(6) + '<polygon points="15,4 15,14 9,9" fill="' + TRANSPORT_GLYPH + '"></polygon>'),
    back: transportSvg(transportBar(4) + '<polygon points="14,4 14,14 7,9" fill="' + TRANSPORT_GLYPH + '"></polygon>'),
    play: transportSvg('<polygon points="5.5,4 5.5,14 13.5,9" fill="' + TRANSPORT_GLYPH + '"></polygon>'),
    pause: transportSvg('<rect x="5" y="4" width="3" height="10" rx="0.5" fill="' + TRANSPORT_GLYPH + '"></rect><rect x="10" y="4" width="3" height="10" rx="0.5" fill="' + TRANSPORT_GLYPH + '"></rect>'),
    fwd: transportSvg(transportBar(12) + '<polygon points="4,4 4,14 11,9" fill="' + TRANSPORT_GLYPH + '"></polygon>'),
    end: transportSvg(transportBar(13) + transportBar(10) + '<polygon points="3,4 3,14 9,9" fill="' + TRANSPORT_GLYPH + '"></polygon>'),
    loop: transportSvg('<path d="M6.5 5.3c2.7-2 6.8-.4 7.3 2.8.5 3.2-3.1 5.8-6 4.4" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round"></path><path d="M7.2 4.2l-2.6 1.2 2.1 2.0" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>')
  }
  function open(options) {
    const config = options && typeof options === 'object' ? options : {}
    const previewHost = config.previewHost
    if (!previewHost || typeof previewHost.appendChild !== 'function') throw new TypeError('视频编辑画板宿主不可用')
    activeHandle?.close?.({ reason: 'replace' })
    const modules = dependencies()
    const documentRef = previewHost.ownerDocument || root.document
    const windowRef = documentRef.defaultView || root
    const documentHost = documentRef.body
    const electronAPI = config.electronAPI || root.electronAPI || {}
    const dropAdapter = modules.bridge.createAdapter({ assetBridge: config.assetBridge })
    const assetBridge = config.assetBridge || root.NovaFlowAiSequenceAssetBridge || null
    const $ = (id) => shell.querySelector('#' + id) || leftPanel.querySelector('#' + id)
    const audioContext = (() => { let ctx = null; return () => { if (!ctx) ctx = new (windowRef.AudioContext || windowRef.webkitAudioContext)(); return ctx } })()
    const ownedUrls = new Set()
    const sourcesById = new Map()
    let alive = true
    let exporting = false

    // ---- host: hide the board's own controls while the editor owns the stage
    const priorPosition = previewHost.style?.position || ''
    const nativeBoardControls = Array.from(documentHost?.querySelectorAll?.('[data-novaflow-ai-board-controls-top-left="1"]') || []).map((node) => ({ node, display: node.style?.getPropertyValue?.('display') || '', priority: node.style?.getPropertyPriority?.('display') || '' }))
    let changedHostPosition = false
    function restoreHost() {
      try {
        if (changedHostPosition) { if (priorPosition) previewHost.style.setProperty('position', priorPosition); else previewHost.style.removeProperty('position') }
        previewHost.removeAttribute?.(HOST_ACTIVE_ATTRIBUTE)
        documentHost?.removeAttribute?.(HOST_ACTIVE_ATTRIBUTE)
        nativeBoardControls.forEach((r) => { if (r.display) r.node.style?.setProperty?.('display', r.display, r.priority); else r.node.style?.removeProperty?.('display') })
      } catch (_) {}
    }

    // ---- DOM: stage + timeline + transport in the preview host, the panel under the row
    const shell = el(documentRef, 'section')
    shell.setAttribute(WORKSPACE_ATTRIBUTE, '1')
    shell.setAttribute('data-novaflow-runtime-ignore', '1')
    shell.setAttribute('aria-label', '视频编辑')
    const style = el(documentRef, 'style'); style.setAttribute('data-novaflow-ai-video-merge-style', '1'); style.textContent = CSS
    const body = el(documentRef, 'div', 'nf-vm-body')
    const center = el(documentRef, 'main', 'nf-vm-center')
    const stageHost = el(documentRef, 'div', 'nf-vm-stage'); stageHost.setAttribute('data-novaflow-ai-video-merge-stage', '1')
    const timelineCard = el(documentRef, 'div', 'nf-vm-timeline')
    const transport = el(documentRef, 'div', 'nf-ve-transport')
    transport.innerHTML = `
      <button class="tb" data-act="start" title="回到开头">${TRANSPORT_ICONS.start}</button>
      <button class="tb" data-act="prev" title="上一片段边缘">${TRANSPORT_ICONS.back}</button>
      <button class="tb" data-act="play" title="播放 / 暂停">${TRANSPORT_ICONS.play}</button>
      <button class="tb" data-act="next" title="下一片段边缘">${TRANSPORT_ICONS.fwd}</button>
      <button class="tb" data-act="end" title="到结尾">${TRANSPORT_ICONS.end}</button>
      <button class="tb" data-act="loop" title="循环" aria-pressed="false">${TRANSPORT_ICONS.loop}</button>
      <span class="time">0.0 / 0.0</span>
      <span class="sep"></span>
      <button class="nf-ve-btn" data-act="split">分割</button>
      <button class="nf-ve-btn" data-act="copy" title="复制选中片段到播放头（Ctrl+C / Ctrl+V）">复制</button>
      <button class="nf-ve-btn" data-act="del" title="删除选中片段（Delete）">删除</button>
      <label class="check"><input type="checkbox" data-act="snap" checked> 吸附</label>
      <div class="zoom">缩放 <input type="range" class="nf-ve-range" data-act="zoom" min="6" max="400" step="1" value="40"></div>`
    center.append(stageHost, timelineCard, transport)
    body.appendChild(center)
    // the zoom HUD plate the board shows beside 自动适配
    const zoomReadout = el(documentRef, 'div', 'nf-vm-zoom-readout', '100%')
    const fitButton = el(documentRef, 'button', 'nf-vm-auto-fit', '自动适配'); fitButton.type = 'button'; fitButton.setAttribute('data-novaflow-ai-video-merge-auto-fit', '1')
    const zoomHud = el(documentRef, 'div', 'nf-vm-zoom-hud'); zoomHud.setAttribute('data-novaflow-ai-video-merge-zoom-hud', '1')
    zoomHud.style.cssText = 'position:absolute;top:7px;right:-2px;z-index:14;display:flex;align-items:center;gap:3px;height:38px;padding:4px;border:1px solid #333;border-radius:9px;background:#161616'
    zoomReadout.style.cssText = 'min-width:44px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:7px;font-size:11px;font-weight:500;color:#9a9a9a;font-variant-numeric:tabular-nums'
    fitButton.style.cssText = 'height:28px;padding:4px 8px;border:1px solid transparent;border-radius:5px;background:transparent;color:#a0a0a0;font-size:11px;font-weight:500;cursor:pointer'
    zoomHud.append(zoomReadout, fitButton)
    shell.append(style, body, zoomHud)

    const leftPanel = el(documentRef, 'aside', 'nf-ve-panel nf-vm-panel')
    Object.entries(PANEL_ATTRIBUTES).forEach(([k, v]) => leftPanel.setAttribute(k, v))
    leftPanel.innerHTML = `
      <div class="nf-ve-sec"><h4>画布</h4>
        <select class="nf-ve-select" id="ve-canvas-size">${CANVAS_PRESETS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>
        <div class="nf-ve-line" style="grid-template-columns:1fr 1fr auto">
          <input type="number" id="ve-canvas-w" min="2" max="8192" step="2" value="1280" title="宽">
          <input type="number" id="ve-canvas-h" min="2" max="8192" step="2" value="720" title="高">
          <button class="nf-ve-btn sm" id="ve-canvas-from-clip" title="按选中片段的原始尺寸">取片段尺寸</button>
        </div>
      </div>
      <div class="nf-ve-sec"><h4>片段</h4>
        <div id="ve-clip-empty" class="nf-ve-hint">点资源或拖到画板 / 轨道；选中片段后在这里调整。</div>
        <div id="ve-clip-box" hidden>
          <input class="nf-ve-name" id="ve-clip-name" title="片段名称">
          <div class="nf-ve-line" style="grid-template-columns:auto minmax(0,1fr) 44px"><label>缩放</label><input type="range" class="nf-ve-range" id="ve-clip-scale-range" min="5" max="300" step="1" value="100"><input type="number" id="ve-clip-scale" min="5" max="1000" step="1" title="缩放 %"></div>
          <div class="nf-ve-line" style="grid-template-columns:auto 1fr 1fr auto"><label>中心</label><input type="number" id="ve-clip-x" step="1" title="中心 X"><input type="number" id="ve-clip-y" step="1" title="中心 Y"><button class="nf-ve-btn sm" id="ve-clip-fit" title="按画布大小缩放并居中">适配</button></div>
          <div class="nf-ve-line" style="grid-template-columns:auto minmax(0,1fr) auto"><label>起点 / 长度</label><span class="readout" id="ve-clip-timing"></span><span id="ve-clip-length-row" hidden><input type="number" id="ve-clip-length" min="0.1" step="0.5" title="图片长度 s"></span></div>
          <div class="nf-ve-line" style="grid-template-columns:auto minmax(0,1fr) 44px"><label>淡入</label><input type="range" class="nf-ve-range" id="ve-fadein" min="0" max="30" step="0.1" value="0"><span class="readout" id="ve-fadein-value">0.0</span></div>
          <div class="nf-ve-line" style="grid-template-columns:auto minmax(0,1fr) 44px"><label>淡出</label><input type="range" class="nf-ve-range" id="ve-fadeout" min="0" max="30" step="0.1" value="0"><span class="readout" id="ve-fadeout-value">0.0</span></div>
          <div class="nf-ve-btns"><button class="nf-ve-btn wide" id="ve-mask-edit">蒙版编辑</button></div>
          <div class="nf-ve-mask" id="ve-mask-box" hidden>
            <div class="nf-ve-mode"><button type="button" id="ve-mask-erase" aria-pressed="true">擦除</button><button type="button" id="ve-mask-restore" aria-pressed="false">修复</button></div>
            <div class="nf-ve-line" style="grid-template-columns:auto minmax(0,1fr) 44px"><label>笔刷</label><input type="range" class="nf-ve-range" id="ve-mask-brush-range" min="1" max="300" step="1" value="22"><input type="number" id="ve-mask-brush" min="1" max="300" step="1" value="22"></div>
            <div class="nf-ve-line" style="grid-template-columns:auto minmax(0,1fr) 44px"><label>羽化</label><input type="range" class="nf-ve-range" id="ve-mask-feather-range" min="0" max="300" step="1" value="0"><input type="number" id="ve-mask-feather" min="0" max="300" step="1" value="0"></div>
            <div class="nf-ve-btns"><button class="nf-ve-btn" id="ve-mask-undo">撤销</button><button class="nf-ve-btn" id="ve-mask-clear">清除</button></div>
            <div class="nf-ve-btns"><button class="nf-ve-btn primary" id="ve-mask-ok">确定</button><button class="nf-ve-btn" id="ve-mask-cancel">取消</button></div>
          </div>
        </div>
      </div>
      <div class="nf-ve-sec"><h4>保存</h4>
        <div class="nf-ve-btns"><button class="nf-ve-btn primary wide" id="ve-save">保存到资源列表</button></div>
        <div class="nf-ve-status" id="ve-status">合成后存入资源列表和仓库。</div>
      </div>
      <div class="nf-ve-sec"><div class="nf-ve-btns"><button class="nf-ve-btn wide" id="ve-close-row">关闭</button></div></div>`

    try {
      const computed = windowRef.getComputedStyle?.(previewHost)
      if (!computed || computed.position === 'static') { previewHost.style.setProperty('position', 'relative'); changedHostPosition = true }
      previewHost.setAttribute?.(HOST_ACTIVE_ATTRIBUTE, '1')
      documentHost?.setAttribute?.(HOST_ACTIVE_ATTRIBUTE, '1')
      nativeBoardControls.forEach((r) => r.node.style?.setProperty?.('display', 'none', 'important'))
      previewHost.appendChild(shell)
      const host = config.postSection && typeof config.postSection.appendChild === 'function' ? config.postSection : null
      if (host) { shell.setAttribute('data-novaflow-ai-video-merge-controls-external', '1'); host.appendChild(leftPanel) }
      else body.insertBefore(leftPanel, center)
    } catch (error) { restoreHost(); throw error }

    // ---- editor + preview
    const MaskTool = modules.mask
    const cloneMask = (surface) => MaskTool.createSurface({ width: surface.debugState().width, height: surface.debugState().height, coverage: surface.copyCoverage() })
    let preview = null
    const editor = modules.timeline.create({
      host: timelineCard,
      cloneMask,
      onDetachTrack: (track) => detachTrack(track),
      onChange: (reason) => { if (!preview) return; if (reason === 'model' || reason === 'drag' || reason === 'transform') { preview.refresh(); syncClipBox() } if (reason === 'zoom') transport.querySelector('[data-act="zoom"]').value = String(editor.zoom()); syncTime() },
      onSelect: (clip) => { if (!preview) return; if (maskEdit && (!clip || clip.id !== maskEdit.clipId)) endMask(true); syncClipBox(); preview.draw() },
      onTime: (t) => { if (!preview) return; preview.tick(t); syncTime() },
      onTransport: (playing) => { if (!preview) return; preview.setPlaying(playing); transport.querySelector('[data-act="play"]').innerHTML = playing ? TRANSPORT_ICONS.pause : TRANSPORT_ICONS.play },
      resolveDrop: (payload, event) => resolvePayload(payload, event),
    })
    preview = modules.preview.mount({
      host: stageHost, editor,
      onZoomPercent: (p) => { zoomReadout.textContent = Math.round(p) + '%' },
      onMaskStroke: (clipId, revision) => { const c = editor.clipOf(clipId); if (c) { c.maskRevision = revision; editor.draw() } },
      onDrop: async (payload, point, event) => {
        const resolved = await resolvePayload(payload, event)
        if (!resolved) return
        const spec = { ...resolved, start: editor.playhead() }
        if (resolved.source.kind !== 'audio') {
          const fit = editor.fitTransform(resolved.source)
          const W = editor.state.canvas.width, H = editor.state.canvas.height
          spec.transform = { scale: fit.scale, centerX: clamp(point.x, 0, W), centerY: clamp(point.y, 0, H) }
        }
        adoptFps(spec.source); editor.addClip(spec); preview.refresh()
      },
    })
    fitButton.addEventListener('click', () => preview.fitToViewport())
    // the runtime lays out every canvas in the preview viewport as the board's own;
    // this attribute is its opt-out (the one 视频合并's canvas used)
    for (const canvas of [preview.canvas, timelineCard.querySelector('.nf-tl-canvas')]) if (canvas) canvas.setAttribute('data-novaflow-ai-video-merge-canvas', '1')

    // ---- resources -> sources
    async function sourceFromDescriptor(descriptor) {
      const id = text(descriptor.resourceId, '')
      if (id && sourcesById.has(id)) return sourcesById.get(id)
      let url = text(descriptor.objectUrl, '')
      let blob = descriptor.file || descriptor.blob || null
      const localPath = text(descriptor.localPath, '')
      if (!blob && localPath) {
        const runtime = root.NovaFlowWebRuntime
        blob = runtime?.fileForToken?.(localPath) || runtime?.videoOutputs?.get?.(localPath)?.blob || null
      }
      if (!url && blob) { url = URL.createObjectURL(blob); ownedUrls.add(url) }
      if (!url) throw new Error('资源没有可读取的文件')
      const fileName = text(descriptor.fileName, 'clip.mp4')
      const source = await sourceFromUrl(url, blob, fileName, text(descriptor.mimeType, ''))
      if (id) sourcesById.set(id, source)
      return source
    }
    async function sourceFromUrl(url, blob, fileName, mimeHint) {
      const mime = String(blob?.type || mimeHint || '').toLowerCase()
      if (mime.startsWith('image/') || isImageName(fileName)) {
        const meta = await probeImage(url)
        return { kind: 'image', url, durationSec: Infinity, width: meta.width, height: meta.height, hasAudio: false, blob, fileName }
      }
      if (mime.startsWith('audio/') || isAudioName(fileName)) {
        const data = blob || await (await fetch(url)).blob()
        const buffer = await audioContext().decodeAudioData(await data.arrayBuffer())
        return { kind: 'audio', url, durationSec: buffer.duration, width: 0, height: 0, hasAudio: true, peaks: peaksOf(buffer), blob: data, fileName }
      }
      const meta = await probeVideo(url)
      const source = { kind: 'video', url, durationSec: meta.durationSec, width: meta.width, height: meta.height, fps: meta.fps || 0, hasAudio: true, peaks: null, blob, fileName }
      // the sound is checked off the file itself; until then the clip counts as sounding
      ;(async () => {
        try {
          const data = blob || await (await fetch(url)).blob()
          const buffer = await audioContext().decodeAudioData(await data.arrayBuffer())
          source.peaks = peaksOf(buffer)
        } catch (_) { source.hasAudio = false }
        if (alive) { editor.draw(); preview.refresh() }
      })()
      return source
    }
    // a resource the bridge will not hand over (an image): its card's media
    function cardMediaDescriptor(resourceId) {
      const card = documentRef.querySelector('[data-novaflow-ai-resource-card="1"][data-novaflow-ai-resource-id="' + CSS_escape(resourceId) + '"]')
      if (!card) return null
      const media = card.querySelector('img, video')
      const src = media && (media.currentSrc || media.src)
      if (!src) return null
      // the card's own file name (its text), never a button's title
      const name = text(card.getAttribute('data-novaflow-ai-resource-name') || Array.from(card.querySelectorAll('*')).map((n) => (n.childElementCount ? '' : n.textContent || '').trim()).find((t) => /\.(png|jpe?g|webp|gif|bmp|mp4|webm)$/i.test(t) || /^(Image|Video)_/.test(t)) || (media.tagName === 'IMG' ? 'image.png' : 'clip.mp4'), 'clip')
      return { resourceId, objectUrl: src, fileName: name, mimeType: media.tagName === 'IMG' ? 'image/png' : 'video/mp4' }
    }
    function CSS_escape(value) { return (root.CSS && root.CSS.escape) ? root.CSS.escape(value) : String(value).replace(/["\\]/g, '\\$&') }
    async function resolveResourceId(resourceId) {
      try { return await sourceFromDescriptor(await dropAdapter.resolveResource(resourceId)) }
      catch (error) {
        const fallback = cardMediaDescriptor(resourceId)
        if (!fallback) throw error
        return sourceFromDescriptor(fallback)
      }
    }
    async function resolvePayload(payload, event) {
      try {
        if (payload === 'files') {
          const files = Array.from(event?.dataTransfer?.files || [])
          const file = files[0]; if (!file) return null
          if (isImageName(file.name) || isAudioName(file.name) || !/\.(mp4|webm)$/i.test(file.name)) {
            const url = URL.createObjectURL(file); ownedUrls.add(url)
            return { source: await sourceFromUrl(url, file, file.name), name: file.name.replace(/\.[^.]+$/, '') }
          }
          const added = await dropAdapter.addLocalFiles([file])
          const source = await sourceFromDescriptor(added[0])
          return { source, name: text(added[0].fileName, file.name).replace(/\.[^.]+$/, '') }
        }
        const resourceId = modules.bridge.readResourceId(event?.dataTransfer) || text(payload, '')
        if (!resourceId) return null
        const source = await resolveResourceId(resourceId)
        return { source, name: text(source.fileName, '片段').replace(/\.[^.]+$/, '') }
      } catch (error) { setStatus(String(error?.message || error), true); return null }
    }
    async function importResource(resourceId) {
      const resolved = await resolvePayload(resourceId, null)
      if (!resolved || !alive) return
      adoptFps(resolved.source); editor.addClip({ ...resolved, start: editor.playhead() }); preview.refresh()
    }
    function handleSharedResourceImport(event) {
      const resourceId = text(event?.detail?.resourceId, '')
      if (!resourceId) return
      event.preventDefault?.()
      void importResource(resourceId)
    }
    windowRef.addEventListener(RESOURCE_IMPORT_EVENT, handleSharedResourceImport)
    // the 'application/x-novaflow-video' type the lab used maps onto the resource MIME here
    const timelineDropTypes = (dt) => Array.from(dt?.types || [])
    timelineCard.addEventListener('dragover', (e) => { if (modules.bridge.readResourceId(e.dataTransfer) || timelineDropTypes(e.dataTransfer).includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' } }, true)

    // ---- busy dialog (with its mask), dropdown, status
    let busyTimer = 0
    const busyMask = el(documentRef, 'div', 'nf-ve-busy-mask'); busyMask.hidden = true
    const busyBox = el(documentRef, 'div', 'nf-ve-busy'); busyBox.hidden = true
    busyBox.innerHTML = '<div class="row"><i class="spin"></i><div class="title"></div></div><div class="msg"></div><div class="bar"><i></i></div><button type="button" class="close" title="关闭" hidden>×</button>'
    documentHost.append(busyMask, busyBox)
    function closeBusy() { busyBox.hidden = true; busyMask.hidden = true }
    function busy(kind, title, message, pct) {
      windowRef.clearTimeout(busyTimer)
      busyBox.hidden = false; busyMask.hidden = false; busyBox.dataset.kind = kind
      busyBox.querySelector('.title').textContent = title
      busyBox.querySelector('.msg').textContent = message || ''
      busyBox.querySelector('.bar > i').style.width = (pct == null ? 0 : Math.round(pct * 100)) + '%'
      busyBox.querySelector('.close').hidden = kind === 'working'
      if (kind === 'done') busyTimer = windowRef.setTimeout(closeBusy, 3000)
    }
    busyBox.querySelector('.close').addEventListener('click', closeBusy)
    busyMask.addEventListener('click', () => { if (busyBox.dataset.kind !== 'working') closeBusy() })
    function setStatus(message, error, success) { const s = $('ve-status'); s.textContent = message; s.dataset.error = error ? '1' : ''; s.dataset.success = success ? '1' : '' }

    const dropdowns = []
    function enhanceSelect(select) {
      select.style.display = 'none'
      const trigger = el(documentRef, 'button', 'nf-ve-dd-trigger'); trigger.type = 'button'
      const text = el(documentRef, 'span'); trigger.appendChild(text); trigger.appendChild(el(documentRef, 'i'))
      select.insertAdjacentElement('afterend', trigger)
      const sync = () => { const o = select.options[select.selectedIndex]; text.textContent = o ? o.textContent : '' }
      const close = () => { documentRef.querySelectorAll('.nf-ve-dd-overlay,.nf-ve-dd-panel').forEach((n) => n.remove()); trigger.dataset.open = ''; documentRef.removeEventListener('keydown', onKey) }
      const onKey = (e) => { if (e.key === 'Escape') close() }
      trigger.addEventListener('click', () => {
        close()
        const overlay = el(documentRef, 'div', 'nf-ve-dd-overlay'), panel = el(documentRef, 'div', 'nf-ve-dd-panel')
        Array.from(select.options).forEach((o, i) => {
          const item = el(documentRef, 'div', 'nf-ve-dd-item', o.textContent)
          if (i === select.selectedIndex) item.dataset.selected = '1'
          item.addEventListener('click', () => { select.selectedIndex = i; sync(); close(); select.dispatchEvent(new Event('change', { bubbles: true })) })
          panel.appendChild(item)
        })
        const r = trigger.getBoundingClientRect()
        panel.style.left = r.left + 'px'; panel.style.width = r.width + 'px'
        const need = Math.min(select.options.length * 26 + 2, windowRef.innerHeight * 0.6)
        if (windowRef.innerHeight - r.bottom - 8 >= need) panel.style.top = (r.bottom + 2) + 'px'; else panel.style.bottom = (windowRef.innerHeight - r.top + 2) + 'px'
        overlay.addEventListener('click', close)
        trigger.dataset.open = '1'
        documentHost.append(overlay, panel)
        documentRef.addEventListener('keydown', onKey)
      })
      select.addEventListener('change', sync); sync()
      dropdowns.push({ sync, close })
    }
    enhanceSelect($('ve-canvas-size'))
    function setSlider(id, value, max) { const node = $(id); if (max !== undefined) node.max = String(Math.max(Number(node.step) || 0.1, max)); if (documentRef.activeElement !== node) node.value = String(value); const lo = Number(node.min) || 0, hi = Number(node.max) || 1; node.style.setProperty('--fill', clamp((Number(node.value) - lo) / (hi - lo) * 100, 0, 100) + '%') }

    // ---- canvas
    function applyCanvas(w, h) {
      w = clamp(Math.round((finite(w, 1280)) / 2) * 2, 2, 8192); h = clamp(Math.round((finite(h, 720)) / 2) * 2, 2, 8192)
      $('ve-canvas-w').value = String(w); $('ve-canvas-h').value = String(h)
      const preset = CANVAS_PRESETS.find(([v]) => v === w + 'x' + h)
      $('ve-canvas-size').value = preset ? preset[0] : 'custom'; dropdowns.forEach((d) => d.sync())
      editor.setCanvas(w, h); preview.resize(); syncClipBox()
    }
    $('ve-canvas-size').addEventListener('change', () => { const v = $('ve-canvas-size').value; if (v === 'custom') { $('ve-canvas-w').focus(); return } const [w, h] = v.split('x').map(Number); applyCanvas(w, h) })
    $('ve-canvas-w').addEventListener('change', () => applyCanvas($('ve-canvas-w').value, $('ve-canvas-h').value))
    $('ve-canvas-h').addEventListener('change', () => applyCanvas($('ve-canvas-w').value, $('ve-canvas-h').value))
    $('ve-canvas-from-clip').addEventListener('click', () => { const c = editor.selectedClip() || editor.allClips().find((x) => x.transform); if (!c || !c.transform) { setStatus('先选中一个视频或图片片段', true); return } applyCanvas(c.source.width, c.source.height); editor.setTransform(c.id, editor.fitTransform(c.source)); preview.draw() })
    // the output frame rate is the first video clip's own (measured on import); no control for it
    let fpsAdopted = false
    const adoptFps = (source) => { if (fpsAdopted || !source || source.kind !== 'video' || !(source.fps > 0)) return; fpsAdopted = true; editor.setCanvas(editor.state.canvas.width, editor.state.canvas.height, source.fps); shell.setAttribute('data-nf-ve-fps', String(editor.state.canvas.fps)) }

    // ---- clip panel
    function syncTime() { transport.querySelector('.time').textContent = editor.formatTime(editor.playhead()) + ' / ' + editor.formatTime(editor.projectEnd()) }
    function syncClipBox() {
      const clip = editor.selectedClip()
      $('ve-clip-empty').hidden = Boolean(clip); $('ve-clip-box').hidden = !clip
      if (!clip) return
      if (documentRef.activeElement !== $('ve-clip-name')) $('ve-clip-name').value = clip.name
      const tr = clip.transform, isVideo = Boolean(tr)
      for (const id of ['ve-clip-scale', 've-clip-scale-range', 've-clip-x', 've-clip-y', 've-clip-fit']) $(id).disabled = !isVideo
      if (isVideo) {
        const pct = Math.round(tr.scale * 100)
        if (documentRef.activeElement !== $('ve-clip-scale')) $('ve-clip-scale').value = String(pct)
        setSlider('ve-clip-scale-range', Math.min(300, pct))
        if (documentRef.activeElement !== $('ve-clip-x')) $('ve-clip-x').value = String(Math.round(tr.centerX))
        if (documentRef.activeElement !== $('ve-clip-y')) $('ve-clip-y').value = String(Math.round(tr.centerY))
      }
      $('ve-clip-timing').textContent = editor.formatTime(clip.start) + ' / ' + editor.formatTime(clip.length)
      $('ve-clip-length-row').hidden = !clip.isImage
      if (documentRef.activeElement !== $('ve-clip-length')) $('ve-clip-length').value = clip.length.toFixed(1)
      setSlider('ve-fadein', clip.fadeIn, Math.min(30, clip.length)); $('ve-fadein-value').textContent = clip.fadeIn.toFixed(1)
      setSlider('ve-fadeout', clip.fadeOut, Math.min(30, clip.length)); $('ve-fadeout-value').textContent = clip.fadeOut.toFixed(1)
      $('ve-mask-edit').hidden = Boolean(maskEdit) || !clip.transform
      $('ve-mask-edit').textContent = clip.mask && clip.maskRevision > 0 ? '蒙版（已有）' : '蒙版编辑'
    }
    $('ve-clip-name').addEventListener('change', () => { const c = editor.selectedClip(); if (c) { c.name = $('ve-clip-name').value.trim() || c.name; editor.draw() } })
    const applyScale = (pct) => { const c = editor.selectedClip(); if (c) { editor.setTransform(c.id, { scale: Math.max(5, finite(pct, 100)) / 100 }); preview.draw(); syncClipBox() } }
    $('ve-clip-scale').addEventListener('input', () => applyScale($('ve-clip-scale').value))
    $('ve-clip-scale-range').addEventListener('input', () => applyScale($('ve-clip-scale-range').value))
    $('ve-clip-x').addEventListener('input', () => { const c = editor.selectedClip(); if (c) { editor.setTransform(c.id, { centerX: finite($('ve-clip-x').value, 0) }); preview.draw() } })
    $('ve-clip-y').addEventListener('input', () => { const c = editor.selectedClip(); if (c) { editor.setTransform(c.id, { centerY: finite($('ve-clip-y').value, 0) }); preview.draw() } })
    $('ve-clip-fit').addEventListener('click', () => { const c = editor.selectedClip(); if (c && c.transform) { editor.setTransform(c.id, editor.fitTransform(c.source)); preview.draw(); syncClipBox() } })
    $('ve-clip-length').addEventListener('change', () => { const c = editor.selectedClip(); if (c) { editor.setLength(c.id, finite($('ve-clip-length').value, 3)); preview.refresh() } })
    $('ve-fadein').addEventListener('input', () => { const c = editor.selectedClip(); if (c) { editor.setFade(c.id, finite($('ve-fadein').value, 0), undefined); preview.draw(); syncClipBox() } })
    $('ve-fadeout').addEventListener('input', () => { const c = editor.selectedClip(); if (c) { editor.setFade(c.id, undefined, finite($('ve-fadeout').value, 0)); preview.draw(); syncClipBox() } })

    // ---- 分离音轨 (track header icon)
    function audioSourceFor(clip) { return { kind: 'audio', url: clip.source.url, durationSec: clip.source.durationSec, width: 0, height: 0, hasAudio: true, peaks: clip.source.peaks || null, blob: clip.source.blob, fileName: clip.source.fileName } }
    function detachTrack(track) {
      const names = []
      for (const c of track.clips.filter((x) => x.source.hasAudio && !x.audioDetached && !x.isImage)) { if (editor.detachAudio(c.id, audioSourceFor(c))) names.push(c.name) }
      if (names.length) { preview.refresh(); setStatus('已把 ' + names.join('、') + ' 的声音分离到音频轨', false, true) }
    }

    // ---- 蒙版
    let maskEdit = null
    const maskState = () => ({ enabled: true, clipId: maskEdit.clipId, surface: maskEdit.surface, mode: $('ve-mask-erase').getAttribute('aria-pressed') === 'true' ? 'erase' : 'restore', brushSize: finite($('ve-mask-brush').value, 22), feather: finite($('ve-mask-feather').value, 0) })
    function beginMask() {
      const clip = editor.selectedClip()
      if (!clip || !clip.transform) { setStatus('先在时间轴上选中一个视频或图片片段', true); return }
      editor.pause()
      let surface = clip.mask, entryCoverage = null
      if (!surface) surface = MaskTool.createSurface({ width: clip.source.width, height: clip.source.height })
      else entryCoverage = surface.copyCoverage()
      maskEdit = { clipId: clip.id, surface, entryCoverage }
      $('ve-mask-edit').hidden = true; $('ve-mask-box').hidden = false
      documentRef.body.setAttribute('data-nf-ve-masking', '1')
      MASK_BLOCK_EVENTS.forEach((type) => documentRef.addEventListener(type, blockWhileMasking, true))
      preview.setMaskEditing(maskState())
    }
    const MASK_BLOCK_EVENTS = ['pointerdown', 'mousedown', 'click', 'dblclick', 'wheel', 'contextmenu']
    function blockWhileMasking(event) {
      if (!maskEdit) return
      const target = event.target instanceof Element ? event.target : null
      if (!target) return
      if (target.closest('#ve-mask-box, .nf-vm-stage, [data-novaflow-primary-entry="1"], #novaflow-primary-audio-cell, [data-nf-mask-label]')) return
      event.preventDefault(); event.stopImmediatePropagation()
    }
    function endMask(apply) {
      if (!maskEdit) return
      const clip = editor.clipOf(maskEdit.clipId)
      if (apply) { const rev = maskEdit.surface.debugState().revision; if (clip) editor.setMask(clip.id, rev > 0 ? maskEdit.surface : null, rev) }
      else if (clip) { if (maskEdit.entryCoverage) maskEdit.surface.reset(maskEdit.entryCoverage); else { editor.setMask(clip.id, null, 0); maskEdit.surface.destroy() } }
      maskEdit = null
      $('ve-mask-edit').hidden = false; $('ve-mask-box').hidden = true
      documentRef.body.removeAttribute('data-nf-ve-masking')
      MASK_BLOCK_EVENTS.forEach((type) => documentRef.removeEventListener(type, blockWhileMasking, true))
      preview.setMaskEditing({ enabled: false }); editor.draw(); syncClipBox()
    }
    $('ve-mask-edit').addEventListener('click', beginMask)
    $('ve-mask-ok').addEventListener('click', () => endMask(true))
    $('ve-mask-cancel').addEventListener('click', () => endMask(false))
    const setMaskMode = (mode) => { $('ve-mask-erase').setAttribute('aria-pressed', String(mode === 'erase')); $('ve-mask-restore').setAttribute('aria-pressed', String(mode === 'restore')); if (maskEdit) preview.updateMaskBrush({ mode }) }
    $('ve-mask-erase').addEventListener('click', () => setMaskMode('erase'))
    $('ve-mask-restore').addEventListener('click', () => setMaskMode('restore'))
    const syncBrush = (from) => { const b = clamp(finite($(from === 'range' ? 've-mask-brush-range' : 've-mask-brush').value, 22), 1, 300); $('ve-mask-brush').value = String(b); setSlider('ve-mask-brush-range', b); if (maskEdit) preview.updateMaskBrush({ brushSize: b }) }
    const syncFeather = (from) => { const f = clamp(finite($(from === 'range' ? 've-mask-feather-range' : 've-mask-feather').value, 0), 0, 300); $('ve-mask-feather').value = String(f); setSlider('ve-mask-feather-range', f); if (maskEdit) preview.updateMaskBrush({ feather: f }) }
    $('ve-mask-brush').addEventListener('input', () => syncBrush('number')); $('ve-mask-brush-range').addEventListener('input', () => syncBrush('range'))
    $('ve-mask-feather').addEventListener('input', () => syncFeather('number')); $('ve-mask-feather-range').addEventListener('input', () => syncFeather('range'))
    $('ve-mask-undo').addEventListener('click', () => { if (maskEdit && maskEdit.surface.canUndo()) { maskEdit.surface.undo(); preview.draw() } })
    $('ve-mask-clear').addEventListener('click', () => { if (maskEdit) { maskEdit.surface.clear(); preview.draw() } })
    syncBrush('number'); syncFeather('number')

    // ---- transport, copy / paste, keys
    let clipboard = null
    function copySelected() { const c = editor.selectedClip(); if (!c) return false; clipboard = c; return true }
    function pasteAtPlayhead() {
      if (!clipboard) return false
      const src = clipboard
      const pasted = editor.addClip({ source: src.source, name: src.name, trackId: src.trackId, start: editor.playhead(), transform: src.transform ? { ...src.transform } : undefined, fadeIn: src.fadeIn, fadeOut: src.fadeOut })
      pasted.offset = src.offset; pasted.end = src.end; editor.syncLength(pasted); pasted.audioDetached = src.audioDetached
      if (src.mask && src.maskRevision > 0) editor.setMask(pasted.id, cloneMask(src.mask), src.maskRevision)
      editor.select(pasted.id); editor.layout(); preview.refresh()
      return true
    }
    transport.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act
      if (!act) return
      if (act === 'start') editor.seek(0)
      else if (act === 'end') editor.seek(editor.projectEnd())
      else if (act === 'prev') editor.prevEdge()
      else if (act === 'next') editor.nextEdge()
      else if (act === 'play') editor.toggle()
      else if (act === 'loop') { editor.setLoop(!editor.state.loop); e.target.closest('[data-act]').setAttribute('aria-pressed', String(editor.state.loop)) }
      else if (act === 'split') { editor.splitAtPlayhead(); preview.refresh() }
      else if (act === 'copy') { if (copySelected()) pasteAtPlayhead() }
      else if (act === 'del') { if (editor.deleteSelected()) preview.refresh() }
    })
    transport.querySelector('[data-act="snap"]').addEventListener('change', (e) => editor.setSnap(e.target.checked))
    transport.querySelector('[data-act="zoom"]').addEventListener('input', (e) => editor.setZoom(finite(e.target.value, 40)))
    function isTextTarget(target) { const tag = String(target?.tagName || '').toLowerCase(); return tag === 'input' || tag === 'select' || tag === 'textarea' || Boolean(target?.isContentEditable) }
    function handleKey(event) {
      if (!alive || isTextTarget(event.target)) return
      const key = event.key
      if (maskEdit) { if (key === 'Escape') { event.preventDefault(); endMask(false) } else if (key === 'Enter') { event.preventDefault(); endMask(true) } return }
      if ((event.ctrlKey || event.metaKey) && (key === 'c' || key === 'C')) { if (copySelected()) event.preventDefault(); return }
      if ((event.ctrlKey || event.metaKey) && (key === 'v' || key === 'V')) { if (pasteAtPlayhead()) event.preventDefault(); return }
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (event.code === 'Space') { event.preventDefault(); event.stopPropagation(); editor.toggle() }
      else if (key === 'Delete' || key === 'Backspace') { if (editor.deleteSelected()) { event.preventDefault(); preview.refresh() } }
      else if (key === 's' || key === 'S') { editor.splitAtPlayhead(); preview.refresh() }
    }
    windowRef.addEventListener('keydown', handleKey, true)

    // ---- 保存到资源列表 / 导出
    async function maskPngBytes(surface) {
      const canvas = surface.getCanvas()
      const blob = canvas.convertToBlob ? await canvas.convertToBlob({ type: 'image/png' }) : await new Promise((res) => canvas.toBlob(res, 'image/png'))
      return new Uint8Array(await blob.arrayBuffer())
    }
    async function buildManifest(format, filePath) {
      const state = editor.state
      const layers = []
      let duration = 0
      for (let i = state.tracks.length - 1; i >= 0; i -= 1) {
        const track = state.tracks[i]
        for (const clip of track.clips) {
          duration = Math.max(duration, clip.start + clip.length)
          const isAudio = clip.kind === 'audio'
          if (!isAudio && (!track.visible || !clip.visible)) continue
          layers.push({
            clipId: clip.id, kind: isAudio ? 'audio' : 'video', image: Boolean(clip.isImage), video: !isAudio,
            source: { blob: clip.source.blob, url: clip.source.url, fileName: clip.source.fileName, width: clip.source.width, height: clip.source.height },
            start: clip.start, offset: clip.offset, length: clip.length,
            transform: clip.transform ? { ...clip.transform } : null,
            fadeIn: clip.fadeIn, fadeOut: clip.fadeOut,
            audio: Boolean(clip.source.hasAudio && !track.mute && !clip.isImage && !clip.audioDetached),
            maskPng: clip.mask && clip.maskRevision > 0 ? await maskPngBytes(clip.mask) : null,
          })
        }
      }
      if (!layers.some((l) => l.video)) throw new Error('时间轴上没有可见的视频片段')
      return { schema: 'novaflow-video-editor/1', output: { filePath: filePath || '', format, width: state.canvas.width, height: state.canvas.height, fps: state.canvas.fps }, duration, layers }
    }
    function exportFormat() { return editor.allClips().some((c) => /\.webm$/i.test(c.source.fileName || '')) ? 'webm' : 'mp4' }
    let progressUnsubscribe = null
    function listenProgress() {
      if (typeof electronAPI.onVideoCompositorProgress !== 'function') return () => {}
      const off = electronAPI.onVideoCompositorProgress((e) => { if (!exporting) return; if (e?.stage === 'render') busy('working', '正在合成', e.message || '', e.progress01); else if (e?.stage && e.stage !== 'done' && e.stage !== 'error') busy('working', e.stage === 'load' ? '正在加载视频处理组件' : '正在合成', e.message || '', null) })
      return typeof off === 'function' ? off : () => {}
    }
    async function runExport(publish) {
      if (exporting) return { ok: false, blocked: true }
      if (typeof electronAPI.videoEditorExport !== 'function') { setStatus('当前环境暂不支持视频编辑导出', true); return { ok: false, unavailable: true } }
      if (maskEdit) endMask(true)
      editor.pause()
      exporting = true; $('ve-save').disabled = true
      busy('working', '正在合成', '准备片段', null)
      progressUnsubscribe = listenProgress()
      const format = exportFormat()
      let reserved = ''
      try {
        if (publish && typeof electronAPI.aiSeqCacheReserveOutput === 'function') {
          const r = await electronAPI.aiSeqCacheReserveOutput({ format, baseName: 'novaflow_video_edit' })
          if (r?.ok === false) throw new Error(r?.error || '资源位预留失败')
          reserved = text(r?.path || r?.filePath, '')
        }
        const t0 = performance.now()
        const manifest = await buildManifest(format, reserved)
        const result = await electronAPI.videoEditorExport(manifest)
        if (!result || result.ok === false) throw new Error(result?.error || '视频合成失败')
        const seconds = ((performance.now() - t0) / 1000).toFixed(1)
        if (publish) {
          const published = await dropAdapter.publishExportedVideo({ filePath: text(result.filePath || result.path, reserved), mimeType: format === 'webm' ? 'video/webm' : 'video/mp4' })
          const note = '已存入资源列表和仓库：' + text(published?.fileName, result.fileName || '') + '（' + (finite(result.bytes, 0) / 1024 / 1024).toFixed(2) + ' MB）'
          setStatus(note, false, true); busy('done', '已保存', note, null)
        } else {
          const url = result.url || (result.blob ? URL.createObjectURL(result.blob) : '')
          if (url) { const a = documentRef.createElement('a'); a.href = url; a.download = text(result.fileName, 'novaflow_video_edit.' + format); documentHost.appendChild(a); a.click(); a.remove() }
          busy('done', '已导出', text(result.fileName, '') + '（' + seconds + ' s）', null)
        }
        return Object.assign({ ok: true }, result)
      } catch (error) {
        const message = String(error?.message || error)
        setStatus(message, true); busy('error', publish ? '保存失败' : '导出失败', message, null)
        if (reserved && typeof electronAPI.aiSeqCacheReleaseOutput === 'function') { try { await electronAPI.aiSeqCacheReleaseOutput({ key: reserved }) } catch (_) {} }
        return { ok: false, error: message }
      } finally {
        exporting = false; $('ve-save').disabled = false
        try { progressUnsubscribe?.() } catch (_) {}
        progressUnsubscribe = null
      }
    }
    $('ve-save').addEventListener('click', () => { void runExport(true) })
    // 关闭 = the 视频编辑 row heading clicked again (the row owns open / close)
    $('ve-close-row').addEventListener('click', () => {
      const heading = documentRef.querySelector('[data-novaflow-ai-tool-heading="video-merge"]')
      if (!heading) { handle.close(); return }
      const r = heading.getBoundingClientRect()
      const init = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true }
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) heading.dispatchEvent(type.startsWith('pointer') && windowRef.PointerEvent ? new windowRef.PointerEvent(type, init) : new windowRef.MouseEvent(type, init))
    })
    // the board's 深色 / 白色 / 灰色 dots: repaint once the runtime has applied the colour
    const onBoardColor = (event) => { if (event.target instanceof Element && event.target.closest('[data-novaflow-ai-preview-bg-option]')) { windowRef.requestAnimationFrame(() => preview.draw()); windowRef.setTimeout(() => preview.draw(), 120) } }
    documentRef.addEventListener('click', onBoardColor, true)

    const handle = Object.freeze({
      editor, preview,
      importResource,
      saveAndClose: () => runExport(true),
      export: () => runExport(false),
      debugSnapshot: () => ({ open: alive, exporting, clipCount: editor.clipCount(), tracks: editor.state.tracks.length }),
      close() {
        if (!alive) return false
        alive = false
        windowRef.removeEventListener(RESOURCE_IMPORT_EVENT, handleSharedResourceImport)
        windowRef.removeEventListener('keydown', handleKey, true)
        documentRef.removeEventListener('click', onBoardColor, true)
        try { progressUnsubscribe?.() } catch (_) {}
        try { if (maskEdit) endMask(false) } catch (_) {}
        documentRef.body?.removeAttribute?.('data-nf-ve-masking')
        dropdowns.forEach((d) => d.close())
        closeBusy(); busyMask.remove(); busyBox.remove()
        try { preview.destroy() } catch (_) {}
        try { editor.destroy() } catch (_) {}
        for (const url of ownedUrls) { try { URL.revokeObjectURL(url) } catch (_) {} }
        ownedUrls.clear()
        try { leftPanel.remove() } catch (_) {}
        try { shell.remove() } catch (_) {}
        restoreHost()
        if (activeHandle === handle) activeHandle = null
        return true
      },
    })
    activeHandle = handle
    syncTime(); syncClipBox()
    return handle
  }

  function close(options) { return activeHandle ? activeHandle.close(options) : false }
  function saveAndClose() { return activeHandle?.saveAndClose?.() || Promise.resolve({ ok: false, inactive: true }) }
  function exportToFile() { return activeHandle?.export?.() || Promise.resolve({ ok: false, inactive: true }) }
  function isOpen() { return Boolean(activeHandle?.debugSnapshot?.().open) }

  return Object.freeze({ version: 4, RESOURCE_IMPORT_EVENT, open, close, saveAndClose, exportToFile, isOpen })
})
