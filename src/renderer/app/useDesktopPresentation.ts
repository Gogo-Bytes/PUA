import { useEffect, useState } from 'react';
import type { Bootstrap } from '../../shared/ipc/desktop-api';
import { useTheme } from '../ui';
import { desktopClient, isDesktopAvailable } from './desktop-client';

/** Window snapshot only: Preferences current/recents and persistence remain in main. */
export function useDesktopPresentation() {
  const [boot, publish] = useState<Bootstrap | null>(null);
  const [error, reportError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const theme = useTheme(boot?.preferences.theme);
  // Deliberately not async: sync client throws escape; only rejected refreshes report here.
  const refresh = () => { void desktopClient.bootstrap().then(publish).catch(error => reportError(String(error))); };
  useEffect(() => {
    if (!isDesktopAvailable()) { reportError('请使用 npm run dev 启动桌面应用。'); return; }
    refresh();
  }, []);
  return {
    boot, theme, error, reportError, refresh, publish,
    dismissError: () => reportError(''),
    settingsOpen, showSettings: () => setSettingsOpen(true), closeSettings: () => setSettingsOpen(false),
  };
}
