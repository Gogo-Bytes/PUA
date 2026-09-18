import { describe, expect, it, vi } from 'vitest';
import { bindWindowLifecycle } from '../../../src/app/main/lifecycle';
import { createWindowHolder } from '../../../src/app/main/create-window';
import { SessionCoordinator, type SessionProcessEvent, type SessionResult } from '../../../src/modules/sessions';
import { createSession } from '../../../src/app/main/create-session';
import { deferred, failure, fakeCapabilities, fakeWindow, settle, success } from './main-fakes';

function harness() {
  const { fake, window } = fakeWindow(); const capabilities = fakeCapabilities();
  const app = { quit: vi.fn() };
  const dialog = { showMessageBoxSync: vi.fn(() => 1), showErrorBox: vi.fn() };
  const cleanup = deferred<SessionResult>(); capabilities.session.closeAll.mockReturnValue(cleanup.promise);
  bindWindowLifecycle({ window, capabilities, app, dialog });
  const close = () => { const event = { preventDefault: vi.fn() }; fake.emit('close', event); expect(event.preventDefault).toHaveBeenCalledOnce(); return event; };
  return { fake, window, capabilities, app, dialog, cleanup, close, crash: () => fake.webContents.emit('render-process-gone') };
}
describe('bound window lifecycle with in-memory Electron/core Fakes', () => {
  it.each(['success', 'failure'] as const)('real core seals inflight create synchronously with %s cleanup despite late host/throwing observer', async outcome => {
    const { fake, window } = fakeWindow(); const capabilities = fakeCapabilities();
    const cleanup = deferred<{ exitCode: number }>(); let observe!: (event: SessionProcessEvent) => void;
    const port = { start: vi.fn(), close: vi.fn(() => cleanup.promise), observe: (listener: typeof observe) => { observe = listener; } };
    const core = new SessionCoordinator(port, () => { throw new Error('projection observer'); });
    core.create({ id: 'id', cwd: '/fake', title: 'old', kind: 'chat', startMode: 'new' }); core.start('id');
    const project = deferred<{ cwd: string; title: string }>(); const register = vi.fn();
    const inflight = createSession({ session: core, adapter: { register, activity: () => 'idle' }, conversation: { open: vi.fn() }, prepareProject: () => project.promise, createId: () => 'late' }, { executable: '/fake/pi', args: [], source: '/fake/pi' }, { cwd: '/fake', kind: 'chat', startMode: 'new', projectTrust: 'default' });
    const rejected = expect(inflight).rejects.toThrow('应用正在关闭');
    const app = { quit: vi.fn() }; const dialog = { showMessageBoxSync: vi.fn(() => 1), showErrorBox: vi.fn() };
    bindWindowLifecycle({ window, capabilities: { ...capabilities, session: core }, app, dialog });
    fake.emit('close', { preventDefault: vi.fn() });
    expect(core.checkAdmission()).toEqual({ ok: false, code: 'SHUTTING_DOWN' }); expect(core.get('id')!.lifecycle.phase).toBe('closing'); expect(port.close).toHaveBeenCalledOnce();
    project.resolve({ cwd: '/fake', title: 'late' }); await rejected; expect(register).not.toHaveBeenCalled();
    observe({ type: 'ready', id: 'id' }); observe({ type: 'title-changed', id: 'id', title: 'late title' });
    expect(core.get('id')!.title).toBe('old');
    if (outcome === 'success') cleanup.resolve({ exitCode: 0 }); else cleanup.reject(new Error('tree cleanup'));
    await settle();
    if (outcome === 'success') {
      expect(core.get('id')).toBeUndefined(); expect(app.quit).toHaveBeenCalledOnce(); expect(fake.destroy).toHaveBeenCalledOnce();
    } else {
      expect(core.get('id')).toMatchObject({ title: 'old', lifecycle: { phase: 'cleanup-failed' } }); expect(app.quit).not.toHaveBeenCalled(); expect(fake.destroy).not.toHaveBeenCalled();
      fake.emit('close', { preventDefault: vi.fn() }); await settle(); expect(port.close).toHaveBeenCalledOnce(); expect(core.checkAdmission().ok).toBe(false);
    }
  });
  it('real Session admission and running slot remain unchanged after busy cancel', () => {
    const { fake, window } = fakeWindow(); const capabilities = fakeCapabilities();
    const port = { start: vi.fn(), close: vi.fn(), observe: vi.fn() }; const core = new SessionCoordinator(port);
    core.create({ id: 'id', cwd: '/fake', title: 'old', kind: 'chat', startMode: 'new' }); core.start('id');
    const before = core.get('id'); const app = { quit: vi.fn() }; const dialog = { showMessageBoxSync: vi.fn(() => 0), showErrorBox: vi.fn() };
    capabilities.activity.mockReturnValue('responding');
    bindWindowLifecycle({ window, capabilities: { ...capabilities, session: core }, app, dialog });
    fake.emit('close', { preventDefault: vi.fn() });
    expect(core.checkAdmission().ok).toBe(true); expect(core.get('id')).toEqual(before); expect(port.close).not.toHaveBeenCalled(); expect(fake.destroy).not.toHaveBeenCalled(); expect(app.quit).not.toHaveBeenCalled();
  });
  it('busy cancel neither seals core admission nor destroys/quits; a later approval cleans synchronously', async () => {
    const h = harness(); h.capabilities.activity.mockReturnValue('responding'); h.dialog.showMessageBoxSync.mockReturnValueOnce(0);
    h.close(); expect(h.capabilities.session.closeAll).not.toHaveBeenCalled(); expect(h.fake.destroy).not.toHaveBeenCalled(); expect(h.app.quit).not.toHaveBeenCalled();
    h.close(); expect(h.capabilities.session.closeAll).toHaveBeenCalledOnce(); expect(h.fake.destroy).not.toHaveBeenCalled();
    h.cleanup.resolve(success); await settle(); expect(h.fake.destroy).toHaveBeenCalledOnce(); expect(h.app.quit).toHaveBeenCalledOnce();
  });
  it('prevents default before confirmation/core, guards reentrant confirmation and repeated pending close', async () => {
    const h = harness(); h.capabilities.activity.mockReturnValue('responding');
    h.dialog.showMessageBoxSync.mockImplementation(() => { h.close(); return 1; });
    const event = { preventDefault: vi.fn() };
    h.capabilities.session.closeAll.mockImplementation(() => {
      expect(event.preventDefault).toHaveBeenCalledOnce(); h.close(); return h.cleanup.promise;
    });
    h.fake.emit('close', event); h.close(); h.close();
    expect(h.dialog.showMessageBoxSync).toHaveBeenCalledOnce(); expect(h.capabilities.session.closeAll).toHaveBeenCalledOnce();
    expect(h.app.quit).not.toHaveBeenCalled(); h.cleanup.resolve(success); await settle();
    expect(h.fake.destroy).toHaveBeenCalledOnce(); expect(h.app.quit).toHaveBeenCalledOnce();
  });
  it('idle close calls core in the synchronous event segment, without busy dialog', async () => {
    const h = harness(); h.close(); expect(h.capabilities.session.closeAll).toHaveBeenCalledOnce();
    expect(h.dialog.showMessageBoxSync).not.toHaveBeenCalled(); expect(h.fake.destroy).not.toHaveBeenCalled();
    h.cleanup.resolve(success); await settle(); expect(h.fake.destroy).toHaveBeenCalledOnce();
  });
  it('background mode hides the window and only explicit quit closes Pi sessions', async () => {
    const { fake, window } = fakeWindow(); const capabilities = fakeCapabilities();
    const cleanup = deferred<SessionResult>(); capabilities.session.closeAll.mockReturnValue(cleanup.promise);
    const listeners = new Map<string, (event?: { preventDefault?: () => void }) => void>();
    const app = { quit: vi.fn(), on: vi.fn((event: string, listener: (event?: { preventDefault?: () => void }) => void) => listeners.set(event, listener)) };
    const dialog = { showMessageBoxSync: vi.fn(() => 1), showErrorBox: vi.fn() };
    (fake as unknown as { hide: ReturnType<typeof vi.fn> }).hide = vi.fn();
    const lifecycle = bindWindowLifecycle({ window, capabilities, app, dialog, background: true });
    const closeEvent = { preventDefault: vi.fn() }; fake.emit('close', closeEvent);
    expect(closeEvent.preventDefault).toHaveBeenCalledOnce(); expect((fake as unknown as { hide: ReturnType<typeof vi.fn> }).hide).toHaveBeenCalledOnce();
    expect(capabilities.session.closeAll).not.toHaveBeenCalled(); expect(app.quit).not.toHaveBeenCalled();
    const beforeQuit = { preventDefault: vi.fn() }; listeners.get('before-quit')!(beforeQuit);
    expect(beforeQuit.preventDefault).toHaveBeenCalledOnce(); expect(capabilities.session.closeAll).toHaveBeenCalledOnce();
    cleanup.resolve(success); await settle();
    expect(fake.destroy).toHaveBeenCalledOnce(); expect(app.quit).toHaveBeenCalledOnce();
    await lifecycle.requestQuit(); expect(capabilities.session.closeAll).toHaveBeenCalledOnce();
  });
  it.each(['false', 'reject', 'throw'] as const)('retains occupation/window on %s and repeated close reuses failed cleanup', async mode => {
    const h = harness();
    if (mode === 'throw') h.capabilities.session.closeAll.mockImplementation(() => { throw new Error('sync cleanup'); });
    h.close();
    if (mode === 'false') h.cleanup.resolve(failure);
    if (mode === 'reject') h.cleanup.reject(new Error('rejected cleanup'));
    await settle(); expect(h.fake.destroy).not.toHaveBeenCalled(); expect(h.app.quit).not.toHaveBeenCalled();
    expect(h.dialog.showErrorBox).toHaveBeenLastCalledWith('关闭进程失败', expect.stringContaining('cleanup'));
    h.close(); await settle(); expect(h.capabilities.session.closeAll).toHaveBeenCalledOnce();
    expect(h.dialog.showErrorBox).toHaveBeenCalledTimes(2); expect(h.app.quit).not.toHaveBeenCalled();
  });
  it.each(['success', 'false', 'reject'] as const)('crash alone reports %s only after cleanup and never destroys/quits', async mode => {
    const h = harness(); h.capabilities.activity.mockReturnValue('responding'); h.crash();
    expect(h.capabilities.session.closeAll).toHaveBeenCalledOnce(); expect(h.dialog.showMessageBoxSync).not.toHaveBeenCalled(); expect(h.dialog.showErrorBox).not.toHaveBeenCalled();
    if (mode === 'reject') h.cleanup.reject(new Error('cleanup')); else h.cleanup.resolve(mode === 'success' ? success : failure);
    await settle(); expect(h.dialog.showErrorBox).toHaveBeenCalledWith(mode === 'success' ? 'PUA 界面意外退出' : '进程清理失败', expect.any(String));
    expect(h.fake.destroy).not.toHaveBeenCalled(); expect(h.app.quit).not.toHaveBeenCalled();
  });
  it.each(['close-crash', 'crash-close'] as const)('shares inflight %s cleanup and emits crash notice before quit, never early success', async order => {
    const h = harness(); const calls: string[] = [];
    h.dialog.showErrorBox.mockImplementation(() => { calls.push('notice'); }); h.app.quit.mockImplementation(() => { calls.push('quit'); });
    if (order === 'close-crash') { h.close(); h.crash(); } else { h.crash(); h.close(); }
    expect(h.capabilities.session.closeAll).toHaveBeenCalledOnce(); expect(calls).toEqual([]);
    h.cleanup.resolve(success); await settle(); expect(calls).toEqual(['notice', 'quit']); expect(h.fake.destroy).toHaveBeenCalledOnce();
  });
  it.each(['close-crash', 'crash-close'] as const)('preserves separate failure notices for %s without false success', async order => {
    const h = harness(); if (order === 'close-crash') { h.close(); h.crash(); } else { h.crash(); h.close(); }
    h.cleanup.resolve(failure); await settle();
    expect(h.dialog.showErrorBox.mock.calls.map(call => call[0]).sort()).toEqual(['关闭进程失败', '进程清理失败'].sort());
    expect(h.app.quit).not.toHaveBeenCalled(); expect(h.fake.destroy).not.toHaveBeenCalled();
  });
  it('core synchronous crash observer reentry shares installed cleanup and diagnostic errors do not change cleanup success', async () => {
    const h = harness(); const report = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.capabilities.session.closeAll.mockImplementation(() => { h.crash(); return h.cleanup.promise; });
    h.dialog.showErrorBox.mockImplementation(() => { throw new Error('observer'); });
    h.close(); h.cleanup.resolve(success); await settle();
    expect(h.capabilities.session.closeAll).toHaveBeenCalledOnce(); expect(h.app.quit).toHaveBeenCalledOnce(); expect(report).toHaveBeenCalledOnce(); report.mockRestore();
  });
  it('diagnostic throws never turn true cleanup failure into success', async () => {
    const h = harness(); const report = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.dialog.showErrorBox.mockImplementation(() => { throw new Error('observer'); }); h.crash(); h.close(); h.cleanup.resolve(failure); await settle();
    expect(h.app.quit).not.toHaveBeenCalled(); expect(h.fake.destroy).not.toHaveBeenCalled(); expect(report).toHaveBeenCalledTimes(2); report.mockRestore();
  });
  it('old crash/close continuation and closed cannot operate on a replacement context', async () => {
    const old = harness(); const next = harness(); const holder = createWindowHolder();
    holder.set(old); old.fake.on('closed', () => holder.clearIfCurrent(old.window)); old.close(); holder.set(next); old.crash();
    old.cleanup.resolve(success); await settle();
    expect(old.capabilities.session.closeAll).toHaveBeenCalledOnce(); expect(next.capabilities.session.closeAll).not.toHaveBeenCalled();
    expect(next.fake.destroy).not.toHaveBeenCalled(); expect(holder.requireCurrent().window).toBe(next.window);
  });
});
