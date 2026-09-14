import { describe, expect, it } from 'vitest';
import { parsePiResponse } from '../src/platform/pi/rpc/pi-response';

describe('Pi capability response validation', () => {
  it.each(['get_tree', 'get_fork_messages', 'get_session_stats'] as const)('accepts structured %s data', command => {
    expect(parsePiResponse(command, { type: 'response', command, success: true, data: {} })).toEqual({});
  });

  it('accepts operation acknowledgements', () => {
    expect(parsePiResponse('fork', { type: 'response', command: 'fork', success: true, data: null })).toBeNull();
    expect(parsePiResponse('export_html', { type: 'response', command: 'export_html', success: true, data: undefined })).toBeUndefined();
  });

  it('fails closed on wrong command, malformed success, and malformed query data', () => {
    expect(() => parsePiResponse('get_tree', { type: 'response', command: 'get_state', success: true, data: {} })).toThrow(/protocol error/);
    expect(() => parsePiResponse('get_tree', { type: 'response', command: 'get_tree', success: true, data: null })).toThrow(/protocol error/);
    expect(() => parsePiResponse('fork', { type: 'response', command: 'fork', success: false, data: null })).toThrow(/protocol error/);
  });
});
