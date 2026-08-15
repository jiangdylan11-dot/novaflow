import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./App.css";
import { resolveSourcePartialReplacementFlags } from "./featureFlags/sourcePartialReplacementFlags";
import { mountSourceIsland, unmountSourceIsland } from "./partialReplacement/sourceIslandManager";

const rootNode = document.getElementById("root");

if (!rootNode) {
  throw new Error("Source runtime root node was not found.");
}

rootNode.dataset.sourceRuntimeRoot = "mounted";

const sourcePartialReplacementFlags = resolveSourcePartialReplacementFlags();

window.__NOVAFLOW_SOURCE_PARTIAL_REPLACEMENT_FLAGS__ = sourcePartialReplacementFlags;

try {
  if (sourcePartialReplacementFlags.flags.SOURCE_PARTIAL_REPLACEMENT) {
    mountSourceIsland();
  } else {
    unmountSourceIsland();
  }
} catch (error) {
  console.warn("[SourcePartialReplacement] source island fallback to legacy-safe empty state", error);
  unmountSourceIsland();
}

(window as any).__NOVAFLOW_SOURCE_RUNTIME__ = {
  entry: "/src/main.tsx",
  mounted: true,
  phase: "source-shell-boundary",
  legacyIsolation: "iframe",
  sourcePartialReplacementFlags
};

createRoot(rootNode).render(
  <StrictMode>
    <App />
  </StrictMode>
);
