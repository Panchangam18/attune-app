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
  hasMatchingWorkspace: boolean;
  workspaceEnabled: boolean;
  targetWorkspaceApp: boolean;
}

export interface ThemeAdapterInfo {
  appName: string;
  source: string;
  sourcePath: string | null;
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
  tokensPath: string | null;
  baseLayoutPath: string | null;
  adapters: ThemeAdapterInfo[];
}

export interface WorkspacePatchInfo {
  appName: string;
  source: string;
  sourcePath: string | null;
  intent: string;
  available: boolean;
  absolutePath: string | null;
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  description: string;
  previewDataUrl: string | null;
  patches: WorkspacePatchInfo[];
}

export interface EnvironmentInfo {
  attuneRoot: string;
  userThemesRoot: string;
  userWorkspacesRoot: string;
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
  wallpaperRestorePaths: string[];
  wallpaperRestoreBackupPath: string | null;
  wallpaperEnabled: boolean;
  activeWorkspaceId: string | null;
  workspaceEnabled: boolean;
  enabledWorkspaceAppIds: string[];
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
  workspaces: WorkspaceInfo[];
  profile: ThemeProfile;
  targets: ThemeTargetStatus[];
}

export interface ActionResult<T = unknown> {
  ok: boolean;
  data?: T;
  message?: string;
}
