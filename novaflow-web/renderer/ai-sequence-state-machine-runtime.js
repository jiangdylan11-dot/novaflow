(function (global) {
  const MODES = new Set(["resource", "editor-preview", "editing"]);
  const TOOLS = new Set([null, "ai-cutout", "chroma-key", "color-correct", "video-merge"]);

  function cloneValue(value) {
    if (value === null || value === undefined) return value;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return value;
    }
  }

  function createToolCache(initial) {
    return {
      params: cloneValue(initial && initial.params ? initial.params : {}),
      result: initial && initial.result ? initial.result : null,
      dirty: Boolean(initial && initial.dirty)
    };
  }

  function resetToolCache(cache, dirty = false) {
    if (!cache) return;
    cache.params = {};
    cache.result = null;
    cache.dirty = Boolean(dirty);
  }

  function createSession(id, initial = {}) {
    const mode = MODES.has(initial.mode) ? initial.mode : "resource";
    const activeTool = mode === "editing" && TOOLS.has(initial.activeTool) ? initial.activeTool : null;
    return {
      id: String(id || "board-1"),
      sourceMedia: initial.sourceMedia || null,
      processedMedia: initial.processedMedia || null,
      editingDraft: initial.editingDraft || null,
      mode,
      activeTool,
      aiCutoutCache: createToolCache(initial.aiCutoutCache),
      chromaKeyCache: createToolCache(initial.chromaKeyCache),
      colorCorrectCache: createToolCache(initial.colorCorrectCache),
      videoMergeCache: createToolCache(initial.videoMergeCache)
    };
  }

  function cacheForTool(session, tool) {
    if (tool === "ai-cutout") return session.aiCutoutCache;
    if (tool === "chroma-key") return session.chromaKeyCache;
    if (tool === "color-correct") return session.colorCorrectCache;
    if (tool === "video-merge") return session.videoMergeCache;
    return null;
  }

  function canEnterEditorPreview(session, hasResource) {
    return Boolean(session && (hasResource || session.sourceMedia || session.processedMedia || session.mode === "editor-preview"));
  }

  function createController() {
    const sessions = new Map();
    let activeBoardId = null;

    function ensureSession(id = activeBoardId || "board-1", initial = {}) {
      const resolvedId = String(id || activeBoardId || "board-1");
      if (!sessions.has(resolvedId)) {
        sessions.set(resolvedId, createSession(resolvedId, initial));
      }
      if (!activeBoardId) activeBoardId = resolvedId;
      return sessions.get(resolvedId);
    }

    function setActiveBoard(id, initial = {}) {
      activeBoardId = String(id || "board-1");
      return ensureSession(activeBoardId, initial);
    }

    function getActiveSession() {
      return ensureSession(activeBoardId || "board-1");
    }

    function replaceSource(media, options = {}) {
      const session = getActiveSession();
      if (session.mode === "editing" && !options.force) return false;
      session.sourceMedia = media || null;
      session.processedMedia = null;
      session.editingDraft = null;
      session.activeTool = null;
      resetToolCache(session.aiCutoutCache, true);
      resetToolCache(session.chromaKeyCache, true);
      resetToolCache(session.colorCorrectCache, true);
      resetToolCache(session.videoMergeCache, true);
      if (!MODES.has(options.mode)) {
        session.mode = "resource";
      } else {
        session.mode = options.mode;
      }
      return true;
    }

    function expandTools(hasResource = false) {
      const session = getActiveSession();
      if (!canEnterEditorPreview(session, hasResource)) {
        session.mode = "resource";
        session.activeTool = null;
        session.editingDraft = null;
        return false;
      }
      session.mode = "editor-preview";
      session.activeTool = null;
      session.editingDraft = null;
      return true;
    }

    function collapseTools() {
      const session = getActiveSession();
      session.mode = "resource";
      session.activeTool = null;
      session.editingDraft = null;
      return true;
    }

    function cancelEditing(options = {}) {
      const session = getActiveSession();
      const tool = session.activeTool;
      if (session.mode !== "editing" || !tool) {
        session.mode = "resource";
        session.activeTool = null;
        session.editingDraft = null;
        return true;
      }
      if (options.clearCache !== false) {
        resetToolCache(cacheForTool(session, tool), false);
      }
      if (options.preserveMedia !== true) session.processedMedia = null;
      session.editingDraft = null;
      session.activeTool = null;
      session.mode = "resource";
      return true;
    }

    function beginTool(tool) {
      const session = getActiveSession();
      if (!TOOLS.has(tool) || tool === null || session.mode !== "editor-preview") return false;
      if (tool === "ai-cutout") resetToolCache(session.aiCutoutCache, true);
      if (tool === "chroma-key") resetToolCache(session.chromaKeyCache, true);
      if (tool === "video-merge") resetToolCache(session.videoMergeCache, true);
      session.mode = "editing";
      session.activeTool = tool;
      session.editingDraft = {
        tool,
        params: cloneValue(cacheForTool(session, tool).params),
        result: cacheForTool(session, tool).result
      };
      return true;
    }

    function saveAndClose(payload = {}) {
      const session = getActiveSession();
      if (session.mode !== "editing" || !session.activeTool) return false;
      if (session.activeTool === "ai-cutout") return commitAndClose(payload);
      const cache = cacheForTool(session, session.activeTool);
      if (!cache) return false;
      if (Object.prototype.hasOwnProperty.call(payload, "params")) cache.params = cloneValue(payload.params);
      if (Object.prototype.hasOwnProperty.call(payload, "result")) cache.result = payload.result;
      if (!cache.result && session.editingDraft && session.editingDraft.result) cache.result = session.editingDraft.result;
      cache.dirty = false;
      session.processedMedia = cache.result || session.processedMedia || session.sourceMedia;
      session.editingDraft = null;
      session.mode = "editor-preview";
      session.activeTool = null;
      return true;
    }

    function commitAndClose(payload = {}) {
      const session = getActiveSession();
      if (session.mode !== "editing" || !session.activeTool) return false;
      const cache = cacheForTool(session, session.activeTool);
      if (!cache) return false;
      if (Object.prototype.hasOwnProperty.call(payload, "params")) cache.params = cloneValue(payload.params);
      const result = Object.prototype.hasOwnProperty.call(payload, "result") ? payload.result : null;
      session.sourceMedia = result || session.sourceMedia || null;
      session.processedMedia = null;
      session.editingDraft = null;
      session.activeTool = null;
      resetToolCache(cache, false);
      session.mode = "resource";
      return true;
    }

    function addBoard(id, initial = {}) {
      const current = getActiveSession();
      if (current.mode === "editing") return null;
      const nextId = String(id || `board-${sessions.size + 1}`);
      const nextMode = current.mode === "editor-preview" ? "editor-preview" : "resource";
      const session = createSession(nextId, {
        ...initial,
        mode: initial.mode && initial.mode !== "editing" ? initial.mode : nextMode,
        activeTool: null
      });
      sessions.set(nextId, session);
      activeBoardId = nextId;
      return session;
    }

    function canAddBoard() {
      return getActiveSession().mode !== "editing";
    }

    function canUploadResource() {
      return getActiveSession().mode !== "editing";
    }

    function canDropResource(eventKind) {
      const session = getActiveSession();
      return session.mode !== "editing";
    }

    function snapshot() {
      return {
        activeBoardId,
        sessions: Array.from(sessions.values()).map((session) => ({
          id: session.id,
          sourceMedia: cloneValue(session.sourceMedia),
          processedMedia: cloneValue(session.processedMedia),
          mode: session.mode,
          activeTool: session.activeTool,
          aiCutoutCache: cloneValue(session.aiCutoutCache),
          chromaKeyCache: cloneValue(session.chromaKeyCache),
          colorCorrectCache: cloneValue(session.colorCorrectCache),
          videoMergeCache: cloneValue(session.videoMergeCache)
        }))
      };
    }

    return {
      ensureSession,
      setActiveBoard,
      getActiveSession,
      replaceSource,
      expandTools,
      collapseTools,
      cancelEditing,
      beginTool,
      saveAndClose,
      commitAndClose,
      addBoard,
      canAddBoard,
      canUploadResource,
      canDropResource,
      snapshot
    };
  }

  global.NovaFlowAiSequenceStateMachine = {
    createController,
    createSession,
    modes: Array.from(MODES),
    tools: Array.from(TOOLS).filter(Boolean)
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
