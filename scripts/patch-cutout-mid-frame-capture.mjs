// 视频抠图 frame capture (2026-10-14): every cutout (AI抠图 and 色键抠图) captures each frame by
// seeking the video to the frame's START time and accepting the frame whose presentation time
// (requestVideoFrameCallback mediaTime) is within 50 ms. A seek exactly on a frame boundary often
// shows the previous frame, and 50 ms is more than one frame (41.7 ms at 24 fps), so that frame
// passed: DivinePower.mp4 (24 fps) saved 39 of 117 frames as copies of the previous one and lost
// the originals (every third frame); spin.mp4 lost 2 of 22.
// Now the capture seeks to the middle of the frame and verifies the presented frame against the
// frame's start within less than half a frame; only if that cannot be verified does it fall back to
// the old seek, so no clip fails where it used to work.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const MARK = 'verifyTimeSec:r,verifyToleranceSec:';
const OPTIONS = '{strict:!0,requireRvfcVerified:!0,captureFrame:()=>Wr(h,g,_,!0),captureTailFrame:e===y.length-1,toleranceSec:T,frameSyncTimeoutMs:1500,ensureReadyTimeoutMs:5e3,seekTimeoutMs:5e3}';
const edits = [
  // Lt verifies against an optional frame start / tolerance instead of the seek target.
  ['v=nfArmVerifiedVideoFrame(e,s,c,l,typeof n?.captureFrame===`function`?n.captureFrame:null)',
    'v=nfArmVerifiedVideoFrame(e,n?.verifyTimeSec??s,n?.verifyToleranceSec??c,l,typeof n?.captureFrame===`function`?n.captureFrame:null)'],
  ['v=nfArmVerifiedVideoFrame(e,s,c,l,n.captureFrame);nfCaptureTail=!0;',
    'v=nfArmVerifiedVideoFrame(e,n?.verifyTimeSec??s,n?.verifyToleranceSec??c,l,n.captureFrame);nfCaptureTail=!0;'],
  // pe: seek to mid-frame, verify the frame start within 0.45 frame. The frame step comes from the
  // plan's times b (b[i] = i / fps); c is redeclared later in this loop block (TDZ). x = duration.
  ['i=await Lt(h,r,' + OPTIONS + ')',
    'i=await (async nfOptions=>{try{const nfStep=b.length>1?(b[b.length-1]-b[0])/(b.length-1):1/30;'
      + 'const nfHit=await Lt(h,Math.min(r+nfStep/2,Math.max(r,x-.001)),{...nfOptions,' + MARK + '.45*nfStep});'
      + 'if(nfHit?.capturedFrame?.canvas&&nfHit.frameCallbackVerified)return nfHit}catch{}return Lt(h,r,nfOptions)})(' + OPTIONS + ')'],
];

export function patchCutoutMidFrameCapture(source) {
  if (source.includes(MARK)) return source;
  for (const [before, after] of edits) {
    const at = source.indexOf(before);
    if (at < 0 || at !== source.lastIndexOf(before)) throw new Error('Mid-frame capture anchor missing or ambiguous: ' + before.slice(0, 100));
    source = source.replace(before, () => after);
  }
  return source;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = new URL('../novaflow-web/renderer/assets/index-BbIa-2NM.js', import.meta.url);
  const before = fs.readFileSync(file, 'utf8');
  const after = patchCutoutMidFrameCapture(before);
  if (after !== before) fs.writeFileSync(file, after, 'utf8');
  console.log(after === before ? 'already patched' : 'patched');
}
