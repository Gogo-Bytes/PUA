/** @vitest-environment jsdom */
import { installDesktopFake } from './desktop-bridge-fake';
import type { DesktopAPI } from '../src/shared/ipc/desktop-api';
let desktop: DesktopAPI;
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bootstrap } from '../src/shared/ipc/desktop-api';
import type { ChatCommand, SessionEvent } from '../src/shared/ipc/conversation';

// Only native terminal/canvas and Desktop bridge are faked. App, ChatPane,
// Virtuoso, Modal and TerminalPane execute their real renderer implementation.
const terminal = vi.hoisted(() => ({ pastes: [] as string[], throwPaste: false, search: vi.fn(), instances: [] as { disposed: boolean; pastes: string[]; focus: ReturnType<typeof vi.fn> }[], trace: [] as string[] }));
vi.mock('@xterm/xterm', () => ({ Terminal: class {
  options = {}; cols = 100; rows = 30; disposed = false; pastes: string[] = []; focus = vi.fn(() => terminal.trace.push("focus")); constructor() { terminal.instances.push(this); } data?: (text: string) => void;
  loadAddon() {} open() {} dispose() { this.disposed = true; } attachCustomKeyEventHandler() {}
  onData(callback: (text: string) => void) { this.data = callback; return { dispose() {} }; }
  onResize() { return { dispose() {} }; }
  paste(text: string) { if (terminal.throwPaste) throw new Error('paste failed'); this.pastes.push(text); terminal.pastes.push(text); this.data?.(text); }
  write(_text: string, done?: () => void) { done?.(); }
} }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }));
vi.mock('@xterm/addon-search', () => ({ SearchAddon: class { findNext = terminal.search; findPrevious = terminal.search; clearDecorations() { terminal.trace.push("clear"); } } }));
vi.mock('@xterm/addon-image', () => ({ ImageAddon: class {} }));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }));
import { App } from '../src/renderer/app/App';
let boot: Bootstrap, listeners: Set<(event: SessionEvent) => void>;
const flush = async () => { await act(async () => {}); };
const emit = (event: SessionEvent) => act(() => listeners.forEach(listener => listener(event)));
const snapshot = (id: string, commands: ChatCommand[]) => emit({ id, type: 'chat-snapshot', snapshot: { commands, messages: [], activity: 'idle', queue: { steering: [], followUp: [] }, statuses: {}, widgets: [] } });
const commandsA: ChatCommand[] = [{ name: 'Alpha', description: 'FIRST description', source: 'extension' }, { name: 'beta', source: 'prompt' }, { name: 'skill:gamma', source: 'skill' }];
const query = () => screen.getByRole('textbox', { name: '搜索命令' }) as HTMLInputElement;
const filter = (value: string) => fireEvent.change(query(), { target: { value } });
const list = () => screen.getByRole('dialog').querySelector('.command-list') as HTMLElement;
const items = () => within(list()).queryAllByRole('button');
const open = () => fireEvent.click(screen.getByRole('button', { name: /搜索与命令/ }));
const close = () => fireEvent.click(screen.getByRole('button', { name: '关闭对话框' }));
const selectProject = (path: string) => fireEvent.click(within(screen.getByRole('navigation', { name: '项目' })).getByTitle(path));
const shortcut = (init: KeyboardEventInit = {}, target: EventTarget = window) => {
  const event = new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true, ...init });
  act(() => target.dispatchEvent(event)); return event;
};
async function create(kind: 'chat' | 'terminal' = 'chat') {
  fireEvent.click(screen.getByRole('button', { name: '新建会话' }));
  if (kind === 'terminal') fireEvent.click(screen.getByRole('radio', { name: /^兼容终端/ }));
  const button = screen.getByRole('button', { name: kind === 'chat' ? '开始对话 ↗' : '打开兼容终端 ↗' });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false)); fireEvent.click(button); await flush();
}
async function mount(kind: 'chat' | 'terminal' = 'chat') {
  const view = render(<App />); await screen.findByTitle('/one'); selectProject('/one'); await create(kind); return view;
}
beforeEach(() => {
  listeners = new Set(); terminal.pastes = []; terminal.throwPaste = false; terminal.instances = []; terminal.trace = []; terminal.search.mockReset();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 });
  window.matchMedia = vi.fn(query => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  boot = { preferences: { piPath: '/pi', nodePath: '', args: [], fontSize: 14, recentProjects: ['/one', '/empty'] }, runtime: { executable: '/pi', args: [], source: '/pi' }, home: '/home', platform: 'darwin' };
  let count = 0;
  desktop = installDesktopFake({
    bootstrap: vi.fn(async () => boot), onSessionEvent: vi.fn(callback => { listeners.add(callback); return () => listeners.delete(callback); }),
    inspectProjectResources: vi.fn().mockResolvedValue({ hasResources: false, paths: [] }),
    createSession: vi.fn(async options => ({ id: `s${++count}`, title: `Session ${count}`, cwd: options.cwd, kind: options.kind, processStatus: 'running', activity: 'idle' })),
    startSession: vi.fn().mockResolvedValue(undefined), closeSession: vi.fn().mockResolvedValue(true),
    sendChatMessage: vi.fn().mockResolvedValue(undefined), write: vi.fn(), resize: vi.fn(), acknowledge: vi.fn(), chooseAttachments: vi.fn().mockResolvedValue([]),
    renameChatSession: vi.fn().mockResolvedValue(undefined), openProject: vi.fn().mockResolvedValue(undefined),
    gitStatus: vi.fn().mockResolvedValue({ root: '/one', branch: 'main', capturedAt: 'now', files: [{ path: 'a.ts', index: 'M', worktree: 'M' }] }),
    fileDiff: vi.fn().mockResolvedValue({ kind: 'diff', truncated: false, text: '@@ -1 +1 @@\n-old\n+new' }),
    chooseChatAttachments: vi.fn().mockResolvedValue([]), removeChatAttachment: vi.fn().mockResolvedValue(undefined),
    savePreferences: vi.fn(async preferences => ({ ...boot, preferences })),
  } as unknown as DesktopAPI);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

describe('App composition before/after: real owners and panes, only in-memory host/native terminal Fakes', () => {
  it('registers capture before inspector bubble; only platform/kind changes rebind capture and all listeners clean up', async () => {
    const trace: string[] = [];
    const add = window.addEventListener.bind(window), remove = window.removeEventListener.bind(window);
    const captures = new Set<EventListenerOrEventListenerObject>();
    vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => { if (type === 'keydown') { trace.push(`add:${options === true ? 'capture' : 'bubble'}`); if (options === true) captures.add(listener); } add(type, listener, options); });
    vi.spyOn(window, 'removeEventListener').mockImplementation((type, listener, options) => { if (type === 'keydown' && options === true) { trace.push('remove:capture'); captures.delete(listener); } remove(type, listener, options); });
    const view = await mount(); const initial = trace.filter(x => x.endsWith('capture')).length;
    const draft = screen.getByRole('textbox', { name: '发送消息' }); fireEvent.change(draft, { target: { value: 'draft' } });
    open(); filter('query'); close(); fireEvent.click(screen.getByRole('button', { name: '重命名' })); close();
    await create(); fireEvent.click(screen.getByRole('tab', { name: 'Session 1' }));
    fireEvent.click(screen.getByRole('button', { name: '桌面设置' })); fireEvent.click(screen.getByRole('button', { name: '保存设置' })); await flush();
    expect(trace.filter(x => x.endsWith('capture'))).toHaveLength(initial);
    fireEvent.click(screen.getByRole('button', { name: '显示或收起检查区' })); await screen.findByRole('button', { name: 'a.ts M' });
    expect(trace.lastIndexOf('add:bubble')).toBeGreaterThan(trace.lastIndexOf('add:capture'));
    await create('terminal'); expect(trace.filter(x => x.endsWith('capture'))).toHaveLength(initial + 2);
    boot = { ...boot, platform: 'linux' }; fireEvent.click(screen.getByRole('button', { name: '桌面设置' })); fireEvent.click(screen.getByRole('button', { name: '保存设置' })); await flush();
    expect(trace.filter(x => x.endsWith('capture'))).toHaveLength(initial + 4); expect(captures.size).toBe(1);
    view.unmount(); expect(captures.size).toBe(0); expect(listeners.size).toBe(0);
  });
  it('publishes overlapping create refreshes in completion order without waiting, and old create closes a reopened launch', async () => {
    await mount(); const old = deferred<Awaited<ReturnType<DesktopAPI['createSession']>>>();
    vi.mocked(desktop.createSession).mockReturnValueOnce(old.promise); await create(); close();
    const first = deferred<Bootstrap>(), second = deferred<Bootstrap>(); vi.mocked(desktop.bootstrap).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await create(); expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.getByRole('tab', { name: 'Session 2' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '新建会话' }));
    await act(async () => old.resolve({ id: 'old', title: 'Old', cwd: '/one', kind: 'chat', processStatus: 'running', activity: 'idle' }));
    expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.getByRole('tab', { name: 'Old' }).getAttribute('aria-selected')).toBe('true');
    await act(async () => second.resolve({ ...boot, preferences: { ...boot.preferences, theme: 'dark', recentProjects: ['/second'] } })); expect(document.documentElement.dataset.theme).toBe('dark');
    await act(async () => first.resolve({ ...boot, preferences: { ...boot.preferences, theme: 'light', recentProjects: ['/first'] } })); expect(document.documentElement.dataset.theme).toBe('light'); expect(screen.getByTitle('/first')).toBeTruthy();
  });
  it('rename captures submission rather than opening identity, and terminal rename never calls the host', async () => {
    await mount(); await create(); fireEvent.click(screen.getByRole('button', { name: '重命名' }));
    fireEvent.change(screen.getByRole('textbox', { name: '会话显示名' }), { target: { value: 'Submitted' } }); fireEvent.click(screen.getByRole('tab', { name: 'Session 1' }));
    fireEvent.click(screen.getByRole('button', { name: '保存名称' })); await flush(); expect(desktop.renameChatSession).toHaveBeenCalledExactlyOnceWith('s1', 'Submitted');
    expect(screen.getByRole('tab', { name: 'Session 2' })).toBeTruthy(); await create('terminal'); fireEvent.click(screen.getByRole('button', { name: '重命名' }));
    fireEvent.change(screen.getByRole('textbox', { name: '会话显示名' }), { target: { value: 'Terminal local' } }); fireEvent.click(screen.getByRole('button', { name: '保存名称' })); await flush();
    expect(screen.getByRole('tab', { name: 'Terminal local' })).toBeTruthy(); expect(desktop.renameChatSession).toHaveBeenCalledTimes(1);
  });
  it('late attachment queries the old ID in the live registry, never a disposed handle or newest active terminal', async () => {
    await mount('terminal'); const pending = deferred<string[]>(); vi.mocked(desktop.chooseAttachments).mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole('button', { name: '＋ 文件引用' })); await create('terminal');
    fireEvent.click(screen.getByRole('button', { name: '关闭 Session 1' })); await flush(); expect(terminal.instances[0].disposed).toBe(true);
    open(); filter('model'); await act(async () => pending.resolve(['/old.txt']));
    expect(terminal.instances.map(instance => instance.pastes)).toEqual([[], []]); expect(screen.queryByRole('dialog')).toBeNull(); shortcut(); expect(query().value).toBe(''); expect(desktop.write).not.toHaveBeenCalled();
  });
  it('search hide retains text/found; close fallback leaves it open; close button clears then hides then focuses', async () => {
    await mount('terminal'); fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    const search = () => screen.getByRole('textbox', { name: '搜索终端历史' }) as HTMLInputElement;
    fireEvent.change(search(), { target: { value: 'needle' } }); terminal.search.mockReturnValue(false); fireEvent.submit(search().closest('form')!); expect(screen.getByText('未找到')).toBeTruthy();
    await create('terminal'); expect(screen.queryByRole('textbox', { name: '搜索终端历史' })).toBeNull(); fireEvent.click(screen.getByRole('button', { name: '搜索' })); expect(search().value).toBe('needle'); expect(screen.getByText('未找到')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '关闭 Session 2' })); await flush(); expect(search().value).toBe('needle'); expect(screen.getByText('未找到')).toBeTruthy();
    terminal.trace = []; fireEvent.click(within(search().closest('form')!).getByRole('button', { name: '×' })); expect(terminal.trace).toEqual(['clear', 'focus']); expect(screen.queryByRole('textbox', { name: '搜索终端历史' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '搜索' })); expect(search().value).toBe('needle'); fireEvent.change(search(), { target: { value: 'edited' } }); expect(screen.queryByText('未找到')).toBeNull(); expect(desktop.startSession).toHaveBeenCalledTimes(2);
  });
  it.each(['chat', 'terminal'] as const)('Git %s reference preserves palette split, newline and narrow textarea focus without toggle focus', async kind => {
    await mount(kind); const draft = kind === 'chat' ? screen.getByRole('textbox', { name: '发送消息' }) as HTMLTextAreaElement : undefined;
    if (draft) fireEvent.change(draft, { target: { value: 'existing' } });
    const toggle = screen.getByRole('button', { name: '显示或收起检查区' }); fireEvent.click(toggle); fireEvent.click(await screen.findByRole('button', { name: 'a.ts M' })); await screen.findByRole('button', { name: '引用文件到草稿' });
    open(); filter('model'); const focus = vi.spyOn(toggle, 'focus'); fireEvent.click(screen.getByRole('button', { name: '引用文件到草稿' }));
    expect(toggle.getAttribute('aria-expanded')).toBe('false'); expect(focus).not.toHaveBeenCalled();
    const text = '请检查这个文件的变更：@"/one/a.ts" ';
    if (draft) { expect(draft.value).toBe(`existing\n${text}`); expect(document.activeElement).toBe(draft); expect(query().value).toBe('model'); }
    else { expect(terminal.pastes).toEqual([text]); expect(screen.queryByRole('dialog')).toBeNull(); }
    expect(desktop.sendChatMessage).not.toHaveBeenCalled();
  });
  it('real Chat draft revision survives edit-and-revert; only submitted attachments are consumed across background callbacks', async () => {
    await mount(); const draft = screen.getByRole('textbox', { name: '发送消息' }) as HTMLTextAreaElement;
    fireEvent.change(draft, { target: { value: 'same' } }); const pending = deferred<void>(); vi.mocked(desktop.sendChatMessage).mockReturnValueOnce(pending.promise);
    vi.mocked(desktop.chooseChatAttachments).mockResolvedValueOnce([{ id: 'a', name: 'old.txt', path: '/old', size: 1, kind: 'file' }]).mockResolvedValueOnce([{ id: 'b', name: 'new.txt', path: '/new', size: 1, kind: 'file' }]);
    fireEvent.click(screen.getByRole('button', { name: '添加附件' })); await screen.findByText('old.txt'); fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    fireEvent.change(draft, { target: { value: 'different' } }); fireEvent.change(draft, { target: { value: 'same' } }); fireEvent.click(screen.getByRole('button', { name: '添加附件' })); await screen.findByText('new.txt');
    await create(); emit({ id: 's2', type: 'chat-editor-text', text: 'background identity' }); await act(async () => pending.resolve());
    expect(draft.value).toBe('same'); expect(screen.queryByText('old.txt')).toBeNull(); expect(screen.getByText('new.txt')).toBeTruthy(); expect((screen.getByRole('textbox', { name: '发送消息' }) as HTMLTextAreaElement).value).toBe('background identity');
  });
});

