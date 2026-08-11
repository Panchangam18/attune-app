import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

export const CLAUDE_GPT_MODELS_ATTUNEMENT_ID = 'claude-gpt-models';
export const CLAUDE_GPT_MODELS_CONFIG_NAME = 'Attune: GPT Models';

export const CLAUDE_GPT_MODELS = [
  {
    name: 'claude-opus-4-8-attune-sol',
    labelOverride: 'GPT-5.6 Sol',
    anthropicFamilyTier: 'opus',
    isFamilyDefault: true,
  },
  {
    name: 'claude-sonnet-4-8-attune-terra',
    labelOverride: 'GPT-5.6 Terra',
    anthropicFamilyTier: 'sonnet',
    isFamilyDefault: true,
  },
  {
    name: 'claude-haiku-4-8-attune-luna',
    labelOverride: 'GPT-5.6 Luna',
    anthropicFamilyTier: 'haiku',
    isFamilyDefault: true,
  },
] as const;

interface ConfigLibraryEntry {
  id: string;
  name: string;
  [key: string]: unknown;
}

interface ConfigLibraryMeta {
  appliedId: string;
  entries: ConfigLibraryEntry[];
  [key: string]: unknown;
}

interface AttuneClaudeGatewayStateV1 {
  version: 1;
  configId: string;
  priorDeploymentMode: '1p' | '3p';
  priorAppliedId: string | null;
}

interface AttuneClaudeBridgeStateV2 {
  version: 2;
  enabled: boolean;
  retiredConfigId: string | null;
}

interface AttuneClaudeBridgeStateV3 {
  version: 3;
  enabled: boolean;
  retiredConfigId: string | null;
}

interface AttuneClaudeBridgeState {
  version: 4;
  enabled: boolean;
  retiredConfigId: string | null;
  /** Audit/recovery only. Attune never reapplies this third-party selection. */
  priorAppliedId: string | null;
}

type StoredAttuneClaudeState = AttuneClaudeGatewayStateV1
  | AttuneClaudeBridgeStateV2
  | AttuneClaudeBridgeStateV3
  | AttuneClaudeBridgeState;

interface ConfigureClaudeGptModelsOptions {
  homePath: string;
  attuneUserDataPath: string;
  enabled: boolean;
  /** Test-only fault injection; production callers must omit this. */
  testHooks?: {
    beforeWrite?(step: ClaudeConfigWriteStep): void;
  };
}

type ClaudeConfigWriteStep = 'app-config' | 'meta' | 'retired-config' | 'state';

interface JsonFile<T> {
  exists: boolean;
  value: T;
}

export interface ConfigureClaudeGptModelsResult {
  changed: boolean;
  requiresRestart: boolean;
  configId: string | null;
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

function readJsonFile<T>(path: string, fallback: T): JsonFile<T> {
  let fileStats;
  try {
    fileStats = lstatSync(path);
  } catch (error: unknown) {
    if (isMissingFileError(error)) return { exists: false, value: fallback };
    throw new Error(`Attune could not safely inspect JSON at ${path}.`);
  }
  if (fileStats.isSymbolicLink() || !fileStats.isFile()) {
    throw new Error(`Attune will not modify a symlink or non-file JSON target at ${path}.`);
  }

  let source: string;
  try {
    source = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`Attune could not safely read JSON at ${path}.`);
  }
  try {
    return { exists: true, value: JSON.parse(source) as T };
  } catch {
    throw new Error(`Attune will not modify malformed JSON at ${path}.`);
  }
}

function writeJsonIfChanged(path: string, value: unknown): boolean {
  const current = readJsonFile<unknown>(path, null);
  if (current.exists && isDeepStrictEqual(current.value, value)) {
    const targetStats = lstatSync(path);
    if (targetStats.isSymbolicLink() || !targetStats.isFile()) {
      throw new Error(`Attune will not modify a symlink or non-file JSON target at ${path}.`);
    }
    if ((targetStats.mode & 0o777) === 0o600) return false;
    chmodSync(path, 0o600);
    return true;
  }

  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.attune-${process.pid}-${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
      flush: true,
    });
    renameSync(temporaryPath, path);
    chmodSync(path, 0o600);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateAppConfig(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`Attune will not modify invalid Claude app configuration at ${path}.`);
  }
  return value;
}

