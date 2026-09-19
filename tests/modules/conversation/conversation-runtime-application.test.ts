import { describe, expect, it, vi } from 'vitest';
import {
  ConversationRuntimeApplication, type ConversationDialog, type ConversationQueue,
  type DialogClockPort, type RuntimeNotification, type RuntimeOperationsPort,
} from '../../../src/modules/conversation/index';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
class FakeClock implements DialogClockPort {
  time = 1000;
  tasks: Array<{ deadline: number; callback: () => void; cancelled: boolean }> = [];
  now() { return this.time; }
  at(deadline: number, callback: () => void) {
    const task = { deadline, callback, cancelled: false }; this.tasks.push(task);
    return () => { task.cancelled = true; };
  }
  advance(ms: number) {
    this.time += ms;
    for (const task of this.tasks) if (!task.cancelled && task.deadline <= this.time) {
      task.cancelled = true; task.callback();
    }
  }
}
const empty = { steering: [], followUp: [] };
function setup(observer?: (event: RuntimeNotification) => void) {
  const events: RuntimeNotification[] = [];
  const operations = {
    clearQueue: vi.fn<RuntimeOperationsPort['clearQueue']>().mockResolvedValue(empty),
    abort: vi.fn<RuntimeOperationsPort['abort']>().mockResolvedValue(),
    abortRetry: vi.fn<NonNullable<RuntimeOperationsPort['abortRetry']>>().mockResolvedValue(),
    writeAnswer: vi.fn<RuntimeOperationsPort['writeAnswer']>().mockResolvedValue(),
  };
  const clock = new FakeClock();
  const runtime = new ConversationRuntimeApplication(operations, clock, event => { events.push(event); observer?.(event); });
  const open = (id: string, extra: Partial<Extract<ConversationDialog, { kind: 'input' }>> = {}) =>
    runtime.accept({ type: 'dialog', dialog: { id, kind: 'input', title: id, ...extra } });
  return { runtime, operations, clock, events, open };
}
const transcript = (events: RuntimeNotification[]) => events.map(event => event.type === 'state-changed'
  ? `state:${event.change.activity}` : event.type === 'dialog-opened' ? `open:${event.dialog.id}` : `close:${event.dialogId}`);

