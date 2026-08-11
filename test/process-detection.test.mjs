import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ATTUNE_SESSION_HEARTBEAT_TIMEOUT_MS,
  processListHasExecutable,
  shouldKeepAttuneWatcherSession,
  shouldRecoverAttuneSession,
} from '../dist-electron/process-detection.js';

test('process detection matches an exact executable path containing spaces', () => {
  const executable = '/Applications/ChatGPT.app/Contents/MacOS/ChatGPT';
  const processList = [
    '/usr/libexec/some-service',
    `${executable} --remote-debugging-port=53365`,
    '/Applications/Other App.app/Contents/MacOS/Other App',
  ].join('\n');

  assert.equal(processListHasExecutable(processList, executable), true);
});

test('process detection ignores executable paths mentioned only as arguments', () => {
  const executable = '/Applications/ChatGPT.app/Contents/MacOS/ChatGPT';
  const processList = [
    `/bin/zsh -c inspect ${executable}`,
    '/Applications/ChatGPT Beta.app/Contents/MacOS/ChatGPT',
  ].join('\n');

  assert.equal(processListHasExecutable(processList, executable), false);
});

test('session recovery detects dead, stale, or malformed watcher heartbeats', () => {
  const now = Date.parse('2026-08-08T12:00:00.000Z');
  const fresh = {
    watcherPid: 4242,
    updatedAt: new Date(now - ATTUNE_SESSION_HEARTBEAT_TIMEOUT_MS + 1).toISOString(),
  };
  assert.equal(shouldRecoverAttuneSession(fresh, true, now), false);
  assert.equal(shouldRecoverAttuneSession(fresh, false, now), true);
  assert.equal(shouldRecoverAttuneSession({ ...fresh, watcherPid: 0 }, true, now), true);
  assert.equal(shouldRecoverAttuneSession({
    ...fresh,
    updatedAt: new Date(now - ATTUNE_SESSION_HEARTBEAT_TIMEOUT_MS - 1).toISOString(),
  }, true, now), true);
  assert.equal(shouldRecoverAttuneSession({ ...fresh, updatedAt: 'not-a-date' }, true, now), true);
});

test('a healthy Claude bridge watcher remains authoritative while waiting', () => {
  const now = Date.parse('2026-08-08T12:00:00.000Z');
  const waiting = {
    status: 'waiting',
    watcherPid: 4242,
    updatedAt: new Date(now - 1_000).toISOString(),
  };
  assert.equal(shouldKeepAttuneWatcherSession(waiting, true, true, now), true);
  assert.equal(shouldKeepAttuneWatcherSession(waiting, true, false, now), false);
  assert.equal(shouldKeepAttuneWatcherSession(waiting, false, true, now), false);
  assert.equal(shouldKeepAttuneWatcherSession({
    ...waiting,
    updatedAt: new Date(now - ATTUNE_SESSION_HEARTBEAT_TIMEOUT_MS - 1).toISOString(),
  }, true, true, now), false);
  assert.equal(shouldKeepAttuneWatcherSession({
    ...waiting,
    status: 'attached',
  }, true, false, now), true);
});
