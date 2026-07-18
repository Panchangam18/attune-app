import { app, BrowserWindow, dialog, ipcMain, shell, type OpenDialogOptions } from 'electron';
import { execFile } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type {
  ActionResult,
  AttuneAppInfo,
  EnvironmentInfo,
  RuntimeKind,
  SessionStatus,
  Snapshot,
  ThemeAdapterInfo,
  ThemeInfo,
  ThemeProfile,
  ThemeTargetStatus,
  WorkspaceInfo,
  WorkspacePatchInfo,
} from './types.js';

interface DiscoveredApp {
  name: string;
  path: string;
  bundleId: string | null;
  runtime: RuntimeKind;
}

interface SessionRecord {
  appId: string;
  appPath: string;
  appPid?: number;
  port: number;
  status: Exclude<SessionStatus, 'none'>;
  targetCount: number;
  updatedAt: string;
  watcherPid: number;
}

interface ScanModule {
  scanForSupportedApps(): DiscoveredApp[];
  getAppId(appInfo: DiscoveredApp): string;
  getAppExecutablePath(appInfo: DiscoveredApp): string;
}

interface ConfigModule {
  setStylesheetSource(appId: string, sourcePath: string, css: string): void;
}

interface SessionModule {
  getSession(appId: string): SessionRecord | null;
  stopSession(appId: string): boolean;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const devServerUrl = process.env.ATTUNE_APP_DEV_SERVER_URL;
const DEFAULT_THEME_ID = 'arrakis';
const USER_DATA_FOLDER_NAME = 'Attune';
const PROFILE_TARGET_APP_NAMES = ['ChatGPT', 'Visual Studio Code', 'Spotify', 'Slack'];
const AUTO_WRAP_INTERVAL_MS = 2000;
const AUTO_WRAP_COOLDOWN_MS = 15000;
const BUILT_IN_THEME_WALLPAPERS: Record<string, string> = {
  arrakis: 'arrakis.jpg',
  cyberpunk: 'cyberpunk.jpg',
  'starry-night': 'starry-night.jpg',
  'tama-river': 'tama-river.jpg',
};
const USER_THEMES_README = `# Attune User Themes

Attune App loads custom themes from this folder.

Arrakis is seeded here as an editable built-in theme, including
arrakis.jpg. Changes to arrakis appear in Attune App after
refreshing themes.

Create a folder for each theme:

\`\`\`
my-theme/
  manifest.json
  tokens.css
  base-layout.css
  adapters/
    chatgpt.css
    slack.css
    spotify.css
    vscode.css
    claude.css
\`\`\`

Manifest adapter paths can be relative to the theme folder:

\`\`\`json
{
  "name": "My Theme",
  "description": "A personal Attune theme.",
  "tokens": "tokens.css",
  "baseLayout": "base-layout.css",
  "adapters": {
    "ChatGPT": { "source": "adapters/chatgpt.css", "canvas": "light" },
    "Slack": { "source": "adapters/slack.css", "canvas": "dark" },
    "Spotify": { "source": "adapters/spotify.css", "canvas": "dark" },
    "Visual Studio Code": { "source": "adapters/vscode.css", "canvas": "dark" },
    "Claude": { "source": "adapters/claude.css", "canvas": "light" }
  }
}
\`\`\`

Refresh Attune App after adding or editing a theme.
`;
const USER_WORKSPACES_README = `# Attune User Workspaces

Workspaces are saved layout presets for apps. They can hide, resize, or
rearrange parts of an app with CSS. A workspace file may also include an
optional script block for cross-app UI bridges:

\`\`\`css
.some-target { display: none; }

/* @attune-script
(() => {
  // Keep scripts idempotent. Attune re-runs them while the app is attached.
})();
@end-attune-script */
\`\`\`

Create a folder for each workspace:

\`\`\`
focus-flow/
  manifest.json
  apps/
    spotify-quiet-home.css
    linear-source.css
    codex-linear-brief.css
\`\`\`

Manifest patch paths are relative to the workspace folder:

\`\`\`json
{
  "name": "Focus Flow",
  "description": "Remove noisy surfaces and pull Linear context into Codex.",
  "patches": {
    "Spotify": {
      "source": "apps/spotify-quiet-home.css",
      "intent": "Hide bulky recommendation shelves."
    },
    "Linear": {
      "source": "apps/linear-source.css",
      "intent": "Publish visible Linear issue context for other workspace panes."
    },
    "Codex": {
      "source": "apps/codex-linear-brief.css",
      "intent": "Render a compact Linear brief inside Codex."
    }
  }
}
\`\`\`

Refresh Attune App after adding or editing a workspace.
`;
const SEEDED_WORKSPACE_ID = 'focus-flow';
const SEEDED_WORKSPACE_MANIFEST = `{
  "name": "Focus Flow",
  "description": "Quiet noisy app surfaces and bring Linear context into Codex.",
  "patches": {
    "Spotify": {
      "source": "apps/spotify-quiet-home.css",
      "intent": "Hide bulky recommendations and keep the library, search, and player in view."
    },
    "Linear": {
      "source": "apps/linear-source.css",
      "intent": "Publish visible issue titles from Linear for workspace embeds."
    },
    "Codex": {
      "source": "apps/codex-linear-brief.css",
      "intent": "Render a compact Linear brief inside Codex."
    }
  }
}
`;
const SEEDED_SPOTIFY_WORKSPACE_CSS = `/* Focus Flow: Spotify quiet home */
[data-testid="home-page"] section:has([href*="/playlist/"]),
[data-testid="home-page"] section:has([href*="/genre/"]),
[data-testid="home-page"] section:has([href*="/section/"]),
main section[aria-label*="Recommended" i],
main section[aria-label*="Jump back in" i],
main section[aria-label*="Made For" i],
main section[aria-label*="Episodes" i] {
  display: none !important;
}

[data-testid="root"] main {
  --attune-workspace-gap: 14px;
}

[data-testid="now-playing-widget"] {
  min-width: min(430px, 42vw) !important;
}
`;
const SEEDED_LINEAR_SOURCE_CSS = `/* Focus Flow: Linear source. This keeps Linear visually intact and publishes visible issues. */

/* @attune-script
(() => {
  const collect = () => {
    const rows = [...document.querySelectorAll('[data-testid*="issue"], a[href*="/issue/"], a[href*="/team/"]')]
      .map((node) => {
        const text = (node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim();
        const key = text.match(/[A-Z][A-Z0-9]+-\\d+/)?.[0] || '';
        const title = text.replace(key, '').trim();
        return { key, title: title || text };
      })
      .filter((item) => item.title && item.title.length > 5)
      .slice(0, 8);
    fetch('http://127.0.0.1:47655/v1/linear-visible-issues', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issues: rows }),
    }).catch(() => {});
  };
  clearInterval(window.__attuneLinearCollector);
  window.__attuneLinearCollector = setInterval(collect, 2500);
  collect();
})();
@end-attune-script */
`;
const SEEDED_CODEX_LINEAR_CSS = `/* Focus Flow: Codex Linear brief */
#attune-linear-brief {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 2147483647;
  width: min(360px, calc(100vw - 36px));
  max-height: min(430px, calc(100vh - 80px));
  overflow: auto;
  border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, Canvas 94%, CanvasText 6%);
  color: CanvasText;
  box-shadow: 0 18px 50px rgb(0 0 0 / 24%);
  font: 12px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace;
}

#attune-linear-brief header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 11px;
  border-bottom: 1px solid color-mix(in srgb, CanvasText 14%, transparent);
  font-weight: 700;
}

#attune-linear-brief ol {
  display: grid;
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

#attune-linear-brief li {
  padding: 10px 11px;
  border-bottom: 1px solid color-mix(in srgb, CanvasText 10%, transparent);
}

#attune-linear-brief li:last-child { border-bottom: 0; }
#attune-linear-brief strong { display: block; margin-bottom: 4px; color: color-mix(in srgb, CanvasText 88%, #66d9ef); }
#attune-linear-brief small { color: color-mix(in srgb, CanvasText 62%, transparent); }

/* @attune-script
(() => {
  const render = async () => {
    let bridge = null;
    try {
      bridge = await fetch('http://127.0.0.1:47655/v1/linear-visible-issues', { cache: 'no-store' }).then((response) => response.json());
    } catch {}
    const issues = Array.isArray(bridge?.payload?.issues) ? bridge.payload.issues : [];
    let root = document.getElementById('attune-linear-brief');
    if (!root) {
      root = document.createElement('aside');
      root.id = 'attune-linear-brief';
      document.body.append(root);
    }
    const rows = issues.length
      ? issues.map((issue) => '<li><strong>' + escapeHtml(issue.key || 'Linear') + '</strong><span>' + escapeHtml(issue.title || '') + '</span></li>').join('')
      : '<li><small>Open Linear with this workspace enabled to populate this brief.</small></li>';
    const updated = bridge?.updatedAt ? new Date(bridge.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'waiting';
    root.innerHTML = '<header><span>Linear Brief</span><small>' + updated + '</small></header><ol>' + rows + '</ol>';
  };
  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
  clearInterval(window.__attuneCodexLinearBrief);
  window.__attuneCodexLinearBrief = setInterval(render, 2500);
  render();
})();
@end-attune-script */
`;

let mainWindow: BrowserWindow | null = null;
let autoWrapTimer: NodeJS.Timeout | null = null;
const wrappingAppIds = new Set<string>();
const lastWrapAtByAppId = new Map<string, number>();
const iconDataUrlByAppPath = new Map<string, Promise<string | null>>();

configureUserDataPath();

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  startAutoWrapMonitor();
  void syncActiveThemeWallpaper();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function configureUserDataPath(): void {
  const userDataPath = join(app.getPath('home'), 'Library', 'Application Support', USER_DATA_FOLDER_NAME);
  mkdirSync(userDataPath, { recursive: true });
  app.setPath('userData', userDataPath);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 620,
    title: 'Attune',
    backgroundColor: '#141414',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
    },
  });

  mainWindow.webContents.on('console-message', (_event, level, message) => {
    console.log(`[renderer:${level}] ${message}`);
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[renderer] process gone', details);
  });

  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(join(__dirname, '..', 'dist', 'index.html'));
  }
}

