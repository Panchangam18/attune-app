import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { getAgentIntegrations, setAgentIntegration, syncManagedAgentIntegrations } from '../dist-electron/agent-integrations.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'attune-agent-integrations-'));
  const runtime = join(root, 'runtime');
  const userDataPath = join(root, 'user-data');
  mkdirSync(join(runtime, 'dist'), { recursive: true });
  writeFileSync(join(runtime, 'SKILL.md'), '---\nname: attune\ndescription: Test skill\n---\n\n# Attune\n');
  writeFileSync(join(runtime, 'dist', 'cli.js'), '');
  return {
    homePath: join(root, 'home'),
    userDataPath,
    skillSourcePath: join(runtime, 'SKILL.md'),
    cliPath: join(runtime, 'dist', 'cli.js'),
    nodePath: '/usr/bin/node',
    electronNode: false,
  };
}

test('installs and removes a managed skill for each coding agent', () => {
  const options = fixture();

  assert.equal(
    getAgentIntegrations(options).find((candidate) => candidate.id === 'codex').name,
    'ChatGPT',
  );

  for (const agentId of ['codex', 'cursor', 'claude']) {
    const message = setAgentIntegration(options, agentId, true);
    const status = getAgentIntegrations(options).find((candidate) => candidate.id === agentId);
    assert.equal(status.installed, true);
    assert.match(message, /new agent session/i);
    const content = readFileSync(status.skillPath, 'utf8');
    assert.match(content, /^---\nname: attune/);
    assert.match(content, /attune-managed-skill:v1/);
    assert.match(content, /Installed App Runtime/);

    setAgentIntegration(options, agentId, false);
    assert.equal(existsSync(status.skillPath), false);
  }

  const launcher = readFileSync(join(options.userDataPath, 'bin', 'attune'), 'utf8');
  assert.match(launcher, /^#!\/bin\/sh/);
  assert.match(launcher, /exec '\/usr\/bin\/node'/);
});

test('never overwrites or removes a user-managed skill', () => {
  const options = fixture();
  const skillPath = join(options.homePath, '.cursor', 'skills', 'attune', 'SKILL.md');
  mkdirSync(join(skillPath, '..'), { recursive: true });
  writeFileSync(skillPath, '# My Attune skill\n');

  const status = getAgentIntegrations(options).find((candidate) => candidate.id === 'cursor');
  assert.equal(status.installed, false);
  assert.equal(status.conflict, true);
  assert.throws(() => setAgentIntegration(options, 'cursor', true), /user-managed skill/);
  assert.throws(() => setAgentIntegration(options, 'cursor', false), /left unchanged/);
  assert.equal(readFileSync(skillPath, 'utf8'), '# My Attune skill\n');
});

test('Electron launcher opts into Node mode for packaged builds', () => {
  const options = { ...fixture(), nodePath: '/Applications/Attune.app/Contents/MacOS/Attune', electronNode: true };
  setAgentIntegration(options, 'codex', true);
  const launcher = readFileSync(join(options.userDataPath, 'bin', 'attune'), 'utf8');
  assert.match(launcher, /exec env ELECTRON_RUN_AS_NODE=1 '\/Applications\/Attune\.app\/Contents\/MacOS\/Attune'/);
});

test('refreshes enabled managed skills from the canonical bundled source', () => {
  const options = fixture();
  setAgentIntegration(options, 'claude', true);
  writeFileSync(options.skillSourcePath, '---\nname: attune\ndescription: Updated skill\n---\n\n# New workflow\n');

  syncManagedAgentIntegrations(options);

  const skillPath = getAgentIntegrations(options).find((candidate) => candidate.id === 'claude').skillPath;
  assert.match(readFileSync(skillPath, 'utf8'), /# New workflow/);
});
