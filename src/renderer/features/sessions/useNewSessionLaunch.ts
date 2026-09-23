import { desktopClient } from '../../app/desktop-client';
import { useEffect, useState } from 'react';
import type { ProjectTrust, SessionKind } from '../../../shared/ipc/conversation';

export interface SessionLaunchOptions {
  initialKind?: SessionKind;
  /** Fixes entry-specific launchers (for example Pi TUI fallback) to one session kind. */
  fixedKind?: SessionKind;
  initialMode?: 'new' | 'continue';
  initialPath: string;
  onCreate(cwd: string, kind: SessionKind, mode: 'new' | 'continue' | 'resume', trust: ProjectTrust): Promise<void>;
}

/** Mount-local form state; Pi retains its saved/default project-resource policy. */
export function useNewSessionLaunch({ initialKind = 'chat', fixedKind, initialMode = 'new', initialPath, onCreate }: SessionLaunchOptions) {
  const [cwd, setCwd] = useState(initialPath);
  const [selectedKind, setSelectedKind] = useState<SessionKind>(fixedKind ?? initialKind);
  const kind = fixedKind ?? selectedKind;
  const setKind = (next: SessionKind) => { if (!fixedKind) setSelectedKind(next); };
  const [mode, setMode] = useState<'new' | 'continue' | 'resume'>(initialMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { if (kind === 'chat' && mode === 'resume') setMode('new'); }, [kind]);

  const submit = () => {
    if (busy || !cwd.trim()) return;
    setBusy(true);
    void onCreate(cwd, fixedKind ?? kind, mode, 'default').catch(error => { setError(String(error)); setBusy(false); });
  };
  const chooseDirectory = () => void desktopClient.chooseDirectory().then(value => { if (value) setCwd(value); }).catch(error => setError(String(error)));

  return { cwd, setCwd, kind, setKind, mode, setMode, busy, error, submit, chooseDirectory };
}