function registerIpc(): void {
  ipcMain.handle('attune:snapshot', async (): Promise<ActionResult<Snapshot>> => wrap(() => getSnapshot()));
  ipcMain.handle('attune:refresh-themes', async (): Promise<ActionResult<string>> => wrap(() => refreshThemes()));
  ipcMain.handle('attune:refresh-workspaces', async (): Promise<ActionResult<string>> => wrap(() => refreshWorkspaces()));
  ipcMain.handle('attune:build-runtime', async (): Promise<ActionResult<string>> => wrap(() => buildRuntime()));
  ipcMain.handle('attune:apply-theme', async (_event, payload: { appId: string; themeId: string }) => (
    wrap(() => applyTheme(payload.appId, payload.themeId))
  ));
  ipcMain.handle('attune:set-profile-enabled', async (_event, payload: { themeId: string; enabled: boolean }) => (
    wrap(() => setProfileEnabled(payload.themeId, payload.enabled))
  ));
  ipcMain.handle('attune:set-wallpaper-enabled', async (_event, payload: { enabled: boolean }) => (
    wrap(() => setWallpaperEnabled(payload.enabled))
  ));
  ipcMain.handle('attune:set-profile-app-enabled', async (_event, payload: { appId: string; enabled: boolean }) => (
    wrap(() => setProfileAppEnabled(payload.appId, payload.enabled))
  ));
  ipcMain.handle('attune:set-workspace-enabled', async (_event, payload: { workspaceId: string; enabled: boolean }) => (
    wrap(() => setWorkspaceEnabled(payload.workspaceId, payload.enabled))
  ));
  ipcMain.handle('attune:set-workspace-app-enabled', async (_event, payload: { appId: string; enabled: boolean }) => (
    wrap(() => setWorkspaceAppEnabled(payload.appId, payload.enabled))
  ));
  ipcMain.handle('attune:set-auto-wrap-enabled', async (_event, payload: { enabled: boolean }) => (
    wrap(() => setAutoWrapEnabled(payload.enabled))
  ));
  ipcMain.handle('attune:choose-css-file', async (_event, payload: { appId: string }) => (
    wrap(() => chooseCssFile(payload.appId))
  ));
  ipcMain.handle('attune:launch', async (_event, payload: { appId: string }) => wrap(() => launchApp(payload.appId)));
  ipcMain.handle('attune:stop', async (_event, payload: { appId: string }) => wrap(() => stopApp(payload.appId)));
  ipcMain.handle('attune:open-path', async (_event, payload: { path: string }) => wrap(async () => {
    await shell.openPath(payload.path);
    return payload.path;
  }));
}

async function wrap<T>(operation: () => T | Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await operation() };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function getSnapshot(): Promise<Snapshot> {
  const startedAt = Date.now();
  console.log('[attune] snapshot start');
  const environment = getEnvironment();
  const themes = discoverThemes(environment);
  const workspaces = discoverWorkspaces(environment);
  const profile = readProfile();
  const apps = environment.runtimeBuilt ? await discoverApps(themes, workspaces, profile) : [];
  const targets = buildTargetStatuses(apps, themes, profile);
  console.log(`[attune] snapshot complete in ${Date.now() - startedAt}ms`);
  return { environment, apps, themes, workspaces, profile, targets };
}

function getEnvironment(): EnvironmentInfo {
  const bundledAttuneRoot = app.isPackaged
    ? join(process.resourcesPath, 'attune')
    : join(resolve(__dirname, '..'), '..', 'attune');
  const attuneRoot = resolve(process.env.ATTUNE_ROOT || bundledAttuneRoot);
  const userThemesRoot = ensureUserThemesRoot(process.env.ATTUNE_USER_THEMES_ROOT
    ? resolve(process.env.ATTUNE_USER_THEMES_ROOT)
    : join(app.getPath('userData'), 'themes'), attuneRoot);
  const userWorkspacesRoot = ensureUserWorkspacesRoot(process.env.ATTUNE_USER_WORKSPACES_ROOT
    ? resolve(process.env.ATTUNE_USER_WORKSPACES_ROOT)
    : join(app.getPath('userData'), 'workspaces'));
  const cliPath = resolve(process.env.ATTUNE_CLI_PATH || join(attuneRoot, 'dist', 'cli.js'));
  const nodePath = process.env.ATTUNE_NODE_PATH || (app.isPackaged ? process.execPath : 'node');
  return {
    attuneRoot,
    userThemesRoot,
    userWorkspacesRoot,
    cliPath,
    nodePath,
    runtimeBuilt: existsSync(cliPath),
  };
}

function ensureUserThemesRoot(themesRoot: string, attuneRoot: string): string {
  mkdirSync(themesRoot, { recursive: true });

  const readmePath = join(themesRoot, 'README.md');
  if (!existsSync(readmePath)) {
    writeFileSync(readmePath, USER_THEMES_README);
  }

  seedEditableArrakisTheme(themesRoot, attuneRoot);

  return themesRoot;
}

function ensureUserWorkspacesRoot(workspacesRoot: string): string {
  mkdirSync(workspacesRoot, { recursive: true });

  const readmePath = join(workspacesRoot, 'README.md');
  if (!existsSync(readmePath)) {
    writeFileSync(readmePath, USER_WORKSPACES_README);
  }

  seedFocusFlowWorkspace(workspacesRoot);
  return workspacesRoot;
}

function seedFocusFlowWorkspace(workspacesRoot: string): void {
  const workspaceRoot = join(workspacesRoot, SEEDED_WORKSPACE_ID);
  const appsRoot = join(workspaceRoot, 'apps');
  mkdirSync(appsRoot, { recursive: true });

  writeSeedFile(join(workspaceRoot, 'manifest.json'), SEEDED_WORKSPACE_MANIFEST);
  writeSeedFile(join(appsRoot, 'spotify-quiet-home.css'), SEEDED_SPOTIFY_WORKSPACE_CSS);
  writeSeedFile(join(appsRoot, 'linear-source.css'), SEEDED_LINEAR_SOURCE_CSS);
  writeSeedFile(join(appsRoot, 'codex-linear-brief.css'), SEEDED_CODEX_LINEAR_CSS);
}

