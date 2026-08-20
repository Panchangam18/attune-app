import { execFile, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { CdpPageClient, ComponentSmuggleBridge } from '../../dist-electron/component-smuggler.js';

const execFileAsync = promisify(execFile);
const home = process.env.HOME;
const sourceSession = JSON.parse(readFileSync(`${home}/.attune/sessions/com.google.Chrome.json`, 'utf8'));
const targetSession = JSON.parse(readFileSync(`${home}/.attune/sessions/com.openai.codex.json`, 'utf8'));
const sourcePort = Number(process.env.ATTUNE_REELS_SOURCE_PORT || sourceSession.port);
const targetPort = Number(process.env.ATTUNE_REELS_TARGET_PORT || targetSession.port);
const sourcePid = Number(process.env.ATTUNE_REELS_SOURCE_PID || sourceSession.appPid);
const frameRate = Math.max(1, Math.min(30, Number(process.env.ATTUNE_REELS_FPS || 30)));
const keyForwarder = resolve('dist-electron/assets/key-chord-forwarder');
const windowStreamer = resolve('dist-electron/assets/window-region-stream');

async function pageTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) throw new Error(`Could not read Chromium targets on port ${port}`);
  return (await response.json()).filter((target) => target.type === 'page' && target.webSocketDebuggerUrl);
}

async function evaluate(webSocketDebuggerUrl, expression, timeoutMs = 4000) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => {
    const timeout = setTimeout(() => reject(new Error('CDP connection timed out')), timeoutMs);
    socket.addEventListener('open', () => { clearTimeout(timeout); resolveOpen(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('CDP connection failed')); }, { once: true });
  });
  const result = await new Promise((resolveResult, reject) => {
    const timeout = setTimeout(() => reject(new Error('CDP evaluation timed out')), timeoutMs);
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      clearTimeout(timeout);
      if (message.error) reject(new Error(message.error.message));
      else resolveResult(message.result?.result?.value);
    });
    socket.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression, returnByValue: true, awaitPromise: true },
    }));
  });
  socket.close();
  return result;
}

async function findPage(port, predicateExpression) {
  for (const target of await pageTargets(port)) {
    if (await evaluate(target.webSocketDebuggerUrl, predicateExpression)) return target;
  }
  return null;
}

const sourcePage = await findPage(
  sourcePort,
  `/^https:\\/\\/(?:www\\.)?instagram\\.com\\/reels?\\//i.test(location.href) && Boolean(document.querySelector('video'))`,
);
if (!sourcePage) throw new Error('Open an Instagram Reel in the Attune Chrome window first');

await evaluate(sourcePage.webSocketDebuggerUrl, `(() => {
  try {
    delete document.hidden;
    delete document.visibilityState;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    globalThis.__attuneInstagramReelsVisibilityOverride = true;
    document.dispatchEvent(new Event('visibilitychange'));
    return true;
  } catch {
    return false;
  }
})()`);

const targetPage = await findPage(
  targetPort,
  `Boolean(document.querySelector('[data-attune-reels-live-target]'))`,
);
if (!targetPage) throw new Error('The Reels Break card is not installed in the active ChatGPT renderer');

const sourceToken = `instagram-reel-source-${Date.now()}`;
const targetToken = `instagram-reel-target-${Date.now()}`;
const sourceFingerprint = await evaluate(sourcePage.webSocketDebuggerUrl, `(() => {
  const candidates = [...document.querySelectorAll('video')].map((element) => {
    const bounds = element.getBoundingClientRect();
    const visibleWidth = Math.max(0, Math.min(bounds.right, innerWidth) - Math.max(bounds.left, 0));
    const visibleHeight = Math.max(0, Math.min(bounds.bottom, innerHeight) - Math.max(bounds.top, 0));
    return { element, area: visibleWidth * visibleHeight, bounds };
  }).filter((candidate) => candidate.area > 10000).sort((left, right) => right.area - left.area);
  const selected = candidates[0];
  if (!selected) return null;
  const element = selected.element;
  globalThis.__attuneSmuggleAnchors ||= {};
  globalThis.__attuneSmuggleAnchors[${JSON.stringify(sourceToken)}] = element;
  element.setAttribute('data-attune-smuggle-anchor', ${JSON.stringify(sourceToken)});
  return {
    tag: 'video', domRole: '', label: element.getAttribute('aria-label') || '', text: '',
    attributes: {}, classes: [],
    ancestor: { tag: element.parentElement?.tagName?.toLowerCase?.() || '', domRole: '', label: '' },
    width: Math.round(selected.bounds.width), height: Math.round(selected.bounds.height),
  };
})()`);
if (!sourceFingerprint) throw new Error('Could not find a visible Instagram Reel video');

