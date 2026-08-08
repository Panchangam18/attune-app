import { useEffect, useMemo, useState } from 'react';
import {
  AppWindow,
  Check,
  CirclePause,
  CirclePlay,
  CircleAlert,
  Copy,
  FolderOpen,
  LayoutPanelLeft,
  Loader2,
  Plus,
  RefreshCw,
  Settings,
  X,
} from 'lucide-react';
import chatgptIcon from './assets/apps/chatgpt.png';
import slackIcon from './assets/apps/slack.png';
import spotifyIcon from './assets/apps/spotify.png';
import vscodeIcon from './assets/apps/vscode.png';
import type { ActionResult, AttuneAppInfo, Snapshot, ThemeInfo, WorkspaceInfo } from './vite-env';

type BusyAction =
  | 'refresh'
  | 'build'
  | 'profile'
  | 'workspace'
  | 'wallpaper'
  | `agent-integration:${string}`
  | 'open-workspaces'
  | `profile-app:${string}`
  | `workspace-app:${string}`;

const statusLabels: Record<AttuneAppInfo['status'], string> = {
  attached: 'Open',
  starting: 'Starting',
  waiting: 'Waiting',
  stopped: 'Stopped',
  none: 'Ready',
};
const TEMPORARILY_HIDDEN_ATTUNEMENT_IDS = new Set<string>(['codex-youtube-player']);