function writeSeedFile(filePath: string, contents: string): void {
  if (!existsSync(filePath)) {
    writeFileSync(filePath, contents);
  }
}

function seedEditableArrakisTheme(themesRoot: string, attuneRoot: string): void {
  const arrakisSource = join(attuneRoot, 'themes', DEFAULT_THEME_ID);
  if (!existsSync(arrakisSource)) return;

  const arrakisTheme = join(themesRoot, DEFAULT_THEME_ID);
  if (!existsSync(arrakisTheme)) {
    const oldReference = join(themesRoot, '_reference', DEFAULT_THEME_ID);
    const seedSource = existsSync(oldReference) ? oldReference : arrakisSource;
    cpSync(seedSource, arrakisTheme, {
      recursive: true,
      force: false,
      errorOnExist: false,
    });
  }

  const arrakisImageSource = getBundledThemeWallpaperPath(DEFAULT_THEME_ID, attuneRoot);
  const arrakisImageTarget = join(arrakisTheme, BUILT_IN_THEME_WALLPAPERS[DEFAULT_THEME_ID]);
  if (arrakisImageSource && !existsSync(arrakisImageTarget)) {
    copyFileSync(arrakisImageSource, arrakisImageTarget);
  }

  seedMissingArrakisFont(arrakisSource, arrakisTheme);
}

function seedMissingArrakisFont(arrakisSource: string, arrakisTheme: string): void {
  const fontFileName = 'Nasalization-Regular.otf';
  const bundledFontPath = join(arrakisSource, 'assets', fontFileName);
  const userFontPath = join(arrakisTheme, 'assets', fontFileName);
  if (existsSync(bundledFontPath) && !existsSync(userFontPath)) {
    mkdirSync(dirname(userFontPath), { recursive: true });
    copyFileSync(bundledFontPath, userFontPath);
  }

  const userTokensPath = join(arrakisTheme, 'tokens.css');
  if (!existsSync(userTokensPath)) return;

  const tokens = readFileSync(userTokensPath, 'utf8');
  if (tokens.includes('font-family: "Nasalization"') || !tokens.includes('--arr-font-ui: "Nasalization"')) {
    return;
  }

  const fontFace = `@font-face {
  font-family: "Nasalization";
  src: url("./assets/${fontFileName}") format("opentype");
  font-display: swap;
  font-style: normal;
  font-weight: 400;
}`;
  writeFileSync(userTokensPath, `${fontFace}\n\n${tokens}`);
}

function getBundledThemeWallpaperPath(themeId: string, attuneRoot = getEnvironment().attuneRoot): string | null {
  const fileName = BUILT_IN_THEME_WALLPAPERS[themeId];
  if (!fileName) return null;

  const imagePath = join(attuneRoot, 'themes', themeId, fileName);
  return existsSync(imagePath) ? imagePath : null;
}

async function discoverApps(
  themes: ThemeInfo[],
  workspaces: WorkspaceInfo[],
  profile: ThemeProfile,
): Promise<AttuneAppInfo[]> {
  const [scanModule, sessionModule] = await Promise.all([
    loadAttuneModule<ScanModule>('scan.js'),
    loadAttuneModule<SessionModule>('session.js'),
  ]);

  const apps: AttuneAppInfo[] = [];
  const activeWorkspace = workspaces.find((workspace) => workspace.id === profile.activeWorkspaceId);
  for (const appInfo of scanModule.scanForSupportedApps()) {
    const id = scanModule.getAppId(appInfo);
    const session = sessionModule.getSession(id);
    const workspacePatch = activeWorkspace ? findMatchingWorkspacePatch(activeWorkspace, appInfo.name) : undefined;
    apps.push({
      id,
      name: appInfo.name,
      path: appInfo.path,
      iconDataUrl: await getBundleIconDataUrl(appInfo.path, id),
      bundleId: appInfo.bundleId,
      runtime: appInfo.runtime,
      status: session?.status ?? 'none',
      targetCount: session?.targetCount ?? 0,
      port: session?.port ?? null,
      updatedAt: session?.updatedAt ?? null,
      hasMatchingTheme: themes.some((theme) => findMatchingAdapter(theme, appInfo.name)),
      themeEnabled: profile.enabled && profile.enabledAppIds.includes(id),
      targetProfileApp: isProfileTarget(appInfo.name),
      hasMatchingWorkspace: workspaces.some((workspace) => findMatchingWorkspacePatch(workspace, appInfo.name)),
      workspaceEnabled: profile.workspaceEnabled && profile.enabledWorkspaceAppIds.includes(id),
      targetWorkspaceApp: Boolean(workspacePatch),
    });
  }
  return apps;
}

async function getBundleIconDataUrl(appPath: string, appId: string): Promise<string | null> {
  const cached = iconDataUrlByAppPath.get(appPath);
  if (cached) return cached;

  const iconTask = resolveBundleIconDataUrl(appPath, appId);
  iconDataUrlByAppPath.set(appPath, iconTask);
  return iconTask;
}

async function resolveBundleIconDataUrl(appPath: string, appId: string): Promise<string | null> {
  try {
    const plistPath = join(appPath, 'Contents', 'Info.plist');
    const rawIconName = (await exec('/usr/bin/plutil', ['-extract', 'CFBundleIconFile', 'raw', '-o', '-', plistPath], {
      cwd: appPath,
      timeout: 3000,
    })).trim();
    const iconFileName = rawIconName.endsWith('.icns') ? rawIconName : `${rawIconName}.icns`;
    const sourcePath = join(appPath, 'Contents', 'Resources', iconFileName);
    if (!existsSync(sourcePath)) throw new Error(`Icon file not found: ${sourcePath}`);

    const cacheDirectory = join(app.getPath('userData'), 'icon-cache');
    mkdirSync(cacheDirectory, { recursive: true });
    const outputPath = join(cacheDirectory, `${appId.replace(/[^a-z0-9]+/gi, '-')}.png`);
    await exec('/usr/bin/sips', ['-z', '96', '96', sourcePath, '-s', 'format', 'png', '--out', outputPath], {
      cwd: appPath,
      timeout: 5000,
    });

    const dataUrl = `data:image/png;base64,${readFileSync(outputPath).toString('base64')}`;
    return dataUrl;
  } catch (error) {
    console.warn(`[attune] unable to resolve icon for ${appPath}:`, error);
    return null;
  }
}

async function applyTheme(appId: string, themeId: string): Promise<string> {
  const environment = getEnvironment();
  const [scanModule, configModule] = await Promise.all([
    loadAttuneModule<ScanModule>('scan.js'),
    loadAttuneModule<ConfigModule>('config.js'),
  ]);
  const appInfo = findDiscoveredApp(scanModule, appId);
  const themes = discoverThemes(environment);
  const theme = themes.find((candidate) => candidate.id === themeId);
  if (!theme) throw new Error(`Theme not found: ${themeId}`);

  const adapter = findMatchingAdapter(theme, appInfo.name);
  if (!adapter || !adapter.absolutePath) {
    throw new Error(`${theme.name} does not include an available adapter for ${appInfo.name}.`);
  }

  const stylesheet = compileThemeStylesheet(theme, adapter);
  configModule.setStylesheetSource(appId, stylesheet.path, stylesheet.css);
  return `${theme.name} applied to ${appInfo.name}.`;
}

async function refreshThemes(): Promise<string> {
  const profile = readProfile();
  if (!profile.enabled && !profile.workspaceEnabled) return 'Themes refreshed.';

  const environment = getEnvironment();
  const [scanModule, configModule] = await Promise.all([
    loadAttuneModule<ScanModule>('scan.js'),
    loadAttuneModule<ConfigModule>('config.js'),
  ]);
  const themes = discoverThemes(environment);
  const workspaces = discoverWorkspaces(environment);

  if (profile.enabled && !themes.some((candidate) => candidate.id === profile.activeThemeId)) {
    throw new Error(`Theme not found: ${profile.activeThemeId}`);
  }

  const styledAppIds = getEnabledStyleAppIds(profile);
  const styledApps = scanModule.scanForSupportedApps()
    .map((appInfo) => ({ appInfo, appId: scanModule.getAppId(appInfo) }))
    .filter((target) => styledAppIds.has(target.appId));

  for (const target of styledApps) {
    applyCompositeStylesheet(target.appId, target.appInfo.name, configModule, themes, workspaces, profile);
  }

  void runAutoWrapPass();
  return `Styles refreshed for ${styledApps.length} ${styledApps.length === 1 ? 'app' : 'apps'}.`;
}

