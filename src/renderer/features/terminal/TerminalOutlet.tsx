import { useEffect, useRef, type RefObject } from 'react';
import type { SessionInfo } from '../../../shared/ipc/desktop-api';
import { TerminalPane } from './TerminalPane';
import type { TerminalHandle } from './TerminalPane';
import type { ResolvedTheme } from './terminal-theme';

interface Props {
  sessions: SessionInfo[]; activeId?: string | null; platform: string; fontSize: number; theme: ResolvedTheme;
  docked: boolean; stageRef: RefObject<HTMLDivElement | null>; dockRef: RefObject<HTMLDivElement | null>;
  onReady(id: string, handle: TerminalHandle | null): void; onExit(id: string, code: number): void; onError(message: string): void;
}

/** Keeps each PTY/xterm mounted exactly once while its visual outlet changes between workspace and side tab. */
export function TerminalOutlet({ sessions, activeId, platform, fontSize, theme, docked, stageRef, dockRef, onReady, onExit, onError }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const activeTerminal = sessions.some(session => session.id === activeId && session.kind === 'terminal');
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const target = activeTerminal ? (docked ? dockRef.current : stageRef.current) : null;
    const sync = () => {
      const rect = target?.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) { host.hidden = true; return; }
      host.hidden = false;
      host.style.left = `${Math.round(rect.left)}px`;
      host.style.top = `${Math.round(rect.top)}px`;
      host.style.width = `${Math.round(rect.width)}px`;
      host.style.height = `${Math.round(rect.height)}px`;
    };
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(sync) : undefined;
    if (target) observer?.observe(target);
    const onResize = () => sync();
    window.addEventListener('resize', onResize);
    sync();
    return () => { observer?.disconnect(); window.removeEventListener('resize', onResize); host.hidden = true; };
  }, [activeTerminal, activeId, docked, stageRef, dockRef]);

  return <div className="workspace-terminal-outlet" ref={hostRef} hidden>
    {sessions.filter(session => session.kind === 'terminal').map(session => <TerminalPane key={session.id} session={session} active={session.id === activeId} fontSize={fontSize} theme={theme} platform={platform} onReady={onReady} onExit={onExit} onError={onError}/>)}
  </div>;
}
