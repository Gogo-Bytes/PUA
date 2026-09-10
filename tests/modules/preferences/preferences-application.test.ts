import { describe, expect, it, vi } from 'vitest';
import { PreferencesApplication, type PreferenceValues } from '../../../src/modules/preferences/index';

const values = (): PreferenceValues => ({ piPath: '', nodePath: '', args: ['--fake'], fontSize: 14, recentProjects: ['/old'] });
function deferred<T = void>() {
  let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const rethrow = async (error: unknown): Promise<never> => { throw error; };
describe('PreferencesApplication sole current/owned recents owner with Fake persistence', () => {
  it('owns recents before the first await; only successful persistence publishes the original input', async () => {
    const initial = values(); const completion = deferred(); const write = vi.fn(() => completion.promise);
    const application = new PreferencesApplication(initial, { write }); const next = { ...values(), recentProjects: ['/client'], fontSize: 18 };
    const after = vi.fn(() => { expect(application.read()).toBe(next); return 'bootstrap'; });
    const pending = application.save(next, after);
    expect(application.read()).toBe(initial); expect(next.recentProjects).toBe(initial.recentProjects); expect(write).toHaveBeenCalledExactlyOnceWith(next); expect(after).not.toHaveBeenCalled();
    completion.resolve(); expect(await pending).toBe('bootstrap'); expect(application.read()).toBe(next); expect(after).toHaveBeenCalledOnce();
  });
  it.each(['throw', 'reject'] as const)('save %s is an async rejection without publication or completion', async mode => {
    const error = new Error('write'); const initial = values();
    const application = new PreferencesApplication(initial, { write: () => { if (mode === 'throw') throw error; return Promise.reject(error); } });
    const after = vi.fn(); let pending!: Promise<unknown>;
    expect(() => { pending = application.save(values(), after); }).not.toThrow();
    await expect(pending).rejects.toBe(error); expect(application.read()).toBe(initial); expect(after).not.toHaveBeenCalled();
  });
  it('publishes and calls completion before a competing write-resolution observer; completion errors remain published', async () => {
    const completion = deferred(); const trace: string[] = []; const next = values();
    const application = new PreferencesApplication(values(), { write: () => completion.promise });
    const error = new Error('bootstrap'); const pending = application.save(next, () => { trace.push('bootstrap'); expect(application.read()).toBe(next); throw error; });
    const rejected = expect(pending).rejects.toBe(error);
    const observer = completion.promise.then(() => { trace.push('observer'); expect(application.read()).toBe(next); });
    completion.resolve(); await rejected; await observer; expect(trace).toEqual(['bootstrap', 'observer']); expect(application.read()).toBe(next);
  });
  it('retains optional theme and mutable initial/input/read references rather than introducing snapshots', async () => {
    const initial = values(); const completion = deferred(); const application = new PreferencesApplication(initial, { write: () => completion.promise });
    initial.fontSize = 15; expect(application.read().fontSize).toBe(15); expect(application.read().theme).toBeUndefined();
    const next = values(); const pending = application.save(next, () => application.read());
    next.fontSize = 20; next.args.push('late'); completion.resolve(); expect(await pending).toBe(next);
    application.read().args.push('from read'); expect(next.args).toEqual(['--fake', 'late', 'from read']);
    const error = new Error('write'); const failed = new PreferencesApplication(next, { write: () => Promise.reject(error) });
    const rejected = failed.save(next, () => undefined); next.fontSize = 22;
    await expect(rejected).rejects.toBe(error); expect(failed.read().fontSize).toBe(22); // No proactive replacement is not immutability.
  });
  it('records exact promote/filter/slice, not a second full normalization policy', async () => {
    const initial = { ...values(), recentProjects: ['/a', '/other', '/other', '/a', ...Array.from({ length: 25 }, (_, i) => `/p${i}`)] };
    const write = vi.fn().mockResolvedValue(undefined); const application = new PreferencesApplication(initial, { write });
    await application.recordRecent('/a', rethrow);
    expect(application.read().recentProjects).toEqual(['/a', '/other', '/other', ...Array.from({ length: 17 }, (_, i) => `/p${i}`)]);
    await application.recordRecent('/a', rethrow); expect(application.read().recentProjects).toHaveLength(20); expect(application.read().recentProjects.slice(0, 3)).toEqual(['/a', '/other', '/other']);
  });
  it.each(['throw', 'reject'] as const)('recordRecent %s begins failure compensation in the write continuation and waits for it', async mode => {
    const completion = deferred(); const cleanup = deferred<never>(); const started = deferred(); const trace: string[] = []; const initial = values(); const error = new Error('write');
    const application = new PreferencesApplication(initial, { write: () => { if (mode === 'throw') throw error; return completion.promise; } });
    const pending = application.recordRecent('/new', received => { expect(received).toBe(error); trace.push('cleanup'); started.resolve(); return cleanup.promise; });
    const rejected = expect(pending).rejects.toThrow('cleanup error');
    const observer = completion.promise.catch(() => { trace.push('observer'); });
    if (mode === 'reject') completion.reject(error); else completion.resolve();
    await started.promise; expect(trace[0]).toBe('cleanup'); expect(application.read()).toBe(initial);
    cleanup.reject(new Error('cleanup error')); await rejected; await observer; expect(application.read()).toBe(initial);
  });
  it('does not publish recordRecent until persistence succeeds', async () => {
    const initial = values(); const completion = deferred(); const application = new PreferencesApplication(initial, { write: () => completion.promise }); const failure = vi.fn(rethrow);
    const pending = application.recordRecent('/new', failure); expect(application.read()).toBe(initial);
    completion.resolve(); await pending; expect(application.read()).toEqual({ ...initial, recentProjects: ['/new', '/old'] }); expect(failure).not.toHaveBeenCalled();
  });
  it('keeps concurrent save/recordRecent call-time snapshots without a transaction or outer lock', async () => {
    const saveWrite = deferred(); const recentWrite = deferred(); const write = vi.fn().mockReturnValueOnce(saveWrite.promise).mockReturnValueOnce(recentWrite.promise);
    const application = new PreferencesApplication(values(), { write });
    const next = { ...values(), fontSize: 18 }; const saved = application.save(next, () => application.read());
    const recent = application.recordRecent('/new', rethrow); expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1][0]).toEqual({ ...values(), recentProjects: ['/new', '/old'] });
    saveWrite.resolve(); expect(await saved).toBe(next); recentWrite.resolve(); await recent;
    expect(application.read()).toEqual({ ...values(), recentProjects: ['/new', '/old'] }); // Old font snapshot wins last.
  });
});