function validateMeta(value: unknown, path: string): ConfigLibraryMeta {
  if (!isRecord(value)
    || typeof value.appliedId !== 'string'
    || !Array.isArray(value.entries)) {
    throw new Error(`Attune will not modify invalid Claude config-library metadata at ${path}.`);
  }

  const ids = new Set<string>();
  for (const entry of value.entries) {
    if (!isRecord(entry)
      || typeof entry.id !== 'string'
      || entry.id.length === 0
      || typeof entry.name !== 'string'
      || entry.name.length === 0
      || ids.has(entry.id)) {
      throw new Error(`Attune will not modify invalid Claude config-library metadata at ${path}.`);
    }
    ids.add(entry.id);
  }
  return value as ConfigLibraryMeta;
}

function validateRetiredConfig(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`Attune will not retire invalid Claude configuration at ${path}.`);
  }
  return value;
}

function validateRetiredConfigId(value: unknown, statePath: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string'
    || value === '.'
    || value === '..'
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new Error(`Attune will not use an unsafe retired Claude config ID from ${statePath}.`);
  }
  return value;
}

function resolveRetiredConfigPath(
  configLibraryRoot: string,
  configId: string,
  statePath: string,
): string {
  const root = resolve(configLibraryRoot);
  const candidate = resolve(root, `${configId}.json`);
  if (dirname(candidate) !== root) {
    throw new Error(`Attune will not use an unsafe retired Claude config ID from ${statePath}.`);
  }
  return candidate;
}

function validateConfigLibraryRoot(path: string): void {
  let stats;
  try {
    stats = lstatSync(path);
  } catch (error: unknown) {
    if (isMissingFileError(error)) return;
    throw new Error(`Attune could not safely inspect Claude's config library at ${path}.`);
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`Attune will not use a symlink or non-directory Claude config library at ${path}.`);
  }
}

function validateOptionalId(value: unknown, statePath: string, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new Error(`Attune will not use invalid ${field} state at ${statePath}.`);
  }
  return value;
}

function validateStoredState(value: unknown, statePath: string): StoredAttuneClaudeState | null {
  if (value === null) return null;
  if (!isRecord(value)
    || typeof value.version !== 'number'
    || !Number.isInteger(value.version)) {
    throw new Error(`Attune will not use invalid Claude bridge state at ${statePath}.`);
  }

  if (value.version === 1) {
    if ((value.priorDeploymentMode !== '1p' && value.priorDeploymentMode !== '3p')) {
      throw new Error(`Attune will not use invalid Claude bridge state at ${statePath}.`);
    }
    const configId = validateRetiredConfigId(value.configId, statePath);
    if (configId === null) {
      throw new Error(`Attune will not use invalid Claude bridge state at ${statePath}.`);
    }
    return {
      version: 1,
      configId,
      priorDeploymentMode: value.priorDeploymentMode,
      priorAppliedId: validateOptionalId(value.priorAppliedId, statePath, 'prior applied ID'),
    };
  }

  if (value.version === 2 || value.version === 3) {
    if (typeof value.enabled !== 'boolean') {
      throw new Error(`Attune will not use invalid Claude bridge state at ${statePath}.`);
    }
    return {
      version: value.version,
      enabled: value.enabled,
      retiredConfigId: validateRetiredConfigId(value.retiredConfigId, statePath),
    };
  }

  if (value.version === 4) {
    if (typeof value.enabled !== 'boolean') {
      throw new Error(`Attune will not use invalid Claude bridge state at ${statePath}.`);
    }
    return {
      version: 4,
      enabled: value.enabled,
      retiredConfigId: validateRetiredConfigId(value.retiredConfigId, statePath),
      priorAppliedId: validateOptionalId(value.priorAppliedId, statePath, 'prior applied ID'),
    };
  }

  throw new Error(`Attune will not use unsupported Claude bridge state at ${statePath}.`);
}

function stateEnabled(state: StoredAttuneClaudeState | null): boolean {
  if (state?.version === 1) return true;
  return state?.enabled ?? false;
}

