// 色调跟随参考图: moves a style redraw's colours toward the style image, on the page, without
// another generation. Colour is matched per brightness band in CIELAB, so shadows take the
// reference's shadow colour and highlights its highlight colour; L only takes half the contrast
// difference, and skin moves half as far. Same maths as work/art-style-ab-20261105/tone2.py (S1).
(function (root) {
  const DEFAULT_STRENGTH = 0.5
  const MAX_STRENGTH = 0.8
  const BANDS = 6
  const REFERENCE_SIDE = 512
  const SKIN_BLUR_RADIUS = 12
  const WHITE = [0.95047, 1, 1.08883]
  const clamp01 = value => value < 0 ? 0 : value > 1 ? 1 : value

  const LINEAR = Float64Array.from({ length: 256 }, (_, byte) => { const v = byte / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) })
  // sRGB gamma as a table: this runs three times per pixel on every slider release.
  const GAMMA_STEPS = 16384
  const GAMMA = Float32Array.from({ length: GAMMA_STEPS + 1 }, (_, step) => { const v = step / GAMMA_STEPS; return (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255 })
  const curve = value => value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116
  const back = value => { const cube = value * value * value; return cube > 0.008856 ? cube : (value - 16 / 116) / 7.787 }
  const gamma = value => GAMMA[(clamp01(value) * GAMMA_STEPS + 0.5) | 0]

  function toLab(data, count, stride = 4) {
    const lab = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const r = LINEAR[data[i * stride]], g = LINEAR[data[i * stride + 1]], b = LINEAR[data[i * stride + 2]]
      const x = curve((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / WHITE[0])
      const y = curve(0.2126729 * r + 0.7151522 * g + 0.072175 * b)
      const z = curve((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / WHITE[2])
      lab[i * 3] = 116 * y - 16
      lab[i * 3 + 1] = 500 * (x - y)
      lab[i * 3 + 2] = 200 * (y - z)
    }
    return lab
  }

  function labToRgb(l, a, b, out, at) {
    const fy = (l + 16) / 116
    const x = back(fy + a / 500) * WHITE[0], y = back(fy), z = back(fy - b / 200) * WHITE[2]
    out[at] = gamma(3.2404542 * x - 1.5371385 * y - 0.4985314 * z)
    out[at + 1] = gamma(-0.969266 * x + 1.8760108 * y + 0.041556 * z)
    out[at + 2] = gamma(0.0556434 * x - 0.2040259 * y + 1.0572252 * z)
  }

  function quantiles(sorted) {
    return Array.from({ length: BANDS + 1 }, (_, index) => {
      const position = index / BANDS * (sorted.length - 1), low = Math.floor(position), high = Math.min(low + 1, sorted.length - 1)
      return sorted[low] + (sorted[high] - sorted[low]) * (position - low)
    })
  }

  // Mean and spread of a and b inside each brightness band, plus the overall brightness spread.
  function bandStats(lab, include) {
    const light = []
    for (let i = 0; i < lab.length / 3; i++) if (include(i)) light.push(lab[i * 3])
    if (light.length < BANDS * 2) return null
    const sorted = Float32Array.from(light).sort()
    const edges = quantiles(sorted)
    const sum = new Float64Array(BANDS * 2), square = new Float64Array(BANDS * 2), count = new Float64Array(BANDS)
    let lightSum = 0, lightSquare = 0
    for (let i = 0; i < lab.length / 3; i++) {
      if (!include(i)) continue
      const l = lab[i * 3]
      let band = BANDS - 1
      while (band > 0 && l < edges[band]) band--
      count[band]++; lightSum += l; lightSquare += l * l
      for (let c = 0; c < 2; c++) { const v = lab[i * 3 + 1 + c]; sum[band * 2 + c] += v; square[band * 2 + c] += v * v }
    }
    const mean = new Float64Array(BANDS * 2), spread = new Float64Array(BANDS * 2)
    for (let band = 0; band < BANDS; band++) for (let c = 0; c < 2; c++) {
      const n = Math.max(1, count[band]), m = sum[band * 2 + c] / n
      mean[band * 2 + c] = m
      spread[band * 2 + c] = Math.sqrt(Math.max(0, square[band * 2 + c] / n - m * m))
    }
    const lightMean = lightSum / light.length
    return { edges, mean, spread, lightMean, lightSpread: Math.sqrt(Math.max(0, lightSquare / light.length - lightMean * lightMean)) }
  }

  function boxBlur(values, width, height, radius) {
    const next = new Float32Array(values.length), size = radius * 2 + 1
    for (let y = 0; y < height; y++) {
      let sum = 0
      for (let x = -radius; x <= radius; x++) sum += values[y * width + Math.min(width - 1, Math.max(0, x))]
      for (let x = 0; x < width; x++) {
        next[y * width + x] = sum / size
        sum += values[y * width + Math.min(width - 1, x + radius + 1)] - values[y * width + Math.max(0, x - radius)]
      }
    }
    const out = new Float32Array(values.length)
    for (let x = 0; x < width; x++) {
      let sum = 0
      for (let y = -radius; y <= radius; y++) sum += next[Math.min(height - 1, Math.max(0, y)) * width + x]
      for (let y = 0; y < height; y++) {
        out[y * width + x] = sum / size
        sum += next[Math.min(height - 1, y + radius + 1) * width + x] - next[Math.max(0, y - radius) * width + x]
      }
    }
    return out
  }

  // 1 on skin, 0 elsewhere, feathered so the guard leaves no edge.
  function skinMask(data, width, height) {
    let mask = new Float32Array(width * height)
    for (let i = 0; i < mask.length; i++) {
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2]
      const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b, cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b
      mask[i] = cr >= 135 && cr <= 175 && cb >= 85 && cb <= 135 ? 1 : 0
    }
    const radius = Math.min(SKIN_BLUR_RADIUS, Math.max(0, Math.floor(Math.min(width, height) / 4)))
    if (radius) for (let pass = 0; pass < 3; pass++) mask = boxBlur(mask, width, height, radius)
    return mask
  }

  // image and reference are { data, width, height } with RGBA bytes. Returns new RGBA bytes.
  function matchTone(image, reference, strength = DEFAULT_STRENGTH, options = {}) {
    const count = image.width * image.height
    const out = new Uint8ClampedArray(image.data)
    const amountBase = Math.max(0, Math.min(1, Number(strength) || 0))
    if (!amountBase) return out
    const lab = toLab(image.data, count)
    const referenceLab = toLab(reference.data, reference.width * reference.height)
    const source = bandStats(lab, index => index % 7 === 0)
    const target = bandStats(referenceLab, index => referenceLab[index * 3] > 5 && referenceLab[index * 3] < 97)
    if (!source || !target) return out
    const all = bandStats(lab, () => true)
    const centres = Array.from({ length: BANDS }, (_, band) => (source.edges[band] + source.edges[band + 1]) / 2)
    const mask = options.skinGuard === false ? null : skinMask(image.data, image.width, image.height)
    const contrast = 1 + 0.5 * (target.lightSpread / Math.max(all.lightSpread, 1e-6) - 1)
    // Everything that depends only on brightness, tabulated at 0.1 L: mean from, mean to, ratio, for a and b.
    const steps = 1001, table = new Float32Array(steps * 6)
    for (let step = 0; step < steps; step++) {
      const l = step / 10
      let low = 0, mix = 0
      if (l >= centres[BANDS - 1]) { low = BANDS - 2; mix = 1 }
      else if (l > centres[0]) {
        while (low < BANDS - 2 && l >= centres[low + 1]) low++
        mix = (l - centres[low]) / Math.max(centres[low + 1] - centres[low], 1e-6)
      }
      for (let channel = 0; channel < 2; channel++) {
        const blend = values => values[low * 2 + channel] * (1 - mix) + values[(low + 1) * 2 + channel] * mix
        table[step * 6 + channel * 3] = blend(source.mean)
        table[step * 6 + channel * 3 + 1] = blend(target.mean)
        table[step * 6 + channel * 3 + 2] = Math.min(2, Math.max(0.5, blend(target.spread) / Math.max(blend(source.spread), 1e-6)))
      }
    }
    const pixel = new Float64Array(3)
    for (let i = 0; i < count; i++) {
      const l = lab[i * 3], a = lab[i * 3 + 1], b = lab[i * 3 + 2]
      const row = Math.min(steps - 1, Math.max(0, Math.round(l * 10))) * 6
      const amount = amountBase * (mask ? 1 - 0.5 * mask[i] : 1)
      const nextA = a + ((a - table[row]) * table[row + 2] + table[row + 1] - a) * amount
      const nextB = b + ((b - table[row + 3]) * table[row + 5] + table[row + 4] - b) * amount
      labToRgb(l + ((l - all.lightMean) * contrast + all.lightMean - l) * amount, nextA, nextB, pixel, 0)
      out[i * 4] = pixel[0]; out[i * 4 + 1] = pixel[1]; out[i * 4 + 2] = pixel[2]
    }
    return out
  }

  function decode(url) {
    return new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('图片解码失败'))
      image.src = url
    })
  }

  function pixels(image, width, height) {
    const canvas = document.createElement('canvas')
    canvas.width = width; canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    context.drawImage(image, 0, 0, width, height)
    return { canvas, context, frame: context.getImageData(0, 0, width, height) }
  }

  // The generated picture at full size, graded; a PNG data URL ready to replace the result.
  async function gradeDataUrl(sourceUrl, referenceUrl, strength = DEFAULT_STRENGTH) {
    if (!(Number(strength) > 0)) return sourceUrl
    const [source, reference] = await Promise.all([decode(sourceUrl), decode(referenceUrl)])
    const scale = Math.min(1, REFERENCE_SIDE / Math.max(reference.naturalWidth, reference.naturalHeight))
    const small = pixels(reference, Math.max(1, Math.round(reference.naturalWidth * scale)), Math.max(1, Math.round(reference.naturalHeight * scale)))
    const full = pixels(source, source.naturalWidth, source.naturalHeight)
    full.frame.data.set(matchTone(full.frame, small.frame, strength))
    full.context.putImageData(full.frame, 0, 0)
    return full.canvas.toDataURL('image/png')
  }

  const api = Object.freeze({ DEFAULT_STRENGTH, MAX_STRENGTH, matchTone, skinMask, gradeDataUrl })
  root.NovaFlowArtToneMatch = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof globalThis !== 'undefined' ? globalThis : this)
