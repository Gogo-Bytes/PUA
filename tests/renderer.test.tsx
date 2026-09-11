/** @vitest-environment jsdom */
import { installDesktopFake } from './desktop-bridge-fake';
import type { DesktopAPI } from '../src/shared/ipc/desktop-api';
let desktop: DesktopAPI;
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('react-virtuoso', () => ({ Virtuoso: ({ data = [], itemContent }: { data?: unknown[]; itemContent(index: number, item: unknown): React.ReactNode }) => <div>{data.map((item, index) => <div key={index}>{itemContent(index, item)}</div>)}</div> }));
import { ChatPane, MarkdownView, ToolCard } from '../src/renderer/features/conversation';

afterEach(cleanup);
let emit: ((event: import('../src/shared/chat').SessionEvent) => void) | undefined;
beforeEach(() => {
  emit = undefined;
  desktop = installDesktopFake({
    openExternal: vi.fn().mockResolvedValue(undefined), writeClipboard: vi.fn().mockResolvedValue(undefined), startSession: vi.fn().mockResolvedValue(undefined),
    onSessionEvent: vi.fn(callback => { emit = callback; return () => {}; }), sendChatMessage: vi.fn().mockResolvedValue(undefined), stopChat: vi.fn().mockResolvedValue(undefined), chooseChatAttachments: vi.fn().mockResolvedValue([]), respondToExtensionUI: vi.fn().mockResolvedValue(undefined),
  } as unknown as DesktopAPI);
});

describe('native message rendering', () => {
  it('renders GFM and highlighted code without executing raw HTML', () => {
    const { container } = render(<MarkdownView text={'## Title\n\n- [x] done\n\n|a|b|\n|-|-|\n|1|2|\n\n```ts\nconst x = 1\n```\n\n<script>window.pwned=true</script>'} />);
    expect(screen.getByRole('heading', { name: 'Title' })).toBeTruthy();
    expect(container.querySelector('table')).toBeTruthy();
    expect(container.querySelector('code.hljs')).toBeTruthy();
    expect(container.querySelector('script')).toBeNull();
    expect((window as unknown as { pwned?: boolean }).pwned).not.toBe(true);
  });
  it('routes links through validated desktop IPC', () => {
    render(<MarkdownView text="[site](https://example.com)" />);
    fireEvent.click(screen.getByRole('link', { name: 'site' }));
    expect(desktop.openExternal).toHaveBeenCalledWith('https://example.com');
  });
  it('does not automatically load remote markdown images', () => {
    const { container } = render(<MarkdownView text="![secret](https://example.com/a.png)" />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText(/远程图片未自动加载/)).toBeTruthy();
  });
});

describe('native composer', () => {
  it('is IME-safe and maps Enter/Shift+Enter/Alt+Enter to prompt/newline/follow-up', async () => {
    function Harness() { const [draft, setDraft] = useState('你好'); return <ChatPane session={{ id: 's', cwd: '/tmp', title: 's', kind: 'chat', processStatus: 'running', activity: 'idle' }} active draft={draft} onDraftChange={setDraft} onError={() => {}} onCommands={() => {}} />; }
    render(<Harness />);
    const textbox = screen.getByRole('textbox', { name: '发送消息' });
    fireEvent.keyDown(textbox, { key: 'Enter', isComposing: true }); expect(desktop.sendChatMessage).not.toHaveBeenCalled();
    fireEvent.keyDown(textbox, { key: 'Enter', shiftKey: true }); expect(desktop.sendChatMessage).not.toHaveBeenCalled();
    fireEvent.keyDown(textbox, { key: 'Enter' }); await waitFor(() => expect(desktop.sendChatMessage).toHaveBeenCalledWith('s', expect.objectContaining({ delivery: 'prompt' })));
    fireEvent.change(textbox, { target: { value: 'later' } });
    act(() => emit?.({ type: 'chat-state', id: 's', state: { activity: 'responding' } }));
    await screen.findByRole('button', { name: /停止/ });
    fireEvent.keyDown(textbox, { key: 'Enter', altKey: true }); await waitFor(() => expect(desktop.sendChatMessage).toHaveBeenLastCalledWith('s', expect.objectContaining({ delivery: 'followUp' })));
  });
});

describe('tool card', () => {
  it('collapses successful output and expands failures', () => {
    const { rerender, container } = render(<ToolCard tool={{ id: '1', name: 'read', arguments: { path: 'a.ts' }, status: 'success', output: 'ok' }} />);
    expect(container.querySelector('details')?.open).toBe(false);
    rerender(<ToolCard tool={{ id: '1', name: 'read', arguments: { path: 'a.ts' }, status: 'error', output: 'failed' }} />);
    expect(container.querySelector('details')?.open).toBe(true);
    expect(screen.getByText('failed')).toBeTruthy();
  });
});

describe('draft acceptance races', () => {
  function Harness() { const [draft, setDraft] = useState('original'); return <ChatPane session={{ id: 's', cwd: '/tmp', title: 's', kind: 'chat', processStatus: 'running', activity: 'idle' }} active draft={draft} onDraftChange={setDraft} onError={() => {}} onCommands={() => {}} />; }
  it('preserves newer typing and prevents double-submit before acceptance', async () => {
    let accept!: () => void;
    vi.mocked(desktop.sendChatMessage).mockImplementation(() => new Promise(resolve => { accept = resolve; }));
    render(<Harness />); const textbox = screen.getByRole('textbox', { name: '发送消息' });
    fireEvent.keyDown(textbox, { key: 'Enter' }); fireEvent.keyDown(textbox, { key: 'Enter' });
    expect(desktop.sendChatMessage).toHaveBeenCalledTimes(1);
    fireEvent.change(textbox, { target: { value: 'new typing' } });
    await act(async () => { accept(); });
    expect((textbox as HTMLTextAreaElement).value).toBe('new typing');
  });
  it('preserves extension prefill delivered before prompt acceptance', async () => {
    let accept!: () => void;
    vi.mocked(desktop.sendChatMessage).mockImplementation(() => new Promise(resolve => { accept = resolve; }));
    render(<Harness />); const textbox = screen.getByRole('textbox', { name: '发送消息' });
    fireEvent.keyDown(textbox, { key: 'Enter' });
    act(() => emit?.({ id: 's', type: 'chat-editor-text', text: 'extension prefill' }));
    await act(async () => { accept(); });
    expect((textbox as HTMLTextAreaElement).value).toBe('extension prefill');
  });
  it('merges stopped queue into the latest draft, not the pre-stop draft', async () => {
    let stopped!: (error: Error) => void;
    vi.mocked(desktop.stopChat).mockImplementation(() => new Promise((_resolve, reject) => { stopped = reject; }));
    render(<Harness />); const textbox = screen.getByRole('textbox', { name: '发送消息' });
    act(() => emit?.({ id: 's', type: 'chat-state', state: { activity: 'responding' } }));
    fireEvent.click(screen.getByRole('button', { name: /停止/ }));
    fireEvent.change(textbox, { target: { value: 'latest' } });
    const recovery = { id: 's', type: 'chat-queue-recovered' as const, requestId: 'stop-1', queue: { steering: ['queued'], followUp: [] } };
    act(() => { emit?.(recovery); emit?.(recovery); });
    expect((textbox as HTMLTextAreaElement).value).toBe('latest\n\nqueued');
    await act(async () => { stopped(new Error('abort failed')); });
    expect((textbox as HTMLTextAreaElement).value).toBe('latest\n\nqueued');
  });
});
