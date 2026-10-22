(function () {
  "use strict";

  const RESOURCE_MENTION_TOOL_VERSION = "20260916-mention-surfaces-2";

  const SEEDANCE_RESOURCE_CONFIG = Object.freeze([
    Object.freeze({ key: "ref_image", label: "参考图1", kind: "image" }),
    Object.freeze({ key: "jimeng_image2_ref", label: "参考图2", kind: "image" }),
    Object.freeze({ key: "jimeng_image3_ref", label: "参考图3", kind: "image" }),
    Object.freeze({ key: "jimeng_image4_ref", label: "参考图4", kind: "image" }),
    Object.freeze({ key: "jimeng_video_ref", label: "视频参考", kind: "video" }),
    Object.freeze({ key: "jimeng_audio_ref", label: "声音参考", kind: "audio" })
  ]);
  const ART_GENERATE_RESOURCE_CONFIG = Object.freeze([
    Object.freeze({ key: "art_reference_1", label: "参考图1", kind: "image" }),
    Object.freeze({ key: "art_reference_2", label: "参考图2", kind: "image" }),
    Object.freeze({ key: "art_reference_3", label: "参考图3", kind: "image" })
  ]);
  // MiniMax H3 图生视频 / 首尾帧视频 bind their frame slots through the same display aliases the H3
  // prompt workflow already accepts (@参考图 -> <Picture 1>, @首帧 / @尾帧 -> <Picture 1> / <Picture 2>).
  // The first frame keeps its slot key across both modes while its alias changes, so the other
  // mode's alias is migrated to the current one when the prompt renders (@首帧 <-> @参考图).
  const MINIMAX_H3_IMAGE_VIDEO_RESOURCE_CONFIG = Object.freeze([
    Object.freeze({ key: "first_frame", label: "参考图", kind: "image", legacyAliases: Object.freeze(["@首帧"]) })
  ]);
  const MINIMAX_H3_FIRST_LAST_RESOURCE_CONFIG = Object.freeze([
    Object.freeze({ key: "first_frame", label: "首帧", kind: "image", legacyAliases: Object.freeze(["@参考图"]) }),
    Object.freeze({ key: "last_frame", label: "尾帧", kind: "image" })
  ]);
  const UI_DESIGN_MAX_REFERENCES = 15;
  const READABLE_MENTION_SOURCE = "@参考图[1-9][0-9]*|@参考图(?![0-9])|@首帧|@尾帧|@视频参考[1-3]?|@声音参考[1-3]?";
  const mountedControllers = new Set();
  const controllerByTextarea = new WeakMap();
  const menuByDocument = new WeakMap();
  let activeMenuState = null;
  let protectionSequence = 0;

  function stringValue(value) {
    return value == null ? "" : String(value);
  }

  function normalizeSurface(surface) {
    const value = stringValue(surface).trim().toLowerCase();
    if (value === "art" || value === "art_generate" || value === "artgenerate") {
      return "art-generate";
    }
    if (value === "ui" || value === "ui_design" || value === "uidesign") {
      return "ui-design";
    }
    if (value === "minimax_h3_image_video" || value === "minimax-h3-image-video" || value === "h3_image_video") {
      return "minimax-h3-image-video";
    }
    if (value === "minimax_h3_first_last" || value === "minimax-h3-first-last" || value === "h3_first_last") {
      return "minimax-h3-first-last";
    }
    return value;
  }

  function uiDesignResourceConfig(resources) {
    return (Array.isArray(resources) ? resources : [])
      .slice(0, UI_DESIGN_MAX_REFERENCES)
      .map(function (resource, index) {
        return Object.freeze({
          key: stringValue(resource && resource.key).trim() || "ui_reference_" + (index + 1),
          label: "参考图" + (index + 1),
          kind: "image"
        });
      });
  }

  // Drawing on a Qwen-Image-2.1 node takes up to 10 references; past the fixed three, each slot the
  // page reports is one more @参考图N.
  const ART_GENERATE_MAX_REFERENCES = 10;

  function artGenerateResourceConfig(resources) {
    const count = Math.min(ART_GENERATE_MAX_REFERENCES, Array.isArray(resources) ? resources.length : 0);
    if (count <= ART_GENERATE_RESOURCE_CONFIG.length) return ART_GENERATE_RESOURCE_CONFIG;
    return Array.from({ length: count }, function (_, index) {
      return ART_GENERATE_RESOURCE_CONFIG[index] || Object.freeze({ key: "art_reference_" + (index + 1), label: "参考图" + (index + 1), kind: "image" });
    });
  }

  function configForSurface(surface, resources) {
    const normalized = normalizeSurface(surface);
    if (normalized === "art-generate") return artGenerateResourceConfig(resources);
    if (normalized === "ui-design") return uiDesignResourceConfig(resources);
    if (normalized === "minimax_h3" || normalized === "minimax-h3") return (globalThis.NovaFlowAiSequenceMiniMaxH3Resource?.multiReferenceSlots || []).map(x=>({key:x.key,label:x.label,kind:x.kind}));
    if (normalized === "minimax-h3-image-video") return MINIMAX_H3_IMAGE_VIDEO_RESOURCE_CONFIG;
    if (normalized === "minimax-h3-first-last") return MINIMAX_H3_FIRST_LAST_RESOURCE_CONFIG;
    return SEEDANCE_RESOURCE_CONFIG;
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&");
  }

  function normalizedKind(value, fallback) {
    const kind = stringValue(value || fallback).trim().toLowerCase();
    return kind === "video" || kind === "audio" ? kind : "image";
  }

  function buildResourceView(surface, resources) {
    const normalized = normalizeSurface(surface);
    const sourceByKey = new Map();
    if (Array.isArray(resources)) {
      resources.slice(0, normalized === "ui-design" ? UI_DESIGN_MAX_REFERENCES : resources.length).forEach(function (resource, index) {
        if (!resource) return;
        const key = stringValue(resource.key).trim()
          || (normalized === "ui-design" ? "ui_reference_" + (index + 1) : "");
        if (key) sourceByKey.set(key, resource);
      });
    }
    const descriptors = configForSurface(normalized, resources).map(function (config, order) {
      const source = sourceByKey.get(config.key) || {};
      return {
        key: config.key,
        sourceId: stringValue(source.sourceId || source.id || source.resourceId || "").trim(),
        label: config.label,
        displayLabel: stringValue(source.label || config.label),
        alias: "@" + config.label,
        legacyAliases: Array.isArray(config.legacyAliases) ? config.legacyAliases.slice() : [],
        kind: normalizedKind(source.kind, config.kind),
        occupied: source.occupied === true,
        previewUrl: stringValue(source.previewUrl || source.thumbnailUrl || ""),
        fileName: stringValue(source.fileName || source.name || ""),
        order: order,
        modelImageNumber: Number(source.modelImageNumber) > 0 ? Math.round(Number(source.modelImageNumber)) : 0,
        modelLabel: ""
      };
    });
    const ordinals = { image: 0, video: 0, audio: 0 };
    descriptors.forEach(function (descriptor) {
      if (!descriptor.occupied) return;
      ordinals[descriptor.kind] += 1;
      if (normalized === "art-generate") {
        descriptor.modelLabel = "图" + ordinals.image;
      } else if (normalized === "ui-design") {
        // 图1通常留给页面结构控制图，用户引用从模型图2开始；不收控制图的引擎（2.1）由调用方给出编号。
        descriptor.modelLabel = "图" + (descriptor.modelImageNumber || descriptor.order + 2);
      } else {
        const typeLabel = descriptor.kind === "video"
          ? "Video"
          : descriptor.kind === "audio"
            ? "Audio"
            : "Image";
        descriptor.modelLabel = "@" + typeLabel + " " + ordinals[descriptor.kind];
      }
    });
    return descriptors;
  }

  function descriptorIndex(descriptors) {
    const byAlias = new Map();
    descriptors.forEach(function (descriptor) {
      byAlias.set(descriptor.alias, descriptor);
    });
    return byAlias;
  }

  function mentionExpression(descriptors) {
    const aliases = descriptors
      .map(function (descriptor) { return descriptor.alias; })
      .sort(function (left, right) { return right.length - left.length; })
      .map(function (alias) {
        // "@参考图" must not swallow the prefix of "@参考图1"; digit-suffixed aliases keep their boundary too.
        return escapeRegExp(alias) + "(?![0-9])";
      });
    return aliases.length ? new RegExp(aliases.join("|"), "g") : null;
  }

  function findReadableMentions(text, descriptors) {
    const expression = mentionExpression(descriptors);
    if (!expression) return [];
    const matches = [];
    let match;
    while ((match = expression.exec(text))) {
      matches.push({
        index: match.index,
        end: match.index + match[0].length,
        token: match[0]
      });
    }
    return matches;
  }

  function compileText(options) {
    const settings = options || {};
    const sourceText = stringValue(settings.text);
    const descriptors = buildResourceView(settings.surface, settings.resources);
    const byAlias = descriptorIndex(descriptors);
    const expression = new RegExp(READABLE_MENTION_SOURCE, "g");
    const mentions = [];
    const invalidTokens = [];
    const invalidSet = new Set();
    const compiledText = sourceText.replace(expression, function (token) {
      const descriptor = byAlias.get(token);
      if (!descriptor || !descriptor.occupied || !descriptor.modelLabel) {
        if (!invalidSet.has(token)) {
          invalidSet.add(token);
          invalidTokens.push(token);
        }
        return token;
      }
      mentions.push({
        key: descriptor.key,
        label: descriptor.label,
        modelLabel: descriptor.modelLabel
      });
      return descriptor.modelLabel;
    });
    return {
      text: compiledText,
      mentions: mentions,
      invalidTokens: invalidTokens
    };
  }

  function uiDesignMentionBindingSnapshot(text, descriptors) {
    const sourceText = stringValue(text);
    const supplied = Array.isArray(descriptors) ? descriptors : [];
    const source = supplied.some(function (item) { return item && item.alias; })
      ? supplied
      : buildResourceView("ui-design", supplied);
    const byAlias = descriptorIndex(source);
    const bindings = {};
    const expression = new RegExp("@参考图[1-9][0-9]*", "g");
    let match;
    while ((match = expression.exec(sourceText))) {
      const descriptor = byAlias.get(match[0]);
      if (!descriptor || !descriptor.occupied || !descriptor.sourceId) continue;
      bindings[match[0]] = descriptor.sourceId;
    }
    return {
      bindings: bindings,
      orderedSourceIds: source
        .filter(function (descriptor) { return descriptor && descriptor.occupied; })
        .map(function (descriptor) { return stringValue(descriptor.sourceId).trim(); })
        .filter(Boolean)
    };
  }

  function protectText(text) {
    const sourceText = stringValue(text);
    const sequence = ++protectionSequence;
    const tokens = [];
    const expression = new RegExp(READABLE_MENTION_SOURCE, "g");
    const protectedText = sourceText.replace(expression, function (token) {
      const placeholder = "__NOVAFLOW_RESOURCE_MENTION_" + sequence + "_" + tokens.length + "__";
      tokens.push({ placeholder: placeholder, token: token });
      return placeholder;
    });
    return { text: protectedText, tokens: tokens, sourceText: sourceText };
  }

  function occurrenceCount(text, search) {
    if (!search) return 0;
    let count = 0;
    let index = 0;
    while ((index = text.indexOf(search, index)) !== -1) {
      count += 1;
      index += search.length;
    }
    return count;
  }

  function restoreText(text, protection) {
    let restoredText = stringValue(text);
    const tokens = protection && Array.isArray(protection.tokens) ? protection.tokens : [];
    for (let index = 0; index < tokens.length; index += 1) {
      const entry = tokens[index] || {};
      const placeholder = stringValue(entry.placeholder);
      if (!placeholder || occurrenceCount(restoredText, placeholder) !== 1) {
        return {
          ok: false,
          text: restoredText,
          reason: "protected resource mention is missing or duplicated"
        };
      }
    }
    tokens.forEach(function (entry) {
      restoredText = restoredText.replace(entry.placeholder, entry.token);
    });
    return { ok: true, text: restoredText };
  }

  function controllerResourceSnapshot(controller) {
    let resources = [];
    try {
      resources = typeof controller.getResources === "function"
        ? controller.getResources()
        : [];
    } catch (error) {
      console.warn("[NovaFlow] resource mention snapshot failed", error);
    }
    return Array.isArray(resources) ? resources : [];
  }

  function controllerResources(controller) {
    return buildResourceView(
      controller.surface,
      controllerResourceSnapshot(controller)
    );
  }

  function backingSelection(controller) {
    const textarea = controller.textarea;
    const length = stringValue(textarea.value).length;
    const start = Number.isFinite(textarea.selectionStart) ? textarea.selectionStart : length;
    const end = Number.isFinite(textarea.selectionEnd) ? textarea.selectionEnd : start;
    return { start: Math.min(start, length), end: Math.min(Math.max(start, end), length) };
  }

  // A slot keeps its key across surfaces while its alias changes (图生视频 "@参考图" is 首尾帧视频
  // "@首帧"); rewrite the previous surface's alias so the text keeps addressing the same slot and
  // renders as a chip instead of plain text after a mode switch.
  function migrateLegacyAliases(controller, descriptors) {
    const text = stringValue(controller.textarea.value);
    if (text.indexOf("@") === -1) return false;
    const current = descriptorIndex(descriptors);
    const byLegacyAlias = new Map();
    descriptors.forEach(function (descriptor) {
      (descriptor.legacyAliases || []).forEach(function (alias) {
        if (!current.has(alias) && !byLegacyAlias.has(alias)) byLegacyAlias.set(alias, descriptor);
      });
    });
    if (!byLegacyAlias.size) return false;
    const expression = new RegExp(
      Array.from(byLegacyAlias.keys())
        .sort(function (left, right) { return right.length - left.length; })
        .map(function (alias) { return escapeRegExp(alias) + "(?![0-9])"; })
        .join("|"),
      "g"
    );
    const selection = backingSelection(controller);
    let caret = selection.end;
    let changed = false;
    const nextText = text.replace(expression, function (token, index) {
      const replacement = byLegacyAlias.get(token).alias;
      if (replacement === token) return token;
      changed = true;
      if (index + token.length <= selection.end) {
        caret += replacement.length - token.length;
      } else if (index < selection.end) {
        caret = index + replacement.length;
      }
      return replacement;
    });
    if (!changed) return false;
    writeBackingValue(controller, nextText, Math.max(0, Math.min(caret, nextText.length)));
    return true;
  }

  function resourceMentionRenderSignature(surface, text, descriptors) {
    return JSON.stringify([
      normalizeSurface(surface),
      stringValue(text),
      (Array.isArray(descriptors) ? descriptors : []).map(function (descriptor) {
        const item = descriptor || {};
        return [
         stringValue(item.key),
          stringValue(item.sourceId),
          stringValue(item.label),
          stringValue(item.alias),
          stringValue(item.kind),
          item.occupied === true ? 1 : 0,
          stringValue(item.previewUrl),
          stringValue(item.fileName),
          stringValue(item.modelLabel)
        ];
      })
    ]);
  }

  function clearElement(element) {
    while (element.firstChild) element.removeChild(element.firstChild);
  }

  function iconForKind(kind) {
    if (kind === "video") return "▶";
    if (kind === "audio") return "♪";
    return "图";
  }

  function createMediaPreview(documentRef, descriptor, className) {
    const preview = documentRef.createElement("span");
    preview.className = className;
    if (descriptor.kind === "image" && descriptor.previewUrl) {
      const image = documentRef.createElement("img");
      image.src = descriptor.previewUrl;
      image.alt = "";
      image.draggable = false;
      preview.appendChild(image);
    } else {
      preview.textContent = iconForKind(descriptor.kind);
      preview.classList.add("is-" + descriptor.kind);
    }
    return preview;
  }

  function createChip(controller, descriptor) {
    const documentRef = controller.document;
    const chip = documentRef.createElement("span");
    chip.className = "nf-resource-mention-chip";
    if (!descriptor.occupied) chip.classList.add("is-invalid");
    chip.setAttribute("contenteditable", "false");
    chip.dataset.nfResourceMentionToken = descriptor.alias;
    chip.dataset.nfResourceMentionKey = descriptor.key;
    chip.title = descriptor.occupied
      ? descriptor.alias + " → " + descriptor.modelLabel
      : descriptor.alias + "：资源已移除或未上传";

    const body = documentRef.createElement("span");
    body.className = "nf-resource-mention-chip-body";
    const label = documentRef.createElement("span");
    label.className = "nf-resource-mention-chip-label";
    label.textContent = descriptor.alias;
    const meta = documentRef.createElement("span");
    meta.className = "nf-resource-mention-chip-meta";
    if (!descriptor.occupied) {
      meta.textContent = "资源无效";
    } else if (descriptor.kind === "image") {
      meta.textContent = descriptor.modelLabel;
    } else {
      meta.textContent = descriptor.fileName
        ? descriptor.modelLabel + " · " + descriptor.fileName
        : descriptor.modelLabel;
    }
    body.appendChild(label);
    body.appendChild(meta);

    const remove = documentRef.createElement("button");
    remove.type = "button";
    remove.tabIndex = -1;
    remove.className = "nf-resource-mention-chip-remove";
    remove.dataset.nfResourceMentionRemove = "1";
    remove.setAttribute("aria-label", "删除" + descriptor.alias + "引用");
    remove.title = "删除引用";

    chip.appendChild(
      createMediaPreview(documentRef, descriptor, "nf-resource-mention-chip-preview")
    );
    chip.appendChild(body);
    chip.appendChild(remove);
    return chip;
  }

  function appendRenderedText(controller, text, descriptors) {
    const editor = controller.editor;
    const byAlias = descriptorIndex(descriptors);
    const matches = findReadableMentions(text, descriptors);
    let cursor = 0;
    matches.forEach(function (match) {
      if (match.index > cursor) {
        editor.appendChild(
          controller.document.createTextNode(text.slice(cursor, match.index))
        );
      }
      editor.appendChild(createChip(controller, byAlias.get(match.token)));
      cursor = match.end;
    });
    if (cursor < text.length) {
      editor.appendChild(controller.document.createTextNode(text.slice(cursor)));
    }
  }

  function nodeCanonicalLength(node) {
    if (!node) return 0;
    if (node.nodeType === 3) return stringValue(node.nodeValue).length;
    if (node.nodeType !== 1) return 0;
    if (node.dataset && node.dataset.nfResourceMentionToken) {
      return stringValue(node.dataset.nfResourceMentionToken).length;
    }
    if (node.tagName === "BR") return 1;
    let length = 0;
    Array.prototype.forEach.call(node.childNodes || [], function (child) {
      length += nodeCanonicalLength(child);
    });
    return length;
  }

  function canonicalOffsetForPoint(root, target, targetOffset) {
    if (!root || !target) return 0;
    if (target === root) {
      let rootOffset = 0;
      for (let index = 0; index < Math.min(targetOffset, root.childNodes.length); index += 1) {
        rootOffset += nodeCanonicalLength(root.childNodes[index]);
      }
      return rootOffset;
    }
    let total = 0;
    let found = false;
    function visit(node) {
      if (found) return;
      if (node === target) {
        if (node.nodeType === 3) {
          total += Math.min(targetOffset, stringValue(node.nodeValue).length);
        } else {
          for (let index = 0; index < Math.min(targetOffset, node.childNodes.length); index += 1) {
            total += nodeCanonicalLength(node.childNodes[index]);
          }
        }
        found = true;
        return;
      }
      if (node.nodeType === 1 && node.contains && node.contains(target)) {
        Array.prototype.forEach.call(node.childNodes, function (child) {
          if (!found) visit(child);
        });
        return;
      }
      total += nodeCanonicalLength(node);
    }
    Array.prototype.forEach.call(root.childNodes, function (child) {
      if (!found) visit(child);
    });
    return total;
  }

  function editorSelection(controller) {
    const nativeSelection = controller.document.getSelection
      ? controller.document.getSelection()
      : null;
    if (!nativeSelection || !nativeSelection.rangeCount) {
      const fallback = Number.isFinite(controller.textarea.selectionStart)
        ? controller.textarea.selectionStart
        : stringValue(controller.textarea.value).length;
      return { start: fallback, end: fallback };
    }
    const range = nativeSelection.getRangeAt(0);
    const editor = controller.editor;
    if (!editor.contains(range.startContainer) && range.startContainer !== editor) {
      const end = stringValue(controller.textarea.value).length;
      return { start: end, end: end };
    }
    const anchor = canonicalOffsetForPoint(editor, range.startContainer, range.startOffset);
    const focus = canonicalOffsetForPoint(editor, range.endContainer, range.endOffset);
    return { start: Math.min(anchor, focus), end: Math.max(anchor, focus) };
  }

  function pointForCanonicalOffset(root, requestedOffset) {
    let remaining = Math.max(0, requestedOffset);
    function locate(container) {
      const children = Array.prototype.slice.call(container.childNodes || []);
      for (let index = 0; index < children.length; index += 1) {
        const child = children[index];
        if (child.nodeType === 3) {
          const length = stringValue(child.nodeValue).length;
          if (remaining <= length) return { node: child, offset: remaining };
          remaining -= length;
          continue;
        }
        if (child.nodeType !== 1) continue;
        if (child.dataset && child.dataset.nfResourceMentionToken) {
          const length = stringValue(child.dataset.nfResourceMentionToken).length;
          if (remaining === 0) return { node: container, offset: index };
          if (remaining <= length) return { node: container, offset: index + 1 };
          remaining -= length;
          continue;
        }
        if (child.tagName === "BR") {
          if (remaining === 0) return { node: container, offset: index };
          if (remaining === 1) return { node: container, offset: index + 1 };
          remaining -= 1;
          continue;
        }
        const nestedLength = nodeCanonicalLength(child);
        if (remaining <= nestedLength) return locate(child);
        remaining -= nestedLength;
      }
      return { node: container, offset: children.length };
    }
    return locate(root);
  }

  function setEditorSelection(controller, selection) {
    if (!selection || !controller.document.createRange) return;
    const nativeSelection = controller.document.getSelection
      ? controller.document.getSelection()
      : null;
    if (!nativeSelection) return;
    const length = stringValue(controller.textarea.value).length;
    const start = pointForCanonicalOffset(
      controller.editor,
      Math.min(selection.start, length)
    );
    const end = pointForCanonicalOffset(
      controller.editor,
      Math.min(selection.end, length)
    );
    const range = controller.document.createRange();
    try {
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      nativeSelection.removeAllRanges();
      nativeSelection.addRange(range);
    } catch (error) {
      console.warn("[NovaFlow] resource mention caret restore failed", error);
    }
  }

  // Hosts that open the editor inside a dialog focus it here; caret: "end" parks the caret after
  // the text instead of at 0, so a leading mention is neither split nor re-offered by the menu.
  function focusEditor(controller, options) {
    const settings = options || {};
    const editor = controller.editor;
    if (!editor.isConnected) return false;
    try {
      editor.focus({ preventScroll: settings.preventScroll === true });
    } catch (error) {
      editor.focus();
    }
    if (settings.caret === "end") {
      const end = stringValue(controller.textarea.value).length;
      setEditorSelection(controller, { start: end, end: end });
      updateMenuFromCaret(controller);
    }
    return controller.document.activeElement === editor;
  }

  function serializeEditorNode(node) {
    if (node.nodeType === 3) return stringValue(node.nodeValue);
    if (node.nodeType !== 1) return "";
    if (node.dataset && node.dataset.nfResourceMentionToken) {
      return stringValue(node.dataset.nfResourceMentionToken);
    }
    if (node.tagName === "BR") return "\n";
    let value = "";
    Array.prototype.forEach.call(node.childNodes || [], function (child, index) {
      const block = child.nodeType === 1
        && (child.tagName === "DIV" || child.tagName === "P" || child.tagName === "LI");
      if (block && value && !value.endsWith("\n")) value += "\n";
      value += serializeEditorNode(child);
      if (block && index < node.childNodes.length - 1 && !value.endsWith("\n")) {
        value += "\n";
      }
    });
    return value;
  }

  function serializeEditor(editor) {
    let value = "";
    Array.prototype.forEach.call(editor.childNodes || [], function (child) {
      value += serializeEditorNode(child);
    });
    return value.replace(/\u00a0/g, " ");
  }

  function dispatchTextareaEvent(textarea, type) {
    const documentRef = textarea.ownerDocument;
    const view = documentRef.defaultView || window;
    let event;
    if (typeof view.Event === "function") {
      event = new view.Event(type, { bubbles: true });
    } else {
      event = documentRef.createEvent("Event");
      event.initEvent(type, true, false);
    }
    textarea.dispatchEvent(event);
  }

  function commitBackingChange(controller) {
    const textarea = controller && controller.textarea;
    if (!textarea || !textarea.isConnected) return;
    controller.writingBacking = true;
    try {
      dispatchTextareaEvent(textarea, "change");
    } finally {
      controller.writingBacking = false;
    }
  }

  function writeBackingValue(controller, value, caret) {
    const textarea = controller.textarea;
    const view = controller.document.defaultView || window;
    const prototype = view.HTMLTextAreaElement && view.HTMLTextAreaElement.prototype;
    const descriptor = prototype
      ? Object.getOwnPropertyDescriptor(prototype, "value")
      : null;
    controller.writingBacking = true;
    try {
      if (descriptor && typeof descriptor.set === "function") {
        descriptor.set.call(textarea, value);
      } else {
        textarea.value = value;
      }
      if (typeof textarea.setSelectionRange === "function") {
        textarea.setSelectionRange(caret, caret);
      }
      dispatchTextareaEvent(textarea, "input");
      if (typeof controller.onMentionsChange === "function") {
        try {
          controller.onMentionsChange({
            text: stringValue(value),
            ...uiDesignMentionBindingSnapshot(value, controllerResources(controller))
          });
        } catch (error) {
          console.warn("[NovaFlow] resource mention binding callback failed", error);
        }
      }
    } finally {
      controller.writingBacking = false;
    }
  }

  function overlayGeometry(textareaRect, hostRect, host) {
    const hostWidth = Number(host && host.offsetWidth);
    const hostHeight = Number(host && host.offsetHeight);
    const scaleXValue = hostWidth > 0 ? Number(hostRect && hostRect.width) / hostWidth : 1;
    const scaleYValue = hostHeight > 0 ? Number(hostRect && hostRect.height) / hostHeight : 1;
    const scaleX = Number.isFinite(scaleXValue) && scaleXValue > 0.001 ? scaleXValue : 1;
    const scaleY = Number.isFinite(scaleYValue) && scaleYValue > 0.001 ? scaleYValue : 1;
    return {
      left: Math.round(
        (Number(textareaRect && textareaRect.left) - Number(hostRect && hostRect.left)) / scaleX
        - Number(host && host.clientLeft || 0)
        + Number(host && host.scrollLeft || 0)
      ),
      top: Math.round(
        (Number(textareaRect && textareaRect.top) - Number(hostRect && hostRect.top)) / scaleY
        - Number(host && host.clientTop || 0)
        + Number(host && host.scrollTop || 0)
      ),
      width: Math.round(Number(textareaRect && textareaRect.width) / scaleX),
      height: Math.round(Number(textareaRect && textareaRect.height) / scaleY)
    };
  }

  function positionEditor(controller) {
    const textarea = controller.textarea;
    const editor = controller.editor;
    const host = controller.host;
    if (!textarea.isConnected || !editor.isConnected || !host.isConnected) return;
    const view = controller.document.defaultView || window;
    const textareaRect = textarea.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    const computed = view.getComputedStyle ? view.getComputedStyle(textarea) : null;
    const geometry = overlayGeometry(textareaRect, hostRect, host);
    editor.style.left = geometry.left + "px";
    editor.style.top = geometry.top + "px";
    editor.style.width = geometry.width + "px";
    editor.style.height = geometry.height + "px";
    if (!computed) return;
    [
      "fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight",
      "letterSpacing", "textAlign", "padding", "border", "borderRadius", "background"
    ].forEach(function (property) {
      editor.style[property] = computed[property];
    });
    editor.style.color = computed.color === "rgba(0, 0, 0, 0)"
      ? "#f4f4f5"
      : computed.color;
  }

  function positionSubmissionError(controller) {
    const errorPortal = controller.errorPortal;
    if (!errorPortal || !errorPortal.isConnected || !controller.editor.isConnected) return;
    const rect = controller.editor.getBoundingClientRect();
    const view = controller.document.defaultView || window;
    const width = Math.min(360, Math.max(220, rect.width));
    errorPortal.style.width = Math.round(width) + "px";
    errorPortal.style.left = Math.round(
      Math.min(
        Math.max(8, rect.left),
        Math.max(8, (view.innerWidth || width + 16) - width - 8)
      )
    ) + "px";
    errorPortal.style.top = Math.round(
      Math.min(
        Math.max(8, rect.bottom + 8),
        Math.max(8, (view.innerHeight || rect.bottom + 80) - 64)
      )
    ) + "px";
  }

  function clearSubmissionError(controller) {
    Array.from(controller.document.querySelectorAll(".nf-resource-mention-error")).forEach(function (portal) {
      if (portal.parentNode) portal.parentNode.removeChild(portal);
    });
    controller.errorPortal = null;
  }

  function showSubmissionError(controller, invalidTokens) {
    clearSubmissionError(controller);
    const errorPortal = controller.document.createElement("div");
    errorPortal.className = "nf-resource-mention-error";
    errorPortal.setAttribute("data-novaflow-runtime-ignore", "1");
    errorPortal.setAttribute("role", "alert");
    errorPortal.textContent = "资源引用已失效: " + invalidTokens.join("、");
    controller.document.body.appendChild(errorPortal);
    controller.errorPortal = errorPortal;
    positionSubmissionError(controller);
  }

  function isSeedanceGenerateButton(workspace, target) {
    const button = target && target.closest ? target.closest("button") : null;
    if (!button || !workspace.contains(button)) return false;
    return stringValue(button.textContent).replace(/\s+/g, "").includes("开始生成");
  }

  function handleSeedanceSubmissionCapture(controller, event) {
    const workspace = controller.guardWorkspace;
    if (!workspace || !isSeedanceGenerateButton(workspace, event.target)) return;
    const compiled = compileText({
      text: controller.textarea.value,
      surface: "seedance",
      resources: controllerResourceSnapshot(controller)
    });
    if (!compiled.invalidTokens.length) {
      clearSubmissionError(controller);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }
    renderController(controller);
    showSubmissionError(controller, compiled.invalidTokens);
  }

  function syncSubmissionGuard(controller) {
    const shouldGuard = controller.surface === "seedance";
    const workspace = shouldGuard && controller.textarea.closest
      ? controller.textarea.closest("[data-novaflow-ai-bottom-workspace='1']")
      : null;
    if (controller.guardWorkspace === workspace) return;
    if (controller.guardWorkspace) {
      controller.guardWorkspace.removeEventListener(
        "click",
        controller.handlers.submissionCapture,
        true
      );
    }
    controller.guardWorkspace = workspace;
    if (workspace) {
      workspace.addEventListener(
        "click",
        controller.handlers.submissionCapture,
        true
      );
    } else {
      clearSubmissionError(controller);
    }
  }

  function renderController(controller, requestedSelection) {
    // Native IME owns both the DOM and selection until its final input event.
    if (controller.composing) return;
    if (!controller.editor.isConnected || !controller.textarea.isConnected) return;
    const hadFocus = controller.document.activeElement === controller.editor;
    const descriptors = controllerResources(controller);
    // Migration rewrites the backing text and caret, so it must run before the selection is read.
    const migrated = migrateLegacyAliases(controller, descriptors);
    const selection = migrated
      ? backingSelection(controller)
      : requestedSelection || (hadFocus ? editorSelection(controller) : null);
    const text = stringValue(controller.textarea.value);
    const signature = resourceMentionRenderSignature(controller.surface, text, descriptors);
    controller.descriptors = descriptors;
    if (signature === controller.renderSignature) {
      positionEditor(controller);
      positionSubmissionError(controller);
      if (selection && hadFocus) setEditorSelection(controller, selection);
      return;
    }
    clearElement(controller.editor);
    appendRenderedText(controller, text, controller.descriptors);
    controller.editor.dataset.empty = text ? "0" : "1";
    controller.renderSignature = signature;
    positionEditor(controller);
    positionSubmissionError(controller);
    if (selection && hadFocus) setEditorSelection(controller, selection);
  }

  function currentMentionTrigger(controller, text, caret) {
    // Only an "@" before the caret triggers: a freshly focused editor parks the caret at 0, and a
    // leading "@参考图1" must not open the menu there.
    if (!(caret > 0)) return null;
    const triggerStart = text.lastIndexOf("@", caret - 1);
    if (triggerStart < 0) return null;
    const query = text.slice(triggerStart + 1, caret);
    if (query.length > 32 || /[\s@,，。;；!！?？]/.test(query)) return null;
    const exactAlias = text.slice(triggerStart, caret);
    if (controller.descriptors.some(function (descriptor) {
      return descriptor.alias === exactAlias;
    })) {
      return null;
    }
    return { start: triggerStart, end: caret, query: query };
  }

  function ensureMenu(documentRef) {
    let menu = menuByDocument.get(documentRef);
    if (menu && menu.isConnected) return menu;
    menu = documentRef.createElement("div");
    menu.className = "nf-resource-mention-menu";
    menu.hidden = true;
    menu.setAttribute("data-novaflow-runtime-ignore", "1");
    menu.setAttribute("role", "listbox");
    menu.setAttribute("aria-label", "已上传的参考资源");
    documentRef.body.appendChild(menu);
    menuByDocument.set(documentRef, menu);
    return menu;
  }

  function closeMenu(controller) {
    if (!activeMenuState) return;
    if (controller && activeMenuState.controller !== controller) return;
    activeMenuState.menu.hidden = true;
    clearElement(activeMenuState.menu);
    activeMenuState = null;
  }

  function destroyMenuForDocument(documentRef) {
    const menu = menuByDocument.get(documentRef);
    if (activeMenuState && activeMenuState.controller.document === documentRef) {
      closeMenu(activeMenuState.controller);
    }
    if (menu && menu.parentNode) menu.parentNode.removeChild(menu);
    menuByDocument.delete(documentRef);
  }

  function caretClientRect(controller) {
    const selection = controller.document.getSelection
      ? controller.document.getSelection()
      : null;
    if (selection && selection.rangeCount) {
      const range = selection.getRangeAt(0).cloneRange();
      range.collapse(false);
      const rects = range.getClientRects();
      if (rects && rects.length) return rects[rects.length - 1];
      const rangeRect = range.getBoundingClientRect();
      if (rangeRect && (rangeRect.width || rangeRect.height)) return rangeRect;
    }
    const editorRect = controller.editor.getBoundingClientRect();
    return {
      left: editorRect.left + 12,
      right: editorRect.left + 12,
      top: editorRect.top + 12,
      bottom: editorRect.top + 32,
      width: 0,
      height: 20
    };
  }

  function positionMenu(state) {
    const rect = caretClientRect(state.controller);
    const view = state.controller.document.defaultView || window;
    const menu = state.menu;
    const viewportWidth = Math.max(320, view.innerWidth || 0);
    const viewportHeight = Math.max(240, view.innerHeight || 0);
    const menuWidth = Math.min(320, viewportWidth - 16);
    const menuHeight = Math.min(menu.scrollHeight || 220, 260);
    const left = Math.min(
      Math.max(8, rect.left),
      viewportWidth - menuWidth - 8
    );
    let top = rect.bottom + 8;
    if (top + menuHeight > viewportHeight - 8) {
      top = Math.max(8, rect.top - menuHeight - 8);
    }
    menu.style.left = Math.round(left) + "px";
    menu.style.top = Math.round(top) + "px";
    menu.style.width = Math.round(menuWidth) + "px";
  }

  function setActiveMenuIndex(state, requestedIndex) {
    const count = state.candidates.length;
    if (!count) return;
    state.index = (requestedIndex + count) % count;
    Array.prototype.forEach.call(state.menu.children, function (item, index) {
      const active = index === state.index;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-selected", active ? "true" : "false");
      if (active && item.scrollIntoView) item.scrollIntoView({ block: "nearest" });
    });
  }

  function replaceEditorRange(controller, start, end, replacement, requestedCaret) {
    const text = stringValue(controller.textarea.value);
    const nextText = text.slice(0, start) + replacement + text.slice(end);
    const caret = requestedCaret == null ? start + replacement.length : requestedCaret;
    writeBackingValue(controller, nextText, caret);
    renderController(controller, { start: caret, end: caret });
    try {
      controller.editor.focus({ preventScroll: true });
    } catch (error) {
      controller.editor.focus();
    }
    setEditorSelection(controller, { start: caret, end: caret });
  }

  function chooseMenuCandidate(state, index) {
    if (!state || !state.candidates[index]) return;
    const descriptor = state.candidates[index];
    const controller = state.controller;
    const trigger = state.trigger;
    closeMenu(controller);
    replaceEditorRange(
      controller,
      trigger.start,
      trigger.end,
      descriptor.alias,
      trigger.start + descriptor.alias.length
    );
  }

  function openMenu(controller, trigger) {
    const query = trigger.query.trim().toLowerCase();
    const candidates = controller.descriptors.filter(function (descriptor) {
      if (!descriptor.occupied) return false;
      return !query
        || descriptor.label.toLowerCase().includes(query)
        || descriptor.fileName.toLowerCase().includes(query);
    });
    if (!candidates.length) {
      closeMenu(controller);
      return;
    }
    if (activeMenuState && activeMenuState.controller !== controller) closeMenu();
    const menu = ensureMenu(controller.document);
    // Overlays at the same (clamped) z-index paint in DOM order and the prompt editor modal is
    // appended after the menu, so the menu moves to the end of <body> whenever it opens.
    const body = controller.document.body;
    if (body && menu.parentNode === body && body.lastElementChild !== menu) body.appendChild(menu);
    clearElement(menu);
    const state = {
      controller: controller,
      menu: menu,
      candidates: candidates,
      trigger: trigger,
      index: 0
    };
    activeMenuState = state;
    candidates.forEach(function (descriptor, index) {
      const item = controller.document.createElement("button");
      item.type = "button";
      item.className = "nf-resource-mention-menu-item";
      item.setAttribute("role", "option");
      item.addEventListener("pointerdown", function (event) {
        event.preventDefault();
      });
      item.addEventListener("click", function () {
        if (activeMenuState === state) chooseMenuCandidate(state, index);
      });
      const body = controller.document.createElement("span");
      body.className = "nf-resource-mention-menu-body";
      const label = controller.document.createElement("span");
      label.className = "nf-resource-mention-menu-label";
      label.textContent = descriptor.alias;
      const meta = controller.document.createElement("span");
      meta.className = "nf-resource-mention-menu-meta";
      meta.textContent = descriptor.fileName
        ? descriptor.modelLabel + " · " + descriptor.fileName
        : descriptor.modelLabel;
      body.appendChild(label);
      body.appendChild(meta);
      item.appendChild(
        createMediaPreview(
          controller.document,
          descriptor,
          "nf-resource-mention-menu-preview"
        )
      );
      item.appendChild(body);
      menu.appendChild(item);
    });
    menu.hidden = false;
    setActiveMenuIndex(state, 0);
    positionMenu(state);
  }

  function updateMenuFromCaret(controller) {
    if (controller.composing) return;
    const selection = editorSelection(controller);
    if (selection.start !== selection.end) {
      closeMenu(controller);
      return;
    }
    const text = stringValue(controller.textarea.value);
    const trigger = currentMentionTrigger(controller, text, selection.end);
    if (!trigger) {
      closeMenu(controller);
      return;
    }
    openMenu(controller, trigger);
  }

  function expandedMentionRange(controller, selection, direction) {
    const text = stringValue(controller.textarea.value);
    const matches = findReadableMentions(text, controller.descriptors);
    let start = selection.start;
    let end = selection.end;
    if (start === end) {
      const match = matches.find(function (entry) {
        return direction === "backward" ? entry.end === start : entry.index === start;
      });
      return match ? { start: match.index, end: match.end } : null;
    }
    matches.forEach(function (entry) {
      if (entry.index < end && entry.end > start) {
        start = Math.min(start, entry.index);
        end = Math.max(end, entry.end);
      }
    });
    return start !== selection.start || end !== selection.end
      ? { start: start, end: end }
      : null;
  }

  function syncEditorToBacking(controller, shouldRender) {
    if (controller.composing) return;
    const selection = editorSelection(controller);
    clearSubmissionError(controller);
    writeBackingValue(controller, serializeEditor(controller.editor), selection.end);
    if (shouldRender) {
      renderController(controller, selection);
      setEditorSelection(controller, selection);
      updateMenuFromCaret(controller);
    }
  }

  function handleEditorKeyDown(controller, event) {
    if (controller.composing || event.isComposing || event.keyCode === 229) return;
    if (activeMenuState && activeMenuState.controller === controller) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setActiveMenuIndex(
          activeMenuState,
          activeMenuState.index + (event.key === "ArrowDown" ? 1 : -1)
        );
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        chooseMenuCandidate(activeMenuState, activeMenuState.index);
        return;
      }
      if (event.key === "Escape") {
        // Only the mention menu consumes this Escape; a surrounding dialog must stay open.
        event.preventDefault();
        event.stopPropagation();
        closeMenu(controller);
        return;
      }
    }
    if (event.key !== "Backspace" && event.key !== "Delete") return;
    const selection = editorSelection(controller);
    const range = expandedMentionRange(
      controller,
      selection,
      event.key === "Backspace" ? "backward" : "forward"
    );
    if (!range) return;
    event.preventDefault();
    replaceEditorRange(controller, range.start, range.end, "", range.start);
    closeMenu(controller);
  }

  function handleBeforeInput(controller, event) {
    if (controller.composing || event.isComposing || /composition/i.test(event.inputType || "")) return;
    if (event.inputType === "insertParagraph" || event.inputType === "insertLineBreak") {
      event.preventDefault();
      const selection = editorSelection(controller);
      replaceEditorRange(controller, selection.start, selection.end, "\n");
      closeMenu(controller);
      return;
    }
    if (event.inputType !== "deleteContentBackward"
      && event.inputType !== "deleteContentForward") {
      return;
    }
    const selection = editorSelection(controller);
    const range = expandedMentionRange(
      controller,
      selection,
      event.inputType === "deleteContentBackward" ? "backward" : "forward"
    );
    if (!range) return;
    event.preventDefault();
    replaceEditorRange(controller, range.start, range.end, "", range.start);
    closeMenu(controller);
  }

  function handleCopy(controller, event, cut) {
    const selection = editorSelection(controller);
    if (selection.start === selection.end || !event.clipboardData) return;
    const expanded = expandedMentionRange(controller, selection, "backward");
    const start = expanded ? expanded.start : selection.start;
    const end = expanded ? expanded.end : selection.end;
    event.preventDefault();
    event.clipboardData.setData(
      "text/plain",
      stringValue(controller.textarea.value).slice(start, end)
    );
    if (cut) replaceEditorRange(controller, start, end, "", start);
  }

  function handlePaste(controller, event) {
    if (!event.clipboardData) return;
    const pasted = event.clipboardData.getData("text/plain");
    if (typeof pasted !== "string") return;
    event.preventDefault();
    const selection = editorSelection(controller);
    const expanded = expandedMentionRange(controller, selection, "backward");
    const start = expanded ? expanded.start : selection.start;
    const end = expanded ? expanded.end : selection.end;
    replaceEditorRange(controller, start, end, pasted, start + pasted.length);
    updateMenuFromCaret(controller);
  }

  function bindControllerEvents(controller) {
    const editor = controller.editor;
    const textarea = controller.textarea;
    const handlers = controller.handlers;
    handlers.input = function (event) {
      if (controller.composing || event.isComposing) return;
      syncEditorToBacking(controller, true);
    };
    handlers.keydown = function (event) { handleEditorKeyDown(controller, event); };
    handlers.beforeinput = function (event) { handleBeforeInput(controller, event); };
    handlers.compositionstart = function () {
      const view = controller.document.defaultView || window;
      if (controller.compositionCommitTimer != null) view.clearTimeout(controller.compositionCommitTimer);
      controller.compositionCommitTimer = null;
      controller.composing = true;
      closeMenu(controller);
    };
    handlers.compositionend = function () {
      const view = controller.document.defaultView || window;
      if (controller.compositionCommitTimer != null) view.clearTimeout(controller.compositionCommitTimer);
      // Chromium can send the committed input after compositionend. Rebuilding
      // here would invalidate that event's target and the native caret range.
      controller.composing = true;
      controller.compositionCommitTimer = view.setTimeout(function () {
        controller.compositionCommitTimer = null;
        controller.composing = false;
        if (editor.isConnected && textarea.isConnected) syncEditorToBacking(controller, true);
      }, 0);
    };
    handlers.focus = function () {
      clearSubmissionError(controller);
      positionEditor(controller);
      updateMenuFromCaret(controller);
    };
    handlers.blur = function () {
      commitBackingChange(controller);
      const view = controller.document.defaultView || window;
      view.setTimeout(function () {
        if (activeMenuState && activeMenuState.controller === controller) {
          closeMenu(controller);
        }
      }, 0);
    };
    handlers.click = function (event) {
      const remove = event.target.closest
        ? event.target.closest("[data-nf-resource-mention-remove='1']")
        : null;
      if (!remove) {
        updateMenuFromCaret(controller);
        return;
      }
      event.preventDefault();
      const chip = remove.closest(".nf-resource-mention-chip");
      if (!chip || !chip.parentNode) return;
      const chipIndex = Array.prototype.indexOf.call(chip.parentNode.childNodes, chip);
      const start = canonicalOffsetForPoint(controller.editor, chip.parentNode, chipIndex);
      const token = stringValue(chip.dataset.nfResourceMentionToken);
      replaceEditorRange(controller, start, start + token.length, "", start);
      closeMenu(controller);
    };
    handlers.pointerdown = function (event) {
      if (event.target.closest
        && event.target.closest("[data-nf-resource-mention-remove='1']")) {
        event.preventDefault();
      }
    };
    handlers.copy = function (event) { handleCopy(controller, event, false); };
    handlers.cut = function (event) { handleCopy(controller, event, true); };
    handlers.paste = function (event) { handlePaste(controller, event); };
    handlers.backingChange = function () {
      if (!controller.writingBacking) {
        clearSubmissionError(controller);
        renderController(controller);
      }
    };
    handlers.submissionCapture = function (event) {
      handleSeedanceSubmissionCapture(controller, event);
    };
    handlers.resize = function () {
      positionEditor(controller);
      positionSubmissionError(controller);
      if (activeMenuState && activeMenuState.controller === controller) {
        positionMenu(activeMenuState);
      }
    };

    editor.addEventListener("input", handlers.input);
    editor.addEventListener("keydown", handlers.keydown);
    editor.addEventListener("beforeinput", handlers.beforeinput);
    editor.addEventListener("compositionstart", handlers.compositionstart);
    editor.addEventListener("compositionend", handlers.compositionend);
    editor.addEventListener("focus", handlers.focus);
    editor.addEventListener("blur", handlers.blur);
    editor.addEventListener("click", handlers.click);
    editor.addEventListener("pointerdown", handlers.pointerdown);
    editor.addEventListener("copy", handlers.copy);
    editor.addEventListener("cut", handlers.cut);
    editor.addEventListener("paste", handlers.paste);
    textarea.addEventListener("input", handlers.backingChange);
    textarea.addEventListener("change", handlers.backingChange);
    (controller.document.defaultView || window).addEventListener("resize", handlers.resize);
  }

  function unbindControllerEvents(controller) {
    const view = controller.document.defaultView || window;
    if (controller.compositionCommitTimer != null) view.clearTimeout(controller.compositionCommitTimer);
    controller.compositionCommitTimer = null;
    const editor = controller.editor;
    const textarea = controller.textarea;
    const handlers = controller.handlers;
    editor.removeEventListener("input", handlers.input);
    editor.removeEventListener("keydown", handlers.keydown);
    editor.removeEventListener("beforeinput", handlers.beforeinput);
    editor.removeEventListener("compositionstart", handlers.compositionstart);
    editor.removeEventListener("compositionend", handlers.compositionend);
    editor.removeEventListener("focus", handlers.focus);
    editor.removeEventListener("blur", handlers.blur);
    editor.removeEventListener("click", handlers.click);
    editor.removeEventListener("pointerdown", handlers.pointerdown);
    editor.removeEventListener("copy", handlers.copy);
    editor.removeEventListener("cut", handlers.cut);
    editor.removeEventListener("paste", handlers.paste);
    textarea.removeEventListener("input", handlers.backingChange);
    textarea.removeEventListener("change", handlers.backingChange);
    if (controller.guardWorkspace) {
      controller.guardWorkspace.removeEventListener(
        "click",
        handlers.submissionCapture,
        true
      );
      controller.guardWorkspace = null;
    }
    (controller.document.defaultView || window).removeEventListener(
      "resize",
      handlers.resize
    );
  }

  function pruneDisconnectedControllers() {
    Array.from(mountedControllers).forEach(function (controller) {
      if (!controller.textarea.isConnected || !controller.editor.isConnected) {
        unmountTextarea(controller.textarea);
      }
    });
  }

  function mountTextarea(options) {
    const settings = options || {};
    pruneDisconnectedControllers();
    const textarea = settings.textarea;
    if (!textarea
      || !textarea.ownerDocument
      || !textarea.parentNode
      || !textarea.isConnected) {
      return null;
    }
    const existing = controllerByTextarea.get(textarea);
    if (existing && existing.editor.isConnected) {
      existing.surface = normalizeSurface(settings.surface);
      existing.getResources = settings.getResources;
      existing.onMentionsChange = settings.onMentionsChange;
      syncSubmissionGuard(existing);
      renderController(existing);
      return existing.publicApi;
    }
    if (existing) unmountTextarea(textarea);

    const documentRef = textarea.ownerDocument;
    const host = textarea.parentNode;
    const editor = documentRef.createElement("div");
    editor.className = "nf-resource-mention-editor";
    editor.dataset.nfResourceMentionVersion = RESOURCE_MENTION_TOOL_VERSION;
    editor.setAttribute("data-novaflow-runtime-ignore", "1");
    editor.setAttribute("contenteditable", "true");
    editor.setAttribute("role", "textbox");
    editor.setAttribute("aria-multiline", "true");
    editor.setAttribute(
      "aria-label",
      textarea.getAttribute("aria-label") || textarea.placeholder || "提示词"
    );
    editor.dataset.placeholder = textarea.placeholder || "";
    editor.spellcheck = textarea.spellcheck;

    const controller = {
      textarea: textarea,
      editor: editor,
      host: host,
      document: documentRef,
      surface: normalizeSurface(settings.surface),
      getResources: settings.getResources,
      onMentionsChange: settings.onMentionsChange,
      descriptors: [],
      renderSignature: null,
      handlers: {},
      composing: false,
      compositionCommitTimer: null,
      writingBacking: false,
      originalAriaHidden: textarea.getAttribute("aria-hidden"),
      originalTabIndex: textarea.getAttribute("tabindex"),
      hostHadClass: host.classList.contains("nf-resource-mention-host"),
      hostHadStaticClass: host.classList.contains("nf-resource-mention-host-static"),
      publicApi: null,
      resizeObserver: null,
      guardWorkspace: null,
      errorPortal: null
    };
    controller.publicApi = Object.freeze({
      textarea: textarea,
      editor: editor,
      refresh: function () { renderController(controller); },
      focus: function (options) { return focusEditor(controller, options); },
      unmount: function () { return unmountTextarea(textarea); }
    });

    const view = documentRef.defaultView || window;
    const hostStyle = view.getComputedStyle ? view.getComputedStyle(host) : null;
    host.classList.add("nf-resource-mention-host");
    if (hostStyle && hostStyle.position === "static") {
      host.classList.add("nf-resource-mention-host-static");
    }
    textarea.classList.add("nf-resource-mention-backing");
    textarea.setAttribute("aria-hidden", "true");
    textarea.setAttribute("tabindex", "-1");
    host.appendChild(editor);

    controllerByTextarea.set(textarea, controller);
    mountedControllers.add(controller);
    bindControllerEvents(controller);
    syncSubmissionGuard(controller);
    if (typeof view.ResizeObserver === "function") {
      controller.resizeObserver = new view.ResizeObserver(function () {
        positionEditor(controller);
      });
      controller.resizeObserver.observe(textarea);
    }
    renderController(controller);
    return controller.publicApi;
  }

  function unmountTextarea(textarea) {
    const controller = controllerByTextarea.get(textarea);
    if (!controller) {
      pruneDisconnectedControllers();
      return false;
    }
    closeMenu(controller);
    clearSubmissionError(controller);
    unbindControllerEvents(controller);
    if (controller.resizeObserver) controller.resizeObserver.disconnect();
    if (controller.editor.parentNode) {
      controller.editor.parentNode.removeChild(controller.editor);
    }
    textarea.classList.remove("nf-resource-mention-backing");
    if (controller.originalAriaHidden == null) {
      textarea.removeAttribute("aria-hidden");
    } else {
      textarea.setAttribute("aria-hidden", controller.originalAriaHidden);
    }
    if (controller.originalTabIndex == null) {
      textarea.removeAttribute("tabindex");
    } else {
      textarea.setAttribute("tabindex", controller.originalTabIndex);
    }
    controllerByTextarea.delete(textarea);
    mountedControllers.delete(controller);

    const hostHasController = Array.from(mountedControllers).some(function (entry) {
      return entry.host === controller.host;
    });
    if (!hostHasController) {
      if (!controller.hostHadClass) {
        controller.host.classList.remove("nf-resource-mention-host");
      }
      if (!controller.hostHadStaticClass) {
        controller.host.classList.remove("nf-resource-mention-host-static");
      }
    }
    const documentHasController = Array.from(mountedControllers).some(function (entry) {
      return entry.document === controller.document;
    });
    if (!documentHasController) destroyMenuForDocument(controller.document);
    return true;
  }

  function refreshSurface(surface) {
    const normalized = normalizeSurface(surface);
    Array.from(mountedControllers).forEach(function (controller) {
      if (!controller.textarea.isConnected || !controller.editor.isConnected) {
        unmountTextarea(controller.textarea);
        return;
      }
      if (!normalized || controller.surface === normalized) {
        syncSubmissionGuard(controller);
        renderController(controller);
      }
    });
    if (activeMenuState
      && (!activeMenuState.controller.textarea.isConnected
        || !activeMenuState.controller.editor.isConnected)) {
      unmountTextarea(activeMenuState.controller.textarea);
    }
  }

  window.NovaFlowResourceMentionTool = Object.freeze({
    version: RESOURCE_MENTION_TOOL_VERSION,
    UI_DESIGN_MAX_REFERENCES: UI_DESIGN_MAX_REFERENCES,
    mountTextarea: mountTextarea,
    unmountTextarea: unmountTextarea,
    refreshSurface: refreshSurface,
    compileText: compileText,
    uiDesignMentionBindingSnapshot: uiDesignMentionBindingSnapshot,
    overlayGeometry: overlayGeometry,
    protectText: protectText,
    restoreText: restoreText
  });
})();
