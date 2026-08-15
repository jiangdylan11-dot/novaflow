(() => {
  "use strict";

  const HOST_ATTRIBUTE = "data-novaflow-primary-entry-preview";
  const CAPTURE_METHOD = "windowCaptureContentFrame";
  let activeHandle = null;
  let captureGeneration = 0;
  let capturePromise = null;
  let lastSnapshot = Object.freeze({
    phase: "idle",
    generation: 0,
    width: 0,
    height: 0,
    captureMs: 0,
    totalMs: 0,
    reason: "init"
  });

  function setSnapshot(patch) {
    lastSnapshot = Object.freeze({
      ...lastSnapshot,
      ...patch
    });
  }

  function getCaptureProvider() {
    const provider = window.electronAPI?.[CAPTURE_METHOD];
    return typeof provider === "function" ? provider.bind(window.electronAPI) : null;
  }

  function isValidCapture(result) {
    const png = result?.png;
    const byteLength = png instanceof ArrayBuffer
      ? png.byteLength
      : (ArrayBuffer.isView(png) ? png.byteLength : 0);
    return Boolean(
      result?.ok === true &&
      byteLength > 0 &&
      Number(result.width) > 0 &&
      Number(result.height) > 0
    );
  }

  async function createPreviewHost(capture) {
    const pngBytes = capture.png instanceof ArrayBuffer
      ? new Uint8Array(capture.png)
      : new Uint8Array(capture.png.buffer, capture.png.byteOffset, capture.png.byteLength);
    const imageBlob = new Blob([pngBytes], { type: "image/png" });
    const imageUrl = URL.createObjectURL(imageBlob);
    const image = new Image();
    image.alt = "";
    image.decoding = "sync";
    image.draggable = false;
    image.src = imageUrl;
    try {
      await image.decode();
    } catch (error) {
      image.removeAttribute("src");
      URL.revokeObjectURL(imageUrl);
      throw error;
    }

    const host = document.createElement("div");
    host.setAttribute(HOST_ATTRIBUTE, "1");
    host.setAttribute("data-novaflow-runtime-ignore", "1");
    host.setAttribute("aria-hidden", "true");
    Object.assign(host.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      pointerEvents: "auto",
      overflow: "hidden",
      background: "#151515",
      cursor: "default"
    });

    const shadowRoot = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      :host { display: block; }
      img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: fill;
        user-select: none;
        -webkit-user-drag: none;
      }
    `;
    shadowRoot.append(style, image);
    document.documentElement.append(host);
    if (document.activeElement instanceof HTMLElement) {
      try { document.activeElement.blur(); } catch {}
    }
    const blockKeyboard = (event) => {
      if (event.altKey && event.key === "F4") return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", blockKeyboard, true);
    window.addEventListener("keyup", blockKeyboard, true);
    window.addEventListener("keypress", blockKeyboard, true);
    let resourcesReleased = false;
    return {
      host,
      releaseResources() {
        if (resourcesReleased) return;
        resourcesReleased = true;
        window.removeEventListener("keydown", blockKeyboard, true);
        window.removeEventListener("keyup", blockKeyboard, true);
        window.removeEventListener("keypress", blockKeyboard, true);
        image.removeAttribute("src");
        URL.revokeObjectURL(imageUrl);
      }
    };
  }

  function createHandle(previewHost, capture, generation) {
    const { host, releaseResources } = previewHost;
    let releaseFrame = 0;
    let released = false;

    const remove = (reason = "remove") => {
      if (released) return false;
      released = true;
      if (releaseFrame) window.cancelAnimationFrame(releaseFrame);
      releaseFrame = 0;
      releaseResources();
      host.remove();
      if (activeHandle === handle) activeHandle = null;
      setSnapshot({ phase: "released", reason });
      return Boolean(reason);
    };
    const releaseAfterPaint = (reason = "mounted") => {
      if (released || releaseFrame) return false;
      setSnapshot({ phase: "releasing", reason });
      releaseFrame = window.requestAnimationFrame(() => {
        releaseFrame = window.requestAnimationFrame(() => {
          releaseFrame = 0;
          remove(reason);
        });
      });
      return true;
    };
    const reacquire = () => {
      if (released || !host.isConnected) return false;
      if (releaseFrame) window.cancelAnimationFrame(releaseFrame);
      releaseFrame = 0;
      setSnapshot({ phase: "frozen", reason: "reacquired" });
      return true;
    };
    const handle = Object.freeze({
      isActive: () => !released && host.isConnected,
      reacquire,
      releaseAfterPaint,
      remove,
      snapshot: () => Object.freeze({
        active: !released && host.isConnected,
        generation,
        width: Number(capture.width) || 0,
        height: Number(capture.height) || 0,
        captureMs: Number(capture.captureMs) || 0,
        totalMs: Number(capture.totalMs) || 0
      })
    });
    return handle;
  }

  async function capture() {
    if (activeHandle?.isActive()) {
      activeHandle.reacquire();
      return activeHandle;
    }
    if (capturePromise) return capturePromise;
    const provider = getCaptureProvider();
    if (!provider) return null;

    const generation = ++captureGeneration;
    const totalStartedAt = performance.now();
    setSnapshot({
      phase: "capturing",
      generation,
      width: 0,
      height: 0,
      captureMs: 0,
      totalMs: 0,
      reason: "capture"
    });
    const pending = (async () => {
      let result = null;
      try {
        result = await provider();
      } catch {
        if (generation !== captureGeneration) return null;
        setSnapshot({ phase: "capture-failed", generation, reason: "provider-error" });
        return null;
      }
      if (generation !== captureGeneration) return null;
      if (!isValidCapture(result)) {
        setSnapshot({ phase: "capture-failed", generation, reason: "invalid-frame" });
        return null;
      }

      let previewHost = null;
      try {
        previewHost = await createPreviewHost(result);
      } catch {
        previewHost?.host?.remove();
        if (generation !== captureGeneration) return null;
        setSnapshot({ phase: "capture-failed", generation, reason: "decode-error" });
        return null;
      }
      if (generation !== captureGeneration) {
        previewHost.releaseResources();
        previewHost.host.remove();
        return null;
      }

      const captureEvidence = Object.freeze({
        width: Number(result.width) || 0,
        height: Number(result.height) || 0,
        captureMs: Number(result.captureMs) || 0,
        totalMs: Math.max(0, performance.now() - totalStartedAt)
      });
      const handle = createHandle(previewHost, captureEvidence, generation);
      activeHandle = handle;
      setSnapshot({
        phase: "frozen",
        generation,
        width: Number(result.width) || 0,
        height: Number(result.height) || 0,
        captureMs: Number(result.captureMs) || 0,
        totalMs: captureEvidence.totalMs,
        reason: "captured"
      });
      return handle;
    })();
    capturePromise = pending;
    try {
      return await pending;
    } finally {
      if (capturePromise === pending) capturePromise = null;
    }
  }

  function cancelPending(reason = "cancel-pending") {
    if (!capturePromise) return false;
    captureGeneration += 1;
    capturePromise = null;
    setSnapshot({ phase: "canceled", generation: captureGeneration, reason });
    return true;
  }

  function clear(reason = "clear") {
    const canceledPending = cancelPending(reason);
    if (!canceledPending) captureGeneration += 1;
    if (!activeHandle?.isActive()) {
      setSnapshot({ phase: "canceled", generation: captureGeneration, reason });
    }
    return activeHandle?.remove(reason) || false;
  }

  window.NovaFlowPrimaryEntryTransitionPreview = Object.freeze({
    isSupported: () => Boolean(getCaptureProvider()),
    capture,
    cancelPending,
    clear,
    hasActive: () => Boolean(activeHandle?.isActive()),
    snapshot: () => lastSnapshot
  });
})();
