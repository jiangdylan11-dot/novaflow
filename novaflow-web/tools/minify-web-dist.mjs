// Minify + strip every NovaFlow-authored script in a built web-dist tree.
//
// Why this exists: the deployable site (and the copy inside the 启动助手
// installer) shipped the renderer modules as original source, comments and
// all - the self-蒙皮/骨架 algorithms even carry the formulas in their header
// comments. Anyone who opened the site could read and copy them. This pass
// removes the comments and mangles local and function names, so what ships is
// hard to read and hard to lift, without changing behaviour.
//
// What it deliberately does NOT do:
//   * It never renames object properties. Modules talk to each other through
//     globals like `window.NovaFlowAutoBones.generate(...)` and read data
//     fields like `bone.name === 'chest'`; mangling properties would break
//     both. (Verified: no renderer code relies on a function's .name or on
//     Function.prototype.toString, so mangling function names is safe.)
//   * It never mangles top-level names, so a bare global defined in one file
//     and used in another still resolves.
//   * It never touches third-party code under any `vendor/` directory, and it
//     leaves filenames untouched, because workers importScripts() them and the
//     skeleton-editor iframe injects them by name.
//
// It is best-effort per file: a file terser cannot parse is left exactly as it
// was and reported, so a single odd module can never break a release build.

import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join, extname, sep } from 'node:path';
import { minify } from 'terser';

// Third-party bundles keep their own minification; re-chewing them only risks
// breaking glue that expects specific shapes (ffmpeg worker, onnxruntime).
function isVendor(relPath) {
  return relPath.split(/[\\/]/).includes('vendor');
}

// The Vite bundle under assets/ is the only ES module we ship; it is loaded
// with <script type="module">. Everything else is a classic script or a
// classic (importScripts) worker.
function isModule(relPath) {
  return relPath.endsWith('.mjs') || relPath.split(/[\\/]/).includes('assets');
}

function terserOptions(asModule) {
  return {
    module: asModule,
    compress: { passes: 2 },
    // mangle locals and function names, never properties, never top-level.
    mangle: { toplevel: false },
    format: { comments: false, ascii_only: true, ecma: 2020 }
  };
}

async function walkJs(dir, base = dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkJs(full, base, out);
    } else if (extname(entry.name) === '.js') {
      out.push(full.slice(base.length + 1));
    }
  }
  return out;
}

/**
 * Minify every shippable .js under `dir`, in place.
 * Returns { files, minified, skipped, failures, beforeBytes, afterBytes }.
 */
export async function minifyTree(dir, { log = () => {} } = {}) {
  const relFiles = await walkJs(dir);
  const result = { files: relFiles.length, minified: 0, skipped: 0, failures: [], beforeBytes: 0, afterBytes: 0 };

  for (const rel of relFiles) {
    if (isVendor(rel)) { result.skipped += 1; continue; }
    const full = join(dir, rel);
    const source = await readFile(full, 'utf8');
    result.beforeBytes += Buffer.byteLength(source);
    try {
      const asModule = isModule(rel);
      let output = await minify({ [rel.split(sep).join('/')]: source }, terserOptions(asModule));
      // A classic script that actually uses import/export reparses as a module.
      if ((!output || typeof output.code !== 'string') && !asModule) {
        output = await minify({ [rel.split(sep).join('/')]: source }, terserOptions(true));
      }
      if (!output || typeof output.code !== 'string' || !output.code.length) {
        throw new Error('terser returned no code');
      }
      await writeFile(full, output.code, 'utf8');
      result.afterBytes += Buffer.byteLength(output.code);
      result.minified += 1;
    } catch (error) {
      // Leave the original in place so a release never breaks on one file.
      result.afterBytes += Buffer.byteLength(source);
      result.failures.push({ file: rel, error: String(error && error.message || error).slice(0, 200) });
      log('minify skipped (kept original)', { file: rel, error: String(error && error.message || error).slice(0, 160) });
    }
  }
  return result;
}

// Standalone: `node tools/minify-web-dist.mjs <dir>` for ad-hoc runs/tests.
const invokedDirectly = process.argv[1] && process.argv[1].endsWith('minify-web-dist.mjs');
if (invokedDirectly) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: node tools/minify-web-dist.mjs <web-dist-dir>'); process.exit(1); }
  await stat(dir);
  const r = await minifyTree(dir, { log: (m, x) => console.log(m, JSON.stringify(x)) });
  console.log('minify:', JSON.stringify({
    files: r.files, minified: r.minified, skipped: r.skipped, failures: r.failures.length,
    before: Math.round(r.beforeBytes / 1024) + ' KB', after: Math.round(r.afterBytes / 1024) + ' KB'
  }, null, 2));
  for (const f of r.failures.slice(0, 20)) console.log('  FAIL ' + f.file + ' -> ' + f.error);
}