export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [selectedThemeId, setSelectedThemeId] = useState<string | null | undefined>(undefined);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null | undefined>(undefined);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addThemeOpen, setAddThemeOpen] = useState(false);
  const [addWorkspaceOpen, setAddWorkspaceOpen] = useState(false);
  const [themePromptCopied, setThemePromptCopied] = useState(false);
  const [workspacePromptCopied, setWorkspacePromptCopied] = useState(false);
  const [busy, setBusy] = useState<BusyAction | null>(null);
  const [notice, setNotice] = useState<{ kind: 'good' | 'bad' | 'info'; text: string } | null>(null);

  const selectedTheme = useMemo(() => (
    snapshot?.themes.find((theme) => theme.id === selectedThemeId) ?? null
  ), [selectedThemeId, snapshot?.themes]);
  const selectedWorkspace = useMemo(() => (
    snapshot?.workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null
  ), [selectedWorkspaceId, snapshot?.workspaces]);
  const addThemePrompt = useMemo(
    () => buildAddThemePrompt(
      snapshot?.environment.userThemesRoot,
      snapshot?.environment.nodePath,
      snapshot?.environment.cliPath,
    ),
    [
      snapshot?.environment.userThemesRoot,
      snapshot?.environment.nodePath,
      snapshot?.environment.cliPath,
    ],
  );
  const addWorkspacePrompt = useMemo(
    () => buildAddWorkspacePrompt(
      snapshot?.environment.userWorkspacesRoot,
      snapshot?.environment.nodePath,
      snapshot?.environment.cliPath,
    ),
    [
      snapshot?.environment.userWorkspacesRoot,
      snapshot?.environment.nodePath,
      snapshot?.environment.cliPath,
    ],
  );

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (selectedThemeId === undefined && snapshot) {
      setSelectedThemeId(snapshot.profile.enabled ? snapshot.profile.activeThemeId : null);
    }
  }, [selectedThemeId, snapshot]);

  useEffect(() => {
    if (!snapshot) return;
    const activeWorkspaceId = snapshot.profile.workspaceEnabled ? snapshot.profile.activeWorkspaceId : null;
    if (selectedWorkspaceId !== activeWorkspaceId) setSelectedWorkspaceId(activeWorkspaceId);
  }, [selectedWorkspaceId, snapshot]);

  async function refresh() {
    setBusy('refresh');
    try {
      const result = await withTimeout(window.attune.snapshot(), 8000, 'Refresh timed out while reading Attune state.');
      if (result.ok && result.data) {
        setSnapshot(result.data);
        setNotice(null);
      } else {
        setNotice({ kind: 'bad', text: result.message ?? 'Unable to read Attune state.' });
      }
    } catch (error) {
      setNotice({ kind: 'bad', text: error instanceof Error ? error.message : 'Unable to refresh Attune state.' });
    }
    setBusy(null);
  }

  async function refreshThemes() {
    await runAction('refresh', () => window.attune.refreshThemes(), true, false);
  }

  async function refreshWorkspaces() {
    await runAction('refresh', () => window.attune.refreshWorkspaces(), true, false);
  }

  async function runAction<T>(
    action: BusyAction,
    operation: () => Promise<ActionResult<T>>,
    refreshAfter = true,
    notifySuccess = true,
  ) {
    setBusy(action);
    try {
      const result = await withTimeout(operation(), 20000, 'Action timed out.');
      if (result.ok) {
        if (notifySuccess) setNotice({ kind: 'good', text: String(result.data ?? 'Done.') });
        if (refreshAfter) await refresh();
      } else {
        setNotice({ kind: 'bad', text: result.message ?? 'Something went wrong.' });
      }
    } catch (error) {
      setNotice({ kind: 'bad', text: error instanceof Error ? error.message : 'Action failed.' });
    }
    setBusy(null);
  }

  async function copyAddThemePrompt() {
    try {
      await navigator.clipboard.writeText(addThemePrompt);
      setThemePromptCopied(true);
    } catch {
      setNotice({ kind: 'bad', text: 'Unable to copy. Select the prompt text instead.' });
    }
  }

  async function copyAddWorkspacePrompt() {
    try {
      await navigator.clipboard.writeText(addWorkspacePrompt);
      setWorkspacePromptCopied(true);
    } catch {
      setNotice({ kind: 'bad', text: 'Unable to copy. Select the prompt text instead.' });
    }
  }

  const runtimeReady = snapshot?.environment.runtimeBuilt ?? false;
  const wallpaperEnabled = snapshot?.profile.wallpaperEnabled ?? true;
  const visibleApps = useMemo(() => (
    [...(snapshot?.apps ?? [])].sort((left, right) => {
      const leftInThemeScope = selectedTheme !== null && left.targetProfileApp;
      const rightInThemeScope = selectedTheme !== null && right.targetProfileApp;
      if (leftInThemeScope !== rightInThemeScope) return leftInThemeScope ? -1 : 1;
      const leftInWorkspaceScope = selectedWorkspace !== null && left.targetWorkspaceApp;
      const rightInWorkspaceScope = selectedWorkspace !== null && right.targetWorkspaceApp;
      if (leftInWorkspaceScope !== rightInWorkspaceScope) return leftInWorkspaceScope ? -1 : 1;
      return left.name.localeCompare(right.name);
    })
  ), [selectedTheme, selectedWorkspace, snapshot?.apps]);
  const visibleWorkspaces = useMemo(
    () => snapshot?.workspaces.filter((workspace) => !TEMPORARILY_HIDDEN_ATTUNEMENT_IDS.has(workspace.id)) ?? [],
    [snapshot?.workspaces],
  );

  return (
    <main className="shell">
      <div className="window-drag-zone" aria-hidden="true" />
      <section className={`workspace theme-${selectedTheme?.id ?? 'default'}`}>
        <header className="toolbar">
          <h1>Tis a good day to <span className="attune-word">Attune</span></h1>
          <button
            className={settingsOpen ? 'icon-button settings-trigger active' : 'icon-button settings-trigger'}
            type="button"
            title="Settings"
            aria-label="Settings"
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen((open) => !open)}
          >
            <Settings size={18} />
          </button>
        </header>

        {settingsOpen && (
          <section className="settings-panel" aria-label="Settings">
            <label className="setting-row">
              <span>Change desktop wallpaper with themes</span>
              <input
                className="wallpaper-toggle"
                type="checkbox"
                checked={wallpaperEnabled}
                disabled={busy !== null}
                onChange={(event) => runAction('wallpaper', () => window.attune.setWallpaperEnabled(event.target.checked), true, false)}
              />
            </label>
            <div className="setting-group">
              <div className="setting-group-heading">
                <span>Coding agent integrations</span>
                <small>Changes apply to new agent sessions.</small>
              </div>
              {snapshot?.agentIntegrations.map((integration) => (
                <label className="setting-row setting-agent" key={integration.id}>
                  <span>
                    {integration.name}
                    {integration.conflict && <small>A user-managed Attune skill already exists.</small>}
                  </span>
                  <input
                    className="wallpaper-toggle"
                    type="checkbox"
                    checked={integration.installed}
                    disabled={busy !== null || integration.conflict}
                    aria-label={`Make Attune available to ${integration.name}`}
                    onChange={(event) => runAction(
                      `agent-integration:${integration.id}`,
                      () => window.attune.setAgentIntegration(integration.id, event.target.checked),
                    )}
                  />
                </label>
              ))}
            </div>
            <button
              className="setting-row setting-action"
              type="button"
              disabled={busy !== null || !snapshot?.environment.userWorkspacesRoot}
              onClick={() => runAction(
                'open-workspaces',
                () => window.attune.openPath(snapshot?.environment.userWorkspacesRoot ?? ''),
                false,
                false,
              )}
            >
              <span>Open attunements folder</span>
              <FolderOpen size={16} />
            </button>
          </section>
        )}

        {notice && (
          <div className={`notice ${notice.kind}`}>
            {notice.kind === 'bad' ? <CircleAlert size={17} /> : <Check size={17} />}
            <span>{notice.text}</span>
          </div>
        )}

        {!runtimeReady && (
          <div className="loading-state" role="status" aria-label="Loading">
            <Loader2 className="loading-spinner spin" size={32} aria-hidden="true" />
          </div>
        )}

        {runtimeReady && snapshot && (
          <>
            <section className="themes-overview">
              <h2>Themes</h2>
              <div className="theme-gallery">
                {snapshot.themes.map((theme) => (
                  <ThemeCard
                    key={theme.id}
                    theme={theme}
                    selected={theme.id === selectedThemeId}
                    disabled={busy !== null}
                    onSelect={() => {
                      const enabled = theme.id !== selectedThemeId;
                      setSelectedThemeId(enabled ? theme.id : null);
                      void runAction('profile', () => window.attune.setProfileEnabled(theme.id, enabled), true, false);
                    }}
                  />
                ))}
                <AddThemeCard
                  onOpen={() => {
                    setThemePromptCopied(false);
                    setAddThemeOpen(true);
                  }}
                />
              </div>
            </section>

            <section className="workspaces-overview">
              <h2>Attunements</h2>
              <div className="workspace-gallery">
                {visibleWorkspaces.map((workspace) => (
                  <WorkspaceCard
                    key={workspace.id}
                    workspace={workspace}
                    selected={snapshot.profile.enabledWorkspaceIds.includes(workspace.id)}
                    disabled={busy !== null}
                    onSelect={() => {
                      const enabled = !snapshot.profile.enabledWorkspaceIds.includes(workspace.id);
                      setSelectedWorkspaceId(enabled ? workspace.id : null);
                      void runAction('workspace', () => window.attune.setWorkspaceEnabled(workspace.id, enabled), true, true);
                    }}
                  />
                ))}
                <AddWorkspaceCard
                  onOpen={() => {
                    setWorkspacePromptCopied(false);
                    setAddWorkspaceOpen(true);
                  }}
                />
              </div>
            </section>

            <section className="apps-section">
              <div className="section-head">
                <h2>Applications</h2>
              </div>

              {visibleApps.length === 0 ? (
                <div className="empty-row"><AppWindow size={20} /> No matching applications found</div>
              ) : (
                <div className="app-table">
                  {visibleApps.map((appInfo) => (
                    <AppRow
                      key={appInfo.id}
                      appInfo={appInfo}
                      busy={busy}
                      themeActive={selectedTheme !== null && appInfo.targetProfileApp}
                      workspaceActive={selectedWorkspace !== null && appInfo.targetWorkspaceApp}
                      onToggleTheme={(appId, enabled) => runAction(
                        `profile-app:${appId}`,
                        () => window.attune.setProfileAppEnabled(appId, enabled),
                        true,
                        false,
                      )}
                      onToggleWorkspace={(appId, enabled) => runAction(
                        `workspace-app:${appId}`,
                        () => window.attune.setWorkspaceAppEnabled(appId, enabled),
                        true,
                        true,
                      )}
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        {addThemeOpen && (
          <AddThemeDialog
            copied={themePromptCopied}
            prompt={addThemePrompt}
            themesRoot={snapshot?.environment.userThemesRoot}
            onClose={() => setAddThemeOpen(false)}
            onCopy={copyAddThemePrompt}
            onRefreshThemes={refreshThemes}
          />
        )}

        {addWorkspaceOpen && (
          <AddWorkspaceDialog
            copied={workspacePromptCopied}
            prompt={addWorkspacePrompt}
            workspacesRoot={snapshot?.environment.userWorkspacesRoot}
            onClose={() => setAddWorkspaceOpen(false)}
            onCopy={copyAddWorkspacePrompt}
            onRefreshWorkspaces={refreshWorkspaces}
          />
        )}
      </section>
    </main>
  );
}

function ThemeCard({
  theme,
  selected,
  disabled,
  onSelect,
}: {
  theme: ThemeInfo;
  selected: boolean;
  disabled: boolean;
  onSelect(): void;
}) {
  return (
    <button
      className={selected ? 'theme-card selected' : 'theme-card'}
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
    >
      <ThemePreview theme={theme} />
      <span>{theme.name}</span>
      {selected && <Check className="theme-check" size={15} />}
    </button>
  );
}

function ThemePreview({ theme }: { theme: ThemeInfo }) {
  if (theme.previewDataUrl) {
    return (
      <span className={`theme-preview theme-preview-${theme.id}`} aria-hidden="true">
        <img src={theme.previewDataUrl} alt="" />
      </span>
    );
  }

  return (
    <span className={`theme-preview theme-preview-${theme.id}`} aria-hidden="true">
      <i /><i /><i />
    </span>
  );
}

function AddThemeCard({ onOpen }: { onOpen(): void }) {
  return (
    <button
      className="theme-card add-theme-card"
      type="button"
      onClick={onOpen}
    >
      <span className="theme-preview add-theme-preview" aria-hidden="true">
        <Plus size={30} />
      </span>
      <span>Add theme</span>
    </button>
  );
}

function WorkspaceCard({
  workspace,
  selected,
  disabled,
  onSelect,
}: {
  workspace: WorkspaceInfo;
  selected: boolean;
  disabled: boolean;
  onSelect(): void;
}) {
  return (
    <button
      className={selected ? 'theme-card workspace-card selected' : 'theme-card workspace-card'}
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
    >
      <WorkspacePreview workspace={workspace} />
      <span>{workspace.name}</span>
      {selected && <Check className="workspace-check" size={15} />}
    </button>
  );
}

function WorkspacePreview({ workspace }: { workspace: WorkspaceInfo }) {
  if (workspace.previewDataUrl) {
    return (
      <span className="theme-preview workspace-preview" aria-hidden="true">
        <img src={workspace.previewDataUrl} alt="" />
      </span>
    );
  }

  return (
    <span className="theme-preview workspace-preview workspace-preview-empty" aria-hidden="true">
      <i /><i /><i />
    </span>
  );
}

function AddWorkspaceCard({ onOpen }: { onOpen(): void }) {
  return (
    <button
      className="theme-card add-theme-card add-workspace-card"
      type="button"
      onClick={onOpen}
    >
      <span className="theme-preview add-theme-preview" aria-hidden="true">
        <Plus size={30} />
      </span>
      <span>Add attunement</span>
    </button>
  );
}

function AddThemeDialog({
  copied,
  prompt,
  themesRoot,
  onClose,
  onCopy,
  onRefreshThemes,
}: {
  copied: boolean;
  prompt: string;
  themesRoot: string | undefined;
  onClose(): void;
  onCopy(): void;
  onRefreshThemes(): void;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="theme-instructions"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-theme-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <div>
            <h2 id="add-theme-title">Add a theme with your agent</h2>
            <p>Fill in the theme request, then give any coding agent the prompt.</p>
          </div>
          <button className="icon-button" type="button" title="Close" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="instruction-stack">
          <textarea
            className="prompt-box"
            value={prompt}
            readOnly
            spellCheck={false}
            aria-label="Agent prompt for adding an Attune theme"
          />

          <div className="modal-actions">
            <button className="button" type="button" onClick={onCopy}>
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? 'Copied' : 'Copy prompt'}
            </button>
            <button className="button primary" type="button" onClick={onRefreshThemes}>
              <RefreshCw size={16} />
              Refresh themes
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function AddWorkspaceDialog({
  copied,
  prompt,
  workspacesRoot,
  onClose,
  onCopy,
  onRefreshWorkspaces,
}: {
  copied: boolean;
  prompt: string;
  workspacesRoot: string | undefined;
  onClose(): void;
  onCopy(): void;
  onRefreshWorkspaces(): void;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="theme-instructions"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-workspace-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <div>
            <h2 id="add-workspace-title">Add an attunement with your agent</h2>
            <p>Describe the app layout changes and embeds you want, then give any coding agent the prompt.</p>
          </div>
          <button className="icon-button" type="button" title="Close" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="instruction-stack">
          <textarea
            className="prompt-box"
            value={prompt}
            readOnly
            spellCheck={false}
            aria-label="Agent prompt for adding an Attune attunement"
          />

          <div className="modal-actions">
            <button className="button" type="button" onClick={onCopy}>
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? 'Copied' : 'Copy prompt'}
            </button>
            <button className="button primary" type="button" onClick={onRefreshWorkspaces}>
              <RefreshCw size={16} />
              Refresh attunements
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function AppRow({
  appInfo,
  busy,
  themeActive,
  workspaceActive,
  onToggleTheme,
  onToggleWorkspace,
}: {
  appInfo: AttuneAppInfo;
  busy: BusyAction | null;
  themeActive: boolean;
  workspaceActive: boolean;
  onToggleTheme(appId: string, enabled: boolean): void;
  onToggleWorkspace(appId: string, enabled: boolean): void;
}) {
  const icon = appInfo.iconDataUrl ?? appIcon(appInfo.name);
  const actionBusy = busy === `profile-app:${appInfo.id}`;
  const workspaceBusy = busy === `workspace-app:${appInfo.id}`;

  return (
    <div className="app-entry">
      <div className="app-row">
        <span className={`app-symbol ${appInfo.status}`}>
          {icon
            ? <img src={icon} alt="" />
            : appInitials(appInfo.name)}
        </span>
        <span className="app-copy">
          <span className="app-name-line">
            <strong>{appInfo.name}</strong>
            {themeActive && (
              <button
                className="icon-button session-button"
                title={appInfo.themeEnabled ? `Pause ${appInfo.name} theme` : `Play ${appInfo.name} theme`}
                type="button"
                disabled={busy !== null}
                onClick={() => onToggleTheme(appInfo.id, !appInfo.themeEnabled)}
              >
                {actionBusy ? <Loader2 className="spin" size={17} /> : appInfo.themeEnabled ? <CirclePause size={18} /> : <CirclePlay size={18} />}
              </button>
            )}
            {workspaceActive && (
              <button
                className="icon-button session-button workspace-session-button"
                title={appInfo.workspaceEnabled ? `Pause ${appInfo.name} attunement` : `Play ${appInfo.name} attunement`}
                type="button"
                disabled={busy !== null}
                onClick={() => onToggleWorkspace(appInfo.id, !appInfo.workspaceEnabled)}
              >
                {workspaceBusy ? <Loader2 className="spin" size={17} /> : <LayoutPanelLeft size={18} />}
              </button>
            )}
          </span>
        </span>
        <span className={`status ${appInfo.status}`}><i />{statusLabels[appInfo.status]}</span>
        <span className="theme-state">
          {appInfo.themeEnabled || appInfo.workspaceEnabled
            ? <><Check size={14} /> {[appInfo.themeEnabled ? 'Theme' : null, appInfo.workspaceEnabled ? 'Attunement' : null].filter(Boolean).join(' + ')}</>
            : 'No profile'}
        </span>
      </div>
    </div>
  );
}

function appInitials(name: string): string {
  if (name === 'Visual Studio Code') return 'VS';
  return name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
}

function appIcon(name: string): string | null {
  const icons: Record<string, string> = {
    ChatGPT: chatgptIcon,
    Slack: slackIcon,
    Spotify: spotifyIcon,
    'Visual Studio Code': vscodeIcon,
  };
  return icons[name] ?? null;
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(message)), milliseconds);
    promise.then(
      (value) => { window.clearTimeout(timeout); resolve(value); },
      (error: unknown) => { window.clearTimeout(timeout); reject(error); },
    );
  });
}

function buildAddThemePrompt(
  themesRoot: string | undefined,
  nodePath: string | undefined,
  cliPath: string | undefined,
): string {
  const themePath = themesRoot ?? '~/Library/Application Support/Attune/themes';
  const inspectionInstructions = buildAgentInspectionInstructions(nodePath, cliPath);

  return `Create a custom Attune theme.

Theme request: [replace this with the style, mood, colors, or source of inspiration]
Themes folder: ${themePath}
Editable Arrakis theme: ${themePath}/arrakis
Arrakis image: ${themePath}/arrakis/arrakis.jpg

Read the editable Arrakis theme first. To adjust Arrakis, edit that folder directly. To create a new theme, create a new sibling folder with manifest.json, tokens.css, base-layout.css, and adapters for ChatGPT, Slack, Spotify, Visual Studio Code, Cursor, and Claude. A Visual Studio Code adapter automatically applies to Cursor unless you add a dedicated Cursor adapter. Do not edit the signed app bundle. Use relative adapter paths like "adapters/chatgpt.css".

${inspectionInstructions}

When done, tell me to click Refresh themes in Attune App.`;
}

function buildAddWorkspacePrompt(
  workspacesRoot: string | undefined,
  nodePath: string | undefined,
  cliPath: string | undefined,
): string {
  const workspacePath = workspacesRoot ?? '~/Library/Application Support/Attune/workspaces';
  const inspectionInstructions = buildAgentInspectionInstructions(nodePath, cliPath);

  return `Create a custom Attune attunement.

Attunement request: [replace this with the app layout changes, hidden sections, resized panes, or embeds I want]
Attunements folder: ${workspacePath}
Installed examples: ${workspacePath}

Read a relevant installed attunement first. Catalog-managed packages contain an .attune-package.json marker; copy one to a new sibling folder before customizing it so catalog updates cannot overwrite your changes. Create each new attunement with manifest.json, a preview screenshot named preview.png or preview.jpg, and an apps/ folder containing CSS patches. Prefer manifest version 2 with a "targets" object keyed by app name, semantic bindings, and relative source paths such as "apps/spotify-quiet-home.css". You can also set "preview": "preview.png" in the manifest.

For simple layout changes, write CSS only. For app embeds, put idempotent JavaScript inside a CSS comment block:

/* @attune-script
(() => {
  // Publisher apps can POST JSON to http://127.0.0.1:47655/v1/my-key
  // Consumer apps can GET JSON from the same key and render a compact UI.
})();
@end-attune-script */

Do not edit the signed app bundle. Keep scripts local-only, defensive, and safe to re-run.

${inspectionInstructions}

When done, tell me to click Refresh attunements in Attune App.`;
}

function buildAgentInspectionInstructions(
  nodePath: string | undefined,
  cliPath: string | undefined,
): string {
  if (!nodePath || !cliPath) return '';
  const command = `ELECTRON_RUN_AS_NODE=1 ${JSON.stringify(nodePath)} ${JSON.stringify(cliPath)}`;
  return `Attune App and the CLI share the same live sessions. Before writing app-specific CSS, inspect each target that Attune App reports as Open:

${command} status "<App Name>"
${command} inspect "<App Name>"

Use the returned screenshot, compact selector sample, and viewport to write the CSS. The complete inspection is available at the returned temporary JSON path if targeted details are needed; do not load it wholesale unless necessary. Prefer high-stability selectors. Attune App automatically recompiles edits to the active theme or attunement, so inspect again after saving to verify the rendered result. For a new theme or attunement, ask me to refresh and enable it once before final visual verification. Inspection artifacts expire automatically after 24 hours. Visible private app content may appear in them; keep them local. If the target is not attached, ask me to open it through Attune App. Do not close or relaunch an app without asking me first.`;
}
