import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const attunementRoot = join(root, '..', 'attunements', 'attunements', 'codex-multi-chat');

test('Chat Canvas declares semantic host bindings', async () => {
  const manifest = JSON.parse(await readFile(join(attunementRoot, 'manifest.json'), 'utf8'));
  const patch = manifest.targets.Codex;

  assert.equal(manifest.manifestVersion, 2);
  assert.equal(patch.bindings.main.role, 'codex.primaryChat');
  assert.equal(patch.bindings.main.required, true);
  assert.equal(patch.bindings.composer.role, 'codex.composer');
  assert.equal(patch.bindings.timeline.role, 'codex.timeline');
  assert.equal(patch.bindings.header.required, false);
});

test('Chat Canvas targets Attune roles with a semantic staged-upgrade fallback', async () => {
  const [styles, script] = await Promise.all([
    readFile(join(attunementRoot, 'apps', 'codex-chat-canvas.css'), 'utf8'),
    readFile(join(attunementRoot, 'apps', 'codex-chat-canvas.js'), 'utf8'),
  ]);

  assert.match(styles, /data-attune-host-roles~="codex\.primaryChat"/);
  assert.match(styles, /data-attune-host-roles~="codex\.chatHeader"/);
  assert.match(script, /main\[data-app-shell-main-surface\]/);
  assert.doesNotMatch(script, /document\.querySelector\('main\.main-surface'\)/);
});

test('Chat Canvas discovers native rendering by capabilities instead of minified names', async () => {
  const source = await readFile(join(attunementRoot, 'apps', 'codex-chat-canvas.js'), 'utf8');

  assert.match(source, /reactRuntimeCapabilities/);
  assert.match(source, /bundledCommonJsLoader/);
  assert.match(source, /nativeTaskSurfaceScore/);
  assert.match(source, /hasFiberProps\(fiber, \['clientThreadId', 'conversationId'\]\)/);
  assert.doesNotMatch(source, /module\.Nvt/);
  assert.doesNotMatch(source, /module\.ept/);
  assert.doesNotMatch(source, /fiber\.type\?\.name !== 'EO'/);
  assert.doesNotMatch(source, /fiber\.type\?\.name !== '\$u'/);
});