async function refreshWorkspaces(): Promise<string> {
  return refreshThemes();
}

async function setProfileEnabled(themeId: string, enabled: boolean): Promise<string> {
  const environment = getEnvironment();
  const [scanModule, configModule] = await Promise.all([
    loadAttuneModule<ScanModule>('scan.js'),
    loadAttuneModule<ConfigModule>('config.js'),
  ]);
  const themes = discoverThemes(environment);
  const workspaces = discoverWorkspaces(environment);
  const theme = themes.find((candidate) => candidate.id === themeId);
  if (!theme) throw new Error(`Theme not found: ${themeId}`);

  const targetApps = scanModule.scanForSupportedApps()
    .filter((appInfo) => isProfileTarget(appInfo.name))
    .map((appInfo) => ({ appInfo, appId: scanModule.getAppId(appInfo), adapter: findMatchingAdapter(theme, appInfo.name) }));

  if (enabled) {
    const missingAdapters = targetApps.filter((target) => !target.adapter?.absolutePath);
    if (missingAdapters.length > 0) {
      throw new Error(`Missing ${theme.name} adapter for ${missingAdapters.map((target) => target.appInfo.name).join(', ')}.`);
    }

    const profile = readProfile();
    const wallpaperRestoreBackupPath = profile.wallpaperEnabled
      ? profile.wallpaperRestoreBackupPath ?? backupWallpaperConfiguration()
      : null;
    const wallpaperRestorePaths = profile.wallpaperEnabled
      ? await applyThemeWallpaper(themeId, profile.wallpaperRestorePaths)
      : [];

    const newProfile: ThemeProfile = {
      activeThemeId: themeId,
      enabled: true,
      autoWrapEnabled: true,
      enabledAppIds: targetApps.map((target) => target.appId),
      targetAppNames: PROFILE_TARGET_APP_NAMES,
      wallpaperRestorePaths,
      wallpaperRestoreBackupPath,
      wallpaperEnabled: profile.wallpaperEnabled,
      activeWorkspaceId: profile.activeWorkspaceId,
      workspaceEnabled: profile.workspaceEnabled,
      enabledWorkspaceAppIds: profile.enabledWorkspaceAppIds,
    };

    for (const target of targetApps) {
      applyCompositeStylesheet(target.appId, target.appInfo.name, configModule, themes, workspaces, newProfile);
    }

    writeProfile(newProfile);
    void runAutoWrapPass();

    const foundNames = targetApps.map((target) => target.appInfo.name).join(', ');
    return `${theme.name} enabled for ${foundNames || 'no installed target apps'}.`;
  }

  const profile = readProfile();
  await restoreDesktopWallpapers(profile.wallpaperRestorePaths);
  await restoreWallpaperConfiguration(profile.wallpaperRestoreBackupPath);
  const newProfile: ThemeProfile = {
    activeThemeId: themeId,
    enabled: false,
    autoWrapEnabled: profile.autoWrapEnabled,
    enabledAppIds: [],
    targetAppNames: PROFILE_TARGET_APP_NAMES,
    wallpaperRestorePaths: [],
    wallpaperRestoreBackupPath: null,
    wallpaperEnabled: profile.wallpaperEnabled,
    activeWorkspaceId: profile.activeWorkspaceId,
    workspaceEnabled: profile.workspaceEnabled,
    enabledWorkspaceAppIds: profile.enabledWorkspaceAppIds,
  };

  for (const target of targetApps) {
    applyCompositeStylesheet(target.appId, target.appInfo.name, configModule, themes, workspaces, newProfile);
  }

  writeProfile(newProfile);

  return `${theme.name} disabled for the target apps.`;
}

async function setProfileAppEnabled(appId: string, enabled: boolean): Promise<string> {
  const profile = readProfile();
  if (!profile.enabled) throw new Error('Select a theme before changing an application.');

  const environment = getEnvironment();
  const [scanModule, configModule] = await Promise.all([
    loadAttuneModule<ScanModule>('scan.js'),
    loadAttuneModule<ConfigModule>('config.js'),
  ]);
  const appInfo = findDiscoveredApp(scanModule, appId);
  if (!isProfileTarget(appInfo.name)) throw new Error(`${appInfo.name} is not included in this theme profile.`);

  const themes = discoverThemes(environment);
  const workspaces = discoverWorkspaces(environment);
  const theme = themes.find((candidate) => candidate.id === profile.activeThemeId);
  if (!theme) throw new Error(`Theme not found: ${profile.activeThemeId}`);
  const adapter = findMatchingAdapter(theme, appInfo.name);
  if (!adapter?.absolutePath) throw new Error(`${theme.name} has no available adapter for ${appInfo.name}.`);

  const enabledAppIds = new Set(profile.enabledAppIds);
  if (enabled) {
    enabledAppIds.add(appId);
  } else {
    enabledAppIds.delete(appId);
  }

  const newProfile = { ...profile, enabledAppIds: [...enabledAppIds] };
  applyCompositeStylesheet(appId, appInfo.name, configModule, themes, workspaces, newProfile);
  writeProfile(newProfile);
  await attachRunningSessionIfAvailable(appInfo, appId, environment, scanModule);
  return enabled ? `${theme.name} enabled for ${appInfo.name}.` : `${theme.name} disabled for ${appInfo.name}.`;
}

async function setWorkspaceEnabled(workspaceId: string, enabled: boolean): Promise<string> {
  const profile = readProfile();
  const environment = getEnvironment();
  const [scanModule, configModule] = await Promise.all([
    loadAttuneModule<ScanModule>('scan.js'),
    loadAttuneModule<ConfigModule>('config.js'),
  ]);
  const themes = discoverThemes(environment);
  const workspaces = discoverWorkspaces(environment);
  const workspace = workspaces.find((candidate) => candidate.id === workspaceId);
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);

  const discoveredApps = scanModule.scanForSupportedApps()
    .map((appInfo) => ({ appInfo, appId: scanModule.getAppId(appInfo) }));
  const targetApps = discoveredApps.filter((target) => Boolean(findMatchingWorkspacePatch(workspace, target.appInfo.name)));
  const changedAppIds = new Set([
    ...profile.enabledWorkspaceAppIds,
    ...targetApps.map((target) => target.appId),
  ]);
  const newProfile: ThemeProfile = {
    ...profile,
    activeWorkspaceId: workspaceId,
    workspaceEnabled: enabled,
    autoWrapEnabled: enabled ? true : profile.autoWrapEnabled,
    enabledWorkspaceAppIds: enabled ? targetApps.map((target) => target.appId) : [],
  };

  for (const target of discoveredApps.filter((candidate) => changedAppIds.has(candidate.appId))) {
    applyCompositeStylesheet(target.appId, target.appInfo.name, configModule, themes, workspaces, newProfile);
    if (enabled && newProfile.enabledWorkspaceAppIds.includes(target.appId)) {
      await attachRunningSessionIfAvailable(target.appInfo, target.appId, environment, scanModule);
    }
  }

  writeProfile(newProfile);
  void runAutoWrapPass();

  if (!enabled) return `${workspace.name} disabled.`;
  return `${workspace.name} enabled for ${targetApps.length} ${targetApps.length === 1 ? 'app' : 'apps'}.`;
}

