import { describe, expect, it } from 'vitest';
import { ConversationStreamApplication, type ArgumentDecoderPort, type ConversationBlock, type ConversationHistoryItem, type ConversationMessage, type ConversationObject, type ConversationStreamNotification, type StreamSchedulePort, type ToolExecution } from '../../../src/modules/conversation/index';

class FakeClock implements StreamSchedulePort {
  now = 0;
  jobs: { due: number; callback: () => void; cancelled: boolean }[] = [];
  after(delay: number, callback: () => void) {
    const job = { due: this.now + delay, callback, cancelled: false }; this.jobs.push(job);
    return () => { job.cancelled = true; };
  }
  advance(delay: number) {
    this.now += delay;
    for (const job of this.jobs) if (!job.cancelled && job.due <= this.now) { job.cancelled = true; job.callback(); }
  }
}
class FakeDecoder implements ArgumentDecoderPort {
  values = new Map<string, ConversationObject>();
  decode(text: string) { return this.values.get(text); }
}
const tool = (id: string, name = 'read'): ToolExecution => ({ id, name, arguments: {}, status: 'pending', output: '' });
const message = (id: string, blocks: readonly ConversationBlock[] = []): ConversationMessage => ({ id, role: 'assistant', timestamp: 1, blocks });
const declaration = (id: string): ConversationBlock => ({ type: 'tool', tool: tool(id) });
const historyCall = (id: string, toolId: string): ConversationHistoryItem => ({ type: 'message', message: message(id, [declaration(toolId)]) });
const historyResult = (toolId: string, output: string): ConversationHistoryItem => ({ type: 'result', result: { toolId, failed: false, result: { output, images: [] } } });
const historicalTool = (m: ConversationMessage): ToolExecution => { const block = m.blocks[0]; if (block.type !== 'tool') throw new Error('expected tool'); return block.tool; };
function setup(observer?: (event: ConversationStreamNotification) => void) {
  const clock = new FakeClock(); const decoder = new FakeDecoder(); const notifications: ConversationStreamNotification[] = [];
  const core = new ConversationStreamApplication(clock, decoder, event => { notifications.push(event); observer?.(event); });
  const begin = (id = 'm', blocks: readonly ConversationBlock[] = []) => core.accept({ type: 'message-began', message: message(id, blocks) });
  const fragment = (delta: string, blockIndex = 0, blockType: 'text' | 'thinking' = 'text') => core.accept({ type: 'fragment', delta, blockIndex, blockType });
  const tools = () => notifications.filter(event => event.type === 'tool-changed').map(event => event.tool);
  const fragments = () => notifications.filter(event => event.type === 'fragment');
  return { core, clock, decoder, notifications, begin, fragment, tools, fragments };
}

