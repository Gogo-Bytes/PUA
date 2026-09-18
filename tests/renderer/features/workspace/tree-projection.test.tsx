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

it('projects inactive Pi events into attention state and clears it when selected', () => {
  let emit: (event: SessionEvent) => void = () => {};
  const desktop = {
    onSessionEvent: (listener: typeof emit) => { emit = listener; return () => {}; },
    closeSession: vi.fn(async () => true),
  };
  const { result } = renderHook(() => useWorkspace(desktop, { onClosed: vi.fn(), onError: vi.fn() }));
  const session = (id: string): SessionInfo => ({ id, cwd: '/project', title: `任务 ${id}`, kind: 'chat', processStatus: 'running', activity: 'idle' });
  act(() => { result.current.addCreatedSession(session('a')); result.current.addCreatedSession(session('b')); });
  act(() => emit({ type: 'chat-state', id: 'a', state: { activity: 'responding' } }));
  act(() => emit({ type: 'chat-state', id: 'a', state: { activity: 'idle' } }));
  expect(result.current.sessions.find(item => item.id === 'a')?.needsAttention).toBe(true);
  expect(result.current.attentionEvents).toHaveLength(1);
  expect(result.current.attentionEvents[0]).toMatchObject({ sessionId: 'a', kind: 'completed', message: '任务已完成' });
  act(() => result.current.selectSession('a'));
  expect(result.current.sessions.find(item => item.id === 'a')?.needsAttention).toBe(false);
  expect(result.current.attentionEvents).toHaveLength(0);
});

it('does not duplicate foreground notices, but queues inactive input requests and errors', () => {
  let emit: (event: SessionEvent) => void = () => {};
  const desktop = {
    onSessionEvent: (listener: typeof emit) => { emit = listener; return () => {}; },
    closeSession: vi.fn(async () => true),
  };
  const { result } = renderHook(() => useWorkspace(desktop, { onClosed: vi.fn(), onError: vi.fn() }));
  const session = (id: string): SessionInfo => ({ id, cwd: '/project', title: id, kind: 'chat', processStatus: 'running', activity: 'idle' });
  act(() => { result.current.addCreatedSession(session('a')); result.current.addCreatedSession(session('b')); result.current.selectSession('a'); });
  act(() => emit({ type: 'chat-notice', id: 'a', level: 'error', message: '当前错误' }));
  expect(result.current.attentionEvents).toHaveLength(0);
  act(() => emit({ type: 'extension-ui', id: 'b', request: { id: 'request-1', method: 'confirm', title: '需要确认', message: '继续吗？' } }));
  act(() => emit({ type: 'chat-notice', id: 'b', level: 'error', message: '后台错误' }));
  expect(result.current.attentionEvents).toHaveLength(2);
  expect(result.current.sessions.find(item => item.id === 'b')?.attentionKind).toBe('notice');
  const waitingId = result.current.attentionEvents[0].id;
  act(() => result.current.dismissAttention(waitingId));
  expect(result.current.sessions.find(item => item.id === 'b')?.needsAttention).toBe(true);
  act(() => result.current.dismissAttention(result.current.attentionEvents[0].id));
  expect(result.current.sessions.find(item => item.id === 'b')?.needsAttention).toBe(false);
});
