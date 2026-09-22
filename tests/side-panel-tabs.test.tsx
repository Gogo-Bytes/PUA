/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useSidePanelTabs } from '../src/renderer/features/workspace/useSidePanelTabs';

it('deduplicates tabs, selects an adjacent survivor, and isolates sessions and drafts', () => {
  const { result, rerender } = renderHook(({ scope }) => useSidePanelTabs(scope), { initialProps: { scope: 's1' } });
  act(() => { result.current.open('review'); result.current.open('browser'); result.current.open('review'); });
  expect(result.current.tabs).toEqual(['review', 'browser']);
  expect(result.current.active).toBe('review');
  act(() => result.current.select('files')); expect(result.current.active).toBe('review');
  rerender({ scope: 'draft:/another' }); expect(result.current.tabs).toEqual([]);
  act(() => result.current.open('files'));
  rerender({ scope: 's1' }); expect(result.current.tabs).toEqual(['review', 'browser']);
  act(() => result.current.close('review')); expect(result.current.active).toBe('browser');
  act(() => result.current.close('browser')); expect(result.current.active).toBeNull();
  expect(result.current.tabs).toEqual([]);
  rerender({ scope: 'draft:/another' }); expect(result.current.active).toBe('files');
});
