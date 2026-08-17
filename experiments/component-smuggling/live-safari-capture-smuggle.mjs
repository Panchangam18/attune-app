import { execFile, spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { ComponentSmuggleBridge } from '../../dist-electron/component-smuggler.js';
import { SafariAppleEventsPageClient } from '../../dist-electron/safari-page-client.js';

const execFileAsync = promisify(execFile);
const targetPort = Number(process.env.ATTUNE_SMUGGLE_TARGET_PORT || 58799);
const sourceSelector = process.env.ATTUNE_SMUGGLE_SOURCE_SELECTOR || '#storybook-explorer-menu';
const keyForwarder = resolve('dist-electron/assets/key-chord-forwarder');
const windowStreamer = resolve('dist-electron/assets/window-region-stream');

async function pageTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) throw new Error(`Could not read Chromium targets on port ${port}`);
  return (await response.json()).filter((target) => target.type === 'page' && target.webSocketDebuggerUrl);
}

async function evaluateCdp(webSocketDebuggerUrl, expression) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  const value = await new Promise((resolveValue, reject) => {
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      if (message.error) reject(new Error(message.error.message));
      else resolveValue(message.result?.result?.value);
    });
    socket.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression, returnByValue: true },
    }));
  });
  socket.close();
  return value;
}

const safariProbe = await execFileAsync('/usr/bin/osascript', [
  '-e', 'tell application "Safari"',
  '-e', 'if (count of windows) is 0 then error "Open a Safari window first"',
  '-e', 'set sourceWindow to front window',
  '-e', 'set sourceTab to current tab of sourceWindow',
  '-e', 'set sourceTabIndex to index of sourceTab',
  '-e', 'return (id of sourceWindow as text) & "|" & (sourceTabIndex as text) & "|" & URL of sourceTab',
  '-e', 'end tell',
], { encoding: 'utf8', timeout: 3000 });
const [windowIdText, tabIndexText, sourceUrl] = safariProbe.stdout.trim().split('|', 3);
const safariPid = Number((await execFileAsync('/usr/bin/pgrep', ['-x', 'Safari'], { encoding: 'utf8' })).stdout.trim().split(/\s+/)[0]);
const page = {
  appPid: safariPid,
  windowId: Number(windowIdText),
  tabIndex: Number(tabIndexText),
  url: sourceUrl,
};
const forwardKey = async (chord) => {
  const modifiers = [
    chord.metaKey ? 'meta' : '', chord.ctrlKey ? 'ctrl' : '',
    chord.altKey ? 'alt' : '', chord.shiftKey ? 'shift' : '',
  ].filter(Boolean).join(',');
  await execFileAsync(keyForwarder, [String(safariPid), chord.code, modifiers], { timeout: 2000 });
  return { transport: 'native', code: chord.code };
};
const safariClient = new SafariAppleEventsPageClient(page, forwardKey);
await safariClient.connect();

const sourceToken = `safari-source-${Date.now()}`;
const sourceFingerprint = await safariClient.evaluate(`(() => {
  const element = document.querySelector(${JSON.stringify(sourceSelector)});
  if (!element) return null;
  globalThis.__attuneSmuggleAnchors ||= {};
  globalThis.__attuneSmuggleAnchors[${JSON.stringify(sourceToken)}] = element;
  element.setAttribute('data-attune-smuggle-anchor', ${JSON.stringify(sourceToken)});
  const bounds = element.getBoundingClientRect();
  return {
    tag: element.tagName.toLowerCase(), domRole: element.getAttribute('role') || '',
    label: element.getAttribute('aria-label') || '', text: '', attributes: {}, classes: [],
    ancestor: { tag: element.parentElement?.tagName?.toLowerCase?.() || '', domRole: '', label: '' },
    width: Math.round(bounds.width), height: Math.round(bounds.height),
  };
})()`);
if (!sourceFingerprint) throw new Error(`Safari could not resolve ${sourceSelector}`);

const targetPage = (await pageTargets(targetPort)).find(async (target) => (
  await evaluateCdp(target.webSocketDebuggerUrl, 'Boolean(document.querySelector(\'[data-attune-host-roles~="codex.composer"]\'))')
)) || (await pageTargets(targetPort))[0];
if (!targetPage) throw new Error('Codex target is unavailable');
const targetToken = `safari-target-${Date.now()}`;
const targetFingerprint = await evaluateCdp(targetPage.webSocketDebuggerUrl, `(() => {
  const element = document.querySelector('[data-attune-host-roles~="codex.composer"]');
  if (!element) return null;
  globalThis.__attuneSmuggleAnchors ||= {};
  globalThis.__attuneSmuggleAnchors[${JSON.stringify(targetToken)}] = element;
  element.setAttribute('data-attune-smuggle-anchor', ${JSON.stringify(targetToken)});
  return { tag: element.tagName.toLowerCase(), domRole: '', label: '', text: '', attributes: {}, classes: [], ancestor: null };
})()`);
if (!targetFingerprint) throw new Error('Codex composer anchor is unavailable');

let finish;
const finished = new Promise((resolveFinished) => { finish = resolveFinished; });
const bridge = new ComponentSmuggleBridge(
  {
    appId: 'com.apple.Safari', appName: 'Safari', appPid: safariPid,
    webSocketDebuggerUrl: `safari://window/${page.windowId}/tab/${page.tabIndex}`,
    anchor: { token: sourceToken, roles: [], selector: sourceSelector, fingerprint: sourceFingerprint },
  },
  {
    appId: 'com.openai.codex', appName: 'ChatGPT',
    webSocketDebuggerUrl: targetPage.webSocketDebuggerUrl,
    anchor: { token: targetToken, roles: ['codex.composer'], selector: '[data-attune-host-roles~="codex.composer"]', fingerprint: targetFingerprint },
  },
  (reason, error) => {
    if (error) console.error(error);
    console.log(`live-safari-capture-smuggle-stopped:${reason}`);
    finish();
  },
  forwardKey,
  async (region, onFrame) => {
    const capture = spawn(windowStreamer, [
      String(safariPid),
      String(Number(region.screenX) + Number(region.contentOffsetX || 0) + Number(region.x)),
      String(Number(region.screenY) + Number(region.contentOffsetY || 0) + Number(region.y)),
      String(region.width), String(region.height), '10', '0',
      String(region.screenX), String(region.screenY), String(region.outerWidth), String(region.outerHeight),
      String(region.nativeWindowId || page.windowId),
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    capture.stdout.setEncoding('utf8');
    let stdout = '';
    capture.stdout.on('data', (chunk) => {
      stdout += chunk;
      const lines = stdout.split(/\r?\n/);
      stdout = lines.pop() || '';
      for (const line of lines) if (line.length > 100) onFrame(line.trim());
    });
    await new Promise((resolveReady, reject) => {
      const timeout = setTimeout(() => reject(new Error('Safari WindowServer stream timed out')), 15_000);
      capture.stderr.on('data', (chunk) => {
        if (!String(chunk).includes('ready ')) return;
        clearTimeout(timeout);
        resolveReady();
      });
      capture.once('error', reject);
      capture.once('exit', (code) => { if (code) reject(new Error(`Safari WindowServer stream exited with ${code}`)); });
    });
    return () => capture.kill();
  },
  { source: safariClient },
);

const stop = async () => { await bridge.stop(true); finish(); };
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
await bridge.start();
console.log(`live-safari-capture-smuggle-ready:${sourceFingerprint.width}x${sourceFingerprint.height}`);
await finished;
