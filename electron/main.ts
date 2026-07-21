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
const LINEAR_TODOS_BRIDGE_KEY = 'linear-todos';
const LINEAR_TODOS_COMPLETION_BRIDGE_KEY = 'linear-todos-completion';
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

Refresh Attune App after adding or editing an attunement.
`;
const SEEDED_WORKSPACE_ID = 'focus-flow';
const CODEX_GIT_ACTIONS_ATTUNEMENT_ID = 'codex-git-actions';
const BLUE_MESSAGES_ATTUNEMENT_ID = 'blue-messages';
const CODEX_YOUTUBE_ATTUNEMENT_ID = 'codex-youtube-player';
const CODEX_LINEAR_TODOS_ATTUNEMENT_ID = 'codex-linear-todos';
const CURSOR_LINEAR_TODOS_ATTUNEMENT_ID = 'cursor-linear-todos';
const CODEX_LINEAR_TODOS_PREVIEW_SOURCE_PATH = '/var/folders/tf/20fh8jh132d4b9chynvh911w0000gn/T/codex-clipboard-6465b8ad-a637-4d01-a25e-d583800c7ec6.png';
const CURSOR_LINEAR_TODOS_PREVIEW_SOURCE_PATH = '/var/folders/tf/20fh8jh132d4b9chynvh911w0000gn/T/codex-clipboard-a627900d-463d-4cf7-bd7a-7e7e951cd437.png';
const LINEAR_DARK_LOGO_DATA_URI = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIGZpbGw9Im5vbmUiIHdpZHRoPSIyMDAiIGhlaWdodD0iMjAwIiB2aWV3Qm94PSIwIDAgMTAwIDEwMCI+PHBhdGggZmlsbD0iIzIyMjMyNiIgZD0iTTEuMjI1NDEgNjEuNTIyOGMtLjIyMjUtLjk0ODUuOTA3NDgtMS41NDU5IDEuNTk2MzgtLjg1N0wzOS4zMzQyIDk3LjE3ODJjLjY4ODkuNjg4OS4wOTE1IDEuODE4OS0uODU3IDEuNTk2NEMyMC4wNTE1IDk0LjQ1MjIgNS41NDc3OSA3OS45NDg1IDEuMjI1NDEgNjEuNTIyOFpNLjAwMTg5MTM1IDQ2Ljg4OTFjLS4wMTc2NDM3NS4yODMzLjA4ODg3MjE1LjU1OTkuMjg5NTcxNjUuNzYwNkw1Mi4zNTAzIDk5LjcwODVjLjIwMDcuMjAwNy40NzczLjMwNzUuNzYwNi4yODk2IDIuMzY5Mi0uMTQ3NiA0LjY5MzgtLjQ2IDYuOTYyNC0uOTI1OS43NjQ1LS4xNTcgMS4wMzAxLTEuMDk2My40NzgyLTEuNjQ4MUwyLjU3NTk1IDM5LjQ0ODVjLS41NTE4Ni0uNTUxOS0xLjQ5MTE3LS4yODYzLTEuNjQ4MTc0LjQ3ODItLjQ2NTkxNSAyLjI2ODYtLjc3ODMyIDQuNTkzMi0uOTI1ODg0NjUgNi45NjI0Wk00LjIxMDkzIDI5LjcwNTRjLS4xNjY0OS4zNzM4LS4wODE2OS44MTA2LjIwNzY1IDEuMWw2NC43NzYwMiA2NC43NzZjLjI4OTQuMjg5NC43MjYyLjM3NDIgMS4xLjIwNzcgMS43ODYxLS43OTU2IDMuNTE3MS0xLjY5MjcgNS4xODU1LTIuNjg0LjU1MjEtLjMyOC42MzczLTEuMDg2Ny4xODMyLTEuNTQwN0w4LjQzNTY2IDI0LjMzNjdjLS40NTQwOS0uNDU0MS0xLjIxMjcxLS4zNjg5LTEuNTQwNzQuMTgzMi0uOTkxMzIgMS42Njg0LTEuODg4NDMgMy4zOTk0LTIuNjgzOTkgNS4xODU1Wk0xMi42NTg3IDE4LjA3NGMtLjM3MDEtLjM3MDEtLjM5My0uOTYzNy0uMDQ0My0xLjM1NDFDMjEuNzc5NSA2LjQ1OTMxIDM1LjExMTQgMCA0OS45NTE5IDAgNzcuNTkyNyAwIDEwMCAyMi40MDczIDEwMCA1MC4wNDgxYzAgMTQuODQwNS02LjQ1OTMgMjguMTcyNC0xNi43MTk5IDM3LjMzNzUtLjM5MDMuMzQ4Ny0uOTg0LjMyNTgtMS4zNTQyLS4wNDQzTDEyLjY1ODcgMTguMDc0WiIvPjwvc3ZnPg==';
const SEEDED_WORKSPACE_MANIFEST = `{
  "name": "Focus Flow",
  "description": "Quiet noisy app surfaces and bring Linear context into Codex.",
  "preview": "preview.png",
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
const SEEDED_WORKSPACE_PREVIEW_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 600" role="img" aria-label="Focus Flow attunement preview">
  <rect width="960" height="600" fill="#121514"/>
  <rect x="36" y="34" width="432" height="532" fill="#1a1e1b" stroke="#303730" stroke-width="2"/>
  <rect x="492" y="34" width="432" height="532" fill="#17191f" stroke="#303746" stroke-width="2"/>
  <rect x="36" y="34" width="432" height="42" fill="#222821"/>
  <rect x="492" y="34" width="432" height="42" fill="#202633"/>
  <circle cx="63" cy="55" r="8" fill="#70ad87"/>
  <circle cx="516" cy="55" r="8" fill="#d8c88f"/>
  <rect x="64" y="108" width="168" height="20" rx="2" fill="#d8c88f"/>
  <rect x="64" y="148" width="342" height="74" fill="#252b25" stroke="#3d473f"/>
  <rect x="64" y="238" width="118" height="118" fill="#2b342d" stroke="#425043"/>
  <rect x="198" y="238" width="118" height="118" fill="#2b342d" stroke="#425043"/>
  <rect x="332" y="238" width="74" height="118" fill="#202520" stroke="#303830" opacity=".42"/>
  <path d="M66 416h336" stroke="#2f372f" stroke-width="18" stroke-linecap="square"/>
  <path d="M66 466h240" stroke="#2f372f" stroke-width="18" stroke-linecap="square"/>
  <rect x="526" y="108" width="244" height="22" rx="2" fill="#d8c88f"/>
  <rect x="526" y="152" width="322" height="264" fill="#20242d" stroke="#343b49"/>
  <rect x="560" y="190" width="254" height="15" fill="#6d788f"/>
  <rect x="560" y="224" width="194" height="15" fill="#556071"/>
  <rect x="560" y="258" width="230" height="15" fill="#556071"/>
  <rect x="560" y="292" width="164" height="15" fill="#556071"/>
  <rect x="618" y="362" width="256" height="168" fill="#111417" stroke="#d8c88f" stroke-width="2"/>
  <rect x="638" y="382" width="98" height="15" fill="#d8c88f"/>
  <rect x="638" y="422" width="200" height="12" fill="#69737f"/>
  <rect x="638" y="454" width="172" height="12" fill="#69737f"/>
  <rect x="638" y="486" width="214" height="12" fill="#69737f"/>
</svg>
`;
const LINEAR_BRIEF_SCRIPT = `(() => {
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
      : '<li><small>Open Linear with this attunement enabled to populate this brief.</small></li>';
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
  clearInterval(window.__attuneLinearBrief);
  window.__attuneLinearBrief = setInterval(render, 2500);
  render();
})();`;
const LINEAR_BRIEF_CSS = `#attune-linear-brief {
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
${LINEAR_BRIEF_CSS}

/* @attune-script
${LINEAR_BRIEF_SCRIPT}
@end-attune-script */
`;
const CODEX_GIT_ACTIONS_MANIFEST = `{
  "name": "Codex: Commit + Push",
  "description": "Put native Commit and Push shortcuts beside Codex controls.",
  "preview": "preview.png",
  "patches": {
    "Codex": {
      "source": "apps/chatgpt-git-actions.css",
      "intent": "Add native Commit and Push shortcuts beside the Codex summary and IDE controls."
    }
  }
}
`;
const CODEX_GIT_ACTIONS_CSS = `/* Attune managed: codex-git-actions */
#attune-codex-git-actions { display: inline-flex; align-items: center; margin-right: 4px; pointer-events: auto; }
#attune-codex-git-actions button {
  appearance: none; height: 28px; padding: 0 10px; border: 0; border-radius: 6px;
  background: color-mix(in srgb, CanvasText 11%, transparent); color: CanvasText; cursor: pointer;
  font: 600 12px/1 ui-sans-serif, system-ui, sans-serif;
}
#attune-codex-git-actions button:hover { background: color-mix(in srgb, CanvasText 18%, transparent); }
#attune-codex-git-actions button:focus-visible { outline: 2px solid Highlight; outline-offset: 2px; }
#attune-codex-git-modal { position: fixed; inset: 0; z-index: 2147483647; display: grid; place-items: center; background: rgb(0 0 0 / 42%); }
#attune-codex-git-modal form { width: min(380px, calc(100vw - 32px)); padding: 18px; border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 8px; background: Canvas; color: CanvasText; box-shadow: 0 20px 60px rgb(0 0 0 / 35%); }
#attune-codex-git-modal h2 { margin: 0; font: 650 16px/1.2 ui-sans-serif, system-ui, sans-serif; }
#attune-codex-git-modal textarea { box-sizing: border-box; width: 100%; min-height: 88px; margin-top: 14px; padding: 9px; border: 1px solid rgb(255 255 255 / 16%); border-radius: 6px; outline: none; background: color-mix(in srgb, Canvas 96%, CanvasText 4%); color: CanvasText; font: 13px/1.4 ui-sans-serif, system-ui, sans-serif; resize: vertical; }
#attune-codex-git-modal textarea:focus { border-color: rgb(255 255 255 / 26%); outline: none; }
#attune-codex-git-modal footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
#attune-codex-git-modal footer button { height: 30px; padding: 0 10px; border: 0; border-radius: 6px; cursor: pointer; font: 600 12px/1 ui-sans-serif, system-ui, sans-serif; }
#attune-codex-git-cancel { background: color-mix(in srgb, CanvasText 11%, transparent); color: CanvasText; }
#attune-codex-git-submit { background: #111; color: #fff; }

