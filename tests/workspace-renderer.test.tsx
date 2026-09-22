/** @vitest-environment jsdom */
import './attachment-menu-contract';
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
  draftSequence = 0;
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
    chooseAttachments: vi.fn().mockResolvedValue([]),
    chooseChatAttachments: vi.fn().mockResolvedValue([{ id: 'attachment-1', name: 'context.txt', path: '/context.txt', size: 7, kind: 'file' }]),
    removeChatAttachment: vi.fn().mockResolvedValue(undefined), sendChatMessage: vi.fn().mockResolvedValue(undefined), stopChat: vi.fn().mockResolvedValue(undefined),
    savePreferences: vi.fn(async (preferences: Preferences) => { boot = { ...boot, preferences }; return boot; }),
    gitStatus: vi.fn().mockResolvedValue({ root: '/one/app', branch: 'main', files: [], capturedAt: '2026-01-01T00:00:00Z' }),
    writeClipboard: vi.fn().mockResolvedValue(undefined), openExternal: vi.fn().mockResolvedValue(undefined),
  } as unknown as DesktopAPI);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView; });

let draftSequence = 0;
async function createSession() {
  const started = vi.mocked(desktop.startSession).mock.calls.length;
  const created = vi.mocked(desktop.createSession).mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: '新建会话' }));
  const draft = await screen.findByRole('textbox', { name: '发送消息' });
  fireEvent.change(draft, { target: { value: `seed ${++draftSequence}` } });
  await waitFor(() => expect(desktop.inspectProjectResources).toHaveBeenCalled());
  await new Promise(resolve => setTimeout(resolve, 180));
  fireEvent.keyDown(draft, { key: 'Enter' });
  await waitFor(() => expect(desktop.createSession).toHaveBeenCalledTimes(created + 1));
  const id = (vi.mocked(desktop.createSession).mock.results.at(-1)?.value as Promise<{ id: string }> | undefined);
  const session = id ? await id : undefined;
  await waitFor(() => expect(desktop.startSession).toHaveBeenCalledTimes(started + 1));
  if (session?.id) emit({ id: session.id, type: 'chat-snapshot', snapshot: { messages: [], commands: [], activity: 'idle', queue: { steering: [], followUp: [] }, statuses: {}, widgets: [] } });
  await waitFor(() => expect(desktop.sendChatMessage).toHaveBeenCalledWith(session?.id, expect.objectContaining({ delivery: 'prompt' })));
  vi.mocked(desktop.sendChatMessage).mockClear();
}
const projectNameForPath = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path;
const projectButton = (path: string) => {
  const name = projectNameForPath(path);
  const nav = screen.getByRole('navigation', { name: '项目' });
  const opener = within(nav).getByRole('button', { name: `在 ${name} 中新建对话（${path}）` });
  return within(opener.closest('section')!).getByRole('button', { name: new RegExp(`^${name}$`) });
};
const findProject = async (path: string) => {
  const name = projectNameForPath(path);
  const nav = screen.getByRole('navigation', { name: '项目' });
  const opener = await within(nav).findByRole('button', { name: `在 ${name} 中新建对话（${path}）` });
  return within(opener.closest('section')!).findByRole('button', { name: new RegExp(`^${name}$`) });
};
const selectProject = (path: string) => fireEvent.click(projectButton(path));
const selectSession = (title: string) => fireEvent.click(screen.getByRole('button', { name: title }));

