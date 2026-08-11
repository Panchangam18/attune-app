export function processListHasExecutable(
  processList: string,
  executablePath: string,
): boolean {
  return processList
    .split('\n')
    .map(command => command.trim())
    .some(command => (
      command === executablePath
      || command.startsWith(`${executablePath} `)
    ));
}

export const ATTUNE_SESSION_HEARTBEAT_TIMEOUT_MS = 20_000;

export interface AttuneSessionHeartbeat {
  updatedAt: string;
  watcherPid: number;
}

export interface AttuneSessionStatus extends AttuneSessionHeartbeat {
  status: string;
}

export function shouldRecoverAttuneSession(
  session: AttuneSessionHeartbeat,
  watcherAlive: boolean,
  now = Date.now(),
): boolean {
  if (!watcherAlive || !Number.isSafeInteger(session.watcherPid) || session.watcherPid <= 0) {
    return true;
  }
  const updatedAt = Date.parse(session.updatedAt);
  if (!Number.isFinite(updatedAt)) return true;
  const age = now - updatedAt;
  return age > ATTUNE_SESSION_HEARTBEAT_TIMEOUT_MS
    || age < -ATTUNE_SESSION_HEARTBEAT_TIMEOUT_MS;
}

export function shouldKeepAttuneWatcherSession(
  session: AttuneSessionStatus,
  watcherAlive: boolean,
  persistentWhileWaiting: boolean,
  now = Date.now(),
): boolean {
  if (shouldRecoverAttuneSession(session, watcherAlive, now)) return false;
  return persistentWhileWaiting || session.status !== 'waiting';
}