/* @attune-script
(() => {
  const textOf = (element) => (element?.innerText || element?.textContent || '').replace(/\\s+/g, ' ').trim();
  const buttons = () => [...document.querySelectorAll('button')];
  const buttonByText = (label) => buttons().find((button) => textOf(button).toLowerCase() === label.toLowerCase());
  const summaryButton = () => buttons().find((button) => button.getAttribute('aria-label') === 'Toggle summary');

  const waitFor = async (find, attempts = 15) => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const value = find();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    return null;
  };

  const commitAndPush = async (message) => {
    const summary = summaryButton();
    if (!summary) return;
    if (summary.getAttribute('aria-expanded') !== 'true') summary.click();
    const picker = await waitFor(() => buttonByText('Commit or push'));
    if (!picker) return;
    picker.click();
    const input = await waitFor(() => document.querySelector('textarea[aria-label="Commit message"]'));
    if (!input) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(input, message);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const nativeSubmit = await waitFor(() => document.querySelector(
      '[role="dialog"] [role="option"][data-value="commit-and-push"]',
    ));
    nativeSubmit?.click();
  };

  const openModal = () => {
    if (document.getElementById('attune-codex-git-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'attune-codex-git-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'attune-codex-git-title');
    modal.innerHTML = '<form><h2 id="attune-codex-git-title">Commit and push</h2><textarea autofocus required placeholder="Commit message" aria-label="Commit message"></textarea><footer><button type="button" id="attune-codex-git-cancel">Cancel</button><button type="submit" id="attune-codex-git-submit">Commit and push</button></footer></form>';
    const close = () => modal.remove();
    modal.querySelector('#attune-codex-git-cancel')?.addEventListener('click', close);
    modal.addEventListener('click', (event) => { if (event.target === modal) close(); });
    modal.querySelector('form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const message = modal.querySelector('textarea')?.value.trim();
      if (!message) return;
      close();
      void commitAndPush(message);
    });
    document.body.append(modal);
    modal.querySelector('textarea')?.focus();
  };

  const render = () => {
    const summary = summaryButton();
    if (!summary) return;
    const existing = document.getElementById('attune-codex-git-actions');
    if (existing?.dataset.attuneVersion === '5') return;
    existing?.remove();
    const root = document.createElement('span');
    root.id = 'attune-codex-git-actions';
    root.dataset.attuneVersion = '5';
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Git actions');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Commit and push';
    button.title = 'Commit and push using Codex';
    button.addEventListener('click', openModal);
    root.append(button);
    summary.parentElement?.parentElement?.parentElement?.prepend(root);
  };

  render();
  clearInterval(window.__attuneCodexGitActions);
  window.__attuneCodexGitActions = setInterval(render, 1000);
  const cleanup = () => {
    clearInterval(window.__attuneCodexGitActions);
    document.getElementById('attune-codex-git-actions')?.remove();
    document.getElementById('attune-codex-git-modal')?.remove();
  };
  window.__attuneCodexGitActionsCleanup = cleanup;
  window.__attuneRegisterCleanup?.(cleanup);
})();
@end-attune-script */
`;
const BLUE_MESSAGES_MANIFEST = `{
  "name": "Codex: Blue messages",
  "description": "Give your ChatGPT messages the familiar iPhone blue treatment.",
  "preview": "preview.png",
  "patches": {
    "ChatGPT": {
      "source": "apps/chatgpt-blue-messages.css",
      "intent": "Make user messages iPhone blue (#007AFF) with white text."
    }
  }
}
`;
const BLUE_MESSAGES_CSS = `/* Attune managed: blue-messages */
/* Codex uses data-user-message-bubble; the remaining selectors support ChatGPT surfaces. */
:is(
  [data-user-message-bubble],
  [data-message-author-role="user"] > div > div,
  [data-message-author-role="user"] > div > div > div,
  article[data-turn="user"] > div > div,
  article[data-turn="user"] > div > div > div
) {
  background: #007aff !important;
  color: #fff !important;
}

:is([data-user-message-bubble], [data-message-author-role="user"], article[data-turn="user"]) :is(p, span, code, pre, li, strong, em, a) {
  color: #fff !important;
}

