"""Sample corresponding source/output timestamps for model capability review."""
import cv2
import json
import sys
from pathlib import Path

case_dir = Path(sys.argv[1])
graph = json.loads((case_dir / 'workflow.json').read_text(encoding='utf-8'))
history = json.loads((case_dir / 'history.json').read_text(encoding='utf-8'))
source = next(n['inputs']['file'] for n in graph.values() if n['class_type'] == 'LoadVideo')
source = Path('C:/ProgramData/NovaFlow/AI-Runtime-H3/generated/input') / source
output = next(v for n in history['outputs'].values() for values in n.values() if isinstance(values, list) for v in values if isinstance(v, dict) and v.get('filename', '').endswith('.mp4'))
target = Path('C:/ProgramData/NovaFlow/AI-Runtime-H3/generated/output') / output.get('subfolder', '') / output['filename']
paths = [source, target]
records = []
rows = []
for p in paths:
    cap = cv2.VideoCapture(str(p))
    fps = cap.get(cv2.CAP_PROP_FPS)
    count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = min(4, (count - 1) / fps)
    samples = [round(t * duration * fps / 6) for t in range(7)]
    tiles = []
    for idx in samples:
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ok, frame = cap.read()
        if not ok:
            raise RuntimeError(f'Missing frame {idx} in {p}')
        w, h = frame.shape[1], frame.shape[0]
        tile = cv2.resize(frame, (int(320 * w / h), 320))
        tile = cv2.copyMakeBorder(tile, 26, 0, 0, 0, cv2.BORDER_CONSTANT, value=(35, 35, 35))
        cv2.putText(tile, f'{idx/fps:.2f}s / {idx}', (6, 18), cv2.FONT_HERSHEY_SIMPLEX, .45, (255, 255, 255), 1)
        tiles.append(tile)
    rows.append(cv2.hconcat(tiles))
    records.append({'path': str(p), 'fps': fps, 'frames': count, 'sample_indices': samples})
    cap.release()
width = max(r.shape[1] for r in rows)
rows = [cv2.copyMakeBorder(r, 0, 0, 0, width-r.shape[1], cv2.BORDER_CONSTANT, value=(35,35,35)) for r in rows]
cv2.imwrite(str(case_dir / 'comparison.jpg'), cv2.vconcat(rows))
(case_dir / 'media.json').write_text(json.dumps(records, indent=2), encoding='utf-8')
print(json.dumps(records))
