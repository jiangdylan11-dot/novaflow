const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
const test = require('node:test')

const root = path.resolve(__dirname, '..', '..')
const {
  mp4CompressionPlan,
  mp4CompressOutputFileName,
  mp4CompressArgs,
  mp4AudioMode,
  parseMp4ProbeOutput,
  compressMp4
} = require('../main/mp4-compressor')
const {
  normalizeVideoFormat,
  normalizeScalePct,
  videoConvertOutputFileName,
  videoConvertScaleFilter,
  videoConvertArgs,
  convertVideoFormat
} = require('../main/video-format-converter')

test('the strength slider maps onto the JPG quality curve and x264 CRF', () => {
  // 32 is what the three 压缩 entries open on, and the JPG panel prints 76% there.
  assert.deepEqual(mp4CompressionPlan(32), { strength: 32, quality: 76, crf: 23, zone: 'safe' })
  assert.equal(mp4CompressionPlan(0).crf, 18)
  assert.equal(mp4CompressionPlan(100).crf, 34)
  assert.equal(mp4CompressionPlan(0).quality, 95)
  assert.equal(mp4CompressionPlan(100).quality, 35)
  // Monotone: a higher strength never returns a gentler encode.
  for (let level = 1; level <= 100; level += 1) {
    assert.ok(mp4CompressionPlan(level).crf >= mp4CompressionPlan(level - 1).crf)
    assert.ok(mp4CompressionPlan(level).quality <= mp4CompressionPlan(level - 1).quality)
  }
  assert.deepEqual(mp4CompressionPlan(-40), mp4CompressionPlan(0))
  assert.deepEqual(mp4CompressionPlan(400), mp4CompressionPlan(100))
  assert.equal(mp4CompressionPlan(56).zone, 'warning')
  assert.equal(mp4CompressionPlan(78).zone, 'danger')
})

test('compression keeps the source geometry out of the ffmpeg arguments', () => {
  const args = mp4CompressArgs({ inPath: 'in.mp4', outPath: 'out.mp4', crf: 23, audioMode: 'copy' })
  assert.ok(!args.includes('-vf'), 'compression must not scale or re-time the picture')
  assert.ok(!args.includes('-r'))
  assert.deepEqual(args.slice(-1), ['out.mp4'])
  assert.ok(args.includes('-movflags') && args.includes('+faststart'))
  assert.equal(args[args.indexOf('-crf') + 1], '23')
  const copied = mp4CompressArgs({ inPath: 'a', outPath: 'b', crf: 23, audioMode: 'copy' })
  assert.equal(copied[copied.indexOf('-c:a') + 1], 'copy')
  const encoded = mp4CompressArgs({ inPath: 'a', outPath: 'b', crf: 23, audioMode: 'encode' })
  assert.equal(encoded[encoded.indexOf('-c:a') + 1], 'aac')
  assert.equal(encoded[encoded.indexOf('-b:a') + 1], '128k')
  assert.ok(mp4CompressArgs({ inPath: 'a', outPath: 'b', crf: 23, audioMode: 'none' }).includes('-an'))
})

test('an AAC track is copied and anything else is re-encoded', () => {
  assert.equal(mp4AudioMode({ hasAudio: true, audioCodec: 'aac' }), 'copy')
  assert.equal(mp4AudioMode({ hasAudio: true, audioCodec: 'pcm_s16le' }), 'encode')
  assert.equal(mp4AudioMode({ hasAudio: false }), 'none')
  assert.equal(mp4AudioMode(null), 'none')
})

test('the probe reads geometry, duration and the audio codec', () => {
  const meta = parseMp4ProbeOutput(JSON.stringify({
    streams: [
      { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, avg_frame_rate: '30000/1001' },
      { codec_type: 'audio', codec_name: 'aac' }
    ],
    format: { duration: '12.5' }
  }))
  assert.equal(meta.width, 1920)
  assert.equal(meta.height, 1080)
  assert.ok(Math.abs(meta.fps - 29.97) < 0.01)
  assert.equal(meta.durationSec, 12.5)
  assert.equal(meta.hasAudio, true)
  assert.equal(meta.audioCodec, 'aac')
  assert.equal(parseMp4ProbeOutput(''), null)
  assert.equal(parseMp4ProbeOutput('not json'), null)
})

