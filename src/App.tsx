import { useEffect, useMemo, useState } from 'react';
import {
  AppWindow,
  Brush,
  Check,
  CircleAlert,
  FolderOpen,
  Hammer,
  Loader2,
  MoreHorizontal,
  Play,
  Square,
} from 'lucide-react';
import chatgptIcon from './assets/apps/chatgpt.png';
import slackIcon from './assets/apps/slack.png';
import spotifyIcon from './assets/apps/spotify.png';
import vscodeIcon from './assets/apps/vscode.png';
import arrakisDunePreview from './assets/themes/arrakis-dune-thumbnail.png';
import type { ActionResult, AttuneAppInfo, Snapshot, ThemeInfo } from './vite-env';

type BusyAction = 'refresh' | 'build' | 'profile' | `apply:${string}` | `launch:${string}` | `stop:${string}` | `css:${string}`;

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
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [busy, setBusy] = useState<BusyAction | null>(null);
  const [notice, setNotice] = useState<{ kind: 'good' | 'bad' | 'info'; text: string } | null>(null);

  const selectedTheme = useMemo(() => (
    snapshot?.themes.find((theme) => theme.id === selectedThemeId) ?? null
  ), [selectedThemeId, snapshot?.themes]);

  const selectedApp = useMemo(() => (
    snapshot?.apps.find((appInfo) => appInfo.id === selectedAppId) ?? null
  ), [selectedAppId, snapshot?.apps]);

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
  const visibleApps = useMemo(() => (
    [...(snapshot?.apps ?? [])].sort((left, right) => {
      if (left.themeEnabled !== right.themeEnabled) return left.themeEnabled ? -1 : 1;
      return left.name.localeCompare(right.name);
    })
  ), [snapshot?.apps]);

  return (
    <main className="shell">
      <div className="window-drag-zone" aria-hidden="true" />
      <section className={`workspace theme-${selectedTheme?.id ?? 'default'}`}>
        <header className="toolbar">
          <h1>Good day to <span className="attune-word">Attune</span></h1>
        </header>

        {notice && (
          <div className={`notice ${notice.kind}`}>
            {notice.kind === 'bad' ? <CircleAlert size={17} /> : <Check size={17} />}
            <span>{notice.text}</span>
          </div>
        )}

        {!runtimeReady && (
          <div className="empty-state">
            <div className="empty-icon"><Hammer size={24} /></div>
            <h2>Runtime needs a quick build</h2>
            <p>Compile the sibling Attune runtime, then this screen will find your compatible apps.</p>
            <button className="button primary" type="button" disabled={busy !== null} onClick={() => runAction('build', window.attune.buildRuntime)}>
              {busy === 'build' ? <Loader2 className="spin" size={17} /> : <Hammer size={17} />}
              Build runtime
            </button>
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
                      theme={selectedTheme}
                      busy={busy}
                      expanded={selectedApp?.id === appInfo.id}
                      onToggle={() => setSelectedAppId(selectedApp?.id === appInfo.id ? null : appInfo.id)}
                      onApplyTheme={(appId, themeId) => runAction(`apply:${appId}`, () => window.attune.applyTheme(appId, themeId))}
                      onCustomCss={(appId) => runAction(`css:${appId}`, () => window.attune.chooseCssFile(appId))}
                      onLaunch={(appId) => runAction(`launch:${appId}`, () => window.attune.launch(appId))}
                      onStop={(appId) => runAction(`stop:${appId}`, () => window.attune.stop(appId))}
                      onOpenPath={(path) => window.attune.openPath(path)}
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

  return (
    <span className="theme-preview" aria-hidden="true">
      <i /><i /><i />
    </span>
  );
}

function AppRow({
  appInfo,
  theme,
  busy,
  expanded,
  onToggle,
  onApplyTheme,
  onCustomCss,
  onLaunch,
  onStop,
  onOpenPath,
}: {
  appInfo: AttuneAppInfo;
  theme: ThemeInfo | null;
  busy: BusyAction | null;
  expanded: boolean;
  onToggle(): void;
  onApplyTheme(appId: string, themeId: string): void;
  onCustomCss(appId: string): void;
  onLaunch(appId: string): void;
  onStop(appId: string): void;
  onOpenPath(path: string): void;
}) {
  const adapter = theme?.adapters.find((candidate) => {
    const left = normalize(candidate.appName);
    const right = normalize(appInfo.name);
    return candidate.available && (left === right || left.includes(right) || right.includes(left));
  });
  const icon = appInfo.iconDataUrl ?? appIcon(appInfo.name);

  return (
    <div className={expanded ? 'app-entry expanded' : 'app-entry'}>
      <button className="app-row" type="button" onClick={onToggle} aria-expanded={expanded}>
        <span className={`app-symbol ${appInfo.status}`}>
          {icon
            ? <img src={icon} alt="" />
            : appInitials(appInfo.name)}
        </span>
        <span className="app-copy">
          <strong>{appInfo.name}</strong>
          <small>{appInfo.runtime === 'electron' ? 'Electron' : 'Chromium'} · {adapter ? `${theme?.name} ready` : 'Custom CSS'}</small>
        </span>
        <span className={`status ${appInfo.status}`}><i />{statusLabels[appInfo.status]}</span>
        <span className="theme-state">{appInfo.themeEnabled ? <><Check size={14} /> Themed</> : 'Not themed'}</span>
        <MoreHorizontal className="more-icon" size={18} />
      </button>

      {expanded && (
        <div className="app-details">
          <div className="app-meta">
            <span><small>Bundle</small>{appInfo.bundleId ?? '-'}</span>
            <span><small>Targets</small>{appInfo.targetCount}</span>
            <span><small>Port</small>{appInfo.port ?? '-'}</span>
          </div>
          <div className="row-actions">
            <button className="button primary" type="button" disabled={!theme || !adapter || busy !== null} onClick={() => theme && onApplyTheme(appInfo.id, theme.id)}>
              {busy === `apply:${appInfo.id}` ? <Loader2 className="spin" size={16} /> : <Brush size={16} />} Apply
            </button>
            <button className="icon-button" title="Choose CSS file" type="button" disabled={busy !== null} onClick={() => onCustomCss(appInfo.id)}>
              {busy === `css:${appInfo.id}` ? <Loader2 className="spin" size={16} /> : <FolderOpen size={16} />}
            </button>
            <button className="icon-button" title="Launch with Attune" type="button" disabled={busy !== null} onClick={() => onLaunch(appInfo.id)}>
              {busy === `launch:${appInfo.id}` ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
            </button>
            <button className="icon-button" title="Stop session" type="button" disabled={busy !== null} onClick={() => onStop(appInfo.id)}>
              {busy === `stop:${appInfo.id}` ? <Loader2 className="spin" size={16} /> : <Square size={15} />}
            </button>
            <button className="path-button" type="button" onClick={() => onOpenPath(appInfo.path)}>{appInfo.path}</button>
          </div>
        </div>
      )}
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

function normalize(value: string): string {
  return value.toLowerCase()
    .replace(/\bvisual studio code\b/g, 'vscode')
    .replace(/\bvs code\b/g, 'vscode')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
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
