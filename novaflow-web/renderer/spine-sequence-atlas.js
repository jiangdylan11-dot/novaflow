/* Streaming atlas packing shared by sequence exporters. No editor state is changed. */
(function (root) {
  'use strict';
  const defaults = Object.freeze({ maxWidth: 2048, maxHeight: 2048, trim: true, alphaThreshold: 0,
    paddingX: 2, paddingY: 2, duplicatePadding: true, bleed: true, premultiplyAlpha: false });
  const integer = (value, fallback, min, max) => Math.max(min, Math.min(max, Math.round(Number.isFinite(Number(value)) ? Number(value) : fallback)));
  function normalizeSettings(input = {}) {
    return { maxWidth: integer(input.maxWidth, 2048, 64, 4096), maxHeight: integer(input.maxHeight, 2048, 64, 4096),
      trim: input.trim !== false, alphaThreshold: integer(input.alphaThreshold, 0, 0, 254),
      paddingX: integer(input.paddingX, 2, 0, 32), paddingY: integer(input.paddingY, 2, 0, 32),
      duplicatePadding: input.duplicatePadding !== false, bleed: input.bleed !== false, premultiplyAlpha: input.premultiplyAlpha === true };
  }
  function safeName(value) {
    let name = String(value || '').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_').replace(/\.[a-z0-9]{1,8}$/i, '').replace(/[. ]+$/g, '').trim().slice(0, 80) || 'sequence';
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = '_' + name;
    return name;
  }
  const frameName = (base, index) => `${base}_${String(index).padStart(4, '0')}`;
  function trimBounds(rgba, width, height, settings) {
    if (!settings.trim) return { x: 0, y: 0, width, height, blank: false };
    let left = width, top = height, right = -1, bottom = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] <= settings.alphaThreshold) continue;
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
    return right < 0 ? { x: 0, y: 0, width: 1, height: 1, blank: true }
      : { x: left, y: top, width: right - left + 1, height: bottom - top + 1, blank: false };
  }
  // MaxRects, without rotation. Keep only one page of pixel data resident.
  function place(free, width, height) {
    let best = null, score = Infinity;
    for (const rect of free) {
      if (width > rect.width || height > rect.height) continue;
      const next = Math.min(rect.width - width, rect.height - height) * 8192 + Math.max(rect.width - width, rect.height - height);
      if (next < score) { best = { x: rect.x, y: rect.y, width, height }; score = next; }
    }
    if (!best) return null;
    const split = [];
    for (const rect of free) {
      if (best.x >= rect.x + rect.width || best.x + width <= rect.x || best.y >= rect.y + rect.height || best.y + height <= rect.y) { split.push(rect); continue; }
      if (best.x > rect.x) split.push({ ...rect, width: best.x - rect.x });
      if (best.x + width < rect.x + rect.width) split.push({ ...rect, x: best.x + width, width: rect.x + rect.width - best.x - width });
      if (best.y > rect.y) split.push({ ...rect, height: best.y - rect.y });
      if (best.y + height < rect.y + rect.height) split.push({ ...rect, y: best.y + height, height: rect.y + rect.height - best.y - height });
    }
    free.length = 0;
    split.forEach((rect, i) => {
      if (!split.some((other, j) => j !== i && (j < i || other.x !== rect.x || other.y !== rect.y || other.width !== rect.width || other.height !== rect.height) &&
        rect.x >= other.x && rect.y >= other.y && rect.x + rect.width <= other.x + other.width && rect.y + rect.height <= other.y + other.height)) free.push(rect);
    });
    return best;
  }
  function bleedPixels(pixels, width, height) {
    let known = new Uint8Array(width * height);
    for (let i = 0; i < known.length; i++) known[i] = pixels[i * 4 + 3] > 0 ? 1 : 0;
    for (let pass = 0; pass < 2; pass++) {
      const next = known.slice();
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (known[i]) continue;
        const neighbors = [x > 0 ? i - 1 : -1, x + 1 < width ? i + 1 : -1, y > 0 ? i - width : -1, y + 1 < height ? i + width : -1];
        const source = neighbors.find(n => n >= 0 && known[n]);
        if (source === undefined) continue;
        pixels[i * 4] = pixels[source * 4]; pixels[i * 4 + 1] = pixels[source * 4 + 1]; pixels[i * 4 + 2] = pixels[source * 4 + 2]; next[i] = 1;
      }
      known = next;
    }
  }
  const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
    let c = n; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0;
  });
  function chunk(type, data) {
    const result = new Uint8Array(data.length + 12), view = new DataView(result.buffer);
    view.setUint32(0, data.length); result.set(new TextEncoder().encode(type), 4); result.set(data, 8);
    let crc = 0xffffffff; for (let i = 4; i < result.length - 4; i++) crc = crcTable[(crc ^ result[i]) & 255] ^ (crc >>> 8);
    view.setUint32(result.length - 4, (crc ^ 0xffffffff) >>> 0); return result;
  }
  // Encode RGBA bytes directly: canvas PNG export would round premultiplied RGB.
  async function encodePng(rgba, width, height, premultiplyAlpha = false) {
    if (typeof CompressionStream !== 'function') throw new Error('当前环境不支持 PNG 图集编码，请更新浏览器或启动助手');
    const rows = new Uint8Array((width * 4 + 1) * height);
    for (let y = 0; y < height; y++) {
      const target = y * (width * 4 + 1) + 1;
      rows.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), target);
      if (premultiplyAlpha) for (let x = 0; x < width; x++) {
        const i = target + x * 4, alpha = rows[i + 3];
        for (let channel = 0; channel < 3; channel++) rows[i + channel] = Math.round(rows[i + channel] * alpha / 255);
      }
    }
    const compressed = new Uint8Array(await new Response(new Blob([rows]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
    const header = new Uint8Array(13), view = new DataView(header.buffer);
    view.setUint32(0, width); view.setUint32(4, height); header[8] = 8; header[9] = 6;
    return new Uint8Array(await new Blob([Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), chunk('IHDR', header), chunk('IDAT', compressed), chunk('IEND', new Uint8Array())]).arrayBuffer());
  }
  function makeAtlas(pages, settings, version = '4.1') {
    return pages.map(page => [page.fileName, `size: ${page.width},${page.height}`, 'format: RGBA8888', 'filter: Linear,Linear', 'repeat: none',
      ...(String(version).startsWith('3.8') ? [] : [`pma: ${settings.premultiplyAlpha}`]), ...page.regions.flatMap(region => [region.name, '  rotate: false', `  xy: ${region.x}, ${region.y}`,
        `  size: ${region.width}, ${region.height}`, `  orig: ${region.originalWidth}, ${region.originalHeight}`,
        `  offset: ${region.offsetX}, ${region.offsetY}`, '  index: -1']), ''].join('\n')).join('\n');
  }
  function makeSkeleton({ baseName, version = '4.1', frames, fps = 30, duration, loop = true, packed = false }) {
    const versions = { '3.8': '3.8.99', '4.0': '4.0.64', '4.1': '4.1.24', '4.2': '4.2.19' };
    const key = String(version).slice(0, 3);
    if (!versions[key]) throw new Error('不支持的 Spine 导出版本');
    const first = frames[0], native = key === '4.1' || key === '4.2', attachment = native ? `${baseName}_seq` : first.name;
    const attachments = native ? { [attachment]: { width: first.originalWidth, height: first.originalHeight, path: `${baseName}_`, sequence: { count: frames.length, start: 0, digits: 4, setup: 0 } } }
      : Object.fromEntries(frames.map(frame => [frame.name, { width: frame.originalWidth, height: frame.originalHeight }]));
    const seconds = Math.max(0.001, Number(duration) || frames.length / fps);
    const timeline = frames.map((frame, index) => ({ time: index / fps, name: frame.name }));
    if (loop) timeline.push({ time: seconds, name: first.name });
    return { skeleton: { spine: versions[key], fps, x: 0, y: 0, width: first.originalWidth, height: first.originalHeight, images: packed ? './' : 'images/', audio: '' },
      bones: [{ name: 'root' }, { name: 'bone', parent: 'root' }], slots: [{ name: 'slot', bone: 'bone', attachment, color: 'ffffffff' }],
      skins: [{ name: 'default', attachments: { slot: attachments } }], animations: { animation: native
        ? { attachments: { default: { slot: { [attachment]: { sequence: [{ time: 0, mode: loop ? 'loop' : 'once', index: 0, delay: 1 / fps }, { time: seconds, mode: 'hold', index: loop ? 0 : frames.length - 1, delay: 1 / fps }] } } } } }
        : { slots: { slot: { attachment: timeline } } } } };
  }
  function normalizeSkeleton(json, frames, packed) {
    const skeleton = typeof json === 'string' ? JSON.parse(json) : JSON.parse(JSON.stringify(json));
    skeleton.skeleton = { ...skeleton.skeleton, images: packed ? './' : 'images/' };
    if (!Array.isArray(skeleton.skins)) skeleton.skins = Object.entries(skeleton.skins || {}).map(([name, attachments]) => ({ name, attachments }));
    const byName = new Map(frames.map(frame => [frame.name, frame]));
    for (const skin of skeleton.skins) for (const slot of Object.values(skin.attachments || {})) for (const [name, attachment] of Object.entries(slot)) {
      const path = attachment.path || name;
      const frame = byName.get(attachment.sequence ? `${path}${String(attachment.sequence.start || 0).padStart(attachment.sequence.digits || 0, '0')}` : path);
      if (frame) { attachment.width = frame.originalWidth; attachment.height = frame.originalHeight; }
    }
    return skeleton;
  }
  function createFileWriter({ api, dir, handle }) {
    return async (relativeName, data) => {
      const parts = relativeName.split('/');
      if (parts.some(part => !part || part === '.' || part === '..' || /[\\]/.test(part))) throw new Error('导出路径无效');
      const fileName = parts.pop();
      if (api?.writeBinaryFile && dir) {
        const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data;
        const target = [String(dir).replace(/[\\/]+$/, ''), ...parts].join('/');
        const result = await api.writeBinaryFile({ dir: target, fileName, bytes, spineSequenceNamed: true });
        if (result?.canceled) throw new Error('已取消文件保存');
        if (!result || result.ok === false) throw new Error(String(result?.error || '文件写入失败'));
        return;
      }
      if (!handle) throw new Error('未选择导出目录');
      let folder = handle;
      for (const part of parts) folder = await folder.getDirectoryHandle(part, { create: true });
      const writable = await (await folder.getFileHandle(fileName, { create: true })).createWritable();
      try { await writable.write(data); await writable.close(); } catch (error) { try { await writable.abort(); } catch {} throw error; }
    };
  }
  function createWriter(options) {
    const settings = normalizeSettings(options.settings), baseName = safeName(options.baseName), packed = options.packed === true;
    const frames = [], pages = [], names = new Set();
    let pixels = null, free = [], regions = [], usedWidth = 0, usedHeight = 0, finished = false;
    const px = Math.ceil(settings.paddingX / 2), py = Math.ceil(settings.paddingY / 2);
    async function flush() {
      if (!regions.length) return;
      const rgba = new Uint8Array(usedWidth * usedHeight * 4);
      for (let y = 0; y < usedHeight; y++) rgba.set(pixels.subarray(y * settings.maxWidth * 4, (y * settings.maxWidth + usedWidth) * 4), y * usedWidth * 4);
      const fileName = `${baseName}${pages.length ? '_' + (pages.length + 1) : ''}.png`;
      await options.write(fileName, await encodePng(rgba, usedWidth, usedHeight, settings.premultiplyAlpha));
      pages.push({ fileName, width: usedWidth, height: usedHeight, regions });
      pixels = null; free = []; regions = []; usedWidth = usedHeight = 0;
    }
    function newPage() {
      pixels = new Uint8Array(settings.maxWidth * settings.maxHeight * 4);
      free = [{ x: 0, y: 0, width: settings.maxWidth, height: settings.maxHeight }];
    }
    async function addRgba(rgba, width, height, name = frameName(baseName, frames.length)) {
      if (finished) throw new Error('导出已结束');
      if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || rgba.length !== width * height * 4) throw new Error('序列帧像素尺寸无效');
      if (names.has(name)) throw new Error('序列帧名称重复：' + name);
      const bounds = packed ? trimBounds(rgba, width, height, settings) : { x: 0, y: 0, width, height };
      const frame = { name, originalWidth: width, originalHeight: height };
      if (!packed) {
        await options.write(`images/${name}.png`, await encodePng(rgba, width, height));
      } else {
        const paddedWidth = bounds.width + px * 2, paddedHeight = bounds.height + py * 2;
        if (paddedWidth > settings.maxWidth || paddedHeight > settings.maxHeight) throw new Error(`第 ${frames.length + 1} 帧超出图集尺寸 ${settings.maxWidth}×${settings.maxHeight}，请增大图集或减小导出缩放`);
        if (!pixels) newPage();
        let placement = place(free, paddedWidth, paddedHeight);
        if (!placement) { await flush(); newPage(); placement = place(free, paddedWidth, paddedHeight); }
        const cropped = new Uint8Array(bounds.width * bounds.height * 4);
        if (!bounds.blank) for (let y = 0; y < bounds.height; y++) cropped.set(rgba.subarray(((bounds.y + y) * width + bounds.x) * 4, ((bounds.y + y) * width + bounds.x + bounds.width) * 4), y * bounds.width * 4);
        if (settings.bleed && !settings.premultiplyAlpha) bleedPixels(cropped, bounds.width, bounds.height);
        const x = placement.x + px, y = placement.y + py;
        for (let row = 0; row < bounds.height; row++) {
          const from = row * bounds.width * 4, to = ((y + row) * settings.maxWidth + x) * 4;
          pixels.set(cropped.subarray(from, from + bounds.width * 4), to);
          if (settings.duplicatePadding) for (let edge = 1; edge <= px; edge++) {
            pixels.set(cropped.subarray(from, from + 4), to - edge * 4);
            pixels.set(cropped.subarray(from + (bounds.width - 1) * 4, from + bounds.width * 4), to + (bounds.width - 1 + edge) * 4);
          }
        }
        if (settings.duplicatePadding) for (let edge = 1; edge <= py; edge++) {
          const first = (y * settings.maxWidth + x - px) * 4, last = ((y + bounds.height - 1) * settings.maxWidth + x - px) * 4, length = paddedWidth * 4;
          pixels.set(pixels.subarray(first, first + length), first - edge * settings.maxWidth * 4);
          pixels.set(pixels.subarray(last, last + length), last + edge * settings.maxWidth * 4);
        }
        regions.push({ ...frame, x, y, width: bounds.width, height: bounds.height, offsetX: bounds.x, offsetY: height - bounds.y - bounds.height });
        usedWidth = Math.max(usedWidth, placement.x + paddedWidth); usedHeight = Math.max(usedHeight, placement.y + paddedHeight);
      }
      names.add(name); frames.push(frame);
      options.onProgress?.({ frames: frames.length, pages: pages.length + (regions.length ? 1 : 0) });
    }
    async function addCanvas(canvas, name) {
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('无法读取序列帧画布');
      await addRgba(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, name);
    }
    async function addPng(bytes, name) {
      const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      try {
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('无法读取序列帧图片'); ctx.drawImage(image, 0, 0); await addCanvas(canvas, name); canvas.width = canvas.height = 1;
      } finally { image.close(); }
    }
    async function finish(json) {
      if (finished || !frames.length) throw new Error('没有可导出的序列帧');
      if (packed) { await flush(); await options.write(`${baseName}.atlas`, makeAtlas(pages, settings, options.version)); }
      const skeleton = json ? normalizeSkeleton(json, frames, packed) : makeSkeleton({ ...options, baseName, frames, packed });
      await options.write(`${baseName}.json`, JSON.stringify(skeleton));
      finished = true;
      return { frames: frames.length, pages: pages.length, packed, baseName };
    }
    return { addRgba, addCanvas, addPng, finish, dispose() { pixels = null; free = []; regions = []; finished = true; } };
  }
  root.NovaFlowSequenceAtlas = Object.freeze({ defaults, normalizeSettings, safeName, trimBounds, encodePng, makeAtlas, makeSkeleton, createFileWriter, createWriter });
})(globalThis);
