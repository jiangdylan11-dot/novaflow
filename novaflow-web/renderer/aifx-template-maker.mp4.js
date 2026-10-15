// AI 特效 · 模板制作 —— 浏览器里出 MP4（WebCodecs H.264 + 手写 MP4 封装）。2026-10-15 接入正式链。
// 帧（RGBA）→ H.264 MP4：WebCodecs 编码 + 手写的最小 MP4 封装（ftyp / mdat / moov，一条视频轨）。
// 和内置模板同规格：yuv420p、24 fps（时间刻度 12288，每帧 512）。挂到 globalThis.NovaFlowFxMp4。

;(function (root) {
  'use strict'

  const TIMESCALE = 12288

  const u8 = (n) => new Uint8Array([n & 255])
  const u16 = (n) => new Uint8Array([(n >> 8) & 255, n & 255])
  const u32 = (n) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255])
  const i32 = (n) => u32(n >>> 0)
  const str = (s) => new Uint8Array([...s].map((c) => c.charCodeAt(0)))
  const zeros = (n) => new Uint8Array(n)
  function concat(parts) {
    let len = 0
    for (const p of parts) len += p.length
    const out = new Uint8Array(len)
    let o = 0
    for (const p of parts) { out.set(p, o); o += p.length }
    return out
  }
  const box = (type, ...parts) => { const body = concat(parts.flat()); return concat([u32(body.length + 8), str(type), body]) }
  const full = (type, version, flags, ...parts) => box(type, u8(version), u8(flags >> 16), u16(flags & 0xffff), ...parts)
  const MATRIX = [u32(0x00010000), u32(0), u32(0), u32(0), u32(0x00010000), u32(0), u32(0), u32(0), u32(0x40000000)]

  /** samples: [{ data: Uint8Array（AVCC）, key: bool, cts: 时间刻度 }]，按解码顺序。 */
  function mux({ width, height, fps, avcC, samples }) {
    const delta = Math.round(TIMESCALE / fps)
    const n = samples.length, dur = n * delta
    const ftyp = box('ftyp', str('isom'), u32(0x200), str('isom'), str('iso2'), str('avc1'), str('mp41'))
    const offsets = samples.map((s, i) => s.cts - i * delta)
    const reorder = offsets.some((v) => v !== 0)
    const stbl = box('stbl',
      full('stsd', 0, 0, u32(1), box('avc1', zeros(6), u16(1), zeros(16), u16(width), u16(height), u32(0x00480000), u32(0x00480000), u32(0), u16(1),
        zeros(32), u16(0x18), u16(0xffff), box('avcC', avcC))),
      full('stts', 0, 0, u32(1), u32(n), u32(delta)),
      ...(reorder ? [full('ctts', 1, 0, u32(n), ...offsets.flatMap((v) => [u32(1), i32(v)]))] : []),
      full('stss', 0, 0, u32(samples.filter((s) => s.key).length), ...samples.flatMap((s, i) => (s.key ? [u32(i + 1)] : []))),
      full('stsc', 0, 0, u32(1), u32(1), u32(n), u32(1)),
      full('stsz', 0, 0, u32(0), u32(n), ...samples.map((s) => u32(s.data.length))),
      full('stco', 0, 0, u32(1), u32(0)))   // 块偏移最后回填
    const movieDur = Math.round((dur / TIMESCALE) * 1000)
    const trak = box('trak',
      full('tkhd', 0, 3, u32(0), u32(0), u32(1), u32(0), u32(movieDur), zeros(8), u16(0), u16(0), u16(0), u16(0), ...MATRIX, u32(width << 16), u32(height << 16)),
      box('mdia',
        full('mdhd', 0, 0, u32(0), u32(0), u32(TIMESCALE), u32(dur), u16(0x55c4), u16(0)),
        full('hdlr', 0, 0, u32(0), str('vide'), zeros(12), str('VideoHandler'), u8(0)),
        box('minf',
          full('vmhd', 0, 1, u16(0), u16(0), u16(0), u16(0)),
          box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1))),
          stbl)))
    const moov = box('moov', full('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(movieDur), u32(0x00010000), u16(0x0100), zeros(10), ...MATRIX, zeros(24), u32(2)), trak)
    const mdatBody = concat(samples.map((s) => s.data))
    const mdatHead = concat([u32(mdatBody.length + 8), str('mdat')])
    const out = concat([ftyp, moov, mdatHead, mdatBody])
    // stco 回填：mdat 数据从 ftyp + moov + 8 开始
    const dataStart = ftyp.length + moov.length + 8
    const stco = findBox(out, 'stco', ftyp.length)
    new DataView(out.buffer).setUint32(stco + 16, dataStart)
    return out
  }
  function findBox(buf, type, from) {
    const t = [...type].map((c) => c.charCodeAt(0))
    for (let i = from; i < buf.length - 4; i++) if (buf[i] === t[0] && buf[i + 1] === t[1] && buf[i + 2] === t[2] && buf[i + 3] === t[3]) return i - 4
    throw new Error('MP4 封装：找不到 ' + type)
  }

  const CODECS = ['avc1.640028', 'avc1.4d0028', 'avc1.42e028']
  async function pickConfig(width, height, fps) {
    if (typeof root.VideoEncoder !== 'function') return null
    const bitrate = Math.round(Math.min(16e6, Math.max(2e6, width * height * fps * 0.4)))
    for (const codec of CODECS) {
      const config = { codec, width, height, framerate: fps, bitrate, bitrateMode: 'variable', avc: { format: 'avc' }, latencyMode: 'quality' }
      try { if ((await root.VideoEncoder.isConfigSupported(config)).supported) return config } catch (_) {}
    }
    return null
  }

  async function supported(width, height, fps = 24) { return !!(await pickConfig(width, height, fps)) }

  /** frameAt(i) → RGBA（width × height）；返回 MP4 字节。 */
  async function encode({ width, height, fps = 24, count, frameAt, onProgress }) {
    const config = await pickConfig(width, height, fps)
    if (!config) throw new Error('当前浏览器不支持 H.264 编码')
    const samples = []
    let avcC = null, failure = null
    const enc = new root.VideoEncoder({
      output: (chunk, meta) => {
        if (meta && meta.decoderConfig && meta.decoderConfig.description && !avcC) {
          const d = meta.decoderConfig.description
          avcC = d instanceof ArrayBuffer ? new Uint8Array(d.slice(0)) : new Uint8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength))
        }
        const data = new Uint8Array(chunk.byteLength)
        chunk.copyTo(data)
        samples.push({ data, key: chunk.type === 'key', cts: Math.round((chunk.timestamp * TIMESCALE) / 1e6) })
      },
      error: (e) => { failure = e },
    })
    enc.configure(config)
    const yLen = width * height, cw = width >> 1, ch = height >> 1, cLen = cw * ch
    const yuv = new Uint8Array(yLen + cLen * 2)
    try {
      for (let i = 0; i < count; i++) {
        const rgba = await frameAt(i)
        for (let k = 0, j = 0; k < yLen; k++, j += 4) yuv[k] = ((66 * rgba[j] + 129 * rgba[j + 1] + 25 * rgba[j + 2] + 128) >> 8) + 16
        for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
          const a = ((2 * y) * width + 2 * x) * 4, b = a + 4, c = a + width * 4, d = c + 4
          const r = (rgba[a] + rgba[b] + rgba[c] + rgba[d] + 2) >> 2
          const g = (rgba[a + 1] + rgba[b + 1] + rgba[c + 1] + rgba[d + 1] + 2) >> 2
          const bl = (rgba[a + 2] + rgba[b + 2] + rgba[c + 2] + rgba[d + 2] + 2) >> 2
          yuv[yLen + y * cw + x] = ((-38 * r - 74 * g + 112 * bl + 128) >> 8) + 128
          yuv[yLen + cLen + y * cw + x] = ((112 * r - 94 * g - 18 * bl + 128) >> 8) + 128
        }
        const frame = new root.VideoFrame(yuv, { format: 'I420', codedWidth: width, codedHeight: height, timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) })
        enc.encode(frame, { keyFrame: i % 24 === 0 })
        frame.close()
        while (enc.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 1))
        if (failure) throw failure
        if (onProgress) onProgress(i + 1, count)
      }
      await enc.flush()
      if (failure) throw failure
    } finally {
      try { enc.close() } catch (_) {}
    }
    if (!avcC) throw new Error('编码器没有给出 avcC')
    if (samples.length !== count) throw new Error('编码器少输出了帧：' + samples.length + '/' + count)
    return mux({ width, height, fps, avcC, samples })
  }

  root.NovaFlowFxMp4 = { supported, encode, mux }
})(typeof self !== 'undefined' ? self : globalThis)
