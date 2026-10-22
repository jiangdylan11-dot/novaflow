(function (root) {
  'use strict';
  const scriptUrl = root.document?.currentScript?.src || root.location?.href;
  const vendor = name => new URL(`./vendor/vnccs/${name}`, scriptUrl).href;
  const size = value => Math.max(256, Math.min(2048, Math.round(Number(value) || 1024)));
  const clone = value => JSON.parse(JSON.stringify(value));
  const PROPORTIONS = [3, 4, 5, 6, 7, 7.5, 8, 9];
  const modelKey = body => `${body?.age || 'adult'}-${body?.gender || 'neutral'}${body?.gender === 'neutral' && body?.proportion ? `-${body.proportion}` : ''}`;
  let editor = null, opening = null, previousFocus = null;
  let libraryStore;
  function createPoseLibraryStore(factory = root.indexedDB) {
    let connection;
    function database() {
      if (!factory) return Promise.reject(new Error('浏览器不支持本地姿势库保存'));
      if (!connection) connection = new Promise((resolve, reject) => {
        const request = factory.open('novaflow-pose-library', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('poses', { keyPath: 'id' });
        request.onsuccess = () => { const db = request.result; db.onversionchange = () => { db.close(); connection = null; }; resolve(db); };
        request.onerror = () => { connection = null; reject(new Error('无法读取本地姿势库')); };
      });
      return connection;
    }
    async function transaction(mode, operation) {
      const db = await database();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('poses', mode), request = operation(tx.objectStore('poses'));
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = tx.onabort = () => reject(new Error(tx.error?.name === 'QuotaExceededError' ? '本地空间不足，姿势未保存' : '本地姿势库操作失败，请重试'));
      });
    }
    return { list: () => transaction('readonly', store => store.getAll()), put: record => transaction('readwrite', store => store.put(record)), remove: id => transaction('readwrite', store => store.delete(id)) };
  }
  const savedLibrary = () => libraryStore || (libraryStore = createPoseLibraryStore());

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
        if (person.body?.proportion != null && !PROPORTIONS.includes(person.body.proportion)) throw new Error('头身比例格式不正确');
        return { id, name: String(person.name || `人物 ${i + 1}`).slice(0, 40), pose: characterPose, transform, ...(person.body ? { body: { gender: person.body.gender, age: person.body.age, ...(person.body.proportion !== undefined ? { proportion: person.body.proportion } : {}) } } : {}) };
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

  // Joint offsets edit the rest shape, not just the pose skinning matrices.
  // Rebuild from the immutable source mesh each time so edits and undo never
  // accumulate stretching. Limb sections keep their width; the torso follows
  // the edited hip and shoulder spans instead of leaving a fixed pelvis behind.
  function configureBodyShape(viewer) {
    if (viewer.nfPoseBodyShape) return viewer.nfPoseBodyShape;
    const THREE = viewer.THREE;
    let base, signature;
    function capture() {
      const mesh = viewer.skinnedMesh; if (!mesh) return;
      base = { mesh, vertices: mesh.geometry.getAttribute('position').array.slice(), heads: {}, locals: {} };
      function head(bone) {
        if (base.heads[bone.name]) return base.heads[bone.name];
        const local = (viewer.shapedBoneRestPositions?.[bone.name] || viewer.initialBoneStates[bone.name].position).clone();
        base.locals[bone.name] = local.clone();
        const parent = viewer.bones[bone.userData.parentName];
        return base.heads[bone.name] = parent ? local.add(head(parent)) : local;
      }
      viewer.boneList.forEach(head); signature = null;
    }
    function apply() {
      if (!base || base.mesh !== viewer.skinnedMesh) capture();
      if (!base) return;
      const mesh = viewer.skinnedMesh, bones = viewer.boneList;
      // Hip sockets cannot be pulled arbitrarily far away from the pelvis.
      // Keep the width adjustment useful without making a sheet across the groin.
      for (const name of ['thigh_l', 'thigh_r']) {
        const bone = viewer.bones[name], rest = base.locals[name];
        if (bone && rest && Math.abs(rest.x) > 1e-5) {
          const ratio = Math.max(0.55, Math.min(1.5, bone.position.x / rest.x));
          bone.position.x = rest.x * ratio;
        }
      }
      for (const bone of bones) {
        if (!/^(calf_|foot_|lowerarm_|hand_|spine_0|neck_01)/.test(bone.name)) continue;
        const rest = base.locals[bone.name], length = bone.position.length(), initialLength = rest.length();
        if (initialLength < 1e-6) continue;
        if (length < 1e-6) bone.position.copy(rest).multiplyScalar(0.35);
        else bone.position.multiplyScalar(Math.max(initialLength * 0.35, Math.min(initialLength * 2, length)) / length);
      }
      // Root/hips translation is a pose operation (including hips IK), not a
      // new torso rest shape. Keep it out of both the deformation and bind pose.
      const shapeLocal = bone => /^(Root|pelvis)$/.test(bone.name) ? base.locals[bone.name] : bone.position;
      const nextSignature = bones.map(bone => shapeLocal(bone).toArray().join(',')).join(';');
      if (signature === nextSignature) return;
      const heads = {};
      function head(bone) {
        if (heads[bone.name]) return heads[bone.name];
        const parent = viewer.bones[bone.userData.parentName], local = shapeLocal(bone).clone();
        return heads[bone.name] = parent ? local.add(head(parent)) : local;
      }
      bones.forEach(head);
      const primaryChild = { Root: 'pelvis', pelvis: 'spine_01', spine_01: 'spine_02', spine_02: 'spine_03', spine_03: 'neck_01', neck_01: 'head' };
      const sections = bones.map(bone => {
        const name = bone.name, from = base.heads[name], to = heads[name];
        const childName = primaryChild[name] || bones.find(child => child.userData.parentName === name)?.name;
        const oldEnd = childName ? base.heads[childName] : from.clone().add(new THREE.Vector3().fromArray(bone.userData.tailPos).sub(new THREE.Vector3().fromArray(bone.userData.headPos)));
        const newEnd = childName ? heads[childName] : to.clone().add(oldEnd.clone().sub(from));
        const direction = oldEnd.clone().sub(from), length = direction.length(), nextDirection = newEnd.clone().sub(to);
        const rotation = new THREE.Quaternion();
        if (length > 1e-6 && nextDirection.length() > 1e-6) rotation.setFromUnitVectors(direction.clone().normalize(), nextDirection.clone().normalize());
        return { name, from, to, direction: direction.normalize(), length, newLength: nextDirection.length(), rotation };
      });
      const span = (points, left, right) => ({ center: points[left].clone().add(points[right]).multiplyScalar(0.5), width: Math.abs(points[left].x - points[right].x) });
      const oldHip = span(base.heads, 'thigh_l', 'thigh_r'), newHip = span(heads, 'thigh_l', 'thigh_r');
      const oldShoulder = span(base.heads, 'upperarm_l', 'upperarm_r'), newShoulder = span(heads, 'upperarm_l', 'upperarm_r');
      const geometry = mesh.geometry, positions = geometry.getAttribute('position'), indices = geometry.getAttribute('skinIndex').array, weights = geometry.getAttribute('skinWeight').array;
      const point = new THREE.Vector3(), local = new THREE.Vector3(), warped = new THREE.Vector3(), result = new THREE.Vector3();
      for (let i = 0; i < positions.count; i++) {
        point.fromArray(base.vertices, i * 3); result.set(0, 0, 0);
        for (let slot = 0; slot < 4; slot++) {
          const weight = weights[i * 4 + slot]; if (!weight) continue;
          const section = sections[indices[i * 4 + slot]];
          local.copy(point).sub(section.from);
          const along = local.dot(section.direction);
          if (section.length > 1e-6) local.addScaledVector(section.direction, along * (section.newLength / section.length - 1));
          warped.copy(local).applyQuaternion(section.rotation).add(section.to);
          if (/^(pelvis|spine_0[123])$/.test(section.name)) {
            const t = Math.max(0, Math.min(1, (point.y - oldHip.center.y) / (oldShoulder.center.y - oldHip.center.y)));
            const blend = t * t * (3 - 2 * t);
            const oldCenter = oldHip.center.x * (1 - blend) + oldShoulder.center.x * blend;
            const newCenter = newHip.center.x * (1 - blend) + newShoulder.center.x * blend;
            const width = newHip.width / oldHip.width * (1 - blend) + newShoulder.width / oldShoulder.width * blend;
            warped.x = newCenter + (point.x - oldCenter) * width;
          }
          result.addScaledVector(warped, weight);
        }
        result.toArray(positions.array, i * 3);
      }
      positions.needsUpdate = true; geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      const rotations = bones.map(bone => bone.quaternion.clone()), meshPosition = mesh.position.clone(), meshRotation = mesh.quaternion.clone(), meshScale = mesh.scale.clone();
      const posePositions = bones.map(bone => bone.position.clone());
      bones.forEach(bone => bone.position.copy(shapeLocal(bone)));
      bones.forEach(bone => bone.quaternion.identity()); mesh.position.set(0, 0, 0); mesh.quaternion.identity(); mesh.scale.set(1, 1, 1);
      mesh.updateMatrixWorld(true); viewer.skeleton.calculateInverses();
      bones.forEach((bone, i) => { bone.quaternion.copy(rotations[i]); bone.position.copy(posePositions[i]); }); mesh.position.copy(meshPosition); mesh.quaternion.copy(meshRotation); mesh.scale.copy(meshScale);
      mesh.updateMatrixWorld(true); viewer.skeleton.update(); mesh.boundingBox = null; mesh.boundingSphere = null;
      signature = nextSignature;
    }
    const shape = { apply }; viewer.nfPoseBodyShape = shape;
    for (const name of ['setPose', 'resetPose', 'resetSelectedBone']) {
      const original = viewer[name];
      viewer[name] = function (...args) { const result = original.apply(this, args); apply(); return result; };
    }
    const loadData = viewer.loadData;
    viewer.loadData = function (...args) { const result = loadData.apply(this, args); capture(); return result; };
    capture(); return shape;
  }

  function createCharacters(viewer, onChange = () => {}, models = {}) {
    configureBodyShape(viewer);
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
      const key = modelKey(person.body);
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
      const person = { id, name: `人物 ${id.slice(7)}`, pose: clone(neutral), body: { gender: 'neutral', age: 'adult', proportion: null }, transform: { x, y: 0, z }, history: [], future: [] };
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
    function retargetPose(pose, previous, next) {
      const source = models[modelKey(previous)], target = models[modelKey(next)];
      if (!source || !target || source === target) return pose;
      const byName = model => Object.fromEntries(model.bones.map(bone => [bone.name, bone]));
      const oldBones = byName(source), newBones = byName(target);
      function transfer(name, value) {
        const oldBone = oldBones[name], newBone = newBones[name]; if (!oldBone || !newBone) return value;
        return value.map((coordinate, i) => coordinate - (oldBone.headPos[i] - (oldBones[oldBone.parent]?.headPos[i] || 0)) + (newBone.headPos[i] - (newBones[newBone.parent]?.headPos[i] || 0)));
      }
      const result = clone(pose);
      if (result.bonePositions) result.bonePositions = Object.fromEntries(Object.entries(result.bonePositions).map(([name, value]) => [name, transfer(name, value)]));
      if (result.hipBonePosition) result.hipBonePosition = Object.fromEntries(Object.entries(result.hipBonePosition).map(([name, value]) => [name, transfer('pelvis', value)]));
      delete result.ikEffectorPositions; delete result.poleTargetPositions;
      return result;
    }
    function setBody(key, value) {
      const person = active(); if (!person || !['age', 'proportion'].includes(key) || person.body[key] === value) return;
      if (key === 'age' ? !['adult', 'child'].includes(value) : value !== null && !PROPORTIONS.includes(value)) return;
      save(); const previous = { ...person.body }; person.body[key] = value;
      person.pose = retargetPose(person.pose, previous, person.body);
      person.history = []; person.future = []; load(person);
    }
    function restore(document) {
      viewer.clearPassiveCharacters(); people.length = 0; activeId = null;
      const entries = document.characters || [{ id: 'person-1', name: '人物 1', pose: poseOnly(document.pose), transform: { x: 0, y: 0, z: 0 } }];
      for (const [i, entry] of entries.entries()) {
        const previous = { age: 'adult', gender: 'neutral', proportion: null, ...entry.body };
        const body = { age: previous.age, gender: 'neutral', proportion: previous.proportion || null };
        const pose = retargetPose(poseOnly(entry.pose), previous, body);
        const name = entry.name === '骨骼移动验证' ? `人物 ${i + 1}` : entry.name;
        people.push({ ...clone(entry), name, body, pose, history: [], future: [] });
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
    let start = null, mode = 'translate';
    viewer.setIKMode(false);
    viewer.options.captureHistoryContext = () => ({ characterPosition: { ...characters.active()?.transform } });
    viewer.options.onHistoryRestore = pose => {
      if (pose.editorState?.characterPosition) characters.setPositions(pose.editorState.characterPosition);
      sync(); onChange();
    };
    function sync() {
      if (!viewer.selectedBone || !characters.active()) return;
      if (viewer.selectedBone.name !== 'Root') {
        viewer.selectedIKEffector = null; viewer.selectedPoleTarget = null;
        viewer.transform.setMode(mode); viewer.transform.setSpace(mode === 'translate' ? 'world' : 'local'); viewer.transform.attach(viewer.selectedBone);
        viewer.requestRender(); return;
      }
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
    function updateBone() {
      viewer.nfPoseBodyShape?.apply();
      viewer.skinnedMesh.updateMatrixWorld(true); viewer.skeleton.update();
      viewer.updateIKEffectorPositions('all'); viewer.updatePoleTargetPositions(); viewer.requestRender(); onChange();
    }
    function rest() { return viewer.shapedBoneRestPositions?.[viewer.selectedBone?.name] || viewer.initialBoneStates?.[viewer.selectedBone?.name]?.position; }
    function getOffset(axis) { const initial = rest(); return initial && viewer.selectedBone ? viewer.selectedBone.position[axis] - initial[axis] : 0; }
    function setOffset(axis, value) {
      const initial = rest(); if (!initial || !viewer.selectedBone || viewer.selectedBone.name === 'Root') return;
      viewer.selectedBone.position[axis] = initial[axis] + Math.max(-20, Math.min(20, Number(value) || 0)); updateBone();
    }
    function setMode(next) {
      if (!['translate', 'rotate'].includes(next)) return;
      mode = next; viewer.setIKMode(mode === 'rotate'); sync(); onChange();
    }
    viewer.transform.addEventListener('objectChange', () => {
      if (mode === 'translate' && viewer.selectedBone && viewer.transform.object === viewer.selectedBone && viewer.selectedBone?.name !== 'Root') { updateBone(); return; }
      if (!start || viewer.transform.object !== anchor || characters.active()?.id !== start.id) return;
      const delta = anchor.position.clone().sub(start.anchor);
      characters.setPositions(Object.fromEntries(['x', 'y', 'z'].map(axis => [axis, start.position[axis] + delta[axis]])));
      onChange();
    });
    return { sync, setMode, getMode: () => mode, getOffset, setOffset };
  }

  function addStudioGrid(viewer, floor) {
    const THREE = viewer.THREE, grid = new THREE.GridHelper(100, 100, '#68737e', '#7e8993');
    grid.position.y = floor - 0.03; grid.material.transparent = true; grid.material.opacity = 0.22; grid.material.depthWrite = false;
    grid.material.onBeforeCompile = shader => {
      shader.uniforms.studioGridCenter = { value: viewer.orbit.target };
      shader.vertexShader = 'varying vec3 studioGridPosition;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nstudioGridPosition = (modelMatrix * vec4(position, 1.0)).xyz;');
      shader.fragmentShader = 'varying vec3 studioGridPosition;\nuniform vec3 studioGridCenter;\n' + shader.fragmentShader.replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.a *= 1.0 - smoothstep(8.0, 30.0, length(studioGridPosition.xz - studioGridCenter.xz));');
    };
    viewer.gridHelper = grid; viewer.scene.add(grid);
  }

  function installStyle() {
    if (root.document.getElementById('nf-pose-style')) return;
    root.document.head.append(element('style', { id: 'nf-pose-style', text: `
      .nf-pose-people{display:grid;grid-template-columns:1fr 1fr;gap:6px}.nf-pose-body-options{display:grid;gap:6px;grid-template-columns:1fr 1fr}.nf-pose-toolbar{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:8px 12px;border-bottom:1px solid #303030}.nf-pose-modebar,.nf-pose-camera-tools{display:flex;flex-wrap:wrap;gap:6px;align-items:center}.nf-pose-dialog .nf-pose-camera-tools button{padding:5px 8px;white-space:nowrap}.nf-pose-outputbar{display:flex;justify-content:center;align-items:center;flex-wrap:wrap;gap:10px 18px;padding:8px 12px;border-top:1px solid #303030;color:#aaa;font-size:11px}.nf-pose-outputbar label{display:flex;align-items:center;gap:7px;white-space:nowrap}.nf-pose-dialog .nf-pose-outputbar input[type=number]{width:64px;min-height:30px;padding:4px 6px;text-align:center;appearance:textfield}.nf-pose-outputbar input[type=number]::-webkit-inner-spin-button,.nf-pose-outputbar input[type=number]::-webkit-outer-spin-button{appearance:none;margin:0}.nf-pose-outputbar input[type=color]{width:44px;height:28px;padding:2px;border:1px solid #454545;border-radius:5px;background:#2a2a2a}.nf-pose-body-options button[aria-pressed=true],.nf-pose-people button[aria-pressed=true]{background:#1e493d;border-color:#337c66}.nf-pose-selected-joint{font-size:11px;color:#aaa;line-height:1.5}
      .nf-pose-overlay{position:fixed;inset:0;z-index:2147483647;background:#000000b8;display:grid;place-items:center;padding:14px;box-sizing:border-box;color:#e9e9e9;font:12px system-ui}
      .nf-pose-dialog{width:min(1440px,100%);height:min(940px,100%);display:flex;flex-direction:column;background:#181818;border:1px solid #373737;border-radius:12px;box-shadow:0 24px 80px #0008;overflow:hidden}
      .nf-pose-dialog *{box-sizing:border-box}.nf-pose-dialog button,.nf-pose-dialog select,.nf-pose-dialog input[type=number]{background:#2a2a2a;color:#ddd;border:1px solid #3b3b3b;border-radius:7px;min-height:32px;padding:5px 10px;font:12px system-ui}
      .nf-pose-dialog button{cursor:pointer;transition:background .12s,border-color .12s}.nf-pose-dialog button:hover{background:#333;border-color:#555}.nf-pose-dialog button:disabled{opacity:.35;cursor:default}.nf-pose-dialog :focus-visible{outline:2px solid #56bc9b;outline-offset:2px}
      .nf-pose-head,.nf-pose-foot{display:flex;align-items:center;gap:8px;padding:10px 16px;flex:none}.nf-pose-head{border-bottom:1px solid #303030}.nf-pose-head h2{margin:0;flex:1;font-size:14px;font-weight:600;letter-spacing:.5px;color:#eee!important}.nf-pose-foot{border-top:1px solid #303030;flex-wrap:wrap}
      .nf-pose-body{position:relative;display:flex;flex:1;min-height:0}.nf-pose-side{width:216px;flex:none;overflow:auto;padding:16px 14px;display:flex;flex-direction:column;gap:10px;border-right:1px solid #303030;scrollbar-width:thin;scrollbar-color:#454545 transparent}.nf-pose-side label{display:grid;gap:6px;color:#bcbcbc}.nf-pose-side select{width:100%}.nf-pose-side h3{font-size:11px;margin:6px 0 0;padding-top:12px;border-top:1px solid #303030;color:#aaa;font-weight:600;letter-spacing:.4px}.nf-pose-row{display:flex;gap:6px;align-items:center}.nf-pose-row>*{min-width:0;flex:1}.nf-pose-row input{width:66px}.nf-pose-row .nf-pose-times{flex:0 0 10px}.nf-pose-row input[type=number]{padding:4px;appearance:textfield}.nf-pose-row input[type=number]::-webkit-inner-spin-button{appearance:none}.nf-pose-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}
      .nf-pose-library{position:absolute;inset:0;z-index:4;background:#202020;display:flex;flex-direction:column;padding:12px;gap:10px}.nf-pose-library[hidden]{display:none}.nf-pose-library-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.nf-pose-library-bar input{min-width:80px;flex:1;background:#2b2b2b;color:#eee;border:1px solid #454545;border-radius:5px;padding:7px;font:12px system-ui}.nf-pose-library-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));grid-auto-rows:max-content;gap:10px;overflow:auto;align-content:start;min-height:0;flex:1}.nf-pose-dialog .nf-pose-card{display:flex;flex-direction:column;align-items:stretch;gap:6px;text-align:center;padding:6px!important;height:auto!important;min-height:176px!important;max-height:none!important;overflow:hidden}.nf-pose-card img{display:block;width:100%;height:126px;object-fit:contain;background:#171717;border-radius:4px;flex:none}.nf-pose-card span{font-size:11px;color:#ddd;line-height:1.4;overflow-wrap:anywhere}.nf-pose-card small{color:#999;font-size:10px}.nf-pose-library-count{color:#aaa;font-size:11px}.nf-pose-side label.nf-pose-row{display:flex}
      .nf-pose-view{flex:1;min-width:0;display:flex;flex-direction:column;background:#222}.nf-pose-stage{flex:1;min-height:0;display:grid;place-items:center;padding:10px;overflow:hidden}.nf-pose-canvas{display:block;touch-action:none;border:0;border-radius:8px;max-width:100%;max-height:100%}.nf-pose-hint{padding:8px 16px;text-align:center;color:#999;line-height:1.5;font-size:11px}.nf-pose-status{flex:1;min-width:160px;color:#aaa;line-height:1.5}.nf-pose-status[data-error=true]{color:#ff9898}.nf-pose-dialog .nf-pose-primary{background:#1e493d;border-color:#337c66;color:#e3f4ec}.nf-pose-dialog .nf-pose-primary:hover{background:#285b4b}.nf-pose-dialog input[type=range]{width:100%;accent-color:#20b58a}.nf-pose-side a{color:#aaa;font-size:10px}.nf-pose-busy{color:#aaa;text-align:center;padding:16px}.nf-pose-axis{display:grid;grid-template-columns:15px 1fr 51px;gap:6px;align-items:center}.nf-pose-axis input[type=number]{width:51px;padding:3px}
      .nf-pose-dialog{color:var(--nf-text,#e5e7eb)}.nf-pose-dialog input[type=range]{accent-color:var(--nf-accent,#1ea672)}.nf-pose-save-panel{display:flex;align-items:center;gap:8px;flex-basis:100%;padding-top:8px;border-top:1px solid #303030}.nf-pose-save-panel[hidden]{display:none}.nf-pose-save-panel input{flex:1;min-width:80px;background:#242424;color:#eee;border:1px solid #3b3b3b;border-radius:7px;padding:8px;font:12px system-ui}.nf-pose-library-item{position:relative;display:flex;min-width:0}.nf-pose-library-item>.nf-pose-card{width:100%;flex:1}.nf-pose-dialog .nf-pose-delete{position:absolute;top:9px;right:9px;min-height:24px;padding:2px 6px;font-size:10px;background:#1b1b1be8;color:#ccc;border-color:#4b4b4b}.nf-pose-dialog .nf-pose-delete:hover{color:#ffa6a6;border-color:#8f5252}.nf-pose-import-panel{position:absolute;inset:0;z-index:5;background:#1b1b1b;display:flex;flex-direction:column;gap:12px;padding:14px}.nf-pose-import-preview{flex:1;min-height:0;display:flex;justify-content:center;align-items:center;overflow:hidden;background:#111;border-radius:7px}.nf-pose-import-preview canvas{max-width:100%;max-height:100%;object-fit:contain}.nf-pose-import-people{display:flex;gap:12px;flex-wrap:wrap}.nf-pose-import-people label{display:flex;align-items:center;gap:5px;cursor:pointer}.nf-pose-import-people input{accent-color:var(--nf-accent,#1ea672)}.nf-pose-import-footer{display:flex;justify-content:space-between;align-items:center;gap:12px;color:#aaa}.nf-pose-import-footer span{font-size:11px}
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
    const state = { width: 1024, height: 1024, background: '#e4e5e8' };
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
    const view = element('div', { class: 'nf-pose-view' }, [stage, element('div', { class: 'nf-pose-hint', text: '左键旋转视角 · Ctrl＋左键平移 · 滚轮缩放' })]);
    const actions = [];
    const action = (text, fn, attrs = {}) => { const b = button(text, () => run(fn), { disabled: '', ...attrs }); actions.push(b); return b; };
    function message(text, error = false) { status.textContent = text; status.dataset.error = String(error); }
    async function run(fn) { try { await fn(); } catch (error) { message(error.message || String(error), true); } }
    let viewer, resizeObserver, movement, handPresets, selectedJoint, library, libraryButton, libraryData, libraryRefresh, characters, peopleList, deletePerson, proportionSelect, proportionRequest = 0, actorControls = [], axisControls = [], editModes = [], imageRecognizer, imageModule, importPanel, importImageUrl, importing = false, saving = false;
    function snapshot() { return { version: 2, ...characters.snapshot(), width: state.width, height: state.height, background: state.background, pose: viewer.getPose(), view: { fov: viewer.camera.fov, zoom: viewer.camera.zoom } }; }
    function changed() { if (peopleList) renderPeople(); if (movement && !viewer.transform.dragging) movement.sync(); syncAxes(); }
    function close() {
      abort.abort(); imageRecognizer?.close(); if (importImageUrl) URL.revokeObjectURL(importImageUrl); resizeObserver?.disconnect(); viewer?.dispose(); overlay.remove(); editor = null;
      if (previousFocus?.isConnected) previousFocus.focus();
    }
    function download(blob, name) {
      const url = URL.createObjectURL(blob), link = element('a', { href: url, download: name });
      root.document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    function resize() {
      const rect = stage.getBoundingClientRect(), ratio = state.width / state.height;
      const width = Math.max(1, Math.min(rect.width - 20, (rect.height - 20) * ratio));
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
      return image;
    }
    const saveName = element('input', { type: 'text', maxlength: '60', 'aria-label': '姿势名称', placeholder: '输入姿势名称' });
    const confirmSave = button('确认保存', () => {} , { type: 'submit' });
    const savePanel = element('form', { class: 'nf-pose-save-panel', hidden: '', 'aria-label': '保存到姿势库', onsubmit: event => { event.preventDefault(); run(saveCurrentPose); } }, [saveName, confirmSave, button('取消', () => { savePanel.hidden = true; })]);
    const undoDelete = button('撤销删除', () => run(async () => { if (!lastDeleted) return; const entry = lastDeleted; if (entry.custom) await savedLibrary().put(entry); else await savedLibrary().remove(`hidden:${entry.id}`); lastDeleted = null; undoDelete.hidden = true; await libraryRefresh?.(); message('已恢复姿势'); }), { hidden: '' });
    let lastDeleted;
    const imageInput = element('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/bmp', hidden: '', 'aria-label': '导入姿势图片', onchange: () => { const file = imageInput.files[0]; imageInput.value = ''; if (file) run(() => importPoseImage(file)); } });
    const footer = element('footer', { class: 'nf-pose-foot' }, [status, undoDelete,
      action('导入姿势', () => imageInput.click(), { title: '导入图片并识别单人或多人姿势' }),
      action('保存姿势', async () => { if (importing || saving) return; saveName.value = `我的姿势 ${(await savedLibrary().list()).filter(p => p.custom).length + 1}`; savePanel.hidden = false; saveName.focus(); saveName.select(); }, { title: '将当前人物、姿势和镜头保存到姿势库' }),
      action('导出 PNG', async () => { const image = await capture(); download(await (await fetch(image)).blob(), 'NovaFlow_姿势参考.png'); message('姿势图已导出'); }),
      action('用作姿势参考', async () => { referenceSlot(root.__NovaFlowArtGenerate); const image = await capture(); applyReference(root.__NovaFlowArtGenerate, snapshot(), image); close(); }, { class: 'nf-pose-primary' }), savePanel, imageInput]);
    dialog.append(element('header', { class: 'nf-pose-head' }, [element('h2', { id: 'nf-pose-title', text: '姿势参考' }), closeButton]), element('div', { class: 'nf-pose-body' }, [side, view]), footer);
    overlay.append(dialog); root.document.body.append(overlay);
    editor = { close, closeButton, snapshot, capture, get viewer() { return viewer; } };
    root.document.addEventListener('keydown', event => {
      if (!editor) return;
      event.stopImmediatePropagation();
      if (event.key === 'Escape') { event.preventDefault(); if (importPanel) dismissImport(); else if (!savePanel.hidden) savePanel.hidden = true; else if (library && !library.hidden) { library.hidden = true; libraryButton.focus(); } else close(); }
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
    let widthInput, heightInput, background, loadBodyModel;
    try {
      const [{ PoseViewerCore }, { HAND_PRESETS }, modelResponse] = await Promise.all([
        import(vendor('pose_studio/core.js')), import(vendor('pose_studio/hand_presets.js')), fetch(vendor('pose_studio/assets/mannequin.json')),
      ]);
      if (!modelResponse.ok) throw new Error(`人偶资源载入失败 (${modelResponse.status})`);
      const model = await modelResponse.json(); if (abort.signal.aborted) return;
      const catalogResponse = await fetch(vendor('pose_studio/assets/body-types.json'));
      if (!catalogResponse.ok) throw new Error('体型资源索引载入失败');
      const catalog = await catalogResponse.json();
      const bodyModels = { 'adult-neutral': model }, pendingModels = new Map();
      loadBodyModel = async body => {
        const key = modelKey(body); if (bodyModels[key]) return bodyModels[key];
        if (!pendingModels.has(key)) pendingModels.set(key, (async () => {
          const definition = catalog.bodies.find(item => item.id === key);
          if (!definition) throw new Error(`体型资源不存在：${key}`);
          const response = await fetch(vendor(`pose_studio/assets/${definition.file}`));
          if (!response.ok) throw new Error(`体型资源载入失败：${key}`);
          return bodyModels[key] = await response.json();
        })().finally(() => pendingModels.delete(key)));
        return pendingModels.get(key);
      };
      if (abort.signal.aborted) return;
      handPresets = HAND_PRESETS;
      viewer = new PoseViewerCore(canvas, { skinMode: 'flat_color', enableTextureSkinning: false, showCaptureFrame: false, ikEnabled: true, useHandControlPopover: false, onPoseChange: changed, onBoneSelectionChange: syncAxes });
      await viewer.init(); if (abort.signal.aborted) { viewer.dispose(); return; }
      if (!viewer.initialized || !viewer.renderer) throw new Error('无法创建 3D 视图，请检查浏览器硬件加速');
      configureNavigation(viewer, canvas, abort.signal, event => characters?.pick(event, canvas));
      viewer.loadData(model); viewer.scene.background.set(state.background); viewer.setDirectionalSkydomeVisible(false);
      viewer.updateLights([{ type: 'ambient', color: '#ffffff', intensity: 0.65 }, { type: 'directional', color: '#ffffff', intensity: 2.0, x: 4, y: 10, z: 8 }]);
      const floor = new viewer.THREE.Box3().setFromObject(viewer.skinnedMesh).min.y;
      addStudioGrid(viewer, floor);
      characters = createCharacters(viewer, changed, bodyModels);
      characters.restore({ pose: { bones: { upperarm_l: [0, 0, -15], upperarm_r: [0, 0, 15] } } });
      libraryButton = button('打开姿势库', () => run(showLibrary), { 'data-novaflow-pose-library-open': '1', class: 'nf-pose-primary' });
      side.append(libraryButton, element('h3', { text: '场景人物' }));
      peopleList = element('div', { class: 'nf-pose-people', role: 'group', 'aria-label': '场景人物' });
      const addPerson = button('添加人物', () => run(() => { characters.add(); fitView(); changed(); }), { class: 'nf-pose-primary' });
      deletePerson = button('删除人物', () => run(() => {
        const name = characters.active()?.name;
        characters.remove(); changed(); message(`已删除${name || '人物'}，场景中剩余 ${characters.people.length} 人`);
      }));
      side.append(peopleList, element('div', { class: 'nf-pose-grid' }, [addPerson, deletePerson]));
      proportionSelect = element('select', { 'aria-label': '头身比例', onchange: () => run(async () => {
        const person = characters.active(); if (!person) return;
        const value = proportionSelect.value === '' ? null : Number(proportionSelect.value), request = ++proportionRequest;
        try {
          await loadBodyModel({ ...person.body, proportion: value });
          if (request !== proportionRequest || characters.active()?.id !== person.id || abort.signal.aborted) return;
          characters.setBody('proportion', value); changed();
        } finally { if (request === proportionRequest && !abort.signal.aborted) renderPeople(); }
      }) }, [['', '自然'], ...PROPORTIONS.map(value => [String(value), `${value}头身`])].map(([value, text]) => element('option', { value, text })));
      side.append(element('h3', { text: '头身比例' }), proportionSelect); actorControls.push(proportionSelect);
      selectedJoint = element('div', { class: 'nf-pose-selected-joint', role: 'status', text: '点击人偶上的关节进行旋转' });
      side.append(element('h3', { text: '骨骼编辑' }));
      editModes = [['translate', '移动关节'], ['rotate', '旋转关节']].map(([mode, text]) => {
        const control = button(text, () => movement?.setMode(mode), { 'aria-pressed': String(mode === 'translate') }); actorControls.push(control); return { mode, control };
      });
      const viewportToolbar = element('div', { class: 'nf-pose-toolbar' }, [element('div', { class: 'nf-pose-body-options nf-pose-modebar', role: 'group', 'aria-label': '骨骼操作模式' }, editModes.map(item => item.control))]);
      view.prepend(viewportToolbar);
      side.append(selectedJoint);
      axisControls = ['X', 'Y', 'Z'].map((axis, i) => {
        const slider = element('input', { type: 'range', min: '-180', max: '180', value: '0', step: '1', 'aria-label': `关节 ${axis} 旋转` });
        const number = element('input', { type: 'number', min: '-180', max: '180', value: '0', step: '1', 'aria-label': `关节 ${axis} 角度` });
        const commit = value => {
          if (!viewer.selectedBone || viewer.selectedBone.name === 'Root') return;
          if (movement?.getMode() === 'translate') { movement.setOffset(axis.toLowerCase(), value); return; }
          const n = Math.max(-180, Math.min(180, Number(value) || 0)); viewer.selectedBone.rotation[axis.toLowerCase()] = n * Math.PI / 180; viewer.selectedBone.updateMatrixWorld(true); viewer.updateIKEffectorPositions(); viewer.requestRender(); changed();
        };
        slider.addEventListener('pointerdown', () => viewer.recordState()); slider.addEventListener('input', () => commit(slider.value)); number.addEventListener('focus', () => viewer.recordState()); number.addEventListener('input', () => commit(number.value));
        number.addEventListener('change', () => { if (movement?.getMode() === 'translate') number.value = +movement.getOffset(axis.toLowerCase()).toFixed(2); });
        side.append(element('div', { class: 'nf-pose-axis' }, [element('span', { text: axis }), slider, number])); return { slider, number };
      });
      const rigActions = element('div', { class: 'nf-pose-grid' }, [button('撤销', () => { viewer.undo(); changed(); }), button('重做', () => { viewer.redo(); changed(); }), button('重置关节', () => { viewer.recordState(); if (viewer.selectedBone?.name === 'Root') characters.setPositions({ x: 0, y: 0, z: 0 }); else viewer.resetSelectedBone(); changed(); }), button('重置姿势', () => { viewer.recordState(); viewer.resetPose(); changed(); })]); side.append(rigActions); actorControls.push(...rigActions.querySelectorAll('button'));
      side.append(element('h3', { text: '手势' }));
      const handSide = element('select', { 'aria-label': '手势作用侧' }, ['both', 'l', 'r'].map((value, i) => element('option', { value, text: ['双手', '左手', '右手'][i] })));
      const hands = element('div', { class: 'nf-pose-grid' }, [['OPEN', '张开'], ['FIST', '握拳'], ['CHOP', '并拢']].map(([key, text]) => button(text, () => { viewer.applyHandPreset(handSide.value, handPresets[key]); changed(); }))); side.append(handSide, hands); actorControls.push(handSide, ...hands.querySelectorAll('button'));
      viewportToolbar.append(element('div', { class: 'nf-pose-camera-tools', role: 'group', 'aria-label': '画布镜头' }, [button('适配全部人物', fitView), ...[['正面', 0], ['背面', Math.PI], ['左侧', -Math.PI / 2], ['右侧', Math.PI / 2]].map(([text, angle]) => button(text, () => {
        const distance = viewer.camera.position.distanceTo(viewer.orbit.target); viewer.camera.position.copy(viewer.orbit.target).add(new viewer.THREE.Vector3(Math.sin(angle) * distance, 0, Math.cos(angle) * distance)); viewer.orbit.update(); fitView(); viewer.requestRender(); changed();
      }))]));
      const updateOutputSize = () => { state.width = size(widthInput.value); state.height = size(heightInput.value); resize(); changed(); };
      widthInput = element('input', { type: 'number', min: '256', max: '2048', value: state.width, 'data-novaflow-number-fill': '1', 'aria-label': '姿势图宽度', oninput: updateOutputSize, onchange: () => { updateOutputSize(); widthInput.value = state.width; } });
      heightInput = element('input', { type: 'number', min: '256', max: '2048', value: state.height, 'data-novaflow-number-fill': '1', 'aria-label': '姿势图高度', oninput: updateOutputSize, onchange: () => { updateOutputSize(); heightInput.value = state.height; } });
      background = element('input', { type: 'color', value: state.background, 'aria-label': '姿势图背景', oninput: () => { state.background = background.value; viewer.scene.background.set(state.background); viewer.requestRender(); changed(); } });
      const outputBar = element('div', { class: 'nf-pose-outputbar', role: 'group', 'aria-label': '画布输出设置' }, [element('label', { class: 'nf-pose-output-size' }, [element('span', { text: '输出尺寸' }), widthInput, element('span', { text: '×' }), heightInput]), element('label', { class: 'nf-pose-output-background' }, [element('span', { text: '背景颜色' }), background])]);
      view.insertBefore(outputBar, view.lastChild);
      viewer.orbit.addEventListener('end', changed);
      resizeObserver = new ResizeObserver(resize); resizeObserver.observe(stage); resize();
      viewer.camera.position.copy(viewer.orbit.target).add(new viewer.THREE.Vector3(0, 0, 4)); fitView();
      actions.forEach(b => b.removeAttribute('disabled')); message('调整人偶与镜头后，导出 PNG 或用作姿势参考'); changed();
      movement = configureRootTranslation(viewer, characters, changed); syncAxes();
      viewer.options.onBoneSelectionChange = () => { movement.sync(); syncAxes(); };
    } catch (error) { if (!abort.signal.aborted) message(`载入失败：${error.message}`, true); }

    function syncAxes() {
      const rootSelected = viewer?.selectedBone?.name === 'Root';
      const translating = movement?.getMode() !== 'rotate';
      const bone = characters?.active() && !rootSelected && viewer?.selectedBone;
      if (selectedJoint) selectedJoint.textContent = viewer?.selectedBone && characters?.active()
        ? (rootSelected ? '整体移动：拖动 X/Y/Z 箭头或平面' : `${translating ? '移动' : '旋转'}：${jointLabel(viewer.selectedBone.name)}${translating ? '（调整骨骼位置和体型）' : ''}`)
        : '点击人偶关节，再拖动箭头移动或圆环旋转';
      editModes.forEach(({ mode, control }) => control.setAttribute('aria-pressed', String(mode === (translating ? 'translate' : 'rotate'))));
      axisControls.forEach(({ slider, number }, i) => {
        const axis = ['x', 'y', 'z'][i], label = axis.toUpperCase();
        slider.disabled = number.disabled = !bone;
        slider.min = number.min = translating ? '-20' : '-180'; slider.max = number.max = translating ? '20' : '180';
        slider.step = number.step = translating ? '0.05' : '1';
        slider.setAttribute('aria-label', `关节 ${label} ${translating ? '位移' : '旋转'}`);
        number.setAttribute('aria-label', `关节 ${label} ${translating ? '位置偏移' : '角度'}`);
        number.title = translating ? '相对默认骨架的局部位移，0 为默认位置' : '骨骼局部旋转角度';
        if (bone) {
          const value = translating ? +movement.getOffset(axis).toFixed(2) : Math.round(bone.rotation[axis] * 180 / Math.PI);
          slider.value = value; if (root.document.activeElement !== number) number.value = value;
        }
      });
    }

    function renderPeople() {
      const current = characters.active();
      // Keep the people list stable while the rig reports pointer changes.
      if (peopleList.dataset.signature !== characters.people.map(p => `${p.id}:${p.id === current?.id}`).join('|')) {
        peopleList.dataset.signature = characters.people.map(p => `${p.id}:${p.id === current?.id}`).join('|');
        peopleList.replaceChildren(...characters.people.map(p => button(p.name, () => characters.select(p.id), { 'aria-pressed': String(p === current), 'aria-label': `选择${p.name}`, 'data-pose-person': p.id })));
        if (!characters.people.length) peopleList.append(element('span', { text: '场景为空，请添加人物' }));
      }
      if (deletePerson) deletePerson.disabled = !current;
      for (const control of actorControls) control.disabled = !current;
      if (proportionSelect) proportionSelect.value = String(current?.body.proportion ?? '');
    }

    async function saveCurrentPose() {
      if (saving) return;
      const name = saveName.value.trim();
      if (!name) { saveName.focus(); throw new Error('请输入姿势名称'); }
      if (!characters.people.length) throw new Error('请先添加人物再保存姿势');
      saving = true; confirmSave.disabled = true;
      try {
        await viewer.waitForCaptureReady(); if (abort.signal.aborted) return;
        const document = normalizeDocument(snapshot());
        const ratio = state.width / state.height;
        const preview = viewer.capture(Math.round(256 * Math.min(1, ratio)), Math.round(256 * Math.min(1, 1 / ratio)), 1, state.background, 0, 0, 0, 0, { viewport: true });
        if (!preview?.startsWith('data:image/png;base64,')) throw new Error('姿势缩略图生成失败，请重试');
        await savedLibrary().put({ id: `custom:${root.crypto.randomUUID()}`, name, custom: true, category: '我的姿势', tags: [], createdAt: Date.now(), document, preview });
        if (abort.signal.aborted) return;
        savePanel.hidden = true; await showLibrary(true); message(`已保存到姿势库：${name}`);
      } finally { saving = false; confirmSave.disabled = false; }
    }

    function dismissImport() {
      importPanel?.remove(); importPanel = null;
      if (importImageUrl) { URL.revokeObjectURL(importImageUrl); importImageUrl = null; }
    }

    async function importPoseImage(file) {
      if (importing) return;
      importing = true; actions.forEach(b => { b.disabled = true; });
      dismissImport(); savePanel.hidden = true;
      try {
        message('正在准备图片识别…');
        imageModule ||= await import(new URL('./pose-reference-image.js', scriptUrl).href);
        if (abort.signal.aborted) return;
        imageRecognizer ||= imageModule.createImagePoseRecognizer();
        const result = await imageRecognizer.detect(file, text => { if (!abort.signal.aborted) message(text); });
        if (abort.signal.aborted) return;
        const people = imageModule.detectedPeople(result);
        if (!people.length) throw new Error('未识别到清晰人体，请使用人物较完整、遮挡较少的图片');
        if (library) library.hidden = true;
        importImageUrl = URL.createObjectURL(file);
        const sourceImage = element('img', { src: importImageUrl, alt: '待识别姿势图片' });
        await sourceImage.decode(); if (abort.signal.aborted) return;
        const preview = element('canvas', { 'aria-label': `识别到 ${people.length} 个人物的姿势预览` });
        const scale = Math.min(1, 1200 / Math.max(sourceImage.naturalWidth, sourceImage.naturalHeight));
        preview.width = Math.round(sourceImage.naturalWidth * scale); preview.height = Math.round(sourceImage.naturalHeight * scale);
        const ctx = preview.getContext('2d'), checks = people.map(() => true);
        const colors = ['#3be0a0', '#ffd36c', '#77baff', '#fa95ce', '#bf9bff'];
        const connections = [[11, 12], [11, 23], [12, 24], [23, 24], [11, 13], [13, 15], [12, 14], [14, 16], [23, 25], [25, 27], [24, 26], [26, 28]];
        const applyButton = button('', () => run(async () => {
          const chosen = people.filter((_, i) => checks[i]); if (!chosen.length) return;
          const previous = snapshot();
          try {
            ++proportionRequest;
            characters.restore({ pose: { bones: {} } });
            const targetHeight = new viewer.THREE.Box3().setFromObject(viewer.skinnedMesh).getSize(new viewer.THREE.Vector3()).y;
            const torso = chosen.reduce((sum, person) => sum + person.torso, 0) / chosen.length;
            const center = chosen.reduce((sum, person) => sum + person.x, 0) / chosen.length;
            for (const [index, person] of chosen.entries()) {
              if (index) characters.add();
              characters.setPositions({ x: Math.max(-50, Math.min(50, (person.x - center) * sourceImage.naturalWidth / sourceImage.naturalHeight / torso * targetHeight * 0.28)), y: 0, z: 0 });
              imageModule.applyDetectedPose(viewer, person);
              const bottom = new viewer.THREE.Box3().setFromObject(viewer.skinnedMesh).min.y;
              characters.setPosition('y', viewer.gridHelper.position.y + 0.03 - bottom);
            }
            characters.select(characters.people[0].id);
            libraryButton.textContent = '打开姿势库';
            viewer.camera.position.copy(viewer.orbit.target).add(new viewer.THREE.Vector3(0, 0, 50)); viewer.orbit.update();
            fitView(); changed(); dismissImport(); message(`已导入 ${chosen.length} 个人物，可继续调整并保存到姿势库`);
          } catch (error) { characters.restore(previous); if (previous.pose.camera) viewer.setPose({ ...viewer.getPose(), camera: previous.pose.camera }); throw error; }
        }), { class: 'nf-pose-primary' });
        function draw() {
          ctx.drawImage(sourceImage, 0, 0, preview.width, preview.height);
          people.forEach((person, index) => {
            if (!checks[index]) return;
            const p = i => [person.points[i].x * preview.width, person.points[i].y * preview.height];
            ctx.strokeStyle = colors[index % colors.length]; ctx.lineWidth = Math.max(2, preview.width / 300);
            for (const [a, b] of connections) { ctx.beginPath(); ctx.moveTo(...p(a)); ctx.lineTo(...p(b)); ctx.stroke(); }
            const [x, y] = p(11); ctx.fillStyle = '#151515'; ctx.fillRect(x - 14, y - 30, 28, 24); ctx.fillStyle = colors[index % colors.length]; ctx.font = 'bold 18px system-ui'; ctx.textAlign = 'center'; ctx.fillText(index + 1, x, y - 11);
          });
          const count = checks.filter(Boolean).length; applyButton.textContent = `应用 ${count} 个人物`; applyButton.disabled = !count;
        }
        const choices = element('div', { class: 'nf-pose-import-people', role: 'group', 'aria-label': '选择导入人物' }, people.map((_, index) => element('label', {}, [element('input', { type: 'checkbox', checked: '', 'aria-label': `导入人物 ${index + 1}`, onchange: event => { checks[index] = event.target.checked; draw(); } }), element('span', { text: `人物 ${index + 1}` })])));
        importPanel = element('div', { class: 'nf-pose-import-panel', 'aria-label': '图片姿势识别结果' }, [element('div', { class: 'nf-pose-library-bar' }, [button('返回编辑', dismissImport), element('strong', { text: `识别到 ${people.length} 个人物` })]), element('div', { class: 'nf-pose-import-preview' }, [preview]), choices, element('div', { class: 'nf-pose-import-footer' }, [element('span', { text: '应用后用所选人物重建当前场景；遮挡和前后深度可继续手动调整。' }), applyButton])]);
        dialog.querySelector('.nf-pose-body').append(importPanel); draw(); message('请选择需要导入的人物');
      } finally { importing = false; if (!abort.signal.aborted) actions.forEach(b => { b.disabled = false; }); }
    }

    async function showLibrary(mine = false) {
      if (library) { await libraryRefresh(mine); library.hidden = false; library.querySelector('input')?.focus(); return; }
      message('正在载入姿势库…');
      const response = await fetch(vendor('pose_library/index.json'));
      if (!response.ok) throw new Error(`姿势库载入失败 (${response.status})`);
      libraryData = await response.json(); if (abort.signal.aborted) return;
      const categoryNames = { 'Close Up': '特写', Crawling: '爬行', Crouching: '蹲姿', Fighting: '格斗', Gymnastics: '体操', Kneeling: '跪姿', Laying: '卧姿', Sitting: '坐姿', Standing: '站姿', Walking: '行走', Ballet: '芭蕾', Rest: '休息' };
      const translate = name => name.replace(/Standing/gi, '站立').replace(/Sitting|Seated/gi, '坐姿').replace(/Squatting|Crouching/gi, '蹲姿').replace(/Kneeling/gi, '跪姿').replace(/Crawling/gi, '爬行').replace(/Fighting|Boxing/gi, '格斗').replace(/Laying|Lying|Prone/gi, '卧姿').replace(/Walking/gi, '行走').replace(/Jumping/gi, '跳跃').replace(/Kicking/gi, '踢腿').replace(/rear( view)?/gi, '背面').replace(/side( view)?|profile/gi, '侧面').replace(/overhead( view)?/gi, '俯视').replace(/Close ?Up/gi, '特写').replace(/Leaning Back/gi, '后仰').replace(/Legs Crossed/gi, '交叉腿').replace(/Hand on Hip/gi, '叉腰').replace(/Arabesque/gi, '燕式平衡').replace(/Dancing_on_knees/gi, '跪姿舞蹈').replace(/Splits_1/gi, '劈叉');
      let personal = [], hiddenIds = new Set();
      const category = element('select', { 'aria-label': '姿势分类' }, [element('option', { value: '', text: '全部分类' }), element('option', { value: '我的姿势', text: '我的姿势' }), ...Array.from(new Set(libraryData.poses.map(p => p.category))).map(key => element('option', { value: key, text: categoryNames[key] || key }))]);
      const search = element('input', { type: 'search', placeholder: '搜索姿势', 'aria-label': '搜索姿势' });
      const count = element('span', { class: 'nf-pose-library-count' });
      const grid = element('div', { class: 'nf-pose-library-grid', 'data-novaflow-pose-library-grid': '1' });
      library = element('div', { class: 'nf-pose-library', 'aria-label': '姿势库' }, [element('div', { class: 'nf-pose-library-bar' }, [button('返回编辑', () => { library.hidden = true; libraryButton.focus(); }), search, category, count]), grid]);
      dialog.querySelector('.nf-pose-body').append(library);
      function renderLibrary() {
        const text = search.value.trim().toLowerCase();
        const available = [...personal, ...libraryData.poses.filter(p => !hiddenIds.has(p.id))];
        const poses = available.filter(p => (!category.value || p.category === category.value) && (!text || `${p.name} ${translate(p.name)} ${categoryNames[p.category] || p.category} ${(p.tags || []).join(' ')}`.toLowerCase().includes(text)));
        count.textContent = `${poses.length} / ${available.length} 个姿势`;
        grid.replaceChildren(...poses.map(pose => button('', () => run(async () => {
          if (pose.custom) {
            const doc = normalizeDocument(pose.document);
            await Promise.all(doc.characters.flatMap(p => [loadBodyModel(p.body), loadBodyModel({ ...p.body, gender: 'neutral' })]));
            if (abort.signal.aborted) return;
            ++proportionRequest;
            characters.restore(doc); Object.assign(state, { width: doc.width, height: doc.height, background: doc.background });
            widthInput.value = state.width; heightInput.value = state.height; background.value = state.background; viewer.scene.background.set(state.background);
            if (doc.view) { viewer.camera.fov = doc.view.fov; viewer.camera.zoom = doc.view.zoom; viewer.camera.updateProjectionMatrix(); }
            if (doc.pose.camera) viewer.setPose({ ...viewer.getPose(), camera: doc.pose.camera });
            resize(); viewer.requestRender(); library.hidden = true; libraryButton.textContent = `姿势库 · ${pose.name}`; libraryButton.focus(); changed(); message(`已应用：${pose.name}`); return;
          }
          if (!characters.active()) characters.add();
          const response = await fetch(vendor(`pose_library/${pose.json}`));
          if (!response.ok) throw new Error(`姿势载入失败 (${response.status})`);
          const document = normalizeDocument(await response.json()); if (abort.signal.aborted) return;
          const libraryPose = clone(document.pose);
          {
            // A preset's local offsets and world-space IK targets belong to its
            // original body proportions. Keep the selected body's rest lengths.
            for (const key of ['bonePositions', 'hipBonePosition', 'ikEffectorPositions', 'poleTargetPositions']) delete libraryPose[key];
          }
          libraryPose.bonePositions = clone(viewer.getPose().bonePositions || {});
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
          const pose = poses[i]; card.append(element('img', { src: pose.custom ? pose.preview : vendor(`pose_library/${pose.preview}`), alt: '', loading: 'lazy' }), element('span', { text: pose.custom ? pose.name : translate(pose.name) }), element('small', { text: categoryNames[pose.category] || pose.category }));
          const remove = button('删除', () => run(async () => {
            remove.disabled = true;
            try {
              if (pose.custom) await savedLibrary().remove(pose.id); else await savedLibrary().put({ id: `hidden:${pose.id}`, hiddenPoseId: pose.id });
              lastDeleted = pose; undoDelete.hidden = false; await libraryRefresh(); message(`已删除：${pose.name}`);
            } finally { remove.disabled = false; }
          }), { class: 'nf-pose-delete', 'aria-label': `删除姿势 ${pose.name}`, title: '从姿势库删除' });
          return element('div', { class: 'nf-pose-library-item' }, [card, remove]);
        }));
        if (!poses.length) grid.append(element('div', { class: 'nf-pose-busy', text: '没有匹配的姿势' }));
      }
      libraryRefresh = async mine => {
        const records = await savedLibrary().list(); if (abort.signal.aborted) return;
        personal = records.filter(p => p.custom).sort((a, b) => b.createdAt - a.createdAt);
        hiddenIds = new Set(records.filter(p => p.hiddenPoseId).map(p => p.hiddenPoseId));
        if (mine) { category.value = '我的姿势'; search.value = ''; }
        renderLibrary();
      };
      search.addEventListener('input', renderLibrary); category.addEventListener('change', renderLibrary);
      try { await libraryRefresh(mine); } catch (error) { renderLibrary(); search.focus(); message(error.message, true); return; }
      search.focus();
      message('点击缩略图应用姿势，也可保存当前姿势或删除库内姿势');
    }
  }

  root.NovaFlowPoseReferenceTool = Object.freeze({ open, close: () => editor?.close(), normalizeDocument, referenceSlot, applyReference, configureNavigation, createCharacters, configureRootTranslation, createPoseLibraryStore, getEditor: () => editor });
  if (root.document && typeof root.MutationObserver === 'function') {
    let queued = false;
    new root.MutationObserver(() => {
      if (queued) return; queued = true;
      root.queueMicrotask(() => { queued = false; if (editor && !root.document.querySelector('[data-novaflow-spine-split-control-category="enhance"]')) editor.close(); });
    }).observe(root.document.documentElement, { childList: true, subtree: true });
  }
})(typeof window !== 'undefined' ? window : globalThis);
