import { desktopClient } from '../../app/desktop-client';
import { useEffect, useState } from 'react';
import type { ProjectTrust, SessionKind } from '../../../shared/ipc/conversation';
import type { ProjectResourceInfo } from '../../../shared/ipc/desktop-api';

export interface SessionLaunchOptions {
  initialKind?: SessionKind;
  /** Fixes entry-specific launchers (for example Pi TUI fallback) to one session kind. */
  fixedKind?: SessionKind;
  initialMode?: 'new' | 'continue';
  initialPath: string;
  onCreate(cwd: string, kind: SessionKind, mode: 'new' | 'continue' | 'resume', trust: ProjectTrust): Promise<void>;
}

/** Project resource consent stays at the launch boundary; the form owns only its current draft. */
export function useNewSessionLaunch({ initialKind = 'chat', fixedKind, initialMode = 'new', initialPath, onCreate }: SessionLaunchOptions) {
  const [cwd, setCwd] = useState(initialPath);
  const [selectedKind, setSelectedKind] = useState<SessionKind>(fixedKind ?? initialKind);
  const kind = fixedKind ?? selectedKind;
  const setKind = (next: SessionKind) => { if (!fixedKind) setSelectedKind(next); };
  const [mode, setMode] = useState<'new' | 'continue' | 'resume'>(initialMode);
  const [inspection, setInspection] = useState<{ cwd: string; info: ProjectResourceInfo }>();
  const [trust, setTrust] = useState<ProjectTrust | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { if (kind === 'chat' && mode === 'resume') setMode('new'); }, [kind]);
  useEffect(() => { setInspection(undefined); setTrust(null); }, [cwd]);

  const submit = async () => {
    if (busy || !cwd.trim()) return;
    setBusy(true);
    try {
      if (kind === 'chat' && inspection?.cwd !== cwd) {
        const info = await desktopClient.inspectProjectResources(cwd);
        setInspection({ cwd, info });
        if (info.hasResources) return;
      }
      if (kind === 'chat' && inspection?.cwd === cwd && inspection.info.hasResources && trust === null) return;
      await onCreate(cwd, fixedKind ?? kind, mode, trust ?? 'default');
    } catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  };
  const chooseDirectory = () => void desktopClient.chooseDirectory().then(value => { if (value) setCwd(value); }).catch(error => setError(String(error)));

  return { cwd, setCwd, kind, setKind, mode, setMode, busy, error, submit, chooseDirectory, resources: inspection?.cwd === cwd && inspection.info.hasResources ? inspection.info : undefined, trust, setTrust };
}
