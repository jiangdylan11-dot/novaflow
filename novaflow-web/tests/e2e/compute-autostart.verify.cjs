// Manual check on a real Windows account (not part of the suite, it writes the startup entry):
//   node tests/e2e/compute-autostart.verify.cjs
// Turns 开机自启 on and off through the assistant's own module and reads the registry each time.
// It refuses to run while an entry named Foart already exists, so a user's real choice is never touched.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createAutostart, AUTOSTART_NAME, RUN_KEY } = require('../../worker/src/autostart.cjs');
const query = () => { try { return execFileSync('reg.exe', ['query', RUN_KEY, '/v', AUTOSTART_NAME], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; } };
const executable = 'C:\\Program Files\\FoartCompute\\FoartCompute.exe';
if (process.platform !== 'win32') { console.log('compute autostart: Windows only'); process.exit(0); }
if (query()) { console.log('compute autostart: an entry named Foart already exists; left untouched, nothing verified'); process.exit(2); }
const autostart = createAutostart({ executable });
try {
  assert.equal(autostart.enabled(), false);
  assert.equal(autostart.set(true), true, 'reads back as on');
  const written = query();
  console.log(written.trim());
  assert(written.includes('"' + executable + '" --autostart'), 'the quoted path starts the assistant with the tray flag');
  assert.equal(createAutostart({ executable: 'C:\\Elsewhere\\Other.exe' }).enabled(), false, 'an entry for another program is not ours');
  assert.equal(autostart.set(false), false, 'reads back as off');
  assert.equal(query(), '', 'the Run value is gone');
  console.log('compute autostart: startup entry written and removed in the registry');
} finally { try { autostart.set(false); } catch { /* leave nothing behind */ } }
