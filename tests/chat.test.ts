import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonlDecoder, TailBuffer } from '../src/platform/pi/rpc/jsonl';
import { validateChatArguments } from '../src/app/main/desktop-preferences';
import { imageMimeType } from '../src/platform/filesystem/attachment-policy';
import { inspectProjectResources } from '../src/platform/filesystem/project-resources';
import { emptyChatState, reduceChatEvent } from '../src/renderer/features/conversation';
import type { SessionEvent } from '../src/shared/chat';

describe('strict RPC JSONL transport', () => {
  it('handles arbitrary UTF-8 chunks, CRLF, and Unicode separators without splitting them', () => {
    const values: unknown[] = []; const decoder = new JsonlDecoder(value => values.push(value));
    const input = Buffer.from('{"text":"你\u2028好"}\r\n{"value":2}\n');
    decoder.push(input.subarray(0, 10)); decoder.push(input.subarray(10, 13)); decoder.push(input.subarray(13)); decoder.end();
    expect(values).toEqual([{ text: '你\u2028好' }, { value: 2 }]);
  });
  it('parses an EOF fragment and rejects malformed or oversized records', () => {
    const values: unknown[] = []; const decoder = new JsonlDecoder(value => values.push(value), 12); decoder.push('{"ok":true}'); decoder.end(); expect(values).toEqual([{ ok: true }]);
    expect(() => new JsonlDecoder(() => {}).push('{bad}\n')).toThrow('Malformed Pi RPC JSON');
    expect(() => new JsonlDecoder(() => {}, 3).push('1234')).toThrow('exceeds');
  });
  it('retains only the bounded stderr tail', () => { const tail = new TailBuffer(8); tail.append('abcdefghijklmnop'); expect(Buffer.byteLength(tail.toString())).toBeLessThanOrEqual(8); });
});

describe('chat reducer', () => {
  const id = 'session';
  type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;
  const apply = (state: ReturnType<typeof emptyChatState>, event: WithoutId<SessionEvent>) => reduceChatEvent(state, { ...event, id } as SessionEvent);
  it('assembles indexed deltas and treats message_end as authoritative', () => {
    let state = emptyChatState();
    state = apply(state, { type: 'chat-message-start', message: { id: 'm', role: 'assistant', blocks: [], timestamp: 1, streaming: true } });
    state = apply(state, { type: 'chat-message-delta', messageId: 'm', blockIndex: 0, blockType: 'text', delta: 'part' });
    state = apply(state, { type: 'chat-message-end', message: { id: 'm', role: 'assistant', blocks: [{ type: 'text', text: 'final' }], timestamp: 1 } });
    expect(state.messages).toHaveLength(1); expect(state.messages[0].blocks[0]).toEqual({ type: 'text', text: 'final' });
  });
  it('correlates an out-of-order tool update and preserves a terminal result', () => {
    let state = emptyChatState(); state = apply(state, { type: 'chat-message-start', message: { id: 'm', role: 'assistant', blocks: [], timestamp: 1 } });
    state = apply(state, { type: 'chat-tool', messageId: 'm', blockIndex: 1, tool: { id: 't', name: 'bash', arguments: {}, status: 'success', output: 'ok' } });
    state = apply(state, { type: 'chat-tool', messageId: 'm', blockIndex: 1, tool: { id: 't', name: 'bash', arguments: {}, status: 'running', output: '' } });
    expect(state.messages[0].blocks[1]).toMatchObject({ type: 'tool', tool: { status: 'success', output: 'ok' } });
  });
});

describe('chat attachment policy', () => {
  it('allows only supported image types', () => {
    expect(imageMimeType('screen.PNG')).toBe('image/png'); expect(imageMimeType('notes.txt')).toBeUndefined();
  });
});

describe('project resource trust detection', () => {
  it('detects ancestor Pi/agent resources without reading trust state', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pua-resources-')); const child = path.join(root, 'src');
    try { await mkdir(path.join(root, '.agents/skills'), { recursive: true }); await mkdir(child); const result = await inspectProjectResources(child); expect(result.hasResources).toBe(true); expect(result.paths.some(value => value.endsWith('.agents/skills'))).toBe(true); }
    finally { await rm(root, { recursive: true, force: true }); }
  });
});

describe('chat-owned CLI arguments', () => {
  it('rejects protocol/session/trust conflicts while preserving ordinary Pi args', () => {
    expect(() => validateChatArguments(['--mode', 'json'])).toThrow('聊天模式不能使用');
    expect(() => validateChatArguments(['--session=abc'])).toThrow();
    expect(() => validateChatArguments(['--approve'])).toThrow();
    expect(() => validateChatArguments(['--model', 'gpt', '--extension', 'x.ts'])).not.toThrow();
  });
});
