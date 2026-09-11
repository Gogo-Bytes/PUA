/** @vitest-environment jsdom */
import { installDesktopFake } from '../../../desktop-bridge-fake';
import type { DesktopAPI } from '../../../../src/shared/ipc/desktop-api';
let desktop: DesktopAPI;
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bootstrap, Preferences } from '../../../../src/shared/ipc/desktop-api';
// Import probe only; these empty-workspace journeys never mount a terminal.
vi.mock('@xterm/xterm', () => ({ Terminal: vi.fn() }));
import { App } from '../../../../src/renderer/App';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
let boot: Bootstrap;
const input = (name: string) => screen.getByRole('textbox', { name }) as HTMLInputElement;
const change = (name: string, value: string) => fireEvent.change(input(name), { target: { value } });
const open = async () => {
  const button = screen.getAllByRole('button', { name: '桌面设置' })[0];
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false)); fireEvent.click(button);
};
const flush = async () => { await act(async () => {}); };
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 });
  window.matchMedia = vi.fn(query => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia;
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  boot = { preferences: { piPath: '/pi', nodePath: '', args: ['--extension', '/global.ts'], fontSize: 14, recentProjects: ['/old-project'], theme: 'light' }, runtime: { executable: '/pi', args: [], source: '/pi' }, home: '/home', platform: 'darwin' };
  desktop = installDesktopFake({
    bootstrap: vi.fn(async () => boot), onSessionEvent: vi.fn(() => () => {}),
    chooseFile: vi.fn().mockResolvedValue(null), inspectProjectResources: vi.fn().mockResolvedValue({ hasResources: false, paths: [] }),
    savePreferences: vi.fn(async (preferences: Preferences) => { boot = { ...boot, preferences }; return boot; }),
    createSession: vi.fn(), startSession: vi.fn(), closeSession: vi.fn(),
  } as unknown as DesktopAPI);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('real App → SettingsDialog → Fake Desktop characterization', () => {
  it('opens, chooses, parses, publishes runtimeError without closing, corrects and saves theme/bootstrap in place', async () => {
    const picker = deferred<string | null>(), first = deferred<Bootstrap>(), second = deferred<Bootstrap>();
    vi.mocked(desktop.chooseFile).mockReturnValueOnce(picker.promise);
    vi.mocked(desktop.savePreferences).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<App />); await open();
    const dialog = screen.getByRole('dialog');
    fireEvent.click(screen.getAllByRole('button', { name: '选择…' })[0]); change('Node.js 路径', '/typed-node'); fireEvent.click(screen.getByRole('button', { name: '深色' }));
    expect(document.documentElement.dataset.theme).toBe('light'); expect(desktop.savePreferences).not.toHaveBeenCalled();
    await act(async () => picker.resolve('/picked')); expect(input('Node.js 路径').value).toBe('/typed-node');
    change('Pi CLI 参数', 'no JSON'); fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    expect(within(dialog).getByRole('alert').textContent).toMatch(/^SyntaxError:/); expect(desktop.savePreferences).not.toHaveBeenCalled();
    change('Pi CLI 参数', '["--extension","/new.ts"]'); fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    expect(screen.getByRole('button', { name: '保存中…' })).toBeTruthy(); expect(within(dialog).queryByRole('alert')).toBeNull();
    const sent = vi.mocked(desktop.savePreferences).mock.calls[0][0];
    expect(sent).toEqual({ ...boot.preferences, piPath: '/picked', nodePath: '/typed-node', theme: 'dark', args: ['--extension', '/new.ts'] });
    const failed = { ...boot, preferences: { ...sent, piPath: '/host-normalized', recentProjects: ['/published-project'] }, runtime: null, runtimeError: 'runtime failed after save' };
    await act(async () => first.resolve(failed));
    expect(screen.getByRole('dialog')).toBe(dialog); expect(within(dialog).getByRole('alert').textContent).toBe(failed.runtimeError);
    expect(document.documentElement.dataset.theme).toBe('dark'); expect(screen.getByTitle('/published-project')).toBeTruthy();
    expect(screen.getByText('尚未连接 Pi')).toBeTruthy(); expect(within(dialog).getByText('未检测到')).toBeTruthy();
    expect(input('Pi 路径').value).toBe('/picked'); expect(input('Pi CLI 参数').value).toBe('["--extension","/new.ts"]');
    change('Pi 路径', '/fixed'); fireEvent.click(screen.getByRole('button', { name: '浅色' })); fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    const sentAgain = vi.mocked(desktop.savePreferences).mock.calls[1][0];
    // The mounted draft retains old recents too; main remains authority and ignores client edits.
    expect(sentAgain.recentProjects).toBe(boot.preferences.recentProjects);
    const success = { ...boot, preferences: { ...sentAgain, recentProjects: ['/final-project'] }, runtime: { executable: '/fixed', args: [], source: 'fixed runtime' } };
    await act(async () => second.resolve(success)); expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.documentElement.dataset.theme).toBe('light'); expect(screen.getByTitle('/final-project')).toBeTruthy(); expect(screen.getByText('本机 Pi')).toBeTruthy();
    expect(desktop.bootstrap).toHaveBeenCalledTimes(1); expect(desktop.startSession).not.toHaveBeenCalled(); expect(desktop.createSession).not.toHaveBeenCalled(); expect(desktop.closeSession).not.toHaveBeenCalled();
    await open(); expect(input('Pi 路径').value).toBe('/fixed'); expect(screen.getByText('fixed runtime')).toBeTruthy();
  });
  it('keeps NewSessionDialog → settings jump and uses saved bootstrap on a later launch', async () => {
    boot = { ...boot, runtime: null, runtimeError: 'no runtime' }; render(<App />);
    const launch = screen.getByRole('button', { name: '新建会话' }); await waitFor(() => expect((launch as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(launch); fireEvent.click(screen.getByRole('button', { name: '先配置 Pi' }));
    expect(screen.queryByRole('textbox', { name: '项目文件夹' })).toBeNull(); expect(input('Pi 路径')).toBeTruthy();
    vi.mocked(desktop.savePreferences).mockResolvedValueOnce({ ...boot, runtimeError: undefined, runtime: { executable: '/fixed', args: [], source: '/fixed' }, preferences: { ...boot.preferences, recentProjects: ['/saved-default'] } });
    fireEvent.click(screen.getByRole('button', { name: '保存设置' })); await flush(); expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(launch); expect(input('项目文件夹').value).toBe('/saved-default'); expect(screen.getByRole('button', { name: '开始对话 ↗' })).toBeTruthy(); expect(screen.queryByRole('button', { name: '先配置 Pi' })).toBeNull();
    expect(desktop.createSession).not.toHaveBeenCalled();
  });
  it.each(['success', 'runtimeError', 'reject'] as const)('preserves late old-save %s after closing and opening another settings dialog', async outcome => {
    const pending = deferred<Bootstrap>(); vi.mocked(desktop.savePreferences).mockReturnValueOnce(pending.promise);
    render(<App />); await open(); fireEvent.click(screen.getByRole('button', { name: '深色' })); fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' })); expect(screen.queryByRole('dialog')).toBeNull(); await open(); change('Pi 路径', '/new-dirty');
    const nextDialog = screen.getByRole('dialog');
    const result = { ...boot, preferences: { ...boot.preferences, theme: 'dark' as const }, runtimeError: outcome === 'runtimeError' ? 'old runtime error' : undefined };
    await act(async () => outcome === 'reject' ? pending.reject('old rejection') : pending.resolve(result));
    expect(document.documentElement.dataset.theme).toBe(outcome === 'reject' ? 'light' : 'dark');
    if (outcome === 'success') expect(screen.queryByRole('dialog')).toBeNull(); // old onClose closes the currently open App flag
    else {
      expect(screen.getByRole('dialog')).toBe(nextDialog); expect(input('Pi 路径').value).toBe('/new-dirty'); expect(within(nextDialog).queryByRole('alert')).toBeNull();
      expect(screen.getByRole('button', { name: '浅色' }).getAttribute('aria-pressed')).toBe('true');
    }
    expect(desktop.savePreferences).toHaveBeenCalledTimes(1);
  });
});
