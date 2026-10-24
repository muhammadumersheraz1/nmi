import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const cwd = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

console.log('NMI sample → browser calls Sign-Up API directly (Network tab shows sandbox.signup.nmi.com)');
console.log('Gateway → Vite proxy /nmi-gateway → sandbox.nmi.com (no local Node API)');
console.log('');

const child = spawn('npx', ['vite', '--port', '5190', '--strictPort'], {
  cwd,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: process.env,
});
child.on('exit', (code) => process.exit(code || 0));
