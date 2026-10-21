import { readFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const UI_BROWSER_DEPENDENCIES = ['ui-smart-split.core.js', 'ui-design.smart-split.js', 'ui-design-style-reference.js', 'ui-design.drawing.js'];

export async function verifyScriptReferences(webRoot) {
  const html = await readFile(join(webRoot, 'index.html'), 'utf8');
  const scripts = [];
  for (const match of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/gi)) {
    const value = match[2];
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value)) continue;
    const path = decodeURIComponent(new URL(value, 'https://release.invalid/').pathname).replace(/^\/+/, '');
    scripts.push(path);
  }
  const missing = [];
  for (const file of scripts) {
    try { await access(join(webRoot, file)); } catch { missing.push(file); }
  }
  if (missing.length) throw new Error('Release references missing browser scripts: ' + missing.join(', '));
  return { html, scripts };
}

export async function verifyUiReleaseAssets({ webRoot, workerSrcRoot, workerRendererRoot, desktopRoot }) {
  const { scripts } = await verifyScriptReferences(webRoot);
  const requirements = [
    ...UI_BROWSER_DEPENDENCIES.map(name => [webRoot, name]),
    [workerSrcRoot, 'prompt-assistant.mjs'], [workerSrcRoot, 'ui-catalog-planner.mjs'],
    [workerRendererRoot, 'spine-split-runtime.js'], [workerRendererRoot, 'art-generate-reference-drop.tool.js'],
    [desktopRoot, 'prompt-assistant-service.py'], [desktopRoot, 'prompt_assistant/ui_split_proposal.py'],
    [desktopRoot, 'prompt_assistant/ui_catalog_cli.py'], [desktopRoot, 'prompt_assistant/ui_catalog/bridge.py'],
    [desktopRoot, 'prompt_assistant/ui_catalog/compiler.py'], [desktopRoot, 'prompt_assistant/ui_catalog/OPTIONAL-DESIGN-RULES.json']
  ];
  for (const [base, file] of requirements) {
    try { await access(join(base, file)); } catch { throw new Error('Release missing UI dependency: ' + join(base, file)); }
  }
  const before = (a, b) => {
    if (scripts.indexOf(a) < 0 || scripts.indexOf(b) < 0 || scripts.indexOf(a) >= scripts.indexOf(b)) throw new Error('Invalid UI script order: ' + a + ' before ' + b);
  };
  before('ui-smart-split.core.js', 'ui-design.smart-split.js');
  before('ui-design.smart-split.js', 'ui-design.drawing.js');
  before('ui-design-style-reference.js', 'ui-design.drawing.js');
  const service = await readFile(join(desktopRoot, 'prompt-assistant-service.py'), 'utf8');
  const native = await readFile(join(workerRendererRoot, 'spine-split-runtime.js'), 'utf8');
  const transport = await readFile(join(workerSrcRoot, 'prompt-assistant.mjs'), 'utf8');
  const drop = await readFile(join(workerRendererRoot, 'art-generate-reference-drop.tool.js'), 'utf8');
  for (const [ok, label] of [
    [service.includes("purpose == 'ui-layer-proposal'") && service.includes('prompt_assistant.ui_split_proposal'), 'Python UI split dispatch'],
    [transport.includes('nf.ui.split.v1') && transport.includes('usesUiSplit'), 'UI split transport'],
    [/async\s+extractUiObject\s*\(/.test(native), 'native UI object extractor'],
    [native.includes('contextForPart(referencePart)'), 'layer repair source context'],
    [drop.includes('novaflowUiSplitContext'), 'layer reference context transport']
  ]) if (!ok) throw new Error('Release missing ' + label);
  return { checkedScripts: scripts.length, requiredDependencies: requirements.length, uiSplitBackend: true, nativeLayerExtractor: true };
}

const direct = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) {
  const index = process.argv.indexOf('--resources');
  const resources = index >= 0 ? resolve(process.argv[index + 1]) : null;
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const result = await verifyUiReleaseAssets(resources ? {
    webRoot: join(resources, 'web-dist'), workerSrcRoot: join(resources, 'app/src'),
    workerRendererRoot: join(resources, 'worker-renderer'), desktopRoot: join(resources, 'desktop-license')
  } : {
    webRoot: join(root, 'web-dist'), workerSrcRoot: join(root, 'worker/src'),
    workerRendererRoot: join(root, 'worker-renderer'), desktopRoot: resolve(root, '../particle-editor-desktop')
  });
  console.log(JSON.stringify(result));
}
