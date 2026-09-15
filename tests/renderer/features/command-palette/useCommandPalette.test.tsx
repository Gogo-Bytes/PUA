/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useCommandPalette } from '../../../../src/renderer/features/command-palette';
import type { ChatCommand } from '../../../../src/shared/ipc/conversation';
afterEach(cleanup);
describe('useCommandPalette public state actions', () => {
  it('keeps shortcut and registration actions stable, same-array no-op and per-session cache at App lifetime', () => {
    const active = { id: 'a', kind: 'chat' as const };
    const { result, rerender } = renderHook(({ active }) => useCommandPalette(active), { initialProps: { active: active as typeof active | undefined } });
    const { toggle, onCommands, dismissAfterInsert } = result.current;
    const commands: ChatCommand[] = [{ name: 'a', source: 'extension' }];
    act(() => onCommands('a', commands));
    const before = result.current;
    act(() => onCommands('a', commands)); expect(result.current).toBe(before);
    act(() => { result.current.openFromSidebar(); result.current.setQuery('a'); });
    rerender({ active: undefined }); expect(result.current.isOpen).toBe(true); expect(result.current.query).toBe('a');
    act(toggle); expect(result.current.isOpen).toBe(false); expect(result.current.query).toBe('a');
    rerender({ active }); expect(result.current.commands.find(command => command.name === 'a')?.name).toBe('a');
    expect(result.current.toggle).toBe(toggle); expect(result.current.onCommands).toBe(onCommands); expect(result.current.dismissAfterInsert).toBe(dismissAfterInsert);
    act(dismissAfterInsert); expect(result.current.isOpen).toBe(false); expect(result.current.query).toBe('');
  });
});
