import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

import {
  buildCodexLiveSlotAnchorExpression,
  componentSmuggleBrokerPath,
  componentSmuggleRequestDirectory,
  isCodexLiveVisualizationTarget,
  isLiveComponentSmuggleRequest,
  readPendingComponentSmuggleRequests,
  removeComponentSmuggleBrokerHeartbeat,
  restorePendingComponentSmuggleRequest,
  writeComponentSmuggleBrokerHeartbeat,
} from '../dist-electron/component-smuggle-requests.js';

const requestId = '12345678-1234-4234-9234-123456789abc';

function request(overrides = {}) {
  return {
    schemaVersion: 1,
    requestId,
    createdAt: '2026-08-19T01:00:00.000Z',
    expiresAt: '2026-08-19T01:02:00.000Z',
    source: {
      appId: 'com.example.app',
      appName: 'Example',
      appPid: 123,
      webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/source',
      anchor: {
        token: '87654321-4321-4432-a234-cba987654321',
        roles: ['example.composer'],
        selector: '[data-attune-host-roles~="example.composer"]',
        fingerprint: {
          tag: 'section', domRole: '', label: 'Composer', text: '', attributes: {}, classes: [], ancestor: null,
        },
        placement: 'inside',
      },
    },
    target: { appId: 'com.openai.codex', appName: 'ChatGPT', slotId: `attune-live-${requestId}` },
    ...overrides,
  };
}

test('validates private loopback component smuggle requests', () => {
  assert.equal(isLiveComponentSmuggleRequest(request()), true);
  assert.equal(isLiveComponentSmuggleRequest(request({
    source: { ...request().source, webSocketDebuggerUrl: 'ws://example.com/devtools/page/source' },
  })), false);
  assert.equal(isLiveComponentSmuggleRequest(request({
    target: { appId: 'com.openai.codex', appName: 'ChatGPT', slotId: 'different-slot' },
  })), false);
});

test('validates bounded Safari Apple Events component sources', () => {
  const safariSource = {
    appId: 'com.apple.Safari',
    appName: 'Safari',
    appPid: 18985,
    transport: 'safari-apple-events',
    webSocketDebuggerUrl: 'safari://window/41770/tab/1',
    safariPage: {
      appPid: 18985,
      windowId: 41770,
      tabIndex: 1,
      url: 'https://github.com/Panchangam18',
    },
    anchor: {
      ...request().source.anchor,
      roles: [],
      selector: '.graph-before-activity-overview',
    },
  };
  assert.equal(isLiveComponentSmuggleRequest(request({ source: safariSource })), true);
  assert.equal(isLiveComponentSmuggleRequest(request({
    source: { ...safariSource, safariPage: { ...safariSource.safariPage, windowId: -1 } },
  })), false);
  assert.equal(isLiveComponentSmuggleRequest(request({
    source: { ...safariSource, webSocketDebuggerUrl: 'safari://window/41770/tab/../../other' },
  })), false);
});

test('discovers only loopback Codex visualization webviews', () => {
  assert.equal(isCodexLiveVisualizationTarget({
    type: 'webview',
    url: 'codex-sandbox://codex-inline-visualization-abc.web-sandbox.oaiusercontent.com/',
    webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/target',
  }), true);
  assert.equal(isCodexLiveVisualizationTarget({
    type: 'page',
    url: 'app://-/index.html',
    webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/target',
  }), false);
  assert.equal(isCodexLiveVisualizationTarget({
    type: 'webview',
    url: 'codex-sandbox://codex-inline-visualization-abc.web-sandbox.oaiusercontent.com/',
    webSocketDebuggerUrl: 'ws://example.com/devtools/page/target',
  }), false);
});