const targetFingerprint = await evaluate(targetPage.webSocketDebuggerUrl, `(() => {
  const element = document.querySelector('[data-attune-reels-live-target]');
  if (!element) return null;
  globalThis.__attuneSmuggleAnchors ||= {};
  globalThis.__attuneSmuggleAnchors[${JSON.stringify(targetToken)}] = element;
  element.setAttribute('data-attune-smuggle-anchor', ${JSON.stringify(targetToken)});
  const bounds = element.getBoundingClientRect();
  return {
    tag: element.tagName.toLowerCase(), domRole: '', label: '', text: '',
    attributes: { 'data-attune-reels-live-target': '' }, classes: [...element.classList],
    ancestor: { tag: element.parentElement?.tagName?.toLowerCase?.() || '', domRole: '', label: '' },
    width: Math.round(bounds.width), height: Math.round(bounds.height),
  };
})()`);
if (!targetFingerprint) throw new Error('Could not install the ChatGPT Reel target');

function activeInstagramVideo(token) {
  const retained = globalThis.__attuneSmuggleAnchors?.[token];
  const candidates = [...document.querySelectorAll('video')].map((video) => {
    const bounds = video.getBoundingClientRect();
    const visibleWidth = Math.max(0, Math.min(bounds.right, innerWidth) - Math.max(bounds.left, 0));
    const visibleHeight = Math.max(0, Math.min(bounds.bottom, innerHeight) - Math.max(bounds.top, 0));
    return { video, area: visibleWidth * visibleHeight };
  });
  return candidates.filter(({ video, area }) => area > 10000 && !video.paused && !video.ended)
    .sort((left, right) => right.area - left.area)[0]?.video
    || candidates.filter(({ area }) => area > 10000).sort((left, right) => right.area - left.area)[0]?.video
    || (retained?.isConnected ? retained : null)
    || candidates[0]?.video
    || null;
}

const activeVideoExpression = `(${activeInstagramVideo.toString()})(${JSON.stringify(sourceToken)})`;

class InstagramVideoCaptureClient extends CdpPageClient {
  constructor(url, label, token, aspectRatio) {
    super(url, label);
    this.token = token;
    this.viewWidth = 368;
    this.viewHeight = Math.min(676, Math.round(this.viewWidth / Math.max(0.3, aspectRatio)));
    this.lastFrame = null;
  }

  async evaluate(expression, timeoutMs) {
    if (!expression.includes('__attuneComponentSmuggleSource?.captureRegion')) {
      return super.evaluate(expression, timeoutMs);
    }
    return super.evaluate(`(() => {
      const video = ${activeVideoExpression};
      if (!video) return null;
      return {
        x: 0, y: 0,
        width: ${this.viewWidth}, height: ${this.viewHeight},
        rootWidth: ${this.viewWidth}, rootHeight: ${this.viewHeight},
        offsetX: 0, offsetY: 0,
        screenX: Number(screenX) || 0, screenY: Number(screenY) || 0,
        outerWidth: Number(outerWidth) || innerWidth, outerHeight: Number(outerHeight) || innerHeight,
        innerWidth: Number(innerWidth) || 0, innerHeight: Number(innerHeight) || 0,
        contentOffsetX: 0, contentOffsetY: 0, pixelRatio: 1,
        continuousVisuals: !video.paused && !video.ended && video.readyState >= 2,
      };
    })()`, timeoutMs);
  }

