import type { SessionInfo } from '../shared/contracts';

export interface SessionWorkspace { sessions: SessionInfo[]; activeId: string | null; }

/** Async close responses must reconcile against current state, not the state before the dialog. */
export function removeSession(current: SessionWorkspace, id: string): SessionWorkspace {
  const sessions = current.sessions.filter(session => session.id !== id);
  const activeId = sessions.some(session => session.id === current.activeId) ? current.activeId : sessions[0]?.id ?? null;
  return { sessions, activeId };
}
