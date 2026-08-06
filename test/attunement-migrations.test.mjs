import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const assetsRoot = join(root, 'electron', 'assets');

const patchesOf = (manifest) => manifest.targets || manifest.patches || {};

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

test('every generated built-in attunement manifest uses v2 semantic bindings', async () => {
  const source = await readFile(join(root, 'electron', 'main.ts'), 'utf8');
  const manifestConstants = [
    'CODEX_GIT_ACTIONS_MANIFEST',
    'BLUE_MESSAGES_MANIFEST',
    'CODEX_YOUTUBE_MANIFEST',
    'CHATGPT_TO_CODEX_MANIFEST',
    'CODEX_LINEAR_TODOS_MANIFEST',
    'CURSOR_LINEAR_TODOS_MANIFEST',
  ];

  for (const constantName of manifestConstants) {
    const match = source.match(new RegExp('const ' + constantName + ' = `([\\s\\S]*?)`;'));
    assert.ok(match, `Could not find ${constantName}`);
    assertV2Bindings(JSON.parse(match[1]), constantName);
  }
});

test('built-in attunement implementations consume shared semantic roles', async () => {
  const mainSource = await readFile(join(root, 'electron', 'main.ts'), 'utf8');
  for (const role of [
    'chatgpt.conversation',
    'chatgpt.composer',
    'linear.issueList',
    'document.body',
    'youtube.player',
  ]) {
    assert.match(mainSource, new RegExp(role.replace('.', '\\.')));
  }
  assert.match(mainSource, /window\.__attuneHost\?\.resolve/);

  const bundledConsumers = [
    join(assetsRoot, 'chatgpt-claude-models', 'apps', 'chatgpt-claude-models.css'),
    join(assetsRoot, 'codex-kanban', 'apps', 'codex-kanban.js'),
    join(assetsRoot, 'linear-completed-to-slack', 'apps', 'linear-completion-source.css'),
    join(assetsRoot, 'linear-completed-to-slack', 'apps', 'slack-completion-dm.css'),
  ];
  for (const file of bundledConsumers) {
    assert.match(await readFile(file, 'utf8'), /window\.__attuneHost\?\.resolve/);
  }
});
