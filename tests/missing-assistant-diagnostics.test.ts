import { describe, expect, it, vi } from 'vitest';
import { createMissingAssistantDiagnostics, missingAssistantDiagnosticPrefix } from '../src/shared/missing-assistant-diagnostics';
import { MissingAssistantDiagnosticSession, withoutMissingAssistantDiagnostics } from '../src/platform/electron/utility/missing-assistant-diagnostics';

const event = { type: 'message_end', message: { id: 'm-1', role: 'assistant', content: [{ type: 'text', text: 'private before PUA_ACCEPTANCE_OK private after' }, { type: 'toolCall', id: 'tool', arguments: { token: 'not-for-logs' } }], errorMessage: 'secret-error' }, extra: 'secret-extra' };
const decode = (line: string) => JSON.parse(line.slice(missingAssistantDiagnosticPrefix.length));

describe('temporary missing assistant diagnostics: metadata only, bounded and opt-in', () => {
  it('disabled and other-session paths do not inspect messages or log', () => {
    const sink = vi.fn(); const value = { get type() { throw new Error('must not inspect'); } };
    const off = createMissingAssistantDiagnostics(() => undefined, sink);
    const on = createMissingAssistantDiagnostics(() => 'target', sink);
    off.record('worker-received', 'target', value); on.record('worker-received', 'other', value);
    off.relay('target', 'unrelated'); on.relay('other', missingAssistantDiagnosticPrefix + JSON.stringify({ stage: 'worker-received', sessionId: 'target' }) + '\n');
    expect(sink).not.toHaveBeenCalled(); expect(off.enabled('target')).toBe(false);
  });
  it('projects only fixed metadata and the marker boolean, never payloads or arbitrary type values', () => {
    const sink = vi.fn(); const diagnostic = createMissingAssistantDiagnostics(() => 'target', sink);
    diagnostic.record('worker-received', 'target', event);
    diagnostic.record('worker-received', 'target', { type: 'secret-event-name', message: event.message });
    expect(sink).toHaveBeenCalledTimes(1);
    expect(decode(sink.mock.calls[0][0])).toEqual({ stage: 'worker-received', sessionId: 'target', eventType: 'message_end', messageId: 'm-1', role: 'assistant', blockTypes: ['text', 'toolCall'], marker: true });
    expect(sink.mock.calls[0][0]).not.toMatch(/private|secret|not-for-logs|arguments|PUA_ACCEPTANCE_OK/);
  });
  it('limits identifiers, roles, block types and projections from malformed values', () => {
    const sink = vi.fn(); const diagnostic = createMissingAssistantDiagnostics(() => 'target', sink);
    diagnostic.record('renderer-reduced', 'target', { type: 'chat-projection', message: { id: 'x'.repeat(129), role: 'private-role', blocks: [{ type: 'private-block', text: 'private' }] } });
    expect(decode(sink.mock.calls[0][0])).toEqual({ stage: 'renderer-reduced', sessionId: 'target', eventType: 'chat-projection', blockTypes: [], marker: false });
    const invalid = createMissingAssistantDiagnostics(() => 'bad\nid', sink);
    invalid.record('worker-received', 'bad\nid', event); expect(sink).toHaveBeenCalledTimes(1);
  });
  it('shares a 100 entry quota across local events and relays; failed sinks also consume quota', () => {
    const sink = vi.fn(() => { throw new Error('sink failed with private details'); });
    const diagnostic = createMissingAssistantDiagnostics(() => 'target', sink);
    for (let i = 0; i < 120; i++) expect(() => diagnostic.record('main-forwarded', 'target', event)).not.toThrow();
    expect(sink).toHaveBeenCalledTimes(100); expect(diagnostic.enabled('target')).toBe(false);
  });
  it('isolates getter, target lookup and serialization/sink failures', () => {
    const sink = vi.fn(); const diagnostic = createMissingAssistantDiagnostics(() => 'target', sink);
    expect(() => diagnostic.record('main-forwarded', 'target', { get type() { throw new Error('private'); } })).not.toThrow();
    const invalid = createMissingAssistantDiagnostics(() => { throw new Error('storage denied'); }, sink);
    expect(() => invalid.record('renderer-received', 'target', event)).not.toThrow(); expect(invalid.enabled('target')).toBe(false);
    expect(sink).not.toHaveBeenCalled();
  });
  it('relays only target worker metadata, rebuilds whitelisted fields, bounds stdout and quota', () => {
    const sink = vi.fn(); const diagnostic = createMissingAssistantDiagnostics(() => 'target', sink);
    const entry = { stage: 'worker-emitted', sessionId: 'target', eventType: 'chat-message-end', role: 'assistant', blockTypes: ['text', 'private'], marker: true, raw: 'secret' };
    const line = missingAssistantDiagnosticPrefix + JSON.stringify(entry) + '\n';
    diagnostic.relay('other', line); diagnostic.relay('target', 'unrelated private stdout\n');
    diagnostic.relay('target', missingAssistantDiagnosticPrefix + '{bad}\n');
    diagnostic.relay('target', 'x'.repeat(16_385));
    diagnostic.relay('target', line.slice(0, 10)); diagnostic.relay('target', line.slice(10));
    expect(sink).toHaveBeenCalledTimes(1);
    expect(decode(sink.mock.calls[0][0])).toEqual({ stage: 'worker-emitted', sessionId: 'target', eventType: 'chat-message-end', role: 'assistant', blockTypes: ['text'], marker: true });
    diagnostic.relay('target', line.replace('worker-emitted', 'main-forwarded'));
    diagnostic.relay('target', line.replace('"target"', '"other"'));
    for (let i = 0; i < 110; i++) diagnostic.relay('target', line);
    diagnostic.record('main-forwarded', 'target', event);
    expect(sink).toHaveBeenCalledTimes(100);
  });
});