async function setWorkspaceAppEnabled(appId: string, enabled: boolean): Promise<string> {
  const profile = readProfile();
  if (!profile.activeWorkspaceId) throw new Error('Select a workspace before changing an application.');

  const environment = getEnvironment();
  const [scanModule, configModule] = await Promise.all([
    loadAttuneModule<ScanModule>('scan.js'),
    loadAttuneModule<ConfigModule>('config.js'),
  ]);
  const appInfo = findDiscoveredApp(scanModule, appId);
  const themes = discoverThemes(environment);
  const workspaces = discoverWorkspaces(environment);
  const workspace = workspaces.find((candidate) => candidate.id === profile.activeWorkspaceId);
  if (!workspace) throw new Error(`Workspace not found: ${profile.activeWorkspaceId}`);

  const patch = findMatchingWorkspacePatch(workspace, appInfo.name);
  if (!patch?.absolutePath) throw new Error(`${workspace.name} has no available workspace patch for ${appInfo.name}.`);

  const enabledWorkspaceAppIds = new Set(profile.enabledWorkspaceAppIds);
  if (enabled) {
    enabledWorkspaceAppIds.add(appId);
  } else {
    enabledWorkspaceAppIds.delete(appId);
  }

  const newProfile: ThemeProfile = {
    ...profile,
    workspaceEnabled: enabledWorkspaceAppIds.size > 0,
    autoWrapEnabled: enabled ? true : profile.autoWrapEnabled,
    enabledWorkspaceAppIds: [...enabledWorkspaceAppIds],
  };
  applyCompositeStylesheet(appId, appInfo.name, configModule, themes, workspaces, newProfile);
  writeProfile(newProfile);
  if (enabled) {
    await attachRunningSessionIfAvailable(appInfo, appId, environment, scanModule);
    void runAutoWrapPass();
  }

  return enabled ? `${workspace.name} enabled for ${appInfo.name}.` : `${workspace.name} disabled for ${appInfo.name}.`;
}

async function attachRunningSessionIfAvailable(
  appInfo: DiscoveredApp,
  appId: string,
  environment: EnvironmentInfo,
  scanModule: ScanModule,
): Promise<void> {
  const sessionModule = await loadAttuneModule<SessionModule>('session.js');
  if (sessionModule.getSession(appId)) return;

  const executablePath = scanModule.getAppExecutablePath(appInfo);
  const port = await findRemoteDebuggingPort(executablePath);
  if (!port) return;

  await exec(environment.nodePath, [environment.cliPath, 'attach', appInfo.name, String(port)], {
    cwd: environment.attuneRoot,
    timeout: 5000,
    env: runtimeNodeEnvironment(environment),
  });
}

async function findRemoteDebuggingPort(executablePath: string): Promise<number | null> {
  try {
    const processList = await exec('ps', ['-ax', '-o', 'command='], { cwd: process.cwd(), timeout: 3000 });
    const matchingProcess = processList
      .split('\n')
      .find((command) => command.includes(executablePath) && /--remote-debugging-port=\d+/.test(command));
    const port = matchingProcess?.match(/--remote-debugging-port=(\d+)/)?.[1];
    return port ? Number(port) : null;
  } catch {
    return null;
  }
}

async function setWallpaperEnabled(enabled: boolean): Promise<string> {
  const profile = readProfile();
  if (!enabled) {
    await restoreDesktopWallpapers(profile.wallpaperRestorePaths);
    await restoreWallpaperConfiguration(profile.wallpaperRestoreBackupPath);
    writeProfile({
      ...profile,
      wallpaperEnabled: false,
      wallpaperRestorePaths: [],
      wallpaperRestoreBackupPath: null,
    });
    return 'Theme wallpaper disabled.';
  }

  if (!profile.enabled) {
    writeProfile({ ...profile, wallpaperEnabled: true });
    return 'Theme wallpaper enabled.';
  }

  const wallpaperRestoreBackupPath = profile.wallpaperRestoreBackupPath ?? backupWallpaperConfiguration();
  const wallpaperRestorePaths = await applyThemeWallpaper(profile.activeThemeId, profile.wallpaperRestorePaths);
  writeProfile({
    ...profile,
    wallpaperEnabled: true,
    wallpaperRestorePaths,
    wallpaperRestoreBackupPath,
  });
  return 'Theme wallpaper enabled.';
}

async function syncActiveThemeWallpaper(): Promise<void> {
  const profile = readProfile();
  if (!profile.enabled || !profile.wallpaperEnabled || profile.wallpaperRestorePaths.length > 0 || profile.wallpaperRestoreBackupPath) return;

  try {
    const wallpaperRestoreBackupPath = profile.wallpaperRestoreBackupPath ?? backupWallpaperConfiguration();
    const wallpaperRestorePaths = await applyThemeWallpaper(profile.activeThemeId, []);
    if (wallpaperRestorePaths.length > 0 || wallpaperRestoreBackupPath) {
      writeProfile({ ...profile, wallpaperRestorePaths, wallpaperRestoreBackupPath });
    }
  } catch (error) {
    console.warn('[attune] unable to sync theme wallpaper:', error);
  }
}

async function applyThemeWallpaper(themeId: string, restorePaths: string[]): Promise<string[]> {
  const wallpaperPath = getThemeWallpaperPath(themeId);
  if (!wallpaperPath) return restorePaths;
  if (!existsSync(wallpaperPath)) throw new Error(`Theme wallpaper not found: ${wallpaperPath}`);

  const savedRestorePaths = restorePaths.length > 0 ? restorePaths : await getDesktopWallpaperPaths();
  await setAllDesktopWallpapers(wallpaperPath);
  return savedRestorePaths;
}

async function restoreDesktopWallpapers(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await Promise.all(paths.map((wallpaperPath, index) => setDesktopWallpaper(index + 1, wallpaperPath)));
}

function backupWallpaperConfiguration(): string | null {
  const sourcePath = getWallpaperStorePath();
  if (!existsSync(sourcePath)) return null;

  const backupPath = join(app.getPath('userData'), 'wallpaper-restore.plist');
  copyFileSync(sourcePath, backupPath);
  return backupPath;
}

async function restoreWallpaperConfiguration(backupPath: string | null): Promise<void> {
  if (!backupPath || !existsSync(backupPath)) return;
  copyFileSync(backupPath, getWallpaperStorePath());
  try {
    await exec('killall', ['WallpaperAgent'], { cwd: process.cwd(), timeout: 3000 });
  } catch {
    // macOS restarts this agent automatically when it is present.
  }
}

function getWallpaperStorePath(): string {
  return join(app.getPath('home'), 'Library', 'Application Support', 'com.apple.wallpaper', 'Store', 'Index.plist');
}

function getThemeWallpaperPath(themeId: string): string | null {
  const fileName = BUILT_IN_THEME_WALLPAPERS[themeId];
  if (!fileName) return null;
  const environment = getEnvironment();
  const userThemeImage = join(environment.userThemesRoot, themeId, fileName);
  if (existsSync(userThemeImage)) return userThemeImage;

  // Preserve Arrakis artwork customized with the previous file name.
  if (themeId === DEFAULT_THEME_ID) {
    const legacyUserImage = join(environment.userThemesRoot, themeId, 'arrakis-dune-thumbnail.png');
    if (existsSync(legacyUserImage)) return legacyUserImage;
  }

  return getBundledThemeWallpaperPath(themeId);
}

async function getDesktopWallpaperPaths(): Promise<string[]> {
  const script = `
tell application "System Events"
  set wallpaperPaths to {}
  repeat with desktopItem in desktops
    try
      set pictureFile to picture of desktopItem
      if pictureFile is not missing value then
        set end of wallpaperPaths to POSIX path of pictureFile
      end if
    end try
  end repeat
  set AppleScript's text item delimiters to linefeed
  return wallpaperPaths as text
end tell`;
  const output = await exec('osascript', ['-e', script], { cwd: process.cwd(), timeout: 5000 });
  return output.split(/\r?\n/).map((path) => path.trim()).filter(Boolean);
}

async function setAllDesktopWallpapers(wallpaperPath: string): Promise<void> {
  const encodedPath = Buffer.from(wallpaperPath).toString('base64');
  const script = `
import AppKit
import Foundation
let data = Data(base64Encoded: "${encodedPath}")!
let path = String(data: data, encoding: .utf8)!
let wallpaperURL = URL(fileURLWithPath: path)
for screen in NSScreen.screens {
  try NSWorkspace.shared.setDesktopImageURL(wallpaperURL, for: screen, options: [:])
}`;
  await exec('/usr/bin/swift', ['-e', script], { cwd: process.cwd(), timeout: 30000 });
}

