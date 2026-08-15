(function () {
  const ROOT_ID = "novaflow-source-island-root";
  const STYLE_ID = "novaflow-source-upload-island-bridge-style";
  const INPUT_ID = "novaflow-source-color-ref-native-input";
  const ACCEPTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
  const FLAG_NAMES = {
    master: "SOURCE_PARTIAL_REPLACEMENT",
    uploads: "SOURCE_UPLOAD_SURFACES"
  };

  const state = {
    root: null,
    objectUrl: null,
    cleanupCallbacks: [],
    legacyColorRefSnapshot: null,
    processingToolsSnapshot: null,
    lastMountSuppressed: false,
    observer: null,
    mountScheduled: false,
    mountAttempts: 0
  };

  function parseFlagValue(value) {
    if (value === true || value === 1) return true;
    if (value === false || value === 0) return false;
    if (typeof value !== "string") return null;
    const normalized = value.trim().toLowerCase();
    if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") return true;
    if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") return false;
    return null;
  }

  function readFlag(name) {
    try {
      const globalFlags = window.__NOVAFLOW_SOURCE_PARTIAL_FLAGS__;
      if (globalFlags && Object.prototype.hasOwnProperty.call(globalFlags, name)) {
        const parsed = parseFlagValue(globalFlags[name]);
        if (parsed !== null) return parsed;
        return false;
      }
    } catch (_) {}

    try {
      const params = new URLSearchParams(window.location?.search || "");
      if (params.has(name)) {
        const parsed = parseFlagValue(params.get(name));
        if (parsed !== null) return parsed;
        return false;
      }
    } catch (_) {}

    try {
      const value = window.localStorage?.getItem(name);
      if (value !== null && value !== undefined) {
        const parsed = parseFlagValue(value);
        if (parsed !== null) return parsed;
        return false;
      }
    } catch (_) {}

    return false;
  }

  function isPackagedDesktopRuntime() {
    try {
      return window.location?.protocol === "file:" && Boolean(window.electronAPI);
    } catch (_) {
      return false;
    }
  }

  function isEnabled() {
    if (isPackagedDesktopRuntime()) return true;
    return readFlag(FLAG_NAMES.master) === true && readFlag(FLAG_NAMES.uploads) === true;
  }

  function appendText(parent, text) {
    parent.appendChild(document.createTextNode(text));
  }

  function createElement(tagName, attributes) {
    const element = document.createElement(tagName);
    Object.entries(attributes || {}).forEach(([name, value]) => {
      if (value === null || value === undefined) return;
      element.setAttribute(name, String(value));
    });
    return element;
  }

  function setAttributeIfChanged(element, name, value) {
    if (!(element instanceof HTMLElement)) return;
    const nextValue = String(value);
    if (element.getAttribute(name) !== nextValue) {
      element.setAttribute(name, nextValue);
    }
  }

  function removeAttributeIfPresent(element, name) {
    if (!(element instanceof HTMLElement)) return;
    if (element.hasAttribute(name)) {
      element.removeAttribute(name);
    }
  }

  function setStylePropertyIfChanged(element, property, value, priority = "") {
    if (!(element instanceof HTMLElement)) return;
    if (
      element.style.getPropertyValue(property) !== value ||
      element.style.getPropertyPriority(property) !== priority
    ) {
      element.style.setProperty(property, value, priority);
    }
  }

  function isBridgeRoot(node) {
    return (
      node instanceof HTMLElement &&
      node.id === ROOT_ID &&
      node.getAttribute("data-novaflow-source-owner") === "source-runtime" &&
      node.getAttribute("data-novaflow-source-upload-island-bridge") === "temporary-native-color-ref"
    );
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = createElement("style", { id: STYLE_ID });
    style.textContent = `
      #${ROOT_ID} {
        flex: 0 0 min(260px, 100%);
        width: min(260px, 100%);
        max-width: 100%;
        min-height: 120px;
        height: 120px;
        margin: 0 0 8px 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
        position: relative;
        z-index: 3;
        pointer-events: auto;
        box-sizing: border-box;
        border: 1px dashed #3a3a3a;
        border-radius: 12px;
        background: #1b1b1b;
        color: #e8e8e8;
        font-family: inherit;
        overflow: visible;
      }
      #${ROOT_ID}[hidden] {
        display: none !important;
      }
      #${ROOT_ID} * {
        box-sizing: border-box;
        -webkit-app-region: no-drag;
      }
      #${ROOT_ID} [data-novaflow-source-upload-card="color_ref"] {
        width: 100%;
        flex: 1 1 auto;
        min-height: 0;
        height: 100%;
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 16px !important;
        border: 0 !important;
        border-radius: inherit;
        background: transparent !important;
        color: #e8e8e8;
        cursor: pointer;
        pointer-events: auto;
        user-select: none;
        box-shadow: none;
        overflow: hidden;
      }
      #${ROOT_ID} [data-novaflow-source-upload-card="color_ref"][data-drag-active="1"],
      #${ROOT_ID} [data-novaflow-source-upload-card="color_ref"]:hover {
        background: transparent;
      }
      #${ROOT_ID}:has([data-novaflow-source-upload-card="color_ref"][data-drag-active="1"]),
      #${ROOT_ID}:hover {
        background: #242424;
        border-color: #21c487;
      }
      #${ROOT_ID} [data-novaflow-source-upload-card="color_ref"] > :not(input[type="file"]) {
        pointer-events: none;
      }
      #${ROOT_ID} [data-novaflow-source-upload-card-icon="1"] {
        font-size: 24px;
        line-height: 1;
        font-weight: 800;
        color: #e8e8e8;
      }
      #${ROOT_ID} [data-novaflow-source-upload-card-title="1"] {
        color: #e8e8e8;
        font-size: 13px;
        line-height: 1.35;
        font-weight: 800;
        text-align: center;
      }
      #${ROOT_ID} [data-novaflow-source-upload-card-hint="1"] {
        color: #a0a0a0;
        font-size: 12px;
        line-height: 1.35;
        text-align: center;
      }
      #${ROOT_ID} input[type="file"] {
        display: block !important;
        position: absolute !important;
        left: 0 !important;
        top: 0 !important;
        width: 1px !important;
        height: 1px !important;
        min-width: 1px !important;
        min-height: 1px !important;
        margin: 0 !important;
        padding: 0 !important;
        border: 0 !important;
        opacity: 0 !important;
        visibility: visible !important;
        clip: rect(0 0 0 0) !important;
        clip-path: inset(50%) !important;
        pointer-events: none !important;
        z-index: -1 !important;
      }
      #${ROOT_ID} [data-novaflow-source-color-ref-preview-wrap="1"] {
        display: none;
        position: absolute;
        inset: 10px;
        gap: 0;
        align-items: center;
        justify-content: center;
        min-width: 0;
        border-radius: 8px !important;
        background: #111;
        overflow: hidden;
        pointer-events: none;
      }
      #${ROOT_ID} [data-novaflow-source-color-ref-preview-wrap="1"][data-visible="1"] {
        display: flex;
      }
      #${ROOT_ID} [data-novaflow-source-color-ref-preview="1"] {
        width: 100%;
        height: 100%;
        flex: 1 1 auto;
        object-fit: contain;
        border-radius: 0;
        border: 0;
        background: #111;
      }
      #${ROOT_ID} [data-novaflow-source-color-ref-file-name="1"] {
        position: absolute;
        left: 8px;
        right: 8px;
        bottom: 8px;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: #f1f1f1;
        font-size: 11px;
        line-height: 18px;
        padding: 0 6px;
        border-radius: 5px;
        background: rgba(0, 0, 0, 0.58);
        text-align: center;
      }
      #${ROOT_ID} [data-novaflow-source-color-ref-status="1"] {
        min-height: 0;
        color: #a0a0a0;
        font-size: 12px;
        line-height: 1.35;
      }
      #${ROOT_ID} [data-novaflow-source-color-ref-status="1"]:empty {
        display: none;
      }
      #${ROOT_ID} button {
        position: absolute;
        top: 8px;
        right: 8px;
        z-index: 9;
        width: 28px;
        height: 28px;
        min-height: 28px;
        padding: 0;
        border: 1px solid #3a3a3a;
        border-radius: 10px;
        background: rgba(0, 0, 0, 0.72);
        color: #f3f3f3;
        font: inherit;
        font-size: 16px;
        line-height: 1;
        cursor: pointer;
      }
      #${ROOT_ID} button:disabled {
        display: none;
      }
      [data-novaflow-source-color-ref-legacy-hidden="1"] {
        display: none !important;
        pointer-events: none !important;
        visibility: hidden !important;
        width: 0 !important;
        min-width: 0 !important;
        max-width: 0 !important;
        height: 0 !important;
        min-height: 0 !important;
        max-height: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        border: 0 !important;
        outline: 0 !important;
        box-shadow: none !important;
        opacity: 0 !important;
        overflow: hidden !important;
      }
      #${ROOT_ID}[data-novaflow-source-island-placement="processing-tools"] {
        flex: 0 0 auto;
        width: 100% !important;
        max-width: 100% !important;
        height: 120px !important;
        min-height: 120px !important;
        max-height: 120px !important;
        margin: 12px 0 0 !important;
        box-sizing: border-box !important;
        border-radius: 8px;
        z-index: 5;
        order: 1;
      }
      #${ROOT_ID}[data-novaflow-source-island-placement="processing-tools"] [data-novaflow-source-upload-card="color_ref"] {
        border-radius: inherit;
      }
      #${ROOT_ID}[data-novaflow-source-island-placement="processing-tools"] [data-novaflow-source-upload-card-hint="1"] {
        display: none;
      }
      #${ROOT_ID}[hidden][data-novaflow-source-island-placement="processing-tools"] {
        display: none !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function revokeObjectUrl() {
    if (!state.objectUrl) return;
    try {
      URL.revokeObjectURL(state.objectUrl);
    } catch (_) {}
    state.objectUrl = null;
  }

  function updateStatus(root, message) {
    const status = root.querySelector('[data-novaflow-source-color-ref-status="1"]');
    if (status) {
      status.textContent = message || "";
    }
  }

  function clearSelection(root) {
    revokeObjectUrl();
    const input = root.querySelector(`#${INPUT_ID}`);
    const image = root.querySelector('[data-novaflow-source-color-ref-preview="1"]');
    const previewWrap = root.querySelector('[data-novaflow-source-color-ref-preview-wrap="1"]');
    const fileName = root.querySelector('[data-novaflow-source-color-ref-file-name="1"]');
    const clearButton = root.querySelector('[data-novaflow-source-color-ref-clear="1"]');
    if (input instanceof HTMLInputElement) {
      try {
        input.value = "";
      } catch (_) {}
    }
    if (image instanceof HTMLImageElement) image.removeAttribute("src");
    if (previewWrap instanceof HTMLElement) previewWrap.removeAttribute("data-visible");
    if (fileName) fileName.textContent = "\u672a\u9009\u62e9\u6587\u4ef6";
    if (clearButton instanceof HTMLButtonElement) clearButton.disabled = true;
    updateStatus(root, "");
  }

  function applyColorReferenceFile(root, file) {
    if (!file) {
      clearSelection(root);
      return;
    }
    if (!ACCEPTED_TYPES.has(file.type)) {
      clearSelection(root);
      updateStatus(root, "\u4ec5\u652f\u6301 PNG / JPG / WEBP");
      return;
    }

    revokeObjectUrl();
    const objectUrl = URL.createObjectURL(file);
    state.objectUrl = objectUrl;

    const image = root.querySelector('[data-novaflow-source-color-ref-preview="1"]');
    const previewWrap = root.querySelector('[data-novaflow-source-color-ref-preview-wrap="1"]');
    const fileName = root.querySelector('[data-novaflow-source-color-ref-file-name="1"]');
    const clearButton = root.querySelector('[data-novaflow-source-color-ref-clear="1"]');

    if (image instanceof HTMLImageElement) image.src = objectUrl;
    if (previewWrap instanceof HTMLElement) previewWrap.setAttribute("data-visible", "1");
    if (fileName) fileName.textContent = file.name;
    if (clearButton instanceof HTMLButtonElement) clearButton.disabled = false;
    updateStatus(root, "\u5df2\u56de\u586b\u672c\u5730 color_ref \u9884\u89c8");
  }

  function handleFileChange(root, input) {
    const file = input.files && input.files[0] ? input.files[0] : null;
    applyColorReferenceFile(root, file);
  }

  function buildIslandRoot() {
    const root = createElement("div", {
      id: ROOT_ID,
      "data-novaflow-source-island": "phase1",
      "data-novaflow-runtime-ignore": "1",
      "data-novaflow-source-owner": "source-runtime",
      "data-novaflow-source-layout": "1",
      "data-novaflow-source-upload-island-bridge": "temporary-native-color-ref"
    });

    const label = createElement("label", {
      for: INPUT_ID,
      "data-novaflow-source-upload-card": "color_ref",
      "data-novaflow-source-color-ref-label": "1"
    });
    const cardIcon = createElement("span", {
      "data-novaflow-source-upload-card-icon": "1"
    });
    appendText(cardIcon, "+");
    const cardTitle = createElement("span", {
      "data-novaflow-source-upload-card-title": "1"
    });
    appendText(cardTitle, "\u81ea\u5b9a\u4e49\u8272\u5f69\u53c2\u7167");
    const cardHint = createElement("span", {
      "data-novaflow-source-upload-card-hint": "1"
    });
    appendText(cardHint, "PNG / JPG / WEBP");
    const previewWrap = createElement("div", {
      "data-novaflow-source-color-ref-preview-wrap": "1"
    });
    const preview = createElement("img", {
      alt: "color_ref preview",
      "data-novaflow-source-color-ref-preview": "1"
    });
    const fileName = createElement("div", {
      "data-novaflow-source-color-ref-file-name": "1"
    });
    appendText(fileName, "\u672a\u9009\u62e9\u6587\u4ef6");
    previewWrap.appendChild(preview);
    previewWrap.appendChild(fileName);
    label.appendChild(cardIcon);
    label.appendChild(cardTitle);
    label.appendChild(cardHint);
    label.appendChild(previewWrap);
    const onDragEnter = (event) => {
      event.preventDefault();
      event.stopPropagation();
      label.setAttribute("data-drag-active", "1");
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const onDragOver = (event) => {
      event.preventDefault();
      event.stopPropagation();
      label.setAttribute("data-drag-active", "1");
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const onDragLeave = (event) => {
      if (!label.contains(event.relatedTarget)) {
        label.removeAttribute("data-drag-active");
      }
    };
    const onDrop = (event) => {
      event.preventDefault();
      event.stopPropagation();
      label.removeAttribute("data-drag-active");
      const file = event.dataTransfer?.files && event.dataTransfer.files[0] ? event.dataTransfer.files[0] : null;
      applyColorReferenceFile(root, file);
    };
    label.addEventListener("dragenter", onDragEnter);
    label.addEventListener("dragover", onDragOver);
    label.addEventListener("dragleave", onDragLeave);
    label.addEventListener("drop", onDrop);
    state.cleanupCallbacks.push(() => {
      label.removeEventListener("dragenter", onDragEnter);
      label.removeEventListener("dragover", onDragOver);
      label.removeEventListener("dragleave", onDragLeave);
      label.removeEventListener("drop", onDrop);
    });
    root.appendChild(label);

    const input = createElement("input", {
      id: INPUT_ID,
      type: "file",
      accept: "image/png,image/jpeg,image/webp",
      "data-novaflow-source-color-ref-input": "1"
    });
    const onInputChange = () => handleFileChange(root, input);
    input.addEventListener("change", onInputChange);
    state.cleanupCallbacks.push(() => input.removeEventListener("change", onInputChange));
    root.appendChild(input);

    const clearButton = createElement("button", {
      type: "button",
      disabled: "true",
      title: "\u6e05\u9664",
      "aria-label": "\u6e05\u9664\u81ea\u5b9a\u4e49\u8272\u5f69\u53c2\u7167",
      "data-novaflow-source-color-ref-clear": "1"
    });
    appendText(clearButton, "\u00d7");
    const onClear = (event) => {
      event.preventDefault();
      event.stopPropagation();
      clearSelection(root);
    };
    clearButton.addEventListener("click", onClear);
    state.cleanupCallbacks.push(() => clearButton.removeEventListener("click", onClear));
    root.appendChild(clearButton);

    const status = createElement("div", {
      "data-novaflow-source-color-ref-status": "1"
    });
    root.appendChild(status);
    clearSelection(root);

    return root;
  }

  function clearRootHidden(root) {
    if (!(root instanceof HTMLElement)) return;
    removeAttributeIfPresent(root, "hidden");
    removeAttributeIfPresent(root, "data-novaflow-source-island-hidden");
  }

  function resolveMountContainer() {
    return (
      document.querySelector('[data-novaflow-ai-post-section="1"]') ||
      document.querySelector('[data-novaflow-ai-generation-panel="1"]') ||
      document.querySelector('[data-novaflow-ai-bottom-workspace="1"]') ||
      null
    );
  }

  function isProcessingToolsSection(node) {
    return node instanceof HTMLElement && node.getAttribute("data-novaflow-ai-post-section") === "1";
  }

  function isProcessingToolsExpanded(section) {
    if (!isProcessingToolsSection(section)) return true;
    const collapsed = section.getAttribute("data-novaflow-ai-post-collapsed");
    if (collapsed === "0" || collapsed === "false") return true;
    if (collapsed === "1" || collapsed === "true") return false;

    const heading = section.querySelector('[data-novaflow-ai-collapse-heading="post"]');
    if (heading instanceof HTMLElement) {
      const ariaExpanded = heading.getAttribute("aria-expanded");
      if (ariaExpanded === "true") return true;
      if (ariaExpanded === "false") return false;
      const headingCollapsed = heading.getAttribute("data-collapsed");
      if (headingCollapsed === "0" || headingCollapsed === "false") return true;
      if (headingCollapsed === "1" || headingCollapsed === "true") return false;
    }

    const body = section.querySelector('[data-novaflow-ai-post-body-item="1"]');
    if (body instanceof HTMLElement) {
      const rect = body.getBoundingClientRect();
      return getComputedStyle(body).display !== "none" && rect.width > 0 && rect.height > 0;
    }
    return false;
  }

  function setRootVisible(root, visible) {
    if (!(root instanceof HTMLElement)) return;
    if (visible) {
      clearRootHidden(root);
    } else {
      setAttributeIfChanged(root, "hidden", "");
      setAttributeIfChanged(root, "data-novaflow-source-island-hidden", "processing-tools-collapsed");
    }
  }

  function syncBridgeVisibility(root, container) {
    if (!isBridgeRoot(root) || !(container instanceof HTMLElement)) return;
    if (isProcessingToolsSection(container)) {
      clearRootHidden(root);
      return;
    }

    setRootVisible(root, true);
  }

  function findLegacyColorReference(scope = document) {
    if (!scope || typeof scope.querySelector !== "function") return null;
    const legacy = scope.querySelector('[data-ais-import="color_ref"]');
    return legacy instanceof HTMLElement ? legacy : null;
  }

  function hideLegacyColorReference(scope = document) {
    const legacy = findLegacyColorReference(scope);
    if (!(legacy instanceof HTMLElement) || legacy.closest(`#${ROOT_ID}`)) return;
    if (state.legacyColorRefSnapshot?.element !== legacy) {
      state.legacyColorRefSnapshot = {
        element: legacy,
        style: legacy.getAttribute("style"),
        ariaHidden: legacy.getAttribute("aria-hidden"),
        hidden: legacy.hasAttribute("hidden"),
        marker: legacy.getAttribute("data-novaflow-source-color-ref-legacy-hidden"),
        inert: legacy.getAttribute("inert")
      };
    }

    setAttributeIfChanged(legacy, "data-novaflow-source-color-ref-legacy-hidden", "1");
    setAttributeIfChanged(legacy, "aria-hidden", "true");
    setAttributeIfChanged(legacy, "hidden", "");
    setAttributeIfChanged(legacy, "inert", "");
    setStylePropertyIfChanged(legacy, "display", "none", "important");
    setStylePropertyIfChanged(legacy, "visibility", "hidden", "important");
    setStylePropertyIfChanged(legacy, "pointer-events", "none", "important");
    setStylePropertyIfChanged(legacy, "width", "0", "important");
    setStylePropertyIfChanged(legacy, "min-width", "0", "important");
    setStylePropertyIfChanged(legacy, "max-width", "0", "important");
    setStylePropertyIfChanged(legacy, "height", "0", "important");
    setStylePropertyIfChanged(legacy, "min-height", "0", "important");
    setStylePropertyIfChanged(legacy, "max-height", "0", "important");
    setStylePropertyIfChanged(legacy, "margin", "0", "important");
    setStylePropertyIfChanged(legacy, "padding", "0", "important");
    setStylePropertyIfChanged(legacy, "border", "0", "important");
    setStylePropertyIfChanged(legacy, "outline", "0", "important");
    setStylePropertyIfChanged(legacy, "box-shadow", "none", "important");
    setStylePropertyIfChanged(legacy, "opacity", "0", "important");
    setStylePropertyIfChanged(legacy, "overflow", "hidden", "important");
  }

  function restoreLegacyColorReference() {
    const snapshot = state.legacyColorRefSnapshot;
    if (!snapshot?.element) return;
    const { element, style, ariaHidden, hidden, marker, inert } = snapshot;
    if (style === null) {
      removeAttributeIfPresent(element, "style");
    } else {
      setAttributeIfChanged(element, "style", style);
    }
    if (ariaHidden === null) {
      removeAttributeIfPresent(element, "aria-hidden");
    } else {
      setAttributeIfChanged(element, "aria-hidden", ariaHidden);
    }
    if (hidden) {
      setAttributeIfChanged(element, "hidden", "");
    } else {
      removeAttributeIfPresent(element, "hidden");
    }
    if (marker === null) {
      removeAttributeIfPresent(element, "data-novaflow-source-color-ref-legacy-hidden");
    } else {
      setAttributeIfChanged(element, "data-novaflow-source-color-ref-legacy-hidden", marker);
    }
    if (inert === null) {
      removeAttributeIfPresent(element, "inert");
    } else {
      setAttributeIfChanged(element, "inert", inert);
    }
    state.legacyColorRefSnapshot = null;
  }

  function prepareProcessingToolsSection(section) {
    if (!isProcessingToolsSection(section)) return;
    if (state.processingToolsSnapshot?.element !== section) {
      state.processingToolsSnapshot = {
        element: section,
        style: section.getAttribute("style"),
        marker: section.getAttribute("data-novaflow-source-color-ref-host")
      };
    }

    setAttributeIfChanged(section, "data-novaflow-source-color-ref-host", "1");
    setStylePropertyIfChanged(section, "height", "282px", "important");
    setStylePropertyIfChanged(section, "min-height", "282px", "important");
    setStylePropertyIfChanged(section, "max-height", "none", "important");
    setStylePropertyIfChanged(section, "overflow", "visible", "important");
    setStylePropertyIfChanged(section, "position", "relative", "important");
  }

  function restoreProcessingToolsSection() {
    const snapshot = state.processingToolsSnapshot;
    if (!snapshot?.element) return;
    const { element, style, marker } = snapshot;
    if (style === null) {
      removeAttributeIfPresent(element, "style");
    } else {
      setAttributeIfChanged(element, "style", style);
    }
    if (marker === null) {
      removeAttributeIfPresent(element, "data-novaflow-source-color-ref-host");
    } else {
      setAttributeIfChanged(element, "data-novaflow-source-color-ref-host", marker);
    }
    state.processingToolsSnapshot = null;
  }

  function findProcessingToolsBodyHost(section) {
    if (!isProcessingToolsSection(section)) return null;
    const host = section.querySelector('[data-novaflow-ai-post-content-shell="1"]');
    if (host instanceof HTMLElement) return host;

    const heading = section.querySelector('[data-novaflow-ai-collapse-heading="post"]');
    return Array.from(section.children).find((child) => (
      child instanceof HTMLElement &&
      child !== heading &&
      child.id !== ROOT_ID &&
      child.getAttribute("data-novaflow-ai-post-body-item") === "1"
    )) || null;
  }

  function isRootPlacedForContainer(root, container) {
    if (!(root instanceof HTMLElement) || !(container instanceof HTMLElement)) return false;
    if (isProcessingToolsSection(container)) {
      const host = findProcessingToolsBodyHost(container);
      if (host instanceof HTMLElement) {
        return root.parentElement === host && root.getAttribute("data-novaflow-source-island-placement") === "processing-tools";
      }
      return root.parentElement === container && root.getAttribute("data-novaflow-source-island-placement") === "processing-tools";
    }
    return container.contains(root);
  }

  function placeRoot(root, container) {
    if (isProcessingToolsSection(container)) {
      const bodyHost = findProcessingToolsBodyHost(container);
      if (!(bodyHost instanceof HTMLElement)) return false;

      clearRootHidden(root);
      setAttributeIfChanged(root, "data-novaflow-source-island-placement", "processing-tools");
      removeAttributeIfPresent(root, "data-novaflow-ai-post-body-item");
      if (root.parentElement !== bodyHost || bodyHost.firstChild !== root) {
        bodyHost.insertBefore(root, bodyHost.firstChild);
      }
      return true;
    }

    restoreProcessingToolsSection();
    removeAttributeIfPresent(root, "data-novaflow-source-island-placement");
    removeAttributeIfPresent(root, "data-novaflow-ai-post-body-item");
    const legacyColorRef = findLegacyColorReference(container);
    if (legacyColorRef instanceof HTMLElement && legacyColorRef.parentElement instanceof HTMLElement) {
      if (root.parentElement !== legacyColorRef.parentElement || root.nextElementSibling !== legacyColorRef) {
        legacyColorRef.parentElement.insertBefore(root, legacyColorRef);
      }
      hideLegacyColorReference(container);
      return true;
    }

    const referenceUpload = Array.from(container.querySelectorAll('[data-ais-import], [data-novaflow-ai-post-reference-dropzone="1"]'))
      .find((node) => node instanceof HTMLElement && node.getAttribute("data-ais-import") !== "color_ref");
    if (referenceUpload instanceof HTMLElement && referenceUpload.parentElement instanceof HTMLElement) {
      if (root.parentElement !== referenceUpload.parentElement || root.nextElementSibling !== referenceUpload) {
        referenceUpload.parentElement.insertBefore(root, referenceUpload);
      }
      hideLegacyColorReference(container);
      return true;
    }
    if (root.parentElement !== container || container.firstChild !== root) {
      container.insertBefore(root, container.firstChild);
    }
    hideLegacyColorReference(container);
    return true;
  }

  function mount() {
    if (!isEnabled()) {
      state.lastMountSuppressed = false;
      unmount();
      return false;
    }
    const container = resolveMountContainer();
    if (!(container instanceof HTMLElement)) return false;

    ensureStyle();
    const existing = document.getElementById(ROOT_ID);
    if (
      isProcessingToolsSection(container) &&
      !(findProcessingToolsBodyHost(container) instanceof HTMLElement) &&
      !(existing instanceof HTMLElement)
    ) {
      return false;
    }
    state.lastMountSuppressed = false;
    if (existing instanceof HTMLElement) {
      if (!isBridgeRoot(existing)) return false;
      state.root = existing;
      if (!isRootPlacedForContainer(existing, container) && !placeRoot(existing, container)) return false;
      hideLegacyColorReference(container);
      syncBridgeVisibility(existing, container);
      return true;
    }

    const root = buildIslandRoot();
    if (!placeRoot(root, container)) return false;
    state.root = root;
    hideLegacyColorReference(container);
    syncBridgeVisibility(root, container);
    return true;
  }

  function unmount() {
    const root = state.root || document.getElementById(ROOT_ID);
    state.cleanupCallbacks.splice(0).reverse().forEach((cleanup) => {
      try {
        cleanup();
      } catch (_) {}
    });
    revokeObjectUrl();
    restoreLegacyColorReference();
    restoreProcessingToolsSection();
    if (isBridgeRoot(root)) {
      root.parentNode?.removeChild(root);
    }
    const style = document.getElementById(STYLE_ID);
    if (style) style.parentNode?.removeChild(style);
    state.root = null;
  }

  function scheduleMount() {
    if (mount()) {
      state.mountAttempts = 0;
      return;
    }
    if (!isEnabled()) return;
    if (state.lastMountSuppressed) {
      state.mountAttempts = 0;
      return;
    }
    if (state.mountAttempts >= 80) return;
    state.mountAttempts += 1;
    window.setTimeout(scheduleMount, state.mountAttempts < 20 ? 120 : 300);
  }

  function startObserver() {
    if (state.observer || typeof MutationObserver !== "function" || !document.documentElement) return;
    state.observer = new MutationObserver(() => {
      if (state.mountScheduled) return;
      state.mountScheduled = true;
      const run = () => {
        state.mountScheduled = false;
        if (resolveMountContainer() instanceof HTMLElement || document.getElementById(ROOT_ID)) {
          state.mountAttempts = 0;
        }
        scheduleMount();
      };
      if (typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(run);
        });
      } else {
        window.setTimeout(run, 80);
      }
    });
    state.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "data-novaflow-ai-post-collapsed",
        "data-novaflow-ai-post-body-item",
        "data-novaflow-ai-post-content-shell",
        "aria-expanded",
        "data-collapsed",
        "data-novaflow-ai-sequence-mode",
        "class"
      ]
    });
    state.cleanupCallbacks.push(() => {
      state.observer?.disconnect();
      state.observer = null;
    });
  }

  function start() {
    if (!isEnabled()) {
      unmount();
      return;
    }
    scheduleMount();
    startObserver();
    window.addEventListener("beforeunload", unmount, { once: true });
    state.cleanupCallbacks.push(() => window.removeEventListener("beforeunload", unmount));
  }

  window.__NovaFlowSourceUploadIslandBridge = {
    isEnabled,
    mount,
    unmount
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
