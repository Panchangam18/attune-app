import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = dirname(testDirectory);
const moduleUrl = pathToFileURL(join(projectDirectory, 'dist-electron', 'element-picker-shortcut.js')).href;
const {
  parseNativeAppPickerSignal,
  supportedButNotAttachedPickerNotice,
} = await import(moduleUrl);

test('native picker signals retain the frontmost supported app identity', () => {
  assert.deepEqual(
    parseNativeAppPickerSignal('picker:app:60206:com.spotify.client'),
    { appPid: 60206, appId: 'com.spotify.client' },
  );
  assert.deepEqual(
    parseNativeAppPickerSignal('picker:app:1728'),
    { appPid: 1728, appId: null },
  );
  assert.equal(parseNativeAppPickerSignal('picker:app:0:com.spotify.client'), null);
  assert.equal(parseNativeAppPickerSignal('picker:app:60206:bad id'), null);
});

test('supported unattached apps get an actionable picker notice', () => {
  assert.equal(
    supportedButNotAttachedPickerNotice('Spotify'),
    'Spotify is supported but not attached. Open it through Attune, then press ⌥⌘A again.',
  );
});

test('picker recovers a supported app that was reopened without Attune', async () => {
  const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
  assert.match(main, /Reopening \$\{supportedApp\.name\} through Attune for component selection/);
  assert.match(main, /restartRunningAppThroughAttune\(supportedApp, appId, scanModule\)/);
  assert.match(main, /findFocusedElementPickerTarget\(undefined, undefined, appId\)/);
});

test('native monitor accepts bundle-aware picker test signals', { skip: process.platform !== 'darwin' }, async () => {
  const helper = join(projectDirectory, 'dist-electron', 'assets', 'safari-slash-monitor');
  const child = spawn(helper, [], {
    env: { ...process.env, ATTUNE_BROWSER_SLASH_TEST_SIGNAL: 'picker:app:60206:com.spotify.client' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Native picker monitor did not emit its test signal.')), 3000);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
        if (!stdout.includes('picker:app:60206:com.spotify.client')) return;
        clearTimeout(timer);
        resolve();
      });
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  } finally {
    child.kill('SIGTERM');
  }
  assert.match(stdout, /picker:app:60206:com\.spotify\.client/);
});
