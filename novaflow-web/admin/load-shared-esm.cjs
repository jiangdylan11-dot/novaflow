'use strict';
// CJS bridge for Electron (Node 20): sync require() of packages/shared *.mjs fails
// with ERR_REQUIRE_ESM. Callers use dynamic import() via these loaders.
// Path works in both dev (novaflow-web/admin) and packaged (resources/app +
// resources/packages/shared/src from electron-builder extraResources).
const path = require('path');
const { pathToFileURL } = require('url');

const SHARED_SRC = path.join(__dirname, '..', 'packages', 'shared', 'src');

// Keep identical to packages/shared/src/runninghub-llm.mjs (sync default for CJS).
const DEFAULT_RUNNINGHUB_LLM_BASE_URL = 'https://llm.runninghub.ai/v1';
const DEFAULT_RUNNINGHUB_LLM_MODEL = 'xai/grok-4.7';

const cache = new Map();
function importShared(name) {
  if (!cache.has(name)) {
    cache.set(name, import(pathToFileURL(path.join(SHARED_SRC, name)).href));
  }
  return cache.get(name);
}

module.exports = {
  SHARED_SRC,
  DEFAULT_RUNNINGHUB_LLM_BASE_URL,
  DEFAULT_RUNNINGHUB_LLM_MODEL,
  importShared,
  loadRunningHubLlm: () => importShared('runninghub-llm.mjs'),
  loadFeatureCredits: () => importShared('feature-credits.mjs')
};
