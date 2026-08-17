import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const experimentDirectory = dirname(fileURLToPath(import.meta.url));
const attuneRuntimeDirectory = resolve(experimentDirectory, '..', '..', '..', 'attune', 'dist');

const options = Object.fromEntries(process.argv.slice(2).map((argument) => {
  const [key, ...value] = argument.replace(/^--/, '').split('=');
  return [key, value.length ? value.join('=') : true];
}));

const sourcePort = Number(options['source-port'] || 55594);
const targetAppName = String(options.target || 'Linear');
const videoId = String(options.video || 'E7la7-dtfVM');
const demoMode = Boolean(options.demo);
const framesPerSecond = Math.max(1, Math.min(12, Number(options.fps || 7)));
const youtubeUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
const targetSelectors = {
  Linear: '[data-attune-host-roles~="linear.workspace"]',
  Slack: '[data-attune-host-roles~="slack.workspace"]',
};
const targetSelector = targetSelectors[targetAppName];
const proofPath = join(
  experimentDirectory,
  `youtube-in-${targetAppName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-proof.png`,
);

if (!targetSelector) {
  throw new Error(`Unsupported target ${targetAppName}; expected one of ${Object.keys(targetSelectors).join(', ')}`);
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

class CdpClient {
  constructor(webSocketUrl, label) {
    this.webSocketUrl = webSocketUrl;
    this.label = label;
    this.nextId = 1;
    this.pending = new Map();
    this.socket = null;
  }

  async connect() {
    this.socket = new WebSocket(this.webSocketUrl);
    await new Promise((resolveConnect, reject) => {
      const timeout = setTimeout(() => reject(new Error(`${this.label} CDP connection timed out`)), 5000);
      this.socket.addEventListener('open', () => {
        clearTimeout(timeout);
        resolveConnect();
      }, { once: true });
      this.socket.addEventListener('error', () => {
        clearTimeout(timeout);
        reject(new Error(`${this.label} CDP connection failed`));
      }, { once: true });
    });

    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.error) pending.reject(new Error(`${this.label} ${pending.method}: ${message.error.message}`));
      else pending.resolve(message.result);
    });
  }

  send(method, params = {}, timeoutMilliseconds = 15000) {
    if (!this.socket) throw new Error(`${this.label} CDP client is not connected`);
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolveCommand, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${this.label} ${method} timed out`));
      }, timeoutMilliseconds);
      this.pending.set(id, { method, resolve: resolveCommand, reject, timeout });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, options = {}) {
    const response = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: options.awaitPromise ?? true,
      returnByValue: true,
      userGesture: options.userGesture ?? false,
    }, options.timeout ?? 20000);
    if (response.exceptionDetails) {
      const detail = response.exceptionDetails.exception?.description
        || response.exceptionDetails.text
        || 'Unknown evaluation error';
      throw new Error(`${this.label} evaluation failed: ${detail}`);
    }
    return response.result?.value;
  }

  close() {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(`${this.label} CDP connection closed`));
    }
    this.pending.clear();
    this.socket?.close();
    this.socket = null;
  }
}

async function resolveAttunePageTarget(appName) {
  const [{ scanForSupportedApps, getAppId }, { getSession }] = await Promise.all([
    import(pathToFileURL(join(attuneRuntimeDirectory, 'scan.js')).href),
    import(pathToFileURL(join(attuneRuntimeDirectory, 'session.js')).href),
  ]);
  const app = scanForSupportedApps().find((candidate) => candidate.name === appName);
  if (!app) throw new Error(`${appName} is not installed as a supported Attune app`);
  const session = getSession(getAppId(app));
  if (!session || session.status !== 'attached') {
    throw new Error(`${appName} is not attached in Attune; open it through Attune first`);
  }
  const targets = await fetch(`http://127.0.0.1:${session.port}/json`).then((response) => response.json());
  const target = targets.find((candidate) => candidate.type === 'page' && candidate.webSocketDebuggerUrl);
  if (!target) throw new Error(`${appName} has no page target`);
  return { session, target };
}

async function createYoutubeTarget() {
  const response = await fetch(
    `http://127.0.0.1:${sourcePort}/json/new?${encodeURIComponent(youtubeUrl)}`,
    { method: 'PUT' },
  );
  if (!response.ok) throw new Error(`Could not open YouTube on Chrome debug port ${sourcePort}`);
  const target = await response.json();
  if (!target.webSocketDebuggerUrl) throw new Error('The new YouTube tab has no CDP endpoint');
  return target;
}