async function setDesktopWallpaper(desktopIndex: number, wallpaperPath: string): Promise<void> {
  if (!existsSync(wallpaperPath)) return;
  const encodedPath = Buffer.from(wallpaperPath).toString('base64');
  const script = `
import AppKit
import Foundation
let data = Data(base64Encoded: "${encodedPath}")!
let path = String(data: data, encoding: .utf8)!
let screens = NSScreen.screens
if screens.indices.contains(${desktopIndex - 1}) {
  try NSWorkspace.shared.setDesktopImageURL(URL(fileURLWithPath: path), for: screens[${desktopIndex - 1}], options: [:])
}`;
  await exec('/usr/bin/swift', ['-e', script], { cwd: process.cwd(), timeout: 30000 });
}

function setAutoWrapEnabled(enabled: boolean): string {
  const profile = readProfile();
  writeProfile({ ...profile, autoWrapEnabled: enabled });
  if (enabled) void runAutoWrapPass();
  return enabled
    ? 'Auto-wrap enabled. Normal launches of profile apps will be relaunched through Attune.'
    : 'Auto-wrap disabled.';
}

async function chooseCssFile(appId: string): Promise<string> {
  const [scanModule, configModule] = await Promise.all([
    loadAttuneModule<ScanModule>('scan.js'),
    loadAttuneModule<ConfigModule>('config.js'),
  ]);
  const appInfo = findDiscoveredApp(scanModule, appId);
  const dialogOptions: OpenDialogOptions = {
    title: `Choose CSS for ${appInfo.name}`,
    properties: ['openFile'],
    filters: [{ name: 'CSS', extensions: ['css'] }],
  };
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);
  if (result.canceled || result.filePaths.length === 0) {
    return 'No CSS file selected.';
  }

  const cssPath = result.filePaths[0];
  const css = readFileSync(cssPath, 'utf8');
  configModule.setStylesheetSource(appId, cssPath, css);
  return `Custom CSS applied to ${appInfo.name}.`;
}

async function launchApp(appId: string): Promise<string> {
  const environment = getEnvironment();
  const scanModule = await loadAttuneModule<ScanModule>('scan.js');
  const appInfo = findDiscoveredApp(scanModule, appId);
  await ensureConfiguredForLaunch(appInfo, appId);
  const output = await exec(environment.nodePath, [environment.cliPath, 'launch', appInfo.name], {
    cwd: environment.attuneRoot,
    env: runtimeNodeEnvironment(environment),
  });
  return output.trim() || `${appInfo.name} launched with Attune.`;
}

async function ensureConfiguredForLaunch(appInfo: DiscoveredApp, appId: string): Promise<void> {
  const profile = readProfile();
  const styledAppIds = getEnabledStyleAppIds(profile);
  if (!styledAppIds.has(appId)) return;

  const environment = getEnvironment();
  const configModule = await loadAttuneModule<ConfigModule>('config.js');
  applyCompositeStylesheet(
    appId,
    appInfo.name,
    configModule,
    discoverThemes(environment),
    discoverWorkspaces(environment),
    profile,
  );
}

async function stopApp(appId: string): Promise<string> {
  const [scanModule, sessionModule] = await Promise.all([
    loadAttuneModule<ScanModule>('scan.js'),
    loadAttuneModule<SessionModule>('session.js'),
  ]);
  const appInfo = findDiscoveredApp(scanModule, appId);
  const stopped = sessionModule.stopSession(appId);
  return stopped ? `Stopped Attune for ${appInfo.name}.` : `No Attune session is running for ${appInfo.name}.`;
}

function startAutoWrapMonitor(): void {
  if (autoWrapTimer) return;
  autoWrapTimer = setInterval(() => {
    void runAutoWrapPass();
  }, AUTO_WRAP_INTERVAL_MS);
}

async function runAutoWrapPass(): Promise<void> {
  const profile = readProfile();
  const styledAppIds = getEnabledStyleAppIds(profile);
  if (!profile.autoWrapEnabled || styledAppIds.size === 0) return;

  const environment = getEnvironment();
  if (!environment.runtimeBuilt) return;

  try {
    const [scanModule, sessionModule] = await Promise.all([
      loadAttuneModule<ScanModule>('scan.js'),
      loadAttuneModule<SessionModule>('session.js'),
    ]);
    const apps = scanModule.scanForSupportedApps()
      .map((appInfo) => ({ appInfo, appId: scanModule.getAppId(appInfo) }))
      .filter((target) => styledAppIds.has(target.appId));

    for (const target of apps) {
      const now = Date.now();
      if (wrappingAppIds.has(target.appId)) continue;
      if ((lastWrapAtByAppId.get(target.appId) ?? 0) + AUTO_WRAP_COOLDOWN_MS > now) continue;

      const session = sessionModule.getSession(target.appId);
      if (session && session.status !== 'waiting') continue;

      const executablePath = scanModule.getAppExecutablePath(target.appInfo);
      if (!await isProcessRunning(executablePath)) continue;

      wrappingAppIds.add(target.appId);
      lastWrapAtByAppId.set(target.appId, now);
      void wrapNormalLaunch(target.appInfo, target.appId, executablePath).finally(() => {
        wrappingAppIds.delete(target.appId);
      });
    }
  } catch (error) {
    console.error('[attune] auto-wrap pass failed', error);
  }
}

async function wrapNormalLaunch(appInfo: DiscoveredApp, appId: string, executablePath: string): Promise<void> {
  console.log(`[attune] auto-wrap detected normal launch: ${appInfo.name}`);
  try {
    await ensureConfiguredForLaunch(appInfo, appId);
    await quitApp(appInfo);
    await waitForProcessExit(executablePath, 10000);
    await launchApp(appId);
    console.log(`[attune] auto-wrap relaunched ${appInfo.name}`);
    mainWindow?.webContents.send('attune:auto-wrap-event', { appId, appName: appInfo.name });
  } catch (error) {
    console.error(`[attune] auto-wrap failed for ${appInfo.name}`, error);
  }
}

async function quitApp(appInfo: DiscoveredApp): Promise<void> {
  if (appInfo.bundleId) {
    await exec('osascript', ['-e', `tell application id "${escapeAppleScript(appInfo.bundleId)}" to quit`], {
      cwd: process.cwd(),
      timeout: 5000,
    });
    return;
  }

  await exec('osascript', ['-e', `tell application "${escapeAppleScript(appInfo.name)}" to quit`], {
    cwd: process.cwd(),
    timeout: 5000,
  });
}

