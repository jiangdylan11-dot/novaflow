// .skel import for 动画 → 骨骼动画 → 导入工程.
//
// The import dialog's Skeleton picker accepts .json only, and everything after
// it (the project builder, the bone and mesh editors) reads Spine JSON. A
// binary .skel is the same skeleton in the other export format, so this reads
// it and hands the dialog the JSON it would have got from Spine's own JSON
// export - the dialog and the rest of the app never see the binary.
//
// The reader follows spine-webgl-3.8's SkeletonBinary field for field, and
// writes the 3.8 JSON dialect its SkeletonJson reads (tests/e2e/web-spine-
// skel-import.test.mjs loads both through that runtime and compares them).
// Spine 4.x binaries are laid out differently (a 64-bit hash, per-component
// timelines) and are refused with a message that says to export JSON, rather
// than read wrong.
//
// Where it plugs in:
//   - window.NovaFlowSpineSkel.toJson(bytes) is the reader. The Web host's
//     openSpineJson / openSpineProject (novaflow-web-capabilities.js) call it
//     for a picked .skel, which is how the panel's 导入 buttons take one;
//   - the dialog's own hidden file input (the fallback the panel uses when the
//     host has no picker) gets `.skel` added to its accept list, and a
//     capture-phase change listener swaps a picked .skel for the converted
//     .json File before React's handler runs.
(function (root) {
  'use strict';

  const SUPPORTED_MAJOR = '3.8';
  const TRANSFORM_MODES = ['normal', 'onlyTranslation', 'noRotationOrReflection', 'noScale', 'noScaleOrReflection'];
  const BLEND_MODES = ['normal', 'additive', 'multiply', 'screen'];
  const POSITION_MODES = ['fixed', 'percent'];
  const SPACING_MODES = ['length', 'fixed', 'percent'];
  const ROTATE_MODES = ['tangent', 'chain', 'chainScale'];
  const ATTACHMENT_TYPES = ['region', 'boundingbox', 'mesh', 'linkedmesh', 'path', 'point', 'clipping'];
  // Timeline and curve codes, as SkeletonBinary 3.8 numbers them.
  const SLOT_ATTACHMENT = 0, SLOT_COLOR = 1, SLOT_TWO_COLOR = 2;
  const BONE_ROTATE = 0, BONE_TRANSLATE = 1, BONE_SCALE = 2, BONE_SHEAR = 3;
  const PATH_POSITION = 0, PATH_SPACING = 1, PATH_MIX = 2;
  const CURVE_STEPPED = 1, CURVE_BEZIER = 2;

  // ------------------------------------------------------------ the reader
  class BinaryInput {
    constructor(bytes) {
      this.bytes = bytes;
      this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      this.index = 0;
      this.strings = [];
    }
    need(count) {
      if (this.index + count > this.bytes.length) throw new Error('.skel 数据不完整');
    }
    readByte() { this.need(1); return this.view.getInt8(this.index++); }
    readUnsignedByte() { this.need(1); return this.view.getUint8(this.index++); }
    readBoolean() { return this.readByte() !== 0; }
    readShort() { this.need(2); const value = this.view.getInt16(this.index); this.index += 2; return value; }
    readInt32() { this.need(4); const value = this.view.getInt32(this.index); this.index += 4; return value; }
    readFloat() { this.need(4); const value = this.view.getFloat32(this.index); this.index += 4; return value; }
    readInt(optimizePositive) {
      let b = this.readByte();
      let result = b & 0x7f;
      if ((b & 0x80) !== 0) {
        b = this.readByte();
        result |= (b & 0x7f) << 7;
        if ((b & 0x80) !== 0) {
          b = this.readByte();
          result |= (b & 0x7f) << 14;
          if ((b & 0x80) !== 0) {
            b = this.readByte();
            result |= (b & 0x7f) << 21;
            if ((b & 0x80) !== 0) {
              b = this.readByte();
              result |= (b & 0x7f) << 28;
            }
          }
        }
      }
      return optimizePositive ? result : ((result >>> 1) ^ -(result & 1));
    }
    readStringRef() {
      const index = this.readInt(true);
      if (index === 0) return null;
      if (index > this.strings.length) throw new Error('.skel 字符串表引用越界');
      return this.strings[index - 1];
    }
    readString() {
      let byteCount = this.readInt(true);
      if (byteCount === 0) return null;
      if (byteCount === 1) return '';
      byteCount -= 1;
      this.need(byteCount);
      const text = new TextDecoder('utf-8').decode(this.bytes.subarray(this.index, this.index + byteCount));
      this.index += byteCount;
      return text;
    }
  }

  const hex2 = (value) => (value & 0xff).toString(16).padStart(2, '0');
  // rgba8888 as Spine writes it: r in the high byte.
  const rgba8888 = (value) => hex2(value >>> 24) + hex2(value >>> 16) + hex2(value >>> 8) + hex2(value);
  const rgb888 = (value) => hex2(value >>> 16) + hex2(value >>> 8) + hex2(value);

  function readVertices(input, vertexCount) {
    const verticesLength = vertexCount << 1;
    if (!input.readBoolean()) {
      const vertices = new Array(verticesLength);
      for (let i = 0; i < verticesLength; i += 1) vertices[i] = input.readFloat();
      return { vertices, weighted: false };
    }
    // Weighted: the JSON lists, per vertex, the bone count then bone, x, y, weight for each.
    const vertices = [];
    for (let i = 0; i < vertexCount; i += 1) {
      const boneCount = input.readInt(true);
      vertices.push(boneCount);
      for (let ii = 0; ii < boneCount; ii += 1) {
        vertices.push(input.readInt(true), input.readFloat(), input.readFloat(), input.readFloat());
      }
    }
    return { vertices, weighted: true };
  }
  function readFloatArray(input, n) {
    const array = new Array(n);
    for (let i = 0; i < n; i += 1) array[i] = input.readFloat();
    return array;
  }
  function readShortArray(input) {
    const n = input.readInt(true);
    const array = new Array(n);
    for (let i = 0; i < n; i += 1) array[i] = input.readShort();
    return array;
  }

  /** The curve of one frame, written the way 3.8 JSON spells it. */
  function readCurve(input, frame) {
    switch (input.readByte()) {
      case CURVE_STEPPED:
        frame.curve = 'stepped';
        break;
      case CURVE_BEZIER:
        frame.curve = input.readFloat();
        frame.c2 = input.readFloat();
        frame.c3 = input.readFloat();
        frame.c4 = input.readFloat();
        break;
      default:
        break;
    }
  }

  function readAttachment(input, ctx, skinName, slotIndex, attachmentName, nonessential) {
    const name = input.readStringRef();
    const type = ATTACHMENT_TYPES[input.readByte()];
    if (!type) throw new Error('.skel 附件类型无效');
    const out = {};
    if (name !== null && name !== attachmentName) out.name = name;
    if (type !== 'region') out.type = type;
    switch (type) {
      case 'region': {
        const path = input.readStringRef();
        out.rotation = input.readFloat();
        out.x = input.readFloat();
        out.y = input.readFloat();
        out.scaleX = input.readFloat();
        out.scaleY = input.readFloat();
        out.width = input.readFloat();
        out.height = input.readFloat();
        out.color = rgba8888(input.readInt32());
        if (path !== null) out.path = path;
        return out;
      }
      case 'boundingbox': {
        const vertexCount = input.readInt(true);
        const vertices = readVertices(input, vertexCount);
        out.vertexCount = vertexCount;
        out.vertices = vertices.vertices;
        if (nonessential) out.color = rgba8888(input.readInt32());
        return out;
      }
      case 'mesh': {
        const path = input.readStringRef();
        out.color = rgba8888(input.readInt32());
        const vertexCount = input.readInt(true);
        out.uvs = readFloatArray(input, vertexCount << 1);
        out.triangles = readShortArray(input);
        out.vertices = readVertices(input, vertexCount).vertices;
        out.hull = input.readInt(true);
        if (nonessential) {
          out.edges = readShortArray(input);
          out.width = input.readFloat();
          out.height = input.readFloat();
        }
        if (path !== null) out.path = path;
        return out;
      }
      case 'linkedmesh': {
        const path = input.readStringRef();
        out.color = rgba8888(input.readInt32());
        const skin = input.readStringRef();
        out.parent = input.readStringRef();
        out.deform = input.readBoolean();
        if (nonessential) {
          out.width = input.readFloat();
          out.height = input.readFloat();
        }
        if (skin !== null) out.skin = skin;
        if (path !== null) out.path = path;
        return out;
      }
      case 'path': {
        out.closed = input.readBoolean();
        out.constantSpeed = input.readBoolean();
        const vertexCount = input.readInt(true);
        out.vertexCount = vertexCount;
        out.vertices = readVertices(input, vertexCount).vertices;
        const lengths = new Array(Math.floor(vertexCount / 3));
        for (let i = 0; i < lengths.length; i += 1) lengths[i] = input.readFloat();
        out.lengths = lengths;
        if (nonessential) out.color = rgba8888(input.readInt32());
        return out;
      }
      case 'point': {
        out.rotation = input.readFloat();
        out.x = input.readFloat();
        out.y = input.readFloat();
        if (nonessential) out.color = rgba8888(input.readInt32());
        return out;
      }
      case 'clipping': {
        const endSlotIndex = input.readInt(true);
        const vertexCount = input.readInt(true);
        out.end = ctx.slotName(endSlotIndex);
        out.vertexCount = vertexCount;
        out.vertices = readVertices(input, vertexCount).vertices;
        if (nonessential) out.color = rgba8888(input.readInt32());
        return out;
      }
      default:
        return null;
    }
  }

  function readSkin(input, ctx, defaultSkin, nonessential) {
    const skin = {};
    let slotCount;
    if (defaultSkin) {
      slotCount = input.readInt(true);
      if (slotCount === 0) return null;
      skin.name = 'default';
    } else {
      skin.name = input.readStringRef();
      const bones = new Array(input.readInt(true));
      for (let i = 0; i < bones.length; i += 1) bones[i] = ctx.boneName(input.readInt(true));
      if (bones.length) skin.bones = bones;
      const ik = [];
      for (let i = 0, n = input.readInt(true); i < n; i += 1) ik.push(ctx.ikName(input.readInt(true)));
      if (ik.length) skin.ik = ik;
      const transform = [];
      for (let i = 0, n = input.readInt(true); i < n; i += 1) transform.push(ctx.transformName(input.readInt(true)));
      if (transform.length) skin.transform = transform;
      const path = [];
      for (let i = 0, n = input.readInt(true); i < n; i += 1) path.push(ctx.pathName(input.readInt(true)));
      if (path.length) skin.path = path;
      slotCount = input.readInt(true);
    }
    skin.attachments = {};
    for (let i = 0; i < slotCount; i += 1) {
      const slotIndex = input.readInt(true);
      const slotName = ctx.slotName(slotIndex);
      const entries = skin.attachments[slotName] || (skin.attachments[slotName] = {});
      for (let ii = 0, nn = input.readInt(true); ii < nn; ii += 1) {
        const attachmentName = input.readStringRef();
        const attachment = readAttachment(input, ctx, skin.name, slotIndex, attachmentName, nonessential);
        if (attachment) entries[attachmentName] = attachment;
        // The deform timelines look attachments up by skin, slot and name.
        ctx.registerAttachment(skin.name, slotIndex, attachmentName, attachment);
      }
    }
    return skin;
  }

  function readAnimation(input, ctx) {
    const animation = {};
    // Slots.
    const slots = {};
    for (let i = 0, n = input.readInt(true); i < n; i += 1) {
      const slotName = ctx.slotName(input.readInt(true));
      const slotMap = slots[slotName] || (slots[slotName] = {});
      for (let ii = 0, nn = input.readInt(true); ii < nn; ii += 1) {
        const timelineType = input.readByte();
        const frameCount = input.readInt(true);
        const frames = [];
        for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
          const frame = { time: input.readFloat() };
          if (timelineType === SLOT_ATTACHMENT) {
            frame.name = input.readStringRef();
          } else if (timelineType === SLOT_COLOR) {
            frame.color = rgba8888(input.readInt32());
            if (frameIndex < frameCount - 1) readCurve(input, frame);
          } else if (timelineType === SLOT_TWO_COLOR) {
            frame.light = rgba8888(input.readInt32());
            frame.dark = rgb888(input.readInt32());
            if (frameIndex < frameCount - 1) readCurve(input, frame);
          } else {
            throw new Error('.skel 插槽时间线类型无效：' + timelineType);
          }
          frames.push(frame);
        }
        slotMap[timelineType === SLOT_ATTACHMENT ? 'attachment' : timelineType === SLOT_COLOR ? 'color' : 'twoColor'] = frames;
      }
    }
    if (Object.keys(slots).length) animation.slots = slots;
    // Bones.
    const bones = {};
    for (let i = 0, n = input.readInt(true); i < n; i += 1) {
      const boneName = ctx.boneName(input.readInt(true));
      const boneMap = bones[boneName] || (bones[boneName] = {});
      for (let ii = 0, nn = input.readInt(true); ii < nn; ii += 1) {
        const timelineType = input.readByte();
        const frameCount = input.readInt(true);
        const frames = [];
        for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
          const frame = { time: input.readFloat() };
          if (timelineType === BONE_ROTATE) {
            frame.angle = input.readFloat();
          } else if (timelineType === BONE_TRANSLATE || timelineType === BONE_SCALE || timelineType === BONE_SHEAR) {
            frame.x = input.readFloat();
            frame.y = input.readFloat();
          } else {
            throw new Error('.skel 骨骼时间线类型无效：' + timelineType);
          }
          if (frameIndex < frameCount - 1) readCurve(input, frame);
          frames.push(frame);
        }
        boneMap[timelineType === BONE_ROTATE ? 'rotate' : timelineType === BONE_TRANSLATE ? 'translate' : timelineType === BONE_SCALE ? 'scale' : 'shear'] = frames;
      }
    }
    if (Object.keys(bones).length) animation.bones = bones;
    // IK constraints.
    const ik = {};
    for (let i = 0, n = input.readInt(true); i < n; i += 1) {
      const name = ctx.ikName(input.readInt(true));
      const frameCount = input.readInt(true);
      const frames = [];
      for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
        const frame = { time: input.readFloat(), mix: input.readFloat(), softness: input.readFloat() };
        frame.bendPositive = input.readByte() === 1;
        frame.compress = input.readBoolean();
        frame.stretch = input.readBoolean();
        if (frameIndex < frameCount - 1) readCurve(input, frame);
        frames.push(frame);
      }
      ik[name] = frames;
    }
    if (Object.keys(ik).length) animation.ik = ik;
    // Transform constraints.
    const transform = {};
    for (let i = 0, n = input.readInt(true); i < n; i += 1) {
      const name = ctx.transformName(input.readInt(true));
      const frameCount = input.readInt(true);
      const frames = [];
      for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
        const frame = { time: input.readFloat(), rotateMix: input.readFloat(), translateMix: input.readFloat(), scaleMix: input.readFloat(), shearMix: input.readFloat() };
        if (frameIndex < frameCount - 1) readCurve(input, frame);
        frames.push(frame);
      }
      transform[name] = frames;
    }
    if (Object.keys(transform).length) animation.transform = transform;
    // Path constraints.
    const path = {};
    for (let i = 0, n = input.readInt(true); i < n; i += 1) {
      const name = ctx.pathName(input.readInt(true));
      const pathMap = path[name] || (path[name] = {});
      for (let ii = 0, nn = input.readInt(true); ii < nn; ii += 1) {
        const timelineType = input.readByte();
        const frameCount = input.readInt(true);
        const frames = [];
        for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
          const frame = { time: input.readFloat() };
          if (timelineType === PATH_POSITION) frame.position = input.readFloat();
          else if (timelineType === PATH_SPACING) frame.spacing = input.readFloat();
          else if (timelineType === PATH_MIX) { frame.rotateMix = input.readFloat(); frame.translateMix = input.readFloat(); }
          else throw new Error('.skel 路径时间线类型无效：' + timelineType);
          if (frameIndex < frameCount - 1) readCurve(input, frame);
          frames.push(frame);
        }
        pathMap[timelineType === PATH_POSITION ? 'position' : timelineType === PATH_SPACING ? 'spacing' : 'mix'] = frames;
      }
    }
    if (Object.keys(path).length) animation.path = path;
    // Deform.
    const deform = {};
    for (let i = 0, n = input.readInt(true); i < n; i += 1) {
      const skinName = ctx.skinName(input.readInt(true));
      const skinMap = deform[skinName] || (deform[skinName] = {});
      for (let ii = 0, nn = input.readInt(true); ii < nn; ii += 1) {
        const slotIndex = input.readInt(true);
        const slotName = ctx.slotName(slotIndex);
        const slotMap = skinMap[slotName] || (skinMap[slotName] = {});
        for (let iii = 0, nnn = input.readInt(true); iii < nnn; iii += 1) {
          const attachmentName = input.readStringRef();
          if (!ctx.hasAttachment(skinName, slotIndex, attachmentName)) throw new Error('.skel 变形时间线引用了不存在的附件：' + attachmentName);
          const frameCount = input.readInt(true);
          const frames = [];
          for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
            const frame = { time: input.readFloat() };
            const end = input.readInt(true);
            if (end !== 0) {
              const start = input.readInt(true);
              frame.offset = start;
              frame.vertices = readFloatArray(input, end);
            }
            if (frameIndex < frameCount - 1) readCurve(input, frame);
            frames.push(frame);
          }
          slotMap[attachmentName] = frames;
        }
      }
    }
    if (Object.keys(deform).length) animation.deform = deform;
    // Draw order.
    const drawOrderCount = input.readInt(true);
    if (drawOrderCount > 0) {
      const drawOrder = [];
      for (let i = 0; i < drawOrderCount; i += 1) {
        const frame = { time: input.readFloat(), offsets: [] };
        for (let ii = 0, offsetCount = input.readInt(true); ii < offsetCount; ii += 1) {
          frame.offsets.push({ slot: ctx.slotName(input.readInt(true)), offset: input.readInt(true) });
        }
        drawOrder.push(frame);
      }
      animation.drawOrder = drawOrder;
    }
    // Events.
    const eventCount = input.readInt(true);
    if (eventCount > 0) {
      const events = [];
      for (let i = 0; i < eventCount; i += 1) {
        const frame = { time: input.readFloat() };
        const eventData = ctx.eventData(input.readInt(true));
        frame.name = eventData.name;
        frame.int = input.readInt(false);
        frame.float = input.readFloat();
        if (input.readBoolean()) frame.string = input.readString();
        if (eventData.audio !== undefined) {
          frame.volume = input.readFloat();
          frame.balance = input.readFloat();
        }
        events.push(frame);
      }
      animation.events = events;
    }
    return animation;
  }

  /** Spine 4.x writes a 64-bit hash first; peek past it for a version string. */
  function detectVersion(bytes) {
    try {
      const input = new BinaryInput(bytes);
      input.readString();
      const version = input.readString();
      if (version && /^\d+\.\d+/.test(version)) return version;
    } catch (_) { /* not 3.x */ }
    try {
      const input = new BinaryInput(bytes);
      input.index = 8;
      const version = input.readString();
      if (version && /^\d+\.\d+/.test(version)) return version;
    } catch (_) { /* not 4.x either */ }
    return '';
  }

  /**
   * A Spine 3.8 .skel as the JSON Spine 3.8 exports.
   * @param {Uint8Array|ArrayBuffer} data
   * @returns {{ json: object, text: string, version: string }}
   */
  function toJson(data) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (bytes.length < 8) throw new Error('不是 Spine .skel 文件');
    const version = detectVersion(bytes);
    if (!version) throw new Error('不是 Spine .skel 文件，或文件已损坏');
    if (!version.startsWith(SUPPORTED_MAJOR)) {
      throw new Error('暂只支持 Spine 3.8 导出的 .skel（这个文件是 ' + version + '），请在 Spine 里导出 JSON 后导入');
    }
    const input = new BinaryInput(bytes);
    const skeleton = {};
    skeleton.hash = input.readString();
    skeleton.spine = input.readString();
    if (skeleton.spine === '3.8.75') throw new Error('Spine 3.8.75 导出的 .skel 不受支持，请用更新的 Spine 重新导出');
    skeleton.x = input.readFloat();
    skeleton.y = input.readFloat();
    skeleton.width = input.readFloat();
    skeleton.height = input.readFloat();
    const nonessential = input.readBoolean();
    if (nonessential) {
      skeleton.fps = input.readFloat();
      const images = input.readString();
      const audio = input.readString();
      if (images !== null) skeleton.images = images;
      if (audio !== null) skeleton.audio = audio;
    }
    const json = { skeleton };

    // Strings.
    for (let i = 0, n = input.readInt(true); i < n; i += 1) input.strings.push(input.readString());

    // Bones.
    const bones = [];
    for (let i = 0, n = input.readInt(true); i < n; i += 1) {
      const bone = { name: input.readString() };
      if (i !== 0) bone.parent = bones[input.readInt(true)].name;
      bone.rotation = input.readFloat();
      bone.x = input.readFloat();
      bone.y = input.readFloat();
      bone.scaleX = input.readFloat();
      bone.scaleY = input.readFloat();
      bone.shearX = input.readFloat();
      bone.shearY = input.readFloat();
      bone.length = input.readFloat();
      bone.transform = TRANSFORM_MODES[input.readInt(true)];
      if (!bone.transform) throw new Error('.skel 骨骼变换模式无效');
      bone.skin = input.readBoolean();
      if (nonessential) bone.color = rgba8888(input.readInt32());
      bones.push(bone);
    }
    json.bones = bones;

    // Slots.
    const slots = [];
    for (let i = 0, n = input.readInt(true); i < n; i += 1) {
      const slot = { name: input.readString() };
      slot.bone = bones[input.readInt(true)].name;
      slot.color = rgba8888(input.readInt32());
      const dark = input.readInt32();
      if (dark !== -1) slot.dark = rgb888(dark);
      const attachment = input.readStringRef();
      if (attachment !== null) slot.attachment = attachment;
      slot.blend = BLEND_MODES[input.readInt(true)];
      if (!slot.blend) throw new Error('.skel 插槽混合模式无效');
      slots.push(slot);
    }
    json.slots = slots;

    // IK constraints.
    const ik = [];
    for (let i = 0, n = input.readInt(true); i < n; i += 1) {
      const constraint = { name: input.readString() };
      constraint.order = input.readInt(true);
      constraint.skin = input.readBoolean();
      constraint.bones = [];
      for (let ii = 0, nn = input.readInt(true); ii < nn; ii += 1) constraint.bones.push(bones[input.readInt(true)].name);
      constraint.target = bones[input.readInt(true)].name;
      constraint.mix = input.readFloat();
      constraint.softness = input.readFloat();
      constraint.bendPositive = input.readByte() === 1;
      constraint.compress = input.readBoolean();
      constraint.stretch = input.readBoolean();
      constraint.uniform = input.readBoolean();
      ik.push(constraint);
    }
    if (ik.length) json.ik = ik;

    // Transform constraints.
    const transform = [];
    for (let i = 0, n = input.readInt(true); i < n; i += 1) {
      const constraint = { name: input.readString() };
      constraint.order = input.readInt(true);
      constraint.skin = input.readBoolean();
      constraint.bones = [];
      for (let ii = 0, nn = input.readInt(true); ii < nn; ii += 1) constraint.bones.push(bones[input.readInt(true)].name);
      constraint.target = bones[input.readInt(true)].name;
      constraint.local = input.readBoolean();
      constraint.relative = input.readBoolean();
      constraint.rotation = input.readFloat();
      constraint.x = input.readFloat();
      constraint.y = input.readFloat();
      constraint.scaleX = input.readFloat();
      constraint.scaleY = input.readFloat();
      constraint.shearY = input.readFloat();
      constraint.rotateMix = input.readFloat();
      constraint.translateMix = input.readFloat();
      constraint.scaleMix = input.readFloat();
      constraint.shearMix = input.readFloat();
      transform.push(constraint);
    }
    if (transform.length) json.transform = transform;

    // Path constraints.
    const path = [];
    for (let i = 0, n = input.readInt(true); i < n; i += 1) {
      const constraint = { name: input.readString() };
      constraint.order = input.readInt(true);
      constraint.skin = input.readBoolean();
      constraint.bones = [];
      for (let ii = 0, nn = input.readInt(true); ii < nn; ii += 1) constraint.bones.push(bones[input.readInt(true)].name);
      constraint.target = slots[input.readInt(true)].name;
      constraint.positionMode = POSITION_MODES[input.readInt(true)];
      constraint.spacingMode = SPACING_MODES[input.readInt(true)];
      constraint.rotateMode = ROTATE_MODES[input.readInt(true)];
      if (!constraint.positionMode || !constraint.spacingMode || !constraint.rotateMode) throw new Error('.skel 路径约束模式无效');
      constraint.rotation = input.readFloat();
      constraint.position = input.readFloat();
      constraint.spacing = input.readFloat();
      constraint.rotateMix = input.readFloat();
      constraint.translateMix = input.readFloat();
      path.push(constraint);
    }
    if (path.length) json.path = path;

    const attachments = new Map();
    const skins = [];
    const ctx = {
      boneName: (index) => { if (!bones[index]) throw new Error('.skel 骨骼引用越界'); return bones[index].name; },
      slotName: (index) => { if (!slots[index]) throw new Error('.skel 插槽引用越界'); return slots[index].name; },
      ikName: (index) => { if (!ik[index]) throw new Error('.skel IK 约束引用越界'); return ik[index].name; },
      transformName: (index) => { if (!transform[index]) throw new Error('.skel 变换约束引用越界'); return transform[index].name; },
      pathName: (index) => { if (!path[index]) throw new Error('.skel 路径约束引用越界'); return path[index].name; },
      skinName: (index) => { if (!skins[index]) throw new Error('.skel 皮肤引用越界'); return skins[index].name; },
      registerAttachment: (skinName, slotIndex, name, attachment) => { if (attachment) attachments.set(skinName + '\u0000' + slotIndex + '\u0000' + name, attachment); },
      hasAttachment: (skinName, slotIndex, name) => attachments.has(skinName + '\u0000' + slotIndex + '\u0000' + name),
      eventData: null
    };

    // Skins: the default one first, then the named ones.
    const defaultSkin = readSkin(input, ctx, true, nonessential);
    if (defaultSkin) skins.push(defaultSkin);
    for (let i = 0, n = input.readInt(true); i < n; i += 1) skins.push(readSkin(input, ctx, false, nonessential));
    if (skins.length) json.skins = skins;

    // Events.
    const eventList = [];
    const events = {};
    for (let i = 0, n = input.readInt(true); i < n; i += 1) {
      const name = input.readStringRef();
      const event = {};
      event.int = input.readInt(false);
      event.float = input.readFloat();
      const string = input.readString();
      if (string !== null) event.string = string;
      const audio = input.readString();
      if (audio !== null) {
        event.audio = audio;
        event.volume = input.readFloat();
        event.balance = input.readFloat();
      }
      events[name] = event;
      eventList.push({ name, audio: event.audio });
    }
    if (eventList.length) json.events = events;
    ctx.eventData = (index) => { if (!eventList[index]) throw new Error('.skel 事件引用越界'); return eventList[index]; };

    // Animations.
    const animations = {};
    for (let i = 0, n = input.readInt(true); i < n; i += 1) {
      const name = input.readString();
      animations[name] = readAnimation(input, ctx);
    }
    json.animations = animations;

    return { json, text: JSON.stringify(json), version: skeleton.spine };
  }

  const isSkelName = (name) => /\.skel$/i.test(String(name || ''));
  const jsonNameFor = (name) => String(name || 'skeleton.skel').replace(/\.skel$/i, '') + '.json';

  async function convertFile(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { text } = toJson(bytes);
    return new root.File([text], jsonNameFor(file.name), { type: 'application/json' });
  }

  root.NovaFlowSpineSkel = { toJson, convertFile, isSkelName, supported: SUPPORTED_MAJOR };

  // ----------------------------------------------------------- the hooks
  if (!root.document || typeof root.document.addEventListener !== 'function') return;

  // The Skeleton pickers: the import panel's bridge makes a fresh
  // <input accept=".json,application/json"> under <body> for each pick, and
  // the import dialog keeps one with accept=".json". The particle project's
  // own JSON input sits inside its panel and is left alone.
  function isSkeletonInput(input) {
    if (!(input instanceof root.HTMLInputElement) || input.type !== 'file') return false;
    const accept = String(input.getAttribute('accept') || '').toLowerCase();
    if (!accept.includes('.json') || accept.includes('.atlas')) return false;
    return input.parentElement === root.document.body || !!input.closest('[data-preview-ui="1"], [data-novaflow-spine-import-dialog="1"]');
  }
  function widenOne(input) {
    if (!isSkeletonInput(input)) return;
    const accept = String(input.getAttribute('accept') || '');
    if (!/\.skel/i.test(accept)) input.setAttribute('accept', '.json,.skel' + (accept.startsWith('.json') ? accept.slice(5) : ',' + accept));
  }
  function widenAccept(scope) {
    if (!scope || typeof scope.querySelectorAll !== 'function') return;
    scope.querySelectorAll('input[type="file"]').forEach(widenOne);
  }

  function fail(message) {
    try { root.alert('导入 .skel 失败：' + message); } catch (_) { console.error('[novaflow-web] .skel import failed:', message); }
  }

  // A picker made and clicked in one go: widen it during the click, before the dialog opens.
  root.document.addEventListener('click', (event) => { if (event.target instanceof root.HTMLInputElement) widenOne(event.target); }, true);

  // A picked .skel becomes the .json File the panel reads.
  root.document.addEventListener('change', (event) => {
    const input = event.target;
    if (!isSkeletonInput(input)) return;
    const file = input.files && input.files[0];
    if (!file || !isSkelName(file.name)) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    convertFile(file).then((converted) => {
      const transfer = new root.DataTransfer();
      transfer.items.add(converted);
      input.files = transfer.files;
      input.dispatchEvent(new root.Event('change', { bubbles: true }));
    }).catch((error) => {
      try { input.value = ''; } catch (_) { /* a locked input keeps its file */ }
      fail(String((error && error.message) || error));
    });
  }, true);

  // The dialog mounts its input when it opens, so watch for it.
  const start = () => {
    widenAccept(root.document);
    if (typeof root.MutationObserver === 'function' && root.document.documentElement) {
      const observer = new root.MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes || []) if (node && node.nodeType === 1) widenAccept(node);
        }
      });
      observer.observe(root.document.documentElement, { childList: true, subtree: true });
    }
  };
  if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})(typeof globalThis !== 'undefined' ? globalThis : this);
