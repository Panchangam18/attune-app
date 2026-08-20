import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  buildComponentSmuggleSourceExpression,
  buildComponentSmuggleTargetExpression,
  ComponentSmuggleBridge,
  componentSmuggleAnchor,
  componentSmuggleEmbeddedFontCss,
  componentSmuggleGlobalCaptureRectangle,
} from '../dist-electron/component-smuggler.js';

const selection = {
  status: 'selected',
  intent: 'smuggle-source',
  pageTitle: 'Fixture',
  roles: ['fixture.card'],
  selector: '[data-attune-host-roles~="fixture.card"]',
  selectorStability: 'semantic',
  fingerprint: {
    tag: 'section', domRole: '', label: 'Card', text: 'Card', attributes: { 'aria-label': 'Card' },
    classes: [], ancestor: { tag: 'main', domRole: '', label: '' },
  },
  bounds: { x: 0, y: 0, width: 300, height: 80 },
  styles: {
    display: 'block', position: 'relative', color: 'black', backgroundColor: 'white',
    fontSize: '14px', fontFamily: 'sans-serif', borderRadius: '8px',
  },
};

test('builds self-contained source and target smuggling runtimes', () => {
  const anchor = componentSmuggleAnchor(selection, 'fixture-token');
  assert.equal(anchor.token, 'fixture-token');
  assert.doesNotThrow(() => new Function(`return ${buildComponentSmuggleSourceExpression(anchor)}`));
  assert.doesNotThrow(() => new Function(`return ${buildComponentSmuggleTargetExpression(anchor)}`));
  assert.match(buildComponentSmuggleSourceExpression(anchor), /MutationObserver/);
  assert.match(buildComponentSmuggleTargetExpression(anchor), /attachShadow/);
  assert.equal(componentSmuggleAnchor({ ...selection, placement: 'replace' }, 'replace-token').placement, 'replace');
});

test('maps browser viewport coordinates through native browser chrome', () => {
  assert.deepEqual(componentSmuggleGlobalCaptureRectangle({
    screenX: 22,
    screenY: 55,
    outerWidth: 1200,
    outerHeight: 1040,
    innerWidth: 1200,
    innerHeight: 953,
    contentOffsetX: 0,
    contentOffsetY: 87,
    x: 91,
    y: 564,
    width: 347,
    height: 273,
    rootWidth: 347,
    rootHeight: 273,
    offsetX: 0,
    offsetY: 0,
  }), {
    x: 113,
    y: 706,
    width: 347,
    height: 273,
  });
});

