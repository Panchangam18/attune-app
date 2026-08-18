let safariCommandTail: Promise<void> = Promise.resolve();

/**
 * Safari exposes JavaScript automation through one Apple Events lane. Keep
 * every command in FIFO order even when independent clients (picker,
 * smuggler, slash bridge) issue work at the same time.
 */
export function serializeSafariCommand<T>(operation: () => Promise<T> | T): Promise<T> {
  const result = safariCommandTail.then(operation, operation);
  safariCommandTail = result.then(() => undefined, () => undefined);
  return result;
}

export interface SafariPickerPollState {
  value?: string;
  installed?: boolean;
}

export async function waitForSafariPickerResult(
  readState: () => Promise<SafariPickerPollState>,
  timeoutMs: number,
  options: {
    pollIntervalMs?: number;
    now?: () => number;
    wait?: (milliseconds: number) => Promise<void>;
  } = {},
): Promise<unknown> {
  const pollIntervalMs = Math.max(1, options.pollIntervalMs ?? 100);
  const now = options.now ?? Date.now;
  const wait = options.wait ?? ((milliseconds: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  }));
  const deadline = now() + Math.max(0, timeoutMs);

  do {
    const state = await readState();
    if (state?.value) {
      try { return JSON.parse(state.value); } catch { return null; }
    }
    if (state?.installed === false) return { status: 'cancelled' };
    const remaining = deadline - now();
    if (remaining <= 0) break;
    await wait(Math.min(pollIntervalMs, remaining));
  } while (now() <= deadline);

  return { status: 'cancelled' };
}
