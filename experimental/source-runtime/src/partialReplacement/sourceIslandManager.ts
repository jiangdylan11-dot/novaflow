import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

export type SourceIslandCleanup = () => void;

export type SourceIslandMountOptions = {
  runtimeDocument?: Document;
  cleanupCallbacks?: SourceIslandCleanup[];
};

export type SourceIslandHandle = {
  root: HTMLDivElement;
  addCleanup: (cleanup: SourceIslandCleanup) => () => void;
  unmount: () => void;
};

export const SOURCE_ISLAND_ROOT_ID = "novaflow-source-island-root";
export const SOURCE_ISLAND_PHASE = "phase1";
export const SOURCE_ISLAND_OWNER = "source-runtime";

let activeRoot: HTMLDivElement | null = null;
let activeReactRoot: Root | null = null;
const activeCleanupCallbacks = new Set<SourceIslandCleanup>();

function resolveRuntimeDocument(runtimeDocument?: Document): Document | null {
  if (runtimeDocument) return runtimeDocument;
  if (typeof document === "undefined") return null;
  return document;
}

function createSourceIslandRoot(runtimeDocument: Document): HTMLDivElement {
  const root = runtimeDocument.createElement("div");
  root.id = SOURCE_ISLAND_ROOT_ID;
  root.setAttribute("data-novaflow-source-island", SOURCE_ISLAND_PHASE);
  root.setAttribute("data-novaflow-runtime-ignore", "1");
  root.setAttribute("data-novaflow-source-owner", SOURCE_ISLAND_OWNER);

  const placeholder = runtimeDocument.createElement("div");
  placeholder.setAttribute("data-novaflow-source-island-placeholder", "1");
  root.appendChild(placeholder);

  return root;
}

function isSourceOwnedIsland(element: HTMLElement): boolean {
  return (
    element.id === SOURCE_ISLAND_ROOT_ID &&
    element.getAttribute("data-novaflow-source-island") === SOURCE_ISLAND_PHASE &&
    element.getAttribute("data-novaflow-runtime-ignore") === "1" &&
    element.getAttribute("data-novaflow-source-owner") === SOURCE_ISLAND_OWNER
  );
}

function addCleanupCallback(cleanup: SourceIslandCleanup): () => void {
  activeCleanupCallbacks.add(cleanup);
  return () => {
    activeCleanupCallbacks.delete(cleanup);
  };
}

function runCleanupCallbacks() {
  const callbacks = Array.from(activeCleanupCallbacks).reverse();
  activeCleanupCallbacks.clear();

  for (const cleanup of callbacks) {
    try {
      cleanup();
    } catch (error) {
      console.warn("[SourceIsland] cleanup callback failed", error);
    }
  }
}

function createHandle(runtimeDocument: Document, root: HTMLDivElement): SourceIslandHandle {
  return {
    root,
    addCleanup: addCleanupCallback,
    unmount: () => unmountSourceIsland({ runtimeDocument })
  };
}

export function mountSourceIsland(options: SourceIslandMountOptions = {}): SourceIslandHandle | null {
  const runtimeDocument = resolveRuntimeDocument(options.runtimeDocument);
  if (!runtimeDocument?.body) return null;

  const existing = runtimeDocument.getElementById(SOURCE_ISLAND_ROOT_ID);
  if (existing) {
    if (!(existing instanceof HTMLDivElement) || !isSourceOwnedIsland(existing)) {
      throw new Error("Source island root id is already owned by another DOM surface.");
    }
    activeRoot = existing;
  } else {
    activeRoot = createSourceIslandRoot(runtimeDocument);
    runtimeDocument.body.appendChild(activeRoot);
  }

  for (const cleanup of options.cleanupCallbacks ?? []) {
    addCleanupCallback(cleanup);
  }

  return createHandle(runtimeDocument, activeRoot);
}

export function getSourceIslandRoot(options: Pick<SourceIslandMountOptions, "runtimeDocument"> = {}): HTMLDivElement | null {
  const runtimeDocument = resolveRuntimeDocument(options.runtimeDocument);
  const root = activeRoot ?? runtimeDocument?.getElementById(SOURCE_ISLAND_ROOT_ID) ?? null;

  if (!(root instanceof HTMLDivElement) || !isSourceOwnedIsland(root)) return null;
  return root;
}

export function renderSourceIslandReact(
  content: ReactNode,
  options: SourceIslandMountOptions = {}
): SourceIslandHandle | null {
  const handle = mountSourceIsland(options);
  if (!handle) return null;

  if (!activeReactRoot) {
    activeReactRoot = createRoot(handle.root, { identifierPrefix: "source-island-" });
  }

  activeReactRoot.render(content);
  return handle;
}

export function unmountSourceIsland(options: Pick<SourceIslandMountOptions, "runtimeDocument"> = {}) {
  const runtimeDocument = resolveRuntimeDocument(options.runtimeDocument);
  const root = activeRoot ?? runtimeDocument?.getElementById(SOURCE_ISLAND_ROOT_ID) ?? null;

  if (activeReactRoot) {
    activeReactRoot.unmount();
    activeReactRoot = null;
  }

  runCleanupCallbacks();

  if (root instanceof HTMLElement && isSourceOwnedIsland(root)) {
    root.parentNode?.removeChild(root);
  }

  activeRoot = null;
}