:is([data-user-message-bubble], [data-message-author-role="user"], article[data-turn="user"]) :is(svg, button) {
  color: #fff;
}
`;
const CODEX_YOUTUBE_MANIFEST = `{
  "name": "YouTube in Codex",
  "description": "Show the YouTube video playing in Google Chrome in a compact Codex player.",
  "preview": "preview.svg",
  "patches": {
    "Google Chrome": {
      "source": "apps/chrome-youtube-source.css",
      "intent": "Publish the active YouTube video URL and playback position to the local Attune bridge."
    },
    "Codex": {
      "source": "apps/codex-youtube-player.css",
      "intent": "Display the current YouTube video using YouTube's official embedded player."
    }
  }
}
`;
const CODEX_LINEAR_TODOS_MANIFEST = `{
  "name": "Codex: Linear To-dos",
  "description": "Open your visible Linear to-dos in a focused modal from Codex.",
  "preview": "preview.png",
  "patches": {
    "Linear": {
      "source": "apps/linear-todos-source.css",
      "intent": "Publish the visible to-do issues from Linear to the local Attune bridge."
    },
    "Codex": {
      "source": "apps/codex-linear-todos.css",
      "intent": "Add a top-left To-dos button that opens a Linear tasks modal to the right of the Codex sidebar."
    }
  }
}
`;
const CURSOR_LINEAR_TODOS_MANIFEST = `{
  "name": "Cursor: Linear To-dos",
  "description": "Open your visible Linear to-dos in a focused modal from Cursor.",
  "preview": "preview.png",
  "patches": {
    "Linear": {
      "source": "apps/linear-todos-source.css",
      "intent": "Publish the visible to-do issues from Linear to the local Attune bridge."
    },
    "Cursor": {
      "source": "apps/cursor-linear-todos.css",
      "intent": "Add a To-dos button that opens a Linear tasks modal in Cursor."
    }
  }
}`;
const CODEX_LINEAR_TODOS_PREVIEW_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 600" role="img" aria-label="Linear To-dos in Codex attunement preview">
  <rect width="960" height="600" fill="#111315"/>
  <rect x="34" y="30" width="892" height="540" rx="14" fill="#1b1e22" stroke="#353a40" stroke-width="2"/>
  <rect x="34" y="30" width="892" height="48" rx="14" fill="#24282d"/>
  <circle cx="64" cy="54" r="8" fill="#ff5f57"/><circle cx="88" cy="54" r="8" fill="#febc2e"/><circle cx="112" cy="54" r="8" fill="#28c840"/>
  <rect x="56" y="96" width="184" height="450" rx="6" fill="#15181c" stroke="#30353c"/>
  <rect x="76" y="124" width="112" height="15" rx="3" fill="#8993a0"/><rect x="76" y="162" width="132" height="15" rx="3" fill="#59636e"/><rect x="76" y="200" width="98" height="15" rx="3" fill="#59636e"/>
  <rect x="265" y="98" width="112" height="31" rx="6" fill="#2d4159"/><rect x="285" y="108" width="70" height="11" rx="3" fill="#d9edff"/>
  <rect x="438" y="144" width="350" height="306" rx="10" fill="#22272d" stroke="#4b5561" stroke-width="2"/>
  <rect x="438" y="144" width="350" height="58" rx="10" fill="#2b3138"/><rect x="460" y="165" width="126" height="15" rx="3" fill="#eef2f6"/><circle cx="758" cy="173" r="10" fill="#64707b"/>
  <circle cx="467" cy="234" r="8" fill="#7e9ad0"/><rect x="486" y="226" width="54" height="12" rx="3" fill="#91a4bd"/><rect x="486" y="248" width="238" height="13" rx="3" fill="#dce2e9"/>
  <circle cx="467" cy="294" r="8" fill="#7e9ad0"/><rect x="486" y="286" width="54" height="12" rx="3" fill="#91a4bd"/><rect x="486" y="308" width="195" height="13" rx="3" fill="#dce2e9"/>
  <circle cx="467" cy="354" r="8" fill="#7e9ad0"/><rect x="486" y="346" width="54" height="12" rx="3" fill="#91a4bd"/><rect x="486" y="368" width="222" height="13" rx="3" fill="#dce2e9"/>
</svg>
`;
const CODEX_LINEAR_TODOS_SOURCE_CSS = `/* Attune managed: codex-linear-todos source */
/* @attune-script
(() => {
  const bridgeUrl = 'http://127.0.0.1:47655/v1/linear-todos';
  const actionUrl = 'http://127.0.0.1:47655/v1/linear-todos-action';
  const completionUrl = 'http://127.0.0.1:47655/v1/linear-todos-completion';
  let lastSignature = '';
  let lastActionId = '';
  const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const collect = () => {
    const seen = new Set();
    const issues = [...document.querySelectorAll('a[href*="/issue/"], a[href*="/team/"]')]
      .map((node) => {
        const text = (node.innerText || node.textContent || node.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim();
        const href = node.href || '';
        const key = text.match(/\\b[A-Z][A-Z0-9]+-\\d+\\b/)?.[0] || href.match(/\\/issue\\/([A-Z][A-Z0-9]+-\\d+)/)?.[1] || '';
        const title = text.includes(key)
          ? text.slice(text.indexOf(key) + key.length).replace(/\\s+Created\\b.*$/i, '').trim()
          : decodeURIComponent(href.split('/').filter(Boolean).at(-1) || '').replace(/-/g, ' ');
        return { key, title, href };
      })
      .filter((issue) => issue.key && issue.title && issue.title.length > 2)
      .filter((issue) => !seen.has(issue.key) && seen.add(issue.key))
      .slice(0, 20);
    const signature = JSON.stringify(issues);
    if (signature === lastSignature) return;
    lastSignature = signature;
    fetch(bridgeUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ issues }),
    }).catch(() => {});
  };
  const complete = async (action) => {
    const key = String(action?.key || '');
    const links = [...document.querySelectorAll('a[href*="/issue/"], a[href*="/team/"]')];
    const issueLink = links.find((link) => (link.innerText || link.textContent || '').includes(key));
    if (!issueLink) throw new Error('Could not find this issue in the current Linear view.');
    issueLink.click();
    await wait(700);
    const button = [...document.querySelectorAll('button, [role="button"]')].find((element) => {
      const label = ((element.getAttribute('aria-label') || '') + ' ' + (element.innerText || element.textContent || '')).replace(/\\s+/g, ' ').trim().toLowerCase();
      return !label.includes('incomplete') && (label.includes('mark as complete') || label === 'complete' || label === 'done');
    });
    if (!button) throw new Error('Linear did not expose a Complete button for this issue.');
    button.click();
  };
  const checkAction = async () => {
    try {
      const state = await fetch(actionUrl, { cache: 'no-store' }).then((response) => response.json());
      const action = state?.payload;
      if (!action?.id || action.id === lastActionId || action.type !== 'complete') return;
      lastActionId = action.id;
      try {
        await complete(action);
        await fetch(completionUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: action.id, key: action.key, status: 'completed' }) });
        setTimeout(collect, 900);
      } catch (error) {
        await fetch(completionUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: action.id, key: action.key, status: 'error', message: error instanceof Error ? error.message : 'Unable to complete this issue.' }) });
      }
    } catch {}
  };
  clearInterval(window.__attuneLinearTodosSource);
  window.__attuneLinearTodosSource = setInterval(collect, 1500);
  clearInterval(window.__attuneLinearTodosActions);
  window.__attuneLinearTodosActions = setInterval(checkAction, 700);
  collect();
  checkAction();
  const cleanup = () => { clearInterval(window.__attuneLinearTodosSource); clearInterval(window.__attuneLinearTodosActions); };
  window.__attuneLinearTodosSourceCleanup = cleanup;
  window.__attuneRegisterCleanup?.(cleanup);
})();
@end-attune-script */
`;
const CODEX_LINEAR_TODOS_CSS = `/* Attune managed: codex-linear-todos */
#attune-codex-linear-todos-trigger { position: fixed; top: 12px; left: 282px; z-index: 2147483646; display: inline-flex; align-items: center; gap: 7px; height: 30px; padding: 0 10px; border: 1px solid color-mix(in srgb, CanvasText 16%, transparent); border-radius: 7px; background: color-mix(in srgb, Canvas 88%, CanvasText 12%); color: CanvasText; box-shadow: 0 4px 16px rgb(0 0 0 / 18%); cursor: pointer; font: 600 12px/1 Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
#attune-codex-linear-todos-trigger:hover, #attune-codex-linear-todos-trigger[aria-expanded="true"] { background: color-mix(in srgb, Canvas 76%, CanvasText 24%); }
#attune-codex-linear-todos-trigger:focus-visible, #attune-codex-linear-todos-modal button:focus-visible, #attune-codex-linear-todos-modal a:focus-visible { outline: 2px solid Highlight; outline-offset: 2px; }
#attune-codex-linear-todos-modal { position: fixed; top: 48px; left: 282px; z-index: 2147483647; display: block; padding: 0; background: transparent; }
#attune-codex-linear-todos-modal [role="document"] { width: max-content; max-width: min(220px, calc(100vw - 32px)); overflow: hidden; border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 10px; background: Canvas; color: CanvasText; box-shadow: 0 24px 80px rgb(0 0 0 / 42%); font: 13px/1.4 Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
#attune-codex-linear-todos-modal header, #attune-codex-linear-todos-modal .attune-linear-issue-actions { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 13px 14px; }
#attune-codex-linear-todos-modal header { border-bottom: 1px solid color-mix(in srgb, CanvasText 13%, transparent); }
#attune-codex-linear-todos-modal h2 { display: inline-flex; align-items: center; gap: 7px; margin: 0; font-size: 14px; line-height: 1.2; }
#attune-codex-linear-todos-logo { width: 15px; height: 15px; flex: 0 0 15px; }
#attune-codex-linear-todos-modal button, #attune-codex-linear-todos-modal a { border: 0; border-radius: 6px; padding: 7px 9px; background: color-mix(in srgb, CanvasText 11%, transparent); color: CanvasText; cursor: pointer; font: 600 12px/1 Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; text-decoration: none; }
#attune-codex-linear-todos-list-wrap { position: relative; display: none; }
#attune-codex-linear-todos-modal[data-expanded="true"] #attune-codex-linear-todos-list-wrap { display: block; }
#attune-codex-linear-todos-list { max-height: 156px; margin: 0; padding: 0; overflow-y: auto; overflow-x: hidden; scrollbar-width: none; list-style: none; }
#attune-codex-linear-todos-list::-webkit-scrollbar { display: none; }
#attune-codex-linear-todos-list-scrollbar { position: absolute; top: 7px; right: 3px; bottom: 7px; display: none; width: 6px; border-radius: 999px; background: rgb(39 49 63 / 18%); pointer-events: none; }
#attune-codex-linear-todos-list-scrollbar::after { position: absolute; top: 0; left: 0; width: 100%; height: var(--attune-linear-scroll-thumb-size, 28px); border-radius: inherit; background: rgb(92 115 255 / 78%); content: ''; transform: translateY(var(--attune-linear-scroll-thumb-offset, 0)); }
#attune-codex-linear-todos-list-wrap[data-scrollable="true"] #attune-codex-linear-todos-list-scrollbar { display: block; }
#attune-codex-linear-todos-list li { border-bottom: 1px solid color-mix(in srgb, CanvasText 9%, transparent); }
#attune-codex-linear-todos-list li:last-child { border-bottom: 0; }
#attune-codex-linear-todos-list button { width: 100%; border-radius: 0; padding: 12px 18px 12px 14px; background: transparent; text-align: left; }
#attune-codex-linear-todos-list button:hover { background: color-mix(in srgb, CanvasText 8%, transparent); }
#attune-codex-linear-todos-list strong { display: block; margin-bottom: 3px; color: color-mix(in srgb, CanvasText 76%, #7ca8ff); font-size: 11px; }
#attune-codex-linear-todos-list .attune-linear-status { display: inline-block; margin-left: 6px; padding: 2px 5px; border-radius: 999px; background: color-mix(in srgb, CanvasText 12%, transparent); color: color-mix(in srgb, CanvasText 76%, #9aa8b8); font-size: 10px; font-style: normal; font-weight: 700; line-height: 1; text-transform: capitalize; }
#attune-codex-linear-todos-list .attune-linear-status[data-status="backlog"] { background: rgb(132 145 158 / 22%); color: #b6c0ca; }
#attune-codex-linear-todos-list .attune-linear-status[data-status="todo"] { background: rgb(206 213 223 / 18%); color: #d7dde5; }
#attune-codex-linear-todos-list .attune-linear-status[data-status="in-progress"], #attune-codex-linear-todos-list .attune-linear-status[data-status="started"] { background: rgb(244 198 0 / 20%); color: #ffd94d; }
#attune-codex-linear-todos-list .attune-linear-status[data-status="done"], #attune-codex-linear-todos-list .attune-linear-status[data-status="completed"] { background: rgb(92 115 255 / 23%); color: #9cabff; }
#attune-codex-linear-todos-list .attune-linear-status[data-status="canceled"], #attune-codex-linear-todos-list .attune-linear-status[data-status="duplicate"] { background: rgb(174 184 196 / 16%); color: #9ca7b2; }
#attune-codex-linear-todos-list span { display: block; }
#attune-codex-linear-todos-empty { padding: 24px 14px; color: color-mix(in srgb, CanvasText 62%, transparent); text-align: center; }
#attune-codex-linear-issue-modal { position: fixed; inset: 0; z-index: 2147483648; display: grid; place-items: center; padding: 16px; background: rgb(0 0 0 / 48%); }
#attune-codex-linear-issue-modal [role="document"] { width: min(420px, calc(100vw - 32px)); border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); border-radius: 10px; background: Canvas; color: CanvasText; box-shadow: 0 24px 80px rgb(0 0 0 / 42%); font: 13px/1.4 Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
#attune-codex-linear-issue-modal h2 { margin: 0; font-size: 16px; } #attune-codex-linear-issue-modal .attune-linear-issue-copy { max-height: min(560px, calc(100vh - 160px)); padding: 18px; overflow: auto; } #attune-codex-linear-issue-modal .attune-linear-issue-key { margin: 0 0 7px; color: color-mix(in srgb, CanvasText 64%, #7ca8ff); font-size: 12px; } #attune-codex-linear-issue-modal [data-priority] > div { display: flex; flex-wrap: wrap; gap: 6px; } #attune-codex-linear-issue-modal [data-priority] button { border: 0; border-radius: 5px; padding: 6px 8px; background: color-mix(in srgb, CanvasText 10%, transparent); color: CanvasText; cursor: pointer; font: 600 11px/1 Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; } #attune-codex-linear-issue-modal footer { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 18px; border-top: 1px solid color-mix(in srgb, CanvasText 12%, transparent); }

/* @attune-script
(() => {
  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const readTodos = async () => {
    const state = window.__attuneWorkspaceBridge?.['linear-todos'] || null;
    return { issues: Array.isArray(state?.payload?.issues) ? state.payload.issues : [], updatedAt: state?.updatedAt || null };
  };
  const close = () => { const panel = document.getElementById('attune-codex-linear-todos-modal'); if (panel) { panel.dataset.expanded = 'false'; const expand = panel.querySelector('[data-expand]'); if (expand) { expand.textContent = '+'; expand.setAttribute('aria-expanded', 'false'); } } };
  const closeIssue = (returnToTasks = true) => { document.getElementById('attune-codex-linear-issue-modal')?.remove(); if (returnToTasks) document.documentElement.dataset.attuneLinearTodosAction = JSON.stringify({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), key: '', type: 'my-issues' }); };
  const complete = async (button, issue) => {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    button.disabled = true; button.textContent = 'Completing…';
    try {
      document.documentElement.dataset.attuneLinearTodosAction = JSON.stringify({ id, key: issue.key });
      for (let attempt = 0; attempt < 16; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const result = window.__attuneWorkspaceBridge?.['linear-todos-completion'];
        if (result?.payload?.id !== id) continue;
        if (result.payload.status === 'completed') {
          button.closest('li')?.classList.add('attune-linear-completed');
          button.textContent = 'Completed';
          button.setAttribute('aria-label', issue.key + ' is completed');
          return;
        }
        throw new Error(result.payload.message || 'Linear could not complete this issue.');
      }
      throw new Error('Timed out waiting for Linear. Keep Linear open and try again.');
    } catch (error) {
      button.disabled = false; button.textContent = 'Complete';
      const subtitle = button.closest('[role="document"]')?.querySelector('header span');
      if (subtitle) subtitle.textContent = error instanceof Error ? error.message : 'Unable to complete this issue.';
    }
  };
  const openIssue = async (issue) => {
    closeIssue(false);
    const modal = document.createElement('div');
    modal.id = 'attune-codex-linear-issue-modal';
    modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = '<section role="document"><div class="attune-linear-issue-copy"><p class="attune-linear-issue-key">' + escapeHtml(issue.key) + '</p><h2>' + escapeHtml(issue.title) + '</h2><p data-details>Loading issue details from Linear…</p><div data-priority></div></div><footer><button type="button" data-close>Close</button><button type="button" data-complete>Complete</button><button type="button" data-focus>Open in Linear</button></footer></section>';
    modal.addEventListener('click', (event) => { if (event.target === modal) closeIssue(); });
    modal.querySelector('[data-close]')?.addEventListener('click', closeIssue);
    modal.querySelector('[data-complete]')?.addEventListener('click', () => void complete(modal.querySelector('[data-complete]'), issue));
    modal.querySelector('[data-focus]')?.addEventListener('click', () => { document.documentElement.dataset.attuneLinearTodosAction = JSON.stringify({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), key: issue.key, type: 'focus' }); });
    document.body.append(modal);
    modal.querySelector('[data-complete]')?.focus();
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    document.documentElement.dataset.attuneLinearTodosAction = JSON.stringify({ id, key: issue.key, href: issue.href, type: 'details' });
    for (let attempt = 0; attempt < 18; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const result = window.__attuneWorkspaceBridge?.['linear-todos-details'];
      if (result?.payload?.id !== id) continue;
      const details = modal.querySelector('[data-details]');
      if (!details) return;
      details.textContent = result.payload.status === 'ready' ? result.payload.details : (result.payload.message || 'Unable to load the Linear issue.');
      details.style.whiteSpace = 'pre-wrap';
      const priority = modal.querySelector('[data-priority]');
      if (priority && result.payload.status === 'ready') {
        priority.innerHTML = '<p class="attune-linear-issue-key">Priority · ' + escapeHtml(result.payload.priority || 'No priority') + '</p><div>' + ['No priority', 'Urgent', 'High', 'Medium', 'Low'].map((value) => '<button type="button" data-priority="' + value + '"' + (value === (result.payload.priority || 'No priority') ? ' aria-pressed="true"' : '') + '>' + value + '</button>').join('') + '</div>';
        priority.querySelectorAll('[data-priority]').forEach((button) => button.addEventListener('click', async () => { const value = button.dataset.priority; const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7); button.disabled = true; document.documentElement.dataset.attuneLinearTodosAction = JSON.stringify({ id, key: issue.key, type: 'priority', value }); for (let attempt = 0; attempt < 16; attempt += 1) { await new Promise((resolve) => setTimeout(resolve, 500)); const response = window.__attuneWorkspaceBridge?.['linear-todos-details']; if (response?.payload?.id !== id) continue; button.disabled = false; if (response.payload.status === 'ready') { priority.querySelector('.attune-linear-issue-key').textContent = 'Priority · ' + (response.payload.priority || value); priority.querySelectorAll('[data-priority]').forEach((choice) => choice.setAttribute('aria-pressed', String(choice.dataset.priority === response.payload.priority))); } return; } button.disabled = false; }));
      }
      return;
    }
    const details = modal.querySelector('[data-details]');
    if (details) details.textContent = 'Timed out waiting for Linear. Keep Linear open and try again.';
  };
  const refresh = async () => {
    const modal = document.getElementById('attune-codex-linear-todos-modal');
    if (!modal) return;
    const { issues, updatedAt } = await readTodos();
    if (modal.dataset.updatedAt === (updatedAt || '')) return;
    modal.dataset.updatedAt = updatedAt || '';
    const list = modal.querySelector('#attune-codex-linear-todos-list');
    const listWrap = modal.querySelector('#attune-codex-linear-todos-list-wrap');
    list.innerHTML = issues.length
      ? issues.map((issue, index) => { const status = String(issue.workflowState || '').trim(); const statusKey = status.toLowerCase().replace(/\\s+/g, '-'); const meta = '<strong>' + escapeHtml(issue.key) + (status ? '<em class="attune-linear-status" data-status="' + escapeHtml(statusKey) + '">' + escapeHtml(status) + '</em>' : '') + '</strong>'; return '<li><button type="button" data-index="' + index + '">' + meta + '<span>' + escapeHtml(issue.title) + '</span></button></li>'; }).join('')
      : '<li id="attune-codex-linear-todos-empty">No tasks yet. Open Linear on your to-do view to load tasks.</li>';
    const syncListScrollbar = () => {
      if (!list || !listWrap) return;
      const maximum = Math.max(0, list.scrollHeight - list.clientHeight);
      const scrollable = maximum > 1;
      listWrap.dataset.scrollable = String(scrollable);
      if (!scrollable) return;
      const thumb = Math.max(28, Math.round((list.clientHeight * list.clientHeight) / list.scrollHeight));
      const track = Math.max(0, list.clientHeight - thumb - 16);
      const offset = maximum ? Math.round((list.scrollTop / maximum) * track) : 0;
      listWrap.style.setProperty('--attune-linear-scroll-thumb-size', thumb + 'px');
      listWrap.style.setProperty('--attune-linear-scroll-thumb-offset', offset + 'px');
    };
    list.onscroll = syncListScrollbar;
    requestAnimationFrame(syncListScrollbar);
    list.querySelectorAll('button[data-index]').forEach((button) => button.addEventListener('click', () => openIssue(issues[Number(button.dataset.index)])));
  };
  const open = async () => {
    if (document.getElementById('attune-codex-linear-todos-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'attune-codex-linear-todos-modal';
    modal.setAttribute('aria-labelledby', 'attune-codex-linear-todos-title');
    modal.dataset.expanded = 'false';
    modal.innerHTML = '<section role="document"><header><h2 id="attune-codex-linear-todos-title"><img id="attune-codex-linear-todos-logo" src="${LINEAR_DARK_LOGO_DATA_URI}" alt="" />Tasks</h2><button type="button" data-expand aria-label="Show tasks" aria-expanded="false">+</button></header><div id="attune-codex-linear-todos-list-wrap"><ol id="attune-codex-linear-todos-list"></ol><i id="attune-codex-linear-todos-list-scrollbar" aria-hidden="true"></i></div></section>';
    modal.querySelector('[data-expand]')?.addEventListener('click', (event) => { const expanded = modal.dataset.expanded !== 'true'; modal.dataset.expanded = String(expanded); event.currentTarget.textContent = expanded ? '−' : '+'; event.currentTarget.setAttribute('aria-expanded', String(expanded)); });
    document.body.append(modal);
    modal.querySelector('button')?.focus();
    await refresh();
  };
  const render = () => {
    void open();
  };
  const onKeydown = (event) => { if (event.key === 'Escape') { if (document.getElementById('attune-codex-linear-issue-modal')) closeIssue(); else close(); } };
  render(); document.addEventListener('keydown', onKeydown);
  clearInterval(window.__attuneCodexLinearTodosRefresh);
  window.__attuneCodexLinearTodosRefresh = setInterval(() => void refresh(), 1500);
  const cleanup = () => { document.removeEventListener('keydown', onKeydown); clearInterval(window.__attuneCodexLinearTodosRefresh); document.getElementById('attune-codex-linear-todos-modal')?.remove(); closeIssue(); };
  window.__attuneCodexLinearTodosCleanup = cleanup;
  window.__attuneRegisterCleanup?.(cleanup);
})();
@end-attune-script */
`;
const CODEX_LINEAR_TODOS_CODEX_CSS = `${CODEX_LINEAR_TODOS_CSS}

/* Codex has a wider persistent navigation rail than Cursor. */
#attune-codex-linear-todos-trigger { top: 60px; left: 324px; box-shadow: none; }
#attune-codex-linear-todos-modal { top: 60px; left: 324px; }
#attune-codex-linear-todos-modal [role="document"] { box-shadow: none; }
`;
const CURSOR_LINEAR_TODOS_CSS = `${CODEX_LINEAR_TODOS_CSS}

/* Cursor's workbench heading rule is heavier than the matching Codex title. */
#attune-codex-linear-todos-modal h2 {
  font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
  font-size: 14px !important;
  font-weight: 400 !important;
  line-height: 1.2 !important;
  letter-spacing: normal !important;
}
#attune-codex-linear-todos-logo { vertical-align: middle; }

/* The dedicated Cursor Agents window exposes an IDE switch; regular IDE windows do not. */
body:not(:has(button[aria-label="IDE"])) #attune-codex-linear-todos-trigger,
body:not(:has(button[aria-label="IDE"])) #attune-codex-linear-todos-modal {
  display: none !important;
}
`;
const CODEX_YOUTUBE_PREVIEW_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 600" role="img" aria-label="YouTube in Codex attunement preview">
  <rect width="960" height="600" fill="#111315"/>
  <rect x="34" y="30" width="892" height="540" rx="14" fill="#1b1e22" stroke="#353a40" stroke-width="2"/>
  <rect x="34" y="30" width="892" height="48" rx="14" fill="#24282d"/>
  <circle cx="64" cy="54" r="8" fill="#ff5f57"/><circle cx="88" cy="54" r="8" fill="#febc2e"/><circle cx="112" cy="54" r="8" fill="#28c840"/>
  <rect x="66" y="108" width="318" height="21" rx="4" fill="#dce2e9"/><rect x="66" y="150" width="432" height="14" rx="3" fill="#7f8995"/><rect x="66" y="180" width="340" height="14" rx="3" fill="#59636e"/>
  <rect x="516" y="108" width="368" height="344" rx="8" fill="#08090b" stroke="#464c55" stroke-width="2"/>
  <path d="M650 195c0-14 15-23 27-15l93 54c12 7 12 23 0 30l-93 54c-12 8-27-1-27-15z" fill="#ff3434"/>
  <path d="M695 214l43 35-43 35z" fill="white"/>
  <rect x="538" y="474" width="222" height="16" rx="4" fill="#e5e9ee"/><rect x="538" y="506" width="286" height="12" rx="3" fill="#77818e"/>
  <rect x="66" y="282" width="368" height="112" rx="8" fill="#24282d" stroke="#363c44"/><rect x="86" y="307" width="146" height="14" rx="3" fill="#c9d1d9"/><rect x="86" y="338" width="295" height="11" rx="3" fill="#65707c"/>
