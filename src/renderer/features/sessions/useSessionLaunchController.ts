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
  onPrepare(cwd: string): void;
  onError(message: string): void;
}

/** Window launch context/continuation; the separate form owns its mount-local edits. */
export function useSessionLaunchController({ boot, project, onCreated, afterCreated, onSettings, onPrepare, onError }: SessionLaunchControllerOptions) {
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
  const createChat = async (cwd: string, projectTrust: ProjectTrust = 'default'): Promise<SessionInfo> => {
    const normalized = cwd.trim();
    if (!normalized) throw new Error('项目路径不能为空');
    if (pending.current.has(normalized)) throw new Error('该项目正在启动对话');
    if (!boot?.runtime) { onSettings(); throw new Error('尚未配置 Pi'); }
    pending.current.add(normalized); setCreatingProject(normalized);
    try {
      const session = await desktopClient.createSession({ cwd: normalized, kind: 'chat', startMode: 'new', projectTrust, cols: 100, rows: 30 });
      onCreated(session); afterCreated();
      return session;
    } catch (error) { onError(String(error)); throw error; }
    finally { pending.current.delete(normalized); setCreatingProject(current => current === normalized ? undefined : current); }
  };
  const createChatAnd = (cwd: string, projectTrust: ProjectTrust, onReady: (session: SessionInfo) => void) => {
    void createChat(cwd, projectTrust).then(onReady).catch(() => undefined);
  };
  const newConversation = async (cwd?: string) => {
    if (cwd) { onPrepare(cwd); return; }
    try { const selected = await desktopClient.chooseDirectory(); if (selected) onPrepare(selected); }
    catch (error) { onError(String(error)); }
  };
  return {
    isOpen, open, close, create, creatingProject,
    newConversation,
    createChat,
    createChatAnd,
    openInProject: () => void newConversation(project),
    initialPath: context?.cwd || project || boot?.preferences.recentProjects[0] || boot?.home || '',
    initialKind: context?.kind, initialMode: context?.mode,
    // The original settings jump hides launch without resetting its context.
    showSettings: () => { setOpen(false); onSettings(); },
  };
}
