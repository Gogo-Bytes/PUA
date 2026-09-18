import { describe, expect, it } from 'vitest';
import { parseSessionHistory } from '../../../src/app/main/session-history-search';

const session = { taskId: 'task-1', title: '修复登录', cwd: '/work/app', archived: false };

describe('Pi JSONL history search projection', () => {
  it('searches safe text across user, assistant and summary entries without exposing payloads', () => {
    const content = [
      JSON.stringify({ type: 'session', id: 'pi-1', cwd: '/work/app' }),
      JSON.stringify({ type: 'message', id: 'u1', parentId: null, timestamp: '2026-09-18T10:00:00.000Z', message: { role: 'user', content: '请修复登录流程' } }),
      JSON.stringify({ type: 'message', id: 'a1', parentId: 'u1', timestamp: '2026-09-18T10:00:01.000Z', message: { role: 'assistant', content: [{ type: 'text', text: '我会检查登录流程' }, { type: 'toolCall', arguments: { secret: 'never search this' } }] } }),
      JSON.stringify({ type: 'message', id: 's1', parentId: 'a1', timestamp: '2026-09-18T10:00:02.000Z', message: { role: 'compactionSummary', summary: '登录流程摘要' } }),
      '{not-json}',
    ].join('\n');
    const results = parseSessionHistory(content, session, '登录', 10);
    expect(results).toHaveLength(3);
    expect(results.map(result => result.entryId)).toEqual(['s1', 'a1', 'u1']);
    expect(results.find(result => result.entryId === 'u1')).toMatchObject({ taskId: 'task-1', cwd: '/work/app', role: 'user', archived: false, query: '登录' });
    expect(JSON.stringify(results)).not.toContain('never search this');
  });

  it('bounds results and skips malformed or non-message entries', () => {
    const content = [
      JSON.stringify({ type: 'model_change', id: 'm1', timestamp: '2026-09-18T10:00:00.000Z', modelId: '登录' }),
      ...Array.from({ length: 4 }, (_, index) => JSON.stringify({ type: 'message', id: `u${index}`, timestamp: '2026-09-18T10:00:00.000Z', message: { role: 'user', content: `登录 ${index}` } })),
    ].join('\n');
    expect(parseSessionHistory(content, { ...session, archived: true }, '登录', 2)).toHaveLength(2);
    expect(parseSessionHistory(content, session, ' ', 2)).toEqual([]);
  });

  it('keeps the newest matches when one session contains more matches than the result limit', () => {
    const content = Array.from({ length: 4 }, (_, index) => JSON.stringify({ type: 'message', id: `u${index}`, timestamp: `2026-09-18T10:0${index}:00.000Z`, message: { role: 'user', content: `登录 ${index}` } })).join('\n');
    expect(parseSessionHistory(content, session, '登录', 2).map(result => result.entryId)).toEqual(['u3', 'u2']);
  });
});
