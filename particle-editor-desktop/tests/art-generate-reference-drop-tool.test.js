const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const MODULE_PATH = path.resolve(
  __dirname,
  "../../particle-editor/art-generate-reference-drop.tool.js"
);
const MODULE_SOURCE = fs.readFileSync(MODULE_PATH, "utf8");
const BRAND_RUNTIME_PATH = path.resolve(
  __dirname,
  "../../particle-editor/novaflow-brand-runtime.js"
);
const BRAND_RUNTIME_SOURCE = fs.readFileSync(BRAND_RUNTIME_PATH, "utf8");

function extractNamedFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} should exist`);
  const paramsStart = source.indexOf("(", start);
  let paramsDepth = 0;
  let paramsEnd = -1;
  for (let index = paramsStart; index < source.length; index += 1) {
    if (source[index] === "(") paramsDepth += 1;
    if (source[index] === ")") {
      paramsDepth -= 1;
      if (paramsDepth === 0) {
        paramsEnd = index;
        break;
      }
    }
  }
  assert.notEqual(paramsEnd, -1, `${name} should have complete parameters`);
  const bodyStart = source.indexOf("{", paramsEnd);
  assert.notEqual(bodyStart, -1, `${name} should have a body`);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  assert.fail(`${name} should have a complete body`);
}

function loadTool() {
  const listeners = new Map();
  const workspace = {};

  class FakeElement {
    constructor(importKey = "", options = {}) {
      this.importKey = importKey;
      this.parent = options.parent || null;
      this.workspace = options.workspace === false ? null : workspace;
      this.attributes = new Map();
    }

    matches(selector) {
      return (
        selector === '[data-ais-import^="art_reference_"]' &&
        this.importKey.startsWith("art_reference_")
      );
    }

    closest(selector) {
      if (selector === '[data-ais-import^="art_reference_"]') {
        return this.matches(selector) ? this : this.parent?.closest?.(selector) || null;
      }
      if (selector === "#novaflow-art-generate-workspace") {
        return this.workspace || this.parent?.closest?.(selector) || null;
      }
      return null;
    }

    getAttribute(name) {
      if (name === "data-ais-import") return this.importKey;
      return this.attributes.get(name) || null;
    }

    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    }

    removeAttribute(name) {
      this.attributes.delete(name);
    }
  }

  const document = {
    addEventListener(type, listener, capture) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push({ listener, capture });
    },
    elementFromPoint() {
      return null;
    },
    querySelectorAll() {
      return [];
    }
  };
  const window = { document, Element: FakeElement };
  const context = vm.createContext({ window });
  vm.runInContext(MODULE_SOURCE, context, { filename: MODULE_PATH });

  return {
    api: window.NovaFlowArtGenerateReferenceDropTool,
    FakeElement,
    listeners
  };
}

function createDropEvent(target, dataTransfer) {
  const calls = {
    preventDefault: 0,
    stopPropagation: 0,
    stopImmediatePropagation: 0
  };
  return {
    calls,
    dataTransfer,
    target,
    preventDefault() {
      calls.preventDefault += 1;
    },
    stopPropagation() {
      calls.stopPropagation += 1;
    },
    stopImmediatePropagation() {
      calls.stopImmediatePropagation += 1;
    }
  };
}

function dropListener(listeners) {
  const entries = listeners.get("drop") || [];
  assert.equal(entries.length, 1);
  assert.equal(entries[0].capture, true);
  return entries[0].listener;
}

test("collects files from FileList and items-only drops without duplicates", () => {
  const { api } = loadTool();
  const fileFromList = { name: "list.png", type: "image/png" };
  const fileFromItem = { name: "item.webp", type: "image/webp" };

  const fromFiles = api.filesFromDataTransfer({ files: [fileFromList] });
  assert.equal(fromFiles.length, 1);
  assert.strictEqual(fromFiles[0], fileFromList);

  const fromItems = api.filesFromDataTransfer({
    files: [],
    items: [{ kind: "file", getAsFile: () => fileFromItem }]
  });
  assert.equal(fromItems.length, 1);
  assert.strictEqual(fromItems[0], fileFromItem);

  const deduplicated = api.filesFromDataTransfer({
    files: [fileFromList],
    items: [{ kind: "file", getAsFile: () => fileFromList }]
  });
  assert.equal(deduplicated.length, 1);
  assert.strictEqual(deduplicated[0], fileFromList);
});

test("accepts PNG, JPEG and WebP while rejecting unsupported files", () => {
  const { api } = loadTool();

  assert.equal(api.isSupportedImageFile({ name: "a.bin", type: "image/png" }), true);
  assert.equal(api.isSupportedImageFile({ name: "photo.JPG", type: "" }), true);
  assert.equal(api.isSupportedImageFile({ name: "asset.webp", type: "application/octet-stream" }), true);
  assert.equal(api.isSupportedImageFile({ name: "animation.gif", type: "image/gif" }), false);
  assert.equal(api.isSupportedImageFile({ name: "clip.mp4", type: "video/mp4" }), false);
  assert.equal(api.isSupportedImageFile({ name: "notes.txt", type: "text/plain" }), false);
  assert.equal(api.isSupportedImageFile(null), false);
});

test("resource drag transports only the resource ID and clears its fallback", () => {
  const { api } = loadTool();
  const values = new Map();
  const setDataCalls = [];
  const dataTransfer = {
    effectAllowed: "none",
    types: [],
    setData(type, value) {
      setDataCalls.push([type, value]);
      values.set(type, value);
      this.types = Array.from(values.keys());
    },
    getData(type) {
      return values.get(type) || "";
    }
  };

  assert.equal(api.beginResourceDrag({ dataTransfer }, "resource-42"), true);
  assert.deepEqual(setDataCalls, [[api.RESOURCE_MIME, "resource-42"]]);
  assert.equal(dataTransfer.effectAllowed, "copy");
  assert.equal(api.readResourceId(dataTransfer), "resource-42");
  assert.equal(
    api.readResourceId({ files: [], items: [], types: [api.RESOURCE_MIME], getData: () => "" }),
    "resource-42",
    "the in-memory fallback must support isolated-world internal drags"
  );
  assert.equal(
    api.readResourceId({
      files: [{ name: "external.png", type: "image/png" }],
      items: [],
      types: ["Files"],
      getData: () => ""
    }),
    "",
    "an external file must not inherit a stale internal resource ID"
  );

  api.syncSourceResourceCards(false);
  assert.equal(
    api.readResourceId({ types: [api.RESOURCE_MIME], getData: () => "" }),
    ""
  );
  api.endResourceDrag();
});

test("maps reference slots 1, 2 and 3 to zero-based indexes", () => {
  const { api, FakeElement } = loadTool();

  assert.equal(api.referenceIndex(new FakeElement("art_reference_1")), 0);
  assert.equal(api.referenceIndex(new FakeElement("art_reference_2")), 1);
  assert.equal(api.referenceIndex(new FakeElement("art_reference_3")), 2);
  assert.equal(api.referenceIndex(new FakeElement("art_reference_4")), -1);
  assert.equal(api.referenceIndex(new FakeElement("other")), -1);
});

test("a file drop invokes the controller once even when files and items repeat it", () => {
  const { api, FakeElement, listeners } = loadTool();
  const file = { name: "reference.png", type: "image/png" };
  const received = [];
  const controller = {
    isEnabled: () => true,
    onFile: (index, droppedFile) => received.push({ index, droppedFile })
  };

  api.configure(controller);
  api.configure(controller);
  for (const type of ["dragenter", "dragover", "dragleave", "drop"]) {
    assert.equal((listeners.get(type) || []).length, 1);
  }

  const event = createDropEvent(new FakeElement("art_reference_2"), {
    files: [file],
    items: [{ kind: "file", getAsFile: () => file }],
    types: ["Files"]
  });
  dropListener(listeners)(event);

  assert.equal(received.length, 1);
  assert.equal(received[0].index, 1);
  assert.strictEqual(received[0].droppedFile, file);
  assert.deepEqual(event.calls, {
    preventDefault: 1,
    stopPropagation: 1,
    stopImmediatePropagation: 1
  });
});

test("a resource drop invokes only onResource with the target slot and ID", () => {
  const { api, FakeElement, listeners } = loadTool();
  const resourceCalls = [];
  let fileCalls = 0;
  api.configure({
    isEnabled: () => true,
    onFile: () => {
      fileCalls += 1;
    },
    onResource: (index, resourceId) => resourceCalls.push({ index, resourceId })
  });

  const event = createDropEvent(new FakeElement("art_reference_3"), {
    files: [],
    items: [],
    types: [api.RESOURCE_MIME],
    getData: (type) => (type === api.RESOURCE_MIME ? "library-resource-9" : "")
  });
  dropListener(listeners)(event);

  assert.deepEqual(resourceCalls, [{ index: 2, resourceId: "library-resource-9" }]);
  assert.equal(fileCalls, 0);
});

test("an unsupported file drop reports one rejection and imports nothing", () => {
  const { api, FakeElement, listeners } = loadTool();
  const rejectionMessages = [];
  let fileCalls = 0;
  let resourceCalls = 0;
  api.configure({
    isEnabled: () => true,
    onFile: () => {
      fileCalls += 1;
    },
    onResource: () => {
      resourceCalls += 1;
    },
    onReject: (message) => rejectionMessages.push(message)
  });

  const event = createDropEvent(new FakeElement("art_reference_1"), {
    files: [{ name: "animation.gif", type: "image/gif" }],
    items: [],
    types: ["Files"]
  });
  dropListener(listeners)(event);

  assert.equal(rejectionMessages.length, 1);
  assert.equal(typeof rejectionMessages[0], "string");
  assert.ok(rejectionMessages[0].length > 0);
  assert.equal(fileCalls, 0);
  assert.equal(resourceCalls, 0);
});

test("runtime, resource cards and preload share the scoped Art drop contract", () => {
  const repoRoot = path.resolve(__dirname, "../..");
  const indexSource = fs.readFileSync(path.join(repoRoot, "particle-editor/index.html"), "utf8");
  const brandSource = fs.readFileSync(path.join(repoRoot, "particle-editor/novaflow-brand-runtime.js"), "utf8");
  const splitSource = fs.readFileSync(path.join(repoRoot, "particle-editor/spine-split-runtime.js"), "utf8");
  const preloadSource = fs.readFileSync(path.join(repoRoot, "particle-editor-desktop/preload.js"), "utf8");
  const syncSource = fs.readFileSync(path.join(repoRoot, "scripts/sync-runtime.mjs"), "utf8");
  const syncCheckSource = fs.readFileSync(path.join(repoRoot, "scripts/check-runtime-sync.mjs"), "utf8");

  const toolEntry = indexSource.indexOf("art-generate-reference-drop.tool.js");
  assert.ok(toolEntry >= 0, "Art reference drop tool must be loaded");
  assert.ok(toolEntry < indexSource.indexOf("spine-split-runtime.js"));
  assert.ok(toolEntry < indexSource.indexOf("novaflow-brand-runtime.js"));

  assert.match(brandSource, /NovaFlowSpineSplitBridge\?\.getState\?\.\(\)\?\.sourceResources/);
  assert.match(brandSource, /onResource: \(index, resourceId\) => loadArtGenerateReferenceResource\(index, resourceId\)/);
  const resourceConsumer = brandSource.slice(
    brandSource.indexOf("function loadArtGenerateReferenceResource"),
    brandSource.indexOf("function bindArtGenerateReferenceDropTool")
  );
  assert.match(resourceConsumer, /resource\?\.dataUrl/);
  assert.doesNotMatch(resourceConsumer, /thumbDataUrl|previewDataUrl|sourceResourcePreviewSrc/);

  const resourceCardProducer = splitSource.slice(
    splitSource.indexOf("const renderSourceResourceCard"),
    splitSource.indexOf("const sourceEntries")
  );
  assert.match(resourceCardProducer, /beginResourceDrag\(event, resource\.id\)/);
  assert.doesNotMatch(resourceCardProducer, /dataTransfer\.setData/);

  const artDropBranch = preloadSource.indexOf("const directArtReferenceSlot");
  const genericDropIpc = preloadSource.indexOf('ipcRenderer.send("renderer-files-dropped"');
  assert.ok(artDropBranch >= 0 && genericDropIpc > artDropBranch);
  assert.match(preloadSource.slice(artDropBranch, genericDropIpc), /if \(directArtReferenceSlot\) return/);
  assert.match(preloadSource.slice(artDropBranch, genericDropIpc), /forwardDropEventToArtGenerateReferenceSlot/);

  assert.match(syncSource, /art-generate-reference-drop\.tool\.js/);
  assert.match(syncCheckSource, /art-generate-reference-drop\.tool\.js/);
});

test("force-bottom refresh survives source-import priority and is consumed on restore", () => {
  let sourceImportPriority = true;
  const scheduledSyncs = [];
  const workspaceForces = [];
  const bodyAttributes = new Map();
  const context = vm.createContext({
    ART_GENERATE_FORCE_BOTTOM_RENDER: false,
    ART_GENERATE_STATE: {
      active: true,
      mode: "img2img",
      provider: "local",
      promptHistoryOpenKey: "",
      promptHistoryPopupRect: null
    },
    ART_GENERATE_ACTIVE_ATTR: "data-novaflow-art-generate-active",
    ART_GENERATE_PROVIDER_ATTR: "data-novaflow-art-generate-provider",
    ART_GENERATE_WORKSPACE_ID: "novaflow-art-generate-workspace",
    ART_GENERATE_RIGHT_PANEL_ID: "novaflow-art-generate-right-panel",
    ART_GENERATE_PROMPT_HISTORY_POPOVER_ID: "novaflow-art-generate-prompt-history-popover",
    ART_GENERATE_PROMPT_HISTORY_CLICK_SHIELD_ID: "novaflow-art-generate-prompt-history-click-shield",
    artGeneratePromptHistoryOpenToken: 0,
    document: {
      body: {
        setAttribute(name, value) {
          bodyAttributes.set(name, String(value));
        },
        removeAttribute(name) {
          bodyAttributes.delete(name);
        }
      },
      getElementById() {
        return null;
      },
      querySelector() {
        return {};
      }
    },
    window: {
      NovaFlowArtGenerateModels: {
        normalizeProvider: (provider) => provider
      },
      NovaFlowArtGenerateReferenceDropTool: {
        syncSourceResourceCards() {}
      }
    },
    ensureArtGenerateStyle() {},
    isArtGenerateRouteReady: () => true,
    scheduleArtGenerateDeactivationRecheck() {},
    restoreArtGeneratePreviewViewportProxy() {},
    syncArtGenerateBasePlaceholdersHidden() {},
    isSplitSourceImportPriorityActiveForArtGenerate: () => sourceImportPriority,
    scheduleArtGenerateSyncAfterSourceImport() {
      scheduledSyncs.push("scheduled");
    },
    renderArtGenerateWorkspace(forceBottomRender) {
      workspaceForces.push(forceBottomRender);
    },
    renderArtGenerateRightPanel() {},
    syncArtGenerateControlPanel() {},
    renderArtGeneratePromptHistoryPopover() {},
    syncArtGeneratePreviewViewportProxy() {},
    scheduleArtGeneratePreviewRefresh() {}
  });
  vm.runInContext(
    `this.renderArtGenerateSurfaces = ${extractNamedFunction(BRAND_RUNTIME_SOURCE, "renderArtGenerateSurfaces")}`,
    context,
    { filename: BRAND_RUNTIME_PATH }
  );

  context.renderArtGenerateSurfaces({ forceBottom: true });
  const pendingAfterPriorityBlock = context.ART_GENERATE_FORCE_BOTTOM_RENDER;

  sourceImportPriority = false;
  context.renderArtGenerateSurfaces({ sourceImportRestore: true });
  const pendingAfterRestore = context.ART_GENERATE_FORCE_BOTTOM_RENDER;

  assert.deepEqual(
    {
      pendingAfterPriorityBlock,
      scheduledSyncCount: scheduledSyncs.length,
      workspaceForces,
      pendingAfterRestore
    },
    {
      pendingAfterPriorityBlock: true,
      scheduledSyncCount: 1,
      workspaceForces: [true],
      pendingAfterRestore: false
    }
  );
});
