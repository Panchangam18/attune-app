import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
const youtubeUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
const targetSelectors = {
  Linear: '[data-attune-host-roles~="linear.workspace"]',
  Slack: '[data-attune-host-roles~="slack.workspace"]',
};
const targetSelector = targetSelectors[targetAppName];
const proofPath = join(
  experimentDirectory,
  `youtube-webrtc-in-${targetAppName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-proof.png`,
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
      if (!video) return null;
      return {
        readyState: video.readyState,
        width: video.videoWidth,
        height: video.videoHeight,
        captureStream: typeof video.captureStream === 'function',
      };
    })()`);
    if (state?.readyState >= 2 && state.width > 0) return state;
    await delay(250);
  }
  throw new Error('Timed out waiting for the YouTube player');
}

function sourceOfferExpression() {
  return `(async () => {
    globalThis.__attuneYoutubeWebRtcSource?.cleanup?.();
    const video = document.querySelector('video.html5-main-video');
    if (!video) return { ok: false, reason: 'video-not-found' };
    if (typeof video.captureStream !== 'function') return { ok: false, reason: 'capture-stream-unsupported' };

    video.muted = true;
    await video.play();
    const stream = video.captureStream();
    const tracks = stream.getTracks();
    if (!tracks.some((track) => track.kind === 'video')) {
      for (const track of tracks) track.stop();
      return { ok: false, reason: 'capture-stream-has-no-video-track' };
    }

    const pc = new RTCPeerConnection({ iceServers: [] });
    for (const track of tracks) pc.addTrack(track, stream);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    if (pc.iceGatheringState !== 'complete') {
      await Promise.race([
        new Promise((resolve) => pc.addEventListener('icegatheringstatechange', () => {
          if (pc.iceGatheringState === 'complete') resolve();
        })),
        new Promise((resolve) => setTimeout(resolve, 4000)),
      ]);
    }

    const cleanup = () => {
      for (const track of stream.getTracks()) track.stop();
      pc.close();
      delete globalThis.__attuneYoutubeWebRtcSource;
    };
    globalThis.__attuneYoutubeWebRtcSource = { video, stream, pc, cleanup };
    return {
      ok: true,
      description: pc.localDescription.toJSON(),
      tracks: tracks.map((track) => ({ kind: track.kind, readyState: track.readyState, muted: track.muted })),
      source: {
        width: video.videoWidth,
        height: video.videoHeight,
        duration: video.duration,
        currentTime: video.currentTime,
        paused: video.paused,
      },
    };
  })()`;
}

function targetAnswerExpression(offer) {
  return `(async () => {
    globalThis.__attuneYoutubeSmuggle?.cleanup?.();
    document.querySelector('#attune-youtube-smuggle-panel')?.remove();
    globalThis.__attuneYoutubeWebRtcTarget?.cleanup?.();
    document.querySelector('#attune-youtube-webrtc-panel')?.remove();
    const workspace = document.querySelector(${JSON.stringify(targetSelector)});
    if (!workspace) return { ok: false, reason: 'target-workspace-not-found' };

    const panel = document.createElement('section');
    panel.id = 'attune-youtube-webrtc-panel';
    panel.setAttribute('aria-label', 'Live YouTube media transplanted by Attune');
    Object.assign(panel.style, {
      position: 'fixed', right: '24px', bottom: '92px', zIndex: '2147483000',
      width: '500px', padding: '12px', boxSizing: 'border-box',
      border: '1px solid rgba(255,255,255,.18)', borderRadius: '16px',
      background: 'rgb(18,19,22)', boxShadow: '0 24px 80px rgba(0,0,0,.5)',
      color: 'rgb(239,239,242)', font: '12px/1.35 system-ui, sans-serif',
    });

    const header = document.createElement('header');
    Object.assign(header.style, {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: '12px', margin: '0 2px 10px',
    });
    const heading = document.createElement('div');
    const title = document.createElement('div');
    title.textContent = 'Fireship · direct media track';
    Object.assign(title.style, { fontWeight: '700', fontSize: '13px' });
    const subtitle = document.createElement('div');
    subtitle.textContent = 'YouTube → WebRTC → ${targetAppName}';
    Object.assign(subtitle.style, { marginTop: '2px', color: 'rgb(157,160,169)', fontSize: '11px' });
    heading.append(title, subtitle);
    const close = document.createElement('button');
    close.type = 'button';
    close.setAttribute('aria-label', 'Remove transplanted YouTube video');
    close.textContent = '×';
    Object.assign(close.style, {
      appearance: 'none', border: '0', padding: '2px 5px', borderRadius: '6px',
      background: 'transparent', color: 'rgb(180,182,190)', font: '20px/1 system-ui, sans-serif',
      cursor: 'pointer',
    });
    header.append(heading, close);

    const video = document.createElement('video');
    video.id = 'attune-youtube-webrtc-video';
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    Object.assign(video.style, {
      display: 'block', width: '476px', aspectRatio: '16 / 9', objectFit: 'contain',
      borderRadius: '10px', background: 'black',
    });

    const controls = document.createElement('div');
    Object.assign(controls.style, {
      display: 'grid', gridTemplateColumns: 'auto 1fr auto', alignItems: 'center',
      gap: '9px', margin: '10px 2px 1px',
    });
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.textContent = 'Pause';
    const seek = document.createElement('input');
    seek.type = 'range';
    seek.min = '0'; seek.max = '1000'; seek.value = '0'; seek.step = '1';
    seek.setAttribute('aria-label', 'Video position');
    const audio = document.createElement('button');
    audio.type = 'button';
    audio.textContent = 'Enable audio';
    for (const button of [toggle, audio]) Object.assign(button.style, {
      appearance: 'none', border: '1px solid rgba(255,255,255,.15)', borderRadius: '7px',
      padding: '5px 8px', background: 'rgb(39,41,47)', color: 'rgb(230,231,235)',
      font: '11px/1.2 system-ui, sans-serif', cursor: 'pointer',
    });
    controls.append(toggle, seek, audio);

    const status = document.createElement('div');
    status.textContent = 'Negotiating direct media track…';
    Object.assign(status.style, { margin: '8px 2px 0', color: 'rgb(148,151,160)', fontSize: '10px' });
    panel.append(header, video, controls, status);
    workspace.append(panel);

    const commands = [];
    toggle.addEventListener('click', (event) => {
      commands.push({ kind: 'toggle', trusted: event.isTrusted });
    });
    seek.addEventListener('change', (event) => {
      commands.push({ kind: 'seek', ratio: Number(seek.value) / 1000, trusted: event.isTrusted });
    });
    audio.addEventListener('click', async () => {
      video.muted = !video.muted;
      audio.textContent = video.muted ? 'Enable audio' : 'Mute';
      await video.play().catch(() => {});
    });

    const pc = new RTCPeerConnection({ iceServers: [] });
    const stream = new MediaStream();
    pc.addEventListener('track', (event) => {
      stream.addTrack(event.track);
      video.srcObject = stream;
      video.play().catch(() => {});
    });
    pc.addEventListener('connectionstatechange', () => {
      status.textContent = 'Media track: ' + pc.connectionState + ' · frames: ' + state.frames;
    });
    let state = null;
    let frameHandle = 0;
    const countFrame = () => {
      if (!state) return;
      state.frames += 1;
      status.textContent = 'Media track: ' + pc.connectionState + ' · frames: ' + state.frames;
      frameHandle = video.requestVideoFrameCallback(countFrame);
    };
    if (typeof video.requestVideoFrameCallback === 'function') frameHandle = video.requestVideoFrameCallback(countFrame);

    const cleanup = () => {
      if (frameHandle && typeof video.cancelVideoFrameCallback === 'function') video.cancelVideoFrameCallback(frameHandle);
      for (const track of stream.getTracks()) track.stop();
      pc.close();
      video.srcObject = null;
      panel.remove();
      delete globalThis.__attuneYoutubeWebRtcTarget;
    };
    close.addEventListener('click', cleanup, { once: true });
    state = globalThis.__attuneYoutubeWebRtcTarget = {
      panel, video, toggle, seek, audio, status, pc, stream, commands, cleanup,
      frames: 0,
      updatePlayback(playback) {
        toggle.textContent = playback.paused ? 'Play' : 'Pause';
        if (!seek.matches(':active') && Number.isFinite(playback.duration) && playback.duration > 0) {
          seek.value = String(Math.round(playback.currentTime / playback.duration * 1000));
        }
      },
    };

    await pc.setRemoteDescription(${JSON.stringify(offer)});
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    if (pc.iceGatheringState !== 'complete') {
      await Promise.race([
        new Promise((resolve) => pc.addEventListener('icegatheringstatechange', () => {
          if (pc.iceGatheringState === 'complete') resolve();
        })),
        new Promise((resolve) => setTimeout(resolve, 4000)),
      ]);
    }
    return { ok: true, description: pc.localDescription.toJSON(), panelConnected: panel.isConnected };
  })()`;
}

async function waitForConnected(sourceClient, targetClient, timeout = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    const [source, target] = await Promise.all([
      sourceClient.evaluate(`(() => ({
        connectionState: globalThis.__attuneYoutubeWebRtcSource?.pc?.connectionState,
        iceConnectionState: globalThis.__attuneYoutubeWebRtcSource?.pc?.iceConnectionState,
      }))()`),
      targetClient.evaluate(`(() => ({
        connectionState: globalThis.__attuneYoutubeWebRtcTarget?.pc?.connectionState,
        iceConnectionState: globalThis.__attuneYoutubeWebRtcTarget?.pc?.iceConnectionState,
        readyState: globalThis.__attuneYoutubeWebRtcTarget?.video?.readyState,
        width: globalThis.__attuneYoutubeWebRtcTarget?.video?.videoWidth,
      }))()`),
    ]);
    if (source.connectionState === 'connected' && target.connectionState === 'connected' && target.width > 0) {
      return { source, target };
    }
    if (source.connectionState === 'failed' || target.connectionState === 'failed') {
      throw new Error(`WebRTC failed: source=${JSON.stringify(source)} target=${JSON.stringify(target)}`);
    }
    await delay(100);
  }
  throw new Error('Timed out waiting for the direct media track');
}

async function pumpPlayback(sourceClient, targetClient) {
  const commands = await targetClient.evaluate(`globalThis.__attuneYoutubeWebRtcTarget?.commands.splice(0) || []`);
  for (const command of commands || []) {
    if (command.kind === 'toggle') {
      await sourceClient.evaluate(`(() => {
        const video = globalThis.__attuneYoutubeWebRtcSource.video;
        if (video.paused) return video.play();
        video.pause();
      })()`, { userGesture: true });
    } else if (command.kind === 'seek') {
      await sourceClient.evaluate(`(() => {
        const video = globalThis.__attuneYoutubeWebRtcSource.video;
        video.currentTime = ${Number(command.ratio)} * video.duration;
      })()`);
    }
  }
  const playback = await sourceClient.evaluate(`(() => {
    const video = globalThis.__attuneYoutubeWebRtcSource.video;
    return { currentTime: video.currentTime, duration: video.duration, paused: video.paused };
  })()`);
  await targetClient.evaluate(`globalThis.__attuneYoutubeWebRtcTarget?.updatePlayback(${JSON.stringify(playback)})`);
  return { playback, commands };
}

async function clickTargetButton(targetClient, buttonName) {
  const point = await targetClient.evaluate(`(() => {
    const element = globalThis.__attuneYoutubeWebRtcTarget[${JSON.stringify(buttonName)}];
    const rect = element.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await targetClient.send('Input.dispatchMouseEvent', {
      type, x: point.x, y: point.y, button: 'left',
      buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1,
    });
  }
}

