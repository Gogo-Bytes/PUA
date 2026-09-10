import { afterEach, describe, expect, it, vi } from 'vitest';
import { Writable } from 'node:stream';
import { extensionResponse, validBlockIndex } from '../src/shared/chat-validation';
import { ConversationRuntimeApplication } from '../src/modules/conversation/index';
import { RpcWriter } from '../src/main/rpc-writer';
import { contentImages } from '../src/main/chat-normalize';
import { emptyChatState, reduceChatEvent } from '../src/renderer/chat-state';

afterEach(() => vi.useRealTimers());
describe('extension response boundary and lifecycle', () => {
  it('reconstructs the union and rejects wrong, duplicate and expired dialog answers', async () => {
    vi.useFakeTimers();
    const retired = vi.fn(); const writeAnswer = vi.fn().mockResolvedValue(undefined);
    const runtime = new ConversationRuntimeApplication({
      clearQueue: async () => ({ steering: [], followUp: [] }), abort: async () => {}, writeAnswer,
    }, {
      now: () => Date.now(), at: (deadline, callback) => {
        const timer = setTimeout(callback, deadline - Date.now()); return () => clearTimeout(timer);
      },
    }, event => { if (event.type === 'dialog-closed') retired(event.dialogId); });
    const open = () => runtime.accept({ type: 'dialog', dialog: { id: 'd', kind: 'select', title: 'Pick', options: ['yes'], expiresAt: Date.now() + 100 } });
    open();
    const hostile = { id: 'd', cancelled: true, type: 'switch_session', sessionPath: '/private/session' };
    expect(extensionResponse(hostile)).toEqual({ id: 'd', cancelled: true });
    await expect(runtime.answer({ id: 'd', confirmed: true })).rejects.toMatchObject({ code: 'ANSWER_TYPE' });
    await expect(runtime.answer({ id: 'd', value: 'other' })).rejects.toMatchObject({ code: 'INVALID_OPTION' });
    await runtime.answer(extensionResponse(hostile));
    expect(writeAnswer).toHaveBeenCalledExactlyOnceWith({ id: 'd', cancelled: true });
    open(); vi.advanceTimersByTime(100); expect(retired).toHaveBeenCalledWith('d');
    await expect(runtime.answer(extensionResponse(hostile))).rejects.toMatchObject({ code: 'DIALOG_ENDED' });
    expect(runtime.waiting).toBe(false);
    runtime.accept({ type: 'dialog', dialog: { id: 'e', kind: 'input', title: 'Text' } });
    await runtime.answer({ id: 'e', value: '' });
    await expect(runtime.answer({ id: 'e', value: '' })).rejects.toMatchObject({ code: 'DIALOG_ENDED' });
  });
  it('clears expired/exited dialogs without creating responding activity', () => {
    let state = reduceChatEvent(emptyChatState(), { id: 's', type: 'extension-ui', request: { id: 'd', method: 'input', title: 'Text' } });
    expect(state.activity).toBe('idle');
    state = reduceChatEvent(state, { id: 's', type: 'extension-ui-closed', requestId: 'd' }); expect(state.dialog).toBeUndefined();
    state = reduceChatEvent(state, { id: 's', type: 'extension-ui', request: { id: 'e', method: 'input', title: 'Text' } });
    state = reduceChatEvent(state, { id: 's', type: 'exit', exitCode: 1 }); expect(state.dialogs).toEqual([]); expect(state.exited).toBe(true);
  });
});
describe('bounded chat payloads and authoritative results', () => {
  it.each([-1, 1.5, NaN, Infinity, 2 ** 32, 4096])('ignores invalid content index %s at both seams', index => {
    expect(validBlockIndex(index)).toBe(false);
    let state = reduceChatEvent(emptyChatState(), { id: 's', type: 'chat-message-start', message: { id: 'm', role: 'assistant', blocks: [], timestamp: 1 } });
    const initial = state;
    state = reduceChatEvent(state, { id: 's', type: 'chat-message-delta', messageId: 'm', blockType: 'text', blockIndex: index, delta: 'bad' });
    expect(state).toBe(initial);
  });
  it('drops provisional calls absent from the final message and accepts empty final results', () => {
    const tool = { id: 't', name: 'read', arguments: { path: 'old' }, status: 'running' as const, output: 'stale' };
    let state = reduceChatEvent(emptyChatState(), { id: 's', type: 'chat-tool', messageId: 'm', blockIndex: 0, tool });
    state = reduceChatEvent(state, { id: 's', type: 'chat-tool', messageId: 'm', tool: { ...tool, status: 'success', output: '' } });
    expect(state.messages[0].blocks[0]).toMatchObject({ tool: { output: '', status: 'success' } });
    state = reduceChatEvent(state, { id: 's', type: 'chat-message-end', message: { id: 'm', role: 'assistant', blocks: [{ type: 'text', text: 'no calls' }], timestamp: 1 } });
    expect(state.messages[0].blocks).toEqual([{ type: 'text', text: 'no calls' }]);
  });
  it('retains only safe bounded inline image content', () => {
    expect(contentImages([{ type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }])).toHaveLength(1);
    expect(contentImages([{ type: 'image', data: '<svg/>', mimeType: 'image/svg+xml' }])).toEqual([]);
    expect(contentImages(Array(5).fill({ type: 'image', data: 'aA==', mimeType: 'image/png' }))).toHaveLength(4);
  });
  it('times out a blocked write independently of an open extension dialog', async () => {
    vi.useFakeTimers(); const stream = new Writable({ write() {} }); const writer = new RpcWriter(stream, 80, 100);
    const failed = expect(writer.write({ text: 'stalled' })).rejects.toThrow('stalled');
    vi.advanceTimersByTime(100); await failed; expect(writer.failed).toBe(true);
  });
  it('bounds a non-reading stdin and rejects queued work on shutdown', async () => {
    let finish: (() => void) | undefined;
    const stream = new Writable({ highWaterMark: 1, write(_chunk, _encoding, done) { finish = done; } });
    const writer = new RpcWriter(stream, 80);
    const first = writer.write({ text: 'first' });
    const second = writer.write({ text: 'second' });
    await expect(writer.write({ text: 'x'.repeat(80) })).rejects.toThrow('backlog');
    const rejection = expect(second).rejects.toThrow('closing');
    const firstRejection = expect(first).rejects.toThrow('closing');
    writer.close(new Error('closing')); await rejection; await firstRejection;
    finish?.(); stream.destroy();
  });
});
