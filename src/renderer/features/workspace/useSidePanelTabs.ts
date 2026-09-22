import { useState } from 'react';

export type SidePanelKind = 'review' | 'terminal' | 'browser' | 'files' | 'side-chat' | 'task';
interface PanelState { tabs: SidePanelKind[]; active: SidePanelKind | null }
const empty: PanelState = { tabs: [], active: null };

/** Window-local presentation only. Each session/draft scope has an independent tab set. */
export function useSidePanelTabs(scope: string) {
  const [scopes, setScopes] = useState<Record<string, PanelState>>({});
  const state = scopes[scope] ?? empty;
  const update = (change: (state: PanelState) => PanelState) => setScopes(current => ({
    ...current, [scope]: change(current[scope] ?? empty),
  }));
  return {
    ...state,
    open: (kind: SidePanelKind) => update(current => ({ tabs: current.tabs.includes(kind) ? current.tabs : [...current.tabs, kind], active: kind })),
    select: (kind: SidePanelKind) => update(current => current.tabs.includes(kind) ? { ...current, active: kind } : current),
    close: (kind: SidePanelKind) => update(current => {
      const index = current.tabs.indexOf(kind);
      const tabs = current.tabs.filter(tab => tab !== kind);
      return { tabs, active: current.active === kind ? tabs[Math.min(index, tabs.length - 1)] ?? null : current.active };
    }),
  };
}
