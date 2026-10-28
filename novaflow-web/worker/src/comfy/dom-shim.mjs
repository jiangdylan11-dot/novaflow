// A fake browser, good enough to load NovaFlow's renderer modules on a worker.
//
// The renderer is 8.5 MB of code written for a real page. The worker only ever
// calls its graph builders, but the modules run top-to-bottom when loaded, and
// on the way they touch the DOM, storage, observers and canvases.
//
// So this is deliberately permissive rather than faithful: every element is
// the same duck-typed object, every method is a no-op, every getter returns a
// plausible empty value. Nothing here renders anything, and nothing needs to -
// the point is to get past module initialisation with the builders intact.
//
// It is NOT a sandbox boundary. The isolation comes from node:vm and from the
// fact that the worker never gives these modules network or filesystem access.

function makeStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
    setItem: (k, v) => { store.set(String(k), String(v)); },
    removeItem: (k) => { store.delete(String(k)); },
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() { return store.size; }
  };
}

function makeClassList() {
  const set = new Set();
  return {
    add: (...c) => c.forEach((x) => set.add(String(x))),
    remove: (...c) => c.forEach((x) => set.delete(String(x))),
    toggle: (c, force) => {
      const key = String(c);
      const on = force === undefined ? !set.has(key) : Boolean(force);
      if (on) set.add(key); else set.delete(key);
      return on;
    },
    contains: (c) => set.has(String(c)),
    replace: (a, b) => { set.delete(String(a)); set.add(String(b)); return true; },
    get length() { return set.size; },
    item: (i) => [...set][i] ?? null,
    toString: () => [...set].join(' ')
  };
}

function makeElement(tagName = 'div') {
  const attrs = new Map();
  const el = {
    tagName: String(tagName).toUpperCase(),
    nodeType: 1,
    nodeName: String(tagName).toUpperCase(),
    id: '',
    className: '',
    textContent: '',
    innerHTML: '',
    outerHTML: '',
    value: '',
    checked: false,
    disabled: false,
    hidden: false,
    src: '',
    href: '',
    width: 0,
    height: 0,
    naturalWidth: 0,
    naturalHeight: 0,
    style: new Proxy({}, {
      get: (t, k) => (k === 'setProperty' ? () => {}
        : k === 'removeProperty' ? () => ''
        : k === 'getPropertyValue' ? () => ''
        : (t[k] ?? '')),
      set: (t, k, v) => { t[k] = v; return true; }
    }),
    dataset: {},
    classList: makeClassList(),
    children: [],
    childNodes: [],
    parentNode: null,
    parentElement: null,
    firstChild: null,
    lastChild: null,
    nextSibling: null,
    previousSibling: null,
    ownerDocument: null,

    setAttribute: (k, v) => { attrs.set(String(k), String(v)); },
    getAttribute: (k) => (attrs.has(String(k)) ? attrs.get(String(k)) : null),
    hasAttribute: (k) => attrs.has(String(k)),
    removeAttribute: (k) => { attrs.delete(String(k)); },
    getAttributeNames: () => [...attrs.keys()],
    toggleAttribute: (k, force) => {
      const on = force === undefined ? !attrs.has(String(k)) : Boolean(force);
      if (on) attrs.set(String(k), ''); else attrs.delete(String(k));
      return on;
    },

    appendChild: (child) => child,
    insertBefore: (child) => child,
    replaceChild: (child) => child,
    removeChild: (child) => child,
    append: () => {},
    prepend: () => {},
    before: () => {},
    after: () => {},
    remove: () => {},
    replaceWith: () => {},
    cloneNode: () => makeElement(tagName),
    contains: () => false,
    closest: () => null,
    matches: () => false,
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementsByTagName: () => [],
    getElementsByClassName: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    focus: () => {},
    blur: () => {},
    click: () => {},
    scrollIntoView: () => {},
    getBoundingClientRect: () => ({
      x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({})
    }),
    getContext: () => makeCanvasContext(),
    toDataURL: () => 'data:image/png;base64,',
    toBlob: (cb) => { if (typeof cb === 'function') cb(null); },
    animate: () => ({ cancel: () => {}, finish: () => {}, addEventListener: () => {} }),
    attachShadow: () => makeElement('shadow'),
    insertAdjacentHTML: () => {},
    insertAdjacentElement: (pos, node) => node,
    select: () => {},
    setSelectionRange: () => {},
    play: () => Promise.resolve(),
    pause: () => {},
    load: () => {}
  };
  return el;
}

