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
    const scene = input.version === 2 ? input.characters : undefined;
    let characters;
    if (scene !== undefined) {
      if (!Array.isArray(scene) || scene.length > 32) throw new Error('人物列表格式不正确（最多 32 人）');
      const ids = new Set();
      characters = scene.map((person, i) => {
        if (!person || typeof person !== 'object') throw new Error('人物格式不正确');
        const id = String(person.id || `person-${i + 1}`).slice(0, 80);
        if (ids.has(id)) throw new Error('人物编号重复'); ids.add(id);
        const transform = {};
        for (const axis of ['x', 'y', 'z']) {
          const value = person.transform?.[axis] ?? 0;
          if (!Number.isFinite(value) || Math.abs(value) > (axis === 'z' ? 40 : 50)) throw new Error('人物位置超出范围');
          transform[axis] = value;
        }
        if (person.body && (!['female', 'male', 'neutral'].includes(person.body.gender) || !['adult', 'child'].includes(person.body.age))) throw new Error('人物体型格式不正确');
        const characterPose = normalizeDocument({ pose: person.pose }).pose;
        if (person.body?.gender === 'neutral') for (const key of ['bonePositions', 'hipBonePosition', 'ikEffectorPositions', 'poleTargetPositions']) delete characterPose[key];
        return { id, name: String(person.name || `人物 ${i + 1}`).slice(0, 40), pose: characterPose, transform, ...(person.body ? { body: { gender: person.body.gender === 'male' ? 'male' : 'female', age: person.body.age } } : {}) };
      });
    }
    return { version: characters ? 2 : 1, ...(characters ? { characters, activeCharacterId: characters.some(p => p.id === input.activeCharacterId) ? input.activeCharacterId : characters[0]?.id || null } : {}), pose, width: size(input.width), height: size(input.height), background: /^#[a-f0-9]{6}$/i.test(input.background) ? input.background : '#e4e5e8', ...(view ? { view: { fov: view.fov, zoom: view.zoom } } : {}) };
  }

  function referenceSlot(bridge) {
    if (!bridge?.state || (!bridge.state.active && typeof bridge.activate !== 'function')) throw new Error('请先打开生图工具');
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
    if (!bridge.state.active) {
      bridge.activate('img2img');
      if (!bridge.state.active) throw new Error('无法打开生图工具，请回到绘图页面后重试');
    }
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

  function configureNavigation(viewer, canvas, signal, selectAtPointer) {
    viewer.orbit.mouseButtons = { LEFT: viewer.THREE.MOUSE.ROTATE, MIDDLE: -1, RIGHT: -1 };
    const ray = new viewer.THREE.Raycaster(), point = new viewer.THREE.Vector2();
    let pan = null;
    const right = new viewer.THREE.Vector3(), up = new viewer.THREE.Vector3();
    function finishPan(event) {
      if (!pan || (event && event.pointerId !== pan.id)) return;
      const id = pan.id; pan = null;
      if (canvas.hasPointerCapture?.(id)) canvas.releasePointerCapture(id);
      if (!signal?.aborted) viewer.orbit.dispatchEvent({ type: 'end' });
      event?.preventDefault(); event?.stopImmediatePropagation();
    }
    canvas.addEventListener('pointerdown', event => {
      if (event.button === 2) { event.preventDefault(); event.stopImmediatePropagation(); return; }
      if (event.button === 0 && event.ctrlKey) {
        // Ctrl + left drag always pans, including when starting over the rig.
        // Capture keeps camera navigation exclusive from bone/IK manipulation.
        pan = { id: event.pointerId, x: event.clientX, y: event.clientY };
        canvas.setPointerCapture(event.pointerId);
        viewer.orbit.dispatchEvent({ type: 'start' });
        event.preventDefault(); event.stopImmediatePropagation(); return;
      }
      if (event.button !== 0) return;
      selectAtPointer?.(event);
      const rect = canvas.getBoundingClientRect();
      point.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      viewer.skinnedMesh?.updateMatrixWorld(true); viewer.camera.updateMatrixWorld(true);
      ray.setFromCamera(point, viewer.camera);
      const targets = [...viewer.jointMarkers, ...Object.values(viewer.ikController?.effectors || {}), ...Object.values(viewer.ikController?.poleTargets || {}), viewer.skinnedMesh].filter(object => object?.visible);
      const onHandle = Boolean(viewer.transform?.axis) || ray.intersectObjects(targets, false).length > 0;
      // Run before OrbitControls' pointerdown; keep rig/gizmo drags exclusive.
      viewer.orbit.mouseButtons.LEFT = onHandle ? viewer.THREE.MOUSE.NONE : viewer.THREE.MOUSE.ROTATE;
    }, { capture: true, signal });
    canvas.addEventListener('pointermove', event => {
      if (!pan || event.pointerId !== pan.id) return;
      const rect = canvas.getBoundingClientRect(), camera = viewer.camera;
      camera.updateMatrixWorld(true);
      const scale = 2 * camera.position.distanceTo(viewer.orbit.target) * Math.tan(camera.getEffectiveFOV() * Math.PI / 360) / Math.max(1, rect.height);
      right.setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(-(event.clientX - pan.x) * scale);
      up.setFromMatrixColumn(camera.matrixWorld, 1).multiplyScalar((event.clientY - pan.y) * scale);
      right.add(up); camera.position.add(right); viewer.orbit.target.add(right);
      pan.x = event.clientX; pan.y = event.clientY;
      viewer.orbit.update(); viewer.requestRender?.();
      event.preventDefault(); event.stopImmediatePropagation();
    }, { capture: true, signal });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(type, finishPan, { capture: true, signal });
    signal?.addEventListener('abort', () => finishPan(), { once: true });
  }

  function jointLabel(name) {
    const labels = { Root: '整体根骨', pelvis: '骨盆', spine_01: '腰部', spine_02: '背部', spine_03: '胸部', neck_01: '颈部', head: '头部', thigh: '大腿', calf: '小腿', clavicle: '锁骨', foot: '脚踝', upperarm: '上臂', ball: '脚趾', lowerarm: '前臂', hand: '手腕', index: '食指', middle: '中指', pinky: '小指', ring: '无名指', thumb: '拇指' };
    const parts = name.split('_'), suffix = parts.at(-1);
    return labels[name] || `${suffix === 'l' ? '左' : suffix === 'r' ? '右' : ''}${labels[parts[0]] || name}${/^\d+$/.test(parts[1]) ? parts[1] : ''}`;
  }

  function createCharacters(viewer, onChange = () => {}, models = {}) {
    const people = [];
    let activeId = null, nextId = 1, loadedBody = null;
    const neutral = { bones: { upperarm_l: [0, 0, -15], upperarm_r: [0, 0, 15] } };
    const active = () => people.find(p => p.id === activeId);
    const poseOnly = pose => { const value = clone(pose); delete value.camera; delete value.cameraParams; return value; };
    function save() {
      const person = active(); if (!person) return;
      person.pose = poseOnly(viewer.getPose());
      person.history = viewer.history; person.future = viewer.future;
    }
    function showRig(visible) {
      viewer.skinnedMesh.visible = visible;
      if (viewer.skeletonHelper) viewer.skeletonHelper.visible = visible;
      if (!visible) {
        viewer.transform?.detach();
        viewer.jointMarkers.forEach(marker => { marker.visible = false; });
        for (const helper of [...Object.values(viewer.ikController?.effectors || {}), ...Object.values(viewer.ikController?.poleTargets || {})]) helper.visible = false;
      } else {
        viewer.setIKMode(viewer.ikMode);
        viewer.jointMarkers.forEach(marker => { marker.visible = viewer._shouldMarkerBeVisible(marker); });
      }
    }
    function applyActor(person) {
      const key = `${person.body.age}-${person.body.gender}`;
      if (key !== loadedBody && models[key]) { viewer.loadData(models[key], true); loadedBody = key; }
      viewer.setPose(person.pose, true);
      viewer.setActiveCharacterAppearance({ color: '#a4aab2', transform: person.transform });
      viewer.updateIKEffectorPositions('all'); viewer.updateMarkers();
    }
    function load(person) {
      activeId = person?.id || null;
      viewer.deselectBone(); viewer.selectedIKEffector = null; viewer.selectedPoleTarget = null;
      viewer.transform?.detach();
      viewer.history = person?.history || []; viewer.future = person?.future || [];
      if (person) applyActor(person);
      showRig(Boolean(person)); viewer.requestRender(); onChange();
    }
    function select(id) {
      const person = people.find(p => p.id === id);
      if (!person || id === activeId) return;
      save(); const previous = active();
      if (previous) viewer.upsertPassiveCharacterFromActive(previous.id, previous);
      viewer.removePassiveCharacter(id); load(person);
    }
    function add() {
      if (people.length >= 32) throw new Error('一个场景最多添加 32 人');
      save();
      const occupied = new Set(people.map(p => `${p.transform.x},${p.transform.z}`));
      let x = 0, z = 0;
      for (let i = 1; occupied.has(`${x},${z}`); i++) { const column = i % 9; x = Math.ceil(column / 2) * (column % 2 ? 10 : -10); z = Math.floor(i / 9) * 10; }
      const id = `person-${nextId++}`;
      const person = { id, name: `人物 ${id.slice(7)}`, pose: clone(neutral), body: { gender: 'female', age: 'adult' }, transform: { x, y: 0, z }, history: [], future: [] };
      people.push(person); select(id); return person;
    }
    function remove(id = activeId) {
      const index = people.findIndex(p => p.id === id); if (index < 0) return;
      save(); people.splice(index, 1); viewer.removePassiveCharacter(id);
      if (id === activeId) {
        const next = people[Math.min(index, people.length - 1)];
        if (next) viewer.removePassiveCharacter(next.id);
        load(next);
      } else { viewer.requestRender(); onChange(); }
    }
    function setPositions(values) {
      const person = active(); if (!person) return;
      for (const axis of ['x', 'y', 'z']) {
        const limit = axis === 'z' ? 40 : 50;
        const delta = Math.max(-limit, Math.min(limit, Number(values[axis] ?? person.transform[axis]) || 0)) - person.transform[axis];
        person.transform[axis] += delta;
        for (const pole of Object.values(viewer.ikController?.poleTargets || {})) pole.position[axis] += delta;
      }
      viewer.setActiveCharacterAppearance({ color: '#a4aab2', transform: person.transform });
      viewer.updateIKEffectorPositions('all'); onChange();
    }
    function setPosition(axis, value) { setPositions({ [axis]: value }); }
    function setBody(key, value) {
      const person = active(); if (!person || !['gender', 'age'].includes(key) || person.body[key] === value) return;
      if (!(key === 'gender' ? ['female', 'male'] : ['adult', 'child']).includes(value)) return;
      save(); person.body[key] = value;
      // Rotations transfer between proportions; local rest offsets and world IK
      // targets belong to the old skeleton and must be recomputed for the new one.
      person.pose = { bones: person.pose.bones, modelRotation: person.pose.modelRotation || [0, 0, 0] };
      person.history = []; person.future = []; load(person);
    }
    function restore(document) {
      viewer.clearPassiveCharacters(); people.length = 0; activeId = null;
      const entries = document.characters || [{ id: 'person-1', name: '人物 1', pose: poseOnly(document.pose), transform: { x: 0, y: 0, z: 0 } }];
      for (const entry of entries) {
        const pose = poseOnly(entry.pose);
        if (!entry.body || entry.body.gender === 'neutral') for (const key of ['bonePositions', 'hipBonePosition', 'ikEffectorPositions', 'poleTargetPositions']) delete pose[key];
        people.push({ ...clone(entry), body: { age: entry.body?.age || 'adult', gender: entry.body?.gender === 'male' ? 'male' : 'female' }, pose, history: [], future: [] });
      }
      nextId = Math.max(0, ...people.map(p => Number(p.id.replace('person-', '')) || 0)) + 1;
      const person = people.find(p => p.id === document.activeCharacterId) || people[0];
      for (const other of people) if (other !== person) { applyActor(other); viewer.upsertPassiveCharacterFromActive(other.id, other); }
      load(person);
      viewer.requestRender(); onChange();
    }
    function snapshot() {
      save();
      return { characters: people.map(({ id, name, pose, transform, body }) => clone({ id, name, pose, transform, body })), activeCharacterId: activeId };
    }
    function pick(event, canvas) {
      if (viewer.transform?.axis) return;
      const rect = canvas.getBoundingClientRect(), point = new viewer.THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      viewer.scene.updateMatrixWorld(true);
      const ray = new viewer.THREE.Raycaster(); ray.setFromCamera(point, viewer.camera);
      const meshes = [active() && viewer.skinnedMesh, ...Array.from(viewer.passiveCharacters.values(), p => p.mesh)].filter(Boolean);
      meshes.forEach(mesh => { mesh.skeleton.update(); mesh.computeBoundingSphere(); });
      const hit = ray.intersectObjects(meshes, false)[0];
      if (hit?.object !== viewer.skinnedMesh && hit?.object.userData.vnccsPassiveCharacterId) select(hit.object.userData.vnccsPassiveCharacterId);
    }
    return { people, active, select, add, remove, setPosition, setPositions, setBody, restore, snapshot, pick };
  }

  function configureRootTranslation(viewer, characters, onChange) {
    const anchor = new viewer.THREE.Object3D(); viewer.scene.add(anchor);
    let start = null;
    viewer.options.captureHistoryContext = () => ({ characterPosition: { ...characters.active()?.transform } });
    viewer.options.onHistoryRestore = pose => {
      if (pose.editorState?.characterPosition) characters.setPositions(pose.editorState.characterPosition);
      sync(); onChange();
    };
    function sync() {
      if (viewer.selectedBone?.name !== 'Root' || !characters.active()) { viewer.transform.setSpace('local'); return; }
      viewer.skinnedMesh.updateMatrixWorld(true);
      viewer.selectedBone.getWorldPosition(anchor.position);
      anchor.updateMatrixWorld(true);
      viewer.selectedIKEffector = null; viewer.selectedPoleTarget = null;
      viewer.transform.setMode('translate'); viewer.transform.setSpace('world'); viewer.transform.attach(anchor);
      viewer.requestRender();
    }
    viewer.transform.addEventListener('dragging-changed', event => {
      if (viewer.transform.object !== anchor) return;
      if (event.value) start = { id: characters.active()?.id, anchor: anchor.position.clone(), position: { ...characters.active()?.transform } };
      else { start = null; sync(); onChange(); }
    });
    viewer.transform.addEventListener('objectChange', () => {
      if (!start || viewer.transform.object !== anchor || characters.active()?.id !== start.id) return;
      const delta = anchor.position.clone().sub(start.anchor);
      characters.setPositions(Object.fromEntries(['x', 'y', 'z'].map(axis => [axis, start.position[axis] + delta[axis]])));
      onChange();
    });
    return { sync };
  }

  function installStyle() {
    if (root.document.getElementById('nf-pose-style')) return;
    root.document.head.append(element('style', { id: 'nf-pose-style', text: `
      .nf-pose-people{display:grid;grid-template-columns:1fr 1fr;gap:6px}.nf-pose-body-options{display:grid;gap:6px;grid-template-columns:1fr 1fr}.nf-pose-body-options button[aria-pressed=true],.nf-pose-people button[aria-pressed=true]{background:#22694f;border-color:#40a780}.nf-pose-selected-joint{font-size:11px;color:#aaa;line-height:1.5}.nf-pose-side label.nf-pose-position{display:flex;align-items:center;justify-content:space-between;gap:6px}.nf-pose-position input{width:88px}
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
    const overlay = element('div', { class: 'nf-pose-overlay', 'data-novaflow-pose-reference': '1', 'data-novaflow-runtime-ignore': '1', 'data-novaflow-source-layout': '1' });
    // Let the real canvas controls handle input, then keep workspace drag/zoom
    // delegates from also handling the same gesture outside this owned surface.
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mousemove', 'mouseup', 'click', 'dblclick', 'wheel', 'contextmenu']) {
      overlay.addEventListener(type, event => { event.stopPropagation(); if (type === 'contextmenu') event.preventDefault(); });
    }
    const dialog = element('section', { class: 'nf-pose-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'nf-pose-title' });
    const closeButton = button('关闭', close, { 'aria-label': '关闭姿势参考' });
    const status = element('div', { class: 'nf-pose-status', role: 'status', 'aria-live': 'polite', text: '正在载入人偶编辑器…' });
    const side = element('div', { class: 'nf-pose-side' });
    const canvas = element('canvas', { class: 'nf-pose-canvas', width: '640', height: '640', tabindex: '0', 'data-novaflow-split-pan-exempt': '1', 'aria-label': '3D 人偶姿势视图' });
    const stage = element('div', { class: 'nf-pose-stage' }, [canvas]);
    const view = element('div', { class: 'nf-pose-view' }, [stage, element('div', { class: 'nf-pose-hint', text: '左键拖动空白处旋转镜头，Ctrl＋左键拖动平移，滚轮缩放。点击人物切换，点击关节旋转或拖动手脚。空间辅助线仅在编辑时显示。' })]);
    const actions = [];
    const action = (text, fn, attrs = {}) => { const b = button(text, () => run(fn), { disabled: '', ...attrs }); actions.push(b); return b; };
    function message(text, error = false) { status.textContent = text; status.dataset.error = String(error); }
    async function run(fn) { try { await fn(); } catch (error) { message(error.message || String(error), true); } }
    let viewer, resizeObserver, saveTimer, movement, handPresets, selectedJoint, library, libraryButton, libraryData, characters, peopleList, deletePerson, positionInputs = [], bodyControls = [], actorControls = [], axisControls = [];
    function snapshot() { return { version: 2, ...characters.snapshot(), width: state.width, height: state.height, background: state.background, pose: viewer.getPose(), view: { fov: viewer.camera.fov, zoom: viewer.camera.zoom } }; }
    function persist() { if (viewer?.isInitialized() && characters) { try { root.localStorage.setItem(STORAGE, JSON.stringify(snapshot())); } catch (_) { message('浏览器无法保存姿势，请使用「保存姿势」下载文件', true); } } }
    function changed() { if (peopleList) renderPeople(); if (movement && !viewer.transform.dragging) movement.sync(); clearTimeout(saveTimer); saveTimer = setTimeout(persist, 180); syncAxes(); }
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
      if (!characters?.people.length) return;
      const bounds = new viewer.THREE.Box3();
      for (const mesh of [viewer.skinnedMesh, ...Array.from(viewer.passiveCharacters.values(), p => p.mesh)]) {
        mesh.updateMatrixWorld(true); mesh.skeleton.update(); mesh.computeBoundingBox(); bounds.union(new viewer.THREE.Box3().setFromObject(mesh));
      }
      const inverseRotation = new viewer.THREE.Matrix4().makeRotationFromQuaternion(viewer.camera.quaternion.clone().invert());
      const extent = bounds.clone().applyMatrix4(inverseRotation).getSize(new viewer.THREE.Vector3());
      const distance = (Math.max(extent.y, extent.x / viewer.camera.aspect) / (2 * Math.tan(viewer.camera.fov * Math.PI / 360)) * viewer.camera.zoom + extent.z / 2) * 1.12;
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
      Object.assign(state, doc); characters.restore(doc); if (doc.pose.camera) viewer.setPose({ ...viewer.getPose(), camera: doc.pose.camera }); else fitView(); viewer.scene.background.set(state.background);
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
        import(vendor('pose_studio/core.js')), import(vendor('pose_studio/hand_presets.js')), fetch(vendor('pose_studio/assets/mannequin-adult-female.json')),
      ]);
      if (!modelResponse.ok) throw new Error(`人偶资源载入失败 (${modelResponse.status})`);
      const model = await modelResponse.json(); if (abort.signal.aborted) return;
      const catalogResponse = await fetch(vendor('pose_studio/assets/body-types.json'));
      if (!catalogResponse.ok) throw new Error('体型资源索引载入失败');
      const catalog = await catalogResponse.json();
      const bodyModels = Object.fromEntries(await Promise.all(catalog.bodies.map(async body => {
        if (body.id === 'adult-female') return [body.id, model];
        const response = await fetch(vendor(`pose_studio/assets/${body.file}`));
        if (!response.ok) throw new Error(`体型资源载入失败：${body.id}`);
        return [body.id, await response.json()];
      })));
      if (abort.signal.aborted) return;
      handPresets = HAND_PRESETS;
      viewer = new PoseViewerCore(canvas, { skinMode: 'flat_color', enableTextureSkinning: false, showCaptureFrame: false, ikEnabled: true, useHandControlPopover: false, onPoseChange: changed, onBoneSelectionChange: syncAxes });
      await viewer.init(); if (abort.signal.aborted) { viewer.dispose(); return; }
      if (!viewer.initialized || !viewer.renderer) throw new Error('无法创建 3D 视图，请检查浏览器硬件加速');
      configureNavigation(viewer, canvas, abort.signal, event => characters?.pick(event, canvas));
      viewer.loadData(model); viewer.scene.background.set(state.background); viewer.setDirectionalSkydomeVisible(false);
      viewer.updateLights([{ type: 'ambient', color: '#ffffff', intensity: 0.65 }, { type: 'directional', color: '#ffffff', intensity: 2.0, x: 4, y: 10, z: 8 }]);
      const floor = new viewer.THREE.Box3().setFromObject(viewer.skinnedMesh).min.y;
      viewer.gridHelper = new viewer.THREE.Group();
      const grid = new viewer.THREE.GridHelper(160, 80, '#8796a8', '#b2bbc6');
      grid.material.transparent = true; grid.material.opacity = 0.6;
      const axes = new viewer.THREE.AxesHelper(12);
      viewer.gridHelper.position.y = floor - 0.03; viewer.gridHelper.add(grid, axes); viewer.scene.add(viewer.gridHelper);
      characters = createCharacters(viewer, changed, bodyModels);
      characters.restore(saved || { pose: { bones: { upperarm_l: [0, 0, -15], upperarm_r: [0, 0, 15] } } });
      if (saved?.pose.camera) viewer.setPose({ ...viewer.getPose(), camera: saved.pose.camera });
      if (saved?.view) { viewer.camera.fov = saved.view.fov; viewer.camera.zoom = saved.view.zoom; viewer.camera.updateProjectionMatrix(); }
      libraryButton = button('打开姿势库', () => run(showLibrary), { 'data-novaflow-pose-library-open': '1', class: 'nf-pose-primary' });
      side.append(libraryButton, element('h3', { text: '场景人物' }));
      peopleList = element('div', { class: 'nf-pose-people', role: 'group', 'aria-label': '场景人物' });
      const addPerson = button('添加人物', () => run(() => { characters.add(); fitView(); changed(); }), { class: 'nf-pose-primary' });
      deletePerson = button('删除人物', () => run(() => {
        const name = characters.active()?.name;
        characters.remove(); changed(); message(`已删除${name || '人物'}，场景中剩余 ${characters.people.length} 人`);
      }));
      side.append(peopleList, element('div', { class: 'nf-pose-grid' }, [addPerson, deletePerson]));
      for (const [key, label, options] of [['gender', '性别', [['female', '女性'], ['male', '男性']]], ['age', '年龄', [['child', '儿童'], ['adult', '成人']]]]) {
        const choices = options.map(([value, text]) => {
          const control = button(text, () => run(() => { characters.setBody(key, value); changed(); }), { 'aria-label': `${label}：${text}`, 'aria-pressed': 'false' });
          bodyControls.push({ key, value, control }); actorControls.push(control); return control;
        });
        side.append(element('h3', { text: label }), element('div', { class: `nf-pose-body-options nf-pose-body-options-${key}`, role: 'group', 'aria-label': label }, choices));
      }
      const movePerson = button('移动人物', () => viewer.selectBoneByName('Root')); side.append(movePerson); actorControls.push(movePerson);
      positionInputs = ['x', 'y', 'z'].map(axis => {
        const input = element('input', { type: 'number', min: axis === 'z' ? '-40' : '-50', max: axis === 'z' ? '40' : '50', step: '0.5', 'aria-label': `人物位置 ${axis.toUpperCase()}`, oninput: () => characters.setPosition(axis, input.value), onchange: () => {
          characters.setPosition(axis, input.value); input.value = characters.active()?.transform[axis] ?? 0;
        } });
        side.append(element('label', { class: 'nf-pose-position', text: `位置 ${axis.toUpperCase()}` }, [input])); return input;
      });
      const ik = element('input', { type: 'checkbox', checked: '', onchange: () => viewer.setIKMode(ik.checked) });
      side.append(element('label', { class: 'nf-pose-row' }, [ik, element('span', { text: '拖动手脚（IK）' })])); actorControls.push(ik);
      selectedJoint = element('div', { class: 'nf-pose-selected-joint', role: 'status', text: '点击人偶上的关节进行旋转' });
      side.append(element('h3', { text: '关节旋转' }), selectedJoint);
      axisControls = ['X', 'Y', 'Z'].map((axis, i) => {
        const slider = element('input', { type: 'range', min: '-180', max: '180', value: '0', step: '1', 'aria-label': `关节 ${axis} 旋转` });
        const number = element('input', { type: 'number', min: '-180', max: '180', value: '0', step: '1', 'aria-label': `关节 ${axis} 角度` });
        const commit = value => { if (!viewer.selectedBone) return; const n = Math.max(-180, Math.min(180, Number(value) || 0)); viewer.selectedBone.rotation[axis.toLowerCase()] = n * Math.PI / 180; viewer.selectedBone.updateMatrixWorld(true); viewer.updateIKEffectorPositions(); viewer.requestRender(); slider.value = number.value = n; changed(); };
        slider.addEventListener('pointerdown', () => viewer.recordState()); slider.addEventListener('input', () => commit(slider.value)); number.addEventListener('focus', () => viewer.recordState()); number.addEventListener('input', () => commit(number.value));
        side.append(element('div', { class: 'nf-pose-axis' }, [element('span', { text: axis }), slider, number])); return { slider, number };
      });
      const rigActions = element('div', { class: 'nf-pose-grid' }, [button('撤销', () => { viewer.undo(); changed(); }), button('重做', () => { viewer.redo(); changed(); }), button('重置关节', () => { viewer.recordState(); if (viewer.selectedBone?.name === 'Root') characters.setPositions({ x: 0, y: 0, z: 0 }); else viewer.resetSelectedBone(); changed(); }), button('重置姿势', () => { viewer.recordState(); viewer.resetPose(); changed(); })]); side.append(rigActions); actorControls.push(...rigActions.querySelectorAll('button'));
      side.append(element('h3', { text: '手势' }));
      const handSide = element('select', { 'aria-label': '手势作用侧' }, ['both', 'l', 'r'].map((value, i) => element('option', { value, text: ['双手', '左手', '右手'][i] })));
      const hands = element('div', { class: 'nf-pose-grid' }, [['OPEN', '张开'], ['FIST', '握拳'], ['CHOP', '并拢']].map(([key, text]) => button(text, () => { viewer.applyHandPreset(handSide.value, handPresets[key]); changed(); }))); side.append(handSide, hands); actorControls.push(handSide, ...hands.querySelectorAll('button'));
      side.append(element('h3', { text: '镜头' }), button('适配全部人物', fitView), element('div', { class: 'nf-pose-grid' }, [['正面', 0], ['背面', Math.PI], ['左侧', -Math.PI / 2], ['右侧', Math.PI / 2]].map(([text, angle]) => button(text, () => {
        const distance = viewer.camera.position.distanceTo(viewer.orbit.target); viewer.camera.position.copy(viewer.orbit.target).add(new viewer.THREE.Vector3(Math.sin(angle) * distance, 0, Math.cos(angle) * distance)); viewer.orbit.update(); fitView(); viewer.requestRender(); changed();
      }))));
      widthInput = element('input', { type: 'number', min: '256', max: '2048', value: state.width, 'aria-label': '姿势图宽度', onchange: () => { state.width = size(widthInput.value); widthInput.value = state.width; resize(); changed(); } });
      heightInput = element('input', { type: 'number', min: '256', max: '2048', value: state.height, 'aria-label': '姿势图高度', onchange: () => { state.height = size(heightInput.value); heightInput.value = state.height; resize(); changed(); } });
      background = element('input', { type: 'color', value: state.background, 'aria-label': '姿势图背景', oninput: () => { state.background = background.value; viewer.scene.background.set(state.background); viewer.requestRender(); changed(); } });
      side.append(element('label', { text: '输出尺寸' }, [element('div', { class: 'nf-pose-row' }, [widthInput, element('span', { class: 'nf-pose-times', text: '×' }), heightInput])]), element('label', { class: 'nf-pose-row' }, [element('span', { text: '背景颜色' }), background]), element('a', { href: 'https://github.com/AHEKOT/ComfyUI_VNCCS_Utils', target: '_blank', rel: 'noopener noreferrer', text: 'VNCCS Pose Studio · MIT / MakeHuman · CC0' }));
      viewer.orbit.addEventListener('end', changed);
      resizeObserver = new ResizeObserver(resize); resizeObserver.observe(stage); resize();
      if (!saved) { viewer.camera.position.copy(viewer.orbit.target).add(new viewer.THREE.Vector3(0, 0, 4)); fitView(); }
      actions.forEach(b => b.removeAttribute('disabled')); message('调整人偶与镜头后，导出 PNG 或用作姿势参考'); changed();
      movement = configureRootTranslation(viewer, characters, changed);
      viewer.options.onBoneSelectionChange = () => { movement.sync(); syncAxes(); };
    } catch (error) { if (!abort.signal.aborted) message(`载入失败：${error.message}`, true); }

    function syncAxes() {
      const moving = viewer?.selectedBone?.name === 'Root';
      const rotation = characters?.active() && !moving && viewer?.selectedBone?.rotation;
      if (selectedJoint) selectedJoint.textContent = viewer?.selectedBone && characters?.active() ? (moving ? '整体移动：拖动 X/Y/Z 箭头或平面' : `当前关节：${jointLabel(viewer.selectedBone.name)}`) : '点击人偶上的关节进行旋转';
      axisControls.forEach(({ slider, number }, i) => { slider.disabled = number.disabled = !rotation; if (rotation) slider.value = number.value = Math.round(rotation[['x', 'y', 'z'][i]] * 180 / Math.PI); });
    }

    function renderPeople() {
      const current = characters.active();
      // Keep focused position inputs alive while the rig reports pointer changes.
      if (peopleList.dataset.signature !== characters.people.map(p => `${p.id}:${p.id === current?.id}`).join('|')) {
        peopleList.dataset.signature = characters.people.map(p => `${p.id}:${p.id === current?.id}`).join('|');
        peopleList.replaceChildren(...characters.people.map(p => button(p.name, () => characters.select(p.id), { 'aria-pressed': String(p === current), 'aria-label': `选择${p.name}`, 'data-pose-person': p.id })));
        if (!characters.people.length) peopleList.append(element('span', { text: '场景为空，请添加人物' }));
      }
      if (deletePerson) deletePerson.disabled = !current;
      for (const control of actorControls) control.disabled = !current;
      for (const { key, value, control } of bodyControls) control.setAttribute('aria-pressed', String(current?.body[key] === value));
      if (libraryButton) libraryButton.disabled = !current;
      positionInputs.forEach((input, i) => { input.disabled = !current; if (root.document.activeElement !== input) input.value = +(current?.transform[['x', 'y', 'z'][i]] ?? 0).toFixed(2); });
    }

    async function showLibrary() {
      if (!characters.active()) return;
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
          const libraryPose = clone(document.pose);
          {
            // A preset's local offsets and world-space IK targets belong to its
            // original body proportions. Keep the selected body's rest lengths.
            for (const key of ['bonePositions', 'hipBonePosition', 'ikEffectorPositions', 'poleTargetPositions']) delete libraryPose[key];
          }
          viewer.recordState(); viewer.setPose(libraryPose, true);
          // Library previews use the capture camera. The saved free-orbit camera
          // is an inspector view and may sit much farther away at another FOV.
          if (document.pose.cameraParams) {
            const p = document.pose.cameraParams; viewer.camera.fov = 30;
            viewer.snapToCaptureCamera(state.width, state.height, Math.max(0.1, Math.min(7, Number(p.zoom) || 1)), Number(p.offset_x) || 0, Number(p.offset_y) || 0, Number(p.yaw_deg) || 0, Number(p.pitch_deg) || 0);
            viewer.captureFrame.visible = false;
          } else if (document.pose.camera) { viewer.setPose(libraryPose); }
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

  root.NovaFlowPoseReferenceTool = Object.freeze({ open, close: () => editor?.close(), normalizeDocument, referenceSlot, applyReference, configureNavigation, createCharacters, configureRootTranslation, getEditor: () => editor });
  if (root.document && typeof root.MutationObserver === 'function') {
    let queued = false;
    new root.MutationObserver(() => {
      if (queued) return; queued = true;
      root.queueMicrotask(() => { queued = false; if (editor && !root.document.querySelector('[data-novaflow-spine-split-control-category="enhance"]')) editor.close(); });
    }).observe(root.document.documentElement, { childList: true, subtree: true });
  }
})(typeof window !== 'undefined' ? window : globalThis);