async function captureProof(targetClient) {
  const clip = await targetClient.evaluate(`(() => {
    const rect = globalThis.__attuneYoutubeWebRtcTarget.panel.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 };
  })()`);
  const proof = await targetClient.send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: false, fromSurface: true, clip,
  }, 30000);
  writeFileSync(proofPath, Buffer.from(proof.data, 'base64'));
  return proofPath;
}

async function main() {
  const targetTarget = await resolveAttunePageTarget(targetAppName);
  const youtubeTarget = await createYoutubeTarget();
  const sourceClient = new CdpClient(youtubeTarget.webSocketDebuggerUrl, 'YouTube');
  const targetClient = new CdpClient(targetTarget.target.webSocketDebuggerUrl, targetAppName);
  let report = null;

  try {
    await Promise.all([sourceClient.connect(), targetClient.connect()]);
    await Promise.all([
      sourceClient.send('Page.enable'), sourceClient.send('Runtime.enable'),
      targetClient.send('Page.enable'), targetClient.send('Runtime.enable'),
    ]);
    const player = await waitForYoutubePlayer(sourceClient);
    assert.equal(player.captureStream, true, 'This Chromium build does not support video.captureStream()');
    const sourceOffer = await sourceClient.evaluate(sourceOfferExpression(), { timeout: 30000, userGesture: true });
    assert.equal(sourceOffer?.ok, true, `Source capture failed: ${sourceOffer?.reason}`);
    console.log(`[youtube-webrtc] captured tracks: ${sourceOffer.tracks.map((track) => track.kind).join(', ')}`);

    const targetAnswer = await targetClient.evaluate(targetAnswerExpression(sourceOffer.description), { timeout: 30000 });
    assert.equal(targetAnswer?.ok, true, `Target receiver failed: ${targetAnswer?.reason}`);
    await sourceClient.evaluate(`globalThis.__attuneYoutubeWebRtcSource.pc.setRemoteDescription(${JSON.stringify(targetAnswer.description)})`);
    const connected = await waitForConnected(sourceClient, targetClient);
    console.log(`[youtube-webrtc] direct media track connected to ${targetAppName}`);
    execFileSync('/usr/bin/open', ['-a', targetAppName]);
    await delay(500);

    await pumpPlayback(sourceClient, targetClient);
    const initial = await targetClient.evaluate(`(() => ({
      currentTime: globalThis.__attuneYoutubeWebRtcTarget.video.currentTime,
      frames: globalThis.__attuneYoutubeWebRtcTarget.frames,
      width: globalThis.__attuneYoutubeWebRtcTarget.video.videoWidth,
      height: globalThis.__attuneYoutubeWebRtcTarget.video.videoHeight,
    }))()`);

    if (demoMode) {
      await delay(1200);
      await pumpPlayback(sourceClient, targetClient);
      const ready = await targetClient.evaluate(`(() => ({
        currentTime: globalThis.__attuneYoutubeWebRtcTarget.video.currentTime,
        frames: globalThis.__attuneYoutubeWebRtcTarget.frames,
        width: globalThis.__attuneYoutubeWebRtcTarget.video.videoWidth,
        height: globalThis.__attuneYoutubeWebRtcTarget.video.videoHeight,
      }))()`);
      const capturedProofPath = await captureProof(targetClient).catch(() => null);
      console.log(JSON.stringify({
        mode: 'youtube-webrtc-demo', ready: true, source: 'Fireship on YouTube', target: targetAppName,
        transport: 'HTMLVideoElement.captureStream() -> WebRTC -> HTMLVideoElement',
        sourceTracks: sourceOffer.tracks.map((track) => track.kind),
        targetVideo: { width: ready.width, height: ready.height },
        framesObserved: ready.frames,
        proofPath: capturedProofPath,
        instructions: `Use the controls in ${targetAppName}; click × to stop the bridge.`,
      }, null, 2));
      while (await targetClient.evaluate(`Boolean(globalThis.__attuneYoutubeWebRtcTarget?.panel?.isConnected)`)) {
        await pumpPlayback(sourceClient, targetClient);
        await delay(100);
      }
      return;
    }

    const startedAt = Date.now();
    while (Date.now() - startedAt < 4000) {
      await pumpPlayback(sourceClient, targetClient);
      await delay(100);
    }
    const backgroundPlayback = await targetClient.evaluate(`(() => ({
      currentTime: globalThis.__attuneYoutubeWebRtcTarget.video.currentTime,
      frames: globalThis.__attuneYoutubeWebRtcTarget.frames,
      width: globalThis.__attuneYoutubeWebRtcTarget.video.videoWidth,
      height: globalThis.__attuneYoutubeWebRtcTarget.video.videoHeight,
    }))()`);
    const sourceVisibility = await sourceClient.evaluate(`document.visibilityState`);
    const elapsedMedia = backgroundPlayback.currentTime - initial.currentTime;
    const framesObserved = backgroundPlayback.frames - initial.frames;
    assert.ok(elapsedMedia > 2.5, `Receiver advanced only ${elapsedMedia.toFixed(2)}s while source tab was ${sourceVisibility}`);
    assert.ok(framesObserved > 40, `Receiver observed only ${framesObserved} decoded frames`);

    await clickTargetButton(targetClient, 'toggle');
    const pauseRelay = await pumpPlayback(sourceClient, targetClient);
    assert.equal(pauseRelay.commands[0]?.trusted, true);
    assert.equal(pauseRelay.playback.paused, true);
    await clickTargetButton(targetClient, 'toggle');
    const resumeRelay = await pumpPlayback(sourceClient, targetClient);
    assert.equal(resumeRelay.commands[0]?.trusted, true);
    assert.equal(resumeRelay.playback.paused, false);

    const capturedProofPath = await captureProof(targetClient);
    report = {
      mode: 'youtube-webrtc-smuggle-test',
      source: {
        service: 'YouTube', channel: 'Fireship', videoId, rendererPort: sourcePort,
        visibilityDuringTest: sourceVisibility, tracks: sourceOffer.tracks,
      },
      target: {
        app: targetAppName, rendererPort: targetTarget.session.port,
        semanticSelector: targetSelector,
        videoWidth: backgroundPlayback.width, videoHeight: backgroundPlayback.height,
      },
      transport: {
        kind: 'WebRTC media track', connection: connected,
        testSeconds: 4, mediaSecondsAdvanced: elapsedMedia, framesObserved,
        observedFramesPerSecond: framesObserved / 4,
      },
      controls: { trustedPauseRelayed: true, trustedResumeRelayed: true },
      proofPath: capturedProofPath,
    };
  } finally {
    await Promise.allSettled([
      sourceClient.evaluate(`globalThis.__attuneYoutubeWebRtcSource?.cleanup?.()`),
      targetClient.evaluate(`globalThis.__attuneYoutubeWebRtcTarget?.cleanup?.()`),
    ]);
    sourceClient.close();
    targetClient.close();
    await closeChromeTarget(youtubeTarget.id);
  }

  if (report) console.log(JSON.stringify({ ...report, cleanedUp: true }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
