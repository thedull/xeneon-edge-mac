// scripts/kiosk-on-primary.mjs — launch the Electron app forcing the kiosk window
// onto the primary display at 2560x720 (develop/demo without the physical Edge).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electron = require('electron'); // resolves to the Electron binary path

const child = spawn(electron, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, XEM_FORCE_PRIMARY: '1' },
});

child.on('close', (code) => process.exit(code ?? 0));
