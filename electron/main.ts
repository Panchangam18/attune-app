import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell, type NativeImage, type OpenDialogOptions } from 'electron';
import { execFile, spawn } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type {
  ActionResult,
  AgentIntegrationId,
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
  WorkspaceBindingInfo,
  WorkspacePatchInfo,
} from './types.js';
import { processListHasExecutable } from './process-detection.js';
import { installCatalogAttunements, resolveCatalogRoot, seedEditableTheme } from './catalog.js';
import { selectRendererDevServerUrl } from './renderer-source.js';
import { getAgentIntegrations, setAgentIntegration, syncManagedAgentIntegrations } from './agent-integrations.js';

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

interface ChatGptCodexModule {
  createCodexTaskFromChatGpt(transfer: unknown): {
    threadId: string;
    title: string;
    cwd: string;
    rolloutPath: string;
  };
}

interface ClipboardSnapshot {
  text: string;
  html: string;
  rtf: string;
  image: NativeImage | null;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
// Development environment variables can leak into apps launched from a shell.
// A packaged release must always load its signed, bundled renderer.
const devServerUrl = selectRendererDevServerUrl(app.isPackaged);
const DEFAULT_THEME_ID = 'arrakis';
const USER_DATA_FOLDER_NAME = 'Attune';
const PROFILE_TARGET_APP_NAMES = ['ChatGPT', 'Visual Studio Code', 'Cursor', 'Spotify', 'Slack'];
const CURSOR_ICON_FONT_GUARD = `/* Cursor's agent UI uses its own icon font. */
.cursor-icon,
.cursor-icon::before {
  font-family: cursor-icons !important;
}

/* The empty-editor watermark has no codicon class, despite using Codicon. */
.monaco-workbench .editor-group-watermark .letterpress,
.monaco-workbench .editor-group-watermark .letterpress::before {
  font-family: codicon !important;
}
`;
const AUTO_WRAP_INTERVAL_MS = 2000;
const AUTO_WRAP_COOLDOWN_MS = 15000;
const CLAUDE_CODEX_PROXY_ENV = 'ATTUNE_CLAUDE_CODEX_PROXY_ENABLED';
const LINEAR_TODOS_BRIDGE_KEY = 'linear-todos';
const LINEAR_TODOS_COMPLETION_BRIDGE_KEY = 'linear-todos-completion';
const LINEAR_COMPLETED_SLACK_DM_BRIDGE_KEY = 'linear-completed-slack-dm';
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
    cursor.css (optional; VS Code adapter is used when omitted)
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
    "Cursor": { "source": "adapters/cursor.css", "canvas": "dark" },
    "Claude": { "source": "adapters/claude.css", "canvas": "light" }
  }
}
\`\`\`

Refresh Attune App after adding or editing a theme.
`;
const USER_WORKSPACES_README = `# Attune User Attunements

Attunements are saved layout presets for apps. They can hide, resize, or
rearrange parts of an app with CSS. An attunement file may also include an
optional script block for cross-app UI bridges:

\`\`\`css
.some-target { display: none; }

/* @attune-script
(() => {
  // Keep scripts idempotent. Attune re-runs them while the app is attached.
})();
@end-attune-script */
\`\`\`

Create a folder for each attunement:

\`\`\`
codex-git-actions/
  manifest.json
  preview.png
  apps/
    chatgpt-git-actions.css
\`\`\`

Manifest patch paths are relative to the attunement folder:

\`\`\`json
{
  "name": "Codex Git Actions",
  "description": "Put native Git shortcuts beside Codex controls.",
  "preview": "preview.png",
  "patches": {
    "Codex": {
      "source": "apps/chatgpt-git-actions.css",
      "intent": "Add native Commit and Push shortcuts beside Codex controls."
    }
  }
}
\`\`\`

For update-resilient attunements, use manifest version 2 and declare the
semantic host roles the patch needs. Attune resolves these roles before the
attunement script runs and continuously remaps them when the host app replaces
its DOM:

\`\`\`json
{
  "manifestVersion": 2,
  "name": "Codex Canvas",
  "patches": {
    "Codex": {
      "source": "apps/canvas.css",
      "bindings": {
        "main": { "role": "codex.primaryChat", "required": true },
        "header": { "role": "codex.chatHeader", "required": false }
      }
    }
  }
}
\`\`\`

Mapped elements receive a stable role attribute for CSS:

\`\`\`css
[data-attune-host-roles~="codex.primaryChat"] { display: flex; }
\`\`\`

Version 2 also accepts a \`targets\` object, a \`styles\` array, and a
separate \`script\` path. Existing version-1 manifests remain supported.

Refresh Attune App after adding or editing an attunement.
`;
const CHATGPT_TO_CODEX_CLIPBOARD_SIGNAL = '__ATTUNE_CHATGPT_TO_CODEX_V1__:';
const CHATGPT_CLAUDE_MODELS_ATTUNEMENT_ID = 'chatgpt-claude-models';
const CHATGPT_TO_CODEX_ATTUNEMENT_ID = 'chatgpt-to-codex';

const ATTUNEMENT_RUNTIME_CLEANUP_CSS = `/* @attune-script
(() => {
  window.__attuneCodexGitActionsCleanup?.();
  window.__attuneYoutubeSourceCleanup?.();
  window.__attuneCodexYoutubeCleanup?.();
  window.__attuneLinearTodosSourceCleanup?.();
  window.__attuneCodexLinearTodosCleanup?.();
})();
@end-attune-script */`;

let mainWindow: BrowserWindow | null = null;
let autoWrapTimer: NodeJS.Timeout | null = null;
let linearTodosBridgeTimer: NodeJS.Timeout | null = null;
let chatGptClipboardTimer: NodeJS.Timeout | null = null;
let browserSlashMonitorProcess: ReturnType<typeof spawn> | null = null;
let browserSlashMonitorStopped = false;
let safariSlashInjectionTimer: NodeJS.Timeout | null = null;
let chromeSlashRefreshTimer: NodeJS.Timeout | null = null;
let scaffoldRefreshTimer: NodeJS.Timeout | null = null;
const scaffoldWatchers: FSWatcher[] = [];
const wrappingAppIds = new Set<string>();
const lastWrapAtByAppId = new Map<string, number>();
const iconDataUrlByAppPath = new Map<string, Promise<string | null>>();

configureUserDataPath();

if (!app.requestSingleInstanceLock()) {
  app.exit(0);
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  installApplicationMenu();
  startAutoWrapMonitor();
  startLinearTodosBridge();
  startChatGptClipboardBridge();
  startBrowserSlashMonitor();
  reconnectSafariChatGptTabsOnStartup();
  startScaffoldMonitor();
  void reapplyEnabledStylesheets();
  void refreshChatGptToCodexRuntimeSessions();
  void syncActiveThemeWallpaper();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  browserSlashMonitorStopped = true;
  browserSlashMonitorProcess?.kill();
  if (safariSlashInjectionTimer) clearTimeout(safariSlashInjectionTimer);
  if (chromeSlashRefreshTimer) clearTimeout(chromeSlashRefreshTimer);
  if (chatGptClipboardTimer) clearInterval(chatGptClipboardTimer);
  if (scaffoldRefreshTimer) clearTimeout(scaffoldRefreshTimer);
  for (const watcher of scaffoldWatchers.splice(0)) watcher.close();
});

function configureUserDataPath(): void {
  const userDataPath = join(app.getPath('home'), 'Library', 'Application Support', USER_DATA_FOLDER_NAME);
  mkdirSync(userDataPath, { recursive: true });
  app.setPath('userData', userDataPath);
}

function startLinearTodosBridge(): void {
  linearTodosBridgeTimer ??= setInterval(() => void refreshLinearTodosBridge(), 2000);
  void refreshLinearTodosBridge();
}

function installApplicationMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Attune',
      submenu: [
        { role: 'quit' },
      ],
    },
  ]));
}

