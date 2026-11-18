// 开机自启: one per-user Windows startup entry named Foart. The entry itself is the saved choice, so it
// survives reinstalling or upgrading the assistant (same install path) and nothing else has to remember it.
// A start from that entry carries AUTOSTART_FLAG and stays in the tray instead of opening the window.
//
// The value is written with reg.exe rather than Electron's setLoginItemSettings: Electron 32 writes the
// path unquoted ("C:\Program Files\..." then splits at the space) and reports openAtLogin false for it.
const { execFileSync } = require('node:child_process');
const AUTOSTART_NAME = 'Foart';
const AUTOSTART_FLAG = '--autostart';
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
// Task Manager's "disabled" switch lives here; a leftover one would silently cancel a fresh tick.
const APPROVED_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run';
const defaultRun = args => execFileSync('reg.exe', args, { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], timeout: 8000 });

function createAutostart({ executable = process.execPath, run = defaultRun, platform = process.platform } = {}) {
  const command = '"' + executable + '" ' + AUTOSTART_FLAG;
  const read = key => { try { return String(run(['query', key, '/v', AUTOSTART_NAME])); } catch { return ''; } };
  function enabled() {
    if (platform !== 'win32') return false;
    if (!read(RUN_KEY).toLowerCase().includes(executable.toLowerCase())) return false;
    // REG_BINARY whose first byte is odd (03, 07) means the user switched it off in Task Manager.
    const approved = /REG_BINARY\s+([0-9A-Fa-f]{2})/.exec(read(APPROVED_KEY));
    return !approved || parseInt(approved[1], 16) % 2 === 0;
  }
  function set(on) {
    if (platform !== 'win32') throw new Error('开机自启目前只支持 Windows');
    try { run(['delete', APPROVED_KEY, '/v', AUTOSTART_NAME, '/f']); } catch { /* nothing to clear */ }
    if (on) run(['add', RUN_KEY, '/v', AUTOSTART_NAME, '/t', 'REG_SZ', '/d', command, '/f']);
    else { try { run(['delete', RUN_KEY, '/v', AUTOSTART_NAME, '/f']); } catch { /* already absent */ } }
    return enabled();
  }
  return { enabled, set, command };
}
const startedByAutostart = (argv = process.argv) => argv.includes(AUTOSTART_FLAG);
module.exports = { AUTOSTART_NAME, AUTOSTART_FLAG, RUN_KEY, APPROVED_KEY, createAutostart, startedByAutostart };