async function closeChromeTarget(targetId) {
  if (!targetId) return;
  await fetch(`http://127.0.0.1:${sourcePort}/json/close/${encodeURIComponent(targetId)}`).catch(() => {});
}

async function waitForYoutubePlayer(client, timeout = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    const state = await client.evaluate(`(() => {
      const video = document.querySelector('video.html5-main-video');
      const player = document.querySelector('.html5-video-player');
      if (!video || !player) return null;
      const rect = player.getBoundingClientRect();
      return {
        readyState: video.readyState,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        title: document.title,
      };
    })()`);
    if (state?.width > 100 && state?.height > 100) return state;
    await delay(250);
  }
  throw new Error('Timed out waiting for the YouTube player');
}

async function inspectSourceVideo(client) {
  return client.evaluate(`(async () => {
    const video = document.querySelector('video.html5-main-video');
    if (!video) return null;
    video.muted = true;
    let playError = null;
    try { await video.play(); } catch (error) { playError = String(error?.message || error); }
    await new Promise((resolve) => setTimeout(resolve, 350));
    const current = video.currentSrc || '';
    let sourceKind = 'none';
    if (current.startsWith('blob:')) sourceKind = 'blob';
    else if (current) sourceKind = 'network';
    return {
      sourceKind,
      hasSrcAttribute: video.hasAttribute('src'),
      sourceHost: (() => { try { return new URL(current).host; } catch { return ''; } })(),
      currentSrc: current,
      srcAttribute: video.getAttribute('src') || '',
      readyState: video.readyState,
      networkState: video.networkState,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      paused: video.paused,
      currentTime: video.currentTime,
      playError,
    };
  })()`);
}

function installTargetExpression(sourceInfo) {
  return `(() => {
    globalThis.__attuneYoutubeSmuggle?.cleanup?.();
    document.querySelector('#attune-youtube-smuggle-panel')?.remove();
    const workspace = document.querySelector(${JSON.stringify(targetSelector)});
    if (!workspace) return { ok: false, reason: 'target-workspace-not-found' };

    const panel = document.createElement('section');
    panel.id = 'attune-youtube-smuggle-panel';
    panel.setAttribute('aria-label', 'YouTube video smuggled by Attune');
    Object.assign(panel.style, {
      position: 'fixed',
      right: '24px',
      bottom: '92px',
      zIndex: '2147483000',
      width: '500px',
      padding: '12px',
      border: '1px solid rgba(255,255,255,.18)',
      borderRadius: '16px',
      background: 'rgb(18,19,22)',
      boxShadow: '0 24px 80px rgba(0,0,0,.5)',
      color: 'rgb(239,239,242)',
      font: '12px/1.35 system-ui, sans-serif',
      boxSizing: 'border-box',
    });

    const header = document.createElement('header');
    Object.assign(header.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '12px',
      margin: '0 2px 10px',
    });
    const heading = document.createElement('div');
    const title = document.createElement('div');
    title.textContent = 'Fireship · YouTube';
    Object.assign(title.style, { fontWeight: '700', fontSize: '13px' });
    const subtitle = document.createElement('div');
    subtitle.textContent = 'Live surface smuggled into ${targetAppName}';
    Object.assign(subtitle.style, { marginTop: '2px', color: 'rgb(157,160,169)', fontSize: '11px' });
    heading.append(title, subtitle);

    const close = document.createElement('button');
    close.type = 'button';
    close.setAttribute('aria-label', 'Remove smuggled YouTube video');
    close.textContent = '×';
    Object.assign(close.style, {
      appearance: 'none', border: '0', padding: '2px 5px', borderRadius: '6px',
      background: 'transparent', color: 'rgb(180,182,190)', font: '20px/1 system-ui, sans-serif',
      cursor: 'pointer',
    });
    header.append(heading, close);

    const surface = document.createElement('img');
    surface.id = 'attune-youtube-smuggle-surface';
    surface.alt = 'Live Fireship video surface';
    surface.tabIndex = 0;
    Object.assign(surface.style, {
      display: 'block',
      width: '476px',
      aspectRatio: '16 / 9',
      objectFit: 'cover',
      borderRadius: '10px',
      background: 'black',
      cursor: 'default',
      outline: 'none',
      userSelect: 'none',
      WebkitUserDrag: 'none',
    });

    const footer = document.createElement('footer');
    Object.assign(footer.style, {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      margin: '9px 2px 0', color: 'rgb(148,151,160)', fontSize: '10px',
    });
    const mode = document.createElement('span');
    mode.textContent = 'DOM media: ${sourceInfo.sourceKind === 'blob' ? 'renderer-bound' : 'not self-contained'} · surface: live';
    const stats = document.createElement('span');
    stats.textContent = 'connecting…';
    footer.append(mode, stats);
    panel.append(header, surface, footer);
    workspace.append(panel);

    const outbox = [];
    let lastMoveAt = 0;
    const enqueuePointer = (event, kind) => {
      const rect = surface.getBoundingClientRect();
      if (globalThis.__attuneYoutubeSmuggle) {
        globalThis.__attuneYoutubeSmuggle.lastTargetEventTrusted = event.isTrusted;
      }
      outbox.push({
        kind,
        x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
        y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
        button: event.button,
        trusted: event.isTrusted,
      });
    };
    surface.addEventListener('pointerdown', (event) => {
      surface.focus();
      enqueuePointer(event, 'pointerdown');
    });
    surface.addEventListener('pointerup', (event) => enqueuePointer(event, 'pointerup'));
    surface.addEventListener('pointermove', (event) => {
      const now = performance.now();
      if (now - lastMoveAt < 60) return;
      lastMoveAt = now;
      enqueuePointer(event, 'pointermove');
    });

    const cleanup = () => {
      panel.remove();
      delete globalThis.__attuneYoutubeSmuggle;
    };
    close.addEventListener('click', cleanup, { once: true });
    globalThis.__attuneYoutubeSmuggle = {
      panel, surface, stats, outbox, cleanup,
      frames: 0,
      firstFrameAt: 0,
      lastTargetEventTrusted: null,
      setFrame(data) {
        surface.src = 'data:image/jpeg;base64,' + data;
        this.frames += 1;
        if (!this.firstFrameAt) this.firstFrameAt = performance.now();
        const elapsed = Math.max(1, performance.now() - this.firstFrameAt);
        const fps = this.frames <= 1 ? 0 : ((this.frames - 1) * 1000 / elapsed);
        stats.textContent = this.frames + ' frames · ' + fps.toFixed(1) + ' fps';
      },
    };
    return { ok: true, panelConnected: panel.isConnected, width: panel.getBoundingClientRect().width };
  })()`;
}

