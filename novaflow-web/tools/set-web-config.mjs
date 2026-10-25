// Point a built site at a control plane.
//
// The build emits a default config block (127.0.0.1:4890, the local control
// plane). A deployment needs a different one, and hand-editing index.html in a
// 22 MB output tree is the kind of step that gets done wrong at 2am - so it is
// a command that rewrites exactly the block the build wrote, verifies what it
// wrote, and refuses rather than guessing if the block is not where it should
// be.
//
//   node tools/set-web-config.mjs --control-url=https://<ref>.supabase.co/functions/v1/novaflow-web
//   node tools/set-web-config.mjs --show

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const INDEX = join(ROOT, 'web-dist/index.html');

const BLOCK = /window\.NOVAFLOW_WEB_CONFIG = window\.NOVAFLOW_WEB_CONFIG \|\| \{[\s\S]*?\};/;

export function readConfig(html) {
  const m = BLOCK.exec(html);
  if (!m) return null;
  const control = /controlUrl:\s*"([^"]*)"/.exec(m[0]);
  const auth = /authUrl:\s*"([^"]*)"/.exec(m[0]);
  const knowledge=/artKnowledgeUrl:\s*"([^"]*)"/.exec(m[0]),enabled=/artKnowledgeEnabled:\s*(true|false)/.exec(m[0]);
  return {controlUrl:control?control[1]:'',authUrl:auth?auth[1]:'',...(knowledge?{artKnowledgeUrl:knowledge[1]}:{}),...(enabled?{artKnowledgeEnabled:enabled[1]==='true'}:{})};
}

export function writeConfig(html, { controlUrl, authUrl, artKnowledgeUrl, artKnowledgeEnabled }) {
  const m = BLOCK.exec(html);
  if (!m) throw new Error('the config block is not in web-dist/index.html - run the build first');
  const current = readConfig(html);
  const nextAuth = authUrl ?? current.authUrl;
  if (/\/functions\/v1\/novaflow-web\/?$/i.test(nextAuth)) throw new Error('账号认证地址不能指向算力控制函数 novaflow-web；请使用既有 novaflow-backend');
  const next =
    'window.NOVAFLOW_WEB_CONFIG = window.NOVAFLOW_WEB_CONFIG || {\n' +
    '        controlUrl: "' + (controlUrl ?? current.controlUrl) + '",\n' +
    '        authUrl: '+JSON.stringify(authUrl??current.authUrl)+
    ((artKnowledgeUrl??current.artKnowledgeUrl)!==undefined?',\n        artKnowledgeUrl: '+JSON.stringify(artKnowledgeUrl??current.artKnowledgeUrl):'')+
    ((artKnowledgeEnabled??current.artKnowledgeEnabled)!==undefined?',\n        artKnowledgeEnabled: '+JSON.stringify(artKnowledgeEnabled??current.artKnowledgeEnabled):'')+'\n'+
    '      };';
  return html.slice(0, m.index) + next + html.slice(m.index + m[0].length);
}

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : null;
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('set-web-config.mjs');
if (invokedDirectly) {
  const html = await readFile(INDEX, 'utf8');
  const current = readConfig(html);
  if (!current) {
    console.error('no config block in ' + INDEX + ' - run: npm run build:renderer');
    process.exit(1);
  }

  if (process.argv.includes('--show') || (!arg('control-url') && !arg('auth-url') && !arg('art-knowledge-url') && !process.argv.includes('--enable-art-knowledge'))) {
    console.log('controlUrl: ' + current.controlUrl);
    console.log('authUrl   : ' + current.authUrl);
    process.exit(0);
  }

  const controlUrl = arg('control-url');
  const authUrl = arg('auth-url'),artKnowledgeUrl=arg('art-knowledge-url'),artKnowledgeEnabled=process.argv.includes('--enable-art-knowledge')?true:undefined;
  for (const [label, value] of [['control-url', controlUrl], ['auth-url', authUrl]]) {
    if (value && !/^https?:\/\//.test(value)) {
      console.error(label + ' must be an absolute http(s) URL: ' + value);
      process.exit(1);
    }
  }

  const next = writeConfig(html, { controlUrl, authUrl, artKnowledgeUrl, artKnowledgeEnabled });
  await writeFile(INDEX, next, 'utf8');

  // Read it back rather than trusting the write.
  const after = readConfig(await readFile(INDEX, 'utf8'));
  console.log('controlUrl: ' + current.controlUrl + '  ->  ' + after.controlUrl);
  console.log('authUrl   : ' + current.authUrl + '  ->  ' + after.authUrl);
  if ((controlUrl && after.controlUrl !== controlUrl) || (authUrl && after.authUrl !== authUrl)) {
    console.error('the file does not hold what was asked for');
    process.exit(1);
  }
}
