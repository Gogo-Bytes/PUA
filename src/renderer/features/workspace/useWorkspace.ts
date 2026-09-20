import { useEffect, useRef, useState } from 'react';
import type { DesktopAPI, HistorySearchResult, SessionInfo } from '../../../shared/ipc/desktop-api';
import type { ChatTreeNode } from '../../../shared/ipc/conversation';
import { addSession, prepareConversation, removeSession, selectProject, selectSession, type SessionWorkspace } from './selection';

/** History nodes belong to one managed session; they are not independently running sessions. */
export interface WorkspaceSessionInfo extends SessionInfo {
  sessionTree?: ChatTreeNode[];
  /** Window-local attention projection; Pi remains the source of truth for runtime state. */
  needsAttention?: boolean;
  attentionKind?: WorkspaceAttentionKind;
}

export type WorkspaceAttentionKind = 'waiting-input' | 'notice' | 'exit' | 'completed';
export interface WorkspaceAttentionEvent {
  id: string;
  sessionId: string;
  title: string;
  kind: WorkspaceAttentionKind;
  tone: 'info' | 'warning' | 'error';
  message: string;
}

interface WorkspaceLocation { project?: string; activeId: string | null }

/** Window-local projection and selection owner; the host still owns Session lifecycle. */
export function useWorkspace(
  desktop: Pick<DesktopAPI, 'onSessionEvent' | 'closeSession'> & Partial<Pick<DesktopAPI, 'setSessionPinned' | 'restoreArchivedSession'>> | undefined,
  { onClosed, onError }: { onClosed(id: string): void; onError(message: string): void },
) {
  const [state, setState] = useState<SessionWorkspace<WorkspaceSessionInfo>>({ sessions: [], activeId: null });
  const [attentionEvents, setAttentionEvents] = useState<WorkspaceAttentionEvent[]>([]);
  const [historyTarget, setHistoryTarget] = useState<{ sessionId: string; entryId: string; query: string }>();
  const activeIdRef = useRef<string | null>(null);
  const sessionsRef = useRef<WorkspaceSessionInfo[]>([]);
  const attentionSequence = useRef(0);
  const history = useRef<WorkspaceLocation[]>([]);
  const historyIndex = useRef(-1);
  activeIdRef.current = state.activeId;
  sessionsRef.current = state.sessions;
  const updateSessions = (update: (sessions: WorkspaceSessionInfo[]) => WorkspaceSessionInfo[]) =>
    setState(current => {
      const sessions = update(current.sessions);
      sessionsRef.current = sessions;
      return { ...current, sessions };
    });
  const queueAttention = (sessionId: string, kind: WorkspaceAttentionKind, tone: WorkspaceAttentionEvent['tone'], message: string) => {
    if (activeIdRef.current === sessionId) return;
    const session = sessionsRef.current.find(item => item.id === sessionId);
    if (!session) return;
    const event = { id: `attention-${attentionSequence.current++}`, sessionId, title: session.title, kind, tone, message } satisfies WorkspaceAttentionEvent;
    updateSessions(sessions => sessions.map(item => item.id === sessionId ? { ...item, needsAttention: true, attentionKind: kind } : item));
    setAttentionEvents(current => [...current, event].slice(-12));
  };
  const locationKey = (location: WorkspaceLocation) => `${location.project ?? ''}\u0000${location.activeId ?? ''}`;
  const recordLocation = (location: WorkspaceLocation) => {
    const current = history.current[historyIndex.current];
    if (current && locationKey(current) === locationKey(location)) return;
    history.current = history.current.slice(0, historyIndex.current + 1);
    history.current.push(location);
    historyIndex.current = history.current.length - 1;
  };
  const applyLocation = (location: WorkspaceLocation) => {
    activeIdRef.current = location.activeId;
    setState(current => {
      if (location.activeId && current.sessions.some(session => session.id === location.activeId)) {
        const next = selectSession(current, location.activeId);
        return { ...next, sessions: next.sessions.map(session => session.id === location.activeId ? { ...session, needsAttention: false, attentionKind: undefined } : session) };
      }
      return location.project ? prepareConversation(current, location.project) : { ...current, project: undefined, activeId: null };
    });
    if (location.activeId) setAttentionEvents(current => current.filter(event => event.sessionId !== location.activeId));
  };
  const markSessionExited = (id: string, exitCode: number) => {
    const previous = sessionsRef.current.find(session => session.id === id);
    updateSessions(sessions => sessions.map(session =>
      session.id === id ? { ...session, processStatus: 'exited', activity: 'idle', exitCode } : session));
    if (previous && activeIdRef.current !== id) queueAttention(id, 'exit', exitCode === 0 ? 'info' : 'error', exitCode === 0 ? '任务已结束' : `任务异常退出（${exitCode}）`);
  };

  useEffect(() => desktop?.onSessionEvent(event => {
    if (event.type === 'chat-fork-metadata') updateSessions(sessions => sessions.map(session =>
      session.id === event.id && session.kind === 'chat' ? { ...session, sessionTree: event.sessionTree } : session));
    if (event.type === 'chat-snapshot') {
      const previous = sessionsRef.current.find(session => session.id === event.id);
      updateSessions(sessions => sessions.map(session => session.id === event.id && session.kind === 'chat'
        ? { ...session, activity: event.snapshot.activity, sessionTree: event.snapshot.sessionTree ?? session.sessionTree } : session));
      if (previous && previous.activity !== 'idle' && event.snapshot.activity === 'idle') queueAttention(event.id, 'completed', 'info', '任务已完成');
    }
    if (event.type === 'session-info') {
      const previous = sessionsRef.current.find(session => session.id === event.id);
      updateSessions(sessions => sessions.map(session => session.id === event.id
        ? { ...session, title: event.title ?? session.title, processStatus: event.processStatus ?? session.processStatus, activity: event.activity ?? session.activity, lastActivityAt: event.lastActivityAt ?? session.lastActivityAt } : session));
      if (previous && previous.activity !== 'idle' && event.activity === 'idle') queueAttention(event.id, 'completed', 'info', '任务已完成');
      if (event.processStatus === 'exited' && previous?.processStatus !== 'exited') markSessionExited(event.id, previous?.exitCode ?? 0);
    }
    if (event.type === 'chat-state' && event.state.activity) {
      const previous = sessionsRef.current.find(session => session.id === event.id);
      updateSessions(sessions => sessions.map(session => session.id === event.id ? { ...session, activity: event.state.activity! } : session));
      if (previous && previous.activity !== 'idle' && event.state.activity === 'idle') queueAttention(event.id, 'completed', 'info', '任务已完成');
    }
    if (event.type === 'chat-notice') queueAttention(event.id, 'notice', event.level, event.message);
    if (event.type === 'extension-ui') queueAttention(event.id, 'waiting-input', 'warning', `任务需要输入：${event.request.title}`);
    if (event.type === 'exit') markSessionExited(event.id, event.exitCode);
  }), []);

  const closeSession = async (id: string) => {
    try {
      if (!await desktop!.closeSession(id)) return;
      // Reconcile against latest selection, then clear presentation data in this same continuation.
      setState(current => removeSession(current, id));
      setAttentionEvents(current => current.filter(event => event.sessionId !== id));
      onClosed(id);
    } catch (error) { onError(String(error)); }
  };
  const setSessionPinned = async (id: string, pinned: boolean) => {
    try {
      if (desktop?.setSessionPinned) await desktop.setSessionPinned(id, pinned);
      updateSessions(sessions => sessions.map(session => session.id === id ? { ...session, pinned } : session));
    } catch (error) { onError(String(error)); }
  };
  const { sessions, activeId } = state;
  const active = sessions.find(session => session.id === activeId);
  const project = state.project ?? active?.cwd;
  const selectWorkspaceSession = (id: string) => {
    const session = state.sessions.find(item => item.id === id);
    if (!session) return;
    recordLocation({ project: session.cwd, activeId: id });
    activeIdRef.current = id;
    setState(current => {
      const next = selectSession(current, id);
      return { ...next, sessions: next.sessions.map(session => session.id === id ? { ...session, needsAttention: false, attentionKind: undefined } : session) };
    });
    setAttentionEvents(current => current.filter(event => event.sessionId !== id));
    setHistoryTarget(undefined);
  };
  const prepareWorkspaceConversation = (cwd: string) => {
    recordLocation({ project: cwd, activeId: null });
    activeIdRef.current = null;
    setState(current => prepareConversation(current, cwd));
    setHistoryTarget(undefined);
  };
  const selectWorkspaceProject = (cwd: string) => {
    const next = selectProject(state, cwd);
    recordLocation({ project: cwd, activeId: next.activeId });
    activeIdRef.current = next.activeId;
    setState(current => selectProject(current, cwd));
    setHistoryTarget(undefined);
  };
  const openHistoryResult = async (result: HistorySearchResult) => {
    try {
      if (result.archived) {
        if (!desktop?.restoreArchivedSession) throw new Error('归档会话恢复不可用');
        const restored = await desktop.restoreArchivedSession(result.taskId);
        recordLocation({ project: restored.cwd, activeId: restored.id });
        activeIdRef.current = restored.id;
        setState(current => selectSession(addSession(current, restored), restored.id));
      } else {
        selectWorkspaceSession(result.taskId);
      }
      setHistoryTarget({ sessionId: result.taskId, entryId: result.entryId, query: result.query });
    } catch (error) { onError(String(error)); }
  };
  const navigateHistory = (direction: -1 | 1) => {
    const next = historyIndex.current + direction;
    if (next < 0 || next >= history.current.length) return;
    historyIndex.current = next;
    applyLocation(history.current[next]);
  };
  const dismissAttention = (id: string) => {
    const dismissed = attentionEvents.find(event => event.id === id);
    if (!dismissed) return;
    const remainingForSession = attentionEvents.some(event => event.id !== id && event.sessionId === dismissed.sessionId);
    setAttentionEvents(current => current.filter(event => event.id !== id));
    if (!remainingForSession) updateSessions(sessions => sessions.map(session => session.id === dismissed.sessionId ? { ...session, needsAttention: false, attentionKind: undefined } : session));
  };
  return {
    sessions, activeId, active, project,
    projectSessions: sessions.filter(session => session.cwd === project),
    attentionEvents,
    canNavigateBack: historyIndex.current > 0,
    canNavigateForward: historyIndex.current >= 0 && historyIndex.current < history.current.length - 1,
    navigateBack: () => navigateHistory(-1),
    navigateForward: () => navigateHistory(1),
    selectSession: selectWorkspaceSession,
    historyTarget,
    openHistoryResult,
    dismissAttention,
    prepareConversation: prepareWorkspaceConversation,
    hydrateSessions: (incoming: SessionInfo[], preferredProject?: string) => setState(current => {
      const byId = new Map(current.sessions.map(session => [session.id, session]));
      for (const session of incoming) byId.set(session.id, { ...byId.get(session.id), ...session });
      const next = { ...current, sessions: [...byId.values()] };
      return current.project || current.activeId || !preferredProject ? next : prepareConversation(next, preferredProject);
    }),
    selectProject: selectWorkspaceProject,
    addCreatedSession: (session: SessionInfo) => setState(current => addSession(current, session)),
    setSessionTitle: (id: string, title: string) => updateSessions(sessions => sessions.map(session => session.id === id ? { ...session, title } : session)),
    setSessionPinned,
    markSessionExited,
    closeSession,
  } as const;
}
