import assert from 'node:assert/strict';
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  stat,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  CLAUDE_GPT_MODELS,
  CLAUDE_GPT_MODELS_CONFIG_NAME,
  configureClaudeGptModels,
} from '../dist-electron/claude-gpt-models.js';

const json = async (path) => JSON.parse(await readFile(path, 'utf8'));

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'attune-claude-gpt-models-'));
  return {
    root,
    homePath: join(root, 'home'),
    attuneUserDataPath: join(root, 'attune'),
  };
}

function fixturePaths(paths) {
  const claudeRoot = join(paths.homePath, 'Library', 'Application Support', 'Claude-3p');
  return {
    claudeRoot,
    library: join(claudeRoot, 'configLibrary'),
    appConfig: join(claudeRoot, 'claude_desktop_config.json'),
    meta: join(claudeRoot, 'configLibrary', '_meta.json'),
    developerSettings: join(
      paths.homePath,
      'Library',
      'Application Support',
      'Claude',
      'developer_settings.json',
    ),
    state: join(paths.attuneUserDataPath, 'claude-gpt-models-state.json'),
  };
}

async function prepareFirstParty(paths) {
  const resolved = fixturePaths(paths);
  await mkdir(resolved.library, { recursive: true });
  await writeFile(resolved.appConfig, JSON.stringify({ deploymentMode: '1p' }));
  await writeFile(resolved.meta, JSON.stringify({ appliedId: '', entries: [] }));
  return resolved;
}

async function assertMissing(path) {
  await assert.rejects(readFile(path), (error) => error?.code === 'ENOENT');
}

test('keeps Claude native configuration active without enabling Developer Mode', async () => {
  const paths = await fixture();
  const resolved = fixturePaths(paths);
  const result = configureClaudeGptModels({ ...paths, enabled: true });

  assert.equal(result.changed, true);
  assert.equal(result.requiresRestart, true);
  assert.deepEqual(await json(resolved.appConfig), { deploymentMode: '1p' });
  assert.deepEqual(await json(resolved.meta), { appliedId: '', entries: [] });
  assert.deepEqual(await json(resolved.state), {
    version: 4,
    enabled: true,
    retiredConfigId: null,
    priorAppliedId: null,
  });
  await assertMissing(resolved.developerSettings);
  assert.equal((await stat(resolved.state)).mode & 0o777, 0o600);

  const unchanged = configureClaudeGptModels({ ...paths, enabled: true });
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.requiresRestart, false);
});

test('never reads or rewrites Claude Developer Mode settings', async () => {
  const paths = await fixture();
  const resolved = await prepareFirstParty(paths);
  await mkdir(join(resolved.developerSettings, '..'), { recursive: true });
  const source = '{"allowDevTools":false,"userFlag":"untouched"}\n';
  await writeFile(resolved.developerSettings, source);
  await chmod(resolved.developerSettings, 0o644);

  configureClaudeGptModels({ ...paths, enabled: true });
  configureClaudeGptModels({ ...paths, enabled: false });

  assert.equal(await readFile(resolved.developerSettings, 'utf8'), source);
  assert.equal((await stat(resolved.developerSettings)).mode & 0o777, 0o644);
});

test('uses Claude-3p only as the startup sentinel and leaves the native profile untouched', async () => {
  const paths = await fixture();
  const nativeRoot = join(paths.homePath, 'Library', 'Application Support', 'Claude');
  const nativeConfig = join(nativeRoot, 'claude_desktop_config.json');
  const nativeSource = '{"preferences":{"nativeHistory":"preserve"},"userSetting":true}\n';
  await mkdir(nativeRoot, { recursive: true });
  await writeFile(nativeConfig, nativeSource, { mode: 0o640 });

  configureClaudeGptModels({ ...paths, enabled: true });
  configureClaudeGptModels({ ...paths, enabled: false });

  assert.equal(await readFile(nativeConfig, 'utf8'), nativeSource);
  assert.equal((await stat(nativeConfig)).mode & 0o777, 0o640);
  assert.equal((await json(fixturePaths(paths).appConfig)).deploymentMode, '1p');
  assert.equal((await json(fixturePaths(paths).meta)).appliedId, '');
});