describe('ConversationRuntimeApplication stop ordering', () => {
  it('waits for clear confirmation, publishes synchronously before abort and does not alter observed queue', async () => {
    const { runtime, operations } = setup();
    const clear = deferred<ConversationQueue>(); const abort = deferred<void>(); const order: string[] = [];
    operations.clearQueue.mockImplementation(() => { order.push('clear'); return clear.promise; });
    operations.abort.mockImplementation(() => { order.push('abort'); return abort.promise; });
    runtime.accept({ type: 'queue', queue: { steering: ['cached'], followUp: [] } });
    const stopping = runtime.stop(queue => { order.push(`recover:${queue.steering.join()}`); expect(operations.abort).not.toHaveBeenCalled(); });
    expect(order).toEqual(['clear']);
    clear.resolve({ steering: ['confirmed'], followUp: [] }); await Promise.resolve();
    expect(order).toEqual(['clear', 'recover:confirmed', 'abort']);
    expect(runtime.snapshot().queue.steering).toEqual(['cached']);
    abort.resolve(); await stopping;
  });
  it('clear rejection never publishes or aborts, while abort rejection keeps recovery exactly once', async () => {
    const { runtime, operations } = setup(); const recovered = vi.fn();
    operations.clearQueue.mockRejectedValueOnce(new Error('clear failed'));
    await expect(runtime.stop(recovered)).rejects.toThrow('clear failed');
    expect(recovered).not.toHaveBeenCalled(); expect(operations.abort).not.toHaveBeenCalled();
    operations.abort.mockRejectedValueOnce(new Error('abort failed'));
    await expect(runtime.stop(recovered)).rejects.toThrow('abort failed');
    expect(recovered).toHaveBeenCalledExactlyOnceWith(empty);
    expect(operations.clearQueue).toHaveBeenCalledTimes(2); expect(operations.abort).toHaveBeenCalledTimes(1);
  });
  it('cancels Pi retry backoff before aborting when the observed activity is retrying', async () => {
    const { runtime, operations } = setup(); const order: string[] = [];
    operations.abortRetry.mockImplementation(async () => { order.push('abort-retry'); });
    operations.abort.mockImplementation(async () => { order.push('abort'); });
    runtime.accept({ type: 'activity', activity: 'retrying' });
    await runtime.stop(() => { order.push('recover'); });
    expect(order).toEqual(['recover', 'abort-retry', 'abort']);
    expect(operations.abortRetry).toHaveBeenCalledTimes(1);
  });
  it('continues ordinary abort when retry cancellation is unsupported or fails', async () => {
    const { runtime, operations } = setup();
    operations.abortRetry.mockRejectedValueOnce(new Error('unsupported'));
    runtime.accept({ type: 'activity', activity: 'retrying' });
    await expect(runtime.stop(vi.fn())).resolves.toBeUndefined();
    expect(operations.abort).toHaveBeenCalledTimes(1);
  });
  it('concurrent and repeated stops keep independent recovery outlets without replay, locking or coalescing', async () => {
    const { runtime, operations } = setup(); const a = deferred<ConversationQueue>(); const b = deferred<ConversationQueue>();
    operations.clearQueue.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const recoveredA = vi.fn(); const recoveredB = vi.fn();
    const first = runtime.stop(recoveredA); const second = runtime.stop(recoveredB);
    expect(operations.clearQueue).toHaveBeenCalledTimes(2);
    b.resolve({ steering: ['B'], followUp: [] }); await second;
    expect(recoveredA).not.toHaveBeenCalled(); expect(recoveredB).toHaveBeenCalledExactlyOnceWith({ steering: ['B'], followUp: [] });
    a.resolve({ steering: ['A'], followUp: [] }); await first;
    expect(recoveredA).toHaveBeenCalledExactlyOnceWith({ steering: ['A'], followUp: [] });
    await runtime.stop(recoveredA); expect(operations.abort).toHaveBeenCalledTimes(3);
  });
  it.each(['clear', 'publish', 'abort'] as const)('invalidation at %s prevents late success and new operations', async phase => {
    const { runtime, operations } = setup(); const clear = deferred<ConversationQueue>(); const abort = deferred<void>();
    operations.clearQueue.mockReturnValue(clear.promise); operations.abort.mockReturnValue(abort.promise);
    const publish = vi.fn(() => { if (phase === 'publish') runtime.invalidate(); });
    const stopping = runtime.stop(publish); const rejected = expect(stopping).rejects.toMatchObject({ code: 'INVALIDATED' });
    if (phase === 'clear') runtime.invalidate();
    clear.resolve(empty); await Promise.resolve();
    if (phase === 'abort') { runtime.invalidate(); abort.resolve(); }
    await rejected;
    expect(publish).toHaveBeenCalledTimes(phase === 'clear' ? 0 : 1);
    expect(operations.abort).toHaveBeenCalledTimes(phase === 'abort' ? 1 : 0);
    await expect(runtime.stop(publish)).rejects.toMatchObject({ code: 'INVALIDATED' });
    expect(operations.clearQueue).toHaveBeenCalledTimes(1);
  });
  it('requires successful synchronous recovery delivery: throw rejects without abort or replay', async () => {
    const { runtime, operations } = setup();
    const recovery = vi.fn(() => { throw new Error('delivery unknown'); });
    await expect(runtime.stop(recovery)).rejects.toThrow('delivery unknown');
    expect(recovery).toHaveBeenCalledExactlyOnceWith(empty);
    expect(operations.abort).not.toHaveBeenCalled();
    expect(operations.clearQueue).toHaveBeenCalledTimes(1);
  });
});