async function probeDirectVideoTransplant(targetClient, sourceInfo) {
  const sourceMetadata = await targetClient.evaluate(`(async () => {
    const probe = document.createElement('video');
    probe.id = 'attune-youtube-direct-video-probe';
    probe.muted = true;
    probe.playsInline = true;
    Object.assign(probe.style, { position: 'fixed', left: '-10000px', width: '320px', height: '180px' });
    document.documentElement.append(probe);
    let error = null;
    let playError = null;
    probe.addEventListener('error', () => { error = probe.error?.message || 'media-error'; }, { once: true });
    const sourceUrl = ${JSON.stringify(sourceInfo.srcAttribute || '')};
    if (sourceUrl) probe.src = sourceUrl;
    const playOutcome = await Promise.race([
      probe.play().then(() => 'playing').catch((cause) => {
        playError = String(cause?.message || cause);
        return 'rejected';
      }),
      new Promise((resolve) => setTimeout(() => resolve('timed-out'), 1200)),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const result = {
      readyState: probe.readyState,
      networkState: probe.networkState,
      videoWidth: probe.videoWidth,
      videoHeight: probe.videoHeight,
      playable: probe.readyState >= 2 && probe.videoWidth > 0,
      playOutcome,
      error,
      playError,
    };
    probe.remove();
    return result;
  })()`);
  return {
    ...sourceMetadata,
    reason: sourceInfo.hasSrcAttribute
      ? 'The copied tag has an address but not YouTube player state or buffers.'
      : 'The copied tag has no src attribute; currentSrc is runtime-only media state.',
  };
}

async function sourcePlayerRect(sourceClient) {
  return sourceClient.evaluate(`(() => {
    const player = document.querySelector('.html5-video-player');
    if (!player) return null;
    const rect = player.getBoundingClientRect();
    return {
      x: Math.max(0, rect.x),
      y: Math.max(0, rect.y),
      width: Math.max(1, Math.min(rect.width, innerWidth - Math.max(0, rect.x))),
      height: Math.max(1, Math.min(rect.height, innerHeight - Math.max(0, rect.y))),
      scale: 1,
    };
  })()`);
}

