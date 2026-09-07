/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bootstrap, Preferences } from '../src/shared/contracts';
import type { SessionEvent } from '../src/shared/chat';
vi.mock('react-virtuoso', () => ({ Virtuoso: ({ data = [], itemContent }: { data?: unknown[]; itemContent(index: number, item: unknown): React.ReactNode }) => <div>{data.map((item, index) => <div key={index}>{itemContent(index, item)}</div>)}</div> }));
// These tests mount the real ChatPane, not a terminal. xterm's import probes canvas in jsdom.
vi.mock('@xterm/xterm', () => ({ Terminal: vi.fn() }));
import { App } from '../src/renderer/App';

let listeners: Set<(event: SessionEvent) => void>;
let mediaListeners: Set<(event: MediaQueryListEvent) => void>;
let boot: Bootstrap;
const emit = (event: SessionEvent) => act(() => { listeners.forEach(listener => listener(event)); });
beforeEach(() => {
  listeners = new Set(); mediaListeners = new Set();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 });
  window.matchMedia = vi.fn(query => ({ matches: false, media: query, addEventListener: (_type: string, callback: (event: MediaQueryListEvent) => void) => { if (query.includes('color-scheme')) mediaListeners.add(callback); }, removeEventListener: (_type: string, callback: (event: MediaQueryListEvent) => void) => mediaListeners.delete(callback) })) as unknown as typeof window.matchMedia;
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  boot = { preferences: { piPath: '/pi', nodePath: '', args: ['--extension', '/global.ts'], fontSize: 14, recentProjects: ['/one/app', '/two/app', '/empty'] }, runtime: { executable: '/pi', args: [], source: '/pi' }, home: '/home', platform: 'darwin' };
  let count = 0;
  window.desktop = {
    bootstrap: vi.fn(async () => boot), onSessionEvent: vi.fn(callback => { listeners.add(callback); return () => listeners.delete(callback); }),
    inspectProjectResources: vi.fn().mockResolvedValue({ hasResources: false, paths: [] }),
    createSession: vi.fn(async options => ({ id: `s${++count}`, title: `会话 ${count}`, cwd: options.cwd, kind: options.kind, processStatus: 'running', activity: 'idle' })),
    startSession: vi.fn().mockResolvedValue(undefined), closeSession: vi.fn().mockResolvedValue(true), renameChatSession: vi.fn().mockResolvedValue(undefined),
    chooseChatAttachments: vi.fn().mockResolvedValue([{ id: 'attachment-1', name: 'context.txt', path: '/context.txt', size: 7, kind: 'file' }]),
    removeChatAttachment: vi.fn().mockResolvedValue(undefined), sendChatMessage: vi.fn().mockResolvedValue(undefined), stopChat: vi.fn().mockResolvedValue(undefined),
    savePreferences: vi.fn(async (preferences: Preferences) => { boot = { ...boot, preferences }; return boot; }),
    gitStatus: vi.fn().mockResolvedValue({ root: '/one/app', branch: 'main', files: [], capturedAt: '2026-01-01T00:00:00Z' }),
    writeClipboard: vi.fn().mockResolvedValue(undefined), openExternal: vi.fn().mockResolvedValue(undefined),
  } as unknown as typeof window.desktop;
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView; });

async function createSession() {
  fireEvent.click(screen.getByRole('button', { name: '新建会话' }));
  const submit = await screen.findByRole('button', { name: '开始对话 ↗' });
  await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(submit);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}
const selectProject = (path: string) => fireEvent.click(within(screen.getByRole('navigation', { name: '项目' })).getByTitle(path));