describe('ConversationRuntimeApplication waiting and handshake', () => {
  it('golden: overlapping startup dialogs preserve pre-show, observed activity and latest underlying state', async () => {
    const { runtime, open, events } = setup();
    open('a'); runtime.accept({ type: 'dialog', dialog: { id: 'b', kind: 'confirm', title: 'B', message: '?' } });
    runtime.accept({ type: 'activity', activity: 'retrying' }); await runtime.answer({ id: 'b', confirmed: false });
    runtime.accept({ type: 'activity', activity: 'compacting' }); await runtime.answer({ id: 'a', cancelled: true });
    expect(runtime.initialize({ activity: 'responding' }).activity).toBe('compacting');
    runtime.accept({ type: 'activity', activity: 'idle' });
    expect(transcript(events)).toEqual([
      'state:idle', 'state:waiting-input', 'open:a', 'state:waiting-input', 'state:waiting-input', 'open:b',
      'state:waiting-input', 'close:b', 'state:waiting-input', 'state:waiting-input',
      'close:a', 'state:compacting', 'state:idle',
    ]);
  });
  it('uses seed only before observed activity, including the original dialog-only startup observation', async () => {
    const pristine = setup(); expect(pristine.runtime.initialize({ activity: 'responding' }).activity).toBe('responding');
    pristine.open('later'); await pristine.runtime.answer({ id: 'later', value: '' });
    expect(pristine.runtime.snapshot().activity).toBe('responding');
    const startup = setup(); startup.open('startup');
    expect(startup.runtime.initialize({ activity: 'compacting' }).activity).toBe('waiting-input');
    await startup.runtime.answer({ id: 'startup', value: '' });
    expect(startup.runtime.snapshot().activity).toBe('idle');
    const answered = setup(); answered.open('startup'); await answered.runtime.answer({ id: 'startup', cancelled: true });
    expect(answered.runtime.initialize({ activity: 'responding' }).activity).toBe('idle');
  });
  it.each(['responding', 'compacting', 'retrying', 'idle'] as const)('updates underlying %s while waiting and restores it after final timeout', activity => {
    const { runtime, open, clock } = setup(); open('a', { expiresAt: 1010 }); open('b', { expiresAt: 1020 });
    runtime.accept({ type: 'activity', activity }); clock.advance(10);
    expect(runtime.snapshot().activity).toBe('waiting-input'); clock.advance(10);
    expect(runtime.snapshot().activity).toBe(activity);
  });
  it('accepts exactly 32 dialogs, rejects duplicates/33rd, and leaves untimed dialogs open', () => {
    const { runtime, open, clock } = setup();
    for (let i = 0; i < 32; i++) open(String(i));
    expect(() => open('0')).toThrow('DUPLICATE_DIALOG'); expect(() => open('33')).toThrow('TOO_MANY_DIALOGS');
    clock.advance(1_000_000); expect(runtime.waiting).toBe(true); expect(clock.tasks).toEqual([]);
    runtime.invalidate(); expect(runtime.waiting).toBe(false);
  });
  it('copies input, notifications and snapshots; queue/status/widget ownership is not a host cache', () => {
    const { runtime, events } = setup(); const queue = { steering: ['a'], followUp: [] }; const lines = ['first'];
    runtime.accept({ type: 'queue', queue }); queue.steering.push('host mutation');
    runtime.accept({ type: 'status', key: 'a', text: 'A' }); runtime.accept({ type: 'status', key: 'b', text: 'B' }); runtime.accept({ type: 'status', key: 'a' });
    runtime.accept({ type: 'widget', key: 'w', content: { lines, placement: 'aboveEditor' } }); lines.push('host mutation');
    runtime.accept({ type: 'widget', key: 'v', content: { lines: ['V'], placement: 'aboveEditor' } });
    runtime.accept({ type: 'widget', key: 'w', content: { lines: ['replacement'], placement: 'belowEditor' } });
    runtime.accept({ type: 'widget', key: 'v' });
    const snapshot = runtime.initialize({ activity: 'idle', model: { provider: 'p', id: 'm' }, thinkingLevel: 'high' });
    const first = events[0]; if (first.type === 'state-changed' && 'queue' in first.change) (first.change.queue.steering as string[]).push('observer mutation');
    (snapshot.widgets[0].lines as string[]).push('snapshot mutation');
    expect(runtime.snapshot()).toEqual({ activity: 'idle', queue: { steering: ['a'], followUp: [] }, statuses: { b: 'B' }, widgets: [{ key: 'w', lines: ['replacement'], placement: 'belowEditor' }], model: { provider: 'p', id: 'm' }, thinkingLevel: 'high' });
  });
});

