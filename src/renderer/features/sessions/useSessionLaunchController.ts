import { useRef, useState } from 'react';
import type { Bootstrap, SessionInfo } from '../../../shared/ipc/desktop-api';
import type { ProjectTrust, SessionKind } from '../../../shared/ipc/conversation';
import { desktopClient } from '../../app/desktop-client';

type LaunchContext = { cwd: string; kind: SessionKind; mode: 'new' | 'continue' };
interface SessionLaunchControllerOptions {
  boot: Bootstrap | null;
  project: string | undefined;
  onCreated(session: SessionInfo): void;
  afterCreated(): void;
  onSettings(): void;
  onError(message: string): void;
}

/** Window launch context/continuation; the separate form owns its mount-local edits. */
export function useSessionLaunchController({ boot, project, onCreated, afterCreated, onSettings, onError }: SessionLaunchControllerOptions) {
  const [context, setContext] = useState<LaunchContext>();
  const [isOpen, setOpen] = useState(false);
  const [creatingProject, setCreatingProject] = useState<string>();
  const pending = useRef(new Set<string>());
  const open = (context?: LaunchContext) => { if (context) setContext(context); setOpen(true); };
  const close = () => { setOpen(false); setContext(undefined); };
  const create = async (cwd: string, kind: SessionKind, startMode: 'new' | 'continue' | 'resume', projectTrust: ProjectTrust) => {
    const session = await desktopClient.createSession({ cwd, kind, startMode, projectTrust, cols: 100, rows: 30 });
    // Synchronous outlets in the original host continuation; neither is awaited.
    onCreated(session); setOpen(false); setContext(undefined); afterCreated();
  };
  const createChat = async (cwd: string) => {
    const normalized = cwd.trim();
    if (!normalized || pending.current.has(normalized)) return;
    if (!boot?.runtime) { onSettings(); return; }
    pending.current.add(normalized); setCreatingProject(normalized);
    try {
      const session = await desktopClient.createSession({ cwd: normalized, kind: 'chat', startMode: 'new', projectTrust: 'default', cols: 100, rows: 30 });
      onCreated(session); afterCreated();
    } catch (error) { onError(String(error)); }
    finally { pending.current.delete(normalized); setCreatingProject(current => current === normalized ? undefined : current); }
  };
  const newConversation = async (cwd?: string) => {
    if (cwd) { await createChat(cwd); return; }
    if (!boot?.runtime) { onSettings(); return; }
    try { const selected = await desktopClient.chooseDirectory(); if (selected) await createChat(selected); }
    catch (error) { onError(String(error)); }
  };
  return {
    isOpen, open, close, create, creatingProject,
    newConversation,
    openInProject: () => void newConversation(project),
    initialPath: context?.cwd || project || boot?.preferences.recentProjects[0] || boot?.home || '',
    initialKind: context?.kind, initialMode: context?.mode,
    // The original settings jump hides launch without resetting its context.
    showSettings: () => { setOpen(false); onSettings(); },
  };
}
