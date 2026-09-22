import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

export type ResolvedTheme = 'light' | 'dark';
export type ThemePreference = ResolvedTheme | 'system';
export type MotionMode = 'normal' | 'slow' | 'off';

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
const MotionContext = createContext(1);
export const OverlayContainerContext = createContext<RefObject<HTMLElement | null> | null>(null);
export function useOverlayContainer() { return useContext(OverlayContainerContext); }
export function UIProvider({ theme = 'light', motion = 'normal', children }: { theme?: ResolvedTheme; motion?: MotionMode; children: ReactNode }) {
  const container = useRef<HTMLDivElement>(null);
  const [reduced, setReduced] = useState(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const scale = reduced || motion === 'off' ? 0 : motion === 'slow' ? 3 : 1;
  return <MotionContext.Provider value={scale}><div ref={container} className="ui-provider" data-theme={theme} data-motion={scale === 0 ? 'off' : motion}><OverlayContainerContext.Provider value={container}>{children}</OverlayContainerContext.Provider></div></MotionContext.Provider>;
}
export function useMotionScale() { return useContext(MotionContext); }
