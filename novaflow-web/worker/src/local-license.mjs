import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);

export function createLocalLicense(userDataDir) {
  const packaged = join(process.resourcesPath || '', 'desktop-license');
  const root = existsSync(join(packaged, 'license-core.js')) ? packaged : fileURLToPath(new URL('../../../particle-editor-desktop/', import.meta.url));
  const core = require(join(root, 'license-core.js'));
  const online = require(join(root, 'license/licenseOnlineVerifier.js'));
  const state = async () => online.verifyLicenseOnline({ userDataDir,
    localState: await core.getLicenseState(userDataDir), source: 'local-assistant',
    allowOfflineCache: true, successReuseMs: 30000, successReuseScope: 'local-assistant' });
  return {
    state,
    renderLockScreen: value => require(join(root, 'license/licenseLockScreen.js')).renderLicenseLockScreenHtml(value),
    async assertAllowed() {
      const s = await state();
      if (s.status !== 'licensed' || s.locked) throw Object.assign(new Error('本机授权未通过，请在本地助手「设置」中查看或导入有效授权'), { status: 403, code: s.reason || s.error || s.status });
      return s;
    },
    async importLicense(text) {
      const value = core.parseLicenseInput(text);
      const machineId = await core.getMachineId();
      const verified = core.verifyLicenseObject(value, machineId);
      if (!verified.ok) throw new Error('授权无效：' + verified.code);
      // Match desktop import: validate online before replacing the saved license.
      const imported = await online.verifyLicenseOnline({ userDataDir,
        localState: { status: 'licensed', machineId, payload: verified.payload },
        source: 'local-assistant-import', allowOfflineCache: false });
      if (imported.status !== 'licensed' || imported.locked) {
        throw Object.assign(new Error(imported.reason || imported.error || '授权验证失败'), { state: imported });
      }
      await core.saveLicenseToDiskAsync(userDataDir, value);
      online.clearOnlineLicenseSuccessReuse(userDataDir);
      return state();
    }
  };
}