async function connectSafariChatGptTab(): Promise<number> {
  const script = quoteAppleScriptString(readChatGptToCodexScript('safari-listener.js'));
  const appleScript = `set connectedCount to 0
set lastError to ""
if application "Safari" is running then
  tell application "Safari"
    repeat with safariWindow in windows
      repeat with tabItem in tabs of safariWindow
        set tabUrl to URL of tabItem
        if tabUrl starts with "https://chatgpt.com/" or tabUrl starts with "https://chat.openai.com/" then
          try
            do JavaScript ${script} in tabItem
            set connectedCount to connectedCount + 1
          on error errorMessage
            set lastError to errorMessage
          end try
        end if
      end repeat
    end repeat
  end tell
end if
return (connectedCount as text) & "|" & lastError`;
  const output = await exec('/usr/bin/osascript', ['-e', appleScript], { cwd: process.cwd(), timeout: 6_000 });
  const [countValue, lastError] = output.trim().split('|', 2);
  const count = Number.parseInt(countValue, 10) || 0;
  if (count === 0) throw new Error(lastError || 'Open a ChatGPT conversation in Safari first. If it is already open, enable Safari Develop → Allow JavaScript from Apple Events, then choose this command again.');
  return count;
}

function reconnectSafariChatGptTabsOnStartup(): void {
  const profile = readProfile();
  if (!profile.workspaceEnabled || !profile.enabledWorkspaceIds.includes(CHATGPT_TO_CODEX_ATTUNEMENT_ID)) return;
  void syncSafariChatGptAttunement(true, 'startup');
}

async function disconnectSafariChatGptTabs(): Promise<number> {
  const cleanup = quoteAppleScriptString('window.__attuneSafariChatGptToCodexCleanup?.(); "disconnected"');
  const appleScript = `set disconnectedCount to 0
if application "Safari" is running then
  tell application "Safari"
    repeat with safariWindow in windows
      repeat with tabItem in tabs of safariWindow
        set tabUrl to URL of tabItem
        if tabUrl starts with "https://chatgpt.com/" or tabUrl starts with "https://chat.openai.com/" then
          try
            do JavaScript ${cleanup} in tabItem
            set disconnectedCount to disconnectedCount + 1
          end try
        end if
      end repeat
    end repeat
  end tell
end if
return disconnectedCount as text`;
  const output = await exec('/usr/bin/osascript', ['-e', appleScript], { cwd: process.cwd(), timeout: 6_000 });
  return Number.parseInt(output.trim(), 10) || 0;
}

