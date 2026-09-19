/** @vitest-environment jsdom */
import { installDesktopFake } from '../../../desktop-bridge-fake';
import type { DesktopAPI } from '../../../../src/shared/ipc/desktop-api';
let desktop: DesktopAPI;
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NewSessionDialog } from '../../../../src/renderer/features/sessions';
import type { ProjectResourceInfo } from '../../../../src/shared/ipc/desktop-api';

type Props = ComponentProps<typeof NewSessionDialog>;
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const resources = (paths: string[] = []): ProjectResourceInfo => ({ hasResources: paths.length > 0, paths });
const pathInput = () => screen.getByRole('textbox', { name: '项目文件夹' }) as HTMLInputElement;
const changePath = (value: string) => fireEvent.change(pathInput(), { target: { value } });
const radio = (name: RegExp) => screen.getByRole('radio', { name }) as HTMLInputElement;
const submit = () => fireEvent.submit(pathInput().closest('form')!);
const button = () => screen.getByRole('button', { name: /开始对话 ↗|打开兼容终端 ↗|正在打开…/ }) as HTMLButtonElement;
const tick = async (ms = 250) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
let props: Props;
beforeEach(() => {
  vi.useFakeTimers();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  desktop = installDesktopFake({
    inspectProjectResources: vi.fn().mockResolvedValue(resources()),
    chooseDirectory: vi.fn().mockResolvedValue(null),
  } as unknown as DesktopAPI);
  props = { initialPath: '/a', hasRuntime: true, onClose: vi.fn(), onCreate: vi.fn().mockResolvedValue(undefined), onSettings: vi.fn() };
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('NewSessionDialog production view/controller characterization (only Fake Desktop)', () => {
  it('debounces exactly 250ms, cancels unstarted checks, forwards raw cwd and gates chat submit', async () => {
    render(<NewSessionDialog {...props} />);
    expect(document.activeElement).toBe(pathInput()); expect(pathInput().required).toBe(true);
    expect(radio(/^原生对话/).checked).toBe(true); expect(radio(/^新会话/).checked).toBe(true);
    expect(button().disabled).toBe(true); submit(); expect(props.onCreate).not.toHaveBeenCalled();
    await tick(249); expect(desktop.inspectProjectResources).not.toHaveBeenCalled();
    changePath(' /b '); await tick(249); expect(desktop.inspectProjectResources).not.toHaveBeenCalled();
    await tick(1); expect(desktop.inspectProjectResources).toHaveBeenCalledExactlyOnceWith(' /b ');
    expect(button().disabled).toBe(false); submit();
    expect(props.onCreate).toHaveBeenCalledExactlyOnceWith(' /b ', 'chat', 'new', 'default');
    await tick(); expect(button().textContent).toBe('正在打开…'); // success relies on App unmount, not local reset
  });
  it.each(['resolve', 'reject'] as const)('invalidates the older of two pending cwd inspections: %s', async outcome => {
    const a = deferred<ProjectResourceInfo>(), b = deferred<ProjectResourceInfo>();
    vi.mocked(desktop.inspectProjectResources).mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    render(<NewSessionDialog {...props} />); await tick(); changePath('/b'); await tick();
    expect(vi.mocked(desktop.inspectProjectResources).mock.calls.map(call => call[0])).toEqual(['/a', '/b']);
    await act(async () => b.resolve(resources(['/b/.pi'])));
    fireEvent.click(radio(/^本次信任并/));
    await act(async () => outcome === 'resolve' ? a.resolve(resources()) : a.reject(new Error('old error')));
    expect(radio(/^本次信任并/).checked).toBe(true); expect(screen.queryByRole('alert')).toBeNull();
    expect(button().disabled).toBe(false); submit(); expect(props.onCreate).toHaveBeenCalledWith('/b', 'chat', 'new', 'approve');
  });
  it('invalidates pending A even after A → B → A; same cwd alone is not the active flag', async () => {
    const oldA = deferred<ProjectResourceInfo>(), b = deferred<ProjectResourceInfo>(), newA = deferred<ProjectResourceInfo>();
    vi.mocked(desktop.inspectProjectResources).mockReturnValueOnce(oldA.promise).mockReturnValueOnce(b.promise).mockReturnValueOnce(newA.promise);
    render(<NewSessionDialog {...props} />); await tick(); changePath('/b'); await tick(); changePath('/a'); await tick();
    await act(async () => oldA.resolve(resources(['/old']))); expect(button().disabled).toBe(true); expect(screen.queryByText('检测到项目资源')).toBeNull();
    await act(async () => newA.resolve(resources(['/new']))); expect(button().disabled).toBe(false);
    await act(async () => b.reject('late B')); expect(screen.queryByRole('alert')).toBeNull();
  });
  it('preserves already-completed same-cwd reuse while the revisit debounce is pending', async () => {
    render(<NewSessionDialog {...props} />); await tick(); changePath('/b'); changePath('/a');
    expect(button().disabled).toBe(false); submit(); expect(props.onCreate).toHaveBeenCalledWith('/a', 'chat', 'new', 'default');
    expect(desktop.inspectProjectResources).toHaveBeenCalledTimes(1);
  });
  it('resets trust immediately on cwd change, associates resources by cwd, and preserves old error display until replacement', async () => {
    vi.mocked(desktop.inspectProjectResources).mockResolvedValueOnce(resources(['/a/.pi'])).mockRejectedValueOnce(new Error('B failed')).mockResolvedValueOnce(resources(['/c/.pi']));
    render(<NewSessionDialog {...props} />); await tick(); fireEvent.click(radio(/^本次不加载/));
    changePath('/b'); expect(screen.queryByText('检测到项目资源')).toBeNull(); expect(button().disabled).toBe(true);
    await tick(); expect(screen.getByRole('alert').textContent).toBe('Error: B failed'); submit(); expect(props.onCreate).not.toHaveBeenCalled();
    changePath('/c'); expect(screen.getByRole('alert').textContent).toBe('Error: B failed');
    await tick(); expect(screen.queryByRole('alert')).toBeNull(); expect(radio(/^沿用 Pi/).checked).toBe(true);
    submit(); expect(props.onCreate).toHaveBeenCalledWith('/c', 'chat', 'new', 'default');
  });
  it.each(['', '   '])('does not inspect blank cwd %j; keeps required HTML validity distinct from trimmed button gating', async cwd => {
    render(<NewSessionDialog {...props} initialPath={cwd} />); await tick(1000);
    expect(desktop.inspectProjectResources).not.toHaveBeenCalled(); expect(button().disabled).toBe(true);
    expect(pathInput().checkValidity()).toBe(cwd !== ''); submit(); expect(props.onCreate).not.toHaveBeenCalled();
    fireEvent.click(radio(/^兼容终端/)); expect(button().disabled).toBe(true);
    // Synthetic submit bypasses native required/button checks, as did the original handler.
    submit(); expect(props.onCreate).toHaveBeenCalledWith(cwd, 'terminal', 'new', 'default');
  });
  it('terminal ignores pending/error chat inspection and supports resume; switching back resets only resume to new', async () => {
    vi.mocked(desktop.inspectProjectResources).mockRejectedValueOnce(new Error('inspection denied'));
    render(<NewSessionDialog {...props} initialKind="terminal" initialMode="continue" />);
    expect(button().disabled).toBe(false); expect(radio(/^继续最近/).checked).toBe(true);
    fireEvent.click(radio(/^选择历史/)); fireEvent.click(radio(/^原生对话/));
    expect(radio(/^新会话/).checked).toBe(true); expect(screen.queryByRole('radio', { name: /^选择历史/ })).toBeNull();
    fireEvent.click(radio(/^继续最近/)); fireEvent.click(radio(/^兼容终端/)); fireEvent.click(radio(/^原生对话/));
    expect(radio(/^继续最近/).checked).toBe(true);
    await tick(); expect(button().disabled).toBe(true); fireEvent.click(radio(/^兼容终端/));
    expect(screen.getByRole('alert').textContent).toBe('Error: inspection denied'); expect(button().disabled).toBe(false);
    fireEvent.click(radio(/^选择历史/)); submit(); expect(props.onCreate).toHaveBeenCalledWith('/a', 'terminal', 'resume', 'default');
  });
  it('locks an entry-specific terminal launcher so it cannot create an empty chat', () => {
    render(<NewSessionDialog {...props} initialKind="terminal" fixedKind="terminal" />);
    expect(screen.queryByRole('radio', { name: /^原生对话/ })).toBeNull();
    expect(radio(/^兼容终端/).disabled).toBe(true);
    submit(); expect(props.onCreate).toHaveBeenCalledExactlyOnceWith('/a', 'terminal', 'new', 'default');
  });
  it('passes the current trust to terminal too, without taking ownership of actual Pi trust or Session admission', async () => {
    vi.mocked(desktop.inspectProjectResources).mockResolvedValue(resources(['/a/.pi']));
    render(<NewSessionDialog {...props} />); await tick(); fireEvent.click(radio(/^本次不加载/)); fireEvent.click(radio(/^兼容终端/));
    submit(); expect(props.onCreate).toHaveBeenCalledWith('/a', 'terminal', 'new', 'decline');
  });
  it.each([['chat', 'new'], ['chat', 'continue'], ['terminal', 'new'], ['terminal', 'continue']] as const)('uses initial %s/%s only on mount, but callbacks and runtime props remain live', async (kind, mode) => {
    const view = render(<NewSessionDialog {...props} initialKind={kind} initialMode={mode} />);
    expect(radio(kind === 'chat' ? /^原生对话/ : /^兼容终端/).checked).toBe(true); expect(radio(mode === 'new' ? /^新会话/ : /^继续最近/).checked).toBe(true);
    const nextCreate = vi.fn().mockResolvedValue(undefined), nextSettings = vi.fn();
    view.rerender(<NewSessionDialog {...props} initialPath="/ignored" initialKind={kind === 'chat' ? 'terminal' : 'chat'} initialMode={mode === 'new' ? 'continue' : 'new'} hasRuntime={false} onCreate={nextCreate} onSettings={nextSettings} />);
    expect(pathInput().value).toBe('/a'); expect(radio(kind === 'chat' ? /^原生对话/ : /^兼容终端/).checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '先配置 Pi' })); expect(nextSettings).toHaveBeenCalledTimes(1);
    await tick(); submit(); expect(nextCreate).toHaveBeenCalledWith('/a', kind, mode, 'default'); expect(props.onCreate).not.toHaveBeenCalled();
  });
  it('keeps busy gate, captured submit values and String rejection; explicit retry does not clear the previous error', async () => {
    const first = deferred<void>(); vi.mocked(props.onCreate).mockReturnValueOnce(first.promise);
    render(<NewSessionDialog {...props} />); await tick(); submit(); submit(); expect(props.onCreate).toHaveBeenCalledTimes(1);
    changePath('/b'); await tick(); await act(async () => first.reject({ toString: () => 'create failed' }));
    expect(screen.getByRole('alert').textContent).toBe('create failed'); expect(button().disabled).toBe(false);
    submit(); expect(props.onCreate).toHaveBeenLastCalledWith('/b', 'chat', 'new', 'default'); expect(screen.getByRole('alert').textContent).toBe('create failed');
  });
  it('does not catch a synchronous callback throw as an async rejection or recover busy', async () => {
    const thrown = new Error('sync callback'); const errors: unknown[] = [];
    const onWindowError = (event: ErrorEvent) => { errors.push(event.error); event.preventDefault(); };
    window.addEventListener('error', onWindowError);
    try {
      vi.mocked(props.onCreate).mockImplementation(() => { throw thrown; });
      render(<NewSessionDialog {...props} />); await tick(); submit();
      expect(errors).toEqual([thrown]); expect(screen.queryByRole('alert')).toBeNull(); expect(button().disabled).toBe(true);
    } finally { window.removeEventListener('error', onWindowError); }
  });
  it('preserves choose cancel/reject and completion-order late directory overwrite, without a picker lock', async () => {
    const first = deferred<string | null>(), second = deferred<string | null>();
    vi.mocked(desktop.chooseDirectory).mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('picker failed')).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<NewSessionDialog {...props} />);
    const browse = () => fireEvent.click(screen.getByRole('button', { name: '浏览…' }));
    browse(); await tick(0); expect(pathInput().value).toBe('/a'); browse(); await tick(0); expect(screen.getByRole('alert').textContent).toBe('Error: picker failed');
    browse(); browse(); changePath('/typed'); await act(async () => second.resolve('/second')); expect(pathInput().value).toBe('/second');
    await act(async () => first.resolve('/first')); expect(pathInput().value).toBe('/first'); expect(screen.getByRole('alert').textContent).toBe('Error: picker failed');
    expect(desktop.chooseDirectory).toHaveBeenCalledTimes(4);
  });
  it('clears debounce on unmount and validates but does not publish late inspection success or stringify late errors', async () => {
    const a = render(<NewSessionDialog {...props} />); a.unmount(); await tick(); expect(desktop.inspectProjectResources).not.toHaveBeenCalled();
    const pending = deferred<ProjectResourceInfo>(); vi.mocked(desktop.inspectProjectResources).mockReturnValueOnce(pending.promise);
    const b = render(<NewSessionDialog {...props} />); await tick(); b.unmount(); expect(vi.getTimerCount()).toBe(0);
    const paths = vi.fn(() => ['/late']); await act(async () => pending.resolve({ hasResources: true, get paths() { return paths(); } })); expect(paths).toHaveBeenCalledOnce();
    const failure = deferred<ProjectResourceInfo>(); vi.mocked(desktop.inspectProjectResources).mockReturnValueOnce(failure.promise);
    const c = render(<NewSessionDialog {...props} />); await tick(); c.unmount();
    const toString = vi.fn(() => 'late error'); await act(async () => failure.reject({ toString })); expect(toString).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull(); expect(props.onCreate).not.toHaveBeenCalled();
  });
  it('allows a late picker completion after unmount without affecting a newly mounted dialog', async () => {
    const pending = deferred<string | null>(); vi.mocked(desktop.chooseDirectory).mockReturnValueOnce(pending.promise);
    const old = render(<NewSessionDialog {...props} />); fireEvent.click(screen.getByRole('button', { name: '浏览…' })); old.unmount();
    render(<NewSessionDialog {...props} initialPath="/new" />); await act(async () => pending.resolve('/old-picked'));
    expect(pathInput().value).toBe('/new'); expect(props.onCreate).not.toHaveBeenCalled();
    await tick(); expect(desktop.inspectProjectResources).toHaveBeenCalledExactlyOnceWith('/new');
  });
  it('keeps close and native cancel requests active even while submitting; Modal prevents default cancel', async () => {
    const pending = deferred<void>(); vi.mocked(props.onCreate).mockReturnValueOnce(pending.promise);
    const view = render(<NewSessionDialog {...props} />); await tick(); submit();
    fireEvent.click(screen.getByRole('button', { name: '关闭对话框' })); expect(props.onClose).toHaveBeenCalledTimes(1);
    const cancel = new Event('cancel', { cancelable: true }); fireEvent(screen.getByRole('dialog'), cancel);
    expect(cancel.defaultPrevented).toBe(true); expect(props.onClose).toHaveBeenCalledTimes(2);
    view.unmount(); await act(async () => pending.reject('late create'));
    expect(screen.queryByRole('dialog')).toBeNull(); expect(props.onCreate).toHaveBeenCalledTimes(1);
  });
});
