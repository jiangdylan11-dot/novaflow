(function (root, factory) {
  const api = factory()
  root.NovaFlowGenerativeSplitWorkflow = api
  if (typeof module === 'object' && module.exports) module.exports = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const PROFILE_OPTIONS = Object.freeze([
    { id: 'turbo', label: 'Turbo · BF16', steps: 8 },
    { id: 'standard', label: '普通 · BF16', steps: 40 }
  ])

  function runtimeProfile(id) {
    if (id !== 'turbo' && id !== 'standard') throw new Error('未知的对象分离线路')
    return {
      unet: id === 'turbo' ? 'Qwen-Image-2.1-Turbo-BF16.gguf' : 'qwen-image-2.1-UC-BF16.gguf',
      clip: 'qwen3vl_8b_bf16_heretic.safetensors',
      vae: 'qwen_image_2.1_vae_bf16.safetensors'
    }
  }

  function promptForStage(stage, name, extraPrompt) {
    const target = String(name || '').trim().slice(0, 500) || 'the object identified by the green outlines in image 2'
    const extra = String(extraPrompt || '').trim().slice(0, 2000)
    const instruction = extra ? ` Additional instructions for this stage: ${extra}. Keep the required output format, placement and transparency.` : ''
    const references = 'Image 1 is the original. Image 2 is the same image with green outlines identifying the target visible parts. The green marks are a locator, not image content. '
    if (stage === 'background') return `${references} Remove ONLY the target (${target}) completely from image 1, including all visible fragments and its shadow. Reconstruct the background that it covered, without ghost outlines or residue. Match the surrounding original surface color, texture and illumination exactly. For flat artwork keep flat colors, without adding gradients, stains or lighting. Keep all other objects, foreground occluders, text, positions, perspective, style and lighting unchanged. Output the clean repaired scene. No target and no green marks.${instruction}`
    if (stage !== 'object') throw new Error('未知的对象分离阶段')
    return `${references} Extract ONLY the target (${target}). Foreground objects covering the target are separate occluders: REMOVE them completely and reconstruct the missing target parts behind them. Return one complete unobstructed target, not a cutout containing its occluders. Preserve the original target position, size, pose, perspective, colors, texture, material, illumination and visible details. The marks do not limit the completion area (不限制补全范围). Keep holes inside the target transparent. No occluders, ground, shadow, background, extra objects or green marks. This is an RGBA image with transparency. The image has alpha channel and the background is transparent.${instruction}`
  }

  function choices(info, node, key) {
    const spec = info[node]?.input?.required?.[key] || info[node]?.input?.optional?.[key]
    return Array.isArray(spec?.[0]) ? spec[0] : spec?.[1]?.options || []
  }

  function buildWorkflow(options) {
    const info = options.objectInfo || {}
    const profile = options.profile || 'turbo'
    const model = runtimeProfile(profile)
    const required = ['LoadImage', 'NovaFlowGGUFBF16Loader', 'CLIPLoader', 'VAELoader', 'TextEncodeQwenImage21', 'QwenImage21Cache', 'BasicGuider', 'RandomNoise', 'KSamplerSelect', 'SamplerCustomAdvanced', 'VAEDecode', 'SaveImage']
    required.push(profile === 'turbo' ? 'ManualSigmas' : 'BasicScheduler')
    for (const node of required) if (!info[node]) throw new Error(`对象分离缺少节点：${node}`)
    for (const [node, key, file] of [['NovaFlowGGUFBF16Loader', 'unet_name', model.unet], ['CLIPLoader', 'clip_name', model.clip], ['VAELoader', 'vae_name', model.vae]]) {
      if (!choices(info, node, key).includes(file)) throw new Error(`对象分离缺少模型：${file}`)
    }
    if (!options.imageName || !options.guideName) throw new Error('对象分离缺少画面或定位图')
    const seed = Number(options.seed)
    if (!Number.isSafeInteger(seed) || seed < 0) throw new Error('对象分离种子无效')
    const graph = {
      '1': { class_type: 'LoadImage', inputs: { image: options.imageName } },
      '2': { class_type: 'LoadImage', inputs: { image: options.guideName } },
      '3': { class_type: 'NovaFlowGGUFBF16Loader', inputs: { unet_name: model.unet } },
      '4': { class_type: 'CLIPLoader', inputs: { clip_name: model.clip, type: 'qwen_image', device: 'default' } },
      '5': { class_type: 'VAELoader', inputs: { vae_name: model.vae } },
      '6': { class_type: 'TextEncodeQwenImage21', inputs: { clip: ['4', 0], vae: ['5', 0], prompt: promptForStage(options.stage, options.objectName, options.prompt), negative_prompt: '', resolution: 0, 'images.image_1': ['1', 0], 'images.image_2': ['2', 0] } },
      '7': { class_type: 'QwenImage21Cache', inputs: { model: ['3', 0], device: 'cpu', dtype: 'default' } },
      '8': { class_type: 'BasicGuider', inputs: { model: ['7', 0], conditioning: ['6', 0] } },
      '9': { class_type: 'RandomNoise', inputs: { noise_seed: seed } },
      '10': { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } },
      '11': profile === 'turbo'
        ? { class_type: 'ManualSigmas', inputs: { sigmas: '1.0, 0.978453, 0.95418, 0.926626, 0.89508, 0.845148, 0.704534, 0.414568, 0' } }
        : { class_type: 'BasicScheduler', inputs: { model: ['7', 0], scheduler: 'simple', steps: 40, denoise: 1 } },
      '12': { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['9', 0], guider: ['8', 0], sampler: ['10', 0], sigmas: ['11', 0], latent_image: ['6', 2] } },
      '13': { class_type: 'VAEDecode', inputs: { samples: ['12', 0], vae: ['5', 0] } },
      '14': { class_type: 'SaveImage', inputs: { images: ['13', 0], filename_prefix: options.outputPrefix || 'NovaFlow_GenerativeSplit' } }
    }
    return graph
  }

  function planFrame(width, height, bounds, maxPixels = 1048576) {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) throw new Error('原图尺寸无效')
    if (!bounds || !['minX', 'minY', 'width', 'height', 'count'].every(key => Number.isFinite(bounds[key]))
      || bounds.minX < 0 || bounds.minY < 0 || bounds.width <= 0 || bounds.height <= 0 || bounds.count < 16
      || bounds.minX + bounds.width > width || bounds.minY + bounds.height > height) throw new Error('请先涂选要分离对象的可见部分')
    if (!Number.isFinite(maxPixels) || maxPixels < 1024) throw new Error('工作画布像素预算无效')
    const padding = Math.ceil(Math.max(96, Math.min(512, Math.max(bounds.width, bounds.height) * 0.5)))
    const x = Math.max(0, Math.floor(bounds.minX - padding))
    const y = Math.max(0, Math.floor(bounds.minY - padding))
    const cropWidth = Math.min(width, Math.ceil(bounds.minX + bounds.width + padding)) - x
    const cropHeight = Math.min(height, Math.ceil(bounds.minY + bounds.height + padding)) - y
    const paddedWidth = Math.ceil(cropWidth / 32) * 32
    const paddedHeight = Math.ceil(cropHeight / 32) * 32
    const scale = Math.min(1, Math.sqrt(maxPixels / (paddedWidth * paddedHeight)))
    let workingWidth = Math.max(32, Math.floor(paddedWidth * scale / 32) * 32)
    let workingHeight = Math.max(32, Math.floor(paddedHeight * scale / 32) * 32)
    if (workingWidth * workingHeight > maxPixels) {
      if (workingWidth >= workingHeight) workingWidth = Math.floor(maxPixels / workingHeight / 32) * 32
      else workingHeight = Math.floor(maxPixels / workingWidth / 32) * 32
    }
    return { x, y, width: cropWidth, height: cropHeight, paddedWidth, paddedHeight, workingWidth, workingHeight }
  }

  function canvas(width, height) {
    const result = document.createElement('canvas')
    result.width = width
    result.height = height
    return result
  }

  function prepareFrame(source, mask, frame) {
    const plate = canvas(frame.paddedWidth, frame.paddedHeight)
    const p = plate.getContext('2d', { willReadFrequently: true })
    p.fillStyle = '#fff'
    p.fillRect(0, 0, plate.width, plate.height)
    p.drawImage(source, frame.x, frame.y, frame.width, frame.height, 0, 0, frame.width, frame.height)
    const locator = canvas(frame.paddedWidth, frame.paddedHeight)
    const m = locator.getContext('2d', { willReadFrequently: true })
    m.fillStyle = '#000'
    m.fillRect(0, 0, locator.width, locator.height)
    m.drawImage(mask, frame.x, frame.y, frame.width, frame.height, 0, 0, frame.width, frame.height)
    const image = m.getImageData(0, 0, locator.width, locator.height)
    for (let i = 0; i < image.data.length; i += 4) {
      const value = Math.max(image.data[i], image.data[i + 1], image.data[i + 2]) * image.data[i + 3] / 255
      image.data[i] = image.data[i + 1] = image.data[i + 2] = value > 8 ? 255 : 0
      image.data[i + 3] = 255
    }
    m.putImageData(image, 0, 0)
    const workingPlate = canvas(frame.workingWidth, frame.workingHeight)
    workingPlate.getContext('2d').drawImage(plate, 0, 0, workingPlate.width, workingPlate.height)
    const workingMask = canvas(frame.workingWidth, frame.workingHeight)
    const wm = workingMask.getContext('2d')
    wm.imageSmoothingEnabled = false
    wm.drawImage(locator, 0, 0, workingMask.width, workingMask.height)
    const guide = canvas(frame.workingWidth, frame.workingHeight)
    const g = guide.getContext('2d')
    g.drawImage(workingPlate, 0, 0)
    const pixels = g.getImageData(0, 0, guide.width, guide.height)
    const marked = wm.getImageData(0, 0, guide.width, guide.height).data
    const grown = backgroundMask(workingMask, 4, 0).getContext('2d').getImageData(0, 0, guide.width, guide.height).data
    for (let i = 0; i < pixels.data.length; i += 4) if (grown[i] > 8 && marked[i] <= 8) {
      pixels.data[i] = 0; pixels.data[i + 1] = 255; pixels.data[i + 2] = 0; pixels.data[i + 3] = 255
    }
    g.putImageData(pixels, 0, 0)
    return { imageDataUrl: workingPlate.toDataURL('image/png'), maskDataUrl: workingMask.toDataURL('image/png'), guideDataUrl: guide.toDataURL('image/png') }
  }

  function restoreFrame(image, frame) {
    if (image.width !== frame.workingWidth || image.height !== frame.workingHeight) throw new Error('生成结果尺寸与工作画布不一致，未置入图层')
    const padded = canvas(frame.paddedWidth, frame.paddedHeight)
    padded.getContext('2d').drawImage(image, 0, 0, padded.width, padded.height)
    const crop = canvas(frame.width, frame.height)
    crop.getContext('2d').drawImage(padded, 0, 0)
    return crop
  }

  // Selection masks may be opaque black/white. Normal source-over dilation would
  // paint the black background over earlier white pixels and erase the selection.
  function backgroundMask(mask, grow = 6, blur = 4) {
    const result = canvas(mask.width, mask.height)
    const ctx = result.getContext('2d')
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, result.width, result.height)
    ctx.globalCompositeOperation = 'lighten'
    for (let y = -grow; y <= grow; y++) for (let x = -grow; x <= grow; x++) {
      if (x * x + y * y <= grow * grow) ctx.drawImage(mask, x, y)
    }
    const softened = canvas(mask.width, mask.height)
    const soft = softened.getContext('2d')
    soft.filter = `blur(${blur}px)`
    soft.drawImage(result, 0, 0)
    // Fully replace the painted core. Feather only the expanded outer rim;
    // fading inside the selection would blend the removed object back in.
    soft.filter = 'none'
    soft.globalCompositeOperation = 'lighten'
    soft.drawImage(mask, 0, 0)
    return softened
  }

  function validateObjectPixels(rgba, seed, width, height) {
    if (rgba.length !== width * height * 4 || seed.length !== rgba.length) throw new Error('对象检查尺寸不一致')
    let visible = 0, transparent = 0, overlap = 0, selected = 0
    for (let i = 0; i < rgba.length; i += 4) {
      if (rgba[i + 3] > 8) visible++
      if (rgba[i + 3] < 8) transparent++
      if (Math.max(seed[i], seed[i + 1], seed[i + 2]) * seed[i + 3] / 255 > 8) {
        selected++
        if (rgba[i + 3] > 8) overlap++
      }
    }
    if (visible < 16) throw new Error('生成对象为空，未置入图层')
    if (transparent < Math.max(16, width * height * 0.01)) throw new Error('生成结果没有真实透明背景，未置入图层')
    if (!selected || overlap / selected < 0.05) throw new Error('生成对象没有覆盖所选目标，未置入图层')
    return { visible, transparent, selected, overlapRatio: overlap / selected }
  }

  function blendBackgroundPixels(original, generated, mask) {
    if (original.length !== generated.length || original.length !== mask.length) throw new Error('底图合成尺寸不一致')
    const result = new Uint8ClampedArray(original)
    let changed = 0
    for (let i = 0; i < result.length; i += 4) {
      const weight = Math.max(mask[i], mask[i + 1], mask[i + 2]) * mask[i + 3] / 65025
      if (weight <= 0) continue
      const oldAlpha = original[i + 3] / 255, newAlpha = generated[i + 3] / 255
      const alpha = oldAlpha * (1 - weight) + newAlpha * weight
      for (let c = 0; c < 3; c++) result[i + c] = alpha > 0 ? (original[i + c] * oldAlpha * (1 - weight) + generated[i + c] * newAlpha * weight) / alpha : 0
      result[i + 3] = alpha * 255
      changed++
    }
    return { data: result, changed }
  }

  // Correct only proven flat surfaces: the decoded region must be smooth and
  // have distributed, nearly uniform ORIGINAL anchors outside the edit mask.
  // Textures, gradients, transparent surfaces and unanchored regions pass through.
  function harmonizeFlatBackgroundPixels(original, generated, mask, width, height) {
    const size = width * height
    if (!Number.isSafeInteger(size) || width < 1 || height < 1 || original.length !== size * 4 || generated.length !== original.length || mask.length !== original.length) throw new Error('底图色彩检查尺寸不一致')
    const output = new Uint8ClampedArray(generated), visited = new Uint8Array(size), queue = new Int32Array(size)
    const weight = i => Math.max(mask[i], mask[i + 1], mask[i + 2]) * mask[i + 3]
    let correctedPixels = 0, regions = 0
    for (let seed = 0; seed < size; seed++) {
      if (visited[seed]) continue
      visited[seed] = 1
      if (generated[seed * 4 + 3] !== 255) continue
      let head = 0, tail = 1, anchors = 0, edits = 0
      let minX = width, maxX = 0, minY = height, maxY = 0, ax0 = width, ax1 = 0, ay0 = height, ay1 = 0
      const sum = [0, 0, 0], square = [0, 0, 0], low = [255, 255, 255], high = [0, 0, 0]
      queue[0] = seed
      while (head < tail) {
        const p = queue[head++], i = p * 4, x = p % width, y = Math.floor(p / width)
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y)
        for (let c = 0; c < 3; c++) { low[c] = Math.min(low[c], generated[i + c]); high[c] = Math.max(high[c], generated[i + c]) }
        if (weight(i)) edits++
        else if (original[i + 3] === 255 && [0, 1, 2].every(c => Math.abs(original[i + c] - generated[i + c]) <= 24)) {
          anchors++; ax0 = Math.min(ax0, x); ax1 = Math.max(ax1, x); ay0 = Math.min(ay0, y); ay1 = Math.max(ay1, y)
          for (let c = 0; c < 3; c++) { sum[c] += original[i + c]; square[c] += original[i + c] ** 2 }
        }
        const visit = q => {
          const j = q * 4
          if (visited[q] || generated[j + 3] !== 255) return
          if (Math.abs(generated[j] - generated[i]) > 3 || Math.abs(generated[j + 1] - generated[i + 1]) > 3 || Math.abs(generated[j + 2] - generated[i + 2]) > 3) return
          visited[q] = 1; queue[tail++] = q
        }
        if (x) visit(p - 1); if (x + 1 < width) visit(p + 1)
        if (y) visit(p - width); if (y + 1 < height) visit(p + width)
      }
      if (!edits || tail < 256 || anchors < Math.max(64, tail * 0.02) || maxX - minX < 16 || maxY - minY < 16) continue
      if (ax1 - ax0 < (maxX - minX) * 0.6 || ay1 - ay0 < (maxY - minY) * 0.6) continue
      const mean = sum.map(v => v / anchors)
      if (mean.some((v, c) => square[c] / anchors - v * v > 0.2 || high[c] - low[c] > 24)) continue
      regions++
      for (let k = 0; k < tail; k++) {
        const i = queue[k] * 4
        if (!weight(i)) continue
        let changed = false
        for (let c = 0; c < 3; c++) { const value = Math.round(mean[c]); if (output[i + c] !== value) changed = true; output[i + c] = value }
        if (changed) correctedPixels++
      }
    }
    return { data: output, stats: { regions, correctedPixels } }
  }

  function composeBackground(source, generated, frame, mask) {
    const result = canvas(source.width, source.height)
    const ctx = result.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(source, 0, 0)
    const base = ctx.getImageData(frame.x, frame.y, frame.width, frame.height)
    const candidate = restoreFrame(generated, frame).getContext('2d').getImageData(0, 0, frame.width, frame.height)
    const gate = mask.getContext('2d').getImageData(frame.x, frame.y, frame.width, frame.height)
    const harmonized = harmonizeFlatBackgroundPixels(base.data, candidate.data, gate.data, frame.width, frame.height)
    const blended = blendBackgroundPixels(base.data, harmonized.data, gate.data)
    if (!blended.changed) throw new Error('底图修复范围为空')
    base.data.set(blended.data)
    ctx.putImageData(base, frame.x, frame.y)
    result.__generativeSplitBackgroundStats = harmonized.stats
    return result
  }

  function composeObject(source, generated, frame, mask) {
    const crop = restoreFrame(generated, frame)
    const pixels = crop.getContext('2d').getImageData(0, 0, crop.width, crop.height)
    const seed = mask.getContext('2d').getImageData(frame.x, frame.y, frame.width, frame.height)
    const stats = validateObjectPixels(pixels.data, seed.data, crop.width, crop.height)
    const result = canvas(source.width, source.height)
    result.getContext('2d').drawImage(crop, frame.x, frame.y)
    return { canvas: result, stats }
  }

  return Object.freeze({ profiles: PROFILE_OPTIONS, promptForStage, buildWorkflow, planFrame, prepareFrame, restoreFrame, backgroundMask, validateObjectPixels, blendBackgroundPixels, harmonizeFlatBackgroundPixels, composeBackground, composeObject })
})