  async captureComponentFrame() {
    const dataUrl = await super.evaluate(`(() => {
      const token = ${JSON.stringify(sourceToken)};
      const video = ${activeVideoExpression};
      if (!video?.isConnected || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null;
      const outputWidth = 540;
      const outputHeight = Math.max(1, Math.round(outputWidth * video.videoHeight / video.videoWidth));
      const canvas = globalThis.__attuneInstagramReelCaptureCanvas ||= document.createElement('canvas');
      if (canvas.width !== outputWidth) canvas.width = outputWidth;
      if (canvas.height !== outputHeight) canvas.height = outputHeight;
      const context = canvas.getContext('2d', { alpha: false, desynchronized: true });
      context.drawImage(video, 0, 0, outputWidth, outputHeight);
      return canvas.toDataURL('image/jpeg', 0.9);
    })()`, 4000);
    if (typeof dataUrl === 'string') {
      this.lastFrame = dataUrl.replace(/^data:image\/jpeg;base64,/, '');
    }
    return this.lastFrame;
  }
}

class InstagramVideoControlClient extends CdpPageClient {
  constructor(url, label, token, desiredPlaying) {
    super(url, label);
    this.token = token;
    this.desiredPlaying = desiredPlaying;
    this.lastNavigateAt = 0;
  }

  async clickAtComponentPosition(position = {}) {
    const shouldPlay = !this.desiredPlaying;
    this.desiredPlaying = shouldPlay;
    await super.evaluate(`(async () => {
      const video = ${activeVideoExpression};
      if (!video?.isConnected) return false;
      const bounds = video.getBoundingClientRect();
      const xRatio = ${Math.max(0, Math.min(1, Number(position.xRatio) || 0.5))};
      const yRatio = ${Math.max(0, Math.min(1, Number(position.yRatio) || 0.5))};
      document.elementFromPoint(bounds.left + bounds.width * xRatio, bounds.top + bounds.height * yRatio)?.click?.();
      if (${shouldPlay}) {
        await video.play();
      } else {
        video.pause();
      }
      return true;
    })()`);
  }

  async wheelAtComponentPosition(position = {}, deltaX, deltaY, modifiers) {
    if (Math.abs(deltaY) >= 24 && Math.abs(deltaY) >= Math.abs(deltaX)) {
      const now = Date.now();
      if (now - this.lastNavigateAt < 350) return;
      this.lastNavigateAt = now;
      const direction = deltaY > 0 ? 'next' : 'previous';
      const navigated = await super.evaluate(`(() => {
        const button = document.querySelector('[aria-label="Navigate to ${direction} Reel"]');
        button?.click?.();
        return Boolean(button);
      })()`);
      if (navigated) return;
    }
    const point = await super.evaluate(`(() => {
      const video = ${activeVideoExpression};
      const bounds = video?.getBoundingClientRect?.();
      if (!bounds) return null;
      return {
        x: bounds.left + bounds.width * ${Math.max(0, Math.min(1, Number(position.xRatio) || 0.5))},
        y: bounds.top + bounds.height * ${Math.max(0, Math.min(1, Number(position.yRatio) || 0.5))},
      };
    })()`);
    if (point) await super.wheel(point.x, point.y, deltaX, deltaY, modifiers);
  }

  async ensurePlayback() {
    if (!this.desiredPlaying) return;
    await super.evaluate(`(async () => {
      const video = ${activeVideoExpression};
      if (video?.paused && !video.ended) await video.play().catch(() => {});
      return Boolean(video && !video.paused);
    })()`);
  }
}

const sourceAspectRatio = sourceFingerprint.width / Math.max(1, sourceFingerprint.height);
const initiallyPlaying = await evaluate(sourcePage.webSocketDebuggerUrl, `(() => {
  const video = ${activeVideoExpression};
  return Boolean(video && !video.paused && !video.ended);
})()`);
const sourceVisualClient = new InstagramVideoCaptureClient(
  sourcePage.webSocketDebuggerUrl,
  'Instagram Reel source visual',
  sourceToken,
  sourceAspectRatio,
);
const sourceControlClient = new InstagramVideoControlClient(
  sourcePage.webSocketDebuggerUrl,
  'Instagram Reel source control',
  sourceToken,
  initiallyPlaying,
);

