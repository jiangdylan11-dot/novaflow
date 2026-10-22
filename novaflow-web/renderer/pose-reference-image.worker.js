/* MediaPipe runs entirely inside this worker; no image is uploaded. */
self.exports = {};
importScripts(new URL('./vendor/mediapipe/vision_bundle.js', self.location.href).href);
let detector;
self.onmessage = async ({ data: { id, image } }) => {
  try {
    if (!detector) {
      self.postMessage({ id, progress: '正在载入本地姿势识别模型…' });
      const { FilesetResolver, PoseLandmarker } = self.exports;
      detector = await PoseLandmarker.createFromOptions(
        await FilesetResolver.forVisionTasks(new URL('./vendor/mediapipe/wasm', self.location.href).href),
        { baseOptions: { modelAssetPath: new URL('./vendor/mediapipe/pose_landmarker_full.task', self.location.href).href, delegate: 'CPU' }, canvas: new OffscreenCanvas(1, 1), runningMode: 'IMAGE', numPoses: 16, minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, outputSegmentationMasks: false }
      );
    }
    self.postMessage({ id, progress: '正在识别图片中的人物…' });
    const result = detector.detect(image);
    self.postMessage({ id, result: { landmarks: result.landmarks, worldLandmarks: result.worldLandmarks } });
    result.close();
  } catch (error) {
    self.postMessage({ id, error: error.message || '图片姿势识别失败' });
    detector?.close(); detector = null;
  } finally { image?.close(); }
};
