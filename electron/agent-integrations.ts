import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type AgentIntegrationId = 'codex' | 'cursor' | 'claude';

export interface AgentIntegrationStatus {
  id: AgentIntegrationId;
  name: string;
  installed: boolean;
  conflict: boolean;
  skillPath: string;
}

export interface AgentIntegrationOptions {
  homePath: string;
  userDataPath: string;
  skillSourcePath: string;
  cliPath: string;
  nodePath: string;
  electronNode: boolean;
}

const MANAGED_MARKER = '<!-- attune-managed-skill:v1 -->';

const AGENTS: ReadonlyArray<{
  id: AgentIntegrationId;
  name: string;
  relativeSkillPath: string;
}> = [
  { id: 'codex', name: 'ChatGPT', relativeSkillPath: '.codex/skills/attune/SKILL.md' },
  { id: 'cursor', name: 'Cursor', relativeSkillPath: '.cursor/skills/attune/SKILL.md' },
  { id: 'claude', name: 'Claude', relativeSkillPath: '.claude/skills/attune/SKILL.md' },
];

export function getAgentIntegrations(options: AgentIntegrationOptions): AgentIntegrationStatus[] {
  return AGENTS.map((agent) => {
    const skillPath = join(options.homePath, agent.relativeSkillPath);
    const content = readOptionalFile(skillPath);
    return {
      id: agent.id,
      name: agent.name,
      installed: content?.includes(MANAGED_MARKER) ?? false,
      conflict: content !== null && !content.includes(MANAGED_MARKER),
      skillPath,
    };
  });
}

export function setAgentIntegration(
  options: AgentIntegrationOptions,
  agentId: AgentIntegrationId,
  enabled: boolean,
): string {
  const status = getAgentIntegrations(options).find((candidate) => candidate.id === agentId);
  if (!status) throw new Error(`Unknown coding agent integration: ${agentId}`);

  if (!enabled) {
    if (status.conflict) {
      throw new Error(`Attune did not create ${status.skillPath}, so it was left unchanged.`);
    }
    if (status.installed) rmSync(status.skillPath);
    return `${status.name} integration disabled. Start a new agent session to apply the change.`;
  }

  if (status.conflict) {
    throw new Error(`A user-managed skill already exists at ${status.skillPath}. Attune left it unchanged.`);
  }
  if (!existsSync(options.skillSourcePath)) {
    throw new Error(`The bundled Attune skill is missing: ${options.skillSourcePath}`);
  }
  if (!existsSync(options.cliPath)) {
    throw new Error(`The Attune runtime is missing: ${options.cliPath}`);
  }

  const launcherPath = installLauncher(options);
  const canonicalSkill = readFileSync(options.skillSourcePath, 'utf8').trimEnd();
  const managedSkill = [
    canonicalSkill,
    '',
    '## Installed App Runtime',
    '',
    `This skill is managed by Attune App. Run the CLI using \`${launcherPath}\`.`,
    'Use that absolute command in place of `attune` or `node dist/cli.js` in the workflow above.',
    '',
    MANAGED_MARKER,
    '',
  ].join('\n');

  mkdirSync(dirname(status.skillPath), { recursive: true });
  if (readOptionalFile(status.skillPath) !== managedSkill) {
    writeFileSync(status.skillPath, managedSkill, { mode: 0o644 });
  }
  return `${status.name} integration enabled. Start a new agent session to use Attune.`;
}

/** Refresh enabled managed integrations from the bundled canonical skill. */
export function syncManagedAgentIntegrations(options: AgentIntegrationOptions): void {
  for (const integration of getAgentIntegrations(options)) {
    if (!integration.installed) continue;
    setAgentIntegration(options, integration.id, true);
  }
}

function installLauncher(options: AgentIntegrationOptions): string {
  const launcherPath = join(options.userDataPath, 'bin', 'attune');
  const environment = options.electronNode ? 'env ELECTRON_RUN_AS_NODE=1 ' : '';
  const launcher = [
    '#!/bin/sh',
    '# Managed by Attune App.',
    `exec ${environment}${shellQuote(options.nodePath)} ${shellQuote(options.cliPath)} "$@"`,
    '',
  ].join('\n');
  mkdirSync(dirname(launcherPath), { recursive: true });
  if (readOptionalFile(launcherPath) !== launcher) {
    writeFileSync(launcherPath, launcher, { mode: 0o755 });
  }
  chmodSync(launcherPath, 0o755);
  return launcherPath;
}

function readOptionalFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
