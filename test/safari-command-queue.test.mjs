import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = dirname(testDirectory);
const electronOutput = process.env.ATTUNE_TEST_ELECTRON_OUTPUT || join(projectDirectory, 'dist-electron');
const moduleUrl = pathToFileURL(join(electronOutput, 'safari-command-queue.js')).href;
const {
  serializeSafariCommand,
  waitForSafariPickerResult,
} = await import(moduleUrl);

test('Safari commands from independent clients run in FIFO order', async () => {
  const events = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const first = serializeSafariCommand(async () => {
    events.push('first:start');
    await firstGate;
    events.push('first:end');
    return 1;
  });
  const second = serializeSafariCommand(async () => {
    events.push('second:start');
    events.push('second:end');
    return 2;
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['first:start']);
  releaseFirst();
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  assert.deepEqual(events, ['first:start', 'first:end', 'second:start', 'second:end']);
});

test('a failed Safari command does not poison the shared queue', async () => {
  await assert.rejects(
    serializeSafariCommand(async () => { throw new Error('fixture failure'); }),
    /fixture failure/,
  );
  assert.equal(await serializeSafariCommand(async () => 'recovered'), 'recovered');
});

test('Safari picker polling yields between commands and returns the renderer result', async () => {
  const states = [
    { value: '', installed: true },
    { value: '', installed: true },
    { value: '{"status":"selected","intent":"reference"}', installed: true },
  ];
  let waits = 0;
  const result = await waitForSafariPickerResult(
    async () => states.shift(),
    1_000,
    { wait: async () => { waits += 1; } },
  );
  assert.deepEqual(result, { status: 'selected', intent: 'reference' });
  assert.equal(waits, 2);
});

test('Safari picker polling exits when navigation removes its runtime', async () => {
  const result = await waitForSafariPickerResult(
    async () => ({ value: '', installed: false }),
    1_000,
    { wait: async () => { throw new Error('should not wait'); } },
  );
  assert.deepEqual(result, { status: 'cancelled' });
});
