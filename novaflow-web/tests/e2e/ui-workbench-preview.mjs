// Preview the complete source application, including its actual Drawing UI.
// No replacement shell, fake controls, model responses or authentication overrides.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const renderer = fileURLToPath(new URL('../../renderer/', import.meta.url));
const server = spawn('python', ['-m', 'http.server', '4894', '--bind', '127.0.0.1', '--directory', renderer], { stdio: 'inherit', windowsHide: true });
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.on('exit', code => { process.exitCode = code || 0; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill());
