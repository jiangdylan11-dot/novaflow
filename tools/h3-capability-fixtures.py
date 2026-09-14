import base64
import cv2
import json
from pathlib import Path

out = Path('docs/h3-capability-20260915/assistant')
cases = {
    'color': ('docs/cutout-key-parity-20260914/athena/backend/job-C6YUDk/src_green-screen.mp4', 4, '视频里这个人的白色裙子改成红色就好，裙子款式、人物、动作和背景都别变。'),
    'outfit': ('docs/cutout-key-parity-20260914/athena/backend/job-C6YUDk/src_green-screen.mp4', 4, '给视频中的人物换成深蓝色长袖牛仔外套和长裤，脸、头发、动作和背景保持原样。'),
    'ice': ('docs/cutout-key-parity-20260914/blue/backend/job-sg5Pmq/src_green-screen.mp4', 3, '把视频里的金色金币树和金币粒子特效改成冰晶主题，保留生长、飘落的动作路径和节奏，原背景不变。'),
}
for name, (source, duration, prompt) in cases.items():
    folder = out / name
    folder.mkdir(parents=True, exist_ok=True)
    filename = 'novaflow_capability_' + name + '_source.mp4'
    current = {'modelId': 'minimax_h3_local', 'mode': 'multi_reference', 'durationSeconds': duration, 'prompt': prompt, 'resources': [{'key': 'multi_ref_video_1', 'kind': 'video', 'identity': filename, 'fileName': filename, 'occupied': True, 'mimeType': 'video/mp4'}]}
    (folder / 'input.json').write_text(json.dumps(current, ensure_ascii=False), encoding='utf-8')
    cap = cv2.VideoCapture(source)
    fps = cap.get(cv2.CAP_PROP_FPS)
    frames = []
    for i in range(7):
        time = i * duration / 6
        cap.set(cv2.CAP_PROP_POS_FRAMES, round(time * fps))
        ok, frame = cap.read()
        if not ok:
            raise RuntimeError(source)
        h, w = frame.shape[:2]
        frame = cv2.resize(frame, (round(w * min(1, 640/max(w, h))), round(h * min(1, 640/max(w, h)))))
        ok, encoded = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 86])
        frames.append({'label': '<Video 1>', 'timeSeconds': time, 'dataUrl': 'data:image/jpeg;base64,' + base64.b64encode(encoded).decode()})
    cap.release()
    (folder / 'frames.json').write_text(json.dumps(frames), encoding='utf-8')
    print(name, len(frames))
