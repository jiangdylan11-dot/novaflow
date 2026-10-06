// 视频合并 with transparent sources: the compositor must decode WebM alpha
// (ffmpeg's built-in VP8/VP9 decoders drop it, leaving a black background)
// and every alpha decode must clamp the lossy-alpha floor, so a cutout's
// transparent background comes out as 0, not 1-2, in merges and PNG frames.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(join(ROOT, 'renderer/novaflow-web-capabilities.js'), 'utf8');
const FLOOR = "lutrgb=a='if(lt(val,4),0,val)'";

function slice(startMarker, endMarker) {
  const start = src.indexOf(startMarker), end = src.indexOf(endMarker, start);
  assert.ok(start > 0 && end > start, 'markers present: ' + startMarker.slice(0, 40));
  return src.slice(start, end);
}

test('compositor decodes WebM alpha sources with libvpx and leaves mp4 sources alone', async () => {
  const body = slice('      for (let i = 0; i < stack.length; i += 1) {', "      const keepAlpha = format === 'webm';");
  const stack = [
    { source: { fileName: 'cutout.webm', blob: new Uint8Array(1), probe: { hasAlpha: true, codec: 'vp8' } } },
    { source: { fileName: 'clip.mp4', blob: new Uint8Array(1), probe: { hasAlpha: false, codec: 'h264' } } },
    { source: { fileName: 'desktop.webm', blob: new Uint8Array(1), probe: { hasAlpha: true, codec: 'vp9' } } },
  ];
  const args = [], scratch = [];
  const ffmpeg = { writeFile: async () => {} };
  const run = new Function('stack', 'args', 'scratch', 'ffmpeg', 'tag', 'fps', 'bytesOf', 'return (async () => { let inputs = 0;' + body + 'return inputs; })()');
  const inputs = await run(stack, args, scratch, ffmpeg, 'm_', 30, async b => b);
  assert.equal(inputs, 3);
  const joined = args.join(' ');
  assert.match(joined, /-c:v libvpx -i m_src0\.webm/, 'VP8 alpha source decoded with libvpx');
  assert.match(joined, /(^|\s)-i m_src1\.mp4/, 'mp4 source has plain input');
  assert.doesNotMatch(joined, /libvpx -i m_src1\.mp4/, 'mp4 source is not forced through libvpx');
  assert.match(joined, /-c:v libvpx-vp9 -i m_src2\.webm/, 'VP9 alpha source decoded with libvpx-vp9');
});

test('compositor clamps the alpha floor on alpha layers only', () => {
  const body = slice("      const keepAlpha = format === 'webm';", '      const run = async (withAudio)');
  const build = new Function('format', 'width', 'height', 'fps', 'duration', 'stack', 'manifest', 'evenSize', 'clampNumber', body + ';return filters');
  const layer = hasAlpha => ({ layerId: 'l', videoInput: 0, mask: null, source: { probe: { displayWidth: 16, displayHeight: 16, durationSec: 1, hasAlpha } }, transform: { centerX: 8, centerY: 8, scale: 1 } });
  const evenSize = v => Math.max(2, Math.round(v / 2) * 2), clampNumber = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const withAlpha = build('webm', 16, 16, 30, 1, [layer(true)], {}, evenSize, clampNumber).join(';');
  const opaque = build('webm', 16, 16, 30, 1, [layer(false)], {}, evenSize, clampNumber).join(';');
  assert.ok(withAlpha.includes('format=rgba,' + FLOOR + '[l0]'), 'alpha layer carries the floor');
  assert.ok(!opaque.includes('lutrgb'), 'opaque layer is untouched');
});

test('PNG frame decodes of alpha video clamp the floor', () => {
  assert.ok(src.includes("'-vf', 'format=rgba,' + ALPHA_FLOOR"), 'exportDecodeAlphaVideoFrames');
  assert.ok(src.includes("if (alpha) filters.push('format=rgba', ALPHA_FLOOR);"), 'frame extraction with alpha');
  assert.ok(src.includes('const ALPHA_FLOOR = "' + FLOOR + '"'), 'floor definition');
});
