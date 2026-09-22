// Redact ComfyUI topology out of a renderer workflow module.
//
// NovaFlow's renderer builds ComfyUI graphs in the browser. Spec 10 forbids
// that on the Web, so every *.workflow.js module goes through this transform
// before it ships: the parts that know about ComfyUI are removed, and the
// parts the UI needs - resolution maths, normalisers, option tables - are kept
// exactly as they are.
//
// Extracting helpers with fn.toString() does not work: these modules are one
// big factory full of private helpers calling each other, and extraction loses
// the closure. So the module stays whole and we hollow out only what leaks.
//
// Five passes, each narrower than the last:
//
//   1. functions   - hollow out the innermost function whose body names a node
//   2. graphs      - replace object literals that ARE a graph (class_type keys)
//   3. comments    - drop comments that name nodes
//   4. identifiers - rename functions/vars whose NAME names a node
//   5. strings     - replace any remaining string literal that names a node
//
// Whatever survives all five is reported as `remaining`, and the caller is
// expected to refuse to ship it. tests/e2e/workflow-redaction.test.mjs asserts
// `remaining` is empty for every module AND that every surviving helper still
// returns exactly what the original returned.

export const COMFY_MARKERS = [
  'class_type',
  'CheckpointLoaderSimple', 'CheckpointLoader',
  'UNETLoader', 'VAELoader', 'VAEDecodeAudio', 'VAEDecode', 'VAEEncode',
  'CLIPLoader', 'CLIPTextEncode',
  'KSamplerSelect', 'KSampler',
  'BasicScheduler', 'BasicGuider', 'RandomNoise', 'SamplerCustomAdvanced',
  'EmptySD3LatentImage', 'EmptyLatentImage', 'EmptyMiniMaxH3LatentAV',
  'EmptyFlux2LatentImage', 'ModelSamplingAuraFlow', 'ConditioningZeroOut',
  'LoadImage', 'LoadVideo', 'LoadAudio',
  'SaveImage', 'SaveVideo', 'SaveAnimatedWEBP',
  'CreateVideo', 'GetVideoComponents',
  'MiniMaxH3ImageToVideo', 'MiniMaxH3ReferenceToVideo', 'MiniMaxH3SigmaShift',
  'NovaFlowH3SageAttention', 'NovaFlowH3PrepareReferenceImage',
  'NovaFlowH3ReferenceVideoFrames', 'NovaFlowH3OutputVideoFrames',
  'NovaFlowH3RestoreReferenceBackground', 'NovaFlowH3PrepareMotionReference',
  'NovaFlowH3MatchReferenceLayout', 'NovaFlowH3ReferenceStrength',
  'NovaFlowH3VideoToVideoLatent',
  'LoraLoaderModelOnly', 'LoraLoader',
  'ImageScaleToTotalPixels', 'ImageScale', 'ImageBatch', 'ImageCrop',
  'ControlNetApply', 'ControlNetLoader',
  'FluxKontextImageScale',
  'TextEncodeQwenImageEdit', 'QwenImageDiffsynthControlnet',
  'InpaintModelConditioning', 'DifferentialDiffusion',
];

// A bare extension in a file-type filter is not topology; a NAMED weight file
// is. Matching the filename is what tells the two apart.
export const WEIGHT_FILE_RE = /[\w][\w .\\/-]*\.(?:safetensors|ckpt|gguf|pth|onnx)\b/;

export const PLACEHOLDER_STRING = '<server-side>';
export const PLACEHOLDER_GRAPH = '{ /* graph lives on the compute node */ }';

/** Marker hits in `text`, with the module's own name masked out. */
export function findMarkers(text, moduleName) {
  const scanned = moduleName ? text.split(moduleName).join('<module>') : text;
  const found = COMFY_MARKERS.filter((m) => scanned.includes(m));
  if (WEIGHT_FILE_RE.test(scanned)) found.push('<weight-file>');
  return [...new Set(found)];
}

/**
 * Is the `/` at `index` the start of a regex literal, or a division sign?
 *
 * After an identifier, a number, `)` or `]` it is division; otherwise a regex.
 * Getting this wrong is not cosmetic: a regex containing an unbalanced brace
 * throws off brace counting and truncates a function body, which is exactly
 * how a 3.7 MB file ends up with orphaned code after its closing brace.
 */
export function regexAllowedAt(source, index) {
  for (let i = index - 1; i >= 0; i -= 1) {
    const c = source[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') continue;
    return !/[A-Za-z0-9_$)\]]/.test(c);
  }
  return true;
}

/**
 * Walk forward from the `{` at `start` to its matching `}`, skipping strings,
 * template literals, regex literals and comments. Returns the index just past
 * the closing brace, or -1 if unbalanced.
 */
