(function (root) {
  'use strict';
  const STORAGE = 'novaflow.pose-reference.v2';
  const scriptUrl = root.document?.currentScript?.src || root.location?.href;
  const vendor = name => new URL(`./vendor/vnccs/${name}`, scriptUrl).href;
  const size = value => Math.max(256, Math.min(2048, Math.round(Number(value) || 1024)));
  const clone = value => JSON.parse(JSON.stringify(value));
  let editor = null, opening = null, previousFocus = null;

  // Keep the complete upstream pose (including camera, IK and root translations).
  function normalizeDocument(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('姿势文件格式不正确');
    const rawPose = input.pose || input.poses?.[0]?.pose || input.poses?.[0] || input;
    if (!rawPose.bones || typeof rawPose.bones !== 'object' || Array.isArray(rawPose.bones)) throw new Error('文件缺少骨骼姿势');
    let count = 0;
    function validate(value, depth = 0) {
      if (depth > 12 || ++count > 20000) throw new Error('姿势文件过于复杂');
      if (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > 100000)) throw new Error('姿势数值超出范围');
      if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
          if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('姿势文件包含无效字段');
          validate(child, depth + 1);
        }
      }
    }
    // Validate source data before picking fields; pose-library scenes may also contain
    // body-shape settings and prompts. Those never replace the adult mannequin or user prompt.
    validate(rawPose);
    const pose = Object.fromEntries(['bones', 'bonePositions', 'modelRotation', 'ikEffectorPositions', 'poleTargetPositions', 'hipBonePosition', 'cameraParams', 'camera'].filter(key => rawPose[key] !== undefined).map(key => [key, clone(rawPose[key])]));
    if (pose.camera && !('posX' in pose.camera) && ('yaw_deg' in pose.camera || 'pitch_deg' in pose.camera)) {
      pose.cameraParams = { ...pose.cameraParams, ...pose.camera }; delete pose.camera;
    }
    for (const rotation of Object.values(pose.bones)) {
      if (!Array.isArray(rotation) || rotation.length !== 3 || !rotation.every(Number.isFinite)) throw new Error('骨骼旋转格式不正确');
    }
    for (const key of ['bonePositions', 'ikEffectorPositions', 'poleTargetPositions', 'hipBonePosition']) {
      for (const position of Object.values(pose[key] || {})) {
        if (!Array.isArray(position) || position.length !== 3 || !position.every(Number.isFinite)) throw new Error('关节位置格式不正确');
      }
    }
    if (pose.modelRotation && (!Array.isArray(pose.modelRotation) || pose.modelRotation.length !== 3 || !pose.modelRotation.every(Number.isFinite))) throw new Error('人偶方向格式不正确');
    if (pose.camera && !['posX', 'posY', 'posZ', 'targetX', 'targetY', 'targetZ'].every(key => Number.isFinite(pose.camera[key]))) throw new Error('镜头位置格式不正确');
    const view = input.view;
    if (view && (![view.fov, view.zoom].every(Number.isFinite) || view.fov < 10 || view.fov > 100 || view.zoom < 0.1 || view.zoom > 10)) throw new Error('镜头投影格式不正确');
    return { version: 1, pose, width: size(input.width), height: size(input.height), background: /^#[a-f0-9]{6}$/i.test(input.background) ? input.background : '#e4e5e8', ...(view ? { view: { fov: view.fov, zoom: view.zoom } } : {}) };
  }

  function referenceSlot(bridge) {
    if (!bridge?.state?.active) throw new Error('请先打开生图工具');
    if (bridge.state.running) throw new Error('请等待当前生成结束后再加入姿势参考');
    const refs = bridge.references(), limit = bridge.referenceLimit();
    const index = Array.from({ length: limit }, (_, i) => i).find(i => !refs[i]?.dataUrl);
    if (index === undefined) throw new Error(`参考图已满（最多 ${limit} 张），请先移除一张`);
    return index;
  }

  function applyReference(bridge, document, dataUrl) {
    const index = referenceSlot(bridge);
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) throw new Error('姿势图导出失败');
    const doc = normalizeDocument(document);
    bridge.setReference(index, { name: `姿势参考_${index + 1}.png`, dataUrl, mimeType: 'image/png', width: doc.width, height: doc.height, source: 'pose-reference', poseDocument: doc });
    bridge.state.status = `姿势图已加入参考图${index + 1}`;
    bridge.state.error = '';
    bridge.setMode('img2img');
    bridge.render({ forceBottom: true });
    return index;
  }

  function element(tag, attrs = {}, children = []) {
    const node = root.document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else if (key === 'text') node.textContent = value;
      else node.setAttribute(key, value);
    }
    node.append(...children);
    return node;
  }
  const button = (text, onclick, attrs = {}) => element('button', { type: 'button', text, onclick, ...attrs });

  function installStyle() {
    if (root.document.getElementById('nf-pose-style')) return;
    root.document.head.append(element('style', { id: 'nf-pose-style', text: `
      .nf-pose-launch{width:100%;margin-top:12px;padding:8px 10px;text-align:left;border:1px solid #343434;border-radius:6px;background:#262626;color:#e9e9e9;cursor:pointer;font:12px system-ui}
      .nf-pose-overlay{position:fixed;inset:0;z-index:2147483647;background:#0009;display:grid;place-items:center;padding:20px;box-sizing:border-box;color:#e9e9e9;font:12px system-ui}
      .nf-pose-dialog{width:min(1140px,100%);height:min(800px,100%);display:flex;flex-direction:column;background:#202020;border:1px solid #414141;border-radius:12px;box-shadow:0 24px 80px #0008;overflow:hidden}
      .nf-pose-dialog *{box-sizing:border-box}.nf-pose-dialog button,.nf-pose-dialog select,.nf-pose-dialog input[type=number]{background:#2b2b2b;color:#eee;border:1px solid #454545;border-radius:5px;min-height:30px;padding:4px 9px;font:12px system-ui}
      .nf-pose-dialog button{cursor:pointer}.nf-pose-dialog button:hover{background:#383838}.nf-pose-dialog button:disabled{opacity:.4;cursor:default}.nf-pose-dialog :focus-visible{outline:2px solid #24b78d;outline-offset:2px}
      .nf-pose-head,.nf-pose-foot{display:flex;align-items:center;gap:8px;padding:12px 16px;flex:none}.nf-pose-head{border-bottom:1px solid #353535}.nf-pose-head h2{margin:0;flex:1;font-size:15px;font-weight:600;color:#eee!important}.nf-pose-foot{border-top:1px solid #353535;flex-wrap:wrap}
      .nf-pose-body{position:relative;display:flex;flex:1;min-height:0}.nf-pose-side{width:224px;flex:none;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:12px;border-right:1px solid #353535}.nf-pose-side label{display:grid;gap:6px;color:#bcbcbc}.nf-pose-side select{width:100%}.nf-pose-side h3{font-size:12px;margin:0;color:#ddd}.nf-pose-row{display:flex;gap:6px;align-items:center}.nf-pose-row>*{min-width:0;flex:1}.nf-pose-row input{width:66px}.nf-pose-row .nf-pose-times{flex:0 0 10px}.nf-pose-row input[type=number]{padding:4px;appearance:textfield}.nf-pose-row input[type=number]::-webkit-inner-spin-button{appearance:none}.nf-pose-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}
      .nf-pose-library{position:absolute;inset:0;z-index:4;background:#202020;display:flex;flex-direction:column;padding:12px;gap:10px}.nf-pose-library[hidden]{display:none}.nf-pose-library-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.nf-pose-library-bar input{min-width:80px;flex:1;background:#2b2b2b;color:#eee;border:1px solid #454545;border-radius:5px;padding:7px;font:12px system-ui}.nf-pose-library-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));grid-auto-rows:max-content;gap:10px;overflow:auto;align-content:start;min-height:0;flex:1}.nf-pose-dialog .nf-pose-card{display:flex;flex-direction:column;align-items:stretch;gap:6px;text-align:center;padding:6px!important;height:auto!important;min-height:176px!important;max-height:none!important;overflow:hidden}.nf-pose-card img{display:block;width:100%;height:126px;object-fit:contain;background:#171717;border-radius:4px;flex:none}.nf-pose-card span{font-size:11px;color:#ddd;line-height:1.4;overflow-wrap:anywhere}.nf-pose-card small{color:#999;font-size:10px}.nf-pose-library-count{color:#aaa;font-size:11px}.nf-pose-side label.nf-pose-row{display:flex}
      .nf-pose-view{flex:1;min-width:0;display:flex;flex-direction:column;background:#181818}.nf-pose-stage{flex:1;min-height:0;display:grid;place-items:center;padding:16px;overflow:hidden}.nf-pose-canvas{display:block;touch-action:none;border:1px solid #505050;border-radius:4px;max-width:100%;max-height:100%}.nf-pose-hint{padding:8px 16px;color:#999;line-height:1.6;font-size:11px}.nf-pose-status{flex:1;min-width:160px;color:#aaa;line-height:1.5}.nf-pose-status[data-error=true]{color:#ff9898}.nf-pose-dialog .nf-pose-primary{background:#177758;border-color:#24866b}.nf-pose-dialog .nf-pose-primary:hover{background:#218c69}.nf-pose-dialog input[type=range]{width:100%;accent-color:#20b58a}.nf-pose-side a{color:#aaa;font-size:10px}.nf-pose-busy{color:#aaa;text-align:center;padding:16px}.nf-pose-axis{display:grid;grid-template-columns:15px 1fr 51px;gap:6px;align-items:center}.nf-pose-axis input[type=number]{width:51px;padding:3px}
      @media(max-width:760px){.nf-pose-overlay{padding:6px}.nf-pose-side{width:176px;padding:10px}.nf-pose-head,.nf-pose-foot{padding:8px}.nf-pose-foot button{flex:1}.nf-pose-status{flex-basis:100%}.nf-pose-stage{padding:6px}}
    ` }));
  }

  async function open() {
    if (editor) { editor.closeButton.focus(); return; }
    if (opening) return opening;
    opening = createEditor().finally(() => { opening = null; });
    return opening;
  }

  async function createEditor() {
    installStyle();
    previousFocus = root.document.activeElement;
    const state = { width: size(root.__NovaFlowArtGenerate?.state.width), height: size(root.__NovaFlowArtGenerate?.state.height), background: '#e4e5e8' };
    let saved;
    try { saved = normalizeDocument(JSON.parse(root.localStorage.getItem(STORAGE))); Object.assign(state, saved); } catch (_) {}
    const abort = new AbortController();
    const overlay = element('div', { class: 'nf-pose-overlay', 'data-novaflow-pose-reference': '1' });
    const dialog = element('section', { class: 'nf-pose-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'nf-pose-title' });
    const closeButton = button('关闭', close, { 'aria-label': '关闭姿势参考' });
    const status = element('div', { class: 'nf-pose-status', role: 'status', 'aria-live': 'polite', text: '正在载入人偶编辑器…' });
    const side = element('div', { class: 'nf-pose-side' });
    const canvas = element('canvas', { class: 'nf-pose-canvas', width: '640', height: '640', tabindex: '0', 'aria-label': '3D 人偶姿势视图' });
    const stage = element('div', { class: 'nf-pose-stage' }, [canvas]);
    const view = element('div', { class: 'nf-pose-view' }, [stage, element('div', { class: 'nf-pose-hint', text: '点击关节旋转；开启肢体拖动后拖动手脚。空白处拖动旋转视角，右键平移，滚轮缩放。导出自动隐藏关节、网格和操作手柄。' })]);
    const actions = [];
    const action = (text, fn, attrs = {}) => { const b = button(text, () => run(fn), { disabled: '', ...attrs }); actions.push(b); return b; };
    function message(text, error = false) { status.textContent = text; status.dataset.error = String(error); }
    async function run(fn) { try { await fn(); } catch (error) { message(error.message || String(error), true); } }
    let viewer, resizeObserver, saveTimer, handPresets, boneSelect, library, libraryButton, libraryData, axisControls = [];
    function snapshot() { return { version: 1, width: state.width, height: state.height, background: state.background, pose: viewer.getPose(), view: { fov: viewer.camera.fov, zoom: viewer.camera.zoom } }; }
    function persist() { if (viewer?.isInitialized()) { try { root.localStorage.setItem(STORAGE, JSON.stringify(snapshot())); } catch (_) { message('浏览器无法保存姿势，请使用「保存姿势」下载文件', true); } } }
    function changed() { clearTimeout(saveTimer); saveTimer = setTimeout(persist, 180); syncAxes(); }
    function close() {
      persist(); clearTimeout(saveTimer); abort.abort(); resizeObserver?.disconnect(); viewer?.dispose(); overlay.remove(); editor = null;
      if (previousFocus?.isConnected) previousFocus.focus();
    }
    function download(blob, name) {
      const url = URL.createObjectURL(blob), link = element('a', { href: url, download: name });
      root.document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    function resize() {
      const rect = stage.getBoundingClientRect(), ratio = state.width / state.height;
      const width = Math.max(1, Math.min(rect.width - 32, (rect.height - 32) * ratio));
      const height = Math.max(1, width / ratio);
      canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
      viewer?.resize(width, height);
    }
    function fitView() {
      viewer.skinnedMesh.updateMatrixWorld(true); viewer.skeleton.update(); viewer.skinnedMesh.computeBoundingBox();
      const bounds = new viewer.THREE.Box3().setFromObject(viewer.skinnedMesh), extent = bounds.getSize(new viewer.THREE.Vector3());
      const distance = Math.max(extent.y, extent.x / viewer.camera.aspect) / (2 * Math.tan(viewer.camera.fov * Math.PI / 360)) * viewer.camera.zoom * 1.18;
      const direction = viewer.camera.position.clone().sub(viewer.orbit.target).normalize();
      viewer.orbit.target.copy(bounds.getCenter(new viewer.THREE.Vector3()));
      viewer.camera.position.copy(viewer.orbit.target).addScaledVector(direction, distance);
      viewer.orbit.update(); viewer.requestRender(); changed();
    }
    async function capture() {
      await viewer.waitForCaptureReady();
      // Viewport ratio always equals the output ratio, so orbit/pan/zoom are exported as seen.
      const image = viewer.capture(state.width, state.height, 1, state.background, 0, 0, 0, 0, { viewport: true });
      if (!image?.startsWith('data:image/png;base64,')) throw new Error('姿势图导出失败');
      persist(); return image;
    }
    const fileInput = element('input', { type: 'file', accept: '.json,application/json', hidden: '', 'aria-label': '导入姿势文件', onchange: () => run(async () => {
      const file = fileInput.files[0]; fileInput.value = ''; if (!file) return;
      if (file.size > 2 * 1024 * 1024) throw new Error('姿势文件不能超过 2 MB');
      const doc = normalizeDocument(JSON.parse(await file.text()));
      viewer.recordState(); Object.assign(state, doc); viewer.setPose(doc.pose); viewer.scene.background.set(state.background);
      if (doc.view) { viewer.camera.fov = doc.view.fov; viewer.camera.zoom = doc.view.zoom; viewer.camera.updateProjectionMatrix(); }
      widthInput.value = state.width; heightInput.value = state.height; background.value = state.background; resize(); changed(); message('姿势已导入');
    }) });
    const footer = element('footer', { class: 'nf-pose-foot' }, [status,
      action('导入姿势', () => fileInput.click()),
      action('保存姿势', () => download(new Blob([JSON.stringify(snapshot(), null, 2)], { type: 'application/json' }), 'NovaFlow_姿势.json')),
      action('导出 PNG', async () => { const image = await capture(); download(await (await fetch(image)).blob(), 'NovaFlow_姿势参考.png'); message('姿势图已导出'); }),
      action('用作姿势参考', async () => { referenceSlot(root.__NovaFlowArtGenerate); const image = await capture(); applyReference(root.__NovaFlowArtGenerate, snapshot(), image); close(); }, { class: 'nf-pose-primary' }), fileInput]);
    dialog.append(element('header', { class: 'nf-pose-head' }, [element('h2', { id: 'nf-pose-title', text: '姿势参考' }), closeButton]), element('div', { class: 'nf-pose-body' }, [side, view]), footer);
    overlay.append(dialog); root.document.body.append(overlay);
    editor = { close, closeButton, snapshot, capture, get viewer() { return viewer; } };
    root.document.addEventListener('keydown', event => {
      if (!editor) return;
      event.stopImmediatePropagation();
      if (event.key === 'Escape') { event.preventDefault(); if (library && !library.hidden) { library.hidden = true; libraryButton.focus(); } else close(); }
      else if (event.key === 'Tab') {
        const focusables = Array.from(dialog.querySelectorAll('button:not(:disabled),select,input:not([hidden]),canvas,a')).filter(n => n.getClientRects().length);
        const first = focusables[0], last = focusables[focusables.length - 1];
        if (event.shiftKey && root.document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && root.document.activeElement === last) { event.preventDefault(); first?.focus(); }
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !['INPUT', 'SELECT'].includes(event.target.tagName)) {
        event.preventDefault(); event.shiftKey ? viewer?.redo() : viewer?.undo(); changed();
      }
    }, { capture: true, signal: abort.signal });
    closeButton.focus();
    let widthInput, heightInput, background;
    try {
      const [{ PoseViewerCore }, { HAND_PRESETS }, modelResponse] = await Promise.all([
        import(vendor('pose_studio/core.js')), import(vendor('pose_studio/hand_presets.js')), fetch(vendor('pose_studio/assets/mannequin.json')),
      ]);
      if (!modelResponse.ok) throw new Error(`人偶资源载入失败 (${modelResponse.status})`);
      const model = await modelResponse.json(); if (abort.signal.aborted) return;
      handPresets = HAND_PRESETS;
      viewer = new PoseViewerCore(canvas, { skinMode: 'flat_color', enableTextureSkinning: false, showCaptureFrame: false, ikEnabled: true, onPoseChange: changed, onBoneSelectionChange: () => { if (boneSelect) boneSelect.value = viewer.selectedBone?.name || ''; syncAxes(); } });
      await viewer.init(); if (abort.signal.aborted) { viewer.dispose(); return; }
      if (!viewer.initialized || !viewer.renderer) throw new Error('无法创建 3D 视图，请检查浏览器硬件加速');
      viewer.loadData(model); viewer.scene.background.set(state.background); viewer.setDirectionalSkydomeVisible(false);
      viewer.updateLights([{ type: 'ambient', color: '#ffffff', intensity: 1.2 }, { type: 'directional', color: '#ffffff', intensity: 2.2, x: 4, y: 10, z: 8 }]);
      if (saved) { viewer.setPose(saved.pose); if (saved.view) { viewer.camera.fov = saved.view.fov; viewer.camera.zoom = saved.view.zoom; viewer.camera.updateProjectionMatrix(); } }
      libraryButton = button('打开姿势库', () => run(showLibrary), { 'data-novaflow-pose-library-open': '1', class: 'nf-pose-primary' });
      side.append(libraryButton, element('h3', { text: '快速姿势' }));
      const presets = { '自然站立': { upperarm_l: [0, 0, -15], upperarm_r: [0, 0, 15] }, 'T 字站姿': { upperarm_l: [0, 0, 70], upperarm_r: [0, 0, -70] }, '双手举起': { upperarm_l: [0, 0, 145], upperarm_r: [0, 0, -145] }, '坐姿': { thigh_l: [-85, 0, 0], thigh_r: [-85, 0, 0], calf_l: [85, 0, 0], calf_r: [85, 0, 0], upperarm_l: [-20, 0, -15], upperarm_r: [-20, 0, 15] } };
      side.append(element('div', { class: 'nf-pose-grid' }, Object.entries(presets).map(([name, bones]) => button(name, () => { viewer.recordState(); viewer.setPose({ bones }, true); changed(); }))));
      const ik = element('input', { type: 'checkbox', checked: '', onchange: () => viewer.setIKMode(ik.checked) });
      side.append(element('label', { class: 'nf-pose-row' }, [ik, element('span', { text: '拖动手脚（IK）' })]));
      boneSelect = element('select', { 'aria-label': '选择关节', onchange: () => viewer.selectBoneByName(boneSelect.value) }, [element('option', { value: '', text: '选择关节' })]);
      const labels = { Root: '整体根骨', pelvis: '骨盆', spine_01: '腰部', spine_02: '背部', spine_03: '胸部', neck_01: '颈部', head: '头部', thigh: '大腿', calf: '小腿', clavicle: '锁骨', foot: '脚踝', upperarm: '上臂', ball: '脚趾', lowerarm: '前臂', hand: '手腕', index: '食指', middle: '中指', pinky: '小指', ring: '无名指', thumb: '拇指' };
      for (const bone of model.bones) {
        const parts = bone.name.split('_'), suffix = parts.at(-1), label = labels[bone.name] || `${suffix === 'l' ? '左' : suffix === 'r' ? '右' : ''}${labels[parts[0]] || bone.name}${/^\d+$/.test(parts[1]) ? parts[1] : ''}`;
        boneSelect.append(element('option', { value: bone.name, text: label }));
      }
      side.append(element('label', { text: '关节旋转' }, [boneSelect]));
      axisControls = ['X', 'Y', 'Z'].map((axis, i) => {
        const slider = element('input', { type: 'range', min: '-180', max: '180', value: '0', step: '1', 'aria-label': `关节 ${axis} 旋转` });
        const number = element('input', { type: 'number', min: '-180', max: '180', value: '0', step: '1', 'aria-label': `关节 ${axis} 角度` });
        const commit = value => { if (!viewer.selectedBone) return; const n = Math.max(-180, Math.min(180, Number(value) || 0)); viewer.selectedBone.rotation[axis.toLowerCase()] = n * Math.PI / 180; viewer.selectedBone.updateMatrixWorld(true); viewer.updateIKEffectorPositions(); viewer.requestRender(); slider.value = number.value = n; changed(); };
        slider.addEventListener('pointerdown', () => viewer.recordState()); slider.addEventListener('input', () => commit(slider.value)); number.addEventListener('focus', () => viewer.recordState()); number.addEventListener('input', () => commit(number.value));
        side.append(element('div', { class: 'nf-pose-axis' }, [element('span', { text: axis }), slider, number])); return { slider, number };
      });
      side.append(element('div', { class: 'nf-pose-grid' }, [button('撤销', () => { viewer.undo(); changed(); }), button('重做', () => { viewer.redo(); changed(); }), button('重置关节', () => { viewer.recordState(); viewer.resetSelectedBone(); changed(); }), button('重置姿势', () => { viewer.recordState(); viewer.resetPose(); changed(); })]));
      side.append(element('h3', { text: '手势' }));
      const handSide = element('select', { 'aria-label': '手势作用侧' }, ['both', 'l', 'r'].map((value, i) => element('option', { value, text: ['双手', '左手', '右手'][i] })));
      side.append(handSide, element('div', { class: 'nf-pose-grid' }, [['OPEN', '张开'], ['FIST', '握拳'], ['CHOP', '并拢']].map(([key, text]) => button(text, () => { viewer.applyHandPreset(handSide.value, handPresets[key]); changed(); }))));
      side.append(element('h3', { text: '镜头' }), button('适配人偶', fitView), element('div', { class: 'nf-pose-grid' }, [['正面', 0], ['背面', Math.PI], ['左侧', -Math.PI / 2], ['右侧', Math.PI / 2]].map(([text, angle]) => button(text, () => {
        const distance = viewer.camera.position.distanceTo(viewer.orbit.target); viewer.camera.position.copy(viewer.orbit.target).add(new viewer.THREE.Vector3(Math.sin(angle) * distance, 0, Math.cos(angle) * distance)); viewer.orbit.update(); viewer.requestRender(); changed();
      }))));
      widthInput = element('input', { type: 'number', min: '256', max: '2048', value: state.width, 'aria-label': '姿势图宽度', onchange: () => { state.width = size(widthInput.value); widthInput.value = state.width; resize(); changed(); } });
      heightInput = element('input', { type: 'number', min: '256', max: '2048', value: state.height, 'aria-label': '姿势图高度', onchange: () => { state.height = size(heightInput.value); heightInput.value = state.height; resize(); changed(); } });
      background = element('input', { type: 'color', value: state.background, 'aria-label': '姿势图背景', oninput: () => { state.background = background.value; viewer.scene.background.set(state.background); viewer.requestRender(); changed(); } });
      side.append(element('label', { text: '输出尺寸' }, [element('div', { class: 'nf-pose-row' }, [widthInput, element('span', { class: 'nf-pose-times', text: '×' }), heightInput])]), element('label', { class: 'nf-pose-row' }, [element('span', { text: '背景颜色' }), background]), element('a', { href: 'https://github.com/AHEKOT/ComfyUI_VNCCS_Utils', target: '_blank', rel: 'noopener noreferrer', text: 'VNCCS Pose Studio · MIT / MakeHuman · CC0' }));
      if (!saved) viewer.setPose({ bones: presets['自然站立'] }, true);
      viewer.orbit.addEventListener('end', changed);
      resizeObserver = new ResizeObserver(resize); resizeObserver.observe(stage); resize();
      if (!saved) { viewer.camera.position.copy(viewer.orbit.target).add(new viewer.THREE.Vector3(0, 0, 4)); fitView(); }
      actions.forEach(b => b.removeAttribute('disabled')); message('调整人偶与镜头后，导出 PNG 或用作姿势参考'); changed();
      function syncSelection() { boneSelect.value = viewer.selectedBone?.name || ''; }
      // The core owns pointer picking; keeping the shell selection synchronized needs no raycasting.
      viewer.options.onBoneSelectionChange = () => { syncSelection(); syncAxes(); };
    } catch (error) { if (!abort.signal.aborted) message(`载入失败：${error.message}`, true); }

    function syncAxes() {
      const rotation = viewer?.selectedBone?.rotation;
      axisControls.forEach(({ slider, number }, i) => { slider.disabled = number.disabled = !rotation; if (rotation) slider.value = number.value = Math.round(rotation[['x', 'y', 'z'][i]] * 180 / Math.PI); });
    }

    async function showLibrary() {
      if (library) { library.hidden = false; library.querySelector('input')?.focus(); return; }
      message('正在载入姿势库…');
      const response = await fetch(vendor('pose_library/index.json'));
      if (!response.ok) throw new Error(`姿势库载入失败 (${response.status})`);
      libraryData = await response.json(); if (abort.signal.aborted) return;
      const categoryNames = { 'Close Up': '特写', Crawling: '爬行', Crouching: '蹲姿', Fighting: '格斗', Gymnastics: '体操', Kneeling: '跪姿', Laying: '卧姿', Sitting: '坐姿', Standing: '站姿', Walking: '行走', Ballet: '芭蕾', Rest: '休息' };
      const translate = name => name.replace(/Standing/gi, '站立').replace(/Sitting|Seated/gi, '坐姿').replace(/Squatting|Crouching/gi, '蹲姿').replace(/Kneeling/gi, '跪姿').replace(/Crawling/gi, '爬行').replace(/Fighting|Boxing/gi, '格斗').replace(/Laying|Lying|Prone/gi, '卧姿').replace(/Walking/gi, '行走').replace(/Jumping/gi, '跳跃').replace(/Kicking/gi, '踢腿').replace(/rear( view)?/gi, '背面').replace(/side( view)?|profile/gi, '侧面').replace(/overhead( view)?/gi, '俯视').replace(/Close ?Up/gi, '特写').replace(/Leaning Back/gi, '后仰').replace(/Legs Crossed/gi, '交叉腿').replace(/Hand on Hip/gi, '叉腰').replace(/Arabesque/gi, '燕式平衡').replace(/Dancing_on_knees/gi, '跪姿舞蹈').replace(/Splits_1/gi, '劈叉');
      const category = element('select', { 'aria-label': '姿势分类' }, [element('option', { value: '', text: '全部分类' }), ...Array.from(new Set(libraryData.poses.map(p => p.category))).map(key => element('option', { value: key, text: categoryNames[key] || key }))]);
      const search = element('input', { type: 'search', placeholder: '搜索姿势', 'aria-label': '搜索姿势' });
      const count = element('span', { class: 'nf-pose-library-count' });
      const grid = element('div', { class: 'nf-pose-library-grid', 'data-novaflow-pose-library-grid': '1' });
      library = element('div', { class: 'nf-pose-library', 'aria-label': '姿势库' }, [element('div', { class: 'nf-pose-library-bar' }, [button('返回编辑', () => { library.hidden = true; libraryButton.focus(); }), search, category, count]), grid]);
      dialog.querySelector('.nf-pose-body').append(library);
      function renderLibrary() {
        const text = search.value.trim().toLowerCase();
        const poses = libraryData.poses.filter(p => (!category.value || p.category === category.value) && (!text || `${p.name} ${translate(p.name)} ${categoryNames[p.category] || p.category} ${p.tags.join(' ')}`.toLowerCase().includes(text)));
        count.textContent = `${poses.length} / ${libraryData.poses.length} 个姿势`;
        grid.replaceChildren(...poses.map(pose => button('', () => run(async () => {
          const response = await fetch(vendor(`pose_library/${pose.json}`));
          if (!response.ok) throw new Error(`姿势载入失败 (${response.status})`);
          const document = normalizeDocument(await response.json()); if (abort.signal.aborted) return;
          viewer.recordState(); viewer.setPose(document.pose, true);
          // Library previews use the capture camera. The saved free-orbit camera
          // is an inspector view and may sit much farther away at another FOV.
          if (document.pose.cameraParams) {
            const p = document.pose.cameraParams; viewer.camera.fov = 30;
            viewer.snapToCaptureCamera(state.width, state.height, Math.max(0.1, Math.min(7, Number(p.zoom) || 1)), Number(p.offset_x) || 0, Number(p.offset_y) || 0, Number(p.yaw_deg) || 0, Number(p.pitch_deg) || 0);
            viewer.captureFrame.visible = false;
          } else if (document.pose.camera) { viewer.setPose(document.pose); }
          else fitView();
          // Community scenes use different body proportions. Keep their view
          // direction but frame our adult rig completely, except intentional close-ups.
          if (!/close\s*up|特写/i.test(`${pose.category} ${pose.name}`)) fitView();
          viewer.updateMarkers(); viewer.updateIKEffectorPositions(); viewer.requestRender();
          library.hidden = true; libraryButton.textContent = `姿势库 · ${translate(pose.name)}`; libraryButton.focus(); changed(); message(`已应用：${translate(pose.name)}`);
        }), { class: 'nf-pose-card', 'aria-label': `应用姿势 ${pose.name}`, title: pose.name, 'data-pose-id': pose.id })).map((card, i) => {
          const pose = poses[i]; card.append(element('img', { src: vendor(`pose_library/${pose.preview}`), alt: '', loading: 'lazy' }), element('span', { text: translate(pose.name) }), element('small', { text: categoryNames[pose.category] || pose.category })); return card;
        }));
        if (!poses.length) grid.append(element('div', { class: 'nf-pose-busy', text: '没有匹配的姿势' }));
      }
      search.addEventListener('input', renderLibrary); category.addEventListener('change', renderLibrary); renderLibrary(); search.focus();
      message(`已载入 ${libraryData.poses.length} 个姿势，点击缩略图应用`);
    }
  }

  function mount() {
    const host = root.document?.querySelector('[data-novaflow-art-generate-control-host="1"]');
    if (!host || host.querySelector('[data-novaflow-pose-reference-open]')) return;
    if (root.NovaFlowUiDesignDrawing?.isActive?.()) return;
    installStyle();
    host.append(button('姿势参考', () => open(), { class: 'nf-pose-launch', 'data-novaflow-pose-reference-open': '1' }));
  }
  root.NovaFlowPoseReferenceTool = Object.freeze({ open, close: () => editor?.close(), mount, normalizeDocument, referenceSlot, applyReference, getEditor: () => editor });
  if (root.document && typeof root.MutationObserver === 'function') {
    let queued = false;
    new root.MutationObserver(() => {
      if (queued) return; queued = true;
      root.queueMicrotask(() => { queued = false; mount(); if (editor && root.__NovaFlowArtGenerate?.state.active === false) editor.close(); });
    }).observe(root.document.documentElement, { childList: true, subtree: true });
    mount();
  }
})(typeof window !== 'undefined' ? window : globalThis);
