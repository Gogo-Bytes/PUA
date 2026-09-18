import { useEffect, useState } from 'react';
import type { DesktopAPI, SessionInfo } from '../../../shared/ipc/desktop-api';
import type { ChatTreeNode } from '../../../shared/ipc/conversation';
import { addSession, prepareConversation, removeSession, selectProject, selectSession, type SessionWorkspace } from './selection';

/** History nodes belong to one managed session; they are not independently running sessions. */
export interface WorkspaceSessionInfo extends SessionInfo {
  sessionTree?: ChatTreeNode[];
}

/** Window-local projection and selection owner; the host still owns Session lifecycle. */
export function useWorkspace(
  desktop: Pick<DesktopAPI, 'onSessionEvent' | 'closeSession'> & Partial<Pick<DesktopAPI, 'setSessionPinned'>> | undefined,
  { onClosed, onError }: { onClosed(id: string): void; onError(message: string): void },
) {
  const [state, setState] = useState<SessionWorkspace<WorkspaceSessionInfo>>({ sessions: [], activeId: null });
  const updateSessions = (update: (sessions: WorkspaceSessionInfo[]) => WorkspaceSessionInfo[]) =>
    setState(current => ({ ...current, sessions: update(current.sessions) }));
  const markSessionExited = (id: string, exitCode: number) => updateSessions(sessions => sessions.map(session =>
    session.id === id ? { ...session, processStatus: 'exited', activity: 'idle', exitCode } : session));

  useEffect(() => desktop?.onSessionEvent(event => {
    if (event.type === 'chat-fork-metadata') updateSessions(sessions => sessions.map(session =>
      session.id === event.id && session.kind === 'chat' ? { ...session, sessionTree: event.sessionTree } : session));
    if (event.type === 'chat-snapshot') updateSessions(sessions => sessions.map(session =>
      session.id === event.id && session.kind === 'chat'
        ? { ...session, activity: event.snapshot.activity, sessionTree: event.snapshot.sessionTree ?? session.sessionTree }
        : session));
    if (event.type === 'session-info') updateSessions(sessions => sessions.map(session => session.id === event.id
      ? { ...session, title: event.title ?? session.title, processStatus: event.processStatus ?? session.processStatus, activity: event.activity ?? session.activity } : session));
    if (event.type === 'chat-state' && event.state.activity) updateSessions(sessions => sessions.map(session =>
      session.id === event.id ? { ...session, activity: event.state.activity! } : session));
    if (event.type === 'exit') markSessionExited(event.id, event.exitCode);
  }), []);

  const closeSession = async (id: string) => {
    try {
      if (!await desktop!.closeSession(id)) return;
      // Reconcile against latest selection, then clear presentation data in this same continuation.
      setState(current => removeSession(current, id));
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
  return {
    sessions, activeId, active, project,
    projectSessions: sessions.filter(session => session.cwd === project),
    selectSession: (id: string) => setState(current => selectSession(current, id)),
    prepareConversation: (cwd: string) => setState(current => prepareConversation(current, cwd)),
    hydrateSessions: (incoming: SessionInfo[], preferredProject?: string) => setState(current => {
      const byId = new Map(current.sessions.map(session => [session.id, session]));
      for (const session of incoming) byId.set(session.id, { ...byId.get(session.id), ...session });
      const next = { ...current, sessions: [...byId.values()] };
      return current.project || current.activeId || !preferredProject ? next : prepareConversation(next, preferredProject);
    }),
    selectProject: (cwd: string) => setState(current => selectProject(current, cwd)),
    addCreatedSession: (session: SessionInfo) => setState(current => addSession(current, session)),
    setSessionTitle: (id: string, title: string) => updateSessions(sessions => sessions.map(session => session.id === id ? { ...session, title } : session)),
    setSessionPinned,
    markSessionExited,
    closeSession,
  } as const;
}