test('embeds bounded local icon fonts for the destination renderer', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'attune-smuggle-font-'));
  const path = join(directory, 'icons.woff2');
  try {
    await writeFile(path, Buffer.from([0x77, 0x4f, 0x46, 0x32, 0, 1, 2, 3]));
    const css = await componentSmuggleEmbeddedFontCss([{
      family: 'Fixture Icons',
      src: 'url("./icons.woff2") format("woff2")',
      baseUrl: new URL(`file://${directory}/fixture.css`).href,
      style: 'normal',
      weight: '400',
    }]);
    assert.match(css, /font-family:"Fixture Icons"/);
    assert.match(css, /data:font\/woff2;base64,d09GMgABAgM=/);
    assert.doesNotMatch(css, /file:/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('keeps a passive DOM metadata twin under the native source stream', async () => {
  const anchor = componentSmuggleAnchor(selection, 'stream-first-token');
  let sourceDrains = 0;
  let targetApplies = 0;
  let nativeStarts = 0;
  const sourceClient = {
    async connect() {},
    async evaluate(expression) {
      if (expression.includes('captureRegion?.')) return {
        x: 0, y: 0, width: 300, height: 80, rootWidth: 300, rootHeight: 80,
        offsetX: 0, offsetY: 0, screenX: 0, screenY: 0, outerWidth: 300,
        outerHeight: 80, innerWidth: 300, innerHeight: 80, contentOffsetX: 0, contentOffsetY: 0,
      };
      if (expression.includes('__attuneComponentSmuggleSource?.status')) return { connected: true, visualIslandCount: 0 };
      if (expression.includes('__attuneComponentSmuggleSource?.drain?.')) {
        sourceDrains += 1;
        return [{ type: 'snapshot', version: 1, tree: null }];
      }
      return { ok: true, connected: true, visualIslandCount: 0 };
    },
    async click() {}, async move() {}, async wheel() {}, async insertText() {}, async pressKey() {}, close() {},
  };
  const targetClient = {
    async connect() {},
    async evaluate(expression) {
      if (expression.includes('__attuneComponentSmuggleTarget?.status')) return { connected: true };
      if (expression.includes('__attuneComponentSmuggleTarget?.drainActions')) return [];
      if (expression.includes('__attuneComponentSmuggleTarget?.apply?.')) targetApplies += 1;
      return { ok: true, connected: true };
    },
    async click() {}, async move() {}, async wheel() {}, async insertText() {}, async pressKey() {}, close() {},
  };
  const endpoint = { appId: 'fixture', appName: 'Fixture', webSocketDebuggerUrl: 'ws://fixture', anchor };
  const bridge = new ComponentSmuggleBridge(
    endpoint,
    endpoint,
    undefined,
    undefined,
    async () => { nativeStarts += 1; return () => {}; },
    { source: sourceClient, target: targetClient },
  );
  await bridge.start();
  await bridge.stop();
  assert.equal(nativeStarts, 1);
  assert.equal(sourceDrains, 1);
  assert.equal(targetApplies, 1);
});

test('falls back to the DOM twin when the native source stream cannot start', async () => {
  const anchor = componentSmuggleAnchor(selection, 'stream-fallback-token');
  let sourceInstalls = 0;
  let sourceDrains = 0;
  let targetApplies = 0;
  let nativeStarts = 0;
  const sourceClient = {
    async connect() {},
    async evaluate(expression) {
      if (expression.includes('captureRegion?.')) return {
        x: 0, y: 0, width: 300, height: 80, rootWidth: 300, rootHeight: 80,
        offsetX: 0, offsetY: 0, screenX: 0, screenY: 0, outerWidth: 300,
        outerHeight: 80, innerWidth: 300, innerHeight: 80, contentOffsetX: 0, contentOffsetY: 0,
      };
      if (expression.includes('function runComponentSmuggleSource')) sourceInstalls += 1;
      if (expression.includes('__attuneComponentSmuggleSource?.status')) return { connected: true, visualIslandCount: 0 };
      if (expression.includes('__attuneComponentSmuggleSource?.drain?.')) {
        sourceDrains += 1;
        return [{ type: 'snapshot', version: 1, tree: null }];
      }
      return { ok: true, connected: true, visualIslandCount: 0 };
    },
    async click() {}, async move() {}, async wheel() {}, async insertText() {}, async pressKey() {}, close() {},
  };
  const targetClient = {
    async connect() {},
    async evaluate(expression) {
      if (expression.includes('__attuneComponentSmuggleTarget?.status')) return { connected: true };
      if (expression.includes('__attuneComponentSmuggleTarget?.drainActions')) return [];
      if (expression.includes('__attuneComponentSmuggleTarget?.apply?.')) targetApplies += 1;
      return { ok: true, connected: true };
    },
    async click() {}, async move() {}, async wheel() {}, async insertText() {}, async pressKey() {}, close() {},
  };
  const endpoint = { appId: 'fixture', appName: 'Fixture', webSocketDebuggerUrl: 'ws://fixture', anchor };
  const bridge = new ComponentSmuggleBridge(
    endpoint,
    endpoint,
    undefined,
    undefined,
    async () => {
      nativeStarts += 1;
      throw new Error('stream unavailable');
    },
    { source: sourceClient, target: targetClient },
  );
  await bridge.start();
  await bridge.stop();
  assert.equal(nativeStarts, 1);
  assert.equal(sourceInstalls, 1);
  assert.equal(sourceDrains, 1);
  assert.equal(targetApplies, 1);
});

test('forwards visual hover and wheel gestures to the source renderer', async () => {
  const anchor = componentSmuggleAnchor(selection, 'hover-token');
  const moves = [];
  const wheels = [];
  let sourceDrains = 0;
  let sourceSettles = 0;
  let drained = false;
  const sourceClient = {
    async connect() {},
    async evaluate(expression) {
      if (expression.includes('hoverPoint?.(null)')) return { x: -1, y: -1 };
      if (expression.includes('hoverPoint?.(')) return { x: 75, y: 20 };
      if (expression.includes('captureRegion?.')) return {
        x: 0, y: 0, width: 100, height: 40, rootWidth: 100, rootHeight: 40,
        offsetX: 0, offsetY: 0, screenX: 0, screenY: 0, outerWidth: 100,
        outerHeight: 40, innerWidth: 100, innerHeight: 40, contentOffsetX: 0, contentOffsetY: 0,
      };
      if (expression.includes('__attuneComponentSmuggleSource?.status')) return { connected: true, visualIslandCount: 1 };
      if (expression.includes('__attuneComponentSmuggleSource?.drain?.')) { sourceDrains += 1; return []; }
      if (expression.includes('__attuneComponentSmuggleSource?.settleActions')) { sourceSettles += 1; return { version: 1 }; }
      return { ok: true, connected: true, visualIslandCount: 1 };
    },
    async click() {},
    async move(x, y) { moves.push({ x, y }); },
    async wheel(x, y, deltaX, deltaY, modifiers) { wheels.push({ x, y, deltaX, deltaY, metaKey: modifiers.metaKey }); },
    async insertText() {},
    async pressKey() {},
    close() {},
  };
  const targetClient = {
    async connect() {},
    async evaluate(expression) {
      if (expression.includes('__attuneComponentSmuggleTarget?.status')) return { connected: true };
      if (expression.includes('__attuneComponentSmuggleTarget?.drainActions')) {
        if (drained) return [];
        drained = true;
        return [
          { type: 'visual-hover', position: { xRatio: 0.75, yRatio: 0.2 }, revision: 1 },
          { type: 'visual-wheel', position: { xRatio: 0.75, yRatio: 0.2 }, deltaX: 4, deltaY: 48, metaKey: true, revision: 2 },
          { type: 'visual-hover', position: null, revision: 3 },
        ];
      }
      return { ok: true, connected: true };
    },
    async click() {},
    async move() {},
    async wheel() {},
    async insertText() {},
    async pressKey() {},
    close() {},
  };
  const endpoint = {
    appId: 'fixture', appName: 'Fixture', webSocketDebuggerUrl: 'ws://fixture', anchor,
  };
  const bridge = new ComponentSmuggleBridge(
    endpoint,
    endpoint,
    undefined,
    undefined,
    async () => () => {},
    { source: sourceClient, target: targetClient },
  );
  await bridge.start();
  await bridge.stop();
  assert.deepEqual(moves, [{ x: 75, y: 20 }, { x: -1, y: -1 }]);
  assert.deepEqual(wheels, [{ x: 75, y: 20, deltaX: 4, deltaY: 48, metaKey: true }]);
  assert.equal(sourceDrains, 1);
  assert.equal(sourceSettles, 1);
});

test('wakes the visual input relay as soon as the target signals an action', async () => {
  const anchor = componentSmuggleAnchor(selection, 'signal-token');
  const region = {
    x: 0, y: 0, width: 100, height: 40, rootWidth: 100, rootHeight: 40,
    offsetX: 0, offsetY: 0, screenX: 0, screenY: 0, outerWidth: 100,
    outerHeight: 40, innerWidth: 100, innerHeight: 40, contentOffsetX: 0, contentOffsetY: 0,
  };
  const queuedActions = [];
  const inserted = [];
  const focusExpressions = [];
  let targetControlApplies = 0;
  let targetVisualApplies = 0;
  let signalAction = () => {};
  const sourceClient = {
    async connect() {},
    async evaluate(expression) {
      if (expression.includes('function runComponentSmuggleSource')) {
        return { ok: true, connected: true, visualIslandCount: 1 };
      }
      if (expression.includes('captureRegion?.')) return region;
      if (expression.includes('capturePoint?.')) return { x: 25, y: 30 };
      if (expression.includes('__attuneComponentSmuggleSource?.status')) return { connected: true, visualIslandCount: 1 };
      if (expression.includes('focusPrimaryEditable')) {
        focusExpressions.push(expression);
        return { ok: true };
      }
      return { ok: true, connected: true, visualIslandCount: 1 };
    },
    async click() {}, async move() {}, async wheel() {},
    async insertText(value) { inserted.push(value); },
    async pressKey() {}, close() {},
  };
  const targetClient = {
    async connect() {},
    async evaluate(expression) {
      if (expression.includes('__attuneComponentSmuggleTarget?.status')) return { connected: true };
      if (expression.includes('__attuneComponentSmuggleTarget?.drainActions')) return queuedActions.splice(0);
      if (expression.includes('__attuneComponentSmuggleTarget?.applyVisual')) targetControlApplies += 1;
      return { ok: true, connected: true };
    },
    async click() {}, async move() {}, async wheel() {}, async insertText() {}, async pressKey() {}, close() {},
    async subscribeActionSignal(listener) {
      signalAction = listener;
      return () => {};
    },
  };
  const targetVisualClient = {
    ...targetClient,
    async evaluate(expression) {
      if (expression.includes('__attuneComponentSmuggleTarget?.applyVisual')) targetVisualApplies += 1;
      return true;
    },
    async subscribeActionSignal() { return () => {}; },
  };
  const endpoint = {
    appId: 'fixture', appName: 'Fixture', webSocketDebuggerUrl: 'ws://fixture', anchor,
  };
  const bridge = new ComponentSmuggleBridge(
    endpoint,
    endpoint,
    undefined,
    undefined,
    async (_region, onFrame) => {
      onFrame('A'.repeat(128));
      return () => {};
    },
    { source: sourceClient, target: targetClient, targetVisual: targetVisualClient },
  );
  await bridge.start();
  queuedActions.push({
    type: 'visual-click', trusted: true, position: { xRatio: 0.25, yRatio: 0.75 },
    revision: 1, queuedAt: Date.now(),
  });
  queuedActions.push({
    type: 'visual-edit', trusted: true, inputType: 'insertText', data: 'q',
    revision: 2, queuedAt: Date.now(),
  });
  signalAction();
  const deadline = Date.now() + 250;
  while (!inserted.length && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  await bridge.stop();
  assert.deepEqual(inserted, ['q']);
  assert.equal(focusExpressions.some((expression) => expression.includes('focusActiveEditable?.()')), true);
  assert.equal(focusExpressions.some((expression) => (
    expression.includes('focusEditableAt?.({"xRatio":0.25,"yRatio":0.75})')
  )), true);
  assert.equal(targetControlApplies, 0);
  assert.equal(targetVisualApplies, 1);
});

test('captures only visual islands inside a DOM twin', async () => {
  const anchor = componentSmuggleAnchor(selection, 'adaptive-token');
  const region = {
    x: 12, y: 18, width: 100, height: 40, rootWidth: 100, rootHeight: 40,
    offsetX: 0, offsetY: 0, screenX: 0, screenY: 0, outerWidth: 200,
    outerHeight: 100, innerWidth: 200, innerHeight: 100,
    contentOffsetX: 0, contentOffsetY: 0, pixelRatio: 2, continuousVisuals: false,
  };
  let dirtySignal = () => {};
  let capturedFrame = 'A'.repeat(128);
  let captureAttempts = 0;
  let visualApplies = 0;
  const sourceClient = {
    async connect() {},
    async evaluate(expression) {
      if (expression.includes('__attuneComponentSmuggleSource?.status')) return { connected: true, visualIslandCount: 1 };
      return { ok: true, connected: true, visualIslandCount: 1 };
    },
    async click() {}, async move() {}, async wheel() {}, async insertText() {}, async pressKey() {}, close() {},
    async subscribeVisualDirtySignal(listener) {
      dirtySignal = listener;
      return () => {};
    },
  };
  const sourceVisualClient = {
    ...sourceClient,
    async evaluate(expression) {
      if (expression.includes('captureVisualRegions?.')) return [{ ...region, islandId: '2', visualKind: 'canvas' }];
      return { ok: true, connected: true };
    },
    async captureComponentFrame(capturedRegion) {
      captureAttempts += 1;
      assert.equal(capturedRegion.x, 12);
      assert.equal(capturedRegion.width, 100);
      assert.equal(capturedRegion.pixelRatio, 2);
      return capturedFrame;
    },
  };
  const targetClient = {
    async connect() {},
    async evaluate(expression) {
      if (expression.includes('__attuneComponentSmuggleTarget?.status')) return { connected: true };
      if (expression.includes('__attuneComponentSmuggleTarget?.drainActions')) return [];
      return { ok: true, connected: true };
    },
    async click() {}, async move() {}, async wheel() {}, async insertText() {}, async pressKey() {}, close() {},
  };
  const targetVisualClient = {
    ...targetClient,
    async evaluate(expression) {
      if (expression.includes('__attuneComponentSmuggleTarget?.applyVisualIsland')) visualApplies += 1;
      return true;
    },
  };
  const endpoint = {
    appId: 'fixture', appName: 'Fixture', webSocketDebuggerUrl: 'ws://fixture', anchor,
  };
  const bridge = new ComponentSmuggleBridge(
    endpoint,
    endpoint,
    undefined,
    undefined,
    undefined,
    {
      source: sourceClient,
      sourceVisual: sourceVisualClient,
      target: targetClient,
      targetVisual: targetVisualClient,
    },
  );
  await bridge.start();
  assert.equal(captureAttempts, 1);
  assert.equal(visualApplies, 1);

  capturedFrame = 'B'.repeat(128);
  dirtySignal();
  const deadline = Date.now() + 250;
  while ((captureAttempts < 2 || visualApplies < 2) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  await bridge.stop();
  assert.equal(captureAttempts, 2);
  assert.equal(visualApplies, 2);
});

test('keeps the previous visual stream when a resized replacement cannot start', async () => {
  const anchor = componentSmuggleAnchor(selection, 'restart-token');
  let width = 100;
  let starts = 0;
  let stops = 0;
  const sourceClient = {
    async connect() {},
    async evaluate(expression) {
      if (expression.includes('captureRegion?.')) return {
        x: 0, y: 0, width, height: 40, rootWidth: width, rootHeight: 40,
        offsetX: 0, offsetY: 0, screenX: 0, screenY: 0, outerWidth: width,
        outerHeight: 40, innerWidth: width, innerHeight: 40, contentOffsetX: 0, contentOffsetY: 0,
      };
      if (expression.includes('__attuneComponentSmuggleSource?.status')) return { connected: true, visualIslandCount: 1 };
      return { ok: true, connected: true, visualIslandCount: 1 };
    },
    async click() {}, async move() {}, async wheel() {}, async insertText() {}, async pressKey() {}, close() {},
  };
  const targetClient = {
    async connect() {},
    async evaluate(expression) {
      if (expression.includes('__attuneComponentSmuggleTarget?.status')) return { connected: true };
      if (expression.includes('__attuneComponentSmuggleTarget?.drainActions')) return [];
      return { ok: true, connected: true };
    },
    async click() {}, async move() {}, async wheel() {}, async insertText() {}, async pressKey() {}, close() {},
  };
  const endpoint = {
    appId: 'fixture', appName: 'Fixture', webSocketDebuggerUrl: 'ws://fixture', anchor,
  };
  const bridge = new ComponentSmuggleBridge(
    endpoint,
    endpoint,
    undefined,
    undefined,
    async () => {
      starts += 1;
      if (starts === 2) throw new Error('replacement rejected');
      return () => { stops += 1; };
    },
    { source: sourceClient, target: targetClient },
  );
  await bridge.start();
  width = 140;
  await bridge.ensureVisualFrameStream();
  assert.equal(starts, 2);
  assert.equal(stops, 0);
  await bridge.stop();
  assert.equal(stops, 1);
});

test('smuggles a live interactive component and re-resolves both anchors', { skip: process.platform !== 'darwin' }, async () => {
  const electronPath = fileURLToPath(new URL(
    '../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
    import.meta.url,
  ));
  const fixturePath = fileURLToPath(new URL(
    './fixtures/component-smuggler-electron.cjs',
    import.meta.url,
  ));
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronPath, [fixturePath], {
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += String(chunk); });
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  assert.equal(exitCode, 0, `${stdout}\n${stderr}`);
  assert.match(stdout, /component-smuggler-ok/);
});
