const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const test = require('node:test')

const root = path.resolve(__dirname, '..', '..')
const bundle = fs.readFileSync(path.join(root, 'particle-editor', 'assets', 'index-BbIa-2NM.js'), 'utf8')
const main = fs.readFileSync(path.join(root, 'particle-editor-desktop', 'main.js'), 'utf8')

const exportVideoBody = (() => {
  const start = bundle.indexOf('Ue=async()=>{let e=window.electronAPI;')
  assert.ok(start >= 0, 'exportVideo not found in the runtime bundle')
  const end = bundle.indexOf('},We=async()=>{', start)
  assert.ok(end > start)
  return bundle.slice(start, end)
})()

test('a video on the board is handed to ffmpeg before the canvas frame dump', () => {
  const convert = exportVideoBody.indexOf('sourceConvert:!0')
  const frameDump = exportVideoBody.indexOf('ai-sequence-source-video-fallback')
  assert.ok(convert > 0, 'the source-video conversion call is missing')
  assert.ok(frameDump > 0, 'the frame-by-frame fallback is missing')
  // 先转码，再退到逐帧画布：反了就回到了 Chromium 解不了码就报「读取视频失败」。
  assert.ok(convert < frameDump)
  assert.match(exportVideoBody, /kind:`ai-sequence-source-video-convert`/)
})

test('the conversion reads the dropped file off disk and only copies bytes as a fallback', () => {
  assert.match(exportVideoBody, /let nfConvertSrc=String\(d\?\.sourcePath\|\|``\)\.trim\(\)/)
  assert.match(exportVideoBody, /if\(!nfConvertSrc\)try\{let nfBlob=await fetch\(c\)/)
  assert.match(exportVideoBody, /fileName:nfName,bytes:new Uint8Array\(await nfBlob\.arrayBuffer\(\)\)/)
  // 源文件后缀要带上，ffmpeg 靠它认容器。
  assert.match(exportVideoBody, /nfName=`nf_convert_src\$\{nfExt\}`/)
})

test('the board remembers where a dropped video lives', () => {
  assert.match(bundle, /let c=null,nfLocalSourcePath=``;/)
  assert.match(bundle, /r=t\?String\(a\?\.getPathForFile\?\.\(t\)\|\|t\?\.path\|\|``\):``/)
  assert.match(bundle, /sourceFrames:n\?\.sourceFrames,sourcePath:nfLocalSourcePath\|\|void 0\}\)/)
})

test('the export dialog scale is what drives the converted size', () => {
  assert.match(exportVideoBody, /scalePct:Math\.max\(10,Math\.min\(200,Math\.round\(ie\)\)\)/)
})

test('sourceConvert keeps the source resolution and frame rate', () => {
  const start = main.indexOf('handleNovaFlowTempIpc("export-encode-video-to-video"')
  const end = main.indexOf('ipcMain.handle("cutout-trace-append"', start)
  assert.ok(start >= 0 && end > start)
  const handler = main.slice(start, end)
  assert.match(handler, /const sourceConvert = !!payload\?\.sourceConvert;/)
  // 百分比走解码后的画面 iw\/ih，所以手机竖拍的旋转也能跟着走。
  assert.match(handler, /scale=max\(2\\\\,trunc\(iw\*\$\{scalePct\}\/200\)\*2\):max\(2\\\\,trunc\(ih\*\$\{scalePct\}\/200\)\*2\):flags=lanczos/)
  assert.match(handler, /const vf = sourceConvert \? scaleFilter : `fps=\$\{fps\},\$\{scaleFilter\}`;/)
  assert.match(handler, /sourceConvert \? \["-row-mt", "1", "-deadline", "good", "-cpu-used", "2"\] : \[\]/)
})

test('the existing board exports keep their fixed canvas and frame rate', () => {
  const start = main.indexOf('handleNovaFlowTempIpc("export-encode-video-to-video"')
  const handler = main.slice(start, main.indexOf('ipcMain.handle("cutout-trace-append"', start))
  assert.match(handler, /: `scale=\$\{w\}:\$\{h\}:flags=lanczos`/)
  // 去背导出传的是 keepAlpha，不能被新分支掩掉。
  assert.match(handler, /"-pix_fmt", keepAlpha \? "yuva420p" : "yuv420p"/)
})

// The argument builder above is only worth asserting on if ffmpeg actually accepts it.
const ffmpegPath = path.join(root, 'particle-editor-desktop', 'node_modules', 'ffmpeg-static', 'ffmpeg.exe')
const ffprobePath = path.join(root, 'particle-editor-desktop', 'node_modules', 'ffprobe-static', 'bin', 'win32', 'x64', 'ffprobe.exe')
const haveFfmpeg = fs.existsSync(ffmpegPath) && fs.existsSync(ffprobePath)

test('ffmpeg converts a source video without resizing it to the board', { skip: !haveFfmpeg }, () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'nf-convert-'))
  try {
    const src = path.join(dir, 'src.mp4')
    // 641x361 at 24fps: odd on both axes, and a frame rate the board never uses.
    const made = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=641x361:rate=24:duration=1',
      '-c:v', 'libx264', '-pix_fmt', 'yuv444p', src], { encoding: 'utf8' })
    assert.equal(made.status, 0, made.stderr)

    const out = path.join(dir, 'out.mp4')
    const scalePct = 100
    const scaleFilter = `scale=max(2\\,trunc(iw*${scalePct}/200)*2):max(2\\,trunc(ih*${scalePct}/200)*2):flags=lanczos`
    const run = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-i', src,
      '-vf', scaleFilter, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      '-crf', '18', out], { encoding: 'utf8', cwd: dir })
    assert.equal(run.status, 0, run.stderr)

    const probe = spawnSync(ffprobePath, ['-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,avg_frame_rate', '-of', 'csv=p=0', out], { encoding: 'utf8' })
    assert.equal(probe.stdout.trim(), '640,360,24/1')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
