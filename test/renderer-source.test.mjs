import assert from 'node:assert/strict';
import test from 'node:test';

import { selectRendererDevServerUrl } from '../dist-electron/renderer-source.js';

test('development builds may use the configured Vite renderer', () => {
  assert.equal(
    selectRendererDevServerUrl(false, 'http://127.0.0.1:5173'),
    'http://127.0.0.1:5173',
  );
});

test('packaged builds always ignore development renderer URLs', () => {
  assert.equal(
    selectRendererDevServerUrl(true, 'http://127.0.0.1:5173'),
    undefined,
  );
});
