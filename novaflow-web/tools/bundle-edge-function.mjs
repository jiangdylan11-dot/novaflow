// Flatten the edge function into a single index.ts.
//
// Supabase can deploy a multi-file function, but every path that does so - the
// CLI, the browser editor - adds a way for one file to go missing or be named
// wrongly, and a missing module only shows up as a cold-start failure in
// production. One file has no such failure mode: what is reviewed is what runs.
//
// This is a source transform, not a compiler. The shared modules are plain ESM
// with no npm dependencies and no default exports, so inlining them is a matter
// of ordering the graph, dropping the relative imports and dropping the
// `export` keyword. Anything it cannot handle is refused rather than guessed
// at - see the checks below.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { relativeImports, resolveSharedFiles } from './sync-edge-function.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const FN = join(ROOT, 'supabase/functions/novaflow-web');
const OUT = join(ROOT, 'supabase/functions/novaflow-web-bundle');
const ENTRY = 'index.ts';

/** Dependencies before dependants. */
async function topoOrder(files) {
  const deps = new Map();
  for (const name of files) {
    const source = await readFile(join(FN, name), 'utf8');
    deps.set(name, relativeImports(source).filter((d) => files.includes(d)));
  }
  const ordered = [];
  const state = new Map();
  function visit(name, trail) {
    if (state.get(name) === 'done') return;
    if (state.get(name) === 'visiting') {
      throw new Error('import cycle: ' + [...trail, name].join(' -> '));
    }
    state.set(name, 'visiting');
    for (const d of deps.get(name) || []) visit(d, [...trail, name]);
    state.set(name, 'done');
    ordered.push(name);
  }
  for (const name of files) visit(name, []);
  return ordered;
}

