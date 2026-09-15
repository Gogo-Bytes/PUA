// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { SessionEvent } from '../../../../src/shared/ipc/conversation';
import type { SessionInfo } from '../../../../src/shared/ipc/desktop-api';
import { useWorkspace } from '../../../../src/renderer/features/workspace/useWorkspace';

afterEach(cleanup);

it('isolates tree snapshots, retains them across selection and ignores events after close', async () => {
  let emit: (event: SessionEvent) => void = () => {};
  const desktop = {
    onSessionEvent: (listener: typeof emit) => { emit = listener; return () => {}; },
    closeSession: vi.fn(async () => true),
  };
  const { result } = renderHook(() => useWorkspace(desktop, { onClosed: vi.fn(), onError: vi.fn() }));
  const session = (id: string): SessionInfo => ({ id, cwd: '/project', title: id, kind: 'chat', processStatus: 'running', activity: 'idle' });
  act(() => { result.current.addCreatedSession(session('a')); result.current.addCreatedSession(session('b')); });
  const tree = [{ entryId: 'root', children: [{ entryId: 'branch', children: [] }] }];
  const snapshot = (id: string): SessionEvent => ({ type: 'chat-snapshot', id, snapshot: {
    activity: 'idle', queue: { steering: [], followUp: [] }, statuses: {}, widgets: [], messages: [], commands: [], sessionTree: tree,
  } });
  act(() => { emit(snapshot('a')); emit(snapshot('unknown')); });
  expect(result.current.sessions.find(s => s.id === 'a')?.sessionTree).toEqual(tree);
  expect(result.current.sessions.find(s => s.id === 'b')?.sessionTree).toBeUndefined();
  expect(result.current.activeId).toBe('b');
  act(() => result.current.selectSession('a'));
  expect(result.current.active?.sessionTree).toEqual(tree);
  await act(() => result.current.closeSession('a'));
  act(() => emit(snapshot('a')));
  expect(result.current.sessions.map(s => s.id)).toEqual(['b']);
  expect(result.current.activeId).toBe('b');
});
