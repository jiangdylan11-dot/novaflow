(function (root) {
  "use strict";

  const RESOURCE_MIME = "application/x-novaflow-art-source-resource";
  const REFERENCE_SELECTOR = '[data-ais-import^="art_reference_"]';
  const WORKSPACE_SELECTOR = "#novaflow-art-generate-workspace";
  const DRAG_ACTIVE_ATTR = "data-novaflow-art-generate-ref-drag";
  const DRAG_GHOST_SIZE = 48;
  const DRAG_GHOST_HOST_ATTR = "data-novaflow-drag-ghost-host";

  let activeResourceId = "";
  let controller = null;
  let captureBound = false;
  let ghostCaptureBound = false;
  let ghostCanvas = null;

  function stringValue(value) {
    return value == null ? "" : String(value);
  }

  function dataTransferTypes(dataTransfer) {
    try {
      return Array.from(dataTransfer?.types || []).map((type) => stringValue(type));
    } catch (_) {
      return [];
    }
  }

  function isSupportedImageFile(file) {
    if (!file || typeof file !== "object") return false;
    const mime = stringValue(file.type).trim();
    const name = stringValue(file.name).trim();
    return /^image\/(?:png|jpe?g|webp)$/i.test(mime) || /\.(?:png|jpe?g|webp)$/i.test(name);
  }

  function filesFromDataTransfer(dataTransfer) {
    const files = [];
    const seen = new Set();
    const append = (file) => {
      if (!file || typeof file !== "object" || seen.has(file)) return;
      seen.add(file);
      files.push(file);
    };
    try {
      Array.from(dataTransfer?.files || []).forEach(append);
    } catch (_) {}
    try {
      Array.from(dataTransfer?.items || []).forEach((item) => {
        if (!item || (item.kind && item.kind !== "file") || typeof item.getAsFile !== "function") return;
        append(item.getAsFile());
      });
    } catch (_) {}
    return files;
  }

  function beginResourceDrag(event, resourceId) {
    const id = stringValue(resourceId).trim();
    const dataTransfer = event?.dataTransfer;
    if (!id || !dataTransfer || typeof dataTransfer.setData !== "function") return false;
    try {
      dataTransfer.setData(RESOURCE_MIME, id);
      dataTransfer.effectAllowed = "copy";
      activeResourceId = id;
      return true;
    } catch (_) {
      activeResourceId = "";
      return false;
    }
  }

  function endResourceDrag() {
    activeResourceId = "";
    clearDragState();
  }

  function readResourceId(source) {
    const dataTransfer = source?.dataTransfer || source;
    let value = "";
    try {
      if (dataTransfer && typeof dataTransfer.getData === "function") {
        value = stringValue(dataTransfer.getData(RESOURCE_MIME)).trim();
      }
    } catch (_) {}
    if (value) return value;
    if (hasFilePayload(dataTransfer)) return "";
    return activeResourceId;
  }

  function hasResourcePayload(dataTransfer) {
    return dataTransferTypes(dataTransfer).includes(RESOURCE_MIME) || Boolean(activeResourceId);
  }

  function hasFilePayload(dataTransfer) {
    if (filesFromDataTransfer(dataTransfer).length) return true;
    return dataTransferTypes(dataTransfer).some((type) => type.toLowerCase() === "files");
  }

  function isReferenceSlot(node) {
    const ElementCtor = root.Element;
    if (typeof ElementCtor !== "function" || !(node instanceof ElementCtor)) return false;
    if (!node.matches(REFERENCE_SELECTOR)) return false;
    return Boolean(node.closest(WORKSPACE_SELECTOR));
  }

  function closestReferenceSlot(node) {
    const ElementCtor = root.Element;
    if (typeof ElementCtor !== "function" || !(node instanceof ElementCtor)) return null;
    const slot = node.matches(REFERENCE_SELECTOR) ? node : node.closest(REFERENCE_SELECTOR);
    return isReferenceSlot(slot) ? slot : null;
  }

  function referenceSlotFromEvent(event) {
    const direct = closestReferenceSlot(event?.target);
    if (direct) return direct;
    const clientX = Number(event?.clientX);
    const clientY = Number(event?.clientY);
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
    try {
      return closestReferenceSlot(root.document?.elementFromPoint?.(clientX, clientY));
    } catch (_) {
      return null;
    }
  }

  function referenceIndex(slot) {
    const match = stringValue(slot?.getAttribute?.("data-ais-import")).match(/^art_reference_([1-9][0-9]?)$/);
    return match ? Number(match[1]) - 1 : -1;
  }

  function isEnabled() {
    try {
      return controller?.isEnabled?.() === true;
    } catch (_) {
      return false;
    }
  }

  function canHandle(event) {
    if (!isEnabled()) return false;
    const slot = referenceSlotFromEvent(event);
    if (!slot || referenceIndex(slot) < 0) return false;
    const dataTransfer = event?.dataTransfer;
    return hasResourcePayload(dataTransfer) || hasFilePayload(dataTransfer);
  }

  function stopEvent(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    try {
      event?.stopImmediatePropagation?.();
    } catch (_) {}
  }

  function setDragState(slot, active) {
    if (!slot) return;
    if (active) slot.setAttribute(DRAG_ACTIVE_ATTR, "1");
    else slot.removeAttribute(DRAG_ACTIVE_ATTR);
  }

  function clearDragState() {
    try {
      root.document?.querySelectorAll?.(`[${DRAG_ACTIVE_ATTR}]`).forEach((slot) => setDragState(slot, false));
    } catch (_) {}
  }

  function syncSourceResourceCards(enabled) {
    if (enabled !== true) {
      activeResourceId = "";
      clearDragState();
    }
    try {
      root.document?.querySelectorAll?.('[data-novaflow-source-resource-card="1"]').forEach((card) => {
        const unlocked = card.getAttribute("aria-disabled") !== "true";
        const active = enabled === true && unlocked;
        card.setAttribute("draggable", active ? "true" : "false");
        if (unlocked && card.style) card.style.cursor = active ? "grab" : "pointer";
      });
    } catch (_) {}
  }

  function setCopyDropEffect(event) {
    try {
      event.dataTransfer.dropEffect = "copy";
    } catch (_) {}
  }

  function reportRejected(message) {
    try {
      controller?.onReject?.(message);
    } catch (_) {}
  }

  function reportError(error) {
    try {
      controller?.onError?.(error);
    } catch (_) {}
  }

  function handleDragEnterOrOver(event) {
    if (!canHandle(event)) return;
    const slot = referenceSlotFromEvent(event);
    stopEvent(event);
    setCopyDropEffect(event);
    setDragState(slot, true);
  }

  function handleDragLeave(event) {
    if (!isEnabled()) return;
    if (!hasResourcePayload(event?.dataTransfer) && !hasFilePayload(event?.dataTransfer)) return;
    const slot = closestReferenceSlot(event?.target);
    if (!slot) return;
    const relatedSlot = closestReferenceSlot(event?.relatedTarget);
    if (relatedSlot === slot) return;
    stopEvent(event);
    setDragState(slot, false);
  }

  function handleDrop(event) {
    if (!canHandle(event)) return;
    const slot = referenceSlotFromEvent(event);
    const index = referenceIndex(slot);
    const resourceId = readResourceId(event);
    const files = filesFromDataTransfer(event?.dataTransfer);
    stopEvent(event);
    setDragState(slot, false);
    activeResourceId = "";

    let result;
    try {
      if (resourceId) {
        result = controller?.onResource?.(index, resourceId);
      } else {
        const images = files.filter(isSupportedImageFile);
        if (!images.length) {
          reportRejected("请拖入 PNG/JPG/WebP 图片");
          return;
        }
        // Several images at once fill this slot and the empty ones after it (a 2.1 node takes 10).
        result = images.length > 1 && typeof controller?.onFiles === "function"
          ? controller.onFiles(index, images)
          : controller?.onFile?.(index, images[0]);
      }
    } catch (error) {
      reportError(error);
      return;
    }
    Promise.resolve(result).catch(reportError);
  }

  // The browser's default drag ghost is the whole card (or the picture itself, up to 200px) anchored
  // at the grab point, so it looks big and off the cursor. Every drag of a picture, or of a card that
  // holds one, gets the same small thumbnail centred under the cursor instead.
  function ensureDragGhostCanvas() {
    const doc = root.document;
    if (ghostCanvas && ghostCanvas.isConnected) return ghostCanvas;
    if (!doc?.body || typeof doc.createElement !== "function") return null;
    const host = doc.createElement("div");
    host.setAttribute(DRAG_GHOST_HOST_ATTR, "1");
    host.setAttribute("aria-hidden", "true");
    host.style.cssText = `position:fixed;left:-1000px;top:-1000px;width:${DRAG_GHOST_SIZE}px;height:${DRAG_GHOST_SIZE}px;pointer-events:none;overflow:hidden;`;
    const dpr = Math.max(1, Math.min(3, Number(root.devicePixelRatio) || 1));
    const canvas = doc.createElement("canvas");
    canvas.width = Math.round(DRAG_GHOST_SIZE * dpr);
    canvas.height = Math.round(DRAG_GHOST_SIZE * dpr);
    canvas.style.cssText = `display:block;width:${DRAG_GHOST_SIZE}px;height:${DRAG_GHOST_SIZE}px;`;
    host.appendChild(canvas);
    doc.body.appendChild(host);
    ghostCanvas = canvas;
    return canvas;
  }

  function dragPreviewMedia(target) {
    const ElementCtor = root.Element;
    if (typeof ElementCtor !== "function" || !(target instanceof ElementCtor)) return null;
    if (target.matches("img, video, canvas")) return target;
    const source = target.closest('[draggable="true"]');
    return source ? source.querySelector("img, video, canvas") : null;
  }

  function dragMediaSize(media) {
    if (typeof root.HTMLImageElement === "function" && media instanceof root.HTMLImageElement) {
      return media.complete && media.naturalWidth ? [media.naturalWidth, media.naturalHeight] : null;
    }
    if (typeof root.HTMLVideoElement === "function" && media instanceof root.HTMLVideoElement) {
      return media.readyState >= 2 && media.videoWidth ? [media.videoWidth, media.videoHeight] : null;
    }
    if (typeof root.HTMLCanvasElement === "function" && media instanceof root.HTMLCanvasElement) {
      return media.width && media.height ? [media.width, media.height] : null;
    }
    return null;
  }

  function traceRoundedSquare(ctx, size, radius) {
    ctx.beginPath();
    ctx.moveTo(radius, 0);
    ctx.lineTo(size - radius, 0);
    ctx.arcTo(size, 0, size, radius, radius);
    ctx.lineTo(size, size - radius);
    ctx.arcTo(size, size, size - radius, size, radius);
    ctx.lineTo(radius, size);
    ctx.arcTo(0, size, 0, size - radius, radius);
    ctx.lineTo(0, radius);
    ctx.arcTo(0, 0, radius, 0, radius);
    ctx.closePath();
  }

  function paintDragGhost(canvas, media) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    const size = canvas.width;
    const scale = size / DRAG_GHOST_SIZE;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.globalAlpha = 0.92;
    traceRoundedSquare(ctx, size, 6 * scale);
    ctx.fillStyle = "#1f1f1f";
    ctx.fill();
    ctx.save();
    ctx.clip();
    const mediaSize = dragMediaSize(media);
    if (mediaSize) {
      const inner = size - 6 * scale;
      const fit = Math.min(inner / mediaSize[0], inner / mediaSize[1]);
      const width = mediaSize[0] * fit;
      const height = mediaSize[1] * fit;
      try {
        ctx.drawImage(media, (size - width) / 2, (size - height) / 2, width, height);
      } catch (_) {}
    }
    ctx.restore();
    traceRoundedSquare(ctx, size, 6 * scale);
    ctx.lineWidth = scale;
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.stroke();
    return true;
  }

  function decorateDragGhost(event) {
    const dataTransfer = event?.dataTransfer;
    if (!dataTransfer || typeof dataTransfer.setDragImage !== "function") return false;
    const media = dragPreviewMedia(event.target);
    if (!media) return false;
    const canvas = ensureDragGhostCanvas();
    if (!canvas) return false;
    try {
      if (!paintDragGhost(canvas, media)) return false;
      dataTransfer.setDragImage(canvas, DRAG_GHOST_SIZE / 2, DRAG_GHOST_SIZE / 2);
      return true;
    } catch (_) {
      return false;
    }
  }

  function bindDragGhostCapture() {
    if (ghostCaptureBound || !root.document?.addEventListener) return;
    ghostCaptureBound = true;
    root.document.addEventListener("dragstart", decorateDragGhost, true);
  }

  function bindCapture() {
    bindDragGhostCapture();
    if (captureBound || !root.document?.addEventListener) return;
    captureBound = true;
    root.document.addEventListener("dragenter", handleDragEnterOrOver, true);
    root.document.addEventListener("dragover", handleDragEnterOrOver, true);
    root.document.addEventListener("dragleave", handleDragLeave, true);
    root.document.addEventListener("drop", handleDrop, true);
  }

  function configure(options) {
    controller = options && typeof options === "object" ? options : null;
    bindCapture();
  }

  bindDragGhostCapture();

  root.NovaFlowArtGenerateReferenceDropTool = Object.freeze({
    RESOURCE_MIME,
    DRAG_GHOST_SIZE,
    configure,
    beginResourceDrag,
    endResourceDrag,
    decorateDragGhost,
    syncSourceResourceCards,
    filesFromDataTransfer,
    isSupportedImageFile,
    readResourceId,
    referenceIndex
  });
})(typeof window !== "undefined" ? window : globalThis);
