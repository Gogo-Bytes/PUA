/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { VirtuosoMockContext } from 'react-virtuoso';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../src/renderer/App';
import { desktopIPCFake } from './desktop-ipc-fake';
import { deferred, sessionInfo, snapshot, success } from './app/main/main-fakes';
import { DesktopApplicationError } from '../src/platform/electron/ipc/desktop-errors';

// Real App/ChatPane/Virtuoso/client/registrar/preload; only native xterm import is inert.
vi.mock('@xterm/xterm', () => ({ Terminal: vi.fn() }));
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 });
  window.matchMedia = vi.fn(query => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(() => { cleanup(); delete window.desktop; vi.restoreAllMocks(); });
async function create() {
  fireEvent.click(screen.getByRole('button', { name: '新建会话' }));
  const submit = await screen.findByRole('button', { name: '开始对话 ↗' });
  await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(submit); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}

it('real registrar -> source preload -> client -> App/ChatPane retains submitted identity, background panes and visible failures', async () => {
  const h = desktopIPCFake(); window.desktop = h.bridge;
  let count = 0;
  h.capabilities.createSession.mockImplementation(async (_runtime, options) => ({ ...sessionInfo, id: `s${++count}`, title: `会话 ${count}`, cwd: options.cwd }));
  h.capabilities.session.get.mockImplementation(id => ({ ...snapshot, id }));
  h.capabilities.session.start.mockImplementation(id => {
    // Snapshot must be received during synchronous start, before its invoke resolves.
    h.emit({ type: 'session-info', id, processStatus: 'running' });
    h.emit({ type: 'chat-snapshot', id, snapshot: { activity: 'idle', queue: { steering: [], followUp: [] }, statuses: {}, widgets: [], commands: [], messages: Array.from({ length: 100 }, (_, i) => ({ id: `${id}-m${i}`, role: 'assistant', timestamp: i, blocks: [{ type: 'text', text: `${id} reply ${i}` }] })) } });
    return success;
  });
  h.capabilities.registerChatAttachments.mockResolvedValue([{ id: 'token', name: 'submitted.txt', path: '/fake/submitted.txt', kind: 'file', size: 2 }]);
  const view = render(<VirtuosoMockContext.Provider value={{ viewportHeight: 400, itemHeight: 80 }}><App /></VirtuosoMockContext.Provider>);
  await screen.findByTitle('/old'); await create();
  const firstPane = view.container.querySelector('[data-session-id="s1"]');
  const draft = screen.getByRole('textbox', { name: '发送消息' }) as HTMLTextAreaElement;
  fireEvent.change(draft, { target: { value: 'submitted draft' } });
  fireEvent.click(screen.getByRole('button', { name: '添加附件' })); await screen.findByText('submitted.txt');
  const pending = deferred<void>(); h.capabilities.conversation.send.mockReturnValueOnce(pending.promise);
  fireEvent.keyDown(draft, { key: 'Enter' });
  await waitFor(() => expect(h.capabilities.conversation.send).toHaveBeenCalledWith('s1', { text: 'submitted draft', attachmentIds: ['token'], delivery: 'prompt' }));
  await create(); fireEvent.change(screen.getByRole('textbox', { name: '发送消息' }), { target: { value: 'second draft' } });
  expect(h.listeners.size).toBe(3); expect(view.container.querySelector('[data-session-id="s1"]')).toBe(firstPane);
  await act(async () => pending.reject(new DesktopApplicationError('SEND_PENDING', '发送未确认')));
  expect(await screen.findByText('Error: 发送未确认')).toBeTruthy();
  expect((screen.getByRole('textbox', { name: '发送消息' }) as HTMLTextAreaElement).value).toBe('second draft');
  fireEvent.click(screen.getByRole('tab', { name: /会话 1/ }));
  expect((screen.getByRole('textbox', { name: '发送消息' }) as HTMLTextAreaElement).value).toBe('submitted draft'); expect(screen.getByText('submitted.txt')).toBeTruthy();
  expect(h.capabilities.session.start).toHaveBeenCalledTimes(2);
  // Real Virtuoso stays bounded rather than replacing virtualization with a test-only full map.
  await waitFor(() => expect(firstPane!.querySelectorAll('.chat-message').length).toBeGreaterThan(0));
  expect(firstPane!.querySelectorAll('.chat-message').length).toBeLessThan(100);
  fireEvent.keyDown(screen.getByRole('textbox', { name: '发送消息' }), { key: 'Enter' });
  await waitFor(() => expect((screen.getByRole('textbox', { name: '发送消息' }) as HTMLTextAreaElement).value).toBe(''));
  expect(screen.queryByText('submitted.txt')).toBeNull();
  act(() => h.emit({ type: 'chat-editor-text', id: 's2', text: 'background draft' }));
  expect((screen.getByRole('textbox', { name: '发送消息' }) as HTMLTextAreaElement).value).toBe('');
  fireEvent.click(screen.getByRole('tab', { name: /会话 2/ }));
  expect((screen.getByRole('textbox', { name: '发送消息' }) as HTMLTextAreaElement).value).toBe('background draft');
  view.unmount(); expect(h.listeners.size).toBe(0);
});

it('App displays malformed bootstrap and preserves the initial missing-bridge prompt without a fake fallback', async () => {
  const h = desktopIPCFake(); window.desktop = { ...h.bridge, bootstrap: () => Promise.resolve({ preferences: {} } as never) };
  const view = render(<App />); expect(await screen.findByText('Error: 桌面返回了无效结果')).toBeTruthy(); view.unmount(); expect(h.listeners.size).toBe(0);
  for (const missing of [undefined, null]) {
    Object.defineProperty(window, 'desktop', { configurable: true, writable: true, value: missing });
    const absent = render(<App />); expect(await screen.findByText('请使用 npm run dev 启动桌面应用。')).toBeTruthy(); expect(h.listeners.size).toBe(0); absent.unmount();
  }
});
