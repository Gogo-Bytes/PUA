import { expect, it } from 'vitest';
import { completionToken } from '../src/renderer/features/conversation/composer-suggestions';
it('locates the complete token at the caret while preserving later text', () => {
  expect(completionToken('请 /rev 后文', 6)).toEqual({ prefix: '/', query: 'rev', start: 2, end: 6 });
  expect(completionToken('请 /review 后文', 5)).toEqual({ prefix: '/', query: 're', start: 2, end: 9 });
  expect(completionToken('使用 @REA 后文', 7)).toEqual({ prefix: '@', query: 'REA', start: 3, end: 7 });
});
it('ignores selections, embedded prefixes and completed tokens', () => {
  expect(completionToken('/rev', 0, 4)).toBeNull();
  expect(completionToken('test@example', 12)).toBeNull();
  expect(completionToken('/review ', 8)).toBeNull();
  expect(completionToken('@', 1)).toEqual({ prefix: '@', query: '', start: 0, end: 1 });
});
