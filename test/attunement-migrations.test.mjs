import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const assetsRoot = join(root, '..', 'attunements', 'attunements');

const patchesOf = (manifest) => manifest.targets || {};

const assertV2Bindings = (manifest, sourceName) => {
  assert.equal(manifest.manifestVersion, 2, `${sourceName} must use manifest v2`);
  for (const [appName, patch] of Object.entries(patchesOf(manifest))) {
    assert.ok(
      patch.bindings && Object.keys(patch.bindings).length > 0,
      `${sourceName} (${appName}) must declare semantic bindings`,
    );
    for (const [bindingName, binding] of Object.entries(patch.bindings)) {
      assert.equal(typeof binding.role, 'string', `${sourceName}.${bindingName} needs a role`);
      assert.equal(typeof binding.required, 'boolean', `${sourceName}.${bindingName} needs required`);
    }
  }
};

test('every bundled attunement uses v2 semantic bindings', async () => {
  const directories = await readdir(assetsRoot, { withFileTypes: true });
  for (const directory of directories) {
    if (!directory.isDirectory()) continue;
    const manifestPath = join(assetsRoot, directory.name, 'manifest.json');
    let source;
    try {
      source = await readFile(manifestPath, 'utf8');
    } catch {
      continue;
    }
    assertV2Bindings(JSON.parse(source), directory.name);
  }
});

test('built-in attunement implementations consume shared semantic roles', async () => {
  const bundledConsumers = [
    join(assetsRoot, 'chatgpt-to-codex', 'apps', 'chrome-chatgpt-to-codex.js'),
    join(assetsRoot, 'codex-linear-todos', 'apps', 'linear-todos-source.js'),
    join(assetsRoot, 'codex-youtube-player', 'apps', 'chrome-youtube-source.js'),
    join(assetsRoot, 'chatgpt-claude-models', 'apps', 'chatgpt-claude-models.js'),
    join(assetsRoot, 'codex-kanban', 'apps', 'codex-kanban.js'),
    join(assetsRoot, 'linear-completed-to-slack', 'apps', 'linear-completion-source.js'),
    join(assetsRoot, 'linear-completed-to-slack', 'apps', 'slack-completion-dm.js'),
  ];
  for (const file of bundledConsumers) {
    assert.match(await readFile(file, 'utf8'), /window\.__attuneHost\?\.resolve/);
  }
});
