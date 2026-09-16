/** @vitest-environment jsdom */
import { installDesktopFake } from './desktop-bridge-fake';
import type { DesktopAPI } from '../src/shared/ipc/desktop-api';
let desktop: DesktopAPI;
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bootstrap, Preferences } from '../src/shared/ipc/desktop-api';
import type { SessionEvent } from '../src/shared/ipc/conversation';
vi.mock('react-virtuoso', () => ({ Virtuoso: ({ data = [], itemContent }: { data?: unknown[]; itemContent(index: number, item: unknown): React.ReactNode }) => <div>{data.map((item, index) => <div key={index}>{itemContent(index, item)}</div>)}</div> }));
// These tests mount the real ChatPane, not a terminal. xterm's import probes canvas in jsdom.
vi.mock('@xterm/xterm', () => ({ Terminal: vi.fn() }));
import { App } from '../src/renderer/app/App';

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
  desktop = installDesktopFake({
    bootstrap: vi.fn(async () => boot), onSessionEvent: vi.fn(callback => { listeners.add(callback); return () => listeners.delete(callback); }),
    inspectProjectResources: vi.fn().mockResolvedValue({ hasResources: false, paths: [] }),
    createSession: vi.fn(async options => ({ id: `s${++count}`, title: `会话 ${count}`, cwd: options.cwd, kind: options.kind, processStatus: 'running', activity: 'idle' })),
    startSession: vi.fn().mockResolvedValue(undefined), closeSession: vi.fn().mockResolvedValue(true), renameChatSession: vi.fn().mockResolvedValue(undefined),
    chooseChatAttachments: vi.fn().mockResolvedValue([{ id: 'attachment-1', name: 'context.txt', path: '/context.txt', size: 7, kind: 'file' }]),
    removeChatAttachment: vi.fn().mockResolvedValue(undefined), sendChatMessage: vi.fn().mockResolvedValue(undefined), stopChat: vi.fn().mockResolvedValue(undefined),
    savePreferences: vi.fn(async (preferences: Preferences) => { boot = { ...boot, preferences }; return boot; }),
    gitStatus: vi.fn().mockResolvedValue({ root: '/one/app', branch: 'main', files: [], capturedAt: '2026-01-01T00:00:00Z' }),
    writeClipboard: vi.fn().mockResolvedValue(undefined), openExternal: vi.fn().mockResolvedValue(undefined),
  } as unknown as DesktopAPI);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView; });

async function createSession() {
  const started = vi.mocked(desktop.startSession).mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: '新建会话' }));
  await waitFor(() => expect(desktop.startSession).toHaveBeenCalledTimes(started + 1));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}
const selectProject = (path: string) => fireEvent.click(within(screen.getByRole('navigation', { name: '项目' })).getByTitle(path));

