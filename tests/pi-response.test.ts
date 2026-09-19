import { describe, expect, it } from 'vitest';
import { parsePiResponse } from '../src/platform/pi/rpc/pi-response';

describe('Pi capability response validation', () => {
  it.each(['get_tree', 'get_fork_messages', 'get_session_stats'] as const)('accepts structured %s data', command => {
    expect(parsePiResponse(command, { type: 'response', command, success: true, data: {} })).toEqual({});
  });
  it('validates available model identities before exposing them', () => {
    expect(parsePiResponse('get_available_models', { type: 'response', command: 'get_available_models', success: true, data: { models: [{ provider: 'openai', id: 'gpt', name: 'GPT' }] } })).toEqual({ models: [{ provider: 'openai', id: 'gpt', name: 'GPT' }] });
    expect(() => parsePiResponse('get_available_models', { type: 'response', command: 'get_available_models', success: true, data: { models: [{ provider: 'openai' }] } })).toThrow(/protocol error/);
  });

  it('accepts the documented structured fork and export results', () => {
    expect(parsePiResponse('fork', { type: 'response', command: 'fork', success: true, data: { text: 'prompt', cancelled: false } })).toEqual({ text: 'prompt', cancelled: false });
    expect(parsePiResponse('export_html', { type: 'response', command: 'export_html', success: true, data: { path: '/tmp/session.html' } })).toEqual({ path: '/tmp/session.html' });
  });

  it.each(['set_steering_mode', 'set_follow_up_mode', 'abort_retry', 'abort_bash'] as const)('accepts successful %s acknowledgements without assuming response data', command => {
    expect(parsePiResponse(command, { type: 'response', command, success: true })).toBeUndefined();
  });

  it('fails closed on wrong command, malformed success, and malformed query data', () => {
    expect(() => parsePiResponse('get_tree', { type: 'response', command: 'get_state', success: true, data: {} })).toThrow(/protocol error/);
    expect(() => parsePiResponse('get_tree', { type: 'response', command: 'get_tree', success: true, data: null })).toThrow(/protocol error/);
    expect(() => parsePiResponse('fork', { type: 'response', command: 'fork', success: false, data: null })).toThrow(/protocol error/);
    expect(() => parsePiResponse('fork', { type: 'response', command: 'fork', success: true, data: null })).toThrow(/protocol error/);
    expect(() => parsePiResponse('set_steering_mode', { type: 'response', command: 'set_follow_up_mode', success: true })).toThrow(/protocol error/);
  });
});
