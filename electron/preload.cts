import { contextBridge, ipcRenderer } from 'electron';

const invoke = <T,>(channel: string, payload?: unknown): Promise<T> => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('attune', {
  snapshot: () => invoke('attune:snapshot'),
  buildRuntime: () => invoke('attune:build-runtime'),
  applyTheme: (appId: string, themeId: string) => invoke('attune:apply-theme', { appId, themeId }),
  setProfileEnabled: (themeId: string, enabled: boolean) => invoke('attune:set-profile-enabled', { themeId, enabled }),
  setAutoWrapEnabled: (enabled: boolean) => invoke('attune:set-auto-wrap-enabled', { enabled }),
  chooseCssFile: (appId: string) => invoke('attune:choose-css-file', { appId }),
  launch: (appId: string) => invoke('attune:launch', { appId }),
  stop: (appId: string) => invoke('attune:stop', { appId }),
  openPath: (path: string) => invoke('attune:open-path', { path }),
});