test('output names follow the native 压缩 / 转换 naming', () => {
  assert.equal(mp4CompressOutputFileName('打斗 A.mp4'), '打斗 A-compressed.mp4')
  assert.equal(videoConvertOutputFileName('clip.mov', 'webm'), 'clip.webm')
  assert.equal(videoConvertOutputFileName('clip.mov', 'gif'), 'clip.gif')
  assert.equal(videoConvertOutputFileName('', 'mp4'), 'video.mp4')
})

test('the format and scale inputs are clamped to what the encoders accept', () => {
  assert.equal(normalizeVideoFormat('WEBM'), 'webm')
  assert.equal(normalizeVideoFormat('mov'), 'mp4')
  assert.equal(normalizeVideoFormat(undefined), 'mp4')
  assert.equal(normalizeScalePct(0), 10)
  assert.equal(normalizeScalePct(9999), 200)
  assert.equal(normalizeScalePct(undefined), 100)
})

// 导出视频 already converts a video dropped on the board. This tool is that conversion moved into
// 工具, so the arguments have to stay the ones main.js sends -- not merely similar ones.
test('the tool builds the same ffmpeg conversion 导出视频 does', () => {
  const main = fs.readFileSync(path.join(root, 'particle-editor-desktop', 'main.js'), 'utf8')
  const start = main.indexOf('handleNovaFlowTempIpc("export-encode-video-to-video"')
  const handler = main.slice(start, main.indexOf('ipcMain.handle("cutout-trace-append"', start))
  assert.ok(start >= 0 && handler.length > 0)

  const scalePct = 100
  const expectedFilter = handler
    .match(/\? `(scale=max\(2\\\\,trunc\(iw\*\$\{scalePct\}\/200\)\*2\):max\(2\\\\,trunc\(ih\*\$\{scalePct\}\/200\)\*2\):flags=lanczos)`/)?.[1]
    .replaceAll('${scalePct}', String(scalePct))
    .replace(/\\\\/g, '\\')
  assert.equal(videoConvertScaleFilter(scalePct), expectedFilter)

  const gif = videoConvertArgs({ inPath: 'in.mov', outPath: 'out.gif', format: 'gif', scalePct })
  assert.ok(handler.includes('split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse=new=1'))
  assert.equal(gif[gif.indexOf('-filter_complex') + 1], `${expectedFilter},split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse=new=1`)
  assert.deepEqual([gif[gif.indexOf('-loop')], gif[gif.indexOf('-loop') + 1]], ['-loop', '0'])

  const webm = videoConvertArgs({ inPath: 'in.mov', outPath: 'out.webm', format: 'webm', scalePct })
  assert.ok(handler.includes('"-c:v", "libvpx-vp9"') && handler.includes('"-row-mt", "1", "-deadline", "good", "-cpu-used", "2"'))
  for (const flag of [['-c:v', 'libvpx-vp9'], ['-row-mt', '1'], ['-deadline', 'good'], ['-cpu-used', '2'], ['-b:v', '0'], ['-crf', '30'], ['-pix_fmt', 'yuv420p']]) {
    assert.equal(webm[webm.indexOf(flag[0]) + 1], flag[1], flag[0])
  }

  const mp4 = videoConvertArgs({ inPath: 'in.mov', outPath: 'out.mp4', format: 'mp4', scalePct })
  for (const flag of [['-c:v', 'libx264'], ['-pix_fmt', 'yuv420p'], ['-movflags', '+faststart'], ['-crf', '18']]) {
    assert.equal(mp4[mp4.indexOf(flag[0]) + 1], flag[1], flag[0])
  }
  // The board export re-times to a fixed fps; a source conversion must not.
  assert.ok(!mp4.some((arg) => String(arg).startsWith('fps=')))
})

