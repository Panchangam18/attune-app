import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  buildElementPickerExpression,
  ELEMENT_PICKER_ACCELERATOR,
  formatElementReference,
  isElementPickerResult,
} from '../dist-electron/element-picker.js';

function receipt(overrides = {}) {
  return {
    schemaVersion: 1,
    selectionId: '7e258a4e-5c6c-4ae1-bd6d-43130a385f97',
    appId: 'codex',
    appName: 'Codex',
    selectedAt: '2026-08-15T12:00:00.000Z',
    expiresAt: '2026-08-16T12:00:00.000Z',
    status: 'selected',
    intent: 'reference',
    pageTitle: 'Codex',
    roles: ['codex.composerSurface'],
    selector: '[data-attune-host-roles~="codex.composerSurface"]',
    selectorStability: 'semantic',
    fingerprint: {
      tag: 'div',
      domRole: 'textbox',
      label: 'Message Codex',
      text: 'Private text should not be repeated when a label exists',
      attributes: { role: 'textbox', 'aria-label': 'Message Codex' },
      classes: ['composer-surface'],
      ancestor: { tag: 'form', domRole: '', label: 'Composer' },
    },
    bounds: { x: 120, y: 640, width: 700, height: 90 },
    styles: {
      display: 'flex',
      position: 'relative',
      color: 'rgb(255, 255, 255)',
      backgroundColor: 'rgb(20, 20, 20)',
      fontSize: '14px',
      fontFamily: 'sans-serif',
      borderRadius: '16px',
    },
    ...overrides,
  };
}

test('builds a self-contained picker expression with the global shortcut affordance', () => {
  const expression = buildElementPickerExpression('Codex "Desktop"', 'data:image/png;base64,frozen');
  assert.equal(ELEMENT_PICKER_ACCELERATOR, 'CommandOrControl+Option+A');
  assert.doesNotThrow(() => new Function(`return ${expression}`));
  assert.match(expression, /data-attune-element-picker/);
  assert.match(expression, /ArrowUp/);
  assert.match(expression, /__attuneElementPickerCommand/);
  assert.match(expression, /stopImmediatePropagation/);
  assert.match(expression, /data-attune-element-picker=.freeze/);
  assert.match(expression, /animation-play-state: paused/);
  assert.match(expression, /#d8c88f/);
  assert.match(expression, /112 173 135/);
  assert.match(expression, /smuggle-source/);
  assert.match(expression, /Place LEFT/);
  assert.match(expression, /Place RIGHT/);
  assert.match(expression, /⌥ click: INSIDE/);
  assert.match(expression, /KeyW: 'top'/);
  assert.doesNotMatch(expression, /0 0 0 [13]px/);
  assert.match(expression, /Codex \\"Desktop\\"/);
});

test('formats mapped selections as direct semantic styling references', () => {
  const text = formatElementReference(receipt(), '/tmp/selection.json');
  assert.match(text, /^Attune element reference/);
  assert.match(text, /Semantic role: codex\.composerSurface/);
  assert.match(text, /Selector: \[data-attune-host-roles/);
  assert.doesNotMatch(text, /Instruction:/);
  assert.doesNotMatch(text, /Private text/);
});

test('formats unmapped selections as resolver work with bounded evidence', () => {
  const text = formatElementReference(receipt({
    roles: [],
    selector: '[aria-label="Toggle sidebar"]',
    selectorStability: 'high',
    fingerprint: {
      ...receipt().fingerprint,
      label: '',
      text: 'Toggle sidebar',
    },
  }), '/tmp/unmapped.json');
  assert.match(text, /Semantic role: unmapped/);
  assert.match(text, /Diagnostic selector \(high stability\)/);
  assert.match(text, /Visible text: "Toggle sidebar"/);
  assert.doesNotMatch(text, /Instruction:/);
});

test('validates only bounded picker result shapes', () => {
  assert.equal(isElementPickerResult({ status: 'cancelled' }), true);
  assert.equal(isElementPickerResult(receipt()), true);
  assert.equal(isElementPickerResult(receipt({ placement: 'replace' })), true);
  assert.equal(isElementPickerResult(receipt({ placement: 'overwrite' })), false);
  assert.equal(isElementPickerResult(receipt({ intent: 'invalid' })), false);
  assert.equal(isElementPickerResult({ status: 'selected', roles: [] }), false);
  assert.equal(isElementPickerResult(null), false);
});

test('picker selects the semantic component, blocks the host click, and cleans up', { skip: process.platform !== 'darwin' }, async () => {
  const electronPath = fileURLToPath(new URL(
    '../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
    import.meta.url,
  ));
  const fixturePath = fileURLToPath(new URL(
    './fixtures/element-picker-electron.cjs',
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
  assert.match(stdout, /element-picker-ok/);
});
