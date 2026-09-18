/** @vitest-environment jsdom */
import { installDesktopFake } from '../../../desktop-bridge-fake';
import type { DesktopAPI } from '../../../../src/shared/ipc/desktop-api';
let desktop: DesktopAPI;
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bootstrap } from '../../../../src/shared/ipc/desktop-api';
import type { ChatCommand, SessionEvent } from '../../../../src/shared/ipc/conversation';

// Only native terminal/canvas and Desktop bridge are faked. App, ChatPane,
// Virtuoso, Modal and TerminalPane execute their real renderer implementation.
const terminal = vi.hoisted(() => ({ pastes: [] as string[], throwPaste: false, search: vi.fn() }));
vi.mock('@xterm/xterm', () => ({ Terminal: class {
  options = {}; cols = 100; rows = 30; data?: (text: string) => void;
  loadAddon() {} open() {} focus() {} dispose() {} attachCustomKeyEventHandler() {}
  onData(callback: (text: string) => void) { this.data = callback; return { dispose() {} }; }
  onResize() { return { dispose() {} }; }
  paste(text: string) { if (terminal.throwPaste) throw new Error('paste failed'); terminal.pastes.push(text); this.data?.(text); }
  write(_text: string, done?: () => void) { done?.(); }
} }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }));
vi.mock('@xterm/addon-search', () => ({ SearchAddon: class { findNext = terminal.search; findPrevious = terminal.search; clearDecorations() {} } }));
vi.mock('@xterm/addon-image', () => ({ ImageAddon: class {} }));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }));
import { App } from '../../../../src/renderer/app/App';
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
let draftCounter = 0;
async function create(kind: 'chat' | 'terminal' = 'chat') {
  if (kind === 'chat') {
    fireEvent.click(screen.getByRole('button', { name: '新建会话' }));
    const draft = await screen.findByRole('textbox', { name: '发送消息' });
    fireEvent.change(draft, { target: { value: `seed ${++draftCounter}` } });
    await waitFor(() => expect(desktop.inspectProjectResources).toHaveBeenCalled());
    await new Promise(resolve => setTimeout(resolve, 180)); fireEvent.keyDown(draft, { key: 'Enter' });
    await waitFor(() => expect(desktop.createSession).toHaveBeenCalled());
    const id = `s${vi.mocked(desktop.createSession).mock.calls.length}`;
    await waitFor(() => expect(desktop.startSession).toHaveBeenCalledWith(id));
    await flush(); snapshot(id, []); await flush();
    await waitFor(() => expect(desktop.sendChatMessage).toHaveBeenCalledWith(id, expect.objectContaining({ delivery: 'prompt' })));
    vi.mocked(desktop.sendChatMessage).mockClear();
    return;
  }
  fireEvent.click(screen.getByRole('button', { name: '兼容终端' }));
  const button = screen.getByRole('button', { name: '打开兼容终端 ↗' });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false)); fireEvent.click(button); await flush();
}
async function mount(kind: 'chat' | 'terminal' = 'chat') {
  const view = render(<App />); await screen.findByTitle('/one'); selectProject('/one'); await create('chat'); if (kind === 'terminal') await create(kind); return view;
}
beforeEach(() => {
  listeners = new Set(); draftCounter = 0; terminal.pastes = []; terminal.throwPaste = false;
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
    savePreferences: vi.fn(async preferences => ({ ...boot, preferences })),
  } as unknown as DesktopAPI);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('App command palette before/after characterization with real panes', () => {
  it('projects only active RPC commands, dynamic/background snapshots and latest selection into existing drafts', async () => {
    const { container, unmount } = await mount(); snapshot('s1', commandsA);
    const first = screen.getByRole('textbox', { name: '发送消息' }) as HTMLTextAreaElement;
    fireEvent.change(first, { target: { value: 'first draft' } }); await create();
    const second = screen.getByRole('textbox', { name: '发送消息' }) as HTMLTextAreaElement;
    fireEvent.change(second, { target: { value: 'second draft' } }); open();
    expect(items()).toHaveLength(0); expect(within(list()).getByText(/当前 Pi 没有提供/)).toBeTruthy();
    snapshot('s1', [{ name: 'background', source: 'extension' }]); expect(items()).toHaveLength(0);
    snapshot('unknown', commandsA); expect(items()).toHaveLength(0);
    snapshot('s2', [{ name: 'second', source: 'prompt' }]); expect(items().map(item => item.textContent)).toEqual(['/secondprompt/second']);
    // Synthetic tab selection while modal is open characterizes live callbacks, not native modal reachability.
    fireEvent.click(screen.getByRole('button', { name: 'Session 1' })); expect(items().map(item => item.textContent)).toEqual(['/backgroundextension/background']);
    fireEvent.click(items()[0]); expect(first.value).toBe('first draft\n/background'); expect(second.value).toBe('second draft');
    expect(screen.queryByRole('dialog')).toBeNull(); expect(container.querySelectorAll('[data-session-id]')).toHaveLength(2);
    expect(desktop.sendChatMessage).not.toHaveBeenCalled(); expect(desktop.write).not.toHaveBeenCalled();
    expect(desktop.startSession).toHaveBeenCalledTimes(2); expect(listeners.size).toBe(3);
    unmount(); expect(listeners.size).toBe(0);
  });
  it('retains same-array identity without a parent projection update or restarting ChatPane subscriptions', async () => {
    await mount(); const name = vi.fn(() => 'identity');
    const commands: ChatCommand[] = [{ get name() { return name(); }, source: 'extension' }];
    snapshot('s1', commands); open(); const reads = name.mock.calls.length;
    const subscriptions = vi.mocked(desktop.onSessionEvent).mock.calls.length;
    snapshot('s1', commands); snapshot('s1', commands);
    expect(name).toHaveBeenCalledTimes(reads);
    expect(desktop.onSessionEvent).toHaveBeenCalledTimes(subscriptions); expect(desktop.startSession).toHaveBeenCalledTimes(1);
    snapshot('s1', [{ name: 'replacement', source: 'skill' }]); expect(items()[0].textContent).toBe('/replacementskill/replacement');
  });
  it('keeps query on close/cancel/shortcut and inactive projects, clears sidebar open and successful insertion', async () => {
    await mount(); snapshot('s1', commandsA); open(); filter('ALPHA'); close(); shortcut(); expect(query().value).toBe('ALPHA');
    const cancel = new Event('cancel', { cancelable: true }); fireEvent(screen.getByRole('dialog'), cancel); expect(cancel.defaultPrevented).toBe(true);
    shortcut(); expect(query().value).toBe('ALPHA'); shortcut(); expect(screen.queryByRole('dialog')).toBeNull();
    open(); expect(query().value).toBe(''); filter('beta'); selectProject('/empty'); await flush(); expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Session 1' })); open(); expect(query().value).toBe(''); filter('beta'); fireEvent.click(items()[0]); expect(screen.queryByRole('dialog')).toBeNull();
    expect((screen.getByRole('textbox', { name: '发送消息' }) as HTMLTextAreaElement).value).toBe('/beta');
    open(); expect(query().value).toBe(''); close(); fireEvent.click(screen.getByRole('button', { name: 'Session 1' }));
    expect(desktop.sendChatMessage).not.toHaveBeenCalled();
  });
  it('preserves filter fields, distinct zero results, exact DOM and list navigation including index -1/zero', async () => {
    await mount(); const opener = screen.getByRole('button', { name: /搜索与命令/ }); opener.focus(); open(); expect(screen.getByRole('dialog', { name: 'Pi 命令' }).className).toBe('ui-dialog');
    expect(query().classList.contains('ui-input')).toBe(true); expect(query().placeholder).toContain('搜索扩展、提示模板或技能'); expect(document.activeElement).toBe(query());
    snapshot('s1', commandsA); expect(items()).toHaveLength(3);
    filter('FIRST'); expect(items()).toHaveLength(1); filter('/ALPHA'); expect(items()).toHaveLength(1); filter('GAMMA'); expect(items()).toHaveLength(1);
    filter('not found'); expect(items()).toHaveLength(0); expect(within(list()).queryByText(/当前 Pi 没有提供/)).toBeNull();
    const zero = new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }); fireEvent(list(), zero); expect(zero.defaultPrevented).toBe(true);
    filter(''); const buttons = items();
    fireEvent.keyDown(list(), { key: 'ArrowUp' }); expect(document.activeElement).toBe(buttons[1]); // (-1 - 1 + 3) % 3
    fireEvent.keyDown(list(), { key: 'ArrowDown' }); expect(document.activeElement).toBe(buttons[0]);
    fireEvent.keyDown(buttons[0], { key: 'ArrowUp' }); expect(document.activeElement).toBe(buttons[2]);
    fireEvent.keyDown(buttons[2], { key: 'ArrowDown' }); expect(document.activeElement).toBe(buttons[0]);
    fireEvent.keyDown(buttons[0], { key: 'End' }); expect(document.activeElement).toBe(buttons[2]);
    fireEvent.keyDown(buttons[2], { key: 'Home' }); expect(document.activeElement).toBe(buttons[0]);
    const event = shortcut({ key: 'ArrowDown', metaKey: false }, query()); expect(event.defaultPrevented).toBe(false); // input never owned list navigation
    close(); expect(document.activeElement).toBe(opener);
  });
  it.each(['darwin', 'linux', 'win32'])('preserves %s shortcut platform/IME/modifier/capture semantics and live boot platform changes', async platform => {
    boot.platform = platform; await mount();
    const modifier = platform === 'darwin' ? { metaKey: true, ctrlKey: false } : { metaKey: false, ctrlKey: true };
    const draft = screen.getByRole('textbox', { name: '发送消息' });
    for (const extra of [{ isComposing: true }, { keyCode: 229 }, { key: 'p', shiftKey: false }]) {
      expect(shortcut({ ...modifier, ...extra }, draft).defaultPrevented).toBe(false); expect(screen.queryByRole('dialog')).toBeNull();
    }
    expect(shortcut({ metaKey: platform !== 'darwin', ctrlKey: platform === 'darwin' }).defaultPrevented).toBe(false);
    const bubbling = vi.fn(); const local = (event: Event) => { expect(event.defaultPrevented).toBe(true); event.stopPropagation(); };
    draft.addEventListener('keydown', local); window.addEventListener('keydown', bubbling);
    expect(shortcut({ ...modifier, key: 'K', shiftKey: true, altKey: true }, draft).defaultPrevented).toBe(true); expect(query()).toBeTruthy(); expect(bubbling).not.toHaveBeenCalled();
    draft.removeEventListener('keydown', local); window.removeEventListener('keydown', bubbling);
    filter('retained'); expect(shortcut({ ...modifier, key: 'P', shiftKey: true }).defaultPrevented).toBe(true); expect(screen.queryByRole('dialog')).toBeNull();
    shortcut(modifier); expect(query().value).toBe('retained'); close();
    // Save publishes a changed boot projection without remounting App.
    boot = { ...boot, platform: platform === 'darwin' ? 'linux' : 'darwin' };
    fireEvent.click(screen.getByRole('button', { name: '桌面设置' })); fireEvent.click(screen.getByRole('button', { name: '保存设置' })); await flush();
    expect(shortcut(modifier).defaultPrevented).toBe(false);
    shortcut({ metaKey: boot.platform === 'darwin', ctrlKey: boot.platform !== 'darwin' }); expect(query().value).toBe('retained');
  });
  it('inserts each of the nine terminal commands via the real handle without executing; Shift F stays terminal search', async () => {
    await mount('terminal'); open(); expect(screen.getByRole('dialog', { name: '终端命令' })).toBeTruthy();
    expect(screen.getByText('选择后只插入到 Pi TUI，不自动执行。')).toBeTruthy();
    const names = ['model', 'thinking', 'resume', 'tree', 'settings', 'login', 'reload', 'compact', 'hotkeys'];
    expect(items().map(item => item.querySelector('code')?.textContent)).toEqual(names.map(name => `/${name}`));
    expect(items().map(item => item.querySelector('div')?.firstChild?.textContent)).toEqual(['选择模型', '思考强度', '恢复历史', '会话分支', 'Pi 设置', '登录提供商', '重新加载资源', '压缩上下文', '所有快捷键']);
    expect(items().map(item => item.querySelector('small')?.textContent)).toEqual(['使用 Pi 原生模型选择器', '选择推理等级', '打开 Pi 原生会话选择器', '查看会话树', '打开原生设置', '由 Pi 处理凭据', '重新加载扩展和技能', '执行上下文压缩', '以当前 Pi 配置为准']);
    for (const name of names) { filter(name); fireEvent.click(items()[0]); expect(screen.queryByRole('dialog')).toBeNull(); shortcut(); expect(query().value).toBe(''); }
    expect(terminal.pastes).toEqual(names.map(name => `/${name}`)); expect(vi.mocked(desktop.write).mock.calls).toEqual(names.map(name => ['s2', `/${name}`]));
    expect(desktop.sendChatMessage).not.toHaveBeenCalled(); close(); shortcut({ key: 'f', shiftKey: true }); expect(screen.getByRole('textbox', { name: '搜索终端历史' })).toBeTruthy(); expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('retains palette/query when real terminal paste throws; pending attachment keeps original captured target', async () => {
    await mount('terminal'); open(); filter('model'); terminal.throwPaste = true;
    const errors: unknown[] = []; const onError = (event: ErrorEvent) => { errors.push(event.error); event.preventDefault(); }; window.addEventListener('error', onError);
    fireEvent.click(items()[0]); window.removeEventListener('error', onError); expect(errors).toHaveLength(1); expect(query().value).toBe('model'); expect(terminal.pastes).toEqual([]);
    terminal.throwPaste = false; close();
    let resolve!: (paths: string[]) => void; vi.mocked(desktop.chooseAttachments).mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
    fireEvent.click(screen.getByRole('button', { name: '＋ 文件引用' })); selectProject('/empty'); await create();
    open(); filter('keep'); await act(async () => resolve(['/old target.txt']));
    expect(terminal.pastes).toEqual(['@"/old target.txt" ']); expect(screen.queryByRole('dialog')).toBeNull();
    expect((screen.getByRole('textbox', { name: '发送消息' }) as HTMLTextAreaElement).value).toBe(''); shortcut(); expect(query().value).toBe('');
    expect(desktop.sendChatMessage).not.toHaveBeenCalled();
  });
});
