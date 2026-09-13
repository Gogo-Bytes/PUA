/** @vitest-environment jsdom */
import { installDesktopFake } from '../../../desktop-bridge-fake';
import type { DesktopAPI } from '../../../../src/shared/ipc/desktop-api';
let desktop: DesktopAPI;
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsDialog } from '../../../../src/renderer/features/preferences';
import type { Bootstrap, Preferences } from '../../../../src/shared/ipc/desktop-api';

// No host storage/chooser, clipboard, filesystem, Pi or runtime implementation is loaded.
type Props = ComponentProps<typeof SettingsDialog>;
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const input = (name: string) => screen.getByRole('textbox', { name }) as HTMLInputElement;
const change = (name: string, value: string) => fireEvent.change(input(name), { target: { value } });
const submit = () => fireEvent.submit(input('Pi 路径').closest('form')!);
const saveButton = () => screen.getByRole('button', { name: /保存设置|保存中…/ }) as HTMLButtonElement;
const choose = (index = 0) => fireEvent.click(screen.getAllByRole('button', { name: '选择…' })[index]);
const flush = async () => { await act(async () => {}); };
let boot: Bootstrap, props: Props;
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  boot = { preferences: { piPath: '/pi', nodePath: '/node', args: ['--extension', '/global.ts'], fontSize: 14, recentProjects: ['/owned'] }, runtime: { executable: '/pi', args: [], source: 'detected source' }, home: '/home', platform: 'darwin' };
  desktop = installDesktopFake({ chooseFile: vi.fn().mockResolvedValue(null), savePreferences: vi.fn(async (preferences: Preferences) => ({ ...boot, preferences })) } as unknown as DesktopAPI);
  props = { boot, onSave: vi.fn(), onClose: vi.fn() };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('SettingsDialog public view characterization (Fake Desktop)', () => {
  it('preserves initial JSON formatting, default theme, DOM semantics and range Number conversion', async () => {
    const view = render(<SettingsDialog {...props} />);
    expect(screen.getByRole('dialog').className).toBe('ui-dialog');
    expect(input('Pi 路径').value).toBe('/pi'); expect(input('Node.js 路径').value).toBe('/node');
    expect(input('Pi CLI 参数').value).toBe(JSON.stringify(boot.preferences.args));
    expect(screen.getByRole('button', { name: '跟随系统' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('detected source').tagName).toBe('CODE');
    expect(screen.getByText('路径与参数修改仅影响新会话。')).toBeTruthy();
    for (const button of within(screen.getByRole('dialog')).getAllByRole('button')) {
      expect(button.getAttribute('type')).toBe(button === saveButton() ? 'submit' : 'button');
    }
    const range = screen.getByRole('slider', { name: '终端字号' }) as HTMLInputElement;
    expect([range.min, range.max, range.className]).toEqual(['10', '28', 'range']);
    fireEvent.change(range, { target: { value: '22' } }); expect(screen.getByText('22px')).toBeTruthy();
    expect(desktop.savePreferences).not.toHaveBeenCalled(); submit(); await flush();
    expect(desktop.savePreferences).toHaveBeenCalledWith({ ...boot.preferences, fontSize: 22 });
    expect(view.container.querySelectorAll('.runtime-card')).toHaveLength(1);
  });
  it('keeps mount-only dirty draft/args but live runtime display and new callbacks after props change', async () => {
    const view = render(<SettingsDialog {...props} />); change('Pi 路径', '/dirty'); change('Pi CLI 参数', '["--dirty"]');
    const onSave = vi.fn(), onClose = vi.fn();
    const next = { ...boot, preferences: { ...boot.preferences, piPath: '/ignored', args: ['--ignored'], theme: 'dark' as const }, runtime: { ...boot.runtime!, source: 'new live source' } };
    view.rerender(<SettingsDialog boot={next} onSave={onSave} onClose={onClose} />);
    expect(input('Pi 路径').value).toBe('/dirty'); expect(input('Pi CLI 参数').value).toBe('["--dirty"]');
    expect(screen.getByText('new live source')).toBeTruthy(); expect(screen.getByRole('button', { name: '跟随系统' }).getAttribute('aria-pressed')).toBe('true');
    submit(); await flush(); expect(onSave).toHaveBeenCalledTimes(1); expect(onClose).toHaveBeenCalledTimes(1); expect(props.onSave).not.toHaveBeenCalled();
    expect(desktop.savePreferences).toHaveBeenCalledWith({ ...boot.preferences, piPath: '/dirty', args: ['--dirty'] });
    view.rerender(<SettingsDialog {...props} boot={{ ...next, runtime: null }} />); expect(screen.getByText('未检测到')).toBeTruthy();
  });
  it('preserves the initial preferences reference rather than cloning or freezing it', async () => {
    const view = render(<SettingsDialog {...props} />);
    boot.preferences.piPath = '/mutated'; boot.preferences.args.push('--external');
    view.rerender(<SettingsDialog {...props} />);
    expect(input('Pi 路径').value).toBe('/mutated'); expect(input('Pi CLI 参数').value).toBe('["--extension","/global.ts"]');
    submit(); await flush();
    const sent = vi.mocked(desktop.savePreferences).mock.calls[0][0];
    expect(sent).not.toBe(boot.preferences); expect(sent.recentProjects).toBe(boot.preferences.recentProjects);
    expect(sent.args).toEqual(['--extension', '/global.ts']); expect(boot.preferences.args).toContain('--external');
  });
  it('merges late picker completion into the latest fields; same-key picks follow completion order', async () => {
    const first = deferred<string | null>(), second = deferred<string | null>();
    vi.mocked(desktop.chooseFile).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<SettingsDialog {...props} />); choose(); choose(); change('Node.js 路径', '/typed-node'); change('Pi 路径', '/typed-pi');
    fireEvent.click(screen.getByRole('button', { name: '深色' }));
    await act(async () => second.resolve('/second')); expect(input('Pi 路径').value).toBe('/second');
    await act(async () => first.resolve('/first')); expect(input('Pi 路径').value).toBe('/first'); expect(input('Node.js 路径').value).toBe('/typed-node');
    expect(screen.getByRole('button', { name: '深色' }).getAttribute('aria-pressed')).toBe('true');
    submit(); await flush(); expect(desktop.savePreferences).toHaveBeenCalledWith(expect.objectContaining({ piPath: '/first', nodePath: '/typed-node', theme: 'dark' }));
  });
  it('preserves picker cancel, failure String and unchanged error on later success', async () => {
    vi.mocked(desktop.chooseFile).mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('picker denied')).mockResolvedValueOnce('/new-node');
    render(<SettingsDialog {...props} />); choose(); await flush(); expect(input('Pi 路径').value).toBe('/pi');
    choose(); await flush(); expect(screen.getByRole('alert').textContent).toBe('Error: picker denied');
    choose(1); await flush(); expect(input('Node.js 路径').value).toBe('/new-node'); expect(screen.getByRole('alert').textContent).toBe('Error: picker denied');
    expect(desktop.savePreferences).not.toHaveBeenCalled();
  });
  it('catches synchronous picker throw too', async () => {
    vi.mocked(desktop.chooseFile).mockImplementation(() => { throw new Error('sync picker'); });
    render(<SettingsDialog {...props} />); choose(); await flush(); expect(screen.getByRole('alert').textContent).toBe('Error: sync picker');
  });
  it.each(['{}', 'null', '12', '"value"', '[1]', '[null]', '["ok",false]'])('keeps the existing array/string-only client check for %s', async args => {
    render(<SettingsDialog {...props} />); change('Pi CLI 参数', args); submit(); await flush();
    expect(screen.getByRole('alert').textContent).toBe('Error: 参数必须是 JSON 字符串数组'); expect(saveButton().disabled).toBe(false);
    expect(desktop.savePreferences).not.toHaveBeenCalled(); expect(props.onSave).not.toHaveBeenCalled();
  });
  it('reports native JSON parse failure, then clears error and enters busy before host save', async () => {
    const pending = deferred<Bootstrap>(); vi.mocked(desktop.savePreferences).mockReturnValueOnce(pending.promise);
    render(<SettingsDialog {...props} />); change('Pi CLI 参数', '['); submit();
    expect(screen.getByRole('alert').textContent).toMatch(/^SyntaxError:/); expect(saveButton().disabled).toBe(false);
    // Client intentionally does not duplicate the backend strict CLI/schema policy.
    change('Pi CLI 参数', '["", "--mode", "rpc"]'); fireEvent.click(saveButton());
    expect(saveButton().disabled).toBe(true); expect(screen.queryByRole('alert')).toBeNull();
    expect(desktop.savePreferences).toHaveBeenCalledWith(expect.objectContaining({ args: ['', '--mode', 'rpc'] }));
    await act(async () => pending.reject(new Error('host rejects'))); expect(screen.getByRole('alert').textContent).toBe('Error: host rejects'); expect(saveButton().disabled).toBe(false);
  });
  it('catches host synchronous throw and allows explicit correction/retry', async () => {
    vi.mocked(desktop.savePreferences).mockImplementationOnce(() => { throw new Error('sync save'); });
    render(<SettingsDialog {...props} />); submit(); expect(screen.getByRole('alert').textContent).toBe('Error: sync save'); expect(saveButton().disabled).toBe(false);
    change('Pi 路径', '/fixed'); submit(); await flush(); expect(props.onSave).toHaveBeenCalledTimes(1); expect(props.onClose).toHaveBeenCalledTimes(1);
  });
  it('publishes the exact result before reading runtimeError, including callback mutation and same-continuation close', async () => {
    const pending = deferred<Bootstrap>(), order: string[] = [];
    vi.mocked(desktop.savePreferences).mockReturnValueOnce(pending.promise);
    const result = { ...boot, runtimeError: 'pre-publish error' };
    const onSave = vi.fn((value: Bootstrap) => { order.push('publish'); expect(value).toBe(result); value.runtimeError = ''; queueMicrotask(() => order.push('microtask')); });
    const onClose = vi.fn(() => { order.push('close'); });
    render(<SettingsDialog {...props} onSave={onSave} onClose={onClose} />); submit(); await act(async () => pending.resolve(result));
    expect(order).toEqual(['publish', 'close', 'microtask']); expect(screen.queryByRole('alert')).toBeNull();
    expect(saveButton().disabled).toBe(true); // successful caller is responsible for unmounting
  });
  it('publishes runtimeError results yet keeps dialog editable and resets busy, then closes on successful retry', async () => {
    const result = { ...boot, preferences: { ...boot.preferences, piPath: '/normalized' }, runtime: null, runtimeError: 'runtime failed' };
    vi.mocked(desktop.savePreferences).mockResolvedValueOnce(result);
    render(<SettingsDialog {...props} />); change('Pi 路径', '/draft'); submit(); await flush();
    expect(props.onSave).toHaveBeenCalledExactlyOnceWith(result); expect(vi.mocked(props.onSave).mock.calls[0][0]).toBe(result);
    expect(props.onClose).not.toHaveBeenCalled(); expect(saveButton().disabled).toBe(false); expect(screen.getByRole('alert').textContent).toBe('runtime failed'); expect(input('Pi 路径').value).toBe('/draft');
    change('Pi 路径', '/corrected'); submit(); await flush(); expect(props.onClose).toHaveBeenCalledTimes(1);
  });
  it.each(['onSave', 'onClose'] as const)('handles %s callback throws via the existing Promise catch', async callback => {
    props[callback] = vi.fn(() => { throw new Error(`${callback} failed`); });
    render(<SettingsDialog {...props} />); submit(); await flush();
    expect(screen.getByRole('alert').textContent).toBe(`Error: ${callback} failed`); expect(saveButton().disabled).toBe(false);
    expect(props.onSave).toHaveBeenCalledTimes(1); expect(props.onClose).toHaveBeenCalledTimes(callback === 'onSave' ? 0 : 1);
  });
  it('does not add a lock for duplicate synthetic submits and applies each captured result in completion order', async () => {
    const first = deferred<Bootstrap>(), second = deferred<Bootstrap>();
    vi.mocked(desktop.savePreferences).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<SettingsDialog {...props} />); submit(); change('Pi 路径', '/second'); submit();
    expect(desktop.savePreferences).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(desktop.savePreferences).mock.calls;
    expect(calls[0][0].piPath).toBe('/pi'); expect(calls[1][0].piPath).toBe('/second'); expect(calls[0][0].args).not.toBe(calls[1][0].args);
    const a = { ...boot, runtimeError: 'late old failure' }, b = { ...boot, runtimeError: '' };
    await act(async () => second.resolve(b)); expect(props.onClose).toHaveBeenCalledTimes(1);
    await act(async () => first.resolve(a)); expect(vi.mocked(props.onSave).mock.calls.map(call => call[0])).toEqual([b, a]);
    expect(screen.getByRole('alert').textContent).toBe('late old failure'); expect(saveButton().disabled).toBe(false);
  });
  it('retains captured callbacks/values during save even after props change and draft editing', async () => {
    const pending = deferred<Bootstrap>(); vi.mocked(desktop.savePreferences).mockReturnValueOnce(pending.promise);
    const view = render(<SettingsDialog {...props} />); submit(); const nextSave = vi.fn(), nextClose = vi.fn();
    view.rerender(<SettingsDialog {...props} onSave={nextSave} onClose={nextClose} />); change('Pi 路径', '/later');
    const sent = vi.mocked(desktop.savePreferences).mock.calls[0][0]; sent.nodePath = '/host-mutated';
    expect(input('Node.js 路径').value).toBe('/node');
    await act(async () => pending.resolve({ ...boot, preferences: sent }));
    expect(props.onSave).toHaveBeenCalledTimes(1); expect(props.onClose).toHaveBeenCalledTimes(1); expect(nextSave).not.toHaveBeenCalled(); expect(nextClose).not.toHaveBeenCalled();
    expect(input('Pi 路径').value).toBe('/later');
  });
  it('keeps all close/cancel affordances active inflight; late saves still publish and close via old callbacks', async () => {
    const pending = deferred<Bootstrap>(); vi.mocked(desktop.savePreferences).mockReturnValueOnce(pending.promise);
    const view = render(<SettingsDialog {...props} />); submit();
    fireEvent.click(screen.getByRole('button', { name: '取消' })); fireEvent.click(screen.getByRole('button', { name: '关闭对话框' }));
    const cancel = new Event('cancel', { cancelable: true }); fireEvent(screen.getByRole('dialog'), cancel); expect(cancel.defaultPrevented).toBe(true); expect(props.onClose).toHaveBeenCalledTimes(3);
    view.unmount(); await act(async () => pending.resolve(boot)); expect(props.onSave).toHaveBeenCalledWith(boot); expect(props.onClose).toHaveBeenCalledTimes(4);
  });
  it.each(['resolve', 'reject'] as const)('does not affect a new dialog after late picker %s; late failures are still stringified', async outcome => {
    const pending = deferred<string | null>(); vi.mocked(desktop.chooseFile).mockReturnValueOnce(pending.promise);
    const view = render(<SettingsDialog {...props} />); choose(); view.unmount();
    render(<SettingsDialog {...props} boot={{ ...boot, preferences: { ...boot.preferences, piPath: '/new-dialog' } }} />);
    const toString = vi.fn(() => 'late picker');
    await act(async () => outcome === 'resolve' ? pending.resolve('/old-picked') : pending.reject({ toString }));
    expect(input('Pi 路径').value).toBe('/new-dialog'); expect(screen.queryByRole('alert')).toBeNull(); expect(toString).not.toHaveBeenCalled();
  });
});
