(function (root) {
  "use strict";

  const AI_SEQUENCE_SOURCE_OWNED_UPLOAD_KIND_CONFIG = Object.freeze({
    "ref_image": Object.freeze({ domKind: "\u53c2\u8003\u56fe1", label: "\u53c2\u8003\u56fe1", family: "image", accept: "image/*", inputFamily: "image-video", inputIndex: 0 }),
    "jimeng_image2_ref": Object.freeze({ domKind: "\u53c2\u8003\u56fe2", label: "\u53c2\u8003\u56fe2", family: "image", accept: "image/*", inputFamily: "image", inputIndex: 0 }),
    "jimeng_image3_ref": Object.freeze({ domKind: "\u53c2\u8003\u56fe3", label: "\u53c2\u8003\u56fe3", family: "image", accept: "image/*", inputFamily: "image", inputIndex: 1 }),
    "jimeng_image4_ref": Object.freeze({ domKind: "\u53c2\u8003\u56fe4", label: "\u53c2\u8003\u56fe4", family: "image", accept: "image/*", inputFamily: "image", inputIndex: 2 }),
    "jimeng_video_ref": Object.freeze({ domKind: "\u89c6\u9891\u53c2\u8003", label: "\u89c6\u9891\u53c2\u8003", family: "video", accept: "video/*", inputFamily: "video", inputIndex: 0 }),
    "jimeng_audio_ref": Object.freeze({ domKind: "\u58f0\u97f3\u53c2\u8003", label: "\u58f0\u97f3\u53c2\u8003", family: "audio", accept: "audio/*", inputFamily: "audio", inputIndex: 0 })
  });

  function canonicalAiSequenceSourceOwnedUploadKind(value) {
    const rawValue = String(value || "").trim();
    return Object.entries(AI_SEQUENCE_SOURCE_OWNED_UPLOAD_KIND_CONFIG).find(([kind, config]) => (
      kind === rawValue || config.domKind === rawValue
    ))?.[0] || "";
  }

  function getAiSequenceSourceOwnedUploadKind(dropzone) {
    const HTMLElementCtor = root.HTMLElement || root.Element;
    const slot = dropzone instanceof HTMLElementCtor
      ? (dropzone.matches("[data-ais-import]") ? dropzone : dropzone.closest("[data-ais-import]"))
      : null;
    if (!(slot instanceof HTMLElementCtor)) return "";
    const rawKind = canonicalAiSequenceSourceOwnedUploadKind(slot.getAttribute("data-ais-import"));
    if (!rawKind) return "";
    const referenceColumn = slot.closest('[data-novaflow-ai-reference-column="1"]');
    if (!(referenceColumn instanceof HTMLElementCtor)) return "";
    const requiredKinds = [
      "jimeng_image2_ref",
      "jimeng_image3_ref",
      "jimeng_image4_ref",
      "jimeng_video_ref",
      "jimeng_audio_ref"
    ];
    return requiredKinds.every((kind) => {
      const domKind = AI_SEQUENCE_SOURCE_OWNED_UPLOAD_KIND_CONFIG[kind]?.domKind || kind;
      return referenceColumn.querySelector(`[data-ais-import="${domKind}"]`) ||
        (domKind !== kind && referenceColumn.querySelector(`[data-ais-import="${kind}"]`));
    })
      ? rawKind
      : "";
  }

  function aiSequenceFileMatchesUploadKind(file, rawKind) {
    const FileCtor = root.File;
    if (typeof FileCtor === "function" && !(file instanceof FileCtor)) return false;
    if (!file || typeof file !== "object") return false;
    const config = AI_SEQUENCE_SOURCE_OWNED_UPLOAD_KIND_CONFIG[String(rawKind || "")];
    if (!config) return true;
    const mime = String(file.type || "").toLowerCase();
    const name = String(file.name || "").toLowerCase();
    if (config.family === "image") return mime.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|tiff?|jfif)$/i.test(name);
    if (config.family === "video") return mime.startsWith("video/") || /\.(mp4|webm|mov|m4v|avi|mkv)$/i.test(name);
    if (config.family === "audio") return mime.startsWith("audio/") || /\.(wav|mp3|m4a|aac|ogg|flac|opus)$/i.test(name);
    return false;
  }

  function findAiSequenceNativeInputByRawKind(dropzone, rawKind) {
    const HTMLElementCtor = root.HTMLElement || root.Element;
    const HTMLInputCtor = root.HTMLInputElement;
    const config = AI_SEQUENCE_SOURCE_OWNED_UPLOAD_KIND_CONFIG[String(rawKind || "")];
    if (!config || !(dropzone instanceof HTMLElementCtor) || typeof HTMLInputCtor !== "function") return null;
    const workspace = dropzone.closest('[data-novaflow-ai-bottom-workspace="1"]');
    if (!(workspace instanceof HTMLElementCtor)) return null;
    const inputs = Array.from(workspace.querySelectorAll('input[type="file"]')).filter((input) => (
      input instanceof HTMLInputCtor &&
      !input.disabled &&
      input.getAttribute("data-novaflow-ai-sequence-upload-click-proxy") !== "1" &&
      input.getAttribute("data-novaflow-ai-sequence-upload-picker") !== "1"
    ));
    const matchesFamily = (input) => {
      const accept = String(input.accept || "").toLowerCase();
      const image = accept.includes("image");
      const video = accept.includes("video");
      const audio = accept.includes("audio");
      if (config.inputFamily === "image-video") return image && video && !audio;
      if (config.inputFamily === "image") return image && !video && !audio;
      if (config.inputFamily === "video") return video && !image && !audio;
      if (config.inputFamily === "audio") return audio && !image && !video;
      return false;
    };
    return inputs.filter(matchesFamily)[config.inputIndex] || null;
  }

  function pauseAiSequenceMainPreviewForPromptAction(options = {}) {
    const doc = root.document;
    const HTMLButtonCtor = root.HTMLButtonElement;
    const HTMLVideoCtor = root.HTMLVideoElement;
    const normalizeText = options.normalizeText;
    const isVisible = options.isVisible;
    const video = options.getMainPreviewVideo?.();
    if (typeof HTMLVideoCtor !== "function" || !(video instanceof HTMLVideoCtor) || video.paused || video.ended) return false;
    const button = Array.from(doc.querySelectorAll('[data-novaflow-ai-playback-button="1"], button[title="\u6682\u505c"]'))
      .find((button) => (
        button instanceof HTMLButtonCtor &&
        !button.disabled &&
        isVisible(button) &&
        normalizeText(button.getAttribute("title") || "") === "\u6682\u505c"
      ));
    if (!(button instanceof HTMLButtonCtor)) return false;
    try {
      ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((type) => {
        const EventConstructor = type.startsWith("pointer") && typeof root.PointerEvent === "function"
          ? root.PointerEvent
          : root.MouseEvent;
        button.dispatchEvent(new EventConstructor(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: root,
          button: 0,
          buttons: type.endsWith("down") ? 1 : 0,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true
        }));
      });
      video.pause();
      return true;
    } catch (_) {
      return false;
    }
  }

  function handleAiSequencePromptActionAutoPauseCapture(event, options = {}) {
    if (!root.document?.body?.classList.contains("novaflow-primary-target-animation")) return false;
    const ElementCtor = root.Element;
    const HTMLElementCtor = root.HTMLElement || root.Element;
    const HTMLButtonCtor = root.HTMLButtonElement;
    const NOVAFLOW_PROMPT_ACTION_BUTTON_ATTR = String(options.promptActionButtonAttr || "data-novaflow-prompt-action-button");
    const target = event?.target instanceof ElementCtor ? event.target : null;
    if (!(target instanceof ElementCtor)) return false;
    const promptButton = target.closest(`[${NOVAFLOW_PROMPT_ACTION_BUTTON_ATTR}="1"]`);
    if (!(promptButton instanceof HTMLElementCtor) || !promptButton.closest('[data-novaflow-ai-bottom-workspace="1"]')) return false;
    if (promptButton instanceof HTMLButtonCtor && (promptButton.disabled || promptButton.getAttribute("aria-disabled") === "true")) return false;
    return pauseAiSequenceMainPreviewForPromptAction(options);
  }

  root.NovaFlowAiSequenceInputCompat = Object.freeze({
    uploadKindConfig: AI_SEQUENCE_SOURCE_OWNED_UPLOAD_KIND_CONFIG,
    getAiSequenceSourceOwnedUploadKind,
    aiSequenceFileMatchesUploadKind,
    findAiSequenceNativeInputByRawKind,
    pauseAiSequenceMainPreviewForPromptAction,
    handleAiSequencePromptActionAutoPauseCapture
  });
})(typeof window !== "undefined" ? window : globalThis);
