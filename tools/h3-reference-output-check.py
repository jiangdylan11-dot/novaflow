"""Inspect actual H3 output frames and verify copied soundtrack after muxing."""
import json
import wave
from pathlib import Path
import av
import numpy as np
from PIL import Image
from scipy.signal import correlate, correlation_lags

root = Path(__file__).resolve().parents[1]
out = root / 'docs/h3-multireference-20260914'
generated = Path('C:/ProgramData/NovaFlow/AI-Runtime-H3/generated')
history = json.loads((out / 'audio-history.json').read_text(encoding='utf8'))
saved = next(value['images'][0] for value in history['outputs'].values() if value.get('images'))
video = generated / 'output' / saved['subfolder'] / saved['filename']
frames = list(av.open(str(video)).decode(video=0))
sheet = Image.new('RGB', (1280, 256))
for index, frame_index in enumerate([0, 18, 36, 54, 72]):
    sheet.paste(frames[min(frame_index, len(frames)-1)].to_image().resize((256, 256)), (index*256, 0))
sheet.save(out / 'coin-local-audio.jpg')
resampler = av.AudioResampler(format='fltp', layout='mono', rate=48000)
chunks = []
for frame in av.open(str(video)).decode(audio=0):
    chunks.extend(item.to_ndarray().flatten() for item in resampler.resample(frame))
chunks.extend(item.to_ndarray().flatten() for item in resampler.resample(None))
actual = np.concatenate(chunks)
with wave.open(str(generated / 'input/novaflow_h3_audio_acceptance.wav')) as source:
    expected = np.frombuffer(source.readframes(source.getnframes()), dtype='<i2') / 32768.
cross = correlate(actual, expected, method='fft')
lags = correlation_lags(len(actual), len(expected))
eligible = np.abs(lags) < 2048
lag = int(lags[eligible][np.argmax(cross[eligible])])
left, right = max(0, lag), max(0, -lag)
length = min(len(actual)-left, len(expected)-right)
correlation = float(np.corrcoef(actual[left:left+length], expected[right:right+length])[0, 1])
report = {'video': str(video), 'frames': len(frames), 'audioSamples': len(actual),
          'inputSamples': len(expected), 'sampleRate': 48000, 'alignmentLagSamples': lag,
          'waveformCorrelation': correlation, 'copiedSoundtrackPassed': correlation > .99}
(out / 'audio-verification.json').write_text(json.dumps(report, indent=2), encoding='utf8')
print(json.dumps(report))
assert correlation > .99, 'The output does not preserve the supplied soundtrack'