describe('production workspace navigation', () => {
  it('keeps actual ChatPane draft, attachments and stream subscriptions across sidebar sessions/projects; closes through host', async () => {
    const { container } = render(<App />);
    await findProject('/one/app'); selectProject('/one/app'); await createSession();
    const firstPane = container.querySelector('[data-session-id="s1"]');
    const firstDraft = screen.getByRole('textbox', { name: '发送消息' }); fireEvent.change(firstDraft, { target: { value: 'unfinished first' } });
    fireEvent.click(screen.getByRole('button', { name: '添加附件' })); fireEvent.click(screen.getByRole('menuitem', { name: '添加附件' })); await screen.findByText('context.txt');
    await createSession(); fireEvent.change(screen.getByRole('textbox', { name: '发送消息' }), { target: { value: 'second draft' } });
    selectProject('/two/app'); await createSession();
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
    fireEvent.click(screen.getByRole('button', { name: '归档 会话 1' })); await waitFor(() => expect(desktop.closeSession).toHaveBeenCalledWith('s1'));
    expect(container.querySelector('[data-session-id="s1"]')).toBe(firstPane);
    fireEvent.click(screen.getByRole('button', { name: '归档 会话 1' })); await waitFor(() => expect(container.querySelector('[data-session-id="s1"]')).toBeNull());
    expect((screen.getByRole('textbox', { name: '发送消息' }) as HTMLTextAreaElement).value).toBe('second draft');
    fireEvent.click(screen.getByRole('button', { name: '归档 会话 2' }));
    await waitFor(() => expect(container.querySelector('[data-session-id="s2"]')).toBeNull());
    expect(screen.queryByRole('button', { name: '会话 2' })).toBeNull();
    expect(container.querySelector('[data-session-id="s3"]')).toBeTruthy();
    expect(desktop.sendChatMessage).not.toHaveBeenCalled();
  });
  it('collapses project children without unmounting the active conversation or losing its draft', async () => {
    const { container } = render(<App />);
    await findProject('/one/app'); selectProject('/one/app'); await createSession(); await createSession();
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
  it('removes the sidebar filter while preserving session selection and mounted panes', async () => {
    const { container } = render(<App />);
    await findProject('/one/app'); selectProject('/one/app'); await createSession();
    selectProject('/two/app'); await createSession();
    const pane = container.querySelector('[data-session-id="s2"]');
    const draft = screen.getByRole('textbox', { name: '发送消息' });
    expect(screen.queryByPlaceholderText('查找项目或会话…')).toBeNull();
    expect(screen.getByRole('button', { name: '会话 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '会话 2' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: '发送消息' })).toBe(draft);
    expect(container.querySelector('[data-session-id="s2"]')).toBe(pane);
    expect(screen.getByRole('button', { name: '会话 2' }).getAttribute('aria-current')).toBe('page');
    expect(desktop.startSession).toHaveBeenCalledTimes(2);
  });
  it('orders recent tasks by the latest Pi-accepted activity in the current window', async () => {
    render(<App />); await findProject('/one/app'); selectProject('/one/app'); await createSession(); await createSession();
    emit({ id: 's1', type: 'session-info', lastActivityAt: 100 });
    emit({ id: 's2', type: 'session-info', lastActivityAt: 200 });
    fireEvent.click(screen.getByRole('button', { name: /最近/ }));
    const recent = screen.getByRole('list', { name: '最近任务列表' });
    expect(within(recent).getAllByRole('button').map(button => button.textContent)).toEqual(['会话 2app', '会话 1app']);
    emit({ id: 's1', type: 'session-info', lastActivityAt: 300 });
    expect(within(recent).getAllByRole('button').map(button => button.textContent)).toEqual(['会话 1app', '会话 2app']);
  });
  it('does not consume closed-inspector Escape or editable/IME/local-menu Escape while open', async () => {
    render(<App />); await findProject('/one/app'); selectProject('/one/app'); await createSession();
    emit({ id: 's1', type: 'chat-snapshot', snapshot: { messages: [], commands: [{ name: 'review-real', source: 'extension' }], activity: 'idle', queue: { steering: [], followUp: [] }, statuses: {}, widgets: [] } });
    const draft = screen.getByRole('textbox', { name: '发送消息' }); const toggle = inspectorToggle();
    fireEvent.click(toggle); draft.focus(); fireEvent.keyDown(draft, { key: 'Escape' });
    expect(document.activeElement).toBe(draft); expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle); await openReview();
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
    const closeButton = panelClose(); closeButton.focus(); fireEvent.keyDown(closeButton, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(toggle));
    // Mounted background panes must not let their hidden suggestions block Escape.
    fireEvent.change(draft, { target: { value: '/rev' } }); await createSession();
    if (inspectorToggle().getAttribute('aria-expanded') === 'false') fireEvent.click(inspectorToggle());
    await openReview();
    const currentToggle = inspectorToggle();
    fireEvent.keyDown(panelClose(), { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(currentToggle));
  });
  it('uses default system changes and saved themes without recreating sessions or losing draft', async () => {
    render(<App />); await findProject('/one/app'); selectProject('/one/app'); await createSession();
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
    fireEvent.click(settings); fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); await waitFor(() => expect(document.activeElement).toBe(settings));
  });
  it('keeps composition Enter safe, stops the real runtime and reports rename errors beside the inline editor', async () => {
    render(<App />); await findProject('/one/app'); selectProject('/one/app'); await createSession();
    const draft = screen.getByRole('textbox', { name: '发送消息' }); fireEvent.change(draft, { target: { value: '中文输入' } });
    fireEvent.compositionStart(draft); fireEvent.keyDown(draft, { key: 'Enter' }); fireEvent.compositionEnd(draft);
    fireEvent.keyDown(draft, { key: 'Enter', keyCode: 229 }); expect(desktop.sendChatMessage).not.toHaveBeenCalled();
    emit({ id: 's1', type: 'chat-state', state: { activity: 'responding' } }); fireEvent.click(screen.getByRole('button', { name: '停止运行' }));
    await waitFor(() => expect(desktop.stopChat).toHaveBeenCalledWith('s1'));
    vi.mocked(desktop.renameChatSession).mockRejectedValueOnce(new Error('rename refused'));
    fireEvent.keyDown(screen.getByRole('button', { current: 'page', name: /会话/ }), { key: 'F2' }); fireEvent.change(screen.getByRole('textbox', { name: /^重命名 / }), { target: { value: 'New name' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect((await screen.findByRole('alert')).textContent).toContain('rename refused');
  });
  it('routes only Pi-provided commands into draft, and closes the narrow inspector with focus return', async () => {
    render(<App />); await findProject('/one/app'); selectProject('/one/app'); await createSession();
    emit({ id: 's1', type: 'chat-snapshot', snapshot: { messages: [], commands: [{ name: 'review-real', source: 'extension', description: 'Real extension' }], activity: 'idle', queue: { steering: [], followUp: [] }, statuses: {}, widgets: [] } });
    const commands = screen.getByRole('button', { name: /搜索与命令/ }); commands.focus(); fireEvent.click(commands);
    fireEvent.click(screen.getByRole('option', { name: /review-real/ })); expect((screen.getByRole('textbox', { name: '发送消息' }) as HTMLTextAreaElement).value).toBe('/review-real'); expect(desktop.sendChatMessage).not.toHaveBeenCalled();
    const toggle = inspectorToggle();
    await openReview(); expect(desktop.gitStatus).toHaveBeenCalledWith('s1');
    fireEvent.click(panelClose()); expect(screen.queryByRole('complementary', { name: '文件与 Git 检查区' })).toBeNull();
    const currentToggle = inspectorToggle();
    fireEvent.click(currentToggle);
    // The inserted command has suggestions: dismiss that local menu before the inspector.
    fireEvent.keyDown(screen.getByRole('textbox', { name: '发送消息' }), { key: 'Escape' });
    expect(currentToggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(currentToggle, { key: 'Escape' }); expect(document.activeElement).toBe(currentToggle); expect(currentToggle.getAttribute('aria-expanded')).toBe('false');
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const selected = (title: string) => expect(screen.getByRole('button', { name: title }).getAttribute('aria-current')).toBe('page');
const closeTab = (title: string) => fireEvent.click(screen.getByRole('button', { name: `归档 ${title}` }));
const inspectorToggle = () => screen.getAllByRole('button', { name: /(?:显示|收起)右侧面板/ })[0]!;
async function seedProjects() {
  const view = render(<App />); await findProject('/one/app'); selectProject('/one/app');
  await createSession(); await createSession(); await createSession();
  selectProject('/two/app'); await createSession(); selectProject('/one/app'); selectSession('会话 3');
  return view;
}
async function submitPendingCreate() {
  fireEvent.click(screen.getByRole('button', { name: '新建会话' }));
  const draft = await screen.findByRole('textbox', { name: '发送消息' });
  fireEvent.change(draft, { target: { value: `pending ${++draftSequence}` } });
  await new Promise(resolve => setTimeout(resolve, 180)); fireEvent.keyDown(draft, { key: 'Enter' });
}

describe('Workspace real App with in-memory Desktop deferred completions (not Electron/Pi)', () => {
  it.each(['other', 'remembered', 'empty'] as const)('repairs close using latest selection: %s', async scenario => {
    const { container, unmount } = await seedProjects(); const pending = deferred<boolean>();
    vi.mocked(desktop.closeSession).mockReturnValueOnce(pending.promise);
    closeTab('会话 3'); expect(container.querySelector('[data-session-id="s3"]')).toBeTruthy();
    if (scenario === 'remembered') fireEvent.click(screen.getByRole('button', { name: '会话 1' }));
    if (scenario === 'empty') selectProject('/empty'); else { selectProject('/two/app'); selectSession('会话 4'); }
    await act(async () => pending.resolve(true));
    expect(container.querySelector('[data-session-id="s3"]')).toBeNull();
    if (scenario === 'empty') { expect(screen.queryByRole('tab')).toBeNull(); expect(projectButton('/empty').getAttribute('aria-current')).toBe('page'); }
    else selected('会话 4');
    selectProject('/one/app'); selectSession(scenario === 'remembered' ? '会话 1' : '会话 2'); selected(scenario === 'remembered' ? '会话 1' : '会话 2');
    expect(desktop.startSession).toHaveBeenCalledTimes(4); expect(listeners.size).toBe(4);
    unmount(); expect(listeners.size).toBe(0);
  });
  it('does not lose pane, draft or attachments on false/reject, and allows explicit retry', async () => {
    const { container } = await seedProjects(); const pane = container.querySelector('[data-session-id="s3"]');
    const draft = screen.getByRole('textbox', { name: '发送消息' }); fireEvent.change(draft, { target: { value: 'keep me' } });
    fireEvent.click(screen.getByRole('button', { name: '添加附件' })); fireEvent.click(screen.getByRole('menuitem', { name: '添加附件' })); await screen.findByText('context.txt');
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
    selectProject('/two/app'); selectProject('/one/app'); selectSession('会话 5'); selected('会话 5');
  });
  it('creates and selects a chat after a project draft is submitted', async () => {
    render(<App />); await findProject('/one/app'); selectProject('/one/app');
    const first = deferred<Awaited<ReturnType<DesktopAPI['createSession']>>>();
    vi.mocked(desktop.createSession).mockReturnValueOnce(first.promise);
    await submitPendingCreate(); expect(desktop.createSession).toHaveBeenCalledTimes(1);
    const session = (id: string) => ({ id, title: id, cwd: '/one/app', kind: 'chat' as const, processStatus: 'running' as const, activity: 'idle' as const });
    emit({ id: 'first', type: 'session-info', title: 'too early' });
    await act(async () => first.resolve(session('first'))); selected('first');
    expect(within(screen.getByRole('list', { name: 'app 的会话' })).getAllByRole('button').map(button => button.textContent)).toContain('first');
    expect(desktop.startSession).toHaveBeenCalledTimes(1);
  });
  it('keeps both real drafts/attachments and background events; send completion owns only its submission', async () => {
    const { container, unmount } = render(<App />); await findProject('/one/app'); selectProject('/one/app'); await createSession();
    const a = screen.getByRole('textbox', { name: '发送消息' }) as HTMLTextAreaElement;
    fireEvent.change(a, { target: { value: 'A submitted' } });
    fireEvent.click(screen.getByRole('button', { name: '添加附件' })); fireEvent.click(screen.getByRole('menuitem', { name: '添加附件' })); await screen.findByText('context.txt');
    const send = deferred<void>(); vi.mocked(desktop.sendChatMessage).mockReturnValueOnce(send.promise);
    fireEvent.click(screen.getByRole('button', { name: '发送消息' })); fireEvent.change(a, { target: { value: 'A newer' } });
    selectProject('/two/app'); await createSession();
    const b = screen.getByRole('textbox', { name: '发送消息' }) as HTMLTextAreaElement;
    fireEvent.change(b, { target: { value: 'B newer' } });
    vi.mocked(desktop.chooseChatAttachments).mockResolvedValueOnce([{ id: 'attachment-2', name: 'b.txt', path: '/b.txt', size: 1, kind: 'file' }]);
    fireEvent.click(screen.getByRole('button', { name: '添加附件' })); fireEvent.click(screen.getByRole('menuitem', { name: '添加附件' })); await screen.findByText('b.txt');
    emit({ id: 's1', type: 'chat-message-start', message: { id: 'background', role: 'assistant', blocks: [{ type: 'text', text: 'only A background' }], timestamp: 1 } });
    emit({ id: 's1', type: 'session-info', title: 'A renamed', activity: 'responding' });
    emit({ id: 'unknown', type: 'session-info', title: 'not a new session' });
    await act(async () => send.resolve()); expect(screen.getByRole('textbox', { name: '发送消息' })).toBe(b); expect(b.value).toBe('B newer');
    expect(screen.getByText('b.txt')).toBeTruthy(); expect(within(container.querySelector('[data-session-id="s2"]') as HTMLElement).queryByText('only A background')).toBeNull();
    selectProject('/one/app'); selectSession('A renamed'); selected('A renamed'); expect(screen.getByRole('textbox', { name: '发送消息' })).toBe(a); expect(a.value).toBe('A newer');
    expect(screen.queryByText('context.txt')).toBeNull(); expect(screen.getByText('only A background')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'A renamed' }).title).toContain('处理中');
    emit({ id: 's1', type: 'chat-state', state: { activity: 'idle' } }); expect(screen.getByRole('button', { name: 'A renamed' }).title).toContain('就绪');
    emit({ id: 's1', type: 'exit', exitCode: 7 }); expect(screen.getByRole('button', { name: 'A renamed' }).title).toContain('已退出'); expect(a.value).toBe('A newer');
    closeTab('A renamed'); await waitFor(() => expect(container.querySelector('[data-session-id="s1"]')).toBeNull());
    expect(screen.queryByRole('tab')).toBeNull(); selectProject('/two/app'); selectSession('会话 2'); expect(screen.getByRole('textbox', { name: '发送消息' })).toBe(b); expect(b.value).toBe('B newer'); expect(screen.getByText('b.txt')).toBeTruthy();
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
    fireEvent.keyDown(screen.getByRole('button', { current: 'page', name: /会话/ }), { key: 'F2' });
    fireEvent.change(screen.getByRole('textbox', { name: /^重命名 / }), { target: { value: 'late A name' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    // Inline editing permits switching projects while the original request is pending.
    selectProject('/two/app'); selectSession('会话 4'); await act(async () => pending.resolve()); selected('会话 4');
    expect(desktop.renameChatSession).toHaveBeenCalledWith('s3', 'late A name');
    selectProject('/one/app'); selectSession('late A name'); selected('late A name');
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
  it('opens a project draft without creating history until the first message', async () => {
    render(<App />); await findProject('/one/app');
    fireEvent.click(projectButton('/one/app'));
    fireEvent.click(projectButton('/one/app'));
    expect(desktop.createSession).not.toHaveBeenCalled();
    const draft = await screen.findByRole('textbox', { name: '发送消息' });
    fireEvent.change(draft, { target: { value: 'first real task' } });
    await new Promise(resolve => setTimeout(resolve, 180));
    fireEvent.keyDown(draft, { key: 'Enter' });
    await waitFor(() => expect(desktop.createSession).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/one/app', kind: 'chat', startMode: 'new' })));
    expect(desktop.createSession).toHaveBeenCalledTimes(1);
  });
  it('keeps staged project attachments when switching between unsent project drafts', async () => {
    render(<App />); await findProject('/one/app'); selectProject('/one/app');
    vi.mocked(desktop.chooseAttachments).mockResolvedValue(['/context.txt']);
    fireEvent.click(screen.getByRole('button', { name: '添加附件' })); fireEvent.click(screen.getByRole('menuitem', { name: '添加附件' })); await screen.findByText('context.txt');
    selectProject('/two/app'); expect(screen.queryByText('context.txt')).toBeNull();
    selectProject('/one/app'); expect(screen.getByText('context.txt')).toBeTruthy();
    expect(desktop.createSession).not.toHaveBeenCalled();
  });
  it('opens a remembered project and creates a chat directly without a dialog', async () => {
    vi.mocked(desktop.createSession).mockResolvedValue({ id: 'chosen', title: 'Chosen session', cwd: '/one/app', kind: 'chat', processStatus: 'running', activity: 'idle' });
    const { container } = render(<App />); await findProject('/one/app');
    const opener = within(screen.getAllByRole('region', { name: 'app' })[0]).getByRole('button', { name: '在 app 中新建对话（/one/app）' }); opener.focus(); fireEvent.click(opener);
    const draft = await screen.findByRole('textbox', { name: '发送消息' }); fireEvent.change(draft, { target: { value: 'start work' } });
    await new Promise(resolve => setTimeout(resolve, 180)); fireEvent.keyDown(draft, { key: 'Enter' });
    await waitFor(() => expect(desktop.createSession).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/one/app', kind: 'chat', startMode: 'new' })));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(container.querySelector('[data-session-id="chosen"]')).toBeTruthy();
  });
  it('keeps the Pi-compatible terminal reachable from a project without creating a chat first', async () => {
    render(<App />); await findProject('/one/app');
    fireEvent.click(screen.getByRole('button', { name: 'app 更多操作（/one/app）' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '打开兼容终端' }));
    const dialog = screen.getByRole('dialog', { name: '打开项目' });
    const terminal = within(dialog).getByRole('radio', { name: /兼容终端/ }) as HTMLInputElement;
    expect(terminal.checked).toBe(true); expect(terminal.disabled).toBe(true);
    expect(within(dialog).queryByRole('radio', { name: /原生对话/ })).toBeNull();
    expect((within(dialog).getByRole('textbox', { name: '项目文件夹' }) as HTMLInputElement).value).toBe('/one/app');
    expect(desktop.createSession).not.toHaveBeenCalled();
  });
  it('keeps project drafts usable while Pi is unconfigured and routes to settings', async () => {
    boot = { ...boot, preferences: { ...boot.preferences, recentProjects: [] }, runtime: null };
    boot = { ...boot, preferences: { ...boot.preferences, recentProjects: ['/empty'] } };
    render(<App />); await findProject('/empty'); selectProject('/empty');
    expect(screen.getByRole('textbox', { name: '发送消息' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('尚未配置 Pi');
    fireEvent.click(screen.getByRole('button', { name: '打开设置' }));
    expect(screen.getByRole('dialog', { name: '桌面设置' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(desktop.createSession).not.toHaveBeenCalled();
  });
});
const panelClose = () => within(screen.getByRole('complementary', { name: '右侧面板' })).getByRole('button', { name: '收起右侧面板' });
async function openReview() {
  if (!screen.queryByRole('tab', { name: 'Review', hidden: true })) fireEvent.click(await screen.findByRole('button', { name: 'Review' }));
  await screen.findByText('这个范围没有变更');
}