test('retires the obsolete Attune gateway while retaining its prior ID only for audit', async () => {
  const paths = await fixture();
  const resolved = fixturePaths(paths);
  await mkdir(resolved.library, { recursive: true });
  await mkdir(paths.attuneUserDataPath, { recursive: true });
  await writeFile(resolved.appConfig, JSON.stringify({ deploymentMode: '3p' }));
  await writeFile(resolved.meta, JSON.stringify({
    appliedId: 'attune-gateway',
    entries: [
      { id: 'prior-config', name: 'Prior' },
      { id: 'attune-gateway', name: CLAUDE_GPT_MODELS_CONFIG_NAME },
    ],
  }));
  await writeFile(join(resolved.library, 'attune-gateway.json'), JSON.stringify({
    inferenceGatewayApiKey: 'credential-that-must-be-removed',
    inferenceProvider: 'gateway',
  }));
  await writeFile(resolved.state, JSON.stringify({
    version: 1,
    configId: 'attune-gateway',
    priorDeploymentMode: '3p',
    priorAppliedId: 'prior-config',
  }));

  configureClaudeGptModels({ ...paths, enabled: true });

  assert.equal((await json(resolved.appConfig)).deploymentMode, '1p');
  assert.deepEqual(await json(resolved.meta), {
    appliedId: '',
    entries: [{ id: 'prior-config', name: 'Prior' }],
  });
  assert.deepEqual(await json(join(resolved.library, 'attune-gateway.json')), {});
  assert.deepEqual(await json(resolved.state), {
    version: 4,
    enabled: true,
    retiredConfigId: 'attune-gateway',
    priorAppliedId: 'prior-config',
  });
});

test('keeps an auth-disabling third-party config detached while enabled and disabled', async () => {
  const paths = await fixture();
  const resolved = fixturePaths(paths);
  await mkdir(resolved.library, { recursive: true });
  const priorEntry = { id: 'prior-config', name: 'User config' };
  const priorConfig = {
    authentication: { disableClaudeAiSignIn: true },
    userSetting: 'preserve-me',
  };
  await writeFile(resolved.appConfig, JSON.stringify({ deploymentMode: '3p' }));
  await writeFile(resolved.meta, JSON.stringify({
    appliedId: priorEntry.id,
    entries: [priorEntry],
  }));
  await writeFile(join(resolved.library, `${priorEntry.id}.json`), JSON.stringify(priorConfig));

  configureClaudeGptModels({ ...paths, enabled: true });
  assert.equal((await json(resolved.appConfig)).deploymentMode, '1p');
  assert.deepEqual(await json(resolved.meta), { appliedId: '', entries: [priorEntry] });
  assert.deepEqual(await json(join(resolved.library, `${priorEntry.id}.json`)), priorConfig);
  assert.equal((await json(resolved.state)).priorAppliedId, priorEntry.id);

  // Even if another process selects the unsafe profile again, disabling this
  // add-on preserves native Claude as the baseline instead of restoring 3p.
  await writeFile(resolved.meta, JSON.stringify({
    appliedId: priorEntry.id,
    entries: [priorEntry],
  }));
  configureClaudeGptModels({ ...paths, enabled: false });
  assert.deepEqual(await json(resolved.meta), { appliedId: '', entries: [priorEntry] });
  assert.deepEqual(await json(join(resolved.library, `${priorEntry.id}.json`)), priorConfig);
  assert.deepEqual(await json(resolved.state), {
    version: 4,
    enabled: false,
    retiredConfigId: null,
    priorAppliedId: priorEntry.id,
  });
});

test('migrates legacy Developer Mode state without touching developer settings', async () => {
  const paths = await fixture();
  const resolved = await prepareFirstParty(paths);
  await mkdir(paths.attuneUserDataPath, { recursive: true });
  await mkdir(join(resolved.developerSettings, '..'), { recursive: true });
  const developerSource = '{"allowDevTools":true,"legacyField":"kept"}\n';
  await writeFile(resolved.developerSettings, developerSource);
  await writeFile(resolved.state, JSON.stringify({
    version: 3,
    enabled: true,
    phase: 'enabled',
    retiredConfigId: null,
    developerSettingsBeforeEnable: {
      fileExisted: true,
      allowDevToolsPresent: false,
      allowDevToolsValue: null,
      settings: {},
    },
  }));

  configureClaudeGptModels({ ...paths, enabled: false });

  assert.equal(await readFile(resolved.developerSettings, 'utf8'), developerSource);
  assert.deepEqual(await json(resolved.state), {
    version: 4,
    enabled: false,
    retiredConfigId: null,
    priorAppliedId: null,
  });
});