</svg>
`;
const CODEX_YOUTUBE_SOURCE_CSS = `/* Attune managed: codex-youtube-player source */
/* @attune-script
(() => {
  const bridgeUrl = 'http://127.0.0.1:47655/v1/youtube-now-playing';
  let lastSignature = '';
  let lastPublishedAt = 0;

  const videoIdFromUrl = (url) => {
    try {
      const parsed = new URL(url);
      if (!/(^|\\.)youtube\\.com$|(^|\\.)youtu\\.be$/i.test(parsed.hostname)) return null;
      if (parsed.hostname.endsWith('youtu.be')) return parsed.pathname.split('/').filter(Boolean)[0] || null;
      if (parsed.pathname === '/watch') return parsed.searchParams.get('v');
      const parts = parsed.pathname.split('/').filter(Boolean);
      return ['shorts', 'live', 'embed'].includes(parts[0]) ? parts[1] || null : null;
    } catch { return null; }
  };
  const publish = (payload) => fetch(bridgeUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  }).catch(() => {});
  const collect = () => {
    const videoId = videoIdFromUrl(location.href);
    if (!videoId) return;
    const video = document.querySelector('video');
    const currentTime = Number.isFinite(video?.currentTime) ? video.currentTime : 0;
    const payload = {
      videoUrl: location.href,
      videoId,
      title: (document.querySelector('h1 yt-formatted-string')?.textContent || document.title || 'YouTube video').trim(),
      currentTime,
      isPlaying: Boolean(video && !video.paused && !video.ended),
    };
    const signature = videoId + ':' + Math.floor(currentTime) + ':' + payload.isPlaying;
    if (signature !== lastSignature || Date.now() - lastPublishedAt > 3000) {
      publish(payload);
      lastPublishedAt = Date.now();
    }
    lastSignature = signature;
  };
  clearInterval(window.__attuneYoutubeSourceInterval);
  window.__attuneYoutubeSourceInterval = setInterval(collect, 1000);
  collect();
  const cleanup = () => {
    clearInterval(window.__attuneYoutubeSourceInterval);
  };
  window.__attuneYoutubeSourceCleanup = cleanup;
  window.__attuneRegisterCleanup?.(cleanup);
})();
@end-attune-script */
`;
const CODEX_YOUTUBE_PLAYER_CSS = `/* Attune managed: codex-youtube-player */
#attune-codex-youtube-player { position: fixed; right: 18px; bottom: 18px; z-index: 2147483647; width: min(440px, calc(100vw - 36px)); overflow: hidden; border: 1px solid color-mix(in srgb, CanvasText 20%, transparent); border-radius: 10px; background: color-mix(in srgb, Canvas 94%, CanvasText 6%); color: CanvasText; box-shadow: 0 20px 60px rgb(0 0 0 / 38%); font: 12px/1.35 ui-sans-serif, system-ui, sans-serif; }
#attune-codex-youtube-player header { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; border-bottom: 1px solid color-mix(in srgb, CanvasText 14%, transparent); }
#attune-codex-youtube-player strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#attune-codex-youtube-player .attune-youtube-status { color: color-mix(in srgb, CanvasText 62%, transparent); white-space: nowrap; }
#attune-codex-youtube-player iframe { display: block; width: 100%; aspect-ratio: 16 / 9; border: 0; background: #000; }
#attune-codex-youtube-player footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 9px 12px; }
#attune-codex-youtube-player button, #attune-codex-youtube-player a { appearance: none; border: 0; border-radius: 5px; padding: 6px 8px; background: color-mix(in srgb, CanvasText 11%, transparent); color: CanvasText; cursor: pointer; font: inherit; text-decoration: none; }
#attune-codex-youtube-player button:hover, #attune-codex-youtube-player a:hover { background: color-mix(in srgb, CanvasText 18%, transparent); }

