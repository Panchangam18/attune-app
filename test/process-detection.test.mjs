import assert from 'node:assert/strict';
import test from 'node:test';
import { processListHasExecutable } from '../dist-electron/process-detection.js';

test('process detection matches an exact executable path containing spaces', () => {
  const executable = '/Applications/ChatGPT.app/Contents/MacOS/ChatGPT';
  const processList = [
    '/usr/libexec/some-service',
    `${executable} --remote-debugging-port=53365`,
    '/Applications/Other App.app/Contents/MacOS/Other App',
  ].join('\n');

  assert.equal(processListHasExecutable(processList, executable), true);
});

test('process detection ignores executable paths mentioned only as arguments', () => {
  const executable = '/Applications/ChatGPT.app/Contents/MacOS/ChatGPT';
  const processList = [
    `/bin/zsh -c inspect ${executable}`,
    '/Applications/ChatGPT Beta.app/Contents/MacOS/ChatGPT',
  ].join('\n');

  assert.equal(processListHasExecutable(processList, executable), false);
});
