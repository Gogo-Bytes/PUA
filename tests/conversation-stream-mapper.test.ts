import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeArguments, normalizeHistoryItems, normalizeMessage, normalizeToolResult } from '../src/platform/pi/rpc/chat-normalize';
import { ConversationStreamMapper, messageDTO, streamNotificationDTO } from '../src/platform/pi/rpc/conversation-stream-mapper';
import type { ConversationMessage } from '../src/modules/conversation/index';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe('Conversation stream raw normalization and wire mapping (no transport)', () => {
  it.each([-1, 1.5, NaN, Infinity, -Infinity, 4096, undefined, '0'])('normalizes invalid index %s into a semantic rejection, not a raw object', contentIndex => {
    expect(new ConversationStreamMapper().normalize({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex, delta: 'x' } })).toEqual({ type: 'invalid-fragment-index' });
  });
  it.each([0, 4095])('accepts endpoint index %s', contentIndex => {
    expect(new ConversationStreamMapper().normalize({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', contentIndex, delta: 'x' } })).toEqual({ type: 'fragment', blockIndex: contentIndex, blockType: 'thinking', delta: 'x' });
  });
  it.each(['null', '[]', '1', 'true', '"text"', '{"path":', '{bad}'])('partial arguments %s never become non-object arguments', text => { expect(decodeArguments(text)).toBeUndefined(); });
  it('preserves deeply nested parsed tool JSON and numeric overflow without a recursive validation limit', () => {
    const parsed = decodeArguments('{"x":'.repeat(5000) + '1e400' + '}'.repeat(5000));
    let value: unknown = parsed;
    for (let i = 0; i < 5000; i++) value = (value as { x: unknown }).x;
    expect(value).toBe(Infinity);
  });
  it('accepts empty/nested JSON objects without widening to commands', () => {
    expect(decodeArguments('{}')).toEqual({}); expect(decodeArguments('{"x":[1,null,{"y":true}]}')).toEqual({ x: [1, null, { y: true }] });
  });
  it('preserves sequence consumption, raw-role ID prefixes, clock and random fallback at the edge', () => {
    vi.useFakeTimers(); vi.setSystemTime(1000); vi.spyOn(Math, 'random').mockReturnValue(0.25);
    const mapper = new ConversationStreamMapper();
    expect(mapper.normalize({ type: 'message_start', message: null })).toBeUndefined();
    expect(mapper.normalize({ type: 'message_start', message: { role: 'assistant', content: [{ type: 'toolCall', arguments: {} }] } })).toMatchObject({ message: { id: 'stream-1000-2', timestamp: 1000, blocks: [{ tool: { id: 'tool-0.25', name: 'tool' } }] } });
    expect(mapper.normalize({ type: 'message_end', message: { role: 'toolResult', toolCallId: 'unknown', content: '' } })).toMatchObject({ type: 'message-boundary', result: { toolId: 'unknown' } });
    expect(mapper.normalize({ type: 'message_end', message: { role: 'toolResult', toolCallId: 1 } })).toEqual({ type: 'message-boundary', message: undefined });
    expect(mapper.normalize({ type: 'message_start', message: { role: 'user', timestamp: 2, content: 'user' } })).toMatchObject({ message: { id: 'user-2-3' } });
    expect(normalizeMessage({ role: 'branchSummary', timestamp: 1, summary: 'summary' }, 5)).toMatchObject({ id: 'branchSummary-1-5', role: 'summary' });
    expect(normalizeMessage({ role: 'compactionSummary', timestamp: 1, summary: 'summary' }, 6)).toMatchObject({ id: 'compactionSummary-1-6', role: 'summary' });
  });
  it('normalizes text/thinking/toolCall, compresses unknown blocks and preserves final pending/error fields', () => {
    const message = normalizeMessage({ role: 'assistant', timestamp: 1, stopReason: 'pending', errorMessage: 'error', content: [
      { type: 'unknown' }, { type: 'text', text: 'text' }, { type: 'thinking', thinking: 'thinking' }, { type: 'toolCall', id: 'a', name: 'read', arguments: { path: 'x' } },
    ] }, 0);
    expect(message).toEqual({ id: 'assistant-1-0', role: 'assistant', timestamp: 1, streaming: true, error: 'error', blocks: [
      { type: 'text', text: 'text' }, { type: 'thinking', text: 'thinking' }, { type: 'tool', tool: { id: 'a', name: 'read', arguments: { path: 'x' }, status: 'pending', output: '' } },
    ] });
  });
  it('history normalization preserves raw indices and result order without associating or merging', () => {
    const items = normalizeHistoryItems([{ role: 'custom', display: false }, { role: 'toolResult', toolCallId: 'a', content: 'orphan' }, { role: 'unknown' }, { role: 'assistant', timestamp: 1, content: [{ type: 'toolCall', id: 'a', name: 'read' }] }, { role: 'toolResult', content: 'missing' }]);
    expect(items).toHaveLength(2); expect(items[0]).toMatchObject({ type: 'result', result: { toolId: 'a', result: { output: 'orphan' } } });
    expect(items[1]).toMatchObject({ type: 'message', message: { id: 'assistant-1-3', blocks: [{ tool: { status: 'pending', output: '' } }] } });
    expect(normalizeHistoryItems(null)).toEqual([]);
  });
  it('normalizes declarations/results without location/name association or tool state', () => {
    const mapper = new ConversationStreamMapper();
    expect(mapper.normalize({ type: 'message_update', assistantMessageEvent: { type: 'toolcall_start', contentIndex: 0, id: 5 } })).toBeUndefined();
    expect(mapper.normalize({ type: 'message_update', assistantMessageEvent: { type: 'toolcall_end', contentIndex: 0, toolCall: { id: 'a', name: 1, arguments: [] } } })).toEqual({ type: 'declaration-completed', blockIndex: 0, toolId: 'a', name: undefined, arguments: undefined });
    expect(mapper.normalize({ type: 'tool_execution_end', toolCallId: 'a', toolName: 'read', isError: 'truthy', result: { content: 'done' }, secret: 'ignored' })).toEqual({ type: 'execution-finished', toolId: 'a', name: 'read', arguments: undefined, failed: true, result: { output: 'done', details: undefined, images: [] } });
    expect(mapper.normalize({ type: 'tool_execution_start', toolCallId: 1 })).toBeUndefined();
    expect(mapper.normalize({ type: 'unknown' })).toBeUndefined();
    expect(normalizeToolResult({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }], details: { done: true } })).toEqual({ output: 'a\nb', details: { done: true }, images: [] });
  });
  it('maps the existing DTO surface with detached mutable containers and shared immutable JSON leaves', () => {
    const nested = { leaf: true }; const message: ConversationMessage = { id: 'm', role: 'assistant', timestamp: 1, blocks: [{ type: 'tool', tool: { id: 'a', name: 'read', arguments: { nested }, status: 'running', output: '', images: [{ type: 'image', data: 'aA==', mimeType: 'image/png' }] } }] };
    const dto = messageDTO(message); const block = dto.blocks[0]; if (block.type !== 'tool') throw new Error('tool');
    expect(block.tool.arguments.nested).toBe(nested); block.tool.arguments.extra = 'mutation'; block.tool.images![0].data = 'changed'; dto.blocks.push({ type: 'text', text: 'changed' });
    expect(message.blocks).toHaveLength(1); expect(message.blocks[0]).toMatchObject({ tool: { arguments: { nested }, images: [{ data: 'aA==' }] } });
    expect(message.blocks[0]).not.toHaveProperty('tool.arguments.extra');
    expect(streamNotificationDTO({ type: 'message-began', message }).type).toBe('chat-message-start');
    expect(streamNotificationDTO({ type: 'message-completed', message }).type).toBe('chat-message-end');
    expect(streamNotificationDTO({ type: 'fragment', messageId: 'm', blockIndex: 1, blockType: 'thinking', delta: 'x' })).toEqual({ type: 'chat-message-delta', messageId: 'm', blockIndex: 1, blockType: 'thinking', delta: 'x' });
  });
});
