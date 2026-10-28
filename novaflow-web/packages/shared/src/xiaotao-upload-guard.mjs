// Server check for a 小桃 upload. The browser runs the same rules before queueing;
// the worker gateway applies them again when the bytes arrive, so a skipped
// client check still cannot store a file the target slot does not accept.
const IMAGE_MAX_BYTES = 24 * 1024 * 1024;
const MEDIA_MAX_BYTES = 64 * 1024 * 1024;

const FORMATS = Object.freeze([
  spec('png', 'image', ['image/png'], IMAGE_MAX_BYTES, '24MB'),
  spec('jpg', 'image', ['image/jpeg'], IMAGE_MAX_BYTES, '24MB'),
  spec('jpeg', 'image', ['image/jpeg'], IMAGE_MAX_BYTES, '24MB'),
  spec('webp', 'image', ['image/webp'], IMAGE_MAX_BYTES, '24MB'),
  spec('mp4', 'video', ['video/mp4'], MEDIA_MAX_BYTES, '64MB'),
  spec('mov', 'video', ['video/quicktime', 'video/mp4'], MEDIA_MAX_BYTES, '64MB'),
  spec('webm', 'video', ['video/webm'], MEDIA_MAX_BYTES, '64MB'),
  spec('mp3', 'audio', ['audio/mpeg', 'audio/mp3'], MEDIA_MAX_BYTES, '64MB'),
  spec('wav', 'audio', ['audio/wav', 'audio/wave', 'audio/x-wav'], MEDIA_MAX_BYTES, '64MB'),
  spec('m4a', 'audio', ['audio/mp4', 'audio/x-m4a', 'audio/m4a'], MEDIA_MAX_BYTES, '64MB'),
  spec('aac', 'audio', ['audio/aac', 'audio/x-aac'], MEDIA_MAX_BYTES, '64MB'),
  spec('ogg', 'audio', ['audio/ogg'], MEDIA_MAX_BYTES, '64MB'),
  spec('flac', 'audio', ['audio/flac', 'audio/x-flac'], MEDIA_MAX_BYTES, '64MB')
]);

const SLOTS = Object.freeze({
  image_video: Object.freeze({ label: '图生视频参考', kinds: Object.freeze(['image']) }),
  first_frame: Object.freeze({ label: '首尾帧首帧', kinds: Object.freeze(['image']) }),
  last_frame: Object.freeze({ label: '首尾帧尾帧', kinds: Object.freeze(['image']) }),
  multi_reference: Object.freeze({ label: '多参视频参考', kinds: Object.freeze(['image', 'video', 'audio']) }),
  img2img: Object.freeze({ label: '图生图参考图', kinds: Object.freeze(['image']) })
});

const MP4_BRANDS = new Set(['isom', 'iso2', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'dash', 'msnv', 'mmp4']);
const MOV_BRANDS = new Set(['qt  ']);
const M4A_BRANDS = new Set(['m4a ', 'm4b ', 'm4p ', 'mp4a']);

function spec(ext, kind, mimes, maxBytes, maxLabel) {
  return Object.freeze({ ext, kind, mimes: Object.freeze(mimes), maxBytes, maxLabel });
}

function byteAt(bytes, index) {
  const value = bytes?.[index];
  return Number.isInteger(value) ? value : 0;
}

function ascii(bytes, start, length) {
  let text = '';
  for (let i = 0; i < length; i += 1) text += String.fromCharCode(byteAt(bytes, start + i));
  return text;
}

function includesAscii(bytes, needle, limit) {
  const window = ascii(bytes, 0, Math.min(bytes?.byteLength || bytes?.length || 0, limit));
  return window.toLowerCase().includes(needle);
}

function ftypBrand(bytes) {
  return ascii(bytes, 4, 4) === 'ftyp' ? ascii(bytes, 8, 4) : '';
}

function magicMatches(ext, bytes) {
  const brand = ftypBrand(bytes).toLowerCase();
  if (ext === 'png') return ascii(bytes, 0, 8) === '\x89PNG\r\n\x1a\n';
  if (ext === 'jpg' || ext === 'jpeg') return byteAt(bytes, 0) === 0xff && byteAt(bytes, 1) === 0xd8 && byteAt(bytes, 2) === 0xff;
  if (ext === 'webp') return ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP';
  if (ext === 'mp4') return Boolean(brand) && MP4_BRANDS.has(brand) && !M4A_BRANDS.has(brand);
  if (ext === 'mov') return MOV_BRANDS.has(brand) || ['moov', 'mdat', 'wide', 'free'].includes(ascii(bytes, 4, 4));
  if (ext === 'webm') return byteAt(bytes, 0) === 0x1a && byteAt(bytes, 1) === 0x45 && byteAt(bytes, 2) === 0xdf && byteAt(bytes, 3) === 0xa3 && includesAscii(bytes, 'webm', 64);
  if (ext === 'mp3') return ascii(bytes, 0, 3) === 'ID3' || (byteAt(bytes, 0) === 0xff && (byteAt(bytes, 1) & 0xe0) === 0xe0);
  if (ext === 'wav') return ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE';
  if (ext === 'm4a') return M4A_BRANDS.has(brand);
  if (ext === 'aac') return byteAt(bytes, 0) === 0xff && (byteAt(bytes, 1) === 0xf1 || byteAt(bytes, 1) === 0xf9);
  if (ext === 'ogg') return ascii(bytes, 0, 4) === 'OggS';
  if (ext === 'flac') return ascii(bytes, 0, 4) === 'fLaC';
  return false;
}

export function inspectWorkerUpload({ name, mimeType, bytes, slot } = {}) {
  const fileName = String(name || '未命名文件');
  const ext = (fileName.toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';
  const known = FORMATS.find(item => item.ext === ext);
  if (!known) return { ok: false, message: `不支持 ${fileName}：只能上传 PNG、JPG、JPEG、WEBP、MP4、MOV、WEBM、MP3、WAV、M4A、AAC、OGG、FLAC` };
  const slotInfo = SLOTS[String(slot || '')];
  if (!slotInfo) return { ok: false, message: `${fileName} 没有目标位置` };
  if (!slotInfo.kinds.includes(known.kind)) return { ok: false, message: `${fileName} 不能放到${slotInfo.label}` };
  const mime = String(mimeType || '').split(';', 1)[0].trim().toLowerCase();
  if (!mime || !known.mimes.includes(mime)) return { ok: false, message: `${fileName} 的扩展名和文件类型不一致` };
  const length = Number(bytes?.byteLength ?? bytes?.length);
  if (!Number.isFinite(length) || length <= 0) return { ok: false, message: `${fileName} 是空文件` };
  if (length > known.maxBytes) return { ok: false, message: `${fileName} 超过 ${known.maxLabel}` };
  if (!magicMatches(ext, bytes)) return { ok: false, message: `${fileName} 的文件内容与 ${ext.toUpperCase()} 不符` };
  return { ok: true, name: fileName, ext, kind: known.kind, mimeType: mime, size: length, slot, maxBytes: known.maxBytes };
}
