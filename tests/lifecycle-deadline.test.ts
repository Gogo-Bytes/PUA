import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, expect, test, vi } from 'vitest';

// Importing the guarded CLI exposes only the deadline/assertion helpers here.
// These tests create no process, window, or application instance.
const smokeURL = pathToFileURL(path.resolve('scripts/smoke-lifecycle.mjs')).href;
const { within, assertStopped } = await import(smokeURL);

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
});

test('deadline remains failed when fallback cleanup lets the pending body finish', async () => {
  vi.useFakeTimers();
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const events: string[] = [];
  let signal!: AbortSignal;
  const outcome = within(async (current: AbortSignal) => {
    signal = current;
    await pending;
    current.throwIfAborted();
  }, 30, 'scenario').then(
    () => { events.push('PASS'); },
    (error: Error) => { events.push('FAIL'); expect(error.message).toContain('deadline exceeded'); },
  );
  await vi.advanceTimersByTimeAsync(30);
  await outcome;
  expect(signal.aborted).toBe(true);
  events.push('fallback cleanup');
  release();
  await vi.advanceTimersByTimeAsync(100);
  expect(events).toEqual(['FAIL', 'fallback cleanup']);
  expect(vi.getTimerCount()).toBe(0);
});

test('completed work reports success once and clears its deadline', async () => {
  vi.useFakeTimers();
  const pass = vi.fn();
  await within(async (signal: AbortSignal) => {
    expect(signal.aborted).toBe(false);
    return 42;
  }, 30, 'scenario').then(pass);
  await vi.advanceTimersByTimeAsync(100);
  expect(pass).toHaveBeenCalledExactlyOnceWith(42);
  expect(vi.getTimerCount()).toBe(0);
});

test('cancelled cleanup assertion stops polling before fallback can produce success', async () => {
  vi.useFakeTimers();
  const probe = vi.spyOn(process, 'kill').mockImplementation(() => true);
  const controller = new AbortController();
  const pass = vi.fn();
  const failure = vi.fn();
  const outcome = assertStopped([2147483647], 'scenario', 8000, controller.signal).then(pass, failure);
  expect(probe).toHaveBeenCalledTimes(1);
  controller.abort(new Error('scenario expired'));
  await vi.advanceTimersByTimeAsync(50);
  await outcome;
  expect(probe).toHaveBeenCalledTimes(1);
  expect(pass).not.toHaveBeenCalled();
  expect(failure).toHaveBeenCalledExactlyOnceWith(controller.signal.reason);
});

test('an already cancelled assertion performs no process observation', async () => {
  const probe = vi.spyOn(process, 'kill').mockImplementation(() => true);
  const controller = new AbortController();
  controller.abort(new Error('scenario expired'));
  await expect(assertStopped([2147483647], 'scenario', 8000, controller.signal)).rejects.toThrow('scenario expired');
  expect(probe).not.toHaveBeenCalled();
});
