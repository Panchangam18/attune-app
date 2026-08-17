import { execFile, spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { ComponentSmuggleBridge } from '../../dist-electron/component-smuggler.js';

const execFileAsync = promisify(execFile);
const sourcePort = Number(process.env.ATTUNE_SMUGGLE_SOURCE_PORT || 62561);
const targetPort = Number(process.env.ATTUNE_SMUGGLE_TARGET_PORT || 58799);
const sourcePid = Number(process.env.ATTUNE_SMUGGLE_SOURCE_PID || 21858);
const sourceAppId = process.env.ATTUNE_SMUGGLE_SOURCE_APP_ID || 'com.tinyspeck.slackmacgap';
const sourceAppName = process.env.ATTUNE_SMUGGLE_SOURCE_APP_NAME || 'Slack';
const sourceSelector = process.env.ATTUNE_SMUGGLE_SOURCE_SELECTOR || '';
const forwardNativeKeys = process.env.ATTUNE_SMUGGLE_NATIVE_KEYS !== '0';
const keyForwarder = resolve('dist-electron/assets/key-chord-forwarder');
const windowStreamer = resolve('dist-electron/assets/window-region-stream');

async function pageTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) throw new Error(`Could not read Chromium targets on port ${port}`);
  return (await response.json()).filter((target) => target.type === 'page' && target.webSocketDebuggerUrl);
}

async function evaluate(webSocketDebuggerUrl, expression) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => {
    const timeout = setTimeout(() => reject(new Error('CDP connection timed out')), 3000);
    socket.addEventListener('open', () => { clearTimeout(timeout); resolveOpen(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('CDP connection failed')); }, { once: true });
  });
  const result = await new Promise((resolveResult, reject) => {
    const timeout = setTimeout(() => reject(new Error('CDP evaluation timed out')), 3000);
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      clearTimeout(timeout);
      if (message.error) reject(new Error(message.error.message));
      else resolveResult(message.result?.result?.value);
    });
    socket.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression, returnByValue: true },
    }));
  });
  socket.close();
  return result;
}

async function resolveTargetPage(port, predicateExpression) {
  for (const target of await pageTargets(port)) {
    if (await evaluate(target.webSocketDebuggerUrl, predicateExpression)) return target;
  }
  throw new Error(`No matching page target found on port ${port}`);
}

function anchorExpression(kind, token) {
  const resolver = kind === 'source'
    ? sourceSelector
      ? `document.querySelector(${JSON.stringify(sourceSelector)})`
      : `(() => {
      const active = document.activeElement;
      const activeGroup = active?.closest?.('[role="group"]');
      if (activeGroup?.querySelector?.('[contenteditable="true"],textarea')) return activeGroup;
      return [...document.querySelectorAll('[role="group"]')]
        .filter((element) => element.querySelector('[contenteditable="true"],textarea'))
        .filter((element) => { const bounds = element.getBoundingClientRect(); return bounds.width > 300 && bounds.height > 60 && bounds.height < 300; })
        .sort((left, right) => left.getBoundingClientRect().height - right.getBoundingClientRect().height)[0] || null;
    })()`
    : `document.querySelector('[data-attune-host-roles~="codex.composer"]')`;
  return `(() => {
    const element = ${resolver};
    if (!element) return null;
    globalThis.__attuneSmuggleAnchors ||= {};
    globalThis.__attuneSmuggleAnchors[${JSON.stringify(token)}] = element;
    element.setAttribute('data-attune-smuggle-anchor', ${JSON.stringify(token)});
    const bounds = element.getBoundingClientRect();
    return {
      tag: element.tagName.toLowerCase(),
      domRole: element.getAttribute('role') || '',
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
      ancestor: { tag: element.parentElement?.tagName?.toLowerCase?.() || '', domRole: element.parentElement?.getAttribute?.('role') || '', label: '' },
    };
  })()`;
}

