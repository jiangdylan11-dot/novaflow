(function (root) {
  "use strict";

  const TOOL_ID = "video-merge";
  const ENTRY_ATTR = "data-novaflow-ai-video-merge-entry";
  const IDLE_LABEL = "\u89c6\u9891\u5408\u5e76";
  const ACTIVE_LABEL = "\u4fdd\u5b58\u5e76\u5173\u95ed";
  const entryActivationHandlers = new WeakMap();
  const state = {
    active: false,
    boardId: "",
    activationKey: "",
    activationResult: null,
    previewHost: null,
    entry: null
  };

  function getWorkspace() {
    const workspace = root.NovaFlowAiSequenceVideoMergeWorkspace;
    return workspace && typeof workspace === "object" ? workspace : null;
  }

  function styleEntry(entry) {
    if (entry.getAttribute("data-novaflow-ai-video-merge-entry-styled") === "1") return;
    entry.setAttribute("data-novaflow-ai-video-merge-entry-styled", "1");
    Object.assign(entry.style, {
      width: "100%",
      minWidth: "0",
      maxWidth: "none",
      height: "34px",
      minHeight: "34px",
      gridColumn: "1 / -1",
      flex: "0 0 100%",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      marginTop: "0",
      padding: "0 12px",
      boxSizing: "border-box",
      border: "0",
      borderRadius: "8px",
      background: "rgba(255, 255, 255, 0.08)",
      color: "#f0f0f0",
      font: "inherit",
      lineHeight: "34px",
      cursor: "pointer"
    });
  }

  function applyEntryPresentation(entry, active) {
    if (!(entry instanceof HTMLElement)) return;
    styleEntry(entry);
    entry.textContent = IDLE_LABEL;
    entry.setAttribute("aria-label", IDLE_LABEL);
    entry.setAttribute("aria-pressed", active ? "true" : "false");
    entry.setAttribute("data-novaflow-ai-video-merge-entry-active", active ? "1" : "0");
    [
      "data-novaflow-ai-cutout-mode",
      "data-novaflow-ai-chroma-close",
      "data-novaflow-ai-cutout-saved",
      "data-novaflow-ai-cutout-stashed",
      "data-novaflow-ai-cutout-stash"
    ].forEach((attribute) => entry.removeAttribute(attribute));
    const background = "rgba(255, 255, 255, 0.08)";
    const color = "#f0f0f0";
    entry.style.setProperty("background", background, "important");
    entry.style.setProperty("background-color", background, "important");
    entry.style.setProperty("background-image", "none", "important");
    entry.style.setProperty("border", "0", "important");
    entry.style.setProperty("border-color", "transparent", "important");
    entry.style.setProperty("box-shadow", "none", "important");
    entry.style.setProperty("color", color, "important");
    entry.style.setProperty("outline", "0", "important");
  }

  function getMountedEntry() {
    if (state.entry instanceof HTMLElement && state.entry.isConnected) return state.entry;
    const entry = root.document?.querySelector?.(`[${ENTRY_ATTR}="1"]`);
    state.entry = entry instanceof HTMLElement ? entry : null;
    return state.entry;
  }

  function handleEntryClick(event) {
    const entry = event.currentTarget;
    if (!(entry instanceof HTMLElement)) return;
    if (entry.getAttribute("aria-disabled") === "true") {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const onRequestActivate = entryActivationHandlers.get(entry);
    if (typeof onRequestActivate !== "function") return;
    event.preventDefault();
    event.stopPropagation();
    onRequestActivate({ entry, event });
  }

  function mountEntry(options = {}) {
    const postSection = options.postSection;
    if (!(postSection instanceof HTMLElement)) return null;
    const anchor = options.anchor instanceof HTMLElement
      ? options.anchor
      : postSection.querySelector('[data-novaflow-ai-post-primary-action="1"]');
    if (!(anchor instanceof HTMLElement)) return null;

    let entry = postSection.querySelector(`[${ENTRY_ATTR}="1"]`);
    if (!(entry instanceof HTMLButtonElement)) {
      entry = document.createElement("button");
      entry.type = "button";
      entry.setAttribute(ENTRY_ATTR, "1");
      entry.setAttribute("data-novaflow-ai-sequence-tool", TOOL_ID);
      entry.setAttribute("aria-label", IDLE_LABEL);
      entry.setAttribute("aria-pressed", "false");
      entry.textContent = IDLE_LABEL;
      entry.addEventListener("click", handleEntryClick);
    }
    state.entry = entry;
    entryActivationHandlers.set(entry, options.onRequestActivate);
    styleEntry(entry);
    if (anchor.nextElementSibling !== entry) anchor.insertAdjacentElement("afterend", entry);
    return entry;
  }

  function activate(options = {}) {
    const workspace = getWorkspace();
    if (!workspace || typeof workspace.open !== "function") return false;
    const boardId = String(options.boardId || "board-1");
    const activationKey = `${boardId}:${String(options.activeTool || TOOL_ID)}`;
    const sameHost = state.previewHost === options.previewHost && options.previewHost?.isConnected !== false;
    const workspaceOpen = typeof workspace.isOpen !== "function" || workspace.isOpen();
    if (state.active && state.activationKey === activationKey && sameHost && workspaceOpen) return state.activationResult || true;
    if (state.active && state.activationKey !== activationKey) deactivate({ reason: "board-switch" });
    else if (state.active) deactivate({ reason: sameHost ? "workspace-reopen" : "preview-host-change" });
    state.active = true;
    state.boardId = boardId;
    state.activationKey = activationKey;
    state.previewHost = options.previewHost || null;
    const failActivation = (error) => {
      if (state.activationKey !== activationKey) return false;
      try { workspace.close?.({ reason: "activation-error" }); } catch (_) {}
      state.active = false;
      state.boardId = "";
      state.activationKey = "";
      state.activationResult = null;
      state.previewHost = null;
      applyEntryPresentation(getMountedEntry(), false);
      try { options.onActivationError?.(error); } catch (_) {}
      return false;
    };
    try {
      const result = workspace.open(options);
      state.activationResult = result || true;
      if (result && typeof result.then === "function") {
        result.catch(failActivation);
      }
      return result === undefined ? true : result;
    } catch (error) {
      return failActivation(error);
    }
  }

  function deactivate(options = {}) {
    const workspace = getWorkspace();
    const wasActive = state.active;
    state.active = false;
    state.boardId = "";
    state.activationKey = "";
    state.activationResult = null;
    state.previewHost = null;
    applyEntryPresentation(getMountedEntry(), false);
    if (!wasActive || !workspace || typeof workspace.close !== "function") return false;
    return workspace.close(options);
  }

  function saveAndClose() {
    const workspace = getWorkspace();
    if (!state.active || !workspace || typeof workspace.saveAndClose !== "function") {
      return Promise.resolve({ ok: false, inactive: true });
    }
    return Promise.resolve(workspace.saveAndClose());
  }

  function exportToFile() {
    const workspace = getWorkspace();
    if (!state.active || !workspace || typeof workspace.exportToFile !== "function") {
      return Promise.resolve({ ok: false, inactive: true });
    }
    return Promise.resolve(workspace.exportToFile());
  }

  function syncLifecycle(options = {}) {
    const entry = options.postSection instanceof HTMLElement ? mountEntry(options) : null;
    const shouldActivate = options.routeActive !== false
      && options.postExpanded !== false
      && options.mode === "editing"
      && options.activeTool === TOOL_ID;
    if (entry instanceof HTMLElement) {
      applyEntryPresentation(entry, shouldActivate);
    }
    if (shouldActivate) return activate(options);
    if (state.active) return deactivate({ reason: options.reason || "lifecycle-sync" });
    return false;
  }

  root.NovaFlowAiSequenceVideoMergeTool = Object.freeze({
    mountEntry,
    activate,
    syncLifecycle,
    deactivate,
    saveAndClose,
    exportToFile
  });
})(window);
