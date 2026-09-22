// Reuse the desktop machine-code screen, with only its five license IPCs.
const path = require('node:path');
const fs = require('node:fs/promises');

function createLicenseGate({ BrowserWindow, ipcMain, dialog, getParent, getLicense }) {
  let window = null, pending = null, resolvePending = null;
  let cancelEpoch = 0;
  const allowed = state => state?.status === 'licensed' && !state.locked;
  const result = async action => {
    try { return await action(); }
    catch (error) { return { ok: false, error: String(error.message || error), state: error.state }; }
  };
  // Only the dedicated modal can import a license or complete the gate.
  const handle = (name, action) => ipcMain.handle(name, (event, payload) => {
    if (!window || event.sender !== window.webContents) return { ok: false, error: 'Invalid license window' };
    return result(() => action(payload));
  });
  handle('assistant-license:state', async () => ({ state: await (await getLicense()).state() }));
  handle('assistant-license:machine', async () => ({ machineId: (await (await getLicense()).state()).machineId }));
  handle('assistant-license:importText', async payload => {
    const state = await (await getLicense()).importLicense(payload?.text);
    return { ok: allowed(state), state };
  });
  handle('assistant-license:importFile', async () => {
    const pick = await dialog.showOpenDialog(window, { properties: ['openFile'], filters: [{ name: 'NovaFlow License', extensions: ['nfl', 'json'] }] });
    if (pick.canceled || !pick.filePaths?.[0]) return { canceled: true };
    const state = await (await getLicense()).importLicense(await fs.readFile(pick.filePaths[0], 'utf8'));
    return { ok: allowed(state), state };
  });
  handle('assistant-license:continue', async () => {
    const state = await (await getLicense()).state();
    if (!allowed(state)) return { ok: false, state, error: state.reason || '授权未通过' };
    resolvePending(true);
    window.close();
    return { ok: true };
  });

  function show(state, license) {
    if (pending) { window?.focus(); return pending; }
    pending = new Promise(resolve => { resolvePending = resolve; });
    const waiting = pending;
    try {
      window = new BrowserWindow({ width: 700, height: 650, resizable: false,
        parent: getParent(), modal: true, title: 'NovaFlow 机器码绑定', autoHideMenuBar: true,
        backgroundColor: '#151515', webPreferences: { preload: path.join(__dirname, 'license-preload.cjs'),
          contextIsolation: true, nodeIntegration: false, sandbox: true } });
      window.on('closed', () => {
        resolvePending?.(false);
        window = null; pending = null; resolvePending = null;
      });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', event => event.preventDefault());
      window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(license.renderLockScreen(state)))
        .catch(() => window?.close());
    } catch (error) {
      window?.destroy(); window = null;
      resolvePending?.(false); pending = null; resolvePending = null;
      throw error;
    }
    return waiting;
  }
  return {
    async ensureAllowed() {
      const epoch = cancelEpoch;
      const license = await getLicense();
      const state = await license.state();
      if (epoch !== cancelEpoch) return false;
      return allowed(state) || show(state, license);
    },
    async inspect() {
      const epoch = cancelEpoch;
      const license = await getLicense();
      const state = await license.state();
      if (epoch === cancelEpoch && !allowed(state)) await show(state, license);
      return { ok: true, state: await license.state() };
    },
    cancel() { cancelEpoch++; window?.close(); }
  };
}
module.exports = { createLicenseGate };
