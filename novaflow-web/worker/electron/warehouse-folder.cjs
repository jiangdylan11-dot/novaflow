// A browser directory handle deliberately has no OS path. A short-lived proof
// inside that directory lets the helper locate it without trusting a web path.
const fs = require('node:fs/promises');
const path = require('node:path');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function parseRequest(value) {
  const url = new URL(value);
  const id = url.searchParams.get('id');
  const sub = url.searchParams.get('sub') || '';
  if (url.protocol !== 'novaflow:' || url.hostname !== 'warehouse' || url.pathname !== '/open' || !UUID.test(id || '')) throw new Error('无效的仓库请求');
  if (sub && sub.split('/').some(part => !part || part === '.' || part === '..' || /[\\:\x00-\x1f]/.test(part))) throw new Error('无效的子目录');
  return { id, sub, name: '.novaflow-open-' + id + '.json' };
}
async function verifyFolder(folder, request) {
  const root = await fs.realpath(folder);
  const proof = await fs.realpath(path.join(root, request.name));
  if (path.dirname(proof) !== root || (await fs.stat(proof)).size > 512) throw new Error('无效的目录凭证');
  const data = JSON.parse(await fs.readFile(proof, 'utf8'));
  const age = Date.now() - data.createdAt;
  if (data.id !== request.id || !Number.isFinite(age) || age < -5000 || age > 180000) throw new Error('仓库请求已失效，请从网页重新打开');
  const target = await fs.realpath(path.join(root, request.sub));
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error('子目录超出仓库范围');
  if (!(await fs.stat(target)).isDirectory()) throw new Error('目标不是文件夹');
  return { root, target, proof };
}
async function openWarehouseFolder(value, { candidates = [], pickFolder, openPath, remember }) {
  const request = parseRequest(value);
  let located;
  for (const candidate of new Set(candidates.filter(Boolean))) {
    try { located = await verifyFolder(candidate, request); break; } catch { /* Try a known location, never recursively scan the disk. */ }
  }
  if (!located) {
    const selected = await pickFolder();
    if (!selected) return { canceled: true };
    try { located = await verifyFolder(selected, request); }
    catch { throw new Error('所选目录不是当前网页连接的仓库根目录，或请求已过期。请重新点击打开，并选择相同文件夹。'); }
  }
  const error = await openPath(located.target);
  if (error) throw new Error(error);
  await fs.unlink(located.proof).catch(() => {});
  await remember?.(located.root);
  return { ok: true };
}
module.exports = { parseRequest, verifyFolder, openWarehouseFolder };
