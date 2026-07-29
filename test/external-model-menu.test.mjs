import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const electronPath = fileURLToPath(new URL(
  '../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
  import.meta.url,
));
const fixturePath = fileURLToPath(new URL(
  './fixtures/external-model-menu-electron.cjs',
  import.meta.url,
));

test('external model submenu selects once and retains its CSS chevron', async () => {
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronPath, [fixturePath], {
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  assert.equal(exitCode, 0, `${stdout}\n${stderr}`);
});