test('does not retire a config whose metadata no longer identifies Attune as its owner', async () => {
  const paths = await fixture();
  const resolved = fixturePaths(paths);
  await mkdir(resolved.library, { recursive: true });
  await mkdir(paths.attuneUserDataPath, { recursive: true });
  await writeFile(resolved.appConfig, JSON.stringify({ deploymentMode: '3p' }));
  await writeFile(resolved.meta, JSON.stringify({
    appliedId: 'reused-config',
    entries: [{ id: 'reused-config', name: 'User Gateway' }],
  }));
  const userConfig = {
    inferenceGatewayApiKey: 'user-owned-credential',
    inferenceProvider: 'gateway',
  };
  await writeFile(join(resolved.library, 'reused-config.json'), JSON.stringify(userConfig));
  await writeFile(resolved.state, JSON.stringify({
    version: 1,
    configId: 'reused-config',
    priorDeploymentMode: '1p',
    priorAppliedId: null,
  }));

  configureClaudeGptModels({ ...paths, enabled: true });

  assert.deepEqual(await json(resolved.meta), {
    appliedId: '',
    entries: [{ id: 'reused-config', name: 'User Gateway' }],
  });
  assert.deepEqual(await json(join(resolved.library, 'reused-config.json')), userConfig);
});

test('preflights all config JSON before making its first ordered write', async () => {
  const paths = await fixture();
  const resolved = await prepareFirstParty(paths);
  await writeFile(resolved.appConfig, JSON.stringify({ deploymentMode: '3p' }));
  const steps = [];

  configureClaudeGptModels({
    ...paths,
    enabled: true,
    testHooks: { beforeWrite: (step) => steps.push(step) },
  });

  assert.deepEqual(steps, ['app-config', 'meta', 'state']);
});

test('a write fault cannot publish toggle state before first-party config', async () => {
  const paths = await fixture();
  const resolved = fixturePaths(paths);
  await mkdir(resolved.library, { recursive: true });
  const unsafeMeta = {
    appliedId: 'unsafe-config',
    entries: [{ id: 'unsafe-config', name: 'Unsafe' }],
  };
  await writeFile(resolved.appConfig, JSON.stringify({ deploymentMode: '3p' }));
  await writeFile(resolved.meta, JSON.stringify(unsafeMeta));

  assert.throws(
    () => configureClaudeGptModels({
      ...paths,
      enabled: true,
      testHooks: {
        beforeWrite(step) {
          if (step === 'meta') throw new Error('injected metadata fault');
        },
      },
    }),
    /injected metadata fault/,
  );
  assert.equal((await json(resolved.appConfig)).deploymentMode, '1p');
  assert.deepEqual(await json(resolved.meta), unsafeMeta);
  await assertMissing(resolved.state);

  configureClaudeGptModels({ ...paths, enabled: true });
  assert.equal((await json(resolved.meta)).appliedId, '');
  assert.equal((await json(resolved.state)).enabled, true);
});

for (const unsafeId of ['.', '..', '../../escape', 'bad/slash', 'x'.repeat(129)]) {
  test(`rejects unsafe retired config ID ${JSON.stringify(unsafeId)}`, async () => {
    const paths = await fixture();
    const resolved = await prepareFirstParty(paths);
    await mkdir(paths.attuneUserDataPath, { recursive: true });
    const sentinel = join(paths.root, 'outside-sentinel.json');
    await writeFile(sentinel, JSON.stringify({ untouched: true }));
    await writeFile(resolved.state, JSON.stringify({
      version: 4,
      enabled: false,
      retiredConfigId: unsafeId,
      priorAppliedId: null,
    }));

    assert.throws(
      () => configureClaudeGptModels({ ...paths, enabled: true }),
      /unsafe retired Claude config ID/,
    );
    assert.deepEqual(await json(sentinel), { untouched: true });
    assert.equal((await json(resolved.appConfig)).deploymentMode, '1p');
  });
}