async function waitForProcessExit(executablePath: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!await isProcessRunning(executablePath)) return;
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${executablePath} to quit.`);
}

async function isProcessRunning(executablePath: string): Promise<boolean> {
  try {
    await exec('pgrep', ['-f', executablePath], { cwd: process.cwd(), timeout: 1500 });
    return true;
  } catch {
    return false;
  }
}

function escapeAppleScript(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function buildRuntime(): Promise<string> {
  const environment = getEnvironment();
  if (!existsSync(join(environment.attuneRoot, 'package.json'))) {
    throw new Error(`No Attune runtime found at ${environment.attuneRoot}.`);
  }

  const buildOutput = await exec('npm', ['run', 'build'], { cwd: environment.attuneRoot, timeout: 120_000 });
  const packageJson = JSON.parse(readFileSync(join(environment.attuneRoot, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  const themeBuildScript = packageJson.scripts?.['build:themes'] ? 'build:themes' : 'build:arrakis';
  const themeOutput = await exec('npm', ['run', themeBuildScript], { cwd: environment.attuneRoot, timeout: 120_000 });
  return [buildOutput, themeOutput].filter(Boolean).join('\n').trim() || 'Attune runtime built.';
}

function discoverThemes(environment: EnvironmentInfo): ThemeInfo[] {
  const themesById = new Map<string, ThemeInfo>();

  for (const theme of discoverThemesFromDirectory(join(environment.attuneRoot, 'themes'), environment.attuneRoot)) {
    themesById.set(theme.id, theme);
  }

  for (const theme of discoverThemesFromDirectory(environment.userThemesRoot, dirname(environment.userThemesRoot))) {
    themesById.set(theme.id, theme);
  }

  return [...themesById.values()];
}

function discoverWorkspaces(environment: EnvironmentInfo): WorkspaceInfo[] {
  return discoverWorkspacesFromDirectory(environment.userWorkspacesRoot, dirname(environment.userWorkspacesRoot));
}

function discoverWorkspacesFromDirectory(workspacesDir: string, pathBase: string): WorkspaceInfo[] {
  if (!existsSync(workspacesDir)) return [];

  return readdirSync(workspacesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readWorkspaceManifest(pathBase, join(workspacesDir, entry.name), entry.name))
    .filter((workspace): workspace is WorkspaceInfo => Boolean(workspace));
}

function readWorkspaceManifest(pathBase: string, workspaceDirectory: string, workspaceId: string): WorkspaceInfo | null {
  const manifestPath = join(workspaceDirectory, 'manifest.json');
  if (!existsSync(manifestPath)) return null;

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    name?: string;
    description?: string;
    patches?: Record<string, {
      source?: string;
      intent?: string;
    }>;
  };

  const patches = Object.entries(manifest.patches ?? {}).map(([appName, patch]) => {
    const sourcePath = patch.source ? resolveThemePath(pathBase, workspaceDirectory, patch.source) : null;
    return {
      appName,
      source: patch.source ?? '',
      sourcePath,
      intent: patch.intent ?? '',
      available: Boolean(sourcePath && existsSync(sourcePath)),
      absolutePath: sourcePath && existsSync(sourcePath) ? sourcePath : null,
    } satisfies WorkspacePatchInfo;
  });

  return {
    id: workspaceId,
    name: manifest.name ?? workspaceId,
    description: manifest.description ?? '',
    patches,
  };
}

function discoverThemesFromDirectory(themesDir: string, pathBase: string): ThemeInfo[] {
  if (!existsSync(themesDir)) return [];

  return readdirSync(themesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readThemeManifest(pathBase, join(themesDir, entry.name), entry.name))
    .filter((theme): theme is ThemeInfo => Boolean(theme));
}

function readThemeManifest(pathBase: string, themeDirectory: string, themeId: string): ThemeInfo | null {
  const manifestPath = join(themeDirectory, 'manifest.json');
  if (!existsSync(manifestPath)) return null;

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    name?: string;
    description?: string;
    tokens?: string;
    baseLayout?: string;
    adapters?: Record<string, {
      source?: string;
      output?: string;
      runtime?: string;
      canvas?: string;
    }>;
  };

  const adapters = Object.entries(manifest.adapters ?? {}).map(([appName, adapter]) => {
    const outputPath = adapter.output ? resolveThemePath(pathBase, themeDirectory, adapter.output) : null;
    const sourcePath = adapter.source ? resolveThemePath(pathBase, themeDirectory, adapter.source) : null;
    const absolutePath = outputPath && existsSync(outputPath)
      ? outputPath
      : sourcePath && existsSync(sourcePath)
        ? sourcePath
        : null;

    return {
      appName,
      source: adapter.source ?? '',
      sourcePath,
      output: adapter.output ?? null,
      runtime: adapter.runtime ?? 'Attune-compatible renderer',
      canvas: adapter.canvas ?? null,
      available: Boolean(absolutePath),
      absolutePath,
    } satisfies ThemeAdapterInfo;
  });

  return {
    id: themeId,
    name: manifest.name ?? themeId,
    description: manifest.description ?? '',
    tokensPath: manifest.tokens ? resolveThemePath(pathBase, themeDirectory, manifest.tokens) : null,
    baseLayoutPath: manifest.baseLayout ? resolveThemePath(pathBase, themeDirectory, manifest.baseLayout) : null,
    adapters,
  };
}

function resolveThemePath(pathBase: string, themeDirectory: string, pathValue: string): string {
  if (isAbsolute(pathValue)) return pathValue;
  if (pathValue.startsWith('themes/')) return join(pathBase, pathValue);
  return join(themeDirectory, pathValue);
}

function compileThemeStylesheet(
  theme: ThemeInfo,
  adapter: ThemeAdapterInfo,
): { path: string; css: string } {
  const componentPaths = adapter.sourcePath
    ? [theme.tokensPath, theme.baseLayoutPath, adapter.sourcePath]
      .filter((path): path is string => Boolean(path && existsSync(path)))
    : [];
  const sourcePaths = componentPaths.length > 0
    ? componentPaths
    : adapter.absolutePath
      ? [adapter.absolutePath]
      : [];

  if (sourcePaths.length === 0) {
    throw new Error(`${theme.name} has no readable stylesheet for ${adapter.appName}.`);
  }

  const css = [
    `/* Compiled by Attune from editable theme ${theme.id}. */`,
    ...sourcePaths.map((sourcePath) => readThemeCssSource(sourcePath)),
  ].join('\n\n');
  const outputDirectory = join(app.getPath('userData'), 'compiled-themes', safeFileName(theme.id));
  mkdirSync(outputDirectory, { recursive: true });
  const outputPath = join(outputDirectory, `${safeFileName(adapter.appName)}.css`);
  writeFileSync(outputPath, css);

  return { path: outputPath, css };
}

function compileCompositeStylesheet(
  appId: string,
  appName: string,
  themes: ThemeInfo[],
  workspaces: WorkspaceInfo[],
  profile: ThemeProfile,
): { path: string; css: string } | null {
  const parts: string[] = [];
  const sourcePaths: string[] = [];

  if (profile.enabled && profile.enabledAppIds.includes(appId)) {
    const theme = themes.find((candidate) => candidate.id === profile.activeThemeId);
    if (!theme) throw new Error(`Theme not found: ${profile.activeThemeId}`);

    const adapter = findMatchingAdapter(theme, appName);
    if (!adapter?.absolutePath) throw new Error(`${theme.name} has no available adapter for ${appName}.`);
    const themeStylesheet = compileThemeStylesheet(theme, adapter);
    parts.push(readFileSync(themeStylesheet.path, 'utf8'));
    sourcePaths.push(themeStylesheet.path);
  }

  if (profile.workspaceEnabled && profile.enabledWorkspaceAppIds.includes(appId)) {
    if (!profile.activeWorkspaceId) throw new Error('No active workspace selected.');
    const workspace = workspaces.find((candidate) => candidate.id === profile.activeWorkspaceId);
    if (!workspace) throw new Error(`Workspace not found: ${profile.activeWorkspaceId}`);

    const patch = findMatchingWorkspacePatch(workspace, appName);
    if (!patch?.absolutePath) throw new Error(`${workspace.name} has no available workspace patch for ${appName}.`);
    parts.push([
      `/* Workspace ${workspace.id}: ${patch.appName}. */`,
      readWorkspaceCssSource(patch.absolutePath),
    ].join('\n'));
    sourcePaths.push(patch.absolutePath);
  }

  if (parts.length === 0) return null;

  const css = parts.join('\n\n');
  const outputDirectory = join(app.getPath('userData'), 'compiled-profiles');
  mkdirSync(outputDirectory, { recursive: true });
  const outputPath = join(outputDirectory, `${safeFileName(appId)}.css`);
  writeFileSync(outputPath, [
    `/* Compiled by Attune from ${sourcePaths.length} editable source ${sourcePaths.length === 1 ? 'file' : 'files'}. */`,
    css,
  ].join('\n\n'));

  return { path: outputPath, css };
}

function applyCompositeStylesheet(
  appId: string,
  appName: string,
  configModule: ConfigModule,
  themes: ThemeInfo[],
  workspaces: WorkspaceInfo[],
  profile: ThemeProfile,
): void {
  const stylesheet = compileCompositeStylesheet(appId, appName, themes, workspaces, profile);
  if (!stylesheet) {
    configModule.setStylesheetSource(appId, '', '');
    return;
  }

  configModule.setStylesheetSource(appId, stylesheet.path, stylesheet.css);
}

function readWorkspaceCssSource(sourcePath: string): string {
  return readThemeCssSource(sourcePath);
}

function readThemeCssSource(sourcePath: string): string {
  const css = readFileSync(sourcePath, 'utf8');
  return css.replace(/url\((["']?)([^"')]+)\1\)/g, (fullMatch, _quote: string, rawUrl: string) => {
    if (/^(?:data:|https?:|file:|#)/i.test(rawUrl)) return fullMatch;

    const assetPath = resolve(dirname(sourcePath), rawUrl);
    const mediaType = mediaTypeFor(assetPath);
    if (!mediaType || !existsSync(assetPath)) return fullMatch;
    return `url("data:${mediaType};base64,${readFileSync(assetPath).toString('base64')}")`;
  });
}

function mediaTypeFor(filePath: string): string | null {
  switch (extname(filePath).toLowerCase()) {
    case '.ttf': return 'font/ttf';
    case '.otf': return 'font/otf';
    case '.woff': return 'font/woff';
    case '.woff2': return 'font/woff2';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    case '.gif': return 'image/gif';
    case '.svg': return 'image/svg+xml';
    default: return null;
  }
}

function safeFileName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^\.+/, '') || 'theme';
}

function findMatchingAdapter(theme: ThemeInfo, appName: string): ThemeAdapterInfo | undefined {
  const normalizedApp = normalizeAppName(appName);
  return theme.adapters.find((adapter) => {
    const normalizedAdapter = normalizeAppName(adapter.appName);
    return adapter.available && (
      normalizedAdapter === normalizedApp
      || normalizedApp.includes(normalizedAdapter)
      || normalizedAdapter.includes(normalizedApp)
    );
  });
}

function findMatchingWorkspacePatch(workspace: WorkspaceInfo, appName: string): WorkspacePatchInfo | undefined {
  const normalizedApp = normalizeAppName(appName);
  return workspace.patches.find((patch) => {
    const normalizedPatch = normalizeAppName(patch.appName);
    return patch.available && (
      normalizedPatch === normalizedApp
      || normalizedApp.includes(normalizedPatch)
      || normalizedPatch.includes(normalizedApp)
    );
  });
}

function buildTargetStatuses(
  apps: AttuneAppInfo[],
  themes: ThemeInfo[],
  profile: ThemeProfile,
): ThemeTargetStatus[] {
  const theme = themes.find((candidate) => candidate.id === profile.activeThemeId);
  return profile.targetAppNames.map((targetName) => {
    const appInfo = apps.find((candidate) => namesMatch(candidate.name, targetName));
    return {
      name: targetName,
      found: Boolean(appInfo),
      enabled: Boolean(appInfo && profile.enabled && profile.enabledAppIds.includes(appInfo.id)),
      adapterAvailable: Boolean(theme && findMatchingAdapter(theme, targetName)),
      appId: appInfo?.id ?? null,
      appName: appInfo?.name ?? null,
      status: appInfo?.status ?? 'none',
    };
  });
}

function getEnabledStyleAppIds(profile: ThemeProfile): Set<string> {
  return new Set([
    ...(profile.enabled ? profile.enabledAppIds : []),
    ...(profile.workspaceEnabled ? profile.enabledWorkspaceAppIds : []),
  ]);
}

function readProfile(): ThemeProfile {
  const defaultProfile: ThemeProfile = {
    activeThemeId: DEFAULT_THEME_ID,
    enabled: false,
    autoWrapEnabled: false,
    enabledAppIds: [],
    targetAppNames: PROFILE_TARGET_APP_NAMES,
    wallpaperRestorePaths: [],
    wallpaperRestoreBackupPath: null,
    wallpaperEnabled: true,
    activeWorkspaceId: null,
    workspaceEnabled: false,
    enabledWorkspaceAppIds: [],
  };

  try {
    const raw = JSON.parse(readFileSync(getPreferencesPath(), 'utf8')) as Partial<ThemeProfile>;
    return {
      activeThemeId: raw.activeThemeId === 'matrix'
        ? 'starry-night'
        : raw.activeThemeId === 'newsprint'
          ? DEFAULT_THEME_ID
          : typeof raw.activeThemeId === 'string' ? raw.activeThemeId : defaultProfile.activeThemeId,
      enabled: typeof raw.enabled === 'boolean' ? raw.enabled : defaultProfile.enabled,
      autoWrapEnabled: typeof raw.autoWrapEnabled === 'boolean' ? raw.autoWrapEnabled : defaultProfile.autoWrapEnabled,
      enabledAppIds: Array.isArray(raw.enabledAppIds)
        ? raw.enabledAppIds.filter((id): id is string => typeof id === 'string')
        : defaultProfile.enabledAppIds,
      targetAppNames: defaultProfile.targetAppNames,
      wallpaperRestorePaths: Array.isArray(raw.wallpaperRestorePaths)
        ? raw.wallpaperRestorePaths.filter((path): path is string => typeof path === 'string')
        : defaultProfile.wallpaperRestorePaths,
      wallpaperRestoreBackupPath: typeof raw.wallpaperRestoreBackupPath === 'string'
        ? raw.wallpaperRestoreBackupPath
        : defaultProfile.wallpaperRestoreBackupPath,
      wallpaperEnabled: typeof raw.wallpaperEnabled === 'boolean'
        ? raw.wallpaperEnabled
        : defaultProfile.wallpaperEnabled,
      activeWorkspaceId: typeof raw.activeWorkspaceId === 'string'
        ? raw.activeWorkspaceId
        : defaultProfile.activeWorkspaceId,
      workspaceEnabled: typeof raw.workspaceEnabled === 'boolean'
        ? raw.workspaceEnabled
        : defaultProfile.workspaceEnabled,
      enabledWorkspaceAppIds: Array.isArray(raw.enabledWorkspaceAppIds)
        ? raw.enabledWorkspaceAppIds.filter((id): id is string => typeof id === 'string')
        : defaultProfile.enabledWorkspaceAppIds,
    };
  } catch {
    return defaultProfile;
  }
}

function writeProfile(profile: ThemeProfile): void {
  const preferencesPath = getPreferencesPath();
  mkdirSync(dirname(preferencesPath), { recursive: true });
  writeFileSync(preferencesPath, JSON.stringify(profile, null, 2));
}

function getPreferencesPath(): string {
  return join(app.getPath('userData'), 'preferences.json');
}

function isProfileTarget(appName: string): boolean {
  return PROFILE_TARGET_APP_NAMES.some((targetName) => namesMatch(appName, targetName));
}

function namesMatch(left: string, right: string): boolean {
  const normalizedLeft = normalizeAppName(left);
  const normalizedRight = normalizeAppName(right);
  return normalizedLeft === normalizedRight
    || normalizedLeft.includes(normalizedRight)
    || normalizedRight.includes(normalizedLeft);
}

function normalizeAppName(value: string): string {
  return value.toLowerCase()
    .replace(/\bvisual studio code\b/g, 'vscode')
    .replace(/\bvs code\b/g, 'vscode')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function findDiscoveredApp(scanModule: ScanModule, appId: string): DiscoveredApp {
  const appInfo = scanModule.scanForSupportedApps().find((candidate) => scanModule.getAppId(candidate) === appId);
  if (!appInfo) throw new Error(`App not found: ${appId}`);
  return appInfo;
}

async function loadAttuneModule<T>(distFileName: string): Promise<T> {
  const environment = getEnvironment();
  if (!environment.runtimeBuilt) {
    throw new Error(`Attune runtime is not built. Expected ${environment.cliPath}.`);
  }

  const modulePath = join(environment.attuneRoot, 'dist', distFileName);
  if (!existsSync(modulePath)) {
    throw new Error(`Missing Attune module: ${modulePath}`);
  }

  return import(pathToFileURL(modulePath).href) as Promise<T>;
}

function exec(
  command: string,
  args: string[],
  options: { cwd: string; timeout?: number; env?: NodeJS.ProcessEnv },
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(command, args, {
      cwd: options.cwd,
      timeout: options.timeout ?? 30_000,
      env: options.env ?? process.env,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 4,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error((stderr || stdout || error.message).trim()));
        return;
      }
      resolvePromise([stdout, stderr].filter(Boolean).join('\n'));
    });
  });
}

function runtimeNodeEnvironment(environment: EnvironmentInfo): NodeJS.ProcessEnv {
  if (environment.nodePath !== process.execPath) return process.env;
  return { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
}
