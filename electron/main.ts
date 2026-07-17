import { app, BrowserWindow, dialog, ipcMain, shell, type OpenDialogOptions } from 'electron';
import { execFile } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
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
const USER_THEMES_README = `# Attune User Themes

Attune App loads custom themes from this folder.

Arrakis is seeded here as an editable built-in theme, including
arrakis-dune-thumbnail.png. Changes to arrakis appear in Attune App after
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
  const profile = readProfile();
  const apps = environment.runtimeBuilt ? await discoverApps(themes, profile) : [];
  const targets = buildTargetStatuses(apps, themes, profile);
  console.log(`[attune] snapshot complete in ${Date.now() - startedAt}ms`);
  return { environment, apps, themes, profile, targets };
}

function getEnvironment(): EnvironmentInfo {
  const appRoot = resolve(__dirname, '..');
  const attuneRoot = resolve(process.env.ATTUNE_ROOT || join(appRoot, '..', 'attune'));
  const userThemesRoot = ensureUserThemesRoot(process.env.ATTUNE_USER_THEMES_ROOT
    ? resolve(process.env.ATTUNE_USER_THEMES_ROOT)
    : join(app.getPath('userData'), 'themes'), attuneRoot);
  const cliPath = resolve(process.env.ATTUNE_CLI_PATH || join(attuneRoot, 'dist', 'cli.js'));
  const nodePath = process.env.ATTUNE_NODE_PATH || 'node';
  return {
    attuneRoot,
    userThemesRoot,
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

  const arrakisImageSource = getBundledArrakisImagePath();
  const arrakisImageTarget = join(arrakisTheme, 'arrakis-dune-thumbnail.png');
  if (arrakisImageSource && !existsSync(arrakisImageTarget)) {
    copyFileSync(arrakisImageSource, arrakisImageTarget);
  }
}

function getBundledArrakisImagePath(): string | null {
  const assetRoot = join(__dirname, '..', devServerUrl ? 'public' : 'dist', 'wallpapers');
  const imagePath = join(assetRoot, 'arrakis-dune-thumbnail.png');
  return existsSync(imagePath) ? imagePath : null;
}

async function discoverApps(themes: ThemeInfo[], profile: ThemeProfile): Promise<AttuneAppInfo[]> {
  const [scanModule, sessionModule] = await Promise.all([
    loadAttuneModule<ScanModule>('scan.js'),
    loadAttuneModule<SessionModule>('session.js'),
  ]);

  const apps: AttuneAppInfo[] = [];
  for (const appInfo of scanModule.scanForSupportedApps()) {
    const id = scanModule.getAppId(appInfo);
    const session = sessionModule.getSession(id);
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
  const theme = discoverThemes(environment).find((candidate) => candidate.id === themeId);
  if (!theme) throw new Error(`Theme not found: ${themeId}`);

  const adapter = findMatchingAdapter(theme, appInfo.name);
  if (!adapter || !adapter.absolutePath) {
    throw new Error(`${theme.name} does not include an available adapter for ${appInfo.name}.`);
  }

  const css = readFileSync(adapter.absolutePath, 'utf8');
  configModule.setStylesheetSource(appId, adapter.absolutePath, css);
  return `${theme.name} applied to ${appInfo.name}.`;
}

async function setProfileEnabled(themeId: string, enabled: boolean): Promise<string> {
  const environment = getEnvironment();
  const [scanModule, configModule] = await Promise.all([
    loadAttuneModule<ScanModule>('scan.js'),
    loadAttuneModule<ConfigModule>('config.js'),
  ]);
  const theme = discoverThemes(environment).find((candidate) => candidate.id === themeId);
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

    for (const target of targetApps) {
      const cssPath = target.adapter?.absolutePath;
      if (!cssPath) continue;
      configModule.setStylesheetSource(target.appId, cssPath, readFileSync(cssPath, 'utf8'));
    }

    writeProfile({
      activeThemeId: themeId,
      enabled: true,
      autoWrapEnabled: true,
      enabledAppIds: targetApps.map((target) => target.appId),
      targetAppNames: PROFILE_TARGET_APP_NAMES,
      wallpaperRestorePaths,
      wallpaperRestoreBackupPath,
      wallpaperEnabled: profile.wallpaperEnabled,
    });
    void runAutoWrapPass();

    const foundNames = targetApps.map((target) => target.appInfo.name).join(', ');
    return `${theme.name} enabled for ${foundNames || 'no installed target apps'}.`;
  }

  for (const target of targetApps) {
    configModule.setStylesheetSource(target.appId, '', '');
  }

  const profile = readProfile();
  await restoreDesktopWallpapers(profile.wallpaperRestorePaths);
  await restoreWallpaperConfiguration(profile.wallpaperRestoreBackupPath);
  writeProfile({
    activeThemeId: themeId,
    enabled: false,
    autoWrapEnabled: profile.autoWrapEnabled,
    enabledAppIds: [],
    targetAppNames: PROFILE_TARGET_APP_NAMES,
    wallpaperRestorePaths: [],
    wallpaperRestoreBackupPath: null,
    wallpaperEnabled: profile.wallpaperEnabled,
  });

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

  const theme = discoverThemes(environment).find((candidate) => candidate.id === profile.activeThemeId);
  if (!theme) throw new Error(`Theme not found: ${profile.activeThemeId}`);
  const adapter = findMatchingAdapter(theme, appInfo.name);
  if (!adapter?.absolutePath) throw new Error(`${theme.name} has no available adapter for ${appInfo.name}.`);

  const enabledAppIds = new Set(profile.enabledAppIds);
  if (enabled) {
    configModule.setStylesheetSource(appId, adapter.absolutePath, readFileSync(adapter.absolutePath, 'utf8'));
    enabledAppIds.add(appId);
  } else {
    configModule.setStylesheetSource(appId, '', '');
    enabledAppIds.delete(appId);
  }

  writeProfile({ ...profile, enabledAppIds: [...enabledAppIds] });
  await attachRunningSessionIfAvailable(appInfo, appId, environment, scanModule);
  return enabled ? `${theme.name} enabled for ${appInfo.name}.` : `${theme.name} disabled for ${appInfo.name}.`;
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
  const fileNameByTheme: Record<string, string> = {
    arrakis: 'arrakis-dune-thumbnail.png',
  };
  const fileName = fileNameByTheme[themeId];
  if (!fileName) return null;
  const environment = getEnvironment();
  const userThemeImage = join(environment.userThemesRoot, themeId, fileName);
  if (existsSync(userThemeImage)) return userThemeImage;

  const bundledImage = getBundledArrakisImagePath();
  return bundledImage ?? null;
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
  });
  return output.trim() || `${appInfo.name} launched with Attune.`;
}

async function ensureConfiguredForLaunch(appInfo: DiscoveredApp, appId: string): Promise<void> {
  const profile = readProfile();
  if (!profile.enabled || !profile.enabledAppIds.includes(appId)) return;

  const environment = getEnvironment();
  const theme = discoverThemes(environment).find((candidate) => candidate.id === profile.activeThemeId);
  if (!theme) throw new Error(`Theme not found: ${profile.activeThemeId}`);

  const adapter = findMatchingAdapter(theme, appInfo.name);
  if (!adapter?.absolutePath) throw new Error(`${theme.name} has no available adapter for ${appInfo.name}.`);

  const configModule = await loadAttuneModule<ConfigModule>('config.js');
  configModule.setStylesheetSource(appId, adapter.absolutePath, readFileSync(adapter.absolutePath, 'utf8'));
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
  if (!profile.enabled || !profile.autoWrapEnabled || profile.enabledAppIds.length === 0) return;

  const environment = getEnvironment();
  if (!environment.runtimeBuilt) return;

  try {
    const [scanModule, sessionModule] = await Promise.all([
      loadAttuneModule<ScanModule>('scan.js'),
      loadAttuneModule<SessionModule>('session.js'),
    ]);
    const apps = scanModule.scanForSupportedApps()
      .map((appInfo) => ({ appInfo, appId: scanModule.getAppId(appInfo) }))
      .filter((target) => profile.enabledAppIds.includes(target.appId));

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
    adapters,
  };
}

function resolveThemePath(pathBase: string, themeDirectory: string, pathValue: string): string {
  if (isAbsolute(pathValue)) return pathValue;
  if (pathValue.startsWith('themes/')) return join(pathBase, pathValue);
  return join(themeDirectory, pathValue);
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
  };

  try {
    const raw = JSON.parse(readFileSync(getPreferencesPath(), 'utf8')) as Partial<ThemeProfile>;
    return {
      activeThemeId: typeof raw.activeThemeId === 'string' ? raw.activeThemeId : defaultProfile.activeThemeId,
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
  options: { cwd: string; timeout?: number },
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(command, args, {
      cwd: options.cwd,
      timeout: options.timeout ?? 30_000,
      env: process.env,
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
