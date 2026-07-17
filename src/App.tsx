import { useEffect, useMemo, useState } from 'react';
import {
  AppWindow,
  Check,
  CirclePause,
  CirclePlay,
  CircleAlert,
  Loader2,
  Settings,
} from 'lucide-react';
import chatgptIcon from './assets/apps/chatgpt.png';
import slackIcon from './assets/apps/slack.png';
import spotifyIcon from './assets/apps/spotify.png';
import vscodeIcon from './assets/apps/vscode.png';
import arrakisDunePreview from './assets/themes/arrakis-dune-thumbnail.png';
import gryffindorPreview from './assets/themes/gryffindor-thumbnail.png';
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
  const [busy, setBusy] = useState<BusyAction | null>(null);
  const [notice, setNotice] = useState<{ kind: 'good' | 'bad' | 'info'; text: string } | null>(null);

  const selectedTheme = useMemo(() => (
    snapshot?.themes.find((theme) => theme.id === selectedThemeId) ?? null
  ), [selectedThemeId, snapshot?.themes]);

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
          <h1>Good day to <span className="attune-word">Attune</span></h1>
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
  if (themeId === 'arrakis') {
    return (
      <span className="theme-preview theme-preview-arrakis" aria-hidden="true">
        <img src={arrakisDunePreview} alt="" />
      </span>
    );
  }

  if (themeId === 'gryffindor') {
    return (
      <span className="theme-preview theme-preview-gryffindor" aria-hidden="true">
        <img src={gryffindorPreview} alt="" />
      </span>
    );
  }

  return (
    <span className={`theme-preview theme-preview-${themeId}`} aria-hidden="true">
      <i /><i /><i />
    </span>
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