function makeCanvasContext() {
  const noop = () => {};
  return new Proxy({
    canvas: null,
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1,
    globalCompositeOperation: 'source-over', font: '10px sans-serif',
    getImageData: (x, y, w, h) => ({
      data: new Uint8ClampedArray(Math.max(0, w | 0) * Math.max(0, h | 0) * 4),
      width: w | 0, height: h | 0
    }),
    createImageData: (w, h) => ({
      data: new Uint8ClampedArray(Math.max(0, w | 0) * Math.max(0, h | 0) * 4),
      width: w | 0, height: h | 0
    }),
    measureText: () => ({ width: 0, actualBoundingBoxAscent: 0, actualBoundingBoxDescent: 0 })
  }, {
    get: (t, k) => (k in t ? t[k] : noop),
    set: (t, k, v) => { t[k] = v; return true; }
  });
}

class FakeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}

/**
 * Build a sandbox object suitable for node:vm.
 * `extra` is merged last, so a caller can override anything.
 */
export function createDomSandbox(extra = {}) {
  const body = makeElement('body');
  const head = makeElement('head');
  const html = makeElement('html');

  const document = Object.assign(makeElement('#document'), {
    nodeType: 9,
    body,
    head,
    documentElement: html,
    readyState: 'complete',
    visibilityState: 'visible',
    hidden: false,
    title: '',
    cookie: '',
    createElement: (tag) => makeElement(tag),
    createElementNS: (ns, tag) => makeElement(tag),
    createDocumentFragment: () => makeElement('#fragment'),
    createTextNode: (text) => Object.assign(makeElement('#text'), { nodeType: 3, textContent: String(text) }),
    createComment: () => makeElement('#comment'),
    createEvent: () => ({ initEvent: () => {} }),
    getElementById: () => null,
    getElementsByTagName: () => [],
    getElementsByClassName: () => [],
    querySelector: () => null,
    querySelectorAll: () => [],
    elementFromPoint: () => null,
    execCommand: () => false,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    activeElement: body,
    fonts: { ready: Promise.resolve(), add: () => {}, load: () => Promise.resolve([]) }
  });

  class FakeEvent {
    constructor(type, init) {
      this.type = String(type);
      Object.assign(this, init || {});
    }
    preventDefault() {}
    stopPropagation() {}
    stopImmediatePropagation() {}
  }

  const sandbox = {
    console: { log: () => {}, warn: () => {}, error: () => {}, info: () => {}, debug: () => {}, trace: () => {} },
    // Timers are inert. A renderer module that schedules work at load time
    // would otherwise keep the worker's event loop alive for no reason.
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    queueMicrotask: () => {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    requestIdleCallback: () => 0,
    cancelIdleCallback: () => {},

    Math, JSON, Date, Intl, Promise, Array, Object, String, Number, Boolean,
    Map, Set, WeakMap, WeakSet, Symbol, RegExp, Error, TypeError, RangeError,
    Uint8Array, Uint8ClampedArray, Uint16Array, Uint32Array, Int8Array,
    Int16Array, Int32Array, Float32Array, Float64Array, ArrayBuffer, DataView,
    URL, URLSearchParams, TextEncoder, TextDecoder, structuredClone,
    crypto: globalThis.crypto,
    performance: { now: () => Date.now(), mark: () => {}, measure: () => {} },

    document,
    localStorage: makeStorage(),
    sessionStorage: makeStorage(),
    navigator: {
      userAgent: 'NovaFlowWorker', language: 'zh-CN', languages: ['zh-CN'],
      platform: 'worker', hardwareConcurrency: 8, maxTouchPoints: 0,
      clipboard: { writeText: () => Promise.resolve(), readText: () => Promise.resolve('') },
      storage: { estimate: () => Promise.resolve({ usage: 0, quota: 0 }) }
    },
    location: {
      href: 'http://127.0.0.1/', origin: 'http://127.0.0.1', protocol: 'http:',
      host: '127.0.0.1', hostname: '127.0.0.1', port: '', pathname: '/', search: '', hash: ''
    },
    history: { pushState: () => {}, replaceState: () => {}, back: () => {} },
    screen: { width: 1920, height: 1080, availWidth: 1920, availHeight: 1080 },
    devicePixelRatio: 1,
    innerWidth: 1920,
    innerHeight: 1080,
    outerWidth: 1920,
    outerHeight: 1080,
    scrollX: 0, scrollY: 0,

    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    matchMedia: () => ({ matches: false, media: '', addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }),
    getComputedStyle: () => ({ getPropertyValue: () => '', setProperty: () => {} }),
    alert: () => {}, confirm: () => false, prompt: () => null,
    open: () => null, close: () => {}, focus: () => {}, blur: () => {},
    scrollTo: () => {}, scrollBy: () => {},
    atob: (s) => Buffer.from(String(s), 'base64').toString('binary'),
    btoa: (s) => Buffer.from(String(s), 'binary').toString('base64'),

    // A workflow builder has no business reaching the network.
    fetch: async () => { throw new Error('renderer modules must not perform network I/O on the worker'); },
    XMLHttpRequest: class { open() {} send() {} setRequestHeader() {} addEventListener() {} abort() {} },
    WebSocket: class { constructor() { this.readyState = 3; } send() {} close() {} addEventListener() {} },
    importScripts: () => {},

    MutationObserver: FakeObserver,
    ResizeObserver: FakeObserver,
    IntersectionObserver: FakeObserver,
    PerformanceObserver: FakeObserver,

    Event: FakeEvent,
    CustomEvent: FakeEvent,
    MouseEvent: FakeEvent,
    KeyboardEvent: FakeEvent,
    PointerEvent: FakeEvent,
    DragEvent: FakeEvent,
    WheelEvent: FakeEvent,

    Document: class {},
    DocumentFragment: class {},
    Text: class {},
    Node: class {},
    Element: class {},
    HTMLElement: class {},
    HTMLButtonElement: class {},
    HTMLInputElement: class {},
    HTMLTextAreaElement: class {},
    HTMLSelectElement: class {},
    HTMLImageElement: class {},
    HTMLCanvasElement: class {},
    HTMLVideoElement: class {},
    CanvasRenderingContext2D: class {},
    OffscreenCanvas: class {
      constructor(w, h) { this.width = w; this.height = h; }
      getContext() { return makeCanvasContext(); }
      convertToBlob() { return Promise.resolve(null); }
    },
    Image: class { constructor() { this.width = 0; this.height = 0; } addEventListener() {} },
    Blob: class { constructor(parts) { this.size = (parts || []).length; } arrayBuffer() { return Promise.resolve(new ArrayBuffer(0)); } text() { return Promise.resolve(''); } },
    File: class { constructor(parts, name) { this.name = name; this.size = 0; } },
    FileReader: class { readAsDataURL() {} readAsArrayBuffer() {} addEventListener() {} },
    FormData: class { append() {} get() { return null; } },
    Worker: class { postMessage() {} terminate() {} addEventListener() {} },
    ImageData: class { constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(Math.max(0, w | 0) * Math.max(0, h | 0) * 4); } },
    createImageBitmap: () => Promise.resolve({ width: 0, height: 0, close: () => {} }),
    AbortController: globalThis.AbortController,
    AbortSignal: globalThis.AbortSignal,

    ...extra
  };

  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.top = sandbox;
  sandbox.parent = sandbox;
  document.defaultView = sandbox;
  body.ownerDocument = document;
  head.ownerDocument = document;

  return sandbox;
}

export { makeElement, makeCanvasContext };