describe('ConversationRuntimeApplication answer and retirement', () => {
  it('validates types/options/ended dialogs and accepts cancel, false and empty values', async () => {
    const { runtime, operations, open, clock } = setup();
    runtime.accept({ type: 'dialog', dialog: { id: 's', kind: 'select', title: 'Select', options: ['yes'], expiresAt: 1100 } });
    await expect(runtime.answer({ id: 's', confirmed: true })).rejects.toMatchObject({ code: 'ANSWER_TYPE' });
    await expect(runtime.answer({ id: 's', value: 'other' })).rejects.toMatchObject({ code: 'INVALID_OPTION' });
    expect(operations.writeAnswer).not.toHaveBeenCalled();
    clock.time = 1100; // Deadline has passed even if the timer callback has not run yet.
    await expect(runtime.answer({ id: 's', cancelled: true })).rejects.toMatchObject({ code: 'DIALOG_ENDED' });
    clock.advance(0); await expect(runtime.answer({ id: 's', value: 'yes' })).rejects.toMatchObject({ code: 'DIALOG_ENDED' });
    open('empty'); await runtime.answer({ id: 'empty', value: '' });
    runtime.accept({ type: 'dialog', dialog: { id: 'confirm', kind: 'confirm', title: 'Confirm', message: '?' } });
    await runtime.answer({ id: 'confirm', confirmed: false });
    runtime.accept({ type: 'dialog', dialog: { id: 'editor', kind: 'editor', title: 'Edit', prefill: 'old' } });
    await runtime.answer({ id: 'editor', cancelled: true });
    runtime.accept({ type: 'dialog', dialog: { id: 'select', kind: 'select', title: 'Pick', options: ['yes'] } });
    await runtime.answer({ id: 'select', value: 'yes' });
    expect(runtime.snapshot().activity).toBe('idle');
    await expect(runtime.answer({ id: 'empty', value: '' })).rejects.toMatchObject({ code: 'DIALOG_ENDED' });
  });
  it('does not retire until write succeeds or synthesize an answer on timeout', async () => {
    const { runtime, operations, clock, open } = setup(); const write = deferred<void>(); operations.writeAnswer.mockReturnValueOnce(write.promise);
    open('a'); const answer = runtime.answer({ id: 'a', value: 'x' }); expect(runtime.waiting).toBe(true);
    write.resolve(); await answer; expect(runtime.waiting).toBe(false);
    open('b', { expiresAt: 1010 }); clock.advance(10); expect(operations.writeAnswer).toHaveBeenCalledTimes(1);
  });
  it('nonfatal write failure retains dialog; transport-fatal invalidation clears every dialog', async () => {
    const { runtime, operations, open } = setup(); open('a'); open('b');
    operations.writeAnswer.mockRejectedValueOnce(new Error('write failed'));
    await expect(runtime.answer({ id: 'a', value: 'x' })).rejects.toThrow('write failed'); expect(runtime.waiting).toBe(true);
    operations.writeAnswer.mockImplementationOnce(async () => { runtime.invalidate(); throw new Error('fatal'); });
    await expect(runtime.answer({ id: 'a', value: 'x' })).rejects.toThrow('fatal'); expect(runtime.waiting).toBe(false);
  });
  it('late answer/timer cannot retire a replacement dialog with the same ID', async () => {
    const { runtime, operations, clock, open, events } = setup(); const write = deferred<void>(); operations.writeAnswer.mockReturnValueOnce(write.promise);
    open('reuse', { expiresAt: 1010 }); const oldTimer = clock.tasks[0]; const answer = runtime.answer({ id: 'reuse', value: 'old' });
    clock.advance(10); open('reuse'); const before = events.length;
    write.resolve(); await answer; oldTimer.callback();
    expect(runtime.waiting).toBe(true); expect(events).toHaveLength(before);
    await runtime.answer({ id: 'reuse', value: 'new' }); expect(runtime.waiting).toBe(false);
  });
  it('invalidates pending answers and all future callbacks, even if observers throw', async () => {
    const { runtime, operations, clock, open, events } = setup(() => { throw new Error('observer'); });
    const write = deferred<void>(); operations.writeAnswer.mockReturnValueOnce(write.promise);
    open('a', { expiresAt: 1010 }); open('b'); const answer = runtime.answer({ id: 'a', value: 'x' });
    const rejected = expect(answer).rejects.toMatchObject({ code: 'INVALIDATED' });
    runtime.invalidate(); runtime.invalidate(); const before = events.length;
    write.resolve(); await rejected; clock.tasks[0].callback(); clock.advance(10); open('late'); runtime.accept({ type: 'activity', activity: 'responding' });
    expect(events).toHaveLength(before); expect(runtime.waiting).toBe(false); expect(clock.tasks[0].cancelled).toBe(true);
    expect(() => runtime.initialize({ activity: 'responding' })).toThrow('INVALIDATED');
    await expect(runtime.answer({ id: 'b', value: 'x' })).rejects.toMatchObject({ code: 'INVALIDATED' });
    expect(transcript(events).slice(-4)).toEqual(['close:a', 'state:waiting-input', 'close:b', 'state:idle']);
  });
});
