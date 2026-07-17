import { useEffect, useMemo, useState } from 'react';
import {
  AppWindow,
  Check,
  CirclePause,
  CirclePlay,
  CircleAlert,
  Copy,
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
import arrakisPreview from './assets/themes/arrakis.jpg';
import cyberpunkPreview from './assets/themes/cyberpunk.jpg';
import type { ActionResult, AttuneAppInfo, Snapshot, ThemeInfo } from './vite-env';

type BusyAction = 'refresh' | 'build' | 'profile' | 'wallpaper' | `profile-app:${string}`;

const statusLabels: Record<AttuneAppInfo['status'], string> = {
  attached: 'Open',
  starting: 'Starting',
  waiting: 'Waiting',
  stopped: 'Stopped',
  none: 'Ready',
};

export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [selectedThemeId, setSelectedThemeId] = useState<string | null | undefined>(undefined);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addThemeOpen, setAddThemeOpen] = useState(false);
  const [themePromptCopied, setThemePromptCopied] = useState(false);
  const [busy, setBusy] = useState<BusyAction | null>(null);
  const [notice, setNotice] = useState<{ kind: 'good' | 'bad' | 'info'; text: string } | null>(null);

  const selectedTheme = useMemo(() => (
    snapshot?.themes.find((theme) => theme.id === selectedThemeId) ?? null
  ), [selectedThemeId, snapshot?.themes]);
  const addThemePrompt = useMemo(
    () => buildAddThemePrompt(snapshot?.environment.userThemesRoot),
    [snapshot?.environment.userThemesRoot],
  );

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (selectedThemeId === undefined && snapshot) {
      setSelectedThemeId(snapshot.profile.enabled ? snapshot.profile.activeThemeId : null);
    }
  }, [selectedThemeId, snapshot]);

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

  const runtimeReady = snapshot?.environment.runtimeBuilt ?? false;
  const wallpaperEnabled = snapshot?.profile.wallpaperEnabled ?? true;
  const visibleApps = useMemo(() => (
    [...(snapshot?.apps ?? [])].sort((left, right) => {
      const leftInThemeScope = selectedTheme !== null && left.targetProfileApp;
      const rightInThemeScope = selectedTheme !== null && right.targetProfileApp;
      if (leftInThemeScope !== rightInThemeScope) return leftInThemeScope ? -1 : 1;
      return left.name.localeCompare(right.name);
    })
  ), [selectedTheme, snapshot?.apps]);

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
                      onToggleTheme={(appId, enabled) => runAction(
                        `profile-app:${appId}`,
                        () => window.attune.setProfileAppEnabled(appId, enabled),
                        true,
                        false,
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
      <ThemePreview themeId={theme.id} />
      <span>{theme.name}</span>
      {selected && <Check className="theme-check" size={15} />}
    </button>
  );
}

function ThemePreview({ themeId }: { themeId: string }) {
  const imagePreview = {
    arrakis: arrakisPreview,
    cyberpunk: cyberpunkPreview,
  }[themeId];

  if (imagePreview) {
    return (
      <span className={`theme-preview theme-preview-${themeId}`} aria-hidden="true">
        <img src={imagePreview} alt="" />
      </span>
    );
  }

  return (
    <span className={`theme-preview theme-preview-${themeId}`} aria-hidden="true">
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

function AppRow({
  appInfo,
  busy,
  themeActive,
  onToggleTheme,
}: {
  appInfo: AttuneAppInfo;
  busy: BusyAction | null;
  themeActive: boolean;
  onToggleTheme(appId: string, enabled: boolean): void;
}) {
  const icon = appInfo.iconDataUrl ?? appIcon(appInfo.name);
  const actionBusy = busy === `profile-app:${appInfo.id}`;

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
          </span>
        </span>
        <span className={`status ${appInfo.status}`}><i />{statusLabels[appInfo.status]}</span>
        <span className="theme-state">{appInfo.themeEnabled ? <><Check size={14} /> Themed</> : 'Not themed'}</span>
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

function buildAddThemePrompt(themesRoot: string | undefined): string {
  const themePath = themesRoot ?? '~/Library/Application Support/Attune/themes';

  return `Create a custom Attune theme.

Theme request: [replace this with the style, mood, colors, or source of inspiration]
Themes folder: ${themePath}
Editable Arrakis theme: ${themePath}/arrakis
Arrakis image: ${themePath}/arrakis/arrakis.jpg

Read the editable Arrakis theme first. To adjust Arrakis, edit that folder directly. To create a new theme, create a new sibling folder with manifest.json, tokens.css, base-layout.css, and adapters for ChatGPT, Slack, Spotify, Visual Studio Code, and Claude. Do not edit the signed app bundle. Use relative adapter paths like "adapters/chatgpt.css". When done, tell me to click Refresh themes in Attune App.`;
}
