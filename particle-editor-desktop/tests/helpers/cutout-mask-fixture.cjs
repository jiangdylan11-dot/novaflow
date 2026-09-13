const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

// These fixtures came from ffmpeg-decoded images. Browser timeline indices do
// not identify the same pixels at a frame boundary. Match the actual image
// sent to AI, as the real AI service does, before replaying its saved mask.
async function createMaskFixtureMatcher(sourceDirectory) {
  const names = fs.readdirSync(sourceDirectory).filter(n => /^frame_\d+\.png$/.test(n)).sort();
  if (!names.length) throw new Error('Cached AI masks require their source RGB frames');
  const thumbnail = bytes => sharp(bytes).resize(128, 128).removeAlpha().raw().toBuffer();
  const sources = [];
  for (const fileName of names) sources.push({
    fileName, sourceIndex: Number(fileName.match(/\d+/)[0]),
    pixels: await thumbnail(path.join(sourceDirectory, fileName))
  });
  const corner = [...sources[0].pixels.slice(0, 3)], key = corner.indexOf(Math.max(...corner));
  const channels = corner[key] - Math.max(...corner.filter((_, c) => c !== key)) > 50 ? [0, 1, 2].filter(c => c !== key) : [0, 1, 2];
  return async bytes => {
    const pixels = await thumbnail(Buffer.from(bytes));
    const candidates = sources.map(source => {
      let error = 0, rawError = 0; const colorFit = [];
      // Chromium and ffmpeg can use different YUV range/color conversions.
      // Compare foreground geometry in non-screen channels with a bounded
      // color calibration. This does not alter either image or its mask.
      for (const c of channels) {
        let s=0,t=0,ss=0,st=0; const count=pixels.length/3;
        for(let j=c;j<pixels.length;j+=3){const a=source.pixels[j],b=pixels[j];s+=a;t+=b;ss+=a*a;st+=a*b;rawError+=Math.abs(a-b);}
        const gain=Math.max(.65,Math.min(1.5,(st-s*t/count)/Math.max(1,ss-s*s/count))),offset=Math.max(-32,Math.min(32,(t-gain*s)/count));
        for(let j=c;j<pixels.length;j+=3)error+=Math.abs(pixels[j]-(gain*source.pixels[j]+offset));
        colorFit.push({channel:c,gain,offset});
      }
      const samples=pixels.length/3*channels.length;
      return { fileName: source.fileName, sourceIndex: source.sourceIndex, meanError:error/samples,rawMeanError:rawError/samples,colorFit };
    }).sort((a, b) => a.meanError - b.meanError);
    const best = candidates[0];
    if (best.meanError > 3) throw new Error(`No matching cached AI mask for captured RGB: nearest error=${best.meanError}`);
    return { ...best, runnerUp: candidates[1] || null };
  };
}
module.exports = { createMaskFixtureMatcher };