export function matchBrace(source, start) {
  let depth = 0;
  let i = start;
  const n = source.length;

  while (i < n) {
    const c = source[i];
    const next = source[i + 1];

    if (c === '/' && next === '/') {
      i = source.indexOf('\n', i);
      if (i < 0) return -1;
      continue;
    }
    if (c === '/' && next === '*') {
      i = source.indexOf('*/', i + 2);
      if (i < 0) return -1;
      i += 2;
      continue;
    }

    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i += 1;
      while (i < n) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === quote) { i += 1; break; }
        if (quote === '`' && source[i] === '$' && source[i + 1] === '{') {
          const end = matchBrace(source, i + 1);
          if (end < 0) return -1;
          i = end;
          continue;
        }
        i += 1;
      }
      continue;
    }

    // regex literal
    if (c === '/' && regexAllowedAt(source, i)) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < n) {
        const r = source[j];
        if (r === '\\') { j += 2; continue; }
        if (r === '\n') break;
        if (r === '[') inClass = true;
        else if (r === ']') inClass = false;
        else if (r === '/' && !inClass) { closed = true; j += 1; break; }
        j += 1;
      }
      if (closed) {
        while (j < n && /[a-z]/.test(source[j])) j += 1;
        i = j;
        continue;
      }
    }

    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  return -1;
}

/** Walk backward to the `{` that opens the object containing `index`. */
export function openingBrace(source, index) {
  let depth = 0;
  for (let i = index; i >= 0; i -= 1) {
    const c = source[i];
    if (c === '}') depth += 1;
    else if (c === '{') {
      if (depth === 0) return i;
      depth -= 1;
    }
  }
  return -1;
}

// `if (x) {` is indistinguishable from a shorthand method to a regex. Without
// this list the transform carves up control flow instead of functions.
const NOT_A_FUNCTION = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'catch', 'try', 'finally',
  'return', 'function', 'class', 'new', 'typeof', 'instanceof', 'in', 'of',
  'await', 'yield', 'delete', 'void', 'with', 'get', 'set'
]);