describe('production workspace navigation', () => {
  it('keeps actual ChatPane draft, attachments and stream subscriptions across tabs/projects; closes through host', async () => {
    const { container } = render(<App />);
    await screen.findByTitle('/one/app'); selectProject('/one/app'); await createSession();
    const firstPane = container.querySelector('[data-session-id="s1"]');
    const firstDraft = screen.getByRole('textbox', { name: '发送消息' }); fireEvent.change(firstDraft, { target: { value: 'unfinished first' } });
    fireEvent.click(screen.getByRole('button', { name: '添加附件' })); await screen.findByText('context.txt');
    await createSession(); fireEvent.change(screen.getByRole('textbox', { name: '发送消息' }), { target: { value: 'second draft' } });
    selectProject('/two/app'); expect(screen.getByText(/此项目还没有打开的会话/)).toBeTruthy(); await createSession();
    emit({ id: 's1', type: 'chat-message-start', message: { id: 'm1', role: 'assistant', blocks: [{ type: 'text', text: 'background reply' }], timestamp: 1 } });
    selectProject('/one/app'); expect((screen.getByRole('textbox', { name: '发送消息' }) as HTMLTextAreaElement).value).toBe('second draft');
    fireEvent.click(screen.getByRole('tab', { name: '会话 1' }));
    expect(screen.getByRole('textbox', { name: '发送消息' })).toBe(firstDraft);
    expect((firstDraft as HTMLTextAreaElement).value).toBe('unfinished first'); expect(screen.getByText('context.txt')).toBeTruthy(); expect(screen.getByText('background reply')).toBeTruthy();
    expect(container.querySelector('[data-session-id="s1"]')).toBe(firstPane);
    expect(window.desktop.startSession).toHaveBeenCalledTimes(3);
    vi.mocked(window.desktop.closeSession).mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: '关闭 会话 1' })); await waitFor(() => expect(window.desktop.closeSession).toHaveBeenCalledWith('s1'));
    expect(container.querySelector('[data-session-id="s1"]')).toBe(firstPane);
    fireEvent.click(screen.getByRole('button', { name: '关闭 会话 1' })); await waitFor(() => expect(container.querySelector('[data-session-id="s1"]')).toBeNull());
    expect((screen.getByRole('textbox', { name: '发送消息' }) as HTMLTextAreaElement).value).toBe('second draft');
    fireEvent.click(screen.getByRole('button', { name: '关闭 会话 2' })); await screen.findByText(/此项目还没有打开的会话/);
    expect(screen.queryByRole('tab')).toBeNull(); expect(container.querySelector('[data-session-id="s3"]')).toBeTruthy();
    expect(window.desktop.sendChatMessage).not.toHaveBeenCalled();
  });
  it('supports overflow keyboard/Escape focus return and tab keyboard navigation', async () => {
    render(<App />); await screen.findByTitle('/one/app'); selectProject('/one/app'); await createSession(); await createSession();
    const trigger = screen.getByRole('button', { name: '全部会话' }); fireEvent.click(trigger);
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: '会话 2' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Home' }); expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: '会话 1' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' }); expect(screen.queryByRole('menu')).toBeNull(); expect(document.activeElement).toBe(trigger);
    fireEvent.keyDown(screen.getByRole('tab', { name: '会话 2' }), { key: 'ArrowLeft' }); expect(screen.getByRole('tab', { name: '会话 1' }).getAttribute('aria-selected')).toBe('true');
    expect(window.desktop.startSession).toHaveBeenCalledTimes(2);
  });
  it('scrolls overflow-selected tabs nearest without stealing focus from the menu trigger (no jsdom layout claim)', async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
    render(<App />); await screen.findByTitle('/one/app'); selectProject('/one/app'); await createSession(); await createSession();
    scrollIntoView.mockClear();
    const trigger = screen.getByRole('button', { name: '全部会话' }); fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitemradio', { name: '会话 1' }));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(screen.getByRole('tab', { name: '会话 1' }));
    expect(document.activeElement).toBe(trigger); expect(screen.queryByRole('menu')).toBeNull();
    // An already active tab may also have been manually scrolled out of view.
    scrollIntoView.mockClear(); fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitemradio', { name: '会话 1' }));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(screen.getByRole('tab', { name: '会话 1' }));
    expect(document.activeElement).toBe(trigger); expect(screen.queryByRole('menu')).toBeNull();
  });
  it('does not consume closed-inspector Escape or editable/IME/local-menu Escape while open', async () => {
    render(<App />); await screen.findByTitle('/one/app'); selectProject('/one/app'); await createSession();
    emit({ id: 's1', type: 'chat-snapshot', snapshot: { messages: [], commands: [{ name: 'review-real', source: 'extension' }], activity: 'idle', queue: { steering: [], followUp: [] }, statuses: {}, widgets: [] } });
    const draft = screen.getByRole('textbox', { name: '发送消息' }); const toggle = screen.getByRole('button', { name: '显示或收起检查区' });
    draft.focus(); fireEvent.keyDown(draft, { key: 'Escape' });
    expect(document.activeElement).toBe(draft); expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle); await screen.findByText('这个范围没有变更');
    draft.focus(); fireEvent.keyDown(draft, { key: 'Escape' });
    expect(document.activeElement).toBe(draft); expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.compositionStart(draft); fireEvent.keyDown(draft, { key: 'Escape', isComposing: true }); fireEvent.compositionEnd(draft);
    fireEvent.keyDown(toggle, { key: 'Escape', keyCode: 229 });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.change(draft, { target: { value: '/rev' } }); expect(screen.getByLabelText('Pi 命令建议')).toBeTruthy();
    fireEvent.keyDown(draft, { key: 'Escape' });
    expect(screen.queryByLabelText('Pi 命令建议')).toBeNull(); expect(document.activeElement).toBe(draft); expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.change(draft, { target: { value: '/revi' } }); fireEvent.keyDown(draft, { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByLabelText('Pi 命令建议')).toBeNull(); expect(document.activeElement).toBe(draft); expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '全部会话' })); fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull(); expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const closeButton = screen.getByRole('button', { name: '关闭变更面板' }); closeButton.focus(); fireEvent.keyDown(closeButton, { key: 'Escape' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false'); expect(document.activeElement).toBe(toggle);
    // Mounted background panes must not let their hidden suggestions block Escape.
    fireEvent.change(draft, { target: { value: '/rev' } }); await createSession();
    fireEvent.click(toggle); await screen.findByText('这个范围没有变更');
    fireEvent.keyDown(screen.getByRole('button', { name: '关闭变更面板' }), { key: 'Escape' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false'); expect(document.activeElement).toBe(toggle);
  });
  it('uses default system changes and saved themes without recreating sessions or losing draft', async () => {
    render(<App />); await screen.findByTitle('/one/app'); selectProject('/one/app'); await createSession();
    const draft = screen.getByRole('textbox', { name: '发送消息' }); fireEvent.change(draft, { target: { value: 'theme draft' } });
    expect(document.documentElement.dataset.theme).toBe('light');
    act(() => mediaListeners.forEach(listener => listener({ matches: true } as MediaQueryListEvent)));
    expect(document.documentElement.dataset.theme).toBe('dark');
    const settings = screen.getByRole('button', { name: '桌面设置' }); settings.focus(); fireEvent.click(settings);
    fireEvent.click(screen.getByRole('button', { name: '浅色' })); fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(settings); expect(document.documentElement.dataset.theme).toBe('light');
    act(() => mediaListeners.forEach(listener => listener({ matches: true } as MediaQueryListEvent)));
    expect(document.documentElement.dataset.theme).toBe('light'); expect(window.desktop.savePreferences).toHaveBeenCalledWith(expect.objectContaining({ theme: 'light', args: ['--extension', '/global.ts'] }));
    expect(screen.getByRole('textbox', { name: '发送消息' })).toBe(draft); expect((draft as HTMLTextAreaElement).value).toBe('theme draft'); expect(window.desktop.startSession).toHaveBeenCalledTimes(1);
    fireEvent.click(settings); fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: false, cancelable: true })); expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(settings);
  });
  it('keeps composition Enter safe, stops the real runtime and reports rename errors inside the dialog', async () => {
    render(<App />); await screen.findByTitle('/one/app'); selectProject('/one/app'); await createSession();
    const draft = screen.getByRole('textbox', { name: '发送消息' }); fireEvent.change(draft, { target: { value: '中文输入' } });
    fireEvent.compositionStart(draft); fireEvent.keyDown(draft, { key: 'Enter' }); fireEvent.compositionEnd(draft);
    fireEvent.keyDown(draft, { key: 'Enter', keyCode: 229 }); expect(window.desktop.sendChatMessage).not.toHaveBeenCalled();
    emit({ id: 's1', type: 'chat-state', state: { activity: 'responding' } }); fireEvent.click(screen.getByRole('button', { name: '停止运行' }));
    await waitFor(() => expect(window.desktop.stopChat).toHaveBeenCalledWith('s1'));
    vi.mocked(window.desktop.renameChatSession).mockRejectedValueOnce(new Error('rename refused'));
    fireEvent.click(screen.getByRole('button', { name: '重命名' })); fireEvent.change(screen.getByRole('textbox', { name: '会话显示名' }), { target: { value: 'New name' } });
    fireEvent.click(screen.getByRole('button', { name: '保存名称' }));
    expect((await within(screen.getByRole('dialog')).findByRole('alert')).textContent).toContain('rename refused');
  });
  it('routes only Pi-provided commands into draft, and closes the narrow inspector with focus return', async () => {
    render(<App />); await screen.findByTitle('/one/app'); selectProject('/one/app'); await createSession();
    emit({ id: 's1', type: 'chat-snapshot', snapshot: { messages: [], commands: [{ name: 'review-real', source: 'extension', description: 'Real extension' }], activity: 'idle', queue: { steering: [], followUp: [] }, statuses: {}, widgets: [] } });
    const commands = screen.getByRole('button', { name: /搜索与命令/ }); commands.focus(); fireEvent.click(commands);
    fireEvent.click(screen.getByRole('button', { name: /review-real/ })); expect((screen.getByRole('textbox', { name: '发送消息' }) as HTMLTextAreaElement).value).toBe('/review-real'); expect(window.desktop.sendChatMessage).not.toHaveBeenCalled();
    const toggle = screen.getByRole('button', { name: '显示或收起检查区' }); fireEvent.click(toggle);
    await screen.findByText('这个范围没有变更'); expect(window.desktop.gitStatus).toHaveBeenCalledWith('s1');
    fireEvent.click(screen.getByRole('button', { name: '关闭变更面板' })); expect(screen.queryByRole('complementary', { name: '文件与 Git 检查区' })).toBeNull(); expect(document.activeElement).toBe(toggle);
    fireEvent.click(toggle);
    // The inserted command has suggestions: dismiss that local menu before the inspector.
    fireEvent.keyDown(screen.getByRole('textbox', { name: '发送消息' }), { key: 'Escape' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(toggle, { key: 'Escape' }); expect(document.activeElement).toBe(toggle); expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });
});
