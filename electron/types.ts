export type RuntimeKind = 'electron' | 'cef';
export type SessionStatus = 'starting' | 'attached' | 'waiting' | 'stopped' | 'none';

export interface AttuneAppInfo {
  id: string;
  name: string;
  path: string;
  iconDataUrl: string | null;
  bundleId: string | null;
  runtime: RuntimeKind;
  status: SessionStatus;
  targetCount: number;
  port: number | null;
  updatedAt: string | null;
  hasMatchingTheme: boolean;
  themeEnabled: boolean;
  targetProfileApp: boolean;
}

export interface ThemeAdapterInfo {
  appName: string;
  source: string;
  output: string | null;
  runtime: string;
  canvas: string | null;
  available: boolean;
  absolutePath: string | null;
}

export interface ThemeInfo {
  id: string;
  name: string;
  description: string;
  adapters: ThemeAdapterInfo[];
}

export interface EnvironmentInfo {
  attuneRoot: string;
  cliPath: string;
  nodePath: string;
  runtimeBuilt: boolean;
}

export interface ThemeProfile {
  activeThemeId: string;
  enabled: boolean;
  autoWrapEnabled: boolean;
  enabledAppIds: string[];
  targetAppNames: string[];
}

export interface ThemeTargetStatus {
  name: string;
  found: boolean;
  enabled: boolean;
  adapterAvailable: boolean;
  appId: string | null;
  appName: string | null;
  status: SessionStatus;
}

export interface Snapshot {
  environment: EnvironmentInfo;
  apps: AttuneAppInfo[];
  themes: ThemeInfo[];
  profile: ThemeProfile;
  targets: ThemeTargetStatus[];
}

export interface ActionResult<T = unknown> {
  ok: boolean;
  data?: T;
  message?: string;
}
