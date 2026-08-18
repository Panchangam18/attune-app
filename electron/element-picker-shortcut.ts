export interface NativeAppPickerSignal {
  appPid: number;
  appId: string | null;
}

const NATIVE_APP_PICKER_SIGNAL = /^picker:app:([1-9][0-9]*)(?::([A-Za-z0-9][A-Za-z0-9._-]{0,255}))?$/;

export function parseNativeAppPickerSignal(signal: string): NativeAppPickerSignal | null {
  const match = NATIVE_APP_PICKER_SIGNAL.exec(signal);
  if (!match) return null;
  const appPid = Number.parseInt(match[1], 10);
  if (!Number.isSafeInteger(appPid) || appPid <= 0) return null;
  return { appPid, appId: match[2] || null };
}

export function supportedButNotAttachedPickerNotice(appName: string): string {
  return `${appName} is supported but not attached. Open it through Attune, then press ⌥⌘A again.`;
}
