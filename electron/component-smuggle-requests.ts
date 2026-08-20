import { chmodSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { ComponentSmuggleEndpoint } from './component-smuggler.js';

export interface LiveSafariPageReference {
  appPid: number;
  windowId: number;
  tabIndex: number;
  url: string;
}

export type LiveComponentSmuggleSource = ComponentSmuggleEndpoint & {
  transport?: 'cdp' | 'safari-apple-events';
  safariPage?: LiveSafariPageReference;
};

export interface LiveComponentSmuggleRequest {
  schemaVersion: 1;
  requestId: string;
  createdAt: string;
  expiresAt: string;
  source: LiveComponentSmuggleSource;
  target: {
    appId: 'com.openai.codex';
    appName: 'ChatGPT';
    slotId: string;
  };
}

export interface PendingLiveComponentSmuggleRequest {
  path: string;
  request: LiveComponentSmuggleRequest;
}

export function componentSmuggleRequestDirectory(homePath: string): string {
  return join(homePath, '.attune', 'component-smuggle-requests');
}

export function componentSmuggleBrokerPath(homePath: string): string {
  return join(homePath, '.attune', 'component-smuggle-broker.json');
}

export function writeComponentSmuggleBrokerHeartbeat(
  homePath: string,
  pid = process.pid,
  now = new Date(),
): string {
  const path = componentSmuggleBrokerPath(homePath);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${pid}.tmp`;
  try {
    writeFileSync(temporaryPath, JSON.stringify({ schemaVersion: 1, pid, updatedAt: now.toISOString() }, null, 2), { mode: 0o600 });
    renameSync(temporaryPath, path);
    chmodSync(path, 0o600);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
  return path;
}

export function removeComponentSmuggleBrokerHeartbeat(homePath: string, pid = process.pid): void {
  const path = componentSmuggleBrokerPath(homePath);
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as { pid?: unknown };
    if (value.pid === pid) rmSync(path, { force: true });
  } catch {}
}

export function readPendingComponentSmuggleRequests(
  homePath: string,
  now = Date.now(),
): PendingLiveComponentSmuggleRequest[] {
  const directory = componentSmuggleRequestDirectory(homePath);
  let names: string[] = [];
  try {
    names = readdirSync(directory).filter(name => /^[0-9a-f-]{36}\.json$/i.test(name)).sort();
  } catch {
    return [];
  }
  const pending: PendingLiveComponentSmuggleRequest[] = [];
  for (const name of names) {
    const path = join(directory, name);
    try {
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) continue;
      const request = JSON.parse(readFileSync(path, 'utf8')) as unknown;
      if (!isLiveComponentSmuggleRequest(request)) continue;
      if (Date.parse(request.expiresAt) <= now) {
        rmSync(path, { force: true });
        continue;
      }
      pending.push({ path, request });
    } catch {}
  }
  return pending;
}

export function restorePendingComponentSmuggleRequest(
  path: string,
  request: LiveComponentSmuggleRequest,
  now = Date.now(),
): boolean {
  if (!isLiveComponentSmuggleRequest(request) || Date.parse(request.expiresAt) <= now) return false;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(request, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporaryPath, path);
    chmodSync(path, 0o600);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
  return true;
}

export function isLiveComponentSmuggleRequest(value: unknown): value is LiveComponentSmuggleRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as Partial<LiveComponentSmuggleRequest>;
  if (
    request.schemaVersion !== 1
    || !isUuid(request.requestId)
    || !isIsoDate(request.createdAt)
    || !isIsoDate(request.expiresAt)
    || request.target?.appId !== 'com.openai.codex'
    || request.target.appName !== 'ChatGPT'
    || request.target.slotId !== `attune-live-${request.requestId}`
    || !isComponentSmuggleEndpoint(request.source)
  ) return false;
  return Date.parse(request.expiresAt) > Date.parse(request.createdAt);
}

export function buildCodexLiveSlotAnchorExpression(slotId: string, token: string): string {
  return `JSON.stringify((() => {
    const selector = '[data-attune-smuggle-slot=' + JSON.stringify(${JSON.stringify(slotId)}) + ']';
    const element = document.querySelector(selector);
    if (!element) return null;
    const bounds = element.getBoundingClientRect();
    if (bounds.width < 1 || bounds.height < 1) return null;
    const token = ${JSON.stringify(token)};
    globalThis.__attuneSmuggleAnchors ||= {};
    globalThis.__attuneSmuggleAnchors[token] = element;
    element.setAttribute('data-attune-smuggle-anchor', token);
    return {
      token,
      roles: [],
      selector,
      fingerprint: {
        tag: element.tagName.toLowerCase(),
        domRole: element.getAttribute('role') || '',
        label: element.getAttribute('aria-label') || '',
        text: '',
        attributes: { 'data-attune-smuggle-slot': ${JSON.stringify(slotId)} },
        classes: [],
        ancestor: null,
      },
      placement: 'inside',
    };
  })())`;
}

export function isCodexLiveVisualizationTarget(candidate: {
  type?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
}): candidate is { type: 'webview'; url: string; webSocketDebuggerUrl: string } {
  return candidate.type === 'webview'
    && typeof candidate.url === 'string'
    && candidate.url.startsWith('codex-sandbox://codex-inline-visualization-')
    && typeof candidate.webSocketDebuggerUrl === 'string'
    && isLoopbackWebSocket(candidate.webSocketDebuggerUrl);
}

function isComponentSmuggleEndpoint(value: unknown): value is LiveComponentSmuggleSource {
  if (!value || typeof value !== 'object') return false;
  const endpoint = value as Partial<ComponentSmuggleEndpoint>;
  if (
    typeof endpoint.appId !== 'string'
    || !endpoint.appId
    || typeof endpoint.appName !== 'string'
    || !endpoint.appName
    || !endpoint.anchor
    || !isUuid(endpoint.anchor.token)
    || !Array.isArray(endpoint.anchor.roles)
    || endpoint.anchor.roles.some(role => typeof role !== 'string' || role.length > 160)
    || typeof endpoint.anchor.selector !== 'string'
    || endpoint.anchor.selector.length > 500
    || endpoint.anchor.placement !== 'inside'
  ) return false;
  const source = endpoint as Partial<LiveComponentSmuggleSource>;
  const safariSource = source.transport === 'safari-apple-events';
  if (safariSource) {
    if (
      endpoint.appId !== 'com.apple.Safari'
      || !Number.isSafeInteger(endpoint.appPid)
      || typeof endpoint.webSocketDebuggerUrl !== 'string'
      || !/^safari:\/\/window\/\d+\/tab\/\d+$/.test(endpoint.webSocketDebuggerUrl)
      || !isSafariPageReference(source.safariPage, endpoint.appPid)
    ) return false;
  } else if (!isLoopbackWebSocket(endpoint.webSocketDebuggerUrl)) {
    return false;
  }
  const fingerprint = endpoint.anchor.fingerprint;
  return Boolean(fingerprint)
    && typeof fingerprint.tag === 'string'
    && typeof fingerprint.domRole === 'string'
    && typeof fingerprint.label === 'string'
    && typeof fingerprint.text === 'string'
    && Boolean(fingerprint.attributes)
    && Array.isArray(fingerprint.classes);
}

function isSafariPageReference(value: unknown, appPid: unknown): value is LiveSafariPageReference {
  if (!value || typeof value !== 'object') return false;
  const page = value as Partial<LiveSafariPageReference>;
  return Number.isSafeInteger(page.appPid)
    && page.appPid === appPid
    && Number.isSafeInteger(page.windowId)
    && Number(page.windowId) > 0
    && Number.isSafeInteger(page.tabIndex)
    && Number(page.tabIndex) > 0
    && typeof page.url === 'string'
    && page.url.length <= 4_096;
}

function isLoopbackWebSocket(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'ws:' && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