let finish;
const finished = new Promise((resolveFinished) => { finish = resolveFinished; });
const bridge = new ComponentSmuggleBridge(
  {
    appId: 'com.google.Chrome', appName: 'Google Chrome', appPid: sourcePid,
    webSocketDebuggerUrl: sourcePage.webSocketDebuggerUrl,
    anchor: {
      token: sourceToken, roles: [], selector: 'video', fingerprint: sourceFingerprint, placement: 'inside',
    },
  },
  {
    appId: 'com.openai.codex', appName: 'ChatGPT',
    webSocketDebuggerUrl: targetPage.webSocketDebuggerUrl,
    anchor: {
      token: targetToken, roles: [], selector: '[data-attune-reels-live-target]',
      fingerprint: targetFingerprint, placement: 'inside',
    },
  },
  (reason, error) => {
    if (error) console.error(error);
    console.log(`live-instagram-reels-stopped:${reason}`);
    finish();
  },
  async (chord) => {
    const modifiers = [
      chord.metaKey ? 'meta' : '', chord.ctrlKey ? 'ctrl' : '',
      chord.altKey ? 'alt' : '', chord.shiftKey ? 'shift' : '',
    ].filter(Boolean).join(',');
    await execFileAsync(keyForwarder, [String(sourcePid), chord.code, modifiers], { timeout: 2000 });
    return { transport: 'native', code: chord.code };
  },
  async (region, onFrame) => {
    const capture = spawn(windowStreamer, [
      String(sourcePid),
      String(Number(region.screenX) + Number(region.contentOffsetX || 0) + Number(region.x)),
      String(Number(region.screenY) + Number(region.contentOffsetY || 0) + Number(region.y)),
      String(region.width), String(region.height), String(frameRate), '0',
      String(region.screenX), String(region.screenY), String(region.outerWidth), String(region.outerHeight),
      String(region.nativeWindowId || 0),
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    capture.stdout.setEncoding('utf8');
    capture.stderr.setEncoding('utf8');
    let stdout = '';
    capture.stdout.on('data', (chunk) => {
      stdout += chunk;
      const lines = stdout.split(/\r?\n/);
      stdout = lines.pop() || '';
      for (const line of lines) if (line.length > 100) onFrame(line.trim());
    });
    await new Promise((resolveReady, reject) => {
      const timeout = setTimeout(() => reject(new Error('Instagram Reel surface stream timed out')), 10000);
      capture.stderr.on('data', (chunk) => {
        if (!String(chunk).includes('ready ')) return;
        clearTimeout(timeout);
        resolveReady();
      });
      capture.once('error', reject);
      capture.once('exit', (code) => { if (code) reject(new Error(`Reel surface stream exited with ${code}`)); });
    });
    return () => capture.kill();
  },
  { source: sourceControlClient, sourceVisual: sourceVisualClient },
);

let playbackTimer = null;
const restoreSourceVisibility = async () => {
  await evaluate(sourcePage.webSocketDebuggerUrl, `(() => {
    if (!globalThis.__attuneInstagramReelsVisibilityOverride) return true;
    delete document.hidden;
    delete document.visibilityState;
    delete globalThis.__attuneInstagramReelsVisibilityOverride;
    document.dispatchEvent(new Event('visibilitychange'));
    return true;
  })()`).catch(() => {});
};
const stop = async () => {
  if (playbackTimer) clearInterval(playbackTimer);
  await restoreSourceVisibility();
  await bridge.stop(true);
  finish();
};
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
const startPromise = bridge.start();
playbackTimer = setInterval(() => {
  void sourceControlClient.ensurePlayback().catch(() => {});
}, 500);
for (let attempt = 0; attempt < 40; attempt += 1) {
  const clamped = await evaluate(sourcePage.webSocketDebuggerUrl, `(() => {
    const runtime = globalThis.__attuneComponentSmuggleSource;
    if (!runtime?.captureRegion) return false;
    if (!runtime.__attuneReelsOriginalCaptureRegion) {
      runtime.__attuneReelsOriginalCaptureRegion = runtime.captureRegion.bind(runtime);
      runtime.captureRegion = () => {
        const region = runtime.__attuneReelsOriginalCaptureRegion();
        if (region) region.pixelRatio = 1;
        return region;
      };
    }
    return true;
  })()`).catch(() => false);
  if (clamped) break;
  await new Promise((resolveWait) => setTimeout(resolveWait, 50));
}
startPromise.catch((error) => {
  clearInterval(playbackTimer);
  console.error(error);
  finish();
});
console.log(`live-instagram-reels-ready:${sourceFingerprint.width}x${sourceFingerprint.height}@${frameRate}`);
await finished;
clearInterval(playbackTimer);
await restoreSourceVisibility();
