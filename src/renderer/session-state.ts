import type { SessionInfo } from '../shared/contracts';

export interface SessionWorkspace {
  sessions: SessionInfo[];
  activeId: string | null;
  project?: string;
  lastActive?: Record<string, string>;
}
export const projectName = (cwd: string) => cwd.split(/[\\/]/).filter(Boolean).at(-1) || cwd;

/** Project identity is the full cwd supplied by the host, never its display name. */
export function groupProjects(sessions: SessionInfo[], recentProjects: string[]) {
  return [...new Set([...sessions.map(session => session.cwd), ...recentProjects])].map(cwd => ({
    cwd, name: projectName(cwd), sessions: sessions.filter(session => session.cwd === cwd),
  }));
}
export function selectSession(current: SessionWorkspace, id: string): SessionWorkspace {
  const session = current.sessions.find(session => session.id === id);
  return session ? { ...current, activeId: id, project: session.cwd, lastActive: { ...current.lastActive, [session.cwd]: id } } : current;
}
export function selectProject(current: SessionWorkspace, cwd: string): SessionWorkspace {
  const sessions = current.sessions.filter(session => session.cwd === cwd);
  const id = sessions.find(session => session.id === current.lastActive?.[cwd])?.id ?? sessions[0]?.id ?? null;
  return { ...current, project: cwd, activeId: id, lastActive: id ? { ...current.lastActive, [cwd]: id } : current.lastActive };
}
export function addSession(current: SessionWorkspace, session: SessionInfo): SessionWorkspace {
  return selectSession({ ...current, sessions: [...current.sessions, session] }, session.id);
}
/** Reconcile async close against current selection; keep an empty project rather than jumping projects. */
export function removeSession(current: SessionWorkspace, id: string): SessionWorkspace {
  const closed = current.sessions.find(session => session.id === id);
  if (!closed) return current;
  const sessions = current.sessions.filter(session => session.id !== id);
  const remaining = sessions.filter(session => session.cwd === closed.cwd);
  const closedIndex = current.sessions.filter(session => session.cwd === closed.cwd).findIndex(session => session.id === id);
  const fallback = remaining[Math.max(0, closedIndex - 1)] ?? remaining[0];
  const lastActive = { ...current.lastActive };
  // Repair the closing project's memory independently of the latest global selection.
  if (lastActive[closed.cwd] === id || current.activeId === id) {
    if (fallback) lastActive[closed.cwd] = fallback.id;
    else delete lastActive[closed.cwd];
  }
  if (current.activeId !== id) return { ...current, sessions, lastActive };
  return { ...current, sessions, project: closed.cwd, activeId: fallback?.id ?? null, lastActive };
}