test('broker heartbeat and request queue stay private', () => {
  const homePath = mkdtempSync(join(tmpdir(), 'attune-smuggle-broker-'));
  try {
    const heartbeatPath = writeComponentSmuggleBrokerHeartbeat(homePath, 4321, new Date('2026-08-19T01:00:00.000Z'));
    assert.equal(heartbeatPath, componentSmuggleBrokerPath(homePath));
    assert.equal(statSync(heartbeatPath).mode & 0o777, 0o600);

    const requestDirectory = componentSmuggleRequestDirectory(homePath);
    mkdirSync(requestDirectory, { recursive: true, mode: 0o700 });
    const requestPath = join(requestDirectory, `${requestId}.json`);
    writeFileSync(requestPath, JSON.stringify(request()), { mode: 0o600 });
    chmodSync(requestPath, 0o600);
    const pending = readPendingComponentSmuggleRequests(homePath, Date.parse('2026-08-19T01:01:00.000Z'));
    assert.equal(pending.length, 1);
    assert.equal(pending[0].request.source.anchor.roles[0], 'example.composer');

    removeComponentSmuggleBrokerHeartbeat(homePath, 9999);
    assert.equal(existsSync(heartbeatPath), true);
    removeComponentSmuggleBrokerHeartbeat(homePath, 4321);
    assert.equal(existsSync(heartbeatPath), false);
  } finally {
    rmSync(homePath, { recursive: true, force: true });
  }
});

test('expired component requests are removed', () => {
  const homePath = mkdtempSync(join(tmpdir(), 'attune-smuggle-broker-'));
  try {
    const directory = componentSmuggleRequestDirectory(homePath);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, `${requestId}.json`);
    writeFileSync(path, JSON.stringify(request()), { mode: 0o600 });
    assert.deepEqual(readPendingComponentSmuggleRequests(homePath, Date.parse('2026-08-19T01:03:00.000Z')), []);
    assert.equal(existsSync(path), false);
  } finally {
    rmSync(homePath, { recursive: true, force: true });
  }
});

test('restores an unexpired request after a live bridge disconnects', () => {
  const homePath = mkdtempSync(join(tmpdir(), 'attune-smuggle-broker-'));
  try {
    const directory = componentSmuggleRequestDirectory(homePath);
    const path = join(directory, `${requestId}.json`);
    assert.equal(
      restorePendingComponentSmuggleRequest(
        path,
        request(),
        Date.parse('2026-08-19T01:01:00.000Z'),
      ),
      true,
    );
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(
      readPendingComponentSmuggleRequests(homePath, Date.parse('2026-08-19T01:01:00.000Z')).length,
      1,
    );
  } finally {
    rmSync(homePath, { recursive: true, force: true });
  }
});

test('does not restore an expired request', () => {
  const homePath = mkdtempSync(join(tmpdir(), 'attune-smuggle-broker-'));
  try {
    const path = join(componentSmuggleRequestDirectory(homePath), `${requestId}.json`);
    assert.equal(
      restorePendingComponentSmuggleRequest(
        path,
        request(),
        Date.parse('2026-08-19T01:03:00.000Z'),
      ),
      false,
    );
    assert.equal(existsSync(path), false);
  } finally {
    rmSync(homePath, { recursive: true, force: true });
  }
});

test('Codex slot expression retains a visualization webview anchor', () => {
  const attributes = new Map();
  const slot = {
    tagName: 'DIV',
    getBoundingClientRect: () => ({ width: 736, height: 120 }),
    getAttribute: name => name === 'aria-label' ? 'Live composer' : '',
    setAttribute: (name, value) => attributes.set(name, value),
  };
  const context = { document: { querySelector: () => slot } };
  context.globalThis = context;
  const value = vm.runInNewContext(buildCodexLiveSlotAnchorExpression(
    `attune-live-${requestId}`,
    '87654321-4321-4432-a234-cba987654321',
  ), context);
  const anchor = JSON.parse(value);

  assert.equal(anchor.selector, `[data-attune-smuggle-slot="attune-live-${requestId}"]`);
  assert.equal(anchor.fingerprint.label, 'Live composer');
  assert.equal(attributes.get('data-attune-smuggle-anchor'), anchor.token);
  assert.equal(context.__attuneSmuggleAnchors[anchor.token], slot);
});