async function syncSafariChatGptAttunement(enabled: boolean, reason: 'startup' | 'toggle'): Promise<void> {
  try {
    const count = enabled
      ? await connectSafariChatGptTab()
      : await disconnectSafariChatGptTabs();
    console.log(
      `[attune] ${enabled ? 'connected' : 'disconnected'} ${count} Safari ChatGPT tab${count === 1 ? '' : 's'} (${reason})`,
    );
  } catch (error) {
    console.warn(
      `[attune] Safari ChatGPT ${reason} ${enabled ? 'connect' : 'disconnect'} unavailable:`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

function quoteAppleScriptString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ')}"`;
}

function readChatGptToCodexScript(fileName: string): string {
  const catalogRoot = resolveCatalogRoot(app.isPackaged, process.resourcesPath, __dirname);
  const scriptPath = join(
    catalogRoot,
    'attunements',
    CHATGPT_TO_CODEX_ATTUNEMENT_ID,
    'apps',
    fileName,
  );
  return readFileSync(scriptPath, 'utf8').replace(
    '${CHATGPT_TO_CODEX_CLIPBOARD_SIGNAL}',
    CHATGPT_TO_CODEX_CLIPBOARD_SIGNAL,
  );
}

function startBrowserSlashMonitor(): void {
  if (process.platform !== 'darwin' || browserSlashMonitorProcess) return;
  browserSlashMonitorStopped = false;
  const bundledPath = join(__dirname, 'assets', 'safari-slash-monitor');
  const helperPath = app.isPackaged
    ? bundledPath.replace(`${join('app.asar', '')}`, `${join('app.asar.unpacked', '')}`)
    : bundledPath;
  if (!existsSync(helperPath)) {
    console.warn(`[attune] browser slash monitor is missing: ${helperPath}`);
    return;
  }

  const monitor = spawn(helperPath, [], { stdio: ['ignore', 'pipe', 'pipe'] });
  browserSlashMonitorProcess = monitor;
  let stdout = '';
  monitor.stdout?.setEncoding('utf8');
  monitor.stdout?.on('data', (chunk: string) => {
    stdout += chunk;
    const lines = stdout.split(/\r?\n/);
    stdout = lines.pop() || '';
    for (const line of lines) handleBrowserSlashSignal(line.trim());
  });
  monitor.stderr?.setEncoding('utf8');
  monitor.stderr?.on('data', (chunk: string) => {
    const message = chunk.trim();
    if (message) console.warn('[attune] browser slash monitor:', message);
  });
  monitor.on('error', (error) => console.warn('[attune] browser slash monitor failed:', error));
  monitor.on('exit', () => {
    if (browserSlashMonitorProcess === monitor) browserSlashMonitorProcess = null;
    if (!browserSlashMonitorStopped) setTimeout(() => startBrowserSlashMonitor(), 3_000).unref();
  });
}

function handleBrowserSlashSignal(browser: string): void {
  if (browser.startsWith('status:')) {
    console.log(`[attune] browser slash monitor ${browser}`);
    return;
  }
  console.log(`[attune] browser slash signal ${browser}`);
  if (browser === 'safari') {
    if (safariSlashInjectionTimer) clearTimeout(safariSlashInjectionTimer);
    safariSlashInjectionTimer = setTimeout(() => {
      safariSlashInjectionTimer = null;
      void injectActiveSafariSlashCommand();
    }, 90);
    safariSlashInjectionTimer.unref();
    return;
  }
  if (browser === 'chrome') {
    if (chromeSlashRefreshTimer) clearTimeout(chromeSlashRefreshTimer);
    chromeSlashRefreshTimer = setTimeout(() => {
      chromeSlashRefreshTimer = null;
      void reapplyEnabledStylesheets();
    }, 25);
    chromeSlashRefreshTimer.unref();
  }
}

async function injectActiveSafariSlashCommand(): Promise<void> {
  const probe = quoteAppleScriptString(readChatGptToCodexScript('safari-slash-probe.js'));
  const listener = quoteAppleScriptString(readChatGptToCodexScript('safari-listener.js'));
  const appleScript = `if application "Safari" is not running then return "stopped"
tell application "Safari"
  if (count of windows) is 0 then return "no-window"
  set tabItem to current tab of front window
  set tabUrl to URL of tabItem
  if tabUrl does not start with "https://chatgpt.com/" and tabUrl does not start with "https://chat.openai.com/" then return "other-site"
  try
    set pageState to do JavaScript ${probe} in tabItem
    if pageState is "slash" then
      do JavaScript ${listener} in tabItem
      return "injected"
    end if
    return pageState
  on error
    return "unavailable"
  end try
end tell`;
  try {
    const result = await exec('/usr/bin/osascript', ['-e', appleScript], {
      cwd: process.cwd(),
      timeout: 3_000,
    });
    console.log(`[attune] one-shot Safari slash injection ${result.trim() || 'empty'}`);
  } catch (error) {
    console.warn('[attune] one-shot Safari slash injection failed:', error);
  }
}

function startChatGptClipboardBridge(): void {
  if (chatGptClipboardTimer) return;
  let previousClipboard = readClipboardSnapshot();
  let previousSignature = clipboardSnapshotSignature(previousClipboard);
  const processing = new Set<string>();

  chatGptClipboardTimer = setInterval(() => {
    const text = clipboard.readText();
    if (text.startsWith(CHATGPT_TO_CODEX_CLIPBOARD_SIGNAL)) {
      const handoffId = text.slice(CHATGPT_TO_CODEX_CLIPBOARD_SIGNAL.length).trim();
      if (!/^[a-z0-9]+$/i.test(handoffId) || processing.has(handoffId)) return;
      processing.add(handoffId);
      restoreClipboardSnapshot(previousClipboard);
      void importSafariChatGptTransfer(handoffId).catch((error) => {
        dialog.showErrorBox(
          'Could not send to Codex',
          error instanceof Error ? error.message : String(error),
        );
      }).finally(() => {
        setTimeout(() => processing.delete(handoffId), 5_000);
      });
      return;
    }

    const snapshot = readClipboardSnapshot();
    const signature = clipboardSnapshotSignature(snapshot);
    if (signature === previousSignature) return;
    previousClipboard = snapshot;
    previousSignature = signature;
  }, 100);
  chatGptClipboardTimer.unref();
}

function readClipboardSnapshot(): ClipboardSnapshot {
  const image = clipboard.readImage();
  return {
    text: clipboard.readText(),
    html: clipboard.readHTML(),
    rtf: clipboard.readRTF(),
    image: image.isEmpty() ? null : image,
  };
}

function clipboardSnapshotSignature(snapshot: ClipboardSnapshot): string {
  const imageSize = snapshot.image?.getSize();
  return [
    snapshot.text,
    snapshot.html,
    snapshot.rtf,
    imageSize ? `${imageSize.width}x${imageSize.height}` : '',
  ].join('\u0000');
}

function restoreClipboardSnapshot(snapshot: ClipboardSnapshot): void {
  if (!snapshot.text && !snapshot.html && !snapshot.rtf && !snapshot.image) {
    clipboard.clear();
    return;
  }
  clipboard.write({
    text: snapshot.text || undefined,
    html: snapshot.html || undefined,
    rtf: snapshot.rtf || undefined,
    image: snapshot.image || undefined,
  });
}

async function importSafariChatGptTransfer(handoffId: string): Promise<void> {
  const transfer = await takeSafariChatGptTransfer(handoffId);
  const bundledAttuneRoot = app.isPackaged
    ? join(process.resourcesPath, 'attune')
    : join(resolve(__dirname, '..'), '..', 'attune');
  const attuneRoot = resolve(process.env.ATTUNE_ROOT || bundledAttuneRoot);
  const modulePath = join(attuneRoot, 'dist', 'codex-chatgpt.js');
  if (!existsSync(modulePath)) throw new Error(`Missing Attune runtime module: ${modulePath}`);
  const codexModule = await import(pathToFileURL(modulePath).href) as ChatGptCodexModule;
  const task = codexModule.createCodexTaskFromChatGpt(transfer);
  await shell.openExternal(`codex://threads/${encodeURIComponent(task.threadId)}`);
}

async function takeSafariChatGptTransfer(handoffId: string): Promise<unknown> {
  const expression = `window.__attuneTakeCodexTransfer?.(${JSON.stringify(handoffId)}) || ''`;
  const appleScript = `if application "Safari" is running then
  tell application "Safari"
    repeat with safariWindow in windows
      repeat with tabItem in tabs of safariWindow
        set tabUrl to URL of tabItem
        if tabUrl starts with "https://chatgpt.com/" or tabUrl starts with "https://chat.openai.com/" then
          try
            set transferJson to do JavaScript ${quoteAppleScriptString(expression)} in tabItem
            if transferJson is not missing value and transferJson is not "" then return transferJson as text
          end try
        end if
      end repeat
    end repeat
  end tell
end if
return ""`;

  await delay(150);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const output = (await exec('/usr/bin/osascript', ['-e', appleScript], {
      cwd: process.cwd(),
      timeout: 3_000,
    })).trim();
    if (output) return JSON.parse(output);
    await delay(100);
  }
  throw new Error('Attune could not read the prepared conversation from Safari.');
}

function startScaffoldMonitor(): void {
  if (scaffoldWatchers.length > 0) return;
  const environment = getEnvironment();
  for (const root of [environment.userThemesRoot, environment.userWorkspacesRoot]) {
    const watcher = watch(root, { recursive: true }, (_eventType, fileName) => {
      const relativePath = String(fileName ?? '');
      if (!relativePath || relativePath.split('/').includes('.inspection')) return;
      if (scaffoldRefreshTimer) clearTimeout(scaffoldRefreshTimer);
      scaffoldRefreshTimer = setTimeout(() => {
        scaffoldRefreshTimer = null;
        void reapplyEnabledStylesheets();
      }, 250);
    });
    watcher.on('error', error => console.warn(`[attune] unable to watch ${root}:`, error));
    scaffoldWatchers.push(watcher);
  }
}

async function reapplyEnabledStylesheets(): Promise<void> {
  try {
    const environment = getEnvironment();
    const [scanModule, configModule] = await Promise.all([
      loadAttuneModule<ScanModule>('scan.js'),
      loadAttuneModule<ConfigModule>('config.js'),
    ]);
    const profile = readProfile();
    const enabledAppIds = getEnabledStyleAppIds(profile);
    if (enabledAppIds.size === 0) return;
    const themes = discoverThemes(environment);
    const workspaces = discoverWorkspaces(environment);
    for (const appInfo of scanModule.scanForSupportedApps()) {
      const appId = scanModule.getAppId(appInfo);
      if (!enabledAppIds.has(appId)) continue;
      applyCompositeStylesheet(appId, appInfo.name, configModule, themes, workspaces, profile);
    }
  } catch (error) {
    console.error('[attune] unable to reapply enabled stylesheets', error);
  }
}

async function refreshLinearTodosBridge(): Promise<void> {
  try {
    const sessionModule = await loadAttuneModule<SessionModule>('session.js');
    const session = sessionModule.getSession('com.linear');
    if (!session || session.status !== 'attached') return;
    const targets = await fetch(`http://127.0.0.1:${session.port}/json`).then((response) => response.json()) as Array<{ type?: string; webSocketDebuggerUrl?: string }>;
    const target = targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
    if (!target?.webSocketDebuggerUrl) return;
    const expression = `JSON.stringify((() => { const seen = new Set(); const list = document.querySelector('[data-list-wrapper]'); const stateFor = (link) => { if (!list) return ''; let state = ''; for (const row of list.querySelectorAll('[data-list-row]')) { if (row === link || row.contains(link)) break; const group = row.getAttribute('data-list-key') || ''; if (group.startsWith('GROUP_')) state = group.slice(6).replace(/_/g, ' '); } return state; }; return { isIssuePage: location.pathname.includes('/issue/'), issues: [...document.querySelectorAll('a[href*="/issue/"], a[href*="/team/"]')].map((link) => { const text = (link.innerText || link.textContent || link.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim(); const href = link.href || ''; const key = text.match(/\\b[A-Z][A-Z0-9]+-\\d+\\b/)?.[0] || href.match(/\\/issue\\/([A-Z][A-Z0-9]+-\\d+)/)?.[1] || ''; const title = text.includes(key) ? text.slice(text.indexOf(key) + key.length).replace(/\\s+(Created|Jul|Jan|Feb|Mar|Apr|May|Jun|Aug|Sep|Oct|Nov|Dec)\\b.*$/i, '').trim() : decodeURIComponent(href.split('/').filter(Boolean).at(-1) || '').replace(/-/g, ' '); return { key, title, href, workflowState: stateFor(link) }; }).filter((issue) => issue.key && issue.title && issue.title.length > 2).filter((issue) => !seen.has(issue.key) && seen.add(issue.key)).slice(0, 50) }; })())`;
    const snapshot = await evaluatePageJson(target.webSocketDebuggerUrl, expression) as { isIssuePage?: boolean; issues?: unknown } | null;
    if (!snapshot || !Array.isArray(snapshot.issues)) return;
    const bridgePath = join(app.getPath('home'), '.attune', 'workspace-bridge.json');
    let store: Record<string, unknown> = {};
    try { store = JSON.parse(readFileSync(bridgePath, 'utf8')) as Record<string, unknown>; } catch {}
    const next = snapshot.isIssuePage && store[LINEAR_TODOS_BRIDGE_KEY]
      ? store[LINEAR_TODOS_BRIDGE_KEY]
      : { updatedAt: new Date().toISOString(), payload: { issues: snapshot.issues } };
    store[LINEAR_TODOS_BRIDGE_KEY] = next;
    const action = await readLinearTodoActionFromApp(sessionModule, 'Codex')
      ?? await readLinearTodoActionFromApp(sessionModule, 'Cursor');
    if (action) {
      if (action.type === 'details') {
        const details = await readLinearTodoDetails(target.webSocketDebuggerUrl, action.key, action.href);
        store['linear-todos-details'] = { updatedAt: new Date().toISOString(), payload: { ...action, ...details } };
      } else if (action.type === 'focus') {
        await focusLinearApp();
      } else if (action.type === 'my-issues') {
        await showLinearMyIssues(target.webSocketDebuggerUrl);
      } else if (action.type === 'priority') {
        const result = await setLinearIssuePriority(target.webSocketDebuggerUrl, action.key, action.value);
        const details = await readLinearTodoDetails(target.webSocketDebuggerUrl, action.key);
        store['linear-todos-details'] = { updatedAt: new Date().toISOString(), payload: { ...action, ...result, ...details } };
      } else {
        const completion = await completeLinearTodo(target.webSocketDebuggerUrl, action.key);
        store[LINEAR_TODOS_COMPLETION_BRIDGE_KEY] = { updatedAt: new Date().toISOString(), payload: { ...action, ...completion } };
      }
    }
    const slackDmEvent = await readLinearCompletedSlackDmEvent(target.webSocketDebuggerUrl);
    if (slackDmEvent) {
      store[LINEAR_COMPLETED_SLACK_DM_BRIDGE_KEY] = { updatedAt: new Date().toISOString(), payload: slackDmEvent };
    }
    mkdirSync(dirname(bridgePath), { recursive: true });
    writeFileSync(bridgePath, JSON.stringify(store, null, 2));
    await Promise.all([
      pushLinearTodosToApp(sessionModule, 'Codex', next, store[LINEAR_TODOS_COMPLETION_BRIDGE_KEY] ?? null, store['linear-todos-details'] ?? null),
      pushLinearTodosToApp(sessionModule, 'Cursor', next, store[LINEAR_TODOS_COMPLETION_BRIDGE_KEY] ?? null, store['linear-todos-details'] ?? null),
      pushWorkspaceBridgeValueToApp(sessionModule, 'Slack', LINEAR_COMPLETED_SLACK_DM_BRIDGE_KEY, store[LINEAR_COMPLETED_SLACK_DM_BRIDGE_KEY] ?? null),
    ]);
  } catch {}
}

async function readLinearCompletedSlackDmEvent(webSocketDebuggerUrl: string): Promise<Record<string, unknown> | null> {
  const result = await evaluatePageJson(webSocketDebuggerUrl, `(() => { const value = document.documentElement.dataset.attuneLinearCompletedSlackDm || ''; delete document.documentElement.dataset.attuneLinearCompletedSlackDm; return JSON.stringify(value ? JSON.parse(value) : null); })()`);
  return result && typeof result === 'object' && typeof (result as { eventId?: unknown }).eventId === 'string'
    ? result as Record<string, unknown>
    : null;
}

async function getAttachedSessionForAppName(sessionModule: SessionModule, appName: string): Promise<SessionRecord | null> {
  const scanModule = await loadAttuneModule<ScanModule>('scan.js');
  const apps = scanModule.scanForSupportedApps();
  const appInfo = apps.find((candidate) => candidate.name === appName)
    ?? (appName === 'Codex' ? apps.find((candidate) => scanModule.getAppId(candidate) === 'com.openai.codex') : undefined);
  const appId = appInfo ? scanModule.getAppId(appInfo) : appName === 'Codex' ? 'com.openai.codex' : null;
  if (!appId) return null;
  const session = sessionModule.getSession(appId);
  return session?.status === 'attached' ? session : null;
}

async function pushLinearTodosToApp(sessionModule: SessionModule, appName: string, todos: unknown, completion: unknown, details: unknown): Promise<void> {
  const session = await getAttachedSessionForAppName(sessionModule, appName);
  if (!session || session.status !== 'attached') return;
  const targets = await fetch(`http://127.0.0.1:${session.port}/json`).then((response) => response.json()) as Array<{ type?: string; webSocketDebuggerUrl?: string }>;
  const expression = `(() => { window.__attuneWorkspaceBridge = { ...(window.__attuneWorkspaceBridge || {}), 'linear-todos': ${JSON.stringify(todos)}, 'linear-todos-completion': ${JSON.stringify(completion)}, 'linear-todos-details': ${JSON.stringify(details)} }; return JSON.stringify(true); })()`;
  await Promise.all(targets
    .filter((target) => target.type === 'page' && target.webSocketDebuggerUrl)
    .map((target) => evaluatePageJson(target.webSocketDebuggerUrl!, expression)));
}

async function pushWorkspaceBridgeValueToApp(sessionModule: SessionModule, appName: string, key: string, value: unknown): Promise<void> {
  const session = await getAttachedSessionForAppName(sessionModule, appName);
  if (!session || session.status !== 'attached') return;
  const targets = await fetch(`http://127.0.0.1:${session.port}/json`).then((response) => response.json()) as Array<{ type?: string; webSocketDebuggerUrl?: string }>;
  const expression = `(() => { window.__attuneWorkspaceBridge = { ...(window.__attuneWorkspaceBridge || {}), [${JSON.stringify(key)}]: ${JSON.stringify(value)} }; return JSON.stringify(true); })()`;
  await Promise.all(targets
    .filter((target) => target.type === 'page' && target.webSocketDebuggerUrl)
    .map((target) => evaluatePageJson(target.webSocketDebuggerUrl!, expression)));
}

async function readLinearTodoActionFromApp(sessionModule: SessionModule, appName: string): Promise<{ id: string; key: string; href?: string; type?: string; value?: string } | null> {
  const session = await getAttachedSessionForAppName(sessionModule, appName);
  if (!session || session.status !== 'attached') return null;
  const targets = await fetch(`http://127.0.0.1:${session.port}/json`).then((response) => response.json()) as Array<{ type?: string; webSocketDebuggerUrl?: string }>;
  for (const target of targets.filter((item) => item.type === 'page' && item.webSocketDebuggerUrl)) {
    const raw = await evaluatePageJson(target.webSocketDebuggerUrl!, `(() => { const value = document.documentElement.dataset.attuneLinearTodosAction || ''; delete document.documentElement.dataset.attuneLinearTodosAction; return JSON.stringify(value ? JSON.parse(value) : null); })()`);
    if (raw && typeof raw === 'object' && typeof (raw as { id?: unknown }).id === 'string' && typeof (raw as { key?: unknown }).key === 'string') {
      return raw as { id: string; key: string; href?: string; type?: string; value?: string };
    }
  }
  return null;
}

async function setLinearIssuePriority(webSocketDebuggerUrl: string, key: string, value: string | undefined): Promise<{ status: 'updated' | 'error'; message?: string }> {
  const expression = `(async () => { const key = ${JSON.stringify(key)}; if (!location.href.includes('/issue/' + key + '/')) return JSON.stringify({ status: 'error', message: 'Linear is not displaying ' + key + '.' }); const priority = [...document.querySelectorAll('button[data-detail-button="true"]')].find((element) => /^(set priority|no priority|urgent|high|medium|low)$/i.test(((element.innerText || element.textContent || '')).replace(/\\s+/g, ' ').trim())); if (!priority) return JSON.stringify({ status: 'error', message: 'Linear did not expose the priority property.' }); priority.click(); await new Promise((resolve) => setTimeout(resolve, 350)); return JSON.stringify({ status: 'menu-open' }); })()`;
  const result = await evaluatePageJson(webSocketDebuggerUrl, expression, true);
  if (result && typeof result === 'object' && (result as { status?: unknown }).status === 'menu-open' && await selectLinearMenuOptionViaAx(webSocketDebuggerUrl, value || 'No priority', 0)) {
    return { status: 'updated' };
  }
  return { status: 'error', message: (result as { message?: string } | null)?.message ?? 'Unable to update priority in Linear.' };
}

async function focusLinearApp(): Promise<void> {
  await new Promise<void>((resolve) => execFile('open', ['-a', 'Linear'], () => resolve()));
}

async function showLinearMyIssues(webSocketDebuggerUrl: string): Promise<void> {
  await evaluatePageJson(webSocketDebuggerUrl, `(() => { const link = [...document.querySelectorAll('a')].find((item) => (item.innerText || item.textContent || '').replace(/\\s+/g, ' ').trim() === 'My issues' || item.href.includes('/my-issues/assigned')); if (link) { link.click(); return JSON.stringify(true); } return JSON.stringify(false); })()`);
}

async function readLinearTodoDetails(webSocketDebuggerUrl: string, key: string, href?: string): Promise<{ status: 'ready' | 'error'; details?: string; priority?: string; workflowState?: string; message?: string }> {
  const open = await evaluatePageJson(webSocketDebuggerUrl, `(() => { const key = ${JSON.stringify(key)}; const requestedHref = ${JSON.stringify(href ?? '')}; if (location.href.includes('/issue/' + key + '/')) return JSON.stringify({ status: 'ready' }); const link = [...document.querySelectorAll('a[href*="/issue/"]')].find((item) => (item.innerText || item.textContent || '').includes(key) || item.href.includes('/issue/' + key + '/')); if (link) { link.click(); return JSON.stringify({ status: 'ready' }); } try { const target = new URL(requestedHref, location.origin); if (target.origin === location.origin && target.pathname.includes('/issue/' + key + '/')) { location.assign(target.href); return JSON.stringify({ status: 'ready' }); } } catch {} return JSON.stringify({ status: 'error', message: 'Linear could not resolve the selected issue.' }); })()`);
  if (!open || typeof open !== 'object' || (open as { status?: unknown }).status !== 'ready') {
    return { status: 'error', message: (open as { message?: string } | null)?.message ?? 'Issue is not visible in Linear.' };
  }
  await new Promise((resolve) => setTimeout(resolve, 800));
  const result = await evaluatePageJson(webSocketDebuggerUrl, `JSON.stringify((() => { const controls = [...document.querySelectorAll('button[data-detail-button="true"]')].map((item) => (item.innerText || item.textContent || '').replace(/\\s+/g, ' ').trim()); const description = document.querySelector('[aria-label="Issue description"]')?.innerText?.trim() || ''; return { status: 'ready', details: description.slice(0, 16000), workflowState: controls.find((value) => /^(todo|backlog|in progress|started|open|done|completed)$/i.test(value)) || '', priority: controls.find((value) => /^(no priority|urgent|high|medium|low)$/i.test(value)) || 'No priority' }; })())`);
  return result && typeof result === 'object' && (result as { status?: unknown }).status === 'ready'
    ? result as { status: 'ready'; details: string; priority: string; workflowState: string }
    : { status: 'error', message: (result as { message?: string } | null)?.message ?? 'Unable to load the Linear issue.' };
}

async function completeLinearTodo(webSocketDebuggerUrl: string, key: string): Promise<{ status: 'completed' | 'error'; message?: string }> {
  const expression = `(async () => { const key = ${JSON.stringify(key)}; if (!location.href.includes('/issue/' + key + '/')) return JSON.stringify({ status: 'error', message: 'Linear is not displaying ' + key + '.' }); const controls = [...document.querySelectorAll('button, [role="button"]')]; const direct = controls.find((element) => { const label = ((element.getAttribute('aria-label') || '') + ' ' + (element.innerText || element.textContent || '')).replace(/\\s+/g, ' ').trim().toLowerCase(); return !label.includes('incomplete') && (label.includes('mark as complete') || label === 'complete'); }); if (direct) { direct.click(); return JSON.stringify({ status: 'completed' }); } const status = [...document.querySelectorAll('button[data-detail-button="true"]')].find((element) => /^(todo|backlog|in progress|started|open)$/i.test((element.innerText || element.textContent || '').replace(/\\s+/g, ' ').trim())); if (!status) return JSON.stringify({ status: 'error', message: 'Linear did not expose the issue status property.' }); status.click(); await new Promise((resolve) => setTimeout(resolve, 350)); return JSON.stringify({ status: 'menu-open' }); })()`;
  const result = await evaluatePageJson(webSocketDebuggerUrl, expression, true);
  if (result && typeof result === 'object' && (result as { status?: unknown }).status === 'completed') return { status: 'completed' };
  if (result && typeof result === 'object' && (result as { status?: unknown }).status === 'menu-open' && await selectLinearMenuOptionViaAx(webSocketDebuggerUrl, 'Done', 1)) return { status: 'completed' };
  return { status: 'error', message: (result as { message?: string } | null)?.message ?? 'Unable to complete this issue.' };
}

async function selectLinearMenuOptionViaAx(webSocketDebuggerUrl: string, label: string, shortcutOffset: number): Promise<boolean> {
  const WebSocketConstructor = (globalThis as unknown as { WebSocket?: new (url: string) => { addEventListener(type: string, listener: (event: any) => void): void; send(message: string): void; close(): void } }).WebSocket;
  if (!WebSocketConstructor) return false;
  const options = await new Promise<string[]>((resolve) => {
    const socket = new WebSocketConstructor(webSocketDebuggerUrl);
    const timeout = setTimeout(() => { socket.close(); resolve([]); }, 1000);
    socket.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(event.data) as { id?: number; result?: { nodes?: Array<{ role?: { value?: string }; name?: { value?: string } }> } };
        if (message.id !== 1) return;
        clearTimeout(timeout);
        socket.close();
        resolve((message.result?.nodes ?? []).filter((node) => node.role?.value === 'option').map((node) => node.name?.value ?? '').filter(Boolean));
      } catch {}
    });
    socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 1, method: 'Accessibility.getFullAXTree', params: {} })));
  });
  const optionIndex = options.findIndex((option) => option.trim().toLowerCase() === label.trim().toLowerCase());
  if (optionIndex < 0) return false;
  const digit = String(optionIndex + shortcutOffset);
  await dispatchCdpDigitKey(webSocketDebuggerUrl, digit);
  return true;
}

