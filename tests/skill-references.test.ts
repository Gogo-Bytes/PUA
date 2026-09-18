import { describe, expect, it } from 'vitest';
import { expandSkillReference } from '../src/renderer/features/conversation/skill-references';

const commands = [{ name: 'review-code', source: 'skill' as const }, { name: 'release', source: 'prompt' as const }];

describe('Pi skill wire references', () => {
  it('translates the selected @ skill at the beginning of a prompt', () => {
    expect(expandSkillReference('@review-code inspect the diff', commands)).toBe('/skill:review-code inspect the diff');
  });
  it('accepts Pi skill-prefixed command metadata', () => {
    expect(expandSkillReference('@review-code ', [{ name: 'skill:review-code', source: 'skill' }])).toBe('/skill:review-code ');
  });
  it('does not rewrite paths, mentions, or non-skill commands', () => {
    expect(expandSkillReference('请看 @review-code', commands)).toBe('请看 @review-code');
    expect(expandSkillReference('@release ', commands)).toBe('@release ');
    expect(expandSkillReference('@/tmp/file.ts', commands)).toBe('@/tmp/file.ts');
  });
});
