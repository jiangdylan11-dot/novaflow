"""Compare decoded frames at the same timestamps; widths do not certify yaw."""
import json
import sys
from pathlib import Path
import av
import numpy as np
from PIL import Image, ImageDraw

reference, candidate, destination = sys.argv[1:4]
destination = Path(destination).resolve()
destination.mkdir(parents=True, exist_ok=True)
samples = np.linspace(0, 3, 13)
sheet = Image.new('RGB', (13 * 130, 2 * 150), '#202020')
draw = ImageDraw.Draw(sheet)
metrics = []
for row, filename in enumerate((reference, candidate)):
    with av.open(filename) as container:
        stream = container.streams.video[0]
        fps = float(stream.average_rate)
        decoded = [(float(f.time or 0), f.to_ndarray(format='rgb24')) for f in container.decode(video=0)]
    widths, crops = [], []
    for timestamp, frame in decoded:
        border = np.concatenate((frame[0], frame[-1], frame[:, 0], frame[:, -1])).astype(float)
        color = np.median(border, axis=0)
        flat = np.mean(np.max(abs(border-color), axis=-1) < 16) > .99
        mask = np.max(abs(frame.astype(float)-color), axis=-1) > 31
        yy, xx = np.where(mask)
        eligible = flat and len(xx) and mask.mean() < .6
        widths.append(float((xx.max()-xx.min()+1)/frame.shape[1]) if eligible else None)
        if eligible:
            x0, x1 = max(0, xx.min()-12), min(frame.shape[1], xx.max()+13)
            y0, y1 = max(0, yy.min()-12), min(frame.shape[0], yy.max()+13)
            frame = frame[y0:y1, x0:x1]
        crops.append(Image.fromarray(frame))
    indices = [min(range(len(decoded)), key=lambda i: abs(decoded[i][0]-t)) for t in samples]
    for col, i in enumerate(indices):
        im = crops[i].copy()
        im.thumbnail((126, 126))
        x, y = col*130, row*150
        sheet.paste(im, (x+(130-im.width)//2, y+20+(126-im.height)//2))
        draw.text((x+2, y+2), f'{decoded[i][0]:.2f}s / {i}', fill='white')
    metrics.append({'path': filename, 'fps': fps, 'frames': len(decoded), 'sample_indices': indices,
                    'foreground_widths': widths,
                    'note': 'Flat-background width is unsigned; it cannot establish rotation direction or angular velocity.'})
sheet.save(destination/'comparison.jpg', quality=95)
(destination/'measurements.json').write_text(json.dumps(metrics, indent=2), encoding='utf8')
print(destination/'comparison.jpg')
