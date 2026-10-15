import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { SidebarCallback } from './types';

type Lane = 'mutation' | 'navigation' | 'expansion';
interface Job { label: string }
interface Entry { active: boolean; token: object; jobs: Map<Lane, Job>; error?: string }
interface Actions {
  pending(key: string, lane?: Lane): boolean;
  label(key: string): string | undefined;
  error(key: string): string | undefined;
  run(key: string, label: string, callback: SidebarCallback, lane?: Lane): Promise<boolean>;
}
const Context = createContext<Actions | null>(null);
export const actionKey = (kind: 'project' | 'session' | 'global', id: string) => JSON.stringify([kind, id]);

function useRegistry(keys: readonly string[]): Actions {
  const entries = useRef(new Map<string, Entry>());
  const mounted = useRef(false);
  const lifetime = useRef<object>({});
  const [, redraw] = useState(0);
  const signature = JSON.stringify([...new Set(keys)]);
  useLayoutEffect(() => {
    mounted.current = true;
    lifetime.current = {};
    return () => { mounted.current = false; };
  }, []);
  useLayoutEffect(() => {
    const active = new Set<string>(JSON.parse(signature));
    for (const [key, entry] of entries.current) {
      if (!active.has(key)) { entry.active = false; entry.error = undefined; if (!entry.jobs.size) entries.current.delete(key); }
    }
    for (const key of active) {
      const previous = entries.current.get(key);
      if (!previous) entries.current.set(key, { active: true, token: {}, jobs: new Map() });
      else if (!previous.active) { previous.active = true; previous.token = {}; previous.error = undefined; }
    }
    redraw(value => value + 1);
  }, [signature]);
  function notify() { if (mounted.current) redraw(value => value + 1); }
  return {
    pending: (key, lane = 'mutation') => !!entries.current.get(key)?.jobs.has(lane),
    label: key => { const entry = entries.current.get(key); return entry?.active ? [...entry.jobs.values()].map(job => job.label).join(' · ') || undefined : undefined; },
    error: key => entries.current.get(key)?.error,
    async run(key, label, callback, lane = 'mutation') {
      const entry = entries.current.get(key);
      if (!mounted.current || !entry?.active || entry.jobs.has(lane)) return false;
      const token = entry.token, life = lifetime.current, job = { label };
      entry.jobs.set(lane, job); entry.error = undefined; notify();
      try { await callback(); return true; }
      catch (error) {
        if (mounted.current && life === lifetime.current && entry.active && entry.token === token) {
          entry.error = error instanceof Error && error.message.trim() ? error.message : '操作失败，请重试';
        }
        return false;
      } finally {
        if (entry.jobs.get(lane) === job) entry.jobs.delete(lane);
        if (!entry.active && !entry.jobs.size) entries.current.delete(key);
        if (life === lifetime.current) notify();
      }
    },
  };
}

/** One registry per Sidebar. Standalone rows/menus receive an isolated fallback scope. */
export function ActionScope({ targets, children }: { targets: readonly string[]; children: ReactNode }) {
  const actions = useRegistry(targets);
  return <Context.Provider value={actions}>{children}</Context.Provider>;
}
export function EnsureActionScope({ target, children }: { target: string; children: ReactNode }) {
  const existing = useContext(Context);
  return existing ? children : <ActionScope targets={[target]}>{children}</ActionScope>;
}
export function useActions(): Actions {
  const actions = useContext(Context);
  if (!actions) throw new Error('Internal sidebar action scope is missing.');
  return actions;
}
