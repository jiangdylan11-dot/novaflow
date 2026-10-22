/* MediaPipe runs entirely inside this worker; no image is uploaded. */
self.exports = {};
importScripts(new URL('./vendor/mediapipe/vision_bundle.js', self.location.href).href);
let detector, math;
self.onmessage = async ({ data: { id, image } }) => {
  try {
    if (!detector) {
      self.postMessage({ id, progress: '正在载入本地姿势识别模型…' });
      const { FilesetResolver, PoseLandmarker } = self.exports;
      const parts = await Promise.all([1, 2].map(async n => {
        const response = await fetch(new URL(`./vendor/mediapipe/pose_landmarker_heavy.part${n}.bin`, self.location.href));
        if (!response.ok) throw new Error('高精度姿势模型载入失败，请刷新后重试');
        return new Uint8Array(await response.arrayBuffer());
      }));
      const model = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
      let offset = 0; for (const part of parts) { model.set(part, offset); offset += part.length; }
      detector = await PoseLandmarker.createFromOptions(
        await FilesetResolver.forVisionTasks(new URL('./vendor/mediapipe/wasm', self.location.href).href),
        { baseOptions: { modelAssetBuffer: model, delegate: 'CPU' }, canvas: new OffscreenCanvas(1, 1), runningMode: 'IMAGE', numPoses: 16, minPoseDetectionConfidence: 0.35, minPosePresenceConfidence: 0.35, outputSegmentationMasks: false }
      );
    }
    math ||= await import(new URL('./pose-reference-image-math.js', self.location.href).href);
    const passes = [], aspect = image.width / image.height;
    function detect(rotation, crop = { x: 0, y: 0, width: 1, height: 1 }) {
      const width = Math.round(image.width * crop.width), height = Math.round(image.height * crop.height), swapped = rotation % 180 !== 0;
      const canvas = new OffscreenCanvas(swapped ? height : width, swapped ? width : height);
      const ctx = canvas.getContext('2d');
      ctx.translate(canvas.width / 2, canvas.height / 2); ctx.rotate(rotation * Math.PI / 180);
      ctx.drawImage(image, image.width * crop.x, image.height * crop.y, width, height, -width / 2, -height / 2, width, height);
      const result = detector.detect(canvas);
      passes.push(math.remapPoseResult(result, { rotation, crop, aspect, pass: passes.length }));
      result.close(); canvas.width = canvas.height = 1;
    }
    for (const angle of [0, 90, 180, 270]) {
      self.postMessage({ id, progress: `高精度识别：正在检查 ${angle}° 方向…` }); detect(angle);
    }
    let merged = math.mergePoseCandidates(passes);
    if (!merged.landmarks.length || aspect > 2.5 || aspect < 0.4) {
      self.postMessage({ id, progress: '正在放大分区，补检较小或被遮挡的人物…' });
      for (const x of [0, 0.35]) for (const y of [0, 0.35]) detect(0, { x, y, width: 0.65, height: 0.65 });
      merged = math.mergePoseCandidates(passes);
    }
    self.postMessage({ id, result: { ...merged, imageAspect: aspect } });
  } catch (error) {
    self.postMessage({ id, error: error.message || '图片姿势识别失败' });
    detector?.close(); detector = null;
  } finally { image?.close(); }
};
