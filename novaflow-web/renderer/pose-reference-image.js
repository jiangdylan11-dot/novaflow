import { poseQuality, remapPoseResult, mergePoseCandidates } from './pose-reference-image-math.js';

export function mergeCroppedPoseResult(previous, result, crop, aspect) {
  return { ...mergePoseCandidates([remapPoseResult(previous, { aspect }), remapPoseResult(result, { crop, aspect })]), imageAspect: aspect };
}

export function createImagePoseRecognizer() {
  let worker, pending, sequence = 0, disposed = false;
  function reset(error) {
    worker?.terminate(); worker = null;
    if (pending) { clearTimeout(pending.timer); pending.reject(error); pending = null; }
  }
  function close() { disposed = true; reset(new Error('已取消图片识别')); }
  async function detect(file, onProgress = () => {}) {
    if (disposed) throw new Error('已取消图片识别');
    if (pending) throw new Error('请等待当前图片识别完成');
    if (!/^image\/(png|jpeg|webp|bmp)$/.test(file.type)) throw new Error('请选择 PNG、JPG、WebP 或 BMP 图片');
    if (file.size > 20 * 1024 * 1024) throw new Error('图片不能超过 20 MB');
    let image = await createImageBitmap(file);
    const width = image.width, height = image.height;
    if (Math.max(width, height) > 2048) {
      const scale = 2048 / Math.max(width, height);
      const smaller = await createImageBitmap(image, { resizeWidth: Math.round(width * scale), resizeHeight: Math.round(height * scale) });
      image.close(); image = smaller;
    }
    if (disposed) { image.close(); throw new Error('已取消图片识别'); }
    if (!worker) {
      try { worker = new Worker(new URL('./pose-reference-image.worker.js', import.meta.url)); } catch (error) { image.close(); throw error; }
      worker.onmessage = ({ data }) => {
        if (!pending || pending.id !== data.id) return;
        if (data.progress) { pending.onProgress(data.progress); return; }
        const request = pending; pending = null; clearTimeout(request.timer);
        data.error ? request.reject(new Error(data.error)) : request.resolve(data.result);
      };
      worker.onerror = () => { if (pending) { const request = pending; pending = null; clearTimeout(request.timer); request.reject(new Error('图片识别组件无法启动，请刷新后重试')); } worker?.terminate(); worker = null; };
    }
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      pending = { id, resolve, reject, onProgress, timer: setTimeout(() => reset(new Error('图片识别超时，请重试')), 90000) };
      try { worker.postMessage({ id, image }, [image]); } catch (error) { image.close(); reset(error); }
    });
  }
  return { detect, close };
}

export function detectedPeople(result) {
  const people = [];
  for (const [index, points] of (result?.landmarks || []).entries()) {
    const world = result.worldLandmarks?.[index];
    if (!Array.isArray(points) || !Array.isArray(world) || points.length < 33 || world.length < 33) continue;
    if ([11, 12, 23, 24].some(i => ![points[i]?.x, points[i]?.y, world[i]?.x, world[i]?.y, world[i]?.z].every(Number.isFinite))) continue;
    const quality = poseQuality(points, world); if (!quality) continue;
    const x = (points[23].x + points[24].x) / 2, y = (points[23].y + points[24].y) / 2;
    const aspect = result.imageAspect || 1;
    const torso = Math.max(Math.hypot(((points[11].x + points[12].x) / 2 - x) * aspect, (points[11].y + points[12].y) / 2 - y), Math.hypot((quality.box.right - quality.box.left) * aspect, quality.box.bottom - quality.box.top) * 0.15);
    const joints = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
    if (people.some(p => Math.hypot(p.x - x, p.y - y) < Math.min(p.torso, torso) * 0.2 && joints.reduce((sum, i) => sum + Math.hypot(p.points[i].x - points[i].x, p.points[i].y - points[i].y), 0) / joints.length < Math.min(p.torso, torso) * 0.07)) continue;
    people.push({ points, world, x, y, torso, confidence: quality.score, imageAspect: result.imageAspect || 1 });
  }
  return people.sort((a, b) => a.x - b.x);
}

export function layoutDetectedPeople(people, modelHeight) {
  if (!people.length) return [];
  const torso = people.reduce((sum, p) => sum + p.torso, 0) / people.length;
  const x = people.reduce((sum, p) => sum + p.x, 0) / people.length, y = people.reduce((sum, p) => sum + p.y, 0) / people.length;
  const scale = modelHeight * 0.28 / Math.max(0.01, torso);
  return people.map(p => ({ x: Math.max(-50, Math.min(50, (p.x - x) * p.imageAspect * scale)), y: Math.max(-50, Math.min(50, (y - p.y) * scale)), z: 0 }));
}

export function uncertainPoseParts(person) {
  return [['左臂', 11, 13, 15], ['右臂', 12, 14, 16], ['左腿', 23, 25, 27], ['右腿', 24, 26, 28]]
    .filter(([, ...joints]) => joints.some(i => (person.points[i].visibility ?? 1) < 0.25)).map(([name]) => name);
}

export function correctPoseJoint(person, index, x, y) {
  if (![11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28].includes(index) || ![x, y].every(Number.isFinite)) return false;
  const point = person.points[index];
  point.x = Math.max(0, Math.min(1, x)); point.y = Math.max(0, Math.min(1, y));
  point.visibility = 1; point.corrected = true;
  person.x = (person.points[23].x + person.points[24].x) / 2;
  person.y = (person.points[23].y + person.points[24].y) / 2;
  person.torso = Math.max(0.01, Math.hypot(((person.points[11].x + person.points[12].x) / 2 - person.x) * (person.imageAspect || 1), (person.points[11].y + person.points[12].y) / 2 - person.y));
  return true;
}

