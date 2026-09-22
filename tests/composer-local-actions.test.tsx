/** @vitest-environment jsdom */
import './attachment-menu-contract';
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatPane } from '../src/renderer/features/conversation';
import { installDesktopFake } from './desktop-bridge-fake';
import type { DesktopAPI } from '../src/shared/ipc/desktop-api';
import type { SessionEvent } from '../src/shared/ipc/conversation';

vi.mock('react-virtuoso', () => ({ Virtuoso: () => null }));
let desktop: DesktopAPI;
let emit: (event: SessionEvent) => void;
const errors = vi.fn();
beforeEach(() => {
  errors.mockReset();
  desktop = installDesktopFake({
    startSession: vi.fn().mockResolvedValue(undefined),
    onSessionEvent: vi.fn(callback => { emit = callback; return () => {}; }),
    inspectProjectResources: vi.fn().mockResolvedValue({ paths: [], hasResources: false }),
    sendChatMessage: vi.fn().mockResolvedValue(undefined),
    compactChatSession: vi.fn().mockResolvedValue(undefined),
    getChatSessionStats: vi.fn().mockResolvedValue({ userMessages: 1, assistantMessages: 1, toolCalls: 2, toolResults: 2, totalMessages: 2, tokens: { input: 3, output: 4, cacheRead: 5, cacheWrite: 6, total: 18 }, cost: 0.01 }),
    chooseChatAttachments: vi.fn().mockResolvedValue([{ id: 'file', name: 'note.txt', size: 1, path: '/note.txt', kind: 'file' }]),
  } as unknown as DesktopAPI);
});
afterEach(cleanup);
function Harness({ initial = '' }: { initial?: string }) {
  const [draft, setDraft] = useState(initial);
  return <ChatPane session={{ id: 's', cwd: '/project', title: 'task', kind: 'chat', processStatus: 'running', activity: 'idle' }} active draft={draft} onDraftChange={setDraft} onError={errors} onCommands={() => {}}/>;
}
const editor = () => screen.getByRole<HTMLTextAreaElement>('textbox', { name: '发送消息' });

it('offers local slash actions without extra footer buttons or shortcut prose', async () => {
  render(<Harness/>);
  expect(screen.queryByRole('button', { name: /^(压缩|统计)$/ })).toBeNull();
  expect(screen.queryByText(/Enter 发送/)).toBeNull();
  act(() => editor().focus());
  fireEvent.change(editor(), { target: { value: '/' } });
  expect(screen.getByRole('option', { name: /\/compact/ })).toBeTruthy();
  fireEvent.click(screen.getByRole('option', { name: /\/compact/ }));
  expect(editor().value).toBe('/compact ');
  expect(desktop.compactChatSession).not.toHaveBeenCalled();
  fireEvent.keyDown(editor(), { key: 'Enter' });
  await waitFor(() => expect(desktop.compactChatSession).toHaveBeenCalledExactlyOnceWith('s', undefined));
  await waitFor(() => expect(editor().value).toBe(''));
  expect(desktop.sendChatMessage).not.toHaveBeenCalled();
});
it('passes compact instructions and keeps edits made while acknowledgement is pending', async () => {
  let finish!: () => void;
  vi.mocked(desktop.compactChatSession).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  render(<Harness initial="/compact 保留接口决策"/>);
  fireEvent.keyDown(editor(), { key: 'Enter' });
  expect(desktop.compactChatSession).toHaveBeenCalledWith('s', '保留接口决策');
  fireEvent.change(editor(), { target: { value: 'next draft' } });
  await act(async () => finish());
  expect(editor().value).toBe('next draft');
});
it('opens Pi statistics through /stats without submitting a prompt', async () => {
  render(<Harness initial="/stats"/>);
  fireEvent.keyDown(editor(), { key: 'Enter' });
  expect((await screen.findByRole('dialog', { name: 'Pi 会话统计' })).textContent).toContain('输入 3');
  expect(desktop.getChatSessionStats).toHaveBeenCalledExactlyOnceWith('s');
  expect(desktop.sendChatMessage).not.toHaveBeenCalled();
});
it('retains a rejected command and blocks compaction while busy', async () => {
  vi.mocked(desktop.compactChatSession).mockRejectedValue(new Error('failed'));
  render(<Harness initial="/compact"/>);
  fireEvent.keyDown(editor(), { key: 'Enter' });
  await waitFor(() => expect(errors).toHaveBeenCalledWith('Error: failed'));
  expect(editor().value).toBe('/compact');
  act(() => emit({ type: 'chat-state', id: 's', state: { activity: 'responding' } }));
  fireEvent.keyDown(editor(), { key: 'Enter' });
  await waitFor(() => expect(errors).toHaveBeenLastCalledWith(expect.stringContaining('当前任务结束')));
  expect(desktop.compactChatSession).toHaveBeenCalledTimes(1);
  expect(desktop.sendChatMessage).not.toHaveBeenCalled();
});
it('does not consume attachments when a local command is submitted', async () => {
  render(<Harness initial="/compact"/>);
  fireEvent.click(screen.getByRole('button', { name: '添加附件' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '添加附件' }));
  await screen.findByRole('button', { name: '移除 note.txt' });
  fireEvent.keyDown(editor(), { key: 'Enter' });
  await waitFor(() => expect(errors).toHaveBeenCalledWith(expect.stringContaining('不接收附件')));
  expect(screen.getByRole('button', { name: '移除 note.txt' })).toBeTruthy();
  expect(editor().value).toBe('/compact');
  expect(desktop.compactChatSession).not.toHaveBeenCalled();
});
it('does not intercept command-like prose or IME Enter', async () => {
  render(<Harness initial="请解释 /compact"/>);
  fireEvent.keyDown(editor(), { key: 'Enter', isComposing: true });
  expect(desktop.sendChatMessage).not.toHaveBeenCalled();
  fireEvent.keyDown(editor(), { key: 'Enter' });
  await waitFor(() => expect(desktop.sendChatMessage).toHaveBeenCalledWith('s', expect.objectContaining({ text: '请解释 /compact' })));
  expect(desktop.compactChatSession).not.toHaveBeenCalled();
});
