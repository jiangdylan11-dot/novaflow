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
    const confidence = [11, 12, 23, 24].reduce((sum, i) => sum + Math.min(points[i].visibility ?? 1, points[i].presence ?? 1), 0) / 4;
    if (confidence < 0.4) continue;
    const x = (points[23].x + points[24].x) / 2, y = (points[23].y + points[24].y) / 2;
    const torso = Math.hypot((points[11].x + points[12].x) / 2 - x, (points[11].y + points[12].y) / 2 - y);
    if (torso < 0.015) continue;
    const joints = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
    if (people.some(p => Math.hypot(p.x - x, p.y - y) < Math.min(p.torso, torso) * 0.2 && joints.reduce((sum, i) => sum + Math.hypot(p.points[i].x - points[i].x, p.points[i].y - points[i].y), 0) / joints.length < Math.min(p.torso, torso) * 0.07)) continue;
    people.push({ points, world, x, y, torso });
  }
  return people.sort((a, b) => a.x - b.x);
}

export function applyDetectedPose(viewer, person) {
  const THREE = viewer.THREE;
  const source = person.world.map(p => new THREE.Vector3(p.x, -p.y, -p.z));
  if (source.some(p => ![p.x, p.y, p.z].every(Number.isFinite))) throw new Error('识别结果包含无效关节');
  const pelvis = source[23].clone().add(source[24]).multiplyScalar(0.5);
  const neck = source[11].clone().add(source[12]).multiplyScalar(0.5);
  const targetPelvis = viewer.bones.pelvis.getWorldPosition(new THREE.Vector3());
  const targetNeck = viewer.bones.neck_01.getWorldPosition(new THREE.Vector3());
  const scale = targetPelvis.distanceTo(targetNeck) / Math.max(0.05, pelvis.distanceTo(neck));
  const point = i => source[i].clone().sub(pelvis).multiplyScalar(scale).add(targetPelvis);
  const keypoints = { pelvis: targetPelvis, neck: point(11).add(point(12)).multiplyScalar(0.5), head: point(7).add(point(8)).multiplyScalar(0.5), nose: point(0), left_eye: point(2), right_eye: point(5) };
  for (const [name, left, right] of [['shoulder', 11, 12], ['elbow', 13, 14], ['wrist', 15, 16], ['hip', 23, 24], ['knee', 25, 26], ['ankle', 27, 28]]) {
    keypoints['left_' + name] = point(left); keypoints['right_' + name] = point(right);
  }
  // Preserve the chosen mannequin's shape and limb lengths; only pose its joints.
  if (!viewer.applyWorldKeypointImport(keypoints, { drawFigure: false, placeHipRoots: false, normalizeLimbs: true, alignHands: false, alignFeet: false, dispatchPoseChange: false })) throw new Error('无法将识别结果应用到人偶');
  viewer.skinnedMesh.updateMatrixWorld(true); viewer.skeleton.update(); viewer.skinnedMesh.computeBoundingBox();
  viewer.updateMarkers(); viewer.updateIKEffectorPositions('all'); viewer.requestRender();
}
