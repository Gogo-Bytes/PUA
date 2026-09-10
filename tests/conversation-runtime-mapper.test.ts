import { describe, expect, it } from 'vitest';
import { RuntimeFailure, type RuntimeFailureCode } from '../src/modules/conversation/index';
import { dialogDTO, normalizeDialog, normalizeQueue, normalizeRuntimeSeed, queueDTO, runtimeChangeDTO, runtimeError, runtimeViewDTO } from '../src/main/conversation-runtime-mapper';

describe('Conversation runtime wire normalization and detached DTO mapping (no transport)', () => {
  it.each([undefined, null, false, 'bad', { steering: false, followUp: 1 }])('normalizes malformed queue %j without cached queue substitution', raw => {
    expect(normalizeQueue(raw)).toEqual({ steering: [], followUp: [] });
  });
  it('filters strings and copies outgoing queues', () => {
    const queue = normalizeQueue({ steering: ['a', 1, null], followUp: [{}, 'b'] });
    const dto = queueDTO(queue); dto.steering.push('mutated');
    expect(queue).toEqual({ steering: ['a'], followUp: ['b'] });
  });
  it.each([undefined, 0, -1, NaN, Infinity, -Infinity])('keeps timeout %s untimed', timeout => {
    expect(normalizeDialog({ id: 'd', method: 'input', title: 'D', timeout }, 1000)?.expiresAt).toBeUndefined();
  });
  it('clamps only finite positive timeouts and filters select options at the edge', () => {
    expect(normalizeDialog({ id: 'd', method: 'select', title: 'D', options: ['yes', 1], timeout: 100 }, 1000)).toEqual({ id: 'd', title: 'D', kind: 'select', options: ['yes'], expiresAt: 1100 });
    expect(normalizeDialog({ id: 'd', method: 'input', title: 'D', timeout: Number.MAX_VALUE }, 1000)?.expiresAt).toBe(1000 + 2147483647);
  });
  it.each([
    { id: 4, method: 'input', title: 'D' }, { id: 'd', method: 'input', title: 4 },
    { id: 'd', method: 'select', title: 'D', options: false },
    { id: 'd', method: 'confirm', title: 'D', message: false },
    { id: 'd', method: 'custom', title: 'D' },
  ])('rejects malformed/non-native dialog %j', value => { expect(normalizeDialog(value, 1000)).toBeUndefined(); });
  it('maps all dialog kinds without leaking raw input fields or sharing arrays', () => {
    for (const method of ['select', 'confirm', 'input', 'editor']) {
      const dialog = normalizeDialog({ id: 'd', method, title: 'D', options: ['yes'], message: '?', placeholder: 1, prefill: 'text', type: 'extension_ui_request', secret: 'ignored' }, 1000)!;
      const dto = dialogDTO(dialog);
      expect(dto.method).toBe(method); expect(dto).not.toHaveProperty('kind'); expect(dto).not.toHaveProperty('secret');
      if (dto.method === 'select' && dialog.kind === 'select') { dto.options.push('mutation'); expect(dialog.options).toEqual(['yes']); }
      if (dto.method === 'input') expect(dto.placeholder).toBeUndefined();
      if (dto.method === 'editor') expect(dto.prefill).toBe('text');
    }
  });
  it('normalizes handshake priority and maps partial notifications without extra state fields', () => {
    expect(normalizeRuntimeSeed({ isCompacting: true, isStreaming: true, model: { provider: 'p', id: 'm', secret: 1 }, thinkingLevel: 'high' })).toEqual({ activity: 'compacting', model: { provider: 'p', id: 'm' }, thinkingLevel: 'high' });
    expect(normalizeRuntimeSeed({ model: { provider: 'p', id: 4 }, thinkingLevel: false })).toEqual({ activity: 'idle', model: undefined, thinkingLevel: undefined });
    expect(runtimeChangeDTO({ activity: 'retrying' })).toEqual({ activity: 'retrying' });
    const view = { activity: 'idle' as const, queue: { steering: ['a'], followUp: [] }, statuses: { s: 'S' }, widgets: [{ key: 'w', lines: ['W'], placement: 'aboveEditor' as const }], model: { provider: 'p', id: 'm' } };
    const dto = runtimeViewDTO(view); dto.queue.steering.push('x'); dto.statuses.s = 'changed'; dto.widgets[0].lines.push('x'); dto.model!.id = 'changed';
    expect(view).toMatchObject({ queue: { steering: ['a'] }, statuses: { s: 'S' }, widgets: [{ lines: ['W'] }], model: { id: 'm' } });
  });
  it.each([
    ['INVALIDATED', 'Pi session closing; acceptance unknown'], ['DUPLICATE_DIALOG', 'Duplicate extension dialog id'],
    ['TOO_MANY_DIALOGS', 'Too many pending extension dialogs'], ['DIALOG_ENDED', '扩展对话已结束'],
    ['ANSWER_TYPE', '扩展响应类型不匹配'], ['INVALID_OPTION', '无效选项'],
  ] satisfies Array<[RuntimeFailureCode, string]>)('maps %s at the edge using the existing error spelling', (code, message) => {
    expect(String(runtimeError(new RuntimeFailure(code)))).toBe(`Error: ${message}`);
  });
  it('does not alter transport errors', () => { const error = new Error('wire failure'); expect(runtimeError(error)).toBe(error); });
});
