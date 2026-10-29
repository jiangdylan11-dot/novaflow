// All product surfaces consume the approved foart vector/raster masters.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const BRAND_ASSET_COPIES = [];
const add = (source, ...targets) => targets.forEach(target => BRAND_ASSET_COPIES.push({ source: `branding/${source}`, target }));
for (const name of ['foart-logo-dark.svg', 'foart-logo-light.svg', 'foart-mark.svg', 'foart-app-icon.svg', 'foart-contact.svg']) {
  add(name, `renderer/assets/${name}`, `web/public/assets/${name}`);
}
add('foart-logo-dark.svg', 'worker/electron/assets/foart-logo-dark.svg', 'admin/build/foart-logo-dark.svg');
add('foart-logo-dark.png', 'renderer/assets/logo.png', 'renderer/assets/asset-BmmmtA7v.png', 'worker/electron/assets/logo.png');
add('foart-mark.png', 'renderer/assets/novaflow-brand-mark.png', 'renderer/assets/asset-BsnHnLaI.png');
add('foart-app-icon.png', 'renderer/assets/icon.png');
add('foart-app-icon.ico', 'renderer/assets/foart.ico', 'renderer/assets/favicon.ico', 'renderer/assets/favicon-CLAJAQ7J.ico', 'renderer/assets/asset-CLAJAQ7J.ico', 'worker/electron/assets/favicon.ico', 'web/public/assets/foart.ico');
add('foart-admin-icon.png', 'admin/build/icon.png');
add('foart-admin-icon.ico', 'admin/build/icon.ico', 'admin/build/foart-admin-icon.ico');

export async function syncBrandAssets({ check = false } = {}) {
  for (const { source, target } of BRAND_ASSET_COPIES) {
    const bytes = await readFile(resolve(root, source));
    const dest = resolve(root, target);
    if (check) {
      if (!bytes.equals(await readFile(dest))) throw new Error(`foart brand asset drift: ${target}`);
    } else {
      await mkdir(dirname(dest), { recursive: true });
      let current;
      try { current = await readFile(dest); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (!current?.equals(bytes)) await writeFile(dest, bytes);
    }
  }
  // Keep legacy size-specific ICO aliases current as well.
  const ico = await readFile(resolve(root, 'branding/foart-app-icon.ico'));
  for (const size of [16, 32, 48, 64, 96, 128]) {
    let entry;
    for (let i = 0; i < ico.readUInt16LE(4); i++) {
      const at = 6 + i * 16;
      if ((ico[at] || 256) === size) { entry = ico.subarray(at, at + 16); break; }
    }
    if (!entry) throw new Error(`Missing foart ICO size ${size}`);
    const bytes = ico.subarray(entry.readUInt32LE(12), entry.readUInt32LE(12) + entry.readUInt32LE(8));
    const header = Buffer.alloc(22);
    header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
    entry.copy(header, 6); header.writeUInt32LE(22, 18);
    const output = Buffer.concat([header, bytes]);
    const target = resolve(root, `renderer/assets/ico/${size}x${size}.ico`);
    if (check) {
      if (!output.equals(await readFile(target))) throw new Error(`foart ICO drift: ${size}`);
    } else {
      let current;
      try { current = await readFile(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (!current?.equals(output)) await writeFile(target, output);
    }
  }
  return BRAND_ASSET_COPIES.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`foart: ${await syncBrandAssets({ check: process.argv.includes('--check') })} brand assets ${process.argv.includes('--check') ? 'verified' : 'synced'}`);
}
