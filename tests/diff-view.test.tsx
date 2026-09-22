/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DiffView } from '../src/renderer/ui/DiffView';

// Real parser, isolated rendering seam. Shadow DOM and Shiki are browser-tested.
vi.mock('@pierre/diffs/react', () => ({ FileDiff: ({ fileDiff }: { fileDiff: { name: string } }) => <div data-testid="parsed-diff">{fileDiff.name}</div> }));
afterEach(cleanup);
it('parses a complete patch through the lazy rendering seam', async () => {
  render(<DiffView theme="light" text={'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n'}/>);
  expect((await screen.findByTestId('parsed-diff')).textContent).toBe('a.ts');
});
it.each([
  'unrecognized <img src=x onerror=alert(1)>',
  'diff --git a/old.ts b/new.ts\nsimilarity index 100%\nrename from old.ts\nrename to new.ts\n',
  'diff --git a/a b/a\nold mode 100644\nnew mode 100755\n',
])('preserves unparseable/metadata-only content as escaped text', async text => {
  const { container } = render(<DiffView theme="dark" text={text}/>);
  await screen.findByText(/仅含文件元数据/);
  expect(container.querySelector('pre')?.textContent).toBe(text);
  expect(container.querySelector('img')).toBeNull();
});
it('caps expensive syntax rendering without dropping returned content', () => {
  const text = '+x\n'.repeat(4001);
  const { container } = render(<DiffView theme="light" text={text}/>);
  expect(screen.getByText(/大型 patch/)).toBeTruthy();
  expect(container.querySelector('pre')?.textContent).toBe(text);
});