describe('App original synchronous throw versus rejection and dynamic client lookup', () => {
  it.each(['throw', 'reject'] as const)('create refresh %s retains add/close but only rejection reports the global error', async failure => {
    await mount(); vi.mocked(desktop.bootstrap).mockImplementationOnce(() => { if (failure === 'throw') throw new Error('refresh failure'); return Promise.reject(new Error('refresh failure')); });
    await create(); expect(screen.getByRole('tab', { name: 'Session 2' }).getAttribute('aria-selected')).toBe('true'); expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Error: refresh failure') !== null).toBe(failure === 'reject');
    // Sync throw rejects create into the old form's catch, already unmounted; no global report.
  });
  it('binds later requests to the current bridge without resubscribing the original workspace', async () => {
    await mount(); const replacement = { ...desktop, openProject: vi.fn().mockResolvedValue(undefined) };
    installDesktopFake(replacement); fireEvent.click(screen.getByRole('button', { name: '打开目录' })); await flush();
    expect(replacement.openProject).toHaveBeenCalledExactlyOnceWith('s1'); expect(desktop.openProject).not.toHaveBeenCalled();
    vi.mocked(replacement.openProject).mockRejectedValueOnce(new Error('directory rejected')); fireEvent.click(screen.getByRole('button', { name: '打开目录' })); await screen.findByText('Error: directory rejected');
    fireEvent.click(screen.getByRole('button', { name: '关闭错误提示' })); vi.mocked(replacement.openProject).mockImplementationOnce(() => { throw new Error('directory threw'); });
    const errors: unknown[] = []; const onError = (event: ErrorEvent) => { errors.push(event.error); event.preventDefault(); }; window.addEventListener('error', onError);
    fireEvent.click(screen.getByRole('button', { name: '打开目录' })); window.removeEventListener('error', onError);
    expect(errors).toHaveLength(1); expect(screen.queryByRole('alert')).toBeNull(); expect(listeners.size).toBe(2);
  });
});