export function configureClaudeGptModels(
  options: ConfigureClaudeGptModelsOptions,
): ConfigureClaudeGptModelsResult {
  // Claude reads this isolated directory as a startup sentinel before choosing
  // its userData path. A 1p sentinel with no applied entry selects the untouched
  // default `Claude` profile, where native authentication and history live.
  const claudeRoot = join(options.homePath, 'Library', 'Application Support', 'Claude-3p');
  const configLibraryRoot = join(claudeRoot, 'configLibrary');
  const appConfigPath = join(claudeRoot, 'claude_desktop_config.json');
  const metaPath = join(configLibraryRoot, '_meta.json');
  const statePath = join(options.attuneUserDataPath, 'claude-gpt-models-state.json');

  // Preflight every target before the first mutation. A malformed or redirected
  // target aborts the toggle without publishing a partially validated profile.
  validateConfigLibraryRoot(configLibraryRoot);
  const existingState = validateStoredState(
    readJsonFile<unknown>(statePath, null).value,
    statePath,
  );
  const appConfig = validateAppConfig(
    readJsonFile<unknown>(appConfigPath, {}).value,
    appConfigPath,
  );
  const meta = validateMeta(
    readJsonFile<unknown>(metaPath, { appliedId: '', entries: [] }).value,
    metaPath,
  );

  const namedEntry = meta.entries.find((entry) => entry.name === CLAUDE_GPT_MODELS_CONFIG_NAME);
  const rawRetiredConfigId = existingState?.version === 1
    ? existingState.configId
    : existingState?.version === 2
      || existingState?.version === 3
      || existingState?.version === 4
      ? existingState.retiredConfigId
      : namedEntry?.id ?? null;
  const retiredConfigId = validateRetiredConfigId(rawRetiredConfigId, statePath);
  const ownsRetiredConfig = Boolean(retiredConfigId && meta.entries.some((entry) => (
    entry.id === retiredConfigId && entry.name === CLAUDE_GPT_MODELS_CONFIG_NAME
  )));
  const currentAppliedId = meta.appliedId !== '' && meta.appliedId !== retiredConfigId
    ? meta.appliedId
    : null;
  const recordedPriorAppliedId = existingState?.version === 1
    || existingState?.version === 4
    ? existingState.priorAppliedId
    : null;
  const priorAppliedId = currentAppliedId ?? recordedPriorAppliedId;

  // Native Claude auth, models, and history are the baseline in both toggle
  // states. A selected third-party entry can override deploymentMode, including
  // via authentication.disableClaudeAiSignIn, so it must never remain applied.
  const nextAppConfig = { ...appConfig, deploymentMode: '1p' };
  const nextMeta: ConfigLibraryMeta = {
    ...meta,
    appliedId: '',
    entries: meta.entries.filter((entry) => (
      entry.id !== retiredConfigId || entry.name !== CLAUDE_GPT_MODELS_CONFIG_NAME
    )),
  };
  const nextState: AttuneClaudeBridgeState = {
    version: 4,
    enabled: options.enabled,
    retiredConfigId,
    priorAppliedId,
  };

  const retiredConfigPath = retiredConfigId
    ? resolveRetiredConfigPath(configLibraryRoot, retiredConfigId, statePath)
    : null;
  let retiredConfigExists = false;
  let retiredConfigNeedsClearing = false;
  if (ownsRetiredConfig && retiredConfigPath) {
    const retiredConfig = readJsonFile<unknown>(retiredConfigPath, {});
    retiredConfigExists = retiredConfig.exists;
    if (retiredConfig.exists) {
      const validated = validateRetiredConfig(retiredConfig.value, retiredConfigPath);
      retiredConfigNeedsClearing = Object.keys(validated).length > 0;
    }
  }

  const runtimeChanged = appConfig.deploymentMode !== '1p'
    || meta.appliedId !== ''
    || ownsRetiredConfig
    || retiredConfigNeedsClearing
    || stateEnabled(existingState) !== options.enabled;
  let changed = false;
  const writeStep = (step: ClaudeConfigWriteStep, path: string, value: unknown): boolean => {
    options.testHooks?.beforeWrite?.(step);
    return writeJsonIfChanged(path, value);
  };

  // First-party mode is the first mutation. Only then is the effective config
  // detached, the obsolete Attune gateway retired, and the audit state recorded.
  changed = writeStep('app-config', appConfigPath, nextAppConfig) || changed;
  changed = writeStep('meta', metaPath, nextMeta) || changed;
  if (ownsRetiredConfig && retiredConfigPath && retiredConfigExists) {
    changed = writeStep('retired-config', retiredConfigPath, {}) || changed;
  }
  changed = writeStep('state', statePath, nextState) || changed;

  return {
    changed,
    requiresRestart: runtimeChanged,
    configId: retiredConfigId,
  };
}