// The argument builders above are only worth asserting on if ffmpeg accepts them and the result
// is the file the UI promises.
const ffmpegPath = path.join(root, 'particle-editor-desktop', 'node_modules', 'ffmpeg-static', 'ffmpeg.exe')
const ffprobePath = path.join(root, 'particle-editor-desktop', 'node_modules', 'ffprobe-static', 'bin', 'win32', 'x64', 'ffprobe.exe')
const haveFfmpeg = fs.existsSync(ffmpegPath) && fs.existsSync(ffprobePath)

const runCmd = (cmd, args, opts) => new Promise((resolve) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...(opts || {}) })
  resolve({ ok: r.status === 0, stdout: r.stdout || '', stderr: r.stderr || '' })
})

const deps = { fs, path, spawn, runCmd, ffmpegPath, ffprobePath }

const probe = (file, entries) => spawnSync(ffprobePath, [
  '-v', 'error', '-select_streams', 'v:0', '-show_entries', `stream=${entries}`, '-of', 'csv=p=0', file
], { encoding: 'utf8' }).stdout.trim()

function makeSource(dir, { size = '320x240', rate = 30, duration = 2, withAudio = true } = {}) {
  const src = path.join(dir, 'src.mp4')
  const args = ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=${rate}:duration=${duration}`]
  if (withAudio) args.push('-f', 'lavfi', '-i', `sine=frequency=440:duration=${duration}`, '-c:a', 'aac')
  // A deliberately fat source: CRF 5 leaves plenty for the tool's CRF 23 to take off.
  args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '5', '-pix_fmt', 'yuv420p', src)
  const made = spawnSync(ffmpegPath, args, { encoding: 'utf8' })
  assert.equal(made.status, 0, made.stderr)
  return src
}

test('MP4 压缩 shrinks a real file without touching its geometry', { skip: !haveFfmpeg }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-mp4-compress-'))
  try {
    const src = makeSource(dir, { size: '320x240', rate: 30, duration: 2 })
    const outDir = path.join(dir, 'out')
    const ticks = []
    const result = await compressMp4(
      { inputPath: src, fileName: 'src.mp4', strength: 32, outDir },
      { ...deps, onProgress: (ratio) => ticks.push(ratio) }
    )
    assert.equal(result.ok, true, result.error)
    assert.equal(result.keptOriginal, false)
    assert.equal(result.plan.crf, 23)
    assert.ok(result.bytesOut < result.bytesIn, `${result.bytesOut} >= ${result.bytesIn}`)
    assert.equal(probe(result.outPath, 'width,height,avg_frame_rate'), probe(src, 'width,height,avg_frame_rate'))
    // The AAC track survives the pass instead of being dropped or re-encoded.
    const audio = spawnSync(ffprobePath, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', result.outPath], { encoding: 'utf8' }).stdout.trim()
    assert.equal(audio, 'aac')
    assert.ok(ticks.length > 0, 'no progress was reported')
    assert.equal(ticks[ticks.length - 1], 1)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a clip that is already tighter keeps its own bytes', { skip: !haveFfmpeg }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-mp4-keep-'))
  try {
    // Already encoded far past what strength 0 (CRF 18) would do, so the pass can only add bytes.
    const src = path.join(dir, 'tiny.mp4')
    const made = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=30:duration=2',
      '-c:v', 'libx264', '-crf', '51', '-pix_fmt', 'yuv420p', src], { encoding: 'utf8' })
    assert.equal(made.status, 0, made.stderr)

    const result = await compressMp4(
      { inputPath: src, fileName: 'tiny.mp4', strength: 0, outDir: path.join(dir, 'out') },
      deps
    )
    assert.equal(result.ok, true, result.error)
    assert.equal(result.keptOriginal, true)
    assert.equal(result.outPath, src)
    assert.equal(result.bytesOut, result.bytesIn)
    assert.deepEqual(fs.readdirSync(path.join(dir, 'out')), [], 'the worse encode was left behind')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('视频格式转换 writes real MP4, WEBM and GIF files', { skip: !haveFfmpeg }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-video-convert-'))
  try {
    // 321x241 at 24fps: odd on both axes, and a frame rate the board never uses.
    const src = makeSource(dir, { size: '321x241', rate: 24, duration: 1, withAudio: false })
    const outDir = path.join(dir, 'out')

    for (const [format, codec] of [['mp4', 'h264'], ['webm', 'vp9'], ['gif', 'gif']]) {
      const result = await convertVideoFormat({ inputPath: src, fileName: 'src.mp4', format, scalePct: 100, outDir }, deps)
      assert.equal(result.ok, true, `${format}: ${result.error}`)
      assert.equal(result.format, format)
      assert.ok(result.fileName.endsWith(`.${format}`))
      assert.ok(fs.existsSync(result.outPath) && result.bytesOut > 0)
      // The odd source rounds down to an even size, keeping the aspect ratio and the frame rate.
      assert.equal(probe(result.outPath, 'codec_name,width,height'), `${codec},320,240`)
    }

    const half = await convertVideoFormat({ inputPath: src, fileName: 'src.mp4', format: 'mp4', scalePct: 50, outDir }, deps)
    assert.equal(half.ok, true, half.error)
    assert.equal(probe(half.outPath, 'width,height'), '160,120')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('both tools refuse a missing source instead of writing an empty result', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-video-missing-'))
  try {
    const gone = path.join(outDir, 'nope.mp4')
    assert.match((await compressMp4({ inputPath: gone, outDir }, deps)).error, /找不到原始视频文件/)
    assert.match((await convertVideoFormat({ inputPath: gone, outDir }, deps)).error, /找不到原始视频文件/)
    assert.deepEqual(fs.readdirSync(outDir), [])
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true })
  }
})

// Everything above hands the converters an outDir of its own, which is exactly how both tools
// could pass while the app failed: main built that directory under a temp category the session
// manager does not allow, so every run died with temp_category_not_allowed before ffmpeg was
// spawned. This runs main's own helper against the real manager.
function loadVideoToolWorkDirFactory(createWorkDir) {
  const source = fs.readFileSync(path.join(root, 'particle-editor-desktop', 'main.js'), 'utf8')
  const start = source.indexOf('function getNovaFlowVideoToolWorkDir(')
  assert.ok(start >= 0, 'main.js no longer defines getNovaFlowVideoToolWorkDir')
  const body = source.slice(start, source.indexOf('\n}', start) + 2)
  // eslint-disable-next-line no-new-func
  return new Function('fs', 'novaFlowVideoToolWorkDirs', 'createNovaFlowTempWorkDir', `${body}\nreturn getNovaFlowVideoToolWorkDir`)(fs, new Map(), createWorkDir)
}

test('the work dir main hands the video tools is one the session manager will create', async () => {
  const { createTempSessionLifecycle } = require('../main/temp-session-lifecycle')
  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-video-tool-workdir-'))
  const manager = createTempSessionLifecycle({
    storageRoot: path.join(testRoot, 'NovaFlow'),
    sessionId: 'video-tool-session',
    heartbeatIntervalMs: 60_000
  })
  try {
    await manager.register()
    const workDirFor = loadVideoToolWorkDirFactory((category, prefix) => manager.createWorkDir(category, prefix))
    const convertDir = workDirFor('video-convert')
    const compressDir = workDirFor('mp4-compress')

    assert.notEqual(convertDir, compressDir, 'clearing one tool must not take the other tool results with it')
    for (const dir of [convertDir, compressDir]) {
      assert.equal(fs.existsSync(dir), true, dir)
      assert.equal(manager.isRegisteredWorkDir(dir), true, `${dir} must be manager-created`)
      assert.equal(manager.isOwnedPath(dir, 'video'), true, `${dir} must stay in the video category`)
    }
    // A batch converts one file at a time, so the second call has to land in the first directory.
    assert.equal(workDirFor('video-convert'), convertDir)

    if (haveFfmpeg) {
      const src = makeSource(testRoot, { size: '320x240', rate: 24, duration: 1, withAudio: false })
      const result = await convertVideoFormat({ inputPath: src, fileName: 'change.mov', format: 'mp4', scalePct: 100, outDir: convertDir }, deps)
      assert.equal(result.ok, true, result.error)
      assert.equal(path.dirname(result.outPath), convertDir)
      assert.ok(fs.existsSync(result.outPath) && result.bytesOut > 0)
    }
  } finally {
    await manager.close()
    fs.rmSync(testRoot, { recursive: true, force: true })
  }
})
