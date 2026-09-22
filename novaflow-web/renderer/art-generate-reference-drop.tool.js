(function (root) {
  "use strict";

  const RESOURCE_MIME = "application/x-novaflow-art-source-resource";
  const REFERENCE_SELECTOR = '[data-ais-import^="art_reference_"]';
  const WORKSPACE_SELECTOR = "#novaflow-art-generate-workspace";
  const DRAG_ACTIVE_ATTR = "data-novaflow-art-generate-ref-drag";

  let activeResourceId = "";
  let controller = null;
  let captureBound = false;

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
    const match = stringValue(slot?.getAttribute?.("data-ais-import")).match(/^art_reference_([1-3])$/);
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
        const file = files.find(isSupportedImageFile);
        if (!file) {
          reportRejected("请拖入 PNG/JPG/WebP 图片");
          return;
        }
        result = controller?.onFile?.(index, file);
      }
    } catch (error) {
      reportError(error);
      return;
    }
    Promise.resolve(result).catch(reportError);
  }

  function bindCapture() {
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

  root.NovaFlowArtGenerateReferenceDropTool = Object.freeze({
    RESOURCE_MIME,
    configure,
    beginResourceDrag,
    endResourceDrag,
    syncSourceResourceCards,
    filesFromDataTransfer,
    isSupportedImageFile,
    readResourceId,
    referenceIndex
  });
})(typeof window !== "undefined" ? window : globalThis);
