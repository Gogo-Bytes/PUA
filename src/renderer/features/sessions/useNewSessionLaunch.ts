import { desktopClient } from '../../app/desktop-client';
import { useEffect, useState } from 'react';
import type { ProjectTrust, SessionKind } from '../../../shared/ipc/conversation';

export interface SessionLaunchOptions {
  initialKind?: SessionKind;
  initialMode?: 'new' | 'continue';
  initialPath: string;
  onCreate(cwd: string, kind: SessionKind, mode: 'new' | 'continue' | 'resume', trust: ProjectTrust): Promise<void>;
}

/** Mount-local form state and advisory inspection; the host remains Session/trust authority. */
export function useNewSessionLaunch({ initialKind = 'chat', initialMode = 'new', initialPath, onCreate }: SessionLaunchOptions) {
  const [cwd, setCwd] = useState(initialPath);
  const [kind, setKind] = useState<SessionKind>(initialKind);
  const [mode, setMode] = useState<'new' | 'continue' | 'resume'>(initialMode);
  const [trust, setTrust] = useState<ProjectTrust>('default');
  const [inspection, setInspection] = useState<{ cwd: string; paths: string[]; error?: string }>();
  const resources = inspection?.cwd === cwd ? inspection.paths : [];
  const inspecting = inspection?.cwd !== cwd;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let current = true; setTrust('default');
    const timer = setTimeout(() => {
      if (cwd.trim()) void desktopClient.inspectProjectResources(cwd).then(value => { if (current) setInspection({ cwd, paths: value.paths }); }).catch(error => { if (current) setInspection({ cwd, paths: [], error: String(error) }); });
    }, 250);
    return () => { current = false; clearTimeout(timer); };
  }, [cwd]);
  useEffect(() => { if (kind === 'chat' && mode === 'resume') setMode('new'); }, [kind]);

  const submit = () => {
    if (busy || (kind === 'chat' && (inspecting || inspection?.error))) return;
    setBusy(true);
    void onCreate(cwd, kind, mode, trust).catch(error => { setError(String(error)); setBusy(false); });
  };
  const chooseDirectory = () => void desktopClient.chooseDirectory().then(value => { if (value) setCwd(value); }).catch(error => setError(String(error)));

  return { cwd, setCwd, kind, setKind, mode, setMode, trust, setTrust, resources, inspecting, inspection, busy, error, submit, chooseDirectory };
}