describe('next-chat diagnostic binding never changes Session ownership', () => {
  const env = { PATH: '/fake/bin', KEEP: 'unchanged', PUA_MISSING_ASSISTANT_DIAGNOSTICS: 'next-chat', PUA_MISSING_ASSISTANT_DIAGNOSTIC_SESSION: 'stale' };
  it('is disabled by default; removes controls without mutating other environment entries', () => {
    const session = new MissingAssistantDiagnosticSession(undefined, vi.fn()); session.register('a', 'chat');
    expect(session.workerEnvironment(env, 'a')).toEqual({ PATH: '/fake/bin', KEEP: 'unchanged' });
    expect(withoutMissingAssistantDiagnostics(env)).toEqual({ PATH: '/fake/bin', KEEP: 'unchanged' });
    expect(env.PUA_MISSING_ASSISTANT_DIAGNOSTICS).toBe('next-chat');
  });
  it('does not bind terminal, binds exactly the first registered chat, never rebinds after failure', () => {
    const sink = vi.fn(); const session = new MissingAssistantDiagnosticSession('next-chat', sink);
    session.register('terminal', 'terminal'); expect(session.workerEnvironment(env, 'terminal')).toEqual({ PATH: '/fake/bin', KEEP: 'unchanged' });
    session.register('a', 'chat'); session.register('b', 'chat');
    expect(session.workerEnvironment(env, 'a')).toEqual({ PATH: '/fake/bin', KEEP: 'unchanged', PUA_MISSING_ASSISTANT_DIAGNOSTIC_SESSION: 'a' });
    expect(session.workerEnvironment(env, 'b')).toEqual({ PATH: '/fake/bin', KEEP: 'unchanged' });
    // There is deliberately no reset/forget/close/failure hook on this diagnostic latch.
    session.register('after-failed-a', 'chat');
    expect(session.workerEnvironment(env, 'after-failed-a')).toEqual({ PATH: '/fake/bin', KEEP: 'unchanged' });
    session.output.record('main-forwarded', 'b', event); session.output.record('main-forwarded', 'a', event);
    expect(sink).toHaveBeenCalledTimes(1);
  });
});
