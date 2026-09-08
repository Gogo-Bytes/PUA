import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import './tokens.css';
import './ui.css';
export type MotionMode = 'normal' | 'slow' | 'off';
const MotionContext = createContext(1);
export function UIProvider({ theme = 'light', motion = 'normal', children }: { theme?: 'light' | 'dark'; motion?: MotionMode; children: ReactNode }) {
  const [reduced, setReduced] = useState(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const scale = reduced || motion === 'off' ? 0 : motion === 'slow' ? 3 : 1;
  return <MotionContext.Provider value={scale}><div className="ui-provider" data-theme={theme} data-motion={scale === 0 ? 'off' : motion}>{children}</div></MotionContext.Provider>;
}
export function useMotionScale() { return useContext(MotionContext); }
