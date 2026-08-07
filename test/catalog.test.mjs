import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { installCatalogAttunements } from '../dist-electron/catalog.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const catalogRoot = join(root, '..', 'attunements');

test('catalog installer installs managed packages and preserves unmarked custom copies', async () => {
  const destination = await mkdtemp(join(tmpdir(), 'attune-catalog-'));
  try {
    installCatalogAttunements(catalogRoot, destination);
    const marker = JSON.parse(await readFile(
      join(destination, 'codex-kanban', '.attune-package.json'),
      'utf8',
    ));
    assert.equal(marker.id, 'codex-kanban');
    assert.equal(marker.version, '1.0.0');

    const customManifest = join(destination, 'blue-messages', 'manifest.json');
    await rm(join(destination, 'blue-messages', '.attune-package.json'));
    await writeFile(customManifest, '{"name":"My custom blue"}\n');
    installCatalogAttunements(catalogRoot, destination);
    assert.equal(await readFile(customManifest, 'utf8'), '{"name":"My custom blue"}\n');
  } finally {
    await rm(destination, { recursive: true, force: true });
  }
});
