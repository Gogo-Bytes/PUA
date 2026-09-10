import { describe, expect, it, vi } from 'vitest';
import { SessionCoordinator, type PreparedSession, type SessionProcessEvent, type SessionProcessPort, type SessionChange } from '../../../src/modules/sessions/index';

function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
class FakeProcess implements SessionProcessPort {
  listener!: (event: SessionProcessEvent) => void;
  cleanup = new Map<string, ReturnType<typeof deferred<{ exitCode: number }>>>();
  start = vi.fn<(id: string) => void | Promise<void>>();
  close = vi.fn((id: string) => { const work = deferred<{ exitCode: number }>(); this.cleanup.set(id, work); return work.promise; });
  observe(listener: (event: SessionProcessEvent) => void) { this.listener = listener; }
  event(event: SessionProcessEvent) { this.listener(event); }
  done(id: string) { this.cleanup.get(id)!.resolve({ exitCode: 7 }); }
}
const command = (id: string, extra: Partial<PreparedSession> = {}): PreparedSession => ({ id, cwd: '/project', title: 'Project', kind: 'chat', startMode: 'new', ...extra });
function setup(observer?: (event: SessionChange) => void) { const process = new FakeProcess(); const core = new SessionCoordinator(process, observer); return { core, process }; }

describe('SessionCoordinator with an ID-addressed Fake Process Adapter', () => {
  it('reserves without awaiting or notifying, permits new chat parallelism, and returns detached snapshots', () => {
    const notify = vi.fn(); const { core } = setup(notify);
    expect(core.create(command('a')).ok).toBe(true); expect(core.create(command('b')).ok).toBe(true);
    expect(notify).not.toHaveBeenCalled();
    const snapshot = core.get('a')!; snapshot.title = 'tampered'; snapshot.lifecycle.phase = 'running';
    expect(core.get('a')).toMatchObject({ title: 'Project', lifecycle: { phase: 'reserved' } });
  });
  it('blocks new history until continue handshake, with atomic competing prepared creates', () => {
    const { core, process } = setup();
    expect(core.create(command('a', { startMode: 'continue' })).ok).toBe(true);
    expect(core.create(command('b', { startMode: 'continue' }))).toMatchObject({ code: 'RESTORE_CONFLICT' });
    expect(core.create(command('c'))).toMatchObject({ code: 'RESTORE_CONFLICT' });
    core.start('a'); expect(core.create(command('c')).ok).toBe(false);
    process.event({ type: 'ready', id: 'a' }); expect(core.create(command('c')).ok).toBe(true);
  });
  it('locks before start calls the adapter, including reentrant duplicate starts', () => {
    const { core, process } = setup(); core.create(command('a'));
    process.start.mockImplementation(id => { expect(core.get(id)?.lifecycle.phase).toBe('starting'); expect(core.start(id)).toMatchObject({ code: 'SESSION_NOT_STARTABLE' }); });
    core.start('a'); core.start('a'); expect(process.start).toHaveBeenCalledTimes(1);
  });
  it('close-before-start locks immediately, shares work, and only releases after final cleanup', async () => {
    const events: SessionChange[] = []; const { core, process } = setup(event => events.push(event)); core.create(command('a'));
    const closed = core.close('a'); expect(core.close('a')).toBe(closed);
    expect(core.get('a')?.lifecycle.phase).toBe('closing'); expect(core.start('a').ok).toBe(false);
    expect(core.create(command('b', { kind: 'terminal' })).ok).toBe(false);
    expect(events).toEqual([]); expect(process.close).toHaveBeenCalledTimes(1);
    process.done('a'); expect(await closed).toMatchObject({ ok: true });
    expect(events.map(event => event.type)).toEqual(['exited', 'removed']);
    expect(core.get('a')).toBeUndefined(); expect(core.create(command('b', { kind: 'terminal' })).ok).toBe(true);
    expect(await core.close('a')).toMatchObject({ code: 'SESSION_NOT_FOUND' });
  });
  it.each(['before', 'during'] as const)('host exit %s close cannot resurrect or duplicate cleanup', async timing => {
    const { core, process } = setup(); core.create(command('a')); core.start('a');
    if (timing === 'before') process.event({ type: 'transport-ended', id: 'a' });
    const closed = core.close('a');
    process.event({ type: 'transport-ended', id: 'a' }); process.event({ type: 'transport-ended', id: 'a' });
    process.event({ type: 'ready', id: 'a' }); process.event({ type: 'title-changed', id: 'a', title: 'late' });
    expect(core.get('a')).toMatchObject({ title: 'Project', lifecycle: { phase: 'closing' } });
    core.start('a'); expect(process.start).toHaveBeenCalledTimes(1); expect(process.close).toHaveBeenCalledTimes(1);
    process.done('a'); await closed; process.event({ type: 'ready', id: 'a' }); expect(core.get('a')).toBeUndefined();
  });
  it('unexpected exit retains record but releases ownership only after cleanup', async () => {
    const { core, process } = setup(); core.create(command('a', { kind: 'terminal' })); core.start('a');
    process.event({ type: 'transport-ended', id: 'a' }); expect(core.create(command('b')).ok).toBe(false);
    process.done('a'); await Promise.resolve(); expect(core.get('a')?.lifecycle).toEqual({ phase: 'exited', exitCode: 7 });
    expect(core.create(command('b')).ok).toBe(true); expect(core.start('a').ok).toBe(false);
    await core.close('a'); expect(process.close).toHaveBeenCalledTimes(1);
  });
  it('cleanup rejection is sticky, retains ownership, and observers cannot break failure or cleanup', async () => {
    const { core, process } = setup(() => { throw new Error('observer'); }); core.create(command('a', { kind: 'terminal' }));
    const closed = core.close('a'); process.cleanup.get('a')!.reject(new Error('tree alive'));
    expect(await closed).toMatchObject({ code: 'CLEANUP_FAILED' }); expect(core.get('a')?.lifecycle.phase).toBe('cleanup-failed');
    expect(core.close('a')).toBe(closed); expect(core.create(command('b')).ok).toBe(false); expect(core.start('a').ok).toBe(false);
    process.event({ type: 'transport-ended', id: 'a' }); expect(process.close).toHaveBeenCalledTimes(1);
  });
  it.each(['throw', 'reject', 'event'] as const)('start %s compensates through cleanup, never implicitly restarts', async failure => {
    const { core, process } = setup(() => { throw new Error('observer'); }); core.create(command('a'));
    process.start.mockImplementation(id => {
      if (failure === 'throw') throw new Error('fork');
      if (failure === 'reject') return Promise.reject(new Error('fork'));
      process.event({ type: 'start-failed', id, detail: 'fork' });
    });
    core.start('a'); await Promise.resolve(); expect(core.get('a')?.lifecycle.phase).toBe('closing');
    expect(core.start('a').ok).toBe(false); process.done('a'); await Promise.resolve();
    expect(core.get('a')?.lifecycle.phase).toBe('exited');
  });
  it('start failure with failed compensation keeps ownership', async () => {
    const { core, process } = setup(); core.create(command('a', { startMode: 'continue' }));
    process.start.mockImplementation(() => { throw new Error('fork'); }); core.start('a');
    process.cleanup.get('a')!.reject(new Error('cleanup')); await Promise.resolve();
    expect(core.get('a')?.lifecycle.phase).toBe('cleanup-failed'); expect(core.create(command('b')).ok).toBe(false);
  });
  it('installs close work before synchronous close event reentry', async () => {
    const { core, process } = setup(); core.create(command('a'));
    const work = deferred<{ exitCode: number }>(); let nested: ReturnType<typeof core.close> | undefined;
    process.close.mockImplementation(id => { nested = core.close(id); process.event({ type: 'transport-ended', id }); return work.promise; });
    const closed = core.close('a'); expect(nested).toBe(closed); expect(process.close).toHaveBeenCalledTimes(1);
    work.resolve({ exitCode: 0 }); await closed;
  });
  it('synchronous close failure becomes a sticky cleanup result', async () => {
    const { core, process } = setup(); core.create(command('a', { kind: 'terminal' }));
    process.close.mockImplementation(() => { throw new Error('close failed'); });
    const closed = core.close('a'); expect(await closed).toMatchObject({ code: 'CLEANUP_FAILED' });
    expect(core.close('a')).toBe(closed); expect(core.create(command('b')).ok).toBe(false);
  });
  it('closeAll seals create/start before any work and waits for every close even if one fails', async () => {
    const { core, process } = setup(); core.create(command('a')); core.create(command('b'));
    const all = core.closeAll(); expect(core.create(command('c'))).toMatchObject({ code: 'SHUTTING_DOWN' }); expect(core.start('a')).toMatchObject({ code: 'SHUTTING_DOWN' });
    expect(process.close.mock.calls).toEqual([['a'], ['b']]);
    let settled = false; void all.then(() => { settled = true; });
    process.cleanup.get('a')!.reject(new Error('failed')); await Promise.resolve(); await Promise.resolve(); expect(settled).toBe(false);
    process.done('b'); expect(await all).toMatchObject({ code: 'CLEANUP_FAILED' }); expect(core.get('a')).toBeDefined(); expect(core.get('b')).toBeUndefined();
  });
});
