import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  buildComponentSmuggleSourceExpression,
  buildComponentSmuggleTargetExpression,
  ComponentSmuggleBridge,
  componentSmuggleAnchor,
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

test('forwards visual hover and wheel gestures to the source renderer', async () => {
  const anchor = componentSmuggleAnchor(selection, 'hover-token');
  const moves = [];
  const wheels = [];
  let drained = false;
  const sourceClient = {
    async connect() {},
    async evaluate(expression) {
      if (expression.includes('hoverPoint?.(null)')) return { x: -1, y: -1 };
      if (expression.includes('hoverPoint?.(')) return { x: 75, y: 20 };
      if (expression.includes('__attuneComponentSmuggleSource?.status')) return { connected: true };
      if (expression.includes('__attuneComponentSmuggleSource?.drain?.')) return [];
      if (expression.includes('__attuneComponentSmuggleSource?.settleActions')) return { version: 1 };
      return { ok: true, connected: true };
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
    undefined,
    { source: sourceClient, target: targetClient },
  );
  await bridge.start();
  await bridge.stop();
  assert.deepEqual(moves, [{ x: 75, y: 20 }, { x: -1, y: -1 }]);
  assert.deepEqual(wheels, [{ x: 75, y: 20, deltaX: 4, deltaY: 48, metaKey: true }]);
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