const sourcePage = (await pageTargets(sourcePort)).find((target) => /^https?:/.test(target.url))
  || (await pageTargets(sourcePort))[0];
if (!sourcePage) throw new Error(`${sourceAppName} page target is unavailable`);
const targetPage = await resolveTargetPage(
  targetPort,
  `Boolean(document.querySelector('[data-attune-host-roles~="codex.composer"]'))`,
);
const sourceToken = `capture-source-${Date.now()}`;
const targetToken = `capture-target-${Date.now()}`;
const sourceFingerprint = await evaluate(sourcePage.webSocketDebuggerUrl, anchorExpression('source', sourceToken));
const targetFingerprint = await evaluate(targetPage.webSocketDebuggerUrl, anchorExpression('target', targetToken));
if (!sourceFingerprint || !targetFingerprint) throw new Error('Could not install live capture anchors');

let finish;
const finished = new Promise((resolveFinished) => { finish = resolveFinished; });
const bridge = new ComponentSmuggleBridge(
  {
    appId: sourceAppId,
    appName: sourceAppName,
    appPid: sourcePid,
    webSocketDebuggerUrl: sourcePage.webSocketDebuggerUrl,
    anchor: { token: sourceToken, roles: [], selector: sourceSelector || '[role="group"]', fingerprint: sourceFingerprint },
  },
  {
    appId: 'com.openai.codex',
    appName: 'ChatGPT',
    webSocketDebuggerUrl: targetPage.webSocketDebuggerUrl,
    anchor: { token: targetToken, roles: ['codex.composer'], selector: '[data-attune-host-roles~="codex.composer"]', fingerprint: targetFingerprint },
  },
  (reason, error) => {
    if (error) console.error(error);
    console.log(`live-capture-smuggle-stopped:${reason}`);
    finish();
  },
  forwardNativeKeys ? async (chord) => {
    const modifiers = [
      chord.metaKey ? 'meta' : '', chord.ctrlKey ? 'ctrl' : '',
      chord.altKey ? 'alt' : '', chord.shiftKey ? 'shift' : '',
    ].filter(Boolean).join(',');
    await execFileAsync(keyForwarder, [String(sourcePid), chord.code, modifiers], { timeout: 2000 });
    return { transport: 'native', code: chord.code };
  } : undefined,
  async (region, onFrame) => {
    const capture = spawn(windowStreamer, [
      String(sourcePid),
      String(Number(region.screenX) + Number(region.contentOffsetX || 0) + Number(region.x)),
      String(Number(region.screenY) + Number(region.contentOffsetY || 0) + Number(region.y)),
      String(region.width), String(region.height), '10', '0',
      String(region.screenX), String(region.screenY), String(region.outerWidth), String(region.outerHeight),
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    capture.stdout.setEncoding('utf8');
    capture.stderr.setEncoding('utf8');
    let stdout = '';
    capture.stdout.on('data', (chunk) => {
      stdout += chunk;
      const lines = stdout.split(/\r?\n/);
      stdout = lines.pop() || '';
      for (const line of lines) {
        const frame = line.trim();
        if (frame.length >= 100) onFrame(frame);
      }
    });
    await new Promise((resolveReady, reject) => {
      const timeout = setTimeout(() => reject(new Error('WindowServer stream timed out')), 5000);
      capture.stderr.on('data', (chunk) => {
        if (!String(chunk).includes('ready ')) return;
        clearTimeout(timeout);
        resolveReady();
      });
      capture.once('error', reject);
      capture.once('exit', (code) => {
        if (code) reject(new Error(`WindowServer stream exited with code ${code}`));
      });
    });
    return () => capture.kill();
  },
);

const stop = async () => {
  await bridge.stop(true);
  finish();
};
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
await bridge.start();
console.log(`live-capture-smuggle-ready:${sourceFingerprint.width}x${sourceFingerprint.height}`);
await finished;