const symlinkTargets = [
  {
    name: 'app configuration',
    select: (paths) => paths.appConfig,
    value: { deploymentMode: '3p' },
  },
  {
    name: 'config-library metadata',
    select: (paths) => paths.meta,
    value: { appliedId: '', entries: [] },
  },
  {
    name: 'bridge state',
    select: (paths) => paths.state,
    value: {
      version: 4,
      enabled: false,
      retiredConfigId: null,
      priorAppliedId: null,
    },
  },
];

for (const symlinkTarget of symlinkTargets) {
  test(`fails closed when the Claude ${symlinkTarget.name} target is a symlink`, async () => {
    const paths = await fixture();
    const resolved = await prepareFirstParty(paths);
    await mkdir(paths.attuneUserDataPath, { recursive: true });
    const target = symlinkTarget.select(resolved);
    try {
      await unlink(target);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const outside = join(paths.root, `outside-${symlinkTarget.name.replaceAll(' ', '-')}.json`);
    const source = `${JSON.stringify(symlinkTarget.value)}\n`;
    await writeFile(outside, source);
    await symlink(outside, target);

    assert.throws(
      () => configureClaudeGptModels({ ...paths, enabled: true }),
      /symlink or non-file JSON target/,
    );
    assert.equal(await readFile(outside, 'utf8'), source);
  });
}

test('fails closed when Claude configLibrary itself is a symlink', async () => {
  const paths = await fixture();
  const resolved = fixturePaths(paths);
  await mkdir(resolved.claudeRoot, { recursive: true });
  await writeFile(resolved.appConfig, JSON.stringify({ deploymentMode: '3p' }));
  const outsideLibrary = join(paths.root, 'outside-library');
  await mkdir(outsideLibrary);
  await writeFile(join(outsideLibrary, '_meta.json'), JSON.stringify({ appliedId: '', entries: [] }));
  await symlink(outsideLibrary, resolved.library, 'dir');

  assert.throws(
    () => configureClaudeGptModels({ ...paths, enabled: true }),
    /symlink or non-directory Claude config library/,
  );
  assert.deepEqual(await json(join(outsideLibrary, '_meta.json')), { appliedId: '', entries: [] });
  assert.equal((await json(resolved.appConfig)).deploymentMode, '3p');
});

test('fails closed instead of following a retired config symlink', async () => {
  const paths = await fixture();
  const resolved = fixturePaths(paths);
  await mkdir(resolved.library, { recursive: true });
  await mkdir(paths.attuneUserDataPath, { recursive: true });
  await writeFile(resolved.appConfig, JSON.stringify({ deploymentMode: '3p' }));
  await writeFile(resolved.meta, JSON.stringify({
    appliedId: 'attune-old',
    entries: [{ id: 'attune-old', name: CLAUDE_GPT_MODELS_CONFIG_NAME }],
  }));
  await writeFile(resolved.state, JSON.stringify({
    version: 4,
    enabled: false,
    retiredConfigId: 'attune-old',
    priorAppliedId: null,
  }));
  const outside = join(paths.root, 'outside-retired.json');
  const source = '{"credential":"untouched"}\n';
  await writeFile(outside, source);
  await symlink(outside, join(resolved.library, 'attune-old.json'));

  assert.throws(
    () => configureClaudeGptModels({ ...paths, enabled: true }),
    /symlink or non-file JSON target/,
  );
  assert.equal(await readFile(outside, 'utf8'), source);
  assert.equal((await json(resolved.appConfig)).deploymentMode, '3p');
});

const invalidJsonShapes = [
  {
    name: 'app configuration',
    select: (paths) => paths.appConfig,
    value: [],
    error: /invalid Claude app configuration/,
  },
  {
    name: 'config-library metadata entry',
    select: (paths) => paths.meta,
    value: {
      appliedId: '',
      entries: [
        { id: 'valid', name: 'Valid' },
        { id: 'malformed-without-name' },
      ],
    },
    error: /invalid Claude config-library metadata/,
  },
  {
    name: 'bridge state',
    select: (paths) => paths.state,
    value: [],
    error: /invalid Claude bridge state/,
  },
];

for (const invalidShape of invalidJsonShapes) {
  test(`does not rewrite an invalid top-level ${invalidShape.name} shape`, async () => {
    const paths = await fixture();
    const resolved = await prepareFirstParty(paths);
    await mkdir(paths.attuneUserDataPath, { recursive: true });
    const target = invalidShape.select(resolved);
    const source = `${JSON.stringify(invalidShape.value)}\n`;
    await writeFile(target, source);
    const appConfigBefore = await readFile(resolved.appConfig, 'utf8');

    assert.throws(
      () => configureClaudeGptModels({ ...paths, enabled: true }),
      invalidShape.error,
    );
    assert.equal(await readFile(target, 'utf8'), source);
    assert.equal(await readFile(resolved.appConfig, 'utf8'), appConfigBefore);
  });
}

test('does not silently replace an invalid retired config object', async () => {
  const paths = await fixture();
  const resolved = fixturePaths(paths);
  await mkdir(resolved.library, { recursive: true });
  await mkdir(paths.attuneUserDataPath, { recursive: true });
  await writeFile(resolved.appConfig, JSON.stringify({ deploymentMode: '3p' }));
  await writeFile(resolved.meta, JSON.stringify({
    appliedId: 'attune-old',
    entries: [{ id: 'attune-old', name: CLAUDE_GPT_MODELS_CONFIG_NAME }],
  }));
  await writeFile(join(resolved.library, 'attune-old.json'), '[]\n');
  await writeFile(resolved.state, JSON.stringify({
    version: 4,
    enabled: false,
    retiredConfigId: 'attune-old',
    priorAppliedId: null,
  }));

  assert.throws(
    () => configureClaudeGptModels({ ...paths, enabled: true }),
    /will not retire invalid Claude configuration/,
  );
  assert.equal((await json(resolved.appConfig)).deploymentMode, '3p');
  assert.deepEqual(await json(join(resolved.library, 'attune-old.json')), []);
});

test('validates the Claude bridge before publishing either toggle profile', async () => {
  const source = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
  const workspaceToggle = source.slice(
    source.indexOf('async function setWorkspaceEnabled'),
    source.indexOf('async function setWorkspaceAppEnabled'),
  );
  const appToggle = source.slice(source.indexOf('async function setWorkspaceAppEnabled'));

  for (const body of [workspaceToggle, appToggle]) {
    const configureIndex = body.indexOf('configureClaudeGptModels({');
    const applyIndex = body.indexOf('applyCompositeStylesheet(');
    const profileIndex = body.indexOf('writeProfile(newProfile)');
    assert.ok(configureIndex >= 0, 'toggle should configure the Claude bridge');
    assert.ok(configureIndex < applyIndex, 'Claude bridge validation must precede stylesheet publication');
    assert.ok(applyIndex < profileIndex, 'stylesheet publication must precede profile publication');
  }
});

test('toggle-off stops the bridge and keeps ordinary Claude launches native', async () => {
  const source = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
  const workspaceToggle = source.slice(
    source.indexOf('async function setWorkspaceEnabled'),
    source.indexOf('async function setWorkspaceAppEnabled'),
  );
  const appToggle = source.slice(
    source.indexOf('async function setWorkspaceAppEnabled'),
    source.indexOf('async function attachRunningSessionIfAvailable'),
  );
  for (const body of [workspaceToggle, appToggle]) {
    assert.match(body, /enabled[\s\S]*restartRunningAppThroughAttune[\s\S]*restartRunningAppNormally/);
    assert.doesNotMatch(body, /keepWrapped/);
  }
  const normalRestart = source.slice(
    source.indexOf('async function restartRunningAppNormally'),
    source.indexOf('async function quitApp'),
  );
  assert.ok(normalRestart.indexOf('sessionModule.stopSession(appId)') < normalRestart.indexOf('isProcessRunning'));
  const autoWrap = source.slice(
    source.indexOf('async function runAutoWrapPass'),
    source.indexOf('async function wrapNormalLaunch'),
  );
  assert.match(autoWrap, /!isClaudeDesktop[\s\S]*isClaudeGptModelsEnabled/);
});

test('preserves the exact GPT aliases used by the runtime picker and router', () => {
  assert.deepEqual(CLAUDE_GPT_MODELS.map(({ name, labelOverride }) => [name, labelOverride]), [
    ['claude-opus-4-8-attune-sol', 'GPT-5.6 Sol'],
    ['claude-sonnet-4-8-attune-terra', 'GPT-5.6 Terra'],
    ['claude-haiku-4-8-attune-luna', 'GPT-5.6 Luna'],
  ]);
});
