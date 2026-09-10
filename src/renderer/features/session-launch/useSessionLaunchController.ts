import { useState } from 'react';
import type { Bootstrap, SessionInfo } from '../../../shared/contracts';
import type { ProjectTrust, SessionKind } from '../../../shared/chat';
import { desktopClient } from '../../app/desktop-client';

type LaunchContext = { cwd: string; kind: SessionKind; mode: 'new' | 'continue' };
interface SessionLaunchControllerOptions {
  boot: Bootstrap | null;
  project: string | undefined;
  onCreated(session: SessionInfo): void;
  afterCreated(): void;
  onSettings(): void;
}

/** Window launch context/continuation; the separate form owns its mount-local edits. */
export function useSessionLaunchController({ boot, project, onCreated, afterCreated, onSettings }: SessionLaunchControllerOptions) {
  const [context, setContext] = useState<LaunchContext>();
  const [isOpen, setOpen] = useState(false);
  const open = (context?: LaunchContext) => { if (context) setContext(context); setOpen(true); };
  const close = () => { setOpen(false); setContext(undefined); };
  const create = async (cwd: string, kind: SessionKind, startMode: 'new' | 'continue' | 'resume', projectTrust: ProjectTrust) => {
    const session = await desktopClient.createSession({ cwd, kind, startMode, projectTrust, cols: 100, rows: 30 });
    // Synchronous outlets in the original host continuation; neither is awaited.
    onCreated(session); setOpen(false); setContext(undefined); afterCreated();
  };
  return {
    isOpen, open, close, create,
    openInProject: () => open(project ? { cwd: project, kind: 'chat', mode: 'new' } : undefined),
    initialPath: context?.cwd || project || boot?.preferences.recentProjects[0] || boot?.home || '',
    initialKind: context?.kind, initialMode: context?.mode,
    // The original settings jump hides launch without resetting its context.
    showSettings: () => { setOpen(false); onSettings(); },
  };
}