/** Strip a module's relative imports and its `export` keywords. */
function inline(source, name) {
  let out = source;

  // import { a, b } from './x.mjs';  /  import './x.mjs';
  out = out.replace(/^[ \t]*import\s+[^;]*?from\s+['"]\.\/[^'"]+['"];?[ \t]*$/gm, '');
  out = out.replace(/^[ \t]*import\s+['"]\.\/[^'"]+['"];?[ \t]*$/gm, '');

  // export { A, B };  - re-export lists mean nothing once inlined
  out = out.replace(/^[ \t]*export\s*\{[^}]*\}\s*;?[ \t]*$/gm, '');

  // export const/function/class/async function -> the declaration itself
  out = out.replace(/^([ \t]*)export\s+(const|let|var|function|class|async\s+function)\b/gm, '$1$2');

  const leftovers = [...out.matchAll(/^[ \t]*export\b.*$/gm)].map((m) => m[0].trim());
  if (leftovers.length) {
    throw new Error(name + ' has an export this bundler does not handle:\n  ' + leftovers.join('\n  '));
  }
  const stillImports = [...out.matchAll(/^[ \t]*import\s.*$/gm)]
    .map((m) => m[0].trim())
    .filter((l) => !/from\s+['"](npm:|jsr:|node:|https:)/.test(l));
  if (stillImports.length) {
    throw new Error(name + ' has an import this bundler does not handle:\n  ' + stillImports.join('\n  '));
  }

  return out.trim();
}

/** Top-level declared names, so a collision is caught rather than shipped. */
function declaredNames(source) {
  const names = new Set();
  for (const m of source.matchAll(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of source.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of source.matchAll(/^class\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  return names;
}

/**
 * The full text of a top-level declaration, so two modules that define the
 * same private helper can be compared rather than guessed about.
 *
 * Returns null when the shape is anything other than a plain top-level
 * `function name(...) { ... }` - that is the only case worth deduping, and
 * anything else stays a collision.
 */
function extractFunction(source, name) {
  const re = new RegExp('^(?:async\\s+)?function\\s+' + name + '\\s*\\(', 'm');
  const m = re.exec(source);
  if (!m) return null;
  const open = source.indexOf('{', m.index);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return { start: m.index, end: i + 1, text: source.slice(m.index, i + 1) };
    }
  }
  return null;
}

/**
 * Drop a declaration an earlier module already contributed, but only when the
 * two are byte-identical. Two helpers that merely share a name are a real
 * conflict and must not be silently merged.
 */
function dedupe(body, name, previousText, owner, here) {
  const mine = extractFunction(body, name);
  if (!mine || !previousText || mine.text !== previousText) {
    throw new Error(
      'name collision: ' + name + ' declared in both ' + owner + ' and ' + here +
      (mine && previousText ? ' with different bodies' : '')
    );
  }
  return (body.slice(0, mine.start) + body.slice(mine.end)).replace(/\n{3,}/g, '\n\n');
}

export async function bundleEdgeFunction() {
  const { files, missing } = await resolveSharedFiles();
  if (missing.length) throw new Error('unresolved imports: ' + missing.join(', '));

  const order = await topoOrder(files);
  const entry = await readFile(join(FN, ENTRY), 'utf8');

  // Non-relative imports (npm:, jsr:, node:) must sit at the top of the file.
  const externals = new Set();
  const collect = (text) => {
    for (const m of text.matchAll(/^[ \t]*import\s+[^;]*?from\s+['"](?:npm:|jsr:|node:|https:)[^'"]*['"];?[ \t]*$/gm)) {
      externals.add(m[0].trim());
    }
  };
  collect(entry);

  const parts = [];
  const seenNames = new Map();
  const deduped = [];
  for (const name of order) {
    const source = await readFile(join(FN, name), 'utf8');
    collect(source);
    let body = inline(source, name);
    for (const n of declaredNames(body)) {
      const prior = seenNames.get(n);
      if (prior) {
        // Identical private helpers are deduped; anything else is a conflict.
        body = dedupe(body, n, prior.text, prior.module, name);
        deduped.push(n + ' (' + name + ' reuses ' + prior.module + ')');
        continue;
      }
      seenNames.set(n, { module: name, text: extractFunction(body, n)?.text || null });
    }
    parts.push('// ===== ' + name + ' ' + '='.repeat(Math.max(0, 62 - name.length)) + '\n' + body);
  }

  let main = entry;
  main = main.replace(/^[ \t]*import\s+[^;]*?from\s+['"]\.\/[^'"]+['"];?[ \t]*$/gm, '');
  main = main.replace(/^[ \t]*import\s+[^;]*?from\s+['"](?:npm:|jsr:|node:|https:)[^'"]*['"];?[ \t]*$/gm, '');
  parts.push('// ===== ' + ENTRY + ' ' + '='.repeat(Math.max(0, 62 - ENTRY.length)) + '\n' + main.trim());

  const header = [
    '// GENERATED - do not edit. Built by tools/bundle-edge-function.mjs.',
    '// Source: supabase/functions/novaflow-web/ (' + order.length + ' modules + ' + ENTRY + ')',
    '// Rebuild with: npm run bundle:edge',
    '//',
    '// One file on purpose: a multi-file deploy can lose a module, and a lost',
    '// module only shows up as a cold-start failure in production.',
    ''
  ].join('\n');

  const code = header + [...externals].join('\n') + '\n\n' + parts.join('\n\n') + '\n';
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, 'index.ts'), code, 'utf8');

  return { files: order, chars: code.length, externals: [...externals], deduped, out: join(OUT, 'index.ts') };
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('bundle-edge-function.mjs');
if (invokedDirectly) {
  const res = await bundleEdgeFunction();
  console.log('bundled ' + res.files.length + ' modules + entry -> ' + res.chars + ' chars');
  console.log('  order    : ' + res.files.join(' -> '));
  console.log('  externals: ' + (res.externals.join(', ') || '(none)'));
  if (res.deduped.length) console.log('  deduped  : ' + res.deduped.join(', '));
  console.log('  out      : ' + res.out);
}
