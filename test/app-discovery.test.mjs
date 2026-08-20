import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { AppDiscoveryService } from '../dist-electron/app-discovery.js';

test('runs synchronous installed-app discovery outside the caller event loop', async () => {
  const service = new AppDiscoveryService();
  const runtimePath = fileURLToPath(new URL('./fixtures/app-discovery-runtime.mjs', import.meta.url));
  try {
    const scan = service.scan(runtimePath, 0);
    const startedAt = performance.now();
    const timerElapsed = await new Promise((resolve) => setTimeout(() => resolve(performance.now() - startedAt), 20));
    const apps = await scan;

    assert.ok(timerElapsed < 100, `main event loop timer was delayed by ${timerElapsed.toFixed(1)}ms`);
    assert.deepEqual(apps, [{
      name: 'Fixture App',
      path: '/Applications/Fixture App.app',
      bundleId: 'com.attune.fixture',
      runtime: 'electron',
      appId: 'com.attune.fixture',
      executablePath: '/Applications/Fixture App.app/Contents/MacOS/Fixture App',
    }]);
  } finally {
    service.close();
  }
});

test('coalesces concurrent discovery requests into one worker scan', async () => {
  const service = new AppDiscoveryService();
  const runtimePath = fileURLToPath(new URL('./fixtures/app-discovery-runtime.mjs', import.meta.url));
  try {
    const first = service.scan(runtimePath, 0);
    const second = service.scan(runtimePath, 0);
    assert.strictEqual(first, second);
    await first;
  } finally {
    service.close();
  }
});