async function dispatchCdpDigitKey(webSocketDebuggerUrl: string, digit: string): Promise<void> {
  const WebSocketConstructor = (globalThis as unknown as { WebSocket?: new (url: string) => { addEventListener(type: string, listener: (event: any) => void): void; send(message: string): void; close(): void } }).WebSocket;
  if (!WebSocketConstructor) return;
  await new Promise<void>((resolve) => {
    const socket = new WebSocketConstructor(webSocketDebuggerUrl);
    const timeout = setTimeout(() => { socket.close(); resolve(); }, 1000);
    const keyParams = { key: digit, code: `Digit${digit}`, windowsVirtualKeyCode: 48 + Number(digit), nativeVirtualKeyCode: 48 + Number(digit) };
    socket.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(event.data) as { id?: number };
        if (message.id === 1) socket.send(JSON.stringify({ id: 2, method: 'Input.dispatchKeyEvent', params: { type: 'keyUp', ...keyParams } }));
        else if (message.id === 2) { clearTimeout(timeout); socket.close(); resolve(); }
      } catch {}
    });
    socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 1, method: 'Input.dispatchKeyEvent', params: { type: 'keyDown', text: digit, unmodifiedText: digit, ...keyParams } })));
  });
}

async function evaluatePageJson(webSocketDebuggerUrl: string, expression: string, awaitPromise = false): Promise<unknown> {
  const WebSocketConstructor = (globalThis as unknown as { WebSocket?: new (url: string) => { addEventListener(type: string, listener: (event: any) => void): void; send(message: string): void; close(): void } }).WebSocket;
  if (!WebSocketConstructor) return null;
  return new Promise((resolve) => {
    const socket = new WebSocketConstructor(webSocketDebuggerUrl);
    const timeout = setTimeout(() => { socket.close(); resolve(null); }, 1500);
    socket.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(event.data) as { id?: number; result?: { result?: { value?: string } } };
        if (message.id !== 1) return;
        clearTimeout(timeout);
        socket.close();
        resolve(JSON.parse(message.result?.result?.value ?? 'null'));
      } catch { clearTimeout(timeout); socket.close(); resolve(null); }
    });
    socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise, returnByValue: true } })));
  });
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
  ipcMain.handle('attune:set-agent-integration', async (_event, payload: { agentId: AgentIntegrationId; enabled: boolean }) => (
    wrap(() => updateAgentIntegration(payload.agentId, payload.enabled))
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
  const agentIntegrationOptions = getAgentIntegrationOptions(environment);
  syncManagedAgentIntegrations(agentIntegrationOptions);
  const agentIntegrations = getAgentIntegrations(agentIntegrationOptions);
  console.log(`[attune] snapshot complete in ${Date.now() - startedAt}ms`);
  return { environment, apps, themes, workspaces, profile, targets, agentIntegrations };
}

function getAgentIntegrationOptions(environment = getEnvironment()) {
  return {
    homePath: app.getPath('home'),
    userDataPath: app.getPath('userData'),
    skillSourcePath: join(environment.attuneRoot, 'SKILL.md'),
    cliPath: environment.cliPath,
    nodePath: environment.nodePath,
    electronNode: environment.nodePath === process.execPath,
  };
}

function updateAgentIntegration(agentId: AgentIntegrationId, enabled: boolean): string {
  return setAgentIntegration(getAgentIntegrationOptions(), agentId, enabled);
}

function getEnvironment(): EnvironmentInfo {
  const bundledAttuneRoot = app.isPackaged
    ? join(process.resourcesPath, 'attune')
    : join(resolve(__dirname, '..'), '..', 'attune');
  const attuneRoot = resolve(process.env.ATTUNE_ROOT || bundledAttuneRoot);
  const catalogRoot = resolveCatalogRoot(app.isPackaged, process.resourcesPath, __dirname);
  const userThemesRoot = ensureUserThemesRoot(process.env.ATTUNE_USER_THEMES_ROOT
    ? resolve(process.env.ATTUNE_USER_THEMES_ROOT)
    : join(app.getPath('userData'), 'themes'), catalogRoot);
  const userWorkspacesRoot = ensureUserWorkspacesRoot(process.env.ATTUNE_USER_WORKSPACES_ROOT
    ? resolve(process.env.ATTUNE_USER_WORKSPACES_ROOT)
    : join(app.getPath('userData'), 'workspaces'), catalogRoot);
  const cliPath = resolve(process.env.ATTUNE_CLI_PATH || join(attuneRoot, 'dist', 'cli.js'));
  const nodePath = process.env.ATTUNE_NODE_PATH || (app.isPackaged ? process.execPath : 'node');
  return {
    attuneRoot,
    catalogRoot,
    userThemesRoot,
    userWorkspacesRoot,
    cliPath,
    nodePath,
    runtimeBuilt: existsSync(cliPath),
  };
}

function ensureUserThemesRoot(themesRoot: string, catalogRoot: string): string {
  mkdirSync(themesRoot, { recursive: true });

  const readmePath = join(themesRoot, 'README.md');
  if (!existsSync(readmePath)) {
    writeFileSync(readmePath, USER_THEMES_README);
  }

  seedEditableTheme(catalogRoot, themesRoot, DEFAULT_THEME_ID);

  return themesRoot;
}

function ensureUserWorkspacesRoot(workspacesRoot: string, catalogRoot: string): string {
  mkdirSync(workspacesRoot, { recursive: true });

  const readmePath = join(workspacesRoot, 'README.md');
  if (!existsSync(readmePath)) {
    writeFileSync(readmePath, USER_WORKSPACES_README);
  }

  installCatalogAttunements(catalogRoot, workspacesRoot);
  return workspacesRoot;
}

function getBundledThemeWallpaperPath(themeId: string, catalogRoot = getEnvironment().catalogRoot): string | null {
  const fileName = BUILT_IN_THEME_WALLPAPERS[themeId];
  if (!fileName) return null;

  const imagePath = join(catalogRoot, 'themes', themeId, fileName);
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
  const activeWorkspaces = profile.workspaceEnabled
    ? workspaces.filter((workspace) => profile.enabledWorkspaceIds.includes(workspace.id))
    : [];
  for (const appInfo of scanModule.scanForSupportedApps()) {
    const id = scanModule.getAppId(appInfo);
    const session = sessionModule.getSession(id);
    const workspacePatch = activeWorkspaces.some((workspace) => findMatchingWorkspacePatch(workspace, appInfo.name));
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
      targetWorkspaceApp: workspacePatch,
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

async function refreshThemes(noActiveMessage = 'Themes refreshed.'): Promise<string> {
  let profile = readProfile();
  if (!profile.enabled && !profile.workspaceEnabled) return noActiveMessage;

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

  if (profile.enabled) {
    const activeTheme = themes.find((candidate) => candidate.id === profile.activeThemeId);
    const needsTargetUpgrade = PROFILE_TARGET_APP_NAMES.some((targetName) => (
      !profile.targetAppNames.some((savedTarget) => namesMatch(savedTarget, targetName))
    ));

    // Profiles created before Cursor and Claude support only list the original
    // targets. Add the new compatible apps once, without re-enabling an app the
    // user has subsequently paused.
    if (activeTheme && needsTargetUpgrade) {
      const enabledAppIds = new Set(profile.enabledAppIds);
      for (const appInfo of scanModule.scanForSupportedApps()) {
        if (isProfileTarget(appInfo.name) && findMatchingAdapter(activeTheme, appInfo.name)?.absolutePath) {
          enabledAppIds.add(scanModule.getAppId(appInfo));
        }
      }
      profile = {
        ...profile,
        enabledAppIds: [...enabledAppIds],
        targetAppNames: PROFILE_TARGET_APP_NAMES,
      };
      writeProfile(profile);
    }
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
  return refreshThemes('Attunements refreshed.');
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
      enabledWorkspaceIds: profile.enabledWorkspaceIds,
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
    enabledWorkspaceIds: profile.enabledWorkspaceIds,
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
  if (!workspace) throw new Error(`Attunement not found: ${workspaceId}`);

  const discoveredApps = scanModule.scanForSupportedApps()
    .map((appInfo) => ({ appInfo, appId: scanModule.getAppId(appInfo) }));
  const enabledWorkspaceIds = new Set(profile.enabledWorkspaceIds);
  if (enabled) enabledWorkspaceIds.add(workspaceId);
  else enabledWorkspaceIds.delete(workspaceId);
  const activeWorkspaces = workspaces.filter((candidate) => enabledWorkspaceIds.has(candidate.id));
  const targetApps = discoveredApps.filter((target) => activeWorkspaces.some((candidate) => findMatchingWorkspacePatch(candidate, target.appInfo.name)));
  const changedAppIds = new Set([
    ...profile.enabledWorkspaceAppIds,
    ...targetApps.map((target) => target.appId),
  ]);
  const newProfile: ThemeProfile = {
    ...profile,
    activeWorkspaceId: enabled ? workspaceId : activeWorkspaces[0]?.id ?? null,
    workspaceEnabled: activeWorkspaces.length > 0,
    autoWrapEnabled: enabled ? true : profile.autoWrapEnabled,
    enabledWorkspaceIds: [...enabledWorkspaceIds],
    enabledWorkspaceAppIds: targetApps.map((target) => target.appId),
  };
  const isClaudeModelsToggle = workspaceId === CHATGPT_CLAUDE_MODELS_ATTUNEMENT_ID;

  for (const target of discoveredApps.filter((candidate) => changedAppIds.has(candidate.appId))) {
    applyCompositeStylesheet(target.appId, target.appInfo.name, configModule, themes, workspaces, newProfile);
  }

  writeProfile(newProfile);
  let restartedChatGpt = false;
  for (const target of discoveredApps.filter((candidate) => changedAppIds.has(candidate.appId))) {
    if (isClaudeModelsToggle && isChatGptDesktop(target.appInfo)) {
      restartedChatGpt = await restartRunningAppThroughAttune(
        target.appInfo,
        target.appId,
        scanModule,
      ) || restartedChatGpt;
      continue;
    }
    if (enabled && newProfile.enabledWorkspaceAppIds.includes(target.appId)) {
      await attachRunningSessionIfAvailable(
        target.appInfo,
        target.appId,
        environment,
        scanModule,
        workspaceId === CHATGPT_TO_CODEX_ATTUNEMENT_ID,
      );
    }
  }
  if (workspaceId === CHATGPT_TO_CODEX_ATTUNEMENT_ID) {
    await syncSafariChatGptAttunement(enabled, 'toggle');
  }
  void runAutoWrapPass();

  if (!enabled) {
    if (!isClaudeModelsToggle) return `${workspace.name} attunement disabled.`;
    return restartedChatGpt
      ? `${workspace.name} attunement disabled and ChatGPT restarted.`
      : `${workspace.name} attunement disabled. It will be off the next time ChatGPT launches.`;
  }
  if (targetApps.length === 0) {
    return `${workspace.name} attunement enabled, but no matching apps were found.`;
  }
  const appNames = targetApps.map((target) => target.appInfo.name).join(', ');
  if (!isClaudeModelsToggle) {
    return `${workspace.name} attunement enabled for ${appNames}. Launch or reopen those apps to see it.`;
  }
  return restartedChatGpt
    ? `${workspace.name} attunement enabled for ${appNames}; ChatGPT restarted with external CLI models.`
    : `${workspace.name} attunement enabled for ${appNames}. It will apply the next time ChatGPT launches.`;
}

async function setWorkspaceAppEnabled(appId: string, enabled: boolean): Promise<string> {
  const profile = readProfile();
  if (!profile.activeWorkspaceId) throw new Error('Select an attunement before changing an application.');

  const environment = getEnvironment();
  const [scanModule, configModule] = await Promise.all([
    loadAttuneModule<ScanModule>('scan.js'),
    loadAttuneModule<ConfigModule>('config.js'),
  ]);
  const appInfo = findDiscoveredApp(scanModule, appId);
  const themes = discoverThemes(environment);
  const workspaces = discoverWorkspaces(environment);
  const workspace = workspaces.find((candidate) => candidate.id === profile.activeWorkspaceId);
  if (!workspace) throw new Error(`Attunement not found: ${profile.activeWorkspaceId}`);

  const patch = findMatchingWorkspacePatch(workspace, appInfo.name);
  if (!patch?.absolutePath) throw new Error(`${workspace.name} has no available attunement patch for ${appInfo.name}.`);

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
  const isClaudeModelsChatGpt = profile.activeWorkspaceId === CHATGPT_CLAUDE_MODELS_ATTUNEMENT_ID
    && isChatGptDesktop(appInfo);
  const restartedChatGpt = isClaudeModelsChatGpt
    ? await restartRunningAppThroughAttune(appInfo, appId, scanModule)
    : false;
  if (enabled && !isClaudeModelsChatGpt) {
    await attachRunningSessionIfAvailable(appInfo, appId, environment, scanModule);
    void runAutoWrapPass();
  }

  if (restartedChatGpt) {
    return `${workspace.name} attunement ${enabled ? 'enabled' : 'disabled'} for ${appInfo.name}; ChatGPT restarted.`;
  }
  if (isClaudeModelsChatGpt) {
    return `${workspace.name} attunement ${enabled ? 'enabled' : 'disabled'} for ${appInfo.name}. It will apply the next time ChatGPT launches.`;
  }
  return `${workspace.name} attunement ${enabled ? 'enabled' : 'disabled'} for ${appInfo.name}.`;
}

async function attachRunningSessionIfAvailable(
  appInfo: DiscoveredApp,
  appId: string,
  environment: EnvironmentInfo,
  scanModule: ScanModule,
  restartExisting = false,
): Promise<void> {
  const sessionModule = await loadAttuneModule<SessionModule>('session.js');
  const existingSession = sessionModule.getSession(appId);
  if (existingSession && !restartExisting) return;
  if (existingSession) sessionModule.stopSession(appId);

  const executablePath = scanModule.getAppExecutablePath(appInfo);
  const port = await findRemoteDebuggingPort(executablePath);
  if (!port) return;

  await exec(environment.nodePath, [environment.cliPath, 'attach', appInfo.name, String(port)], {
    cwd: environment.attuneRoot,
    timeout: 5000,
    env: runtimeNodeEnvironment(environment),
  });
}

async function refreshChatGptToCodexRuntimeSessions(): Promise<void> {
  try {
    const profile = readProfile();
    if (!profile.workspaceEnabled || !profile.enabledWorkspaceIds.includes(CHATGPT_TO_CODEX_ATTUNEMENT_ID)) return;
    const environment = getEnvironment();
    if (!environment.runtimeBuilt) return;
    const scanModule = await loadAttuneModule<ScanModule>('scan.js');
    const targets = scanModule.scanForSupportedApps()
      .map(appInfo => ({ appInfo, appId: scanModule.getAppId(appInfo) }))
      .filter(target => profile.enabledWorkspaceAppIds.includes(target.appId))
      .filter(target => namesMatch(target.appInfo.name, 'Google Chrome') || namesMatch(target.appInfo.name, 'Codex'));
    for (const target of targets) {
      await attachRunningSessionIfAvailable(target.appInfo, target.appId, environment, scanModule, true);
    }
  } catch (error) {
    console.warn(
      '[attune] could not refresh the ChatGPT to Codex runtime sessions:',
      error instanceof Error ? error.message : String(error),
    );
  }
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
  const profile = readProfile();
  const launchEnvironment = {
    ...runtimeNodeEnvironment(environment),
    [CLAUDE_CODEX_PROXY_ENV]: isClaudeCodexProxyEnabled(profile, appId, appInfo) ? '1' : '0',
  };
  const output = await exec(environment.nodePath, [environment.cliPath, 'launch', appInfo.name], {
    cwd: environment.attuneRoot,
    env: launchEnvironment,
  });
  return output.trim() || `${appInfo.name} launched with Attune.`;
}

function isClaudeCodexProxyEnabled(
  profile: ThemeProfile,
  appId: string,
  appInfo: DiscoveredApp,
): boolean {
  return isChatGptDesktop(appInfo)
    && profile.workspaceEnabled
    && profile.enabledWorkspaceIds.includes(CHATGPT_CLAUDE_MODELS_ATTUNEMENT_ID)
    && profile.enabledWorkspaceAppIds.includes(appId);
}

function isChatGptDesktop(appInfo: DiscoveredApp): boolean {
  return appInfo.bundleId === 'com.openai.codex';
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

async function restartRunningAppThroughAttune(
  appInfo: DiscoveredApp,
  appId: string,
  scanModule: ScanModule,
): Promise<boolean> {
  const executablePath = scanModule.getAppExecutablePath(appInfo);
  if (!await isProcessRunning(executablePath)) return false;

  wrappingAppIds.add(appId);
  lastWrapAtByAppId.set(appId, Date.now());
  try {
    await quitApp(appInfo);
    await waitForProcessExit(executablePath, 10000);
    await launchApp(appId);
    mainWindow?.webContents.send('attune:auto-wrap-event', {
      appId,
      appName: appInfo.name,
    });
    return true;
  } finally {
    wrappingAppIds.delete(appId);
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
    const processList = await exec('/bin/ps', ['-ax', '-o', 'command='], {
      cwd: process.cwd(),
      timeout: 3000,
    });
    return processListHasExecutable(processList, executablePath);
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
  return buildOutput.trim() || 'Attune runtime built.';
}

function discoverThemes(environment: EnvironmentInfo): ThemeInfo[] {
  const themesById = new Map<string, ThemeInfo>();

  for (const theme of discoverThemesFromDirectory(join(environment.catalogRoot, 'themes'), environment.catalogRoot)) {
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

  type WorkspaceManifestTarget = {
    source?: string;
    styles?: string[];
    script?: string;
    intent?: string;
    bindings?: Record<string, string | { role?: string; required?: boolean }>;
  };
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    manifestVersion?: number;
    name?: string;
    description?: string;
    preview?: string;
    patches?: Record<string, WorkspaceManifestTarget>;
    targets?: Record<string, WorkspaceManifestTarget>;
  };

  const manifestVersion = Number.isInteger(manifest.manifestVersion) ? manifest.manifestVersion! : 1;
  const targets: Record<string, WorkspaceManifestTarget> = manifest.targets ?? manifest.patches ?? {};
  const patches = Object.entries(targets).map(([appName, patch]) => {
    const styleSources = patch.styles?.length ? patch.styles : patch.source ? [patch.source] : [];
    const stylePaths = styleSources
      .map((source) => resolveThemePath(pathBase, workspaceDirectory, source))
      .filter((sourcePath) => existsSync(sourcePath));
    const sourcePath = styleSources[0]
      ? resolveThemePath(pathBase, workspaceDirectory, styleSources[0])
      : null;
    const requestedScriptPath = patch.script
      ? resolveThemePath(pathBase, workspaceDirectory, patch.script)
      : null;
    const scriptPath = requestedScriptPath && existsSync(requestedScriptPath)
      ? requestedScriptPath
      : null;
    const bindings = Object.entries(patch.bindings ?? {}).flatMap(([name, binding]) => {
      const role = typeof binding === 'string' ? binding : binding.role;
      if (!role) return [];
      return [{
        name,
        role,
        required: typeof binding === 'string' ? true : binding.required !== false,
      } satisfies WorkspaceBindingInfo];
    });
    return {
      appName,
      manifestVersion,
      source: styleSources[0] ?? '',
      sourcePath,
      stylePaths,
      scriptPath,
      bindings,
      intent: patch.intent ?? '',
      available: stylePaths.length > 0 || Boolean(scriptPath),
      absolutePath: sourcePath && existsSync(sourcePath) ? sourcePath : null,
    } satisfies WorkspacePatchInfo;
  });

  return {
    id: workspaceId,
    name: manifest.name ?? workspaceId,
    description: manifest.description ?? '',
    previewDataUrl: readWorkspacePreviewDataUrl(pathBase, workspaceDirectory, manifest.preview),
    patches,
  };
}

function readWorkspacePreviewDataUrl(
  pathBase: string,
  workspaceDirectory: string,
  previewPathValue: string | undefined,
): string | null {
  const conventionalCandidates = ['preview.png', 'preview.jpg', 'preview.jpeg', 'preview.webp', 'preview.svg']
    .map((fileName) => join(workspaceDirectory, fileName));
  const explicitCandidate = previewPathValue
    ? resolveThemePath(pathBase, workspaceDirectory, previewPathValue)
    : null;
  const candidates = explicitCandidate
    ? [explicitCandidate, ...conventionalCandidates.filter((candidate) => candidate !== explicitCandidate)]
    : conventionalCandidates;

  const previewPath = candidates.find((candidate) => existsSync(candidate));
  if (!previewPath) return null;

  const mediaType = mediaTypeFor(previewPath);
  if (!mediaType) return null;

  return `data:${mediaType};base64,${readFileSync(previewPath).toString('base64')}`;
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
    preview?: string;
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
    previewDataUrl: readWorkspacePreviewDataUrl(
      pathBase,
      themeDirectory,
      manifest.preview ?? `${themeId}.jpg`,
    ),
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
    if (isCursorApp(appName)) parts.push(CURSOR_ICON_FONT_GUARD);
    sourcePaths.push(themeStylesheet.path);
  }

  if (profile.workspaceEnabled && profile.enabledWorkspaceAppIds.includes(appId)) {
    const activeWorkspaces = workspaces.filter((workspace) => profile.enabledWorkspaceIds.includes(workspace.id));
    const includedWorkspaceSources = new Set<string>();
    for (const workspace of activeWorkspaces) {
      const patch = findMatchingWorkspacePatch(workspace, appName);
      if (!patch?.available) continue;
      const styleSource = patch.stylePaths
        .map((stylePath) => readWorkspaceCssSource(stylePath))
        .join('\n\n');
      const scriptSource = patch.scriptPath
        ? `/* @attune-script\n${readFileSync(patch.scriptPath, 'utf8')}\n@end-attune-script */`
        : '';
      const bindingSource = patch.bindings.length
        ? [
          '/* @attune-bindings',
          JSON.stringify({
            schemaVersion: 1,
            attunementId: workspace.id,
            appName: patch.appName,
            bindings: patch.bindings,
          }),
          '@end-attune-bindings */',
        ].join('\n')
        : '';
      const source = [bindingSource, styleSource, scriptSource].filter(Boolean).join('\n\n');
      const sourceSignature = `${patch.appName}\u0000${source}`;
      if (includedWorkspaceSources.has(sourceSignature)) continue;
      includedWorkspaceSources.add(sourceSignature);
      parts.push([
        `/* Attunement ${workspace.id}: ${patch.appName}. */`,
        source,
      ].join('\n'));
      sourcePaths.push(...patch.stylePaths);
      if (patch.scriptPath) sourcePaths.push(patch.scriptPath);
    }
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
    configModule.setStylesheetSource(appId, '', ATTUNEMENT_RUNTIME_CLEANUP_CSS);
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
  const directAdapter = theme.adapters.find((adapter) => {
    const normalizedAdapter = normalizeAppName(adapter.appName);
    return adapter.available && (
      normalizedAdapter === normalizedApp
      || normalizedApp.includes(normalizedAdapter)
      || normalizedAdapter.includes(normalizedApp)
    );
  });
  if (directAdapter) return directAdapter;

  // Cursor is built on the VS Code workbench, so existing themes remain
  // compatible without requiring every theme author to add another adapter.
  if (isCursorApp(appName)) {
    return theme.adapters.find((adapter) => (
      adapter.available && normalizeAppName(adapter.appName) === 'vscode'
    ));
  }

  return undefined;
}

function isCursorApp(appName: string): boolean {
  return normalizeAppName(appName).includes('cursor');
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
    enabledWorkspaceIds: [],
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
      targetAppNames: Array.isArray(raw.targetAppNames)
        ? raw.targetAppNames.filter((name): name is string => typeof name === 'string')
        : defaultProfile.targetAppNames,
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
      enabledWorkspaceIds: Array.isArray(raw.enabledWorkspaceIds)
        ? raw.enabledWorkspaceIds.filter((id): id is string => typeof id === 'string')
        : raw.workspaceEnabled && typeof raw.activeWorkspaceId === 'string'
          ? [raw.activeWorkspaceId]
          : defaultProfile.enabledWorkspaceIds,
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
    .replace(/\bcodex\b/g, 'chatgpt')
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