const DECL_PATTERNS = [
  { re: /(^|[^\w$.])(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g, nameGroup: 2 },
  { re: /(^|[^\w$.])(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\s*\*?\s*[A-Za-z_$]*\s*)?\([^)]*\)\s*(?:=>\s*)?\{/g, nameGroup: 2 },
  { re: /(^|[\s,{;])([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g, nameGroup: 2 }
];

// ---------------------------------------------------------------------------
// Pass 1: hollow out functions that name a node.
// ---------------------------------------------------------------------------
function redactFunctions(source, moduleName, replacement, forceNames) {
  const forced = new Set(forceNames || []);
  const spans = [];

  for (const { re, nameGroup } of DECL_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(source)) !== null) {
      const name = m[nameGroup];
      if (NOT_A_FUNCTION.has(name)) continue;
      const open = m.index + m[0].length - 1;
      const close = matchBrace(source, open);
      if (close < 0) continue;
      // A public entry point is hollowed out even when its own body is
      // innocent, because it is the name the worker must be able to call.
      // Without this the recorded intent would name a private helper.
      const carries = findMarkers(source.slice(open + 1, close - 1), moduleName).length > 0;
      if (!carries && !forced.has(name)) continue;
      spans.push({ name, open, close, size: close - open });
    }
  }

  // Innermost only: the outermost match is always the module's own IIFE, and
  // redacting that deletes the module rather than its topology.
  // A forced span always wins over anything nested inside it: the public
  // entry point must be the one that records.
  const forcedSpans = spans.filter((s) => forced.has(s.name));
  const nested = (inner) => forcedSpans.some(
    (f) => f !== inner && inner.open >= f.open && inner.close <= f.close
  );
  const candidates = spans.filter((s) => forced.has(s.name) || !nested(s));
  const innermost = candidates.filter((s) => !candidates.some(
    (t) => t !== s && t.open >= s.open && t.close <= s.close && (t.open > s.open || t.close < s.close)
  ));
  innermost.sort((a, b) => (a.open - b.open) || (a.size - b.size));

  let out = '';
  let last = 0;
  let cursor = -1;
  const redacted = [];
  for (const span of innermost) {
    if (span.open <= cursor) continue;
    out += source.slice(last, span.open + 1);
    out += replacement(span.name);
    last = span.close - 1;
    cursor = span.close;
    redacted.push(span.name);
  }
  out += source.slice(last);
  return { code: out, redacted };
}

// ---------------------------------------------------------------------------
// Pass 2: replace object literals that ARE a graph.
// ---------------------------------------------------------------------------
export function redactGraphLiterals(source, placeholder = PLACEHOLDER_GRAPH) {
  let out = source;
  let replaced = 0;

  for (let guard = 0; guard < 500; guard += 1) {
    const hit = out.indexOf('class_type');
    if (hit < 0) break;

    let open = openingBrace(out, hit);
    if (open < 0) break;
    // Climb from the node object to the graph object around it.
    for (let up = 0; up < 20; up += 1) {
      const outer = openingBrace(out, open - 1);
      if (outer < 0) break;
      const tail = (out.slice(outer + 1, open).split(',').pop() || '');
      // A node sits under a numeric or quoted key. Anything else means we have
      // climbed out of the graph and into ordinary code.
      if (!/^\s*(?:["']?[\w-]+["']?\s*:\s*)?$/.test(tail)) break;
      open = outer;
    }

    const close = matchBrace(out, open);
    if (close < 0) break;
    out = out.slice(0, open) + placeholder + out.slice(close);
    replaced += 1;
  }

  return { code: out, replaced };
}

// ---------------------------------------------------------------------------
// Pass 3: drop comments that name nodes.
// ---------------------------------------------------------------------------
export function stripMarkerComments(source, moduleName) {
  let out = '';
  let i = 0;
  let stripped = 0;
  const n = source.length;

  while (i < n) {
    const c = source[i];
    const next = source[i + 1];

    if (c === '/' && next === '/') {
      let end = source.indexOf('\n', i);
      if (end < 0) end = n;
      const comment = source.slice(i, end);
      if (findMarkers(comment, moduleName).length) { out += '//'; stripped += 1; }
      else out += comment;
      i = end;
      continue;
    }
    if (c === '/' && next === '*') {
      let end = source.indexOf('*/', i + 2);
      end = end < 0 ? n : end + 2;
      const comment = source.slice(i, end);
      if (findMarkers(comment, moduleName).length) { out += '/**/'; stripped += 1; }
      else out += comment;
      i = end;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      let j = i + 1;
      while (j < n) {
        if (source[j] === '\\') { j += 2; continue; }
        if (source[j] === quote) break;
        j += 1;
      }
      out += source.slice(i, j + 1);
      i = j + 1;
      continue;
    }

    out += c;
    i += 1;
  }

  return { code: out, stripped };
}

// ---------------------------------------------------------------------------
// Pass 4: rename identifiers whose NAME names a node (addLoadImageNodes).
// ---------------------------------------------------------------------------
export function renameMarkerIdentifiers(source, moduleName) {
  const ids = new Set();
  const re = /\b[A-Za-z_$][\w$]*\b/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const id = m[0];
    if (moduleName && id === moduleName) continue;
    if (COMFY_MARKERS.some((k) => !k.startsWith('.') && id.includes(k))) ids.add(id);
  }

  let out = source;
  let index = 0;
  const renamed = [];
  for (const id of ids) {
    index += 1;
    const alias = '__nfNode' + index;
    out = out.replace(new RegExp('\\b' + id.replace(/\$/g, '\\$') + '\\b', 'g'), alias);
    renamed.push({ from: id, to: alias });
  }
  return { code: out, renamed };
}

// ---------------------------------------------------------------------------
// Pass 5: replace any remaining string literal that names a node.
// ---------------------------------------------------------------------------
export function redactStringLiterals(source, moduleName) {
  let out = '';
  let i = 0;
  let replaced = 0;
  const n = source.length;

  while (i < n) {
    const c = source[i];
    const next = source[i + 1];

    if (c === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      out += source.slice(i, end < 0 ? n : end);
      i = end < 0 ? n : end;
      continue;
    }
    if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      out += source.slice(i, end < 0 ? n : end + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }

    // Quoted strings only. Minified code uses backticks for everything, and
    // scanning those generically has broken the bundle more than once; the one
    // template that matters is handled by name in build-web-renderer.mjs.
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      while (j < n) {
        if (source[j] === '\\') { j += 2; continue; }
        if (source[j] === quote) break;
        if (source[j] === '\n') break;
        j += 1;
      }
      const literal = source.slice(i, j + 1);
      if (findMarkers(literal, moduleName).length) {
        out += quote + PLACEHOLDER_STRING + quote;
        replaced += 1;
      } else {
        out += literal;
      }
      i = j + 1;
      continue;
    }

    out += c;
    i += 1;
  }

  return { code: out, replaced };
}

/**
 * @param {string} source
 * @param {{ moduleName: string, replacement: (name: string) => string }} opts
 */
export function redactModule(source, { moduleName, replacement, forceNames, passes } = {}) {
  // A minified bundle gets DATA passes only. Hollowing out a function there is
  // reckless: the names carry no meaning, so there is no way to tell a graph
  // builder from a UI function, and getting it wrong replaces something the
  // app calls with an object - which is exactly how the animation section went
  // blank with 'Sr is not a function'. Removing the topology DATA is enough,
  // and it cannot change a call signature.
  const doFunctions = !passes || passes.functions !== false;
  const doIdentifiers = !passes || passes.identifiers !== false;
  // Climbing to the outermost object literal is guesswork on minified code,
  // where one wrong brace rewrites unrelated program text.
  const doGraphs = !passes || passes.graphs !== false;

  const fns = doFunctions
    ? redactFunctions(source, moduleName, replacement, forceNames)
    : { code: source, redacted: [] };
  const graphs = doGraphs ? redactGraphLiterals(fns.code) : { code: fns.code, replaced: 0 };
  const comments = stripMarkerComments(graphs.code, moduleName);
  const idents = doIdentifiers
    ? renameMarkerIdentifiers(comments.code, moduleName)
    : { code: comments.code, renamed: [] };
  const strings = redactStringLiterals(idents.code, moduleName);

  return {
    code: strings.code,
    redacted: fns.redacted,
    redactedGraphs: graphs.replaced,
    strippedComments: comments.stripped,
    renamedIdentifiers: idents.renamed,
    redactedLiterals: strings.replaced,
    remaining: findMarkers(strings.code, moduleName)
  };
}
