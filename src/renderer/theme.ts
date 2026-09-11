import { useEffect, useState } from 'react';
import type { ThemePreference } from '../shared/ipc/desktop-api';

export type ResolvedTheme = 'light' | 'dark';
export function resolveTheme(preference: ThemePreference = 'system', systemDark: boolean): ResolvedTheme {
  return preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;
}
export function useTheme(preference: ThemePreference = 'system'): ResolvedTheme {
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return;
    setSystemDark(media.matches);
    const change = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  const theme = resolveTheme(preference, systemDark);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  return theme;
}
export const terminalThemes = {
  light: { background: '#ffffff', foreground: '#20252b', cursor: '#20252b', selectionBackground: '#dce1e6', black: '#20252b', red: '#b33440', green: '#287444', yellow: '#936126', blue: '#225eaa', magenta: '#a43779', cyan: '#246a73', white: '#dce1e6', brightBlack: '#626b76', brightRed: '#b33440', brightGreen: '#287444', brightYellow: '#936126', brightBlue: '#225eaa', brightMagenta: '#a43779', brightCyan: '#246a73', brightWhite: '#f6f8fa' },
  dark: { background: '#0d1117', foreground: '#e6edf3', cursor: '#e6edf3', selectionBackground: '#303740', black: '#161b22', red: '#f49aa3', green: '#87d39b', yellow: '#e2bc83', blue: '#8ab7ee', magenta: '#f093bb', cyan: '#8ac7c9', white: '#e6edf3', brightBlack: '#99a3ae', brightRed: '#f49aa3', brightGreen: '#87d39b', brightYellow: '#e2bc83', brightBlue: '#8ab7ee', brightMagenta: '#f093bb', brightCyan: '#8ac7c9', brightWhite: '#ffffff' },
};
