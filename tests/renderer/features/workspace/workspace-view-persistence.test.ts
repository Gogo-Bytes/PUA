import { describe, expect, it } from 'vitest';
import { readWorkspaceView, writeWorkspaceView } from '../../../../src/renderer/features/workspace/workspace-view-persistence';

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

describe('workspace view persistence', () => {
  it('round-trips the active project and deduplicates collapsed projects', () => {
    const target = storage();
    writeWorkspaceView({ activeProject: '/repo', collapsedProjects: ['/repo', '/repo', '/other'] }, target);
    expect(readWorkspaceView(target)).toEqual({ activeProject: '/repo', collapsedProjects: ['/repo', '/other'] });
  });

  it('treats malformed or hostile storage as empty UI state', () => {
    const target = storage();
    target.setItem('pua.workspace.view.v1', JSON.stringify({ activeProject: 4, collapsedProjects: [null, '/ok', 9] }));
    expect(readWorkspaceView(target)).toEqual({ activeProject: undefined, collapsedProjects: ['/ok'] });
    target.setItem('pua.workspace.view.v1', '{');
    expect(readWorkspaceView(target)).toEqual({ collapsedProjects: [] });
  });
});