async function relayTargetActions(targetClient, sourceClient) {
  const actions = await targetClient.evaluate(`globalThis.__attuneYoutubeSmuggle?.outbox.splice(0) || []`);
  if (!actions?.length) return 0;
  const rect = await sourcePlayerRect(sourceClient);
  if (!rect) return 0;
  for (const action of actions) {
    const x = rect.x + action.x * rect.width;
    const y = rect.y + action.y * rect.height;
    const type = {
      pointerdown: 'mousePressed',
      pointerup: 'mouseReleased',
      pointermove: 'mouseMoved',
    }[action.kind];
    if (!type) continue;
    await sourceClient.send('Input.dispatchMouseEvent', {
      type,
      x,
      y,
      button: action.button === 2 ? 'right' : 'left',
      buttons: type === 'mousePressed' ? 1 : 0,
      clickCount: type === 'mouseMoved' ? 0 : 1,
    });
  }
  return actions.length;
}

async function clickTargetSurface(targetClient) {
  const point = await targetClient.evaluate(`(() => {
    const rect = globalThis.__attuneYoutubeSmuggle.surface.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await targetClient.send('Input.dispatchMouseEvent', {
      type,
      x: point.x,
      y: point.y,
      button: 'left',
      buttons: type === 'mousePressed' ? 1 : 0,
      clickCount: 1,
    });
  }
}

async function captureTargetProof(targetClient) {
  try {
    const panelClip = await targetClient.evaluate(`(() => {
      const rect = globalThis.__attuneYoutubeSmuggle.panel.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 };
    })()`);
    const proof = await targetClient.send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: false, fromSurface: true, clip: panelClip,
    }, 30000);
    writeFileSync(proofPath, Buffer.from(proof.data, 'base64'));
    return proofPath;
  } catch (error) {
    console.warn(`[youtube-smuggle] proof screenshot unavailable: ${error.message}`);
    return null;
  }
}

async function main() {
  const targetTarget = await resolveAttunePageTarget(targetAppName);
  const youtubeTarget = await createYoutubeTarget();
  const sourceClient = new CdpClient(youtubeTarget.webSocketDebuggerUrl, 'YouTube');
  const targetClient = new CdpClient(targetTarget.target.webSocketDebuggerUrl, targetAppName);
  let shouldCloseYoutubeTarget = true;
  let report = null;

  try {
    await Promise.all([sourceClient.connect(), targetClient.connect()]);
    await Promise.all([
      sourceClient.send('Page.enable'),
      sourceClient.send('Runtime.enable'),
      targetClient.send('Page.enable'),
      targetClient.send('Runtime.enable'),
    ]);
    await waitForYoutubePlayer(sourceClient);
    const sourceInfo = await inspectSourceVideo(sourceClient);
    assert.ok(sourceInfo, 'YouTube video element was not found');
    await sourceClient.evaluate(`(() => {
      const listener = (event) => {
        const player = document.querySelector('.html5-video-player');
        if (player?.contains(event.target)) globalThis.__attuneYoutubeLastInputTrusted = event.isTrusted;
      };
      document.addEventListener('click', listener, true);
      globalThis.__attuneYoutubeInputListener = listener;
    })()`);
    console.log('[youtube-smuggle] YouTube player ready');

    const targetInstallation = await targetClient.evaluate(installTargetExpression(sourceInfo));
    assert.equal(targetInstallation?.ok, true, `Target installation failed: ${targetInstallation?.reason}`);
    console.log(`[youtube-smuggle] receiver installed in ${targetAppName}`);
    const directProbe = await probeDirectVideoTransplant(targetClient, sourceInfo);
    console.log(`[youtube-smuggle] strict DOM video playable: ${directProbe.playable}`);

    let firstFrameHash = null;
    let lastFrameHash = null;
    let framesSent = 0;
    let actionsRelayed = 0;
    const startedAt = Date.now();
    const minimumFrames = demoMode ? 2 : 18;
    const minimumDuration = demoMode ? 0 : 3000;

    while (true) {
      const panelConnected = await targetClient.evaluate(`Boolean(globalThis.__attuneYoutubeSmuggle?.panel?.isConnected)`);
      if (!panelConnected) break;

      const clip = await sourcePlayerRect(sourceClient);
      if (!clip) throw new Error('YouTube player disappeared');
      const frame = await sourceClient.send('Page.captureScreenshot', {
        format: 'jpeg',
        quality: 72,
        captureBeyondViewport: false,
        fromSurface: true,
        clip,
      }, 20000);
      const hash = createHash('sha256').update(frame.data).digest('hex');
      firstFrameHash ||= hash;
      lastFrameHash = hash;
      framesSent += 1;
      await targetClient.evaluate(`globalThis.__attuneYoutubeSmuggle?.setFrame(${JSON.stringify(frame.data)})`);
      if (!demoMode && (framesSent === 5 || framesSent === 11)) await clickTargetSurface(targetClient);
      actionsRelayed += await relayTargetActions(targetClient, sourceClient);

      if (!demoMode && framesSent >= minimumFrames && Date.now() - startedAt >= minimumDuration) break;
      if (demoMode && framesSent === minimumFrames) {
        const capturedProofPath = await captureTargetProof(targetClient);
        console.log(JSON.stringify({
          mode: 'youtube-surface-demo',
          ready: true,
          source: 'Fireship on YouTube',
          target: targetAppName,
          directDomPlayable: directProbe.playable,
          liveSurface: true,
          inputRelay: 'target pointer events -> native Chromium input on YouTube',
          proofPath: capturedProofPath,
          instructions: `Use the video inside ${targetAppName}; click × to remove it and stop the bridge.`,
        }, null, 2));
      }
      await delay(Math.round(1000 / framesPerSecond));
    }

    if (!demoMode) {
      const targetVisualState = await targetClient.evaluate(`(() => ({
        frames: globalThis.__attuneYoutubeSmuggle.frames,
        imageWidth: globalThis.__attuneYoutubeSmuggle.surface.naturalWidth,
        imageHeight: globalThis.__attuneYoutubeSmuggle.surface.naturalHeight,
        lastTargetEventTrusted: globalThis.__attuneYoutubeSmuggle.lastTargetEventTrusted,
      }))()`);
      const sourceInputTrusted = await sourceClient.evaluate(`globalThis.__attuneYoutubeLastInputTrusted`);
      const capturedProofPath = await captureTargetProof(targetClient);
      assert.notEqual(firstFrameHash, lastFrameHash, 'Captured YouTube frames did not change');
      assert.ok(targetVisualState.imageWidth > 0 && targetVisualState.imageHeight > 0, 'Target image did not decode');
      assert.ok(actionsRelayed >= 4, 'Target clicks were not relayed to YouTube');
      report = {
        mode: 'youtube-to-app-surface-test',
        source: {
          service: 'YouTube',
          channel: 'Fireship',
          videoId,
          rendererPort: sourcePort,
          media: {
            sourceKind: sourceInfo.sourceKind,
            hasSrcAttribute: sourceInfo.hasSrcAttribute,
            sourceHost: sourceInfo.sourceHost,
            readyState: sourceInfo.readyState,
            networkState: sourceInfo.networkState,
            videoWidth: sourceInfo.videoWidth,
            videoHeight: sourceInfo.videoHeight,
            paused: sourceInfo.paused,
            playError: sourceInfo.playError,
          },
        },
        target: {
          app: targetAppName,
          rendererPort: targetTarget.session.port,
          semanticSelector: targetSelector,
        },
        directTransplant: directProbe,
        surfaceTransplant: {
          framesSent,
          framesChanged: firstFrameHash !== lastFrameHash,
          actionsRelayed,
          requestedFps: framesPerSecond,
          targetImageDecoded: targetVisualState.imageWidth > 0,
        },
        inputTrust: {
          targetPhysicalEventTrusted: targetVisualState.lastTargetEventTrusted,
          youtubeReconstructedInputTrusted: sourceInputTrusted,
        },
        proofPath: capturedProofPath,
      };
    }
  } finally {
    await sourceClient.evaluate(`(() => {
      if (globalThis.__attuneYoutubeInputListener) {
        document.removeEventListener('click', globalThis.__attuneYoutubeInputListener, true);
        delete globalThis.__attuneYoutubeInputListener;
      }
      delete globalThis.__attuneYoutubeLastInputTrusted;
    })()`).catch(() => {});
    await targetClient.evaluate(`globalThis.__attuneYoutubeSmuggle?.cleanup?.()`).catch(() => {});
    sourceClient.close();
    targetClient.close();
    if (shouldCloseYoutubeTarget) await closeChromeTarget(youtubeTarget.id);
  }

  if (report) console.log(JSON.stringify({ ...report, cleanedUp: true }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
