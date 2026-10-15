import { createContext, useContext, useState, type HTMLAttributes } from 'react';

const OverlayContext = createContext<HTMLElement | null | undefined>(undefined);

export interface UIProviderProps extends HTMLAttributes<HTMLDivElement> {
  theme?: 'light' | 'dark' | 'system';
}

/** A scoped theme and portal host. No reset, document mutation, or global singleton. */
export function UIProvider({ theme = 'light', className = '', children, ...props }: UIProviderProps) {
  const [overlay, setOverlay] = useState<HTMLDivElement | null>(null);
  return <div {...props} className={`pua-ui ${className}`} data-theme={theme}>
    <OverlayContext.Provider value={overlay}>
      {children}
      <div className="pua-overlay" ref={setOverlay} />
    </OverlayContext.Provider>
  </div>;
}

export function useOverlayContainer() {
  const container = useContext(OverlayContext);
  if (container === undefined) throw new Error('Wrap @pua/components in UIProvider and import @pua/components/styles.css.');
  return container;
}
