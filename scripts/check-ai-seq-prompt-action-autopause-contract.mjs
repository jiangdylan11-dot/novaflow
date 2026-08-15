#!/usr/bin/env node
import { readFileSync } from "node:fs";
import vm from "node:vm";

const runtime = readFileSync("particle-editor/novaflow-brand-runtime.js", "utf8");
const compat = readFileSync("particle-editor/ai-sequence-input-compat.tool.js", "utf8");

function assertIncludes(text, needle, label) {
  if (!text.includes(needle)) throw new Error(`${label} missing: ${needle}`);
}

assertIncludes(
  runtime,
  "function pauseAiSequenceMainPreviewForPromptAction(",
  "AI sequence prompt-action pause bridge"
);
assertIncludes(
  runtime,
  "function handleAiSequencePromptActionAutoPauseCapture(",
  "AI sequence prompt-action click capture"
);
assertIncludes(
  compat,
  'target.closest(`[${NOVAFLOW_PROMPT_ACTION_BUTTON_ATTR}="1"]`)',
  "shared prompt-action selector"
);
assertIncludes(
  compat,
  'normalizeText(button.getAttribute("title") || "") === "\\u6682\\u505c"',
  "authoritative playing timeline button lookup"
);
assertIncludes(
  compat,
  '["pointerdown", "mousedown", "pointerup", "mouseup", "click"]',
  "React playback pointer sequence"
);
assertIncludes(
  runtime,
  'document.addEventListener("click", handleAiSequencePromptActionAutoPauseCapture, true);',
  "prompt-action capture binding"
);

class FakeElement {
  constructor(closest) { this.closestImpl = closest; }
  closest(selector) { return this.closestImpl ? this.closestImpl(selector) : null; }
}
class FakeHtmlElement extends FakeElement {}
class FakeButton extends FakeHtmlElement {
  constructor() {
    super();
    this.disabled = false;
    this.events = [];
  }
  getAttribute(name) { return name === "title" ? "暂停" : null; }
  dispatchEvent(event) { this.events.push(event.type); return true; }
}
class FakeVideo extends FakeHtmlElement {
  constructor() { super(); this.paused = false; this.ended = false; }
  pause() { this.paused = true; }
}
class FakeMouseEvent {
  constructor(type) { this.type = type; }
}
const timelineButton = new FakeButton();
const video = new FakeVideo();
const workspace = new FakeHtmlElement();
const promptButton = new FakeButton();
promptButton.closestImpl = (selector) => selector.includes("data-novaflow-ai-bottom-workspace") ? workspace : null;
const target = new FakeElement((selector) => selector.includes("data-novaflow-prompt-action-button") ? promptButton : null);
const window = {
  Element: FakeElement,
  HTMLElement: FakeHtmlElement,
  HTMLButtonElement: FakeButton,
  HTMLVideoElement: FakeVideo,
  MouseEvent: FakeMouseEvent,
  document: {
    body: { classList: { contains: (name) => name === "novaflow-primary-target-animation" } },
    querySelectorAll: () => [timelineButton]
  }
};
vm.runInContext(compat, vm.createContext({ window, globalThis: window }), {
  filename: "particle-editor/ai-sequence-input-compat.tool.js"
});
const handled = window.NovaFlowAiSequenceInputCompat.handleAiSequencePromptActionAutoPauseCapture(
  { target },
  {
    promptActionButtonAttr: "data-novaflow-prompt-action-button",
    getMainPreviewVideo: () => video,
    isVisible: () => true,
    normalizeText: (value) => String(value || "").trim()
  }
);
if (!handled || !video.paused) throw new Error("playing main preview was not paused");
if (timelineButton.events.join(",") !== "pointerdown,mousedown,pointerup,mouseup,click") {
  throw new Error(`unexpected playback event sequence: ${timelineButton.events.join(",")}`);
}

console.log("PASS AI sequence prompt-action auto-pause contract");
