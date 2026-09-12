"""Collect execution timestamps and independently inspect generated audio/video files."""
import json
import subprocess
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[2]
runtime = Path(r'C:\ProgramData\NovaFlow\AI-Runtime-H3')
evidence = runtime / 'generated/lightx-acceptance'
ffprobe = root / 'particle-editor-desktop/node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe'
entries = []

def collect(name, pid, history):
    if history['status']['status_str'] != 'success':
        raise RuntimeError('Failed execution: ' + name)
    events = dict(history['status']['messages'])
    seconds = (events['execution_success']['timestamp'] - events['execution_start']['timestamp']) / 1000
    for node in history['outputs'].values():
        for output in node.get('images', []):
            file = runtime / 'generated/output' / output['subfolder'] / output['filename']
            probe = json.loads(subprocess.check_output([str(ffprobe), '-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,r_frame_rate,duration,nb_frames', '-of', 'json', str(file)]))
            kinds = {s['codec_type'] for s in probe['streams']}
            if not {'video', 'audio'} <= kinds:
                raise RuntimeError('Missing audio/video stream: ' + str(file))
            entries.append({'case': name, 'prompt_id': pid, 'execution_seconds': seconds, 'cached_nodes': events.get('execution_cached', {}).get('nodes', []), 'file': str(file), **probe})

for result in sorted(evidence.glob('*.result.json')):
    data = json.loads(result.read_text(encoding='utf-8-sig'))
    if 'history' not in data:
        raise RuntimeError('Execution unfinished: ' + str(result))
    collect(result.stem.removesuffix('.result'), data['prompt_id'], data['history'])
ui = json.loads((evidence / 'ui-5sec-history.json').read_text(encoding='utf-8-sig'))
for pid, history in ui.items():
    collect('ui-5sec', pid, history)
(evidence / 'media-report.json').write_text(json.dumps(entries, indent=2), encoding='utf-8')
for entry in entries:
    video = next(s for s in entry['streams'] if s['codec_type'] == 'video')
    print(f"{entry['case']}: {entry['execution_seconds']:.2f}s -> {video['width']}x{video['height']}, {video['duration']}s, audio+video verified")

ffmpeg = root / 'particle-editor-desktop/node_modules/ffmpeg-static/ffmpeg.exe'
visual_cases = [entry for entry in entries if entry['case'].startswith('lightx-') and not entry['case'].endswith('warm')] + [entry for entry in entries if entry['case'] == 'ui-5sec']
sheet = Image.new('RGB', (640, 210 * len(visual_cases)), '#202020')
draw = ImageDraw.Draw(sheet)
for row, entry in enumerate(visual_cases):
    video = next(s for s in entry['streams'] if s['codec_type'] == 'video')
    draw.text((8, row * 210 + 4), entry['case'], fill='white')
    for col, timestamp in enumerate([0, max(0, float(video['duration']) - 0.15)]):
        output = evidence / f"{entry['case']}-{col}.png"
        subprocess.run([str(ffmpeg), '-hide_banner', '-loglevel', 'error', '-y', '-ss', str(timestamp), '-i', entry['file'], '-frames:v', '1', str(output)], check=True)
        with Image.open(output) as original:
            frame = original.convert('RGB')
            frame.thumbnail((312, 180))
            sheet.paste(frame, (col * 320 + (320-frame.width)//2, row * 210 + 25))
sheet.save(evidence / 'first-last-contact-sheet.jpg')
