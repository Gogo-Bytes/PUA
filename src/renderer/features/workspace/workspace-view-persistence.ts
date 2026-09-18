const key = 'pua.workspace.view.v1';

export interface WorkspaceViewPersistence {
  activeProject?: string;
  collapsedProjects: string[];
}

const empty: WorkspaceViewPersistence = { collapsedProjects: [] };

export function readWorkspaceView(storage: Pick<Storage, 'getItem'> | undefined = typeof window === 'undefined' ? undefined : window.localStorage): WorkspaceViewPersistence {
  if (!storage) return { ...empty };
  try {
    const raw = storage.getItem(key);
    if (!raw) return { ...empty };
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...empty };
    const record = value as Record<string, unknown>;
    return {
      activeProject: typeof record.activeProject === 'string' && record.activeProject.length > 0 ? record.activeProject : undefined,
      collapsedProjects: Array.isArray(record.collapsedProjects) ? record.collapsedProjects.filter((item): item is string => typeof item === 'string' && item.length > 0).slice(0, 256) : [],
    };
  } catch { return { ...empty }; }
}

export function writeWorkspaceView(value: WorkspaceViewPersistence, storage: Pick<Storage, 'setItem'> | undefined = typeof window === 'undefined' ? undefined : window.localStorage): void {
  if (!storage) return;
  try { storage.setItem(key, JSON.stringify({ activeProject: value.activeProject, collapsedProjects: [...new Set(value.collapsedProjects)].slice(0, 256) })); } catch { /* UI persistence is best effort and never blocks Pi. */ }
}
