// Make a renderer module's private graph builders callable on the worker.
//
// Redaction hollows out every function that names a ComfyUI node. For the
// *.workflow.js modules that is enough, because their builders are exported
// and the worker can call them by name. The two big runtimes are different:
// novaflow-brand-runtime.js and spine-split-runtime.js assemble graphs in
// PRIVATE functions deep inside one closure, and nothing exports them.
//
// So the worker gets an instrumented copy of the same file. Every function the
// redactor would hollow out is registered, by name, right after it is
// declared - which captures it WITH its closure. The browser then records
// {module, fn, args} and the worker replays it against the registry.
//
// The pairing is exact by construction: both sides walk the same spans of the
// same source with the same rules.

import { matchBrace, findMarkers } from './redact-workflow-module.mjs';

const NOT_A_FUNCTION = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'catch', 'try', 'finally',
  'return', 'function', 'class', 'new', 'typeof', 'instanceof', 'in', 'of',
  'await', 'yield', 'delete', 'void', 'with', 'get', 'set'
]);

// A `function name(...) {}` declaration is unambiguous: a statement can always
// follow it.
const FUNCTION_DECL = /(^|[^\w$.])(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g;

// `const name = (...) => {}` can also take a following statement, but ONLY at
// statement position - the same text inside an object literal or an argument
// list cannot, and a wrong guess there is a syntax error in a 3.7 MB file. The
// guard is the character before the keyword: a line start, a semicolon or a
// block brace.
const CONST_FN_DECL = /(^|[;{}\n]\s*)(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\s*\*?\s*[A-Za-z_$]*\s*)?\([^)]*\)\s*(?:=>\s*)?\{/g;

/**
 * @returns {{ code: string, registered: string[], skipped: string[] }}
 */
export function instrumentModule(source, { moduleName, registryGlobal = '__nfBuilders', forceNames = [] }) {
  const spans = [];
  for (const { re, terminator } of [
    { re: FUNCTION_DECL, terminator: '' },
    { re: CONST_FN_DECL, terminator: ';' }
  ]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(source)) !== null) {
      const name = m[2];
      if (NOT_A_FUNCTION.has(name)) continue;
      const open = m.index + m[0].length - 1;
      const close = matchBrace(source, open);
      if (close < 0) continue;
      if (!forceNames.includes(name) && !findMarkers(source.slice(open + 1, close - 1), moduleName).length) continue;

      // A registration statement can only follow a declaration that actually
      // ENDS here. `const a = () => {...}, b = ...` is one declaration with a
      // comma chain, and `x = function f(){...})` is an argument - neither can
      // take a statement after the brace. Those are the two shapes to reject;
      // anything else (a newline, a semicolon, the next statement) is fine.
      const next = (source.slice(close).match(/^\s*(\S)/) || [])[1];
      if (next === ',' || next === ')' || next === ']') continue;

      spans.push({ name, open, close, terminator });
    }
  }

  // Register EVERY marker-carrying declaration, parents and children alike.
  // Redaction hollows out the innermost one, so registering only the outermost
  // would leave exactly the functions the browser records unreachable here.
  // A parent registration is harmless - it is just another reference.
  //
  // Note that a registration nested inside another function only runs when
  // that function does. buildersFor() reports what actually registered, and
  // the worker refuses a call it cannot find rather than guessing.
  const outermost = spans.slice().sort((a, b) => a.close - b.close);

  let out = '';
  let last = 0;
  const registered = [];
  const seen = new Set();
  let lastClose = -1;
  for (const span of outermost) {
    if (seen.has(span.name)) continue;
    if (span.close <= lastClose) continue;
    seen.add(span.name);
    lastClose = span.close;
    out += source.slice(last, span.close);
    // A `const f = () => {}` needs its own semicolon before the registration
    // statement; a `function f() {}` declaration does not.
    out += (span.terminator || '');
    out += '\n;try{(globalThis.' + registryGlobal + '||(globalThis.' + registryGlobal + '={}))' +
      '[' + JSON.stringify(moduleName) + ']=' +
      '(globalThis.' + registryGlobal + '[' + JSON.stringify(moduleName) + ']||{}),' +
      'globalThis.' + registryGlobal + '[' + JSON.stringify(moduleName) + ']' +
      '[' + JSON.stringify(span.name) + ']=' + span.name + ';}catch(_){}\n';
    last = span.close;
    registered.push(span.name);
  }
  out += source.slice(last);

  return {
    code: out,
    registered,
    skipped: spans.filter((s) => !registered.includes(s.name)).map((s) => s.name)
  };
}

/**
 * The names the browser side must hollow out for this module, so the two
 * halves cannot drift: exactly what instrumentation registered.
 */
export function instrumentedNames(source, { moduleName }) {
  return instrumentModule(source, { moduleName }).registered;
}