describe('production workspace navigation', () => {
  it('keeps actual ChatPane draft, attachments and stream subscriptions across sidebar sessions/projects; closes through host', async () => {
    const { container } = render(<App />);
    await screen.findByTitle('/one/app'); selectProject('/one/app');
    await screen.findByRole('button', { name: '会话 1' });
    const firstPane = container.querySelector('[data-session-id="s1"]');
    const firstDraft = screen.getByRole('textbox', { name: '发送消息' }); fireEvent.change(firstDraft, { target: { value: 'unfinished first' } });
    fireEvent.click(screen.getByRole('button', { name: '添加附件' })); await screen.findByText('context.txt');
    await createSession(); fireEvent.change(screen.getByRole('textbox', { name: '发送消息' }), { target: { value: 'second draft' } });
    selectProject('/two/app');
    await screen.findByRole('button', { name: '会话 3' });
    expect(screen.queryByRole('dialog')).toBeNull();
    emit({ id: 's1', type: 'chat-message-start', message: { id: 'm1', role: 'assistant', blocks: [{ type: 'text', text: 'background reply' }], timestamp: 1 } });
    fireEvent.click(screen.getByRole('button', { name: '会话 2' }));
    expect((screen.getByRole('textbox', { name: '发送消息' }) as HTMLTextAreaElement).value).toBe('second draft');
    fireEvent.click(screen.getByRole('button', { name: '会话 1' }));
    expect(screen.getByRole('textbox', { name: '发送消息' })).toBe(firstDraft);
    expect((firstDraft as HTMLTextAreaElement).value).toBe('unfinished first'); expect(screen.getByText('context.txt')).toBeTruthy(); expect(screen.getByText('background reply')).toBeTruthy();
    expect(container.querySelector('[data-session-id="s1"]')).toBe(firstPane);
    expect(desktop.startSession).toHaveBeenCalledTimes(3);
    vi.mocked(desktop.closeSession).mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: '关闭 会话 1' })); await waitFor(() => expect(desktop.closeSession).toHaveBeenCalledWith('s1'));
    expect(container.querySelector('[data-session-id="s1"]')).toBe(firstPane);
    fireEvent.click(screen.getByRole('button', { name: '关闭 会话 1' })); await waitFor(() => expect(container.querySelector('[data-session-id="s1"]')).toBeNull());
    expect((screen.getByRole('textbox', { name: '发送消息' }) as HTMLTextAreaElement).value).toBe('second draft');
    fireEvent.click(screen.getByRole('button', { name: '关闭 会话 2' }));
    await waitFor(() => expect(container.querySelector('[data-session-id="s2"]')).toBeNull());
    expect(screen.queryByRole('button', { name: '会话 2' })).toBeNull();
    expect(container.querySelector('[data-session-id="s3"]')).toBeTruthy();
    expect(desktop.sendChatMessage).not.toHaveBeenCalled();
  });
  it('collapses project children without unmounting the active conversation or losing its draft', async () => {
    const { container } = render(<App />);
    await screen.findByTitle('/one/app'); selectProject('/one/app');
    await screen.findByRole('button', { name: '会话 1' }); await createSession();
    const pane = container.querySelector('[data-session-id="s2"]');
    const draft = screen.getByRole('textbox', { name: '发送消息' });
    fireEvent.change(draft, { target: { value: 'retained while collapsed' } });
    const collapse = screen.getByRole('button', { name: '折叠 app' });
    collapse.focus(); fireEvent.click(collapse);
    expect(screen.queryByRole('button', { name: '会话 2' })).toBeNull();
    expect(container.querySelector('[data-session-id="s2"]')).toBe(pane);
    expect((draft as HTMLTextAreaElement).value).toBe('retained while collapsed');
    expect(document.activeElement).toBe(collapse);
    fireEvent.click(screen.getByRole('button', { name: '展开 app' }));
    expect(screen.getByRole('button', { name: '会话 2' }).getAttribute('aria-current')).toBe('page');
    fireEvent.click(screen.getByRole('button', { name: '会话 1' }));
    expect(screen.getByRole('button', { name: '会话 1' }).getAttribute('aria-current')).toBe('page');
    expect(desktop.startSession).toHaveBeenCalledTimes(2);
  });
  it('filters sidebar session names without changing selection or disposing hidden panes', async () => {
    const { container } = render(<App />);
    await screen.findByTitle('/one/app'); selectProject('/one/app');
    await screen.findByRole('button', { name: '会话 1' });
    selectProject('/two/app'); await screen.findByRole('button', { name: '会话 2' });
    const pane = container.querySelector('[data-session-id="s2"]');
    const draft = screen.getByRole('textbox', { name: '发送消息' });
    const filter = screen.getByPlaceholderText('查找项目或会话…');
    fireEvent.change(filter, { target: { value: '会话 1' } });
    expect(screen.getByRole('button', { name: '会话 1' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '会话 2' })).toBeNull();
    expect(screen.getByRole('textbox', { name: '发送消息' })).toBe(draft);
    expect(container.querySelector('[data-session-id="s2"]')).toBe(pane);
    fireEvent.change(filter, { target: { value: '' } });
    expect(screen.getByRole('button', { name: '会话 2' }).getAttribute('aria-current')).toBe('page');
    expect(desktop.startSession).toHaveBeenCalledTimes(2);
  });
  it('does not consume closed-inspector Escape or editable/IME/local-menu Escape while open', async () => {
    render(<App />); await screen.findByTitle('/one/app'); selectProject('/one/app'); await createSession();
    emit({ id: 's1', type: 'chat-snapshot', snapshot: { messages: [], commands: [{ name: 'review-real', source: 'extension' }], activity: 'idle', queue: { steering: [], followUp: [] }, statuses: {}, widgets: [] } });
    const draft = screen.getByRole('textbox', { name: '发送消息' }); const toggle = screen.getByRole('button', { name: /(?:显示|收起) 检查器/ });
    fireEvent.click(toggle); draft.focus(); fireEvent.keyDown(draft, { key: 'Escape' });
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
    fireEvent.keyDown(screen.getByRole('button', { name: '会话 1' }), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull(); expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const closeButton = screen.getByRole('button', { name: '关闭变更面板' }); closeButton.focus(); fireEvent.keyDown(closeButton, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(toggle));
    // Mounted background panes must not let their hidden suggestions block Escape.
    fireEvent.change(draft, { target: { value: '/rev' } }); await createSession();
    fireEvent.click(toggle); await screen.findByText('这个范围没有变更');
    fireEvent.keyDown(await screen.findByRole('button', { name: '关闭变更面板' }), { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(toggle));
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
    expect(document.documentElement.dataset.theme).toBe('light'); expect(desktop.savePreferences).toHaveBeenCalledWith(expect.objectContaining({ theme: 'light', args: ['--extension', '/global.ts'] }));
    expect(screen.getByRole('textbox', { name: '发送消息' })).toBe(draft); expect((draft as HTMLTextAreaElement).value).toBe('theme draft'); expect(desktop.startSession).toHaveBeenCalledTimes(1);
    fireEvent.click(settings); fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: false, cancelable: true })); expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(settings);
  });
  it('keeps composition Enter safe, stops the real runtime and reports rename errors beside the inline editor', async () => {
    render(<App />); await screen.findByTitle('/one/app'); selectProject('/one/app'); await createSession();
    const draft = screen.getByRole('textbox', { name: '发送消息' }); fireEvent.change(draft, { target: { value: '中文输入' } });
    fireEvent.compositionStart(draft); fireEvent.keyDown(draft, { key: 'Enter' }); fireEvent.compositionEnd(draft);
    fireEvent.keyDown(draft, { key: 'Enter', keyCode: 229 }); expect(desktop.sendChatMessage).not.toHaveBeenCalled();
    emit({ id: 's1', type: 'chat-state', state: { activity: 'responding' } }); fireEvent.click(screen.getByRole('button', { name: '停止运行' }));
    await waitFor(() => expect(desktop.stopChat).toHaveBeenCalledWith('s1'));
    vi.mocked(desktop.renameChatSession).mockRejectedValueOnce(new Error('rename refused'));
    fireEvent.keyDown(screen.getByRole('tab', { selected: true, name: /会话/ }), { key: 'F2' }); fireEvent.change(screen.getByRole('textbox', { name: /^重命名 / }), { target: { value: 'New name' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect((await screen.findByRole('alert')).textContent).toContain('rename refused');
  });
  it('routes only Pi-provided commands into draft, and closes the narrow inspector with focus return', async () => {
    render(<App />); await screen.findByTitle('/one/app'); selectProject('/one/app'); await createSession();
    emit({ id: 's1', type: 'chat-snapshot', snapshot: { messages: [], commands: [{ name: 'review-real', source: 'extension', description: 'Real extension' }], activity: 'idle', queue: { steering: [], followUp: [] }, statuses: {}, widgets: [] } });
    const commands = screen.getByRole('button', { name: /搜索与命令/ }); commands.focus(); fireEvent.click(commands);
    fireEvent.click(screen.getByRole('button', { name: /review-real/ })); expect((screen.getByRole('textbox', { name: '发送消息' }) as HTMLTextAreaElement).value).toBe('/review-real'); expect(desktop.sendChatMessage).not.toHaveBeenCalled();
    const toggle = screen.getByRole('button', { name: /(?:显示|收起) 检查器/ });
    await screen.findByText('这个范围没有变更'); expect(desktop.gitStatus).toHaveBeenCalledWith('s1');
    fireEvent.click(screen.getByRole('button', { name: '关闭变更面板' })); expect(screen.queryByRole('complementary', { name: '文件与 Git 检查区' })).toBeNull(); expect(document.activeElement).toBe(toggle);
    fireEvent.click(toggle);
    // The inserted command has suggestions: dismiss that local menu before the inspector.
    fireEvent.keyDown(screen.getByRole('textbox', { name: '发送消息' }), { key: 'Escape' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(toggle, { key: 'Escape' }); expect(document.activeElement).toBe(toggle); expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const selected = (title: string) => expect(screen.getByRole('button', { name: title }).getAttribute('aria-current')).toBe('page');
const closeTab = (title: string) => fireEvent.click(screen.getByRole('button', { name: `关闭 ${title}` }));
async function seedProjects() {
  const view = render(<App />); await screen.findByTitle('/one/app'); selectProject('/one/app');
  await createSession(); await createSession(); await createSession();
  selectProject('/two/app'); await createSession(); selectProject('/one/app');
  return view;
}
async function submitPendingCreate() {
  fireEvent.click(screen.getByRole('button', { name: '新建会话' }));
}

describe('Workspace real App with in-memory Desktop deferred completions (not Electron/Pi)', () => {
  it.each(['other', 'remembered', 'empty'] as const)('repairs close using latest selection: %s', async scenario => {
    const { container, unmount } = await seedProjects(); const pending = deferred<boolean>();
    vi.mocked(desktop.closeSession).mockReturnValueOnce(pending.promise);
    closeTab('会话 3'); expect(container.querySelector('[data-session-id="s3"]')).toBeTruthy();
    if (scenario === 'remembered') fireEvent.click(screen.getByRole('button', { name: '会话 1' }));
    selectProject(scenario === 'empty' ? '/empty' : '/two/app');
    await act(async () => pending.resolve(true));
    expect(container.querySelector('[data-session-id="s3"]')).toBeNull();
    if (scenario === 'empty') { expect(screen.queryByRole('tab')).toBeNull(); expect(within(screen.getByRole('navigation', { name: '项目' })).getByTitle('/empty').getAttribute('aria-current')).toBe('page'); }
    else selected('会话 4');
    selectProject('/one/app'); selected(scenario === 'remembered' ? '会话 1' : '会话 2');
    expect(desktop.startSession).toHaveBeenCalledTimes(4); expect(listeners.size).toBe(4);
    unmount(); expect(listeners.size).toBe(0);
  });
  it('does not lose pane, draft or attachments on false/reject, and allows explicit retry', async () => {
    const { container } = await seedProjects(); const pane = container.querySelector('[data-session-id="s3"]');
    const draft = screen.getByRole('textbox', { name: '发送消息' }); fireEvent.change(draft, { target: { value: 'keep me' } });
    fireEvent.click(screen.getByRole('button', { name: '添加附件' })); await screen.findByText('context.txt');
    const cancelled = deferred<boolean>(); vi.mocked(desktop.closeSession).mockReturnValueOnce(cancelled.promise);
    closeTab('会话 3'); await act(async () => cancelled.resolve(false));
    const rejected = deferred<boolean>(); vi.mocked(desktop.closeSession).mockReturnValueOnce(rejected.promise);
    closeTab('会话 3'); await act(async () => rejected.reject(new Error('close refused')));
    expect(screen.getByRole('alert').textContent).toContain('Error: close refused'); selected('会话 3');
    expect(container.querySelector('[data-session-id="s3"]')).toBe(pane); expect(screen.getByRole('textbox', { name: '发送消息' })).toBe(draft);
    expect((draft as HTMLTextAreaElement).value).toBe('keep me'); expect(screen.getByText('context.txt')).toBeTruthy();
    closeTab('会话 3'); await waitFor(() => expect(container.querySelector('[data-session-id="s3"]')).toBeNull()); selected('会话 2');
    expect(desktop.closeSession).toHaveBeenCalledTimes(3);
  });
  it('keeps concurrent closes independent, including repeated clicks and reverse completion', async () => {
    const { container } = await seedProjects(); const first = deferred<boolean>(), duplicate = deferred<boolean>(), second = deferred<boolean>();
    vi.mocked(desktop.closeSession).mockReturnValueOnce(first.promise).mockReturnValueOnce(duplicate.promise).mockReturnValueOnce(second.promise);
    closeTab('会话 3'); closeTab('会话 3'); closeTab('会话 2');
    expect(desktop.closeSession).toHaveBeenCalledTimes(3);
    await act(async () => second.resolve(true)); selected('会话 3');
    await act(async () => duplicate.resolve(true)); selected('会话 1');
    await act(async () => first.resolve(true)); selected('会话 1');
    expect(container.querySelectorAll('[data-session-id]')).toHaveLength(2);
  });
  it('does not let an old close steal selection from a newly completed same-project create', async () => {
    await seedProjects(); const pending = deferred<boolean>(); vi.mocked(desktop.closeSession).mockReturnValueOnce(pending.promise);
    closeTab('会话 3'); await createSession(); selected('会话 5');
    await act(async () => pending.resolve(true)); selected('会话 5');
    selectProject('/two/app'); selectProject('/one/app'); selected('会话 5');
  });
  it('appends and selects creates in completion order through two real dialog submissions', async () => {
    render(<App />); await screen.findByTitle('/one/app'); selectProject('/one/app');
    const first = deferred<Awaited<ReturnType<DesktopAPI['createSession']>>>(), second = deferred<Awaited<ReturnType<DesktopAPI['createSession']>>>();
    vi.mocked(desktop.createSession).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await submitPendingCreate(); fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: false, cancelable: true }));
    await submitPendingCreate(); expect(desktop.createSession).toHaveBeenCalledTimes(2);
    const session = (id: string) => ({ id, title: id, cwd: '/one/app', kind: 'chat' as const, processStatus: 'running' as const, activity: 'idle' as const });
    emit({ id: 'first', type: 'session-info', title: 'too early' });
    await act(async () => second.resolve(session('second'))); selected('second'); expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => first.resolve(session('first'))); selected('first');
    expect(within(screen.getByRole('tablist', { name: '项目会话' })).getAllByRole('tab').map(tab => tab.textContent)).toEqual(['second', 'first']);
    expect(desktop.bootstrap).toHaveBeenCalledTimes(3); expect(desktop.startSession).toHaveBeenCalledTimes(2);
  });
  it('keeps both real drafts/attachments and background events; send completion owns only its submission', async () => {
    const { container, unmount } = render(<App />); await screen.findByTitle('/one/app'); selectProject('/one/app'); await createSession();
    const a = screen.getByRole('textbox', { name: '发送消息' }) as HTMLTextAreaElement;
    fireEvent.change(a, { target: { value: 'A submitted' } });
    fireEvent.click(screen.getByRole('button', { name: '添加附件' })); await screen.findByText('context.txt');
    const send = deferred<void>(); vi.mocked(desktop.sendChatMessage).mockReturnValueOnce(send.promise);
    fireEvent.click(screen.getByRole('button', { name: '发送消息' })); fireEvent.change(a, { target: { value: 'A newer' } });
    selectProject('/two/app'); await createSession();
    const b = screen.getByRole('textbox', { name: '发送消息' }) as HTMLTextAreaElement;
    fireEvent.change(b, { target: { value: 'B newer' } });
    vi.mocked(desktop.chooseChatAttachments).mockResolvedValueOnce([{ id: 'attachment-2', name: 'b.txt', path: '/b.txt', size: 1, kind: 'file' }]);
    fireEvent.click(screen.getByRole('button', { name: '添加附件' })); await screen.findByText('b.txt');
    emit({ id: 's1', type: 'chat-message-start', message: { id: 'background', role: 'assistant', blocks: [{ type: 'text', text: 'only A background' }], timestamp: 1 } });
    emit({ id: 's1', type: 'session-info', title: 'A renamed', activity: 'responding' });
    emit({ id: 'unknown', type: 'session-info', title: 'not a new session' });
    await act(async () => send.resolve()); expect(screen.getByRole('textbox', { name: '发送消息' })).toBe(b); expect(b.value).toBe('B newer');
    expect(screen.getByText('b.txt')).toBeTruthy(); expect(within(container.querySelector('[data-session-id="s2"]') as HTMLElement).queryByText('only A background')).toBeNull();
    selectProject('/one/app'); selected('A renamed'); expect(screen.getByRole('textbox', { name: '发送消息' })).toBe(a); expect(a.value).toBe('A newer');
    expect(screen.queryByText('context.txt')).toBeNull(); expect(screen.getByText('only A background')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'A renamed' }).title).toContain('处理中');
    emit({ id: 's1', type: 'chat-state', state: { activity: 'idle' } }); expect(screen.getByRole('button', { name: 'A renamed' }).title).toContain('就绪');
    emit({ id: 's1', type: 'exit', exitCode: 7 }); expect(screen.getByRole('button', { name: 'A renamed' }).title).toContain('已退出'); expect(a.value).toBe('A newer');
    closeTab('A renamed'); await waitFor(() => expect(container.querySelector('[data-session-id="s1"]')).toBeNull());
    expect(screen.queryByRole('tab')).toBeNull(); selectProject('/two/app'); expect(screen.getByRole('textbox', { name: '发送消息' })).toBe(b); expect(b.value).toBe('B newer'); expect(screen.getByText('b.txt')).toBeTruthy();
    expect(desktop.startSession).toHaveBeenCalledTimes(2); expect(listeners.size).toBe(2); unmount(); expect(listeners.size).toBe(0);
  });
});

describe('Workspace edge ownership with actual App', () => {
  it('preserves the existing no-bridge startup error', async () => {
    Object.defineProperty(window, 'desktop', { configurable: true, writable: true, value: undefined });
    render(<App />);
    expect((await screen.findByRole('alert')).textContent).toContain('请使用 npm run dev 启动桌面应用。');
  });
  it('keeps rename bound to the request session after selection changes', async () => {
    await seedProjects(); const pending = deferred<void>();
    vi.mocked(desktop.renameChatSession).mockReturnValueOnce(pending.promise);
    fireEvent.keyDown(screen.getByRole('tab', { selected: true, name: /会话/ }), { key: 'F2' });
    fireEvent.change(screen.getByRole('textbox', { name: /^重命名 / }), { target: { value: 'late A name' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    // Inline editing permits switching projects while the original request is pending.
    selectProject('/two/app'); await act(async () => pending.resolve()); selected('会话 4');
    expect(desktop.renameChatSession).toHaveBeenCalledWith('s3', 'late A name');
    selectProject('/one/app'); selected('late A name');
  });
  it('unsubscribes on unmount without adding cancellation to a pending host close', async () => {
    const { unmount } = await seedProjects(); const pending = deferred<boolean>();
    vi.mocked(desktop.closeSession).mockReturnValueOnce(pending.promise);
    closeTab('会话 3'); unmount(); expect(listeners.size).toBe(0);
    await act(async () => pending.resolve(true));
    expect(desktop.closeSession).toHaveBeenCalledTimes(1); expect(listeners.size).toBe(0);
  });
});

describe('Session launch through real App and direct sidebar controller', () => {
  it('opens a remembered project and creates a chat directly without a dialog', async () => {
    vi.mocked(desktop.createSession).mockResolvedValue({ id: 'chosen', title: 'Chosen session', cwd: '/one/app', kind: 'chat', processStatus: 'running', activity: 'idle' });
    const { container } = render(<App />); await screen.findByTitle('/one/app');
    const opener = within(screen.getAllByRole('region', { name: 'app' })[0]).getByRole('button', { name: '在 app 中新建对话' }); opener.focus(); fireEvent.click(opener);
    await waitFor(() => expect(desktop.createSession).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/one/app', kind: 'chat', startMode: 'new' })));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(container.querySelector('[data-session-id="chosen"]')).toBeTruthy();
  });
  it('keeps home/project/continue defaults and settings navigation in App', async () => {
    boot = { ...boot, preferences: { ...boot.preferences, recentProjects: [] }, runtime: null };
    render(<App />); await waitFor(() => expect((screen.getAllByRole('button', { name: '打开项目' })[0] as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getAllByRole('button', { name: '打开项目' })[0]);
    expect((screen.getByRole('textbox', { name: '项目文件夹' }) as HTMLInputElement).value).toBe('/home');
    fireEvent.click(screen.getByRole('button', { name: '先配置 Pi' })); expect(screen.getByRole('dialog', { name: '桌面设置' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '取消' })); cleanup();
    boot = { ...boot, preferences: { ...boot.preferences, recentProjects: ['/empty'] } };
    render(<App />); await screen.findByTitle('/empty'); selectProject('/empty');
    fireEvent.click(screen.getByRole('button', { name: '继续最近会话' }));
    expect((screen.getByRole('textbox', { name: '项目文件夹' }) as HTMLInputElement).value).toBe('/empty');
    expect((screen.getByRole('radio', { name: /^继续最近/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '关闭对话框' })); fireEvent.click(screen.getByRole('button', { name: '新建会话' }));
    expect((screen.getByRole('radio', { name: /^新会话/ }) as HTMLInputElement).checked).toBe(true);
    expect(desktop.createSession).not.toHaveBeenCalled();
  });
});