/* @attune-script
(() => {
  const validVideoId = (value) => /^[A-Za-z0-9_-]{6,}$/.test(value || '') ? value : null;
  let shownVideoId = null;

  const remove = () => document.getElementById('attune-codex-youtube-player')?.remove();
  const render = (state) => {
    const payload = state?.payload;
    const videoId = validVideoId(payload?.videoId);
    const updatedAt = Date.parse(state?.updatedAt || '');
    if (!videoId || !Number.isFinite(updatedAt) || Date.now() - updatedAt > 8000) { remove(); shownVideoId = null; return; }
    let root = document.getElementById('attune-codex-youtube-player');
    const seconds = Math.max(0, Math.floor(Number(payload.currentTime) || 0));
    const label = payload.isPlaying ? 'Playing in Chrome' : 'Paused in Chrome';
    if (!root || shownVideoId !== videoId) {
      root?.remove();
      root = document.createElement('aside');
      root.id = 'attune-codex-youtube-player';
      root.setAttribute('aria-label', 'YouTube player from Google Chrome');
      root.innerHTML = '<header><strong></strong><span class="attune-youtube-status"></span></header><iframe allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen title="YouTube video"></iframe><footer><button type="button">Sync to Chrome</button><a target="_blank" rel="noreferrer">Open in YouTube</a></footer>';
      document.body.append(root);
      shownVideoId = videoId;
    }
    root.querySelector('strong').textContent = payload.title || 'YouTube video';
    root.querySelector('.attune-youtube-status').textContent = label;
    const iframe = root.querySelector('iframe');
    const embedUrl = 'https://www.youtube-nocookie.com/embed/' + videoId + '?rel=0&start=' + seconds;
    if (!iframe.getAttribute('src')) iframe.src = embedUrl;
    const link = root.querySelector('a');
    link.href = payload.videoUrl || 'https://www.youtube.com/watch?v=' + videoId;
    root.querySelector('button').onclick = () => { iframe.src = embedUrl; };
  };
  const refresh = () => {
    render(window.__attuneWorkspaceBridge?.['youtube-now-playing'] || null);
  };
  window.__attuneCodexYoutubeRefresh = refresh;
  clearInterval(window.__attuneCodexYoutubeInterval);
  window.__attuneCodexYoutubeInterval = setInterval(refresh, 1000);
  refresh();
  const cleanup = () => { clearInterval(window.__attuneCodexYoutubeInterval); remove(); };
  window.__attuneCodexYoutubeCleanup = cleanup;
  window.__attuneRegisterCleanup?.(cleanup);
})();
@end-attune-script */
`;
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
  startAutoWrapMonitor();
  startLinearTodosBridge();
  void reapplyEnabledStylesheets();
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

function startLinearTodosBridge(): void {
  linearTodosBridgeTimer ??= setInterval(() => void refreshLinearTodosBridge(), 2000);
  void refreshLinearTodosBridge();
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
    mkdirSync(dirname(bridgePath), { recursive: true });
    writeFileSync(bridgePath, JSON.stringify(store, null, 2));
    await Promise.all([
      pushLinearTodosToApp(sessionModule, 'Codex', next, store[LINEAR_TODOS_COMPLETION_BRIDGE_KEY] ?? null, store['linear-todos-details'] ?? null),
      pushLinearTodosToApp(sessionModule, 'Cursor', next, store[LINEAR_TODOS_COMPLETION_BRIDGE_KEY] ?? null, store['linear-todos-details'] ?? null),
    ]);
  } catch {}
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

  seedCodexGitActionsAttunement(workspacesRoot);
  seedBlueMessagesAttunement(workspacesRoot);
  seedCodexYouTubeAttunement(workspacesRoot);
  seedCodexLinearTodosAttunement(workspacesRoot);
  seedCursorLinearTodosAttunement(workspacesRoot);
  return workspacesRoot;
}

function seedCodexGitActionsAttunement(workspacesRoot: string): void {
  const attunementRoot = join(workspacesRoot, CODEX_GIT_ACTIONS_ATTUNEMENT_ID);
  const appsRoot = join(attunementRoot, 'apps');
  mkdirSync(appsRoot, { recursive: true });

  const manifestPath = join(attunementRoot, 'manifest.json');
  if (!existsSync(manifestPath) || readFileSync(manifestPath, 'utf8').includes('"name": "Codex Git Actions"')) {
    writeFileSync(manifestPath, CODEX_GIT_ACTIONS_MANIFEST);
  }

  const previewPath = join(attunementRoot, 'preview.png');
  const bundledPreviewPath = join(__dirname, 'assets', 'codex-commit-push-preview.png');
  if (!existsSync(previewPath) && existsSync(bundledPreviewPath)) {
    copyFileSync(bundledPreviewPath, previewPath);
  }
  const stylesheetPath = join(appsRoot, 'chatgpt-git-actions.css');
  if (!existsSync(stylesheetPath) || readFileSync(stylesheetPath, 'utf8').includes('/* Attune managed: codex-git-actions') || readFileSync(stylesheetPath, 'utf8').includes('/* Codex Git Actions:')) {
    writeFileSync(stylesheetPath, CODEX_GIT_ACTIONS_CSS);
  }
}

function seedBlueMessagesAttunement(workspacesRoot: string): void {
  const attunementRoot = join(workspacesRoot, BLUE_MESSAGES_ATTUNEMENT_ID);
  const appsRoot = join(attunementRoot, 'apps');
  mkdirSync(appsRoot, { recursive: true });

  const manifestPath = join(attunementRoot, 'manifest.json');
  if (!existsSync(manifestPath) || readFileSync(manifestPath, 'utf8').includes('"name": "Blue messages"')) {
    writeFileSync(manifestPath, BLUE_MESSAGES_MANIFEST);
  }
  const previewPath = join(attunementRoot, 'preview.png');
  const bundledPreviewPath = join(__dirname, 'assets', 'codex-blue-messages-preview.png');
  if (!existsSync(previewPath) && existsSync(bundledPreviewPath)) {
    copyFileSync(bundledPreviewPath, previewPath);
  }

  const stylesheetPath = join(appsRoot, 'chatgpt-blue-messages.css');
  if (!existsSync(stylesheetPath) || readFileSync(stylesheetPath, 'utf8').includes('/* Attune managed: blue-messages */')) {
    writeFileSync(stylesheetPath, BLUE_MESSAGES_CSS);
  }
}

function seedCodexYouTubeAttunement(workspacesRoot: string): void {
  const attunementRoot = join(workspacesRoot, CODEX_YOUTUBE_ATTUNEMENT_ID);
  const appsRoot = join(attunementRoot, 'apps');
  mkdirSync(appsRoot, { recursive: true });

  const manifestPath = join(attunementRoot, 'manifest.json');
  if (!existsSync(manifestPath) || readFileSync(manifestPath, 'utf8').includes('"name": "YouTube in Codex"')) {
    writeFileSync(manifestPath, CODEX_YOUTUBE_MANIFEST);
  }
  writeSeedFile(join(attunementRoot, 'preview.svg'), CODEX_YOUTUBE_PREVIEW_SVG);

  const chromePatch = join(appsRoot, 'chrome-youtube-source.css');
  if (!existsSync(chromePatch) || readFileSync(chromePatch, 'utf8').includes('/* Attune managed: codex-youtube-player source */')) {
    writeFileSync(chromePatch, CODEX_YOUTUBE_SOURCE_CSS);
  }
  const codexPatch = join(appsRoot, 'codex-youtube-player.css');
  if (!existsSync(codexPatch) || readFileSync(codexPatch, 'utf8').includes('/* Attune managed: codex-youtube-player */')) {
    writeFileSync(codexPatch, CODEX_YOUTUBE_PLAYER_CSS);
  }
}

function seedCodexLinearTodosAttunement(workspacesRoot: string): void {
  const attunementRoot = join(workspacesRoot, CODEX_LINEAR_TODOS_ATTUNEMENT_ID);
  const appsRoot = join(attunementRoot, 'apps');
  mkdirSync(appsRoot, { recursive: true });

  const manifestPath = join(attunementRoot, 'manifest.json');
  if (!existsSync(manifestPath)
    || readFileSync(manifestPath, 'utf8').includes('"name": "Linear To-dos in Codex"')
    || readFileSync(manifestPath, 'utf8').includes('"preview": "preview.svg"')) {
    writeFileSync(manifestPath, CODEX_LINEAR_TODOS_MANIFEST);
  }
  const previewPath = join(attunementRoot, 'preview.png');
  if (existsSync(CODEX_LINEAR_TODOS_PREVIEW_SOURCE_PATH)) {
    copyFileSync(CODEX_LINEAR_TODOS_PREVIEW_SOURCE_PATH, previewPath);
  }
  writeSeedFile(join(attunementRoot, 'preview.svg'), CODEX_LINEAR_TODOS_PREVIEW_SVG);

  const linearPatch = join(appsRoot, 'linear-todos-source.css');
  if (!existsSync(linearPatch) || readFileSync(linearPatch, 'utf8').includes('/* Attune managed: codex-linear-todos source */')) {
    writeFileSync(linearPatch, CODEX_LINEAR_TODOS_SOURCE_CSS);
  }
  const codexPatch = join(appsRoot, 'codex-linear-todos.css');
  if (!existsSync(codexPatch) || readFileSync(codexPatch, 'utf8').includes('/* Attune managed: codex-linear-todos */')) {
    writeFileSync(codexPatch, CODEX_LINEAR_TODOS_CODEX_CSS);
  }
}

function seedCursorLinearTodosAttunement(workspacesRoot: string): void {
  const attunementRoot = join(workspacesRoot, CURSOR_LINEAR_TODOS_ATTUNEMENT_ID);
  const appsRoot = join(attunementRoot, 'apps');
  mkdirSync(appsRoot, { recursive: true });

  const manifestPath = join(attunementRoot, 'manifest.json');
  if (!existsSync(manifestPath) || readFileSync(manifestPath, 'utf8').includes('"name": "Linear To-dos in Cursor"')) {
    writeFileSync(manifestPath, CURSOR_LINEAR_TODOS_MANIFEST);
  }
  const previewPath = join(attunementRoot, 'preview.png');
  if (existsSync(CURSOR_LINEAR_TODOS_PREVIEW_SOURCE_PATH)) {
    copyFileSync(CURSOR_LINEAR_TODOS_PREVIEW_SOURCE_PATH, previewPath);
  }
  writeSeedFile(join(attunementRoot, 'preview.svg'), CODEX_LINEAR_TODOS_PREVIEW_SVG);

  const linearPatch = join(appsRoot, 'linear-todos-source.css');
  if (!existsSync(linearPatch) || readFileSync(linearPatch, 'utf8').includes('/* Attune managed: codex-linear-todos source */')) {
    writeFileSync(linearPatch, CODEX_LINEAR_TODOS_SOURCE_CSS);
  }
  const cursorPatch = join(appsRoot, 'cursor-linear-todos.css');
  if (!existsSync(cursorPatch) || readFileSync(cursorPatch, 'utf8').includes('/* Attune managed: codex-linear-todos */')) {
    writeFileSync(cursorPatch, CURSOR_LINEAR_TODOS_CSS);
  }
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

  for (const target of discoveredApps.filter((candidate) => changedAppIds.has(candidate.appId))) {
    applyCompositeStylesheet(target.appId, target.appInfo.name, configModule, themes, workspaces, newProfile);
    if (enabled && newProfile.enabledWorkspaceAppIds.includes(target.appId)) {
      await attachRunningSessionIfAvailable(target.appInfo, target.appId, environment, scanModule);
    }
  }

  writeProfile(newProfile);
  void runAutoWrapPass();

  if (!enabled) return `${workspace.name} attunement disabled.`;
  if (targetApps.length === 0) {
    return `${workspace.name} attunement enabled, but no matching apps were found.`;
  }
  const appNames = targetApps.map((target) => target.appInfo.name).join(', ');
  return `${workspace.name} attunement enabled for ${appNames}. Launch or reopen those apps to see it.`;
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
  if (enabled) {
    await attachRunningSessionIfAvailable(appInfo, appId, environment, scanModule);
    void runAutoWrapPass();
  }

  return enabled ? `${workspace.name} attunement enabled for ${appInfo.name}.` : `${workspace.name} attunement disabled for ${appInfo.name}.`;
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
    preview?: string;
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
    previewDataUrl: readWorkspacePreviewDataUrl(pathBase, workspaceDirectory, manifest.preview),
    patches,
  };
}

function readWorkspacePreviewDataUrl(
  pathBase: string,
  workspaceDirectory: string,
  previewPathValue: string | undefined,
): string | null {
  const candidates = previewPathValue
    ? [resolveThemePath(pathBase, workspaceDirectory, previewPathValue)]
    : ['preview.png', 'preview.jpg', 'preview.jpeg', 'preview.webp', 'preview.svg']
      .map((fileName) => join(workspaceDirectory, fileName));

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
    if (isCursorApp(appName)) parts.push(CURSOR_ICON_FONT_GUARD);
    sourcePaths.push(themeStylesheet.path);
  }

  if (profile.workspaceEnabled && profile.enabledWorkspaceAppIds.includes(appId)) {
    const activeWorkspaces = workspaces.filter((workspace) => profile.enabledWorkspaceIds.includes(workspace.id));
    const includedWorkspaceSources = new Set<string>();
    for (const workspace of activeWorkspaces) {
      const patch = findMatchingWorkspacePatch(workspace, appName);
      if (!patch?.absolutePath) continue;
      const source = readWorkspaceCssSource(patch.absolutePath);
      const sourceSignature = `${patch.appName}\u0000${source}`;
      if (includedWorkspaceSources.has(sourceSignature)) continue;
      includedWorkspaceSources.add(sourceSignature);
      parts.push([
        `/* Attunement ${workspace.id}: ${patch.appName}. */`,
        source,
      ].join('\n'));
      sourcePaths.push(patch.absolutePath);
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