describe('ConversationStreamApplication with Fake schedule/decoder, no transport', () => {
  it('groups by message/index/kind at exactly 24ms in first-insertion order; final flushes and is authoritative', () => {
    const s = setup(); s.begin(); s.fragment('a'); s.fragment('t', 0, 'thinking'); s.fragment('b'); s.begin('next'); s.fragment('n');
    s.clock.advance(23); expect(s.fragments()).toEqual([]); s.clock.advance(1);
    expect(s.fragments().map(e => [e.messageId, e.blockIndex, e.blockType, e.delta])).toEqual([['m', 0, 'text', 'ab'], ['m', 0, 'thinking', 't'], ['next', 0, 'text', 'n']]);
    s.fragment('provisional'); s.core.accept({ type: 'message-boundary', message: message('allocated', [{ type: 'text', text: 'final' }]) });
    expect(s.notifications.at(-2)).toMatchObject({ type: 'fragment', delta: 'provisional' });
    expect(s.notifications.at(-1)).toEqual({ type: 'message-completed', message: { ...message('next', [{ type: 'text', text: 'final' }]), streaming: false } });
    const count = s.notifications.length; s.fragment('late'); s.clock.advance(24); expect(s.notifications).toHaveLength(count);
  });
  it('keeps user identity independent and every ignored/result boundary flushes', () => {
    const s = setup(); s.begin(); s.core.accept({ type: 'message-began', message: { ...message('user-start'), role: 'user' } });
    s.fragment('a'); s.core.accept({ type: 'message-boundary' }); expect(s.fragments().at(-1)?.messageId).toBe('m');
    s.fragment('b'); s.core.accept({ type: 'message-boundary', result: { toolId: 'unknown', failed: false, result: { output: '', images: [] } } });
    s.core.accept({ type: 'message-boundary', message: { ...message('user-end'), role: 'user' } });
    expect(s.notifications.at(-1)).toMatchObject({ message: { id: 'user-start' } }); s.fragment('c'); s.clock.advance(24); expect(s.fragments().at(-1)?.messageId).toBe('m');
  });
  it('invalidates synchronously, cancels late tick and never resurrects history/input', () => {
    const s = setup(); s.begin(); s.fragment('discard'); const stale = s.clock.jobs[0];
    s.core.invalidate(); s.core.invalidate(); expect(stale.cancelled).toBe(true);
    const before = s.notifications.length; stale.callback(); s.begin('late'); s.fragment('late'); s.core.accept({ type: 'invalid-fragment-index' });
    expect(s.core.initializeHistory([historyCall('h', 't')])).toEqual([]); expect(s.notifications).toHaveLength(before);
  });
  it('detaches batches before observers and does not clear a synchronously queued new batch', () => {
    let injected = false;
    const s = setup(event => { if (event.type === 'fragment' && !injected) { injected = true; s.fragment('new', 2); } });
    s.begin(); s.fragment('old'); s.fragment('second', 1); const oldTick = s.clock.jobs[0]; s.clock.advance(24);
    expect(s.fragments().map(e => e.delta)).toEqual(['old', 'second']); expect(s.clock.jobs[1].cancelled).toBe(false);
    oldTick.callback(); expect(s.fragments().map(e => e.delta)).toEqual(['old', 'second']);
    s.clock.advance(24); expect(s.fragments().map(e => e.delta)).toEqual(['old', 'second', 'new']);
  });
  it('observer close on first notification prevents remaining deltas and unfinished final', () => {
    const s = setup(event => { if (event.type === 'fragment') s.core.invalidate(); }); s.begin(); s.fragment('first'); s.fragment('second', 1);
    s.core.accept({ type: 'message-boundary', message: message('final') });
    expect(s.fragments().map(e => e.delta)).toEqual(['first']); expect(s.notifications.some(e => e.type === 'message-completed')).toBe(false);
  });
  it('observer failure propagates and cancels even a new batch queued during the failing observer', () => {
    const error = new Error('delivery unknown');
    const s = setup(event => { if (event.type === 'fragment') { s.fragment('new'); throw error; } });
    s.begin(); s.fragment('first'); s.fragment('second', 1);
    expect(() => s.clock.advance(24)).toThrow(error); expect(s.clock.jobs.every(job => job.cancelled)).toBe(true);
    for (const job of s.clock.jobs) job.callback(); expect(s.fragments().map(e => e.delta)).toEqual(['first']);
  });
  it('only diagnoses invalid indices while assistant is active; final and invalidation suppress it', () => {
    const s = setup(); const invalid = () => s.core.accept({ type: 'invalid-fragment-index' });
    invalid(); expect(s.notifications).toEqual([]); s.begin(); invalid(); invalid();
    expect(s.notifications.filter(e => e.type === 'fragment-index-rejected')).toHaveLength(2);
    s.core.accept({ type: 'message-boundary', message: message('final') }); invalid(); s.begin('next'); s.core.invalidate(); invalid();
    expect(s.notifications.filter(e => e.type === 'fragment-index-rejected')).toHaveLength(2);
  });
  it('uses the decoder only for cumulative argument text and retains the last complete object', () => {
    const s = setup(); s.decoder.values.set('{"path":"x"}', { path: 'x' }); s.begin('m', [declaration('a')]);
    s.core.accept({ type: 'arguments-fragment', blockIndex: 3, delta: 'orphan' }); expect(s.tools()).toEqual([]);
    for (const delta of ['{"path":', '"x"}', 'broken']) s.core.accept({ type: 'arguments-fragment', blockIndex: 0, delta });
    expect(s.tools().map(t => t.arguments)).toEqual([{}, { path: 'x' }, { path: 'x' }]);
    expect(s.tools()[1].details).toEqual({ argumentText: '{"path":"x"}' });
    s.core.accept({ type: 'declaration-completed', toolId: 'a', blockIndex: 0, name: 'final', arguments: { final: true } });
    expect(s.tools().at(-1)).toMatchObject({ name: 'final', arguments: { final: true }, details: undefined });
    expect(s.clock.jobs).toEqual([]);
  });
  it('execution details replace argument accumulation and two IDs at one location retain first-ID lookup', () => {
    const s = setup(); s.decoder.values.set('fresh', { fresh: true }); s.begin('m', [declaration('a')]);
    s.core.accept({ type: 'arguments-fragment', blockIndex: 0, delta: 'old' });
    s.core.accept({ type: 'execution-progressed', toolId: 'a', name: 'read', result: { output: 'x', details: { execution: true }, images: [] } });
    s.core.accept({ type: 'tool-declared', blockIndex: 0, toolId: 'b', name: 'read' });
    s.core.accept({ type: 'arguments-fragment', blockIndex: 0, delta: 'fresh' });
    expect(s.tools().at(-1)).toMatchObject({ id: 'a', arguments: { fresh: true }, details: { argumentText: 'fresh' } });
  });
  it('parallel cumulative outputs replace, reverse completion is ID-scoped, final metadata/membership is authoritative', () => {
    const s = setup(); s.begin('m', [declaration('keep'), declaration('retire')]);
    for (const [toolId, output] of [['keep', 'a'], ['retire', 'x'], ['keep', 'ab']]) s.core.accept({ type: 'execution-progressed', toolId, name: 'read', result: { output, images: [] } });
    expect(s.tools().filter(t => t.id === 'keep').map(t => t.output)).toEqual(['a', 'ab']);
    for (const toolId of ['retire', 'keep']) s.core.accept({ type: 'execution-finished', toolId, name: 'read', failed: false, result: { output: toolId, images: [{ type: 'image', data: 'aA==', mimeType: 'image/png' }], details: { done: true } } });
    s.core.accept({ type: 'message-boundary', message: message('allocated', [{ type: 'tool', tool: { ...tool('keep', 'final'), arguments: { final: true } } }]) });
    const publishedFinal = s.notifications.at(-1);
    s.core.accept({ type: 'execution-began', toolId: 'keep', name: 'wrong', arguments: { wrong: true } });
    s.core.accept({ type: 'execution-progressed', toolId: 'keep', name: 'wrong', result: { output: 'ignored', images: [] } });
    expect(s.tools().at(-1)).toMatchObject({ name: 'final', arguments: { final: true }, status: 'success', output: 'keep' });
    const count = s.tools().length; s.core.accept({ type: 'execution-finished', toolId: 'retire', name: 'read', failed: false, result: { output: 'late', images: [] } }); expect(s.tools()).toHaveLength(count);
    s.core.accept({ type: 'message-boundary', result: { toolId: 'keep', failed: true, result: { output: '', images: [] } } });
    expect(s.tools().at(-1)).toMatchObject({ status: 'error', output: '', images: [] });
    expect(publishedFinal).toMatchObject({ message: { blocks: [{ tool: { output: 'keep', images: [{ data: 'aA==' }] } }] } });
  });
  it('history merges known result by ID without storing orphan results or associating names', () => {
    const s = setup(); const messages = s.core.initializeHistory([historyResult('a', 'orphan'), historyCall('a-message', 'a'), historyCall('b-message', 'b'), historyResult('unknown', 'unknown'), historyResult('b', 'done'), historyCall('empty', ''), historyResult('', 'ignored')]);
    expect(messages.map(historicalTool).map(t => [t.id, t.status, t.output])).toEqual([['a', 'pending', ''], ['b', 'success', 'done'], ['', 'pending', '']]);
    expect(s.notifications).toEqual([]);
  });
  it('historical duplicates associate the latest call; repeated/empty results replace independently', () => {
    const s = setup(); const messages = s.core.initializeHistory([historyCall('first', 'a'), historyResult('a', 'first result'), historyCall('second', 'a'), historyResult('a', 'second result'), historyResult('a', '')]);
    expect(messages.map(historicalTool).map(t => t.output)).toEqual(['first result', '']);
    s.core.accept({ type: 'execution-began', toolId: 'a', name: 'late', arguments: { late: true } });
    expect(s.notifications.at(-1)).toMatchObject({ messageId: 'second', tool: { name: 'read', arguments: { late: true } } });
    expect(messages.map(historicalTool).map(t => t.arguments)).toEqual([{}, {}]);
  });
  it('history seeding overwrites matching live IDs, retains unrelated live IDs and does not mark historical declarations final', () => {
    const s = setup(); s.begin('live', [declaration('a'), declaration('b')]); s.core.initializeHistory([historyCall('history', 'a')]);
    for (const toolId of ['a', 'b']) s.core.accept({ type: 'execution-began', toolId, name: 'unused', arguments: { live: true } });
    expect(s.notifications.filter(e => e.type === 'tool-changed').map(e => [e.messageId, e.tool.arguments])).toEqual([['history', { live: true }], ['live', { live: true }]]);
  });
  it('starts replace initial declaration state, but incremental declarations reuse early execution by stable ID', () => {
    const s = setup(); s.core.accept({ type: 'execution-finished', toolId: 'a', name: 'early', failed: true, result: { output: 'early result', images: [] } });
    s.begin(); s.core.accept({ type: 'tool-declared', toolId: 'a', name: 'ignored', blockIndex: 0 }); expect(s.tools().at(-1)).toMatchObject({ name: 'early', status: 'error' });
    s.begin('new', [declaration('a')]); s.core.accept({ type: 'execution-began', toolId: 'a', name: 'ignored' }); expect(s.tools().at(-1)).toMatchObject({ name: 'read', status: 'running', output: '' });
  });
});