export function applyDetectedPose(viewer, person) {
  const THREE = viewer.THREE;
  const source = person.world.map(p => new THREE.Vector3(p.x, -p.y, -p.z));
  if (source.some(p => ![p.x, p.y, p.z].every(Number.isFinite))) throw new Error('识别结果包含无效关节');
  const pelvis = source[23].clone().add(source[24]).multiplyScalar(0.5);
  const neck = source[11].clone().add(source[12]).multiplyScalar(0.5);
  const up = neck.clone().sub(pelvis), canonicalAngle = Math.atan2(up.x, up.y);
  const canonical = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), canonicalAngle);
  const targetPelvis = viewer.bones.pelvis.getWorldPosition(new THREE.Vector3());
  const targetNeck = viewer.bones.neck_01.getWorldPosition(new THREE.Vector3());
  const scale = targetPelvis.distanceTo(targetNeck) / Math.max(0.05, pelvis.distanceTo(neck));
  // The upstream torso solver assumes an upright pelvis. Solve in that frame,
  // then restore the image's actual orientation instead of flipping inverted bodies.
  const point = i => source[i].clone().sub(pelvis).applyQuaternion(canonical).multiplyScalar(scale).add(targetPelvis);
  const keypoints = { pelvis: targetPelvis, neck: point(11).add(point(12)).multiplyScalar(0.5), head: point(7).add(point(8)).multiplyScalar(0.5), nose: point(0), left_eye: point(2), right_eye: point(5) };
  for (const [name, left, right] of [['shoulder', 11, 12], ['elbow', 13, 14], ['wrist', 15, 16], ['hip', 23, 24], ['knee', 25, 26], ['ankle', 27, 28]]) {
    keypoints['left_' + name] = point(left); keypoints['right_' + name] = point(right);
  }
  // Preserve the chosen mannequin's shape and limb lengths; only pose its joints.
  if (!viewer.applyWorldKeypointImport(keypoints, { drawFigure: false, placeHipRoots: false, normalizeLimbs: true, alignHands: false, alignFeet: false, dispatchPoseChange: false })) throw new Error('无法将识别结果应用到人偶');
  const position = name => viewer.bones[name].getWorldPosition(new THREE.Vector3());
  function rotateWorldZ(bone, angle) {
    const parent = bone.parent?.getWorldQuaternion(new THREE.Quaternion()) || new THREE.Quaternion();
    const world = bone.getWorldQuaternion(new THREE.Quaternion());
    const delta = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle);
    bone.quaternion.copy(parent.invert().multiply(delta.multiply(world)));
    viewer.skinnedMesh.updateMatrixWorld(true);
  }
  if (person.points) {
    const points = person.points, aspect = person.imageAspect || 1;
    const imageHip = { x: (points[23].x + points[24].x) / 2, y: (points[23].y + points[24].y) / 2 };
    const dx = ((points[11].x + points[12].x) / 2 - imageHip.x) * aspect;
    const dy = imageHip.y - (points[11].y + points[12].y) / 2;
    const worldUp = position('upperarm_l').add(position('upperarm_r')).sub(position('thigh_l')).sub(position('thigh_r'));
    const desired = Math.hypot(dx, dy) > 0.005 ? Math.atan2(dy, dx) : Math.PI / 2 - canonicalAngle;
    const anchor = position('pelvis');
    rotateWorldZ(viewer.bones.Root, desired - Math.atan2(worldUp.y, worldUp.x));
    const parent = viewer.bones.Root.parent;
    const correction = parent.worldToLocal(anchor.clone()).sub(parent.worldToLocal(position('pelvis')));
    viewer.bones.Root.position.add(correction); viewer.skinnedMesh.updateMatrixWorld(true);
    // Refine visible limb directions against the actual pixels. Estimated depth
    // remains a hint; it must not turn a bent arm into a different screen pose.
    for (const [name, child, a, b] of [['upperarm_l', 'lowerarm_l', 11, 13], ['lowerarm_l', 'hand_l', 13, 15], ['upperarm_r', 'lowerarm_r', 12, 14], ['lowerarm_r', 'hand_r', 14, 16], ['thigh_l', 'calf_l', 23, 25], ['calf_l', 'foot_l', 25, 27], ['thigh_r', 'calf_r', 24, 26], ['calf_r', 'foot_r', 26, 28]]) {
      if (Math.min(points[a].visibility ?? 1, points[b].visibility ?? 1) < 0.25) continue;
      const x = (points[b].x - points[a].x) * aspect, y = points[a].y - points[b].y;
      const current = position(child).sub(position(name));
      if (Math.hypot(x, y) < 0.005 || Math.hypot(current.x, current.y) < 1e-5) continue;
      rotateWorldZ(viewer.bones[name], Math.atan2(y, x) - Math.atan2(current.y, current.x));
    }
  } else if (Math.abs(canonicalAngle) > 1e-6) {
    const anchor = position('pelvis'); rotateWorldZ(viewer.bones.Root, -canonicalAngle);
    const parent = viewer.bones.Root.parent;
    viewer.bones.Root.position.add(parent.worldToLocal(anchor.clone()).sub(parent.worldToLocal(position('pelvis'))));
  }
  viewer.skinnedMesh.updateMatrixWorld(true); viewer.skeleton.update(); viewer.skinnedMesh.computeBoundingBox();
  viewer.updateMarkers(); viewer.updateIKEffectorPositions('all'); viewer.requestRender();
}
