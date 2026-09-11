import { describe, expect, it } from 'vitest';
import type { SessionInfo } from '../../../../src/shared/ipc/desktop-api';
import { addSession, groupProjects, projectName, removeSession, selectProject, selectSession, type SessionWorkspace } from '../../../../src/renderer/features/workspace';

const session = (id: string, cwd: string): SessionInfo => ({ id, cwd, title: id, kind: 'chat', processStatus: 'running', activity: 'idle' });
describe('project workspace state', () => {
  const sessions = [session('a', '/one/app'), session('b', '/two/app'), session('c', '/one/app')];
  it('aggregates open cwd and recent projects without merging matching basenames', () => {
    const groups = groupProjects(sessions, ['/two/app', '/empty', '/empty']);
    expect(groups.map(project => [project.cwd, project.name, project.sessions.map(s => s.id)])).toEqual([
      ['/one/app', 'app', ['a', 'c']], ['/two/app', 'app', ['b']], ['/empty', 'empty', []],
    ]);
  });
  it('remembers each project last selection and permits empty project selection', () => {
    let state: SessionWorkspace<SessionInfo> = { sessions, activeId: 'a' };
    state = selectSession(state, 'c'); state = selectProject(state, '/two/app');
    expect(state.activeId).toBe('b');
    state = selectProject(state, '/empty'); expect(state.activeId).toBeNull();
    state = selectProject(state, '/one/app'); expect(state.activeId).toBe('c');
    expect(selectSession(state, 'missing')).toBe(state);
    state = addSession(state, session('new', '/empty')); expect(state.project).toBe('/empty'); expect(state.activeId).toBe('new');
  });
  it('closes to the previous same-project tab then stays in empty project, not another cwd', () => {
    let state = selectSession({ sessions, activeId: 'a' }, 'c');
    state = removeSession(state, 'c'); expect(state.activeId).toBe('a');
    state = removeSession(state, 'a'); expect(state.activeId).toBeNull(); expect(state.project).toBe('/one/app');
    expect(state.sessions.map(s => s.id)).toEqual(['b']);
    expect(selectProject(state, '/one/app').activeId).toBeNull();
  });
  it('remembers the adjacent fallback when an async close completes in another project', () => {
    const sessions = [session('a1', '/A'), session('a2', '/A'), session('a3', '/A'), session('b', '/B')];
    const pending = selectSession({ sessions, activeId: null }, 'a3');
    const completed = removeSession(selectProject(pending, '/B'), 'a3');
    expect(completed.activeId).toBe('b'); expect(completed.project).toBe('/B');
    expect(completed.lastActive?.['/A']).toBe('a2');
    expect(selectProject(completed, '/A').activeId).toBe('a2');
    const changed = selectProject(selectSession(pending, 'a1'), '/B');
    expect(selectProject(removeSession(changed, 'a3'), '/A').activeId).toBe('a1');
    const emptySelection = removeSession(selectProject(pending, '/empty'), 'a3');
    expect(emptySelection.activeId).toBeNull(); expect(emptySelection.project).toBe('/empty');
    expect(selectProject(emptySelection, '/A').activeId).toBe('a2');
    const last = removeSession(selectProject(selectSession({ sessions: [session('a3', '/A'), session('b', '/B')], activeId: null }, 'a3'), '/B'), 'a3');
    expect(last.activeId).toBe('b'); expect(last.lastActive?.['/A']).toBeUndefined();
    expect(selectProject(last, '/A').activeId).toBeNull();
  });
  it('reconciles delayed and duplicate closes against newer user selections', () => {
    const state = selectSession({ sessions, activeId: 'a' }, 'b');
    expect(removeSession(removeSession(state, 'a'), 'a').activeId).toBe('b');
    expect(removeSession(removeSession(state, 'c'), 'b').activeId).toBeNull();
  });
});

describe('selection edge characterization', () => {
  it('preserves roots, separators, order, empty recents and caller payload without mutation', () => {
    expect(['/', '\\', 'C:\\one\\app\\', '/one/app/'].map(projectName)).toEqual(['/', '\\', 'app', 'app']);
    const a = Object.freeze(session('a', '/A')), b = Object.freeze(session('b', '/B'));
    const sessions = [b, a]; const recents = ['/empty', '/A', '/empty'];
    const before = JSON.stringify({ sessions, recents });
    expect(groupProjects(sessions, recents).map(g => [g.cwd, g.sessions])).toEqual([['/B', [b]], ['/A', [a]], ['/empty', []]]);
    const state = { sessions, activeId: null, lastActive: { '/A': 'gone' } };
    expect(selectProject(state, '/A').activeId).toBe('a');
    expect(selectProject(state, '/A').sessions[1]).toBe(a);
    removeSession(selectSession(state, 'a'), 'a'); addSession(state, session('new', '/A'));
    expect(JSON.stringify({ sessions, recents })).toBe(before);
    expect(state.lastActive).toEqual({ '/A': 'gone' });
  });
  it.each([['a1', 'a2'], ['a2', 'a1'], ['a3', 'a2']])('closes %s to %s in original tab order', (id, fallback) => {
    const sessions = ['a1', 'a2', 'a3'].map(id => session(id, '/A'));
    const state = selectSession({ sessions, activeId: null }, id);
    expect(removeSession(state, id).activeId).toBe(fallback);
    expect(removeSession(state, 'unknown')).toBe(state);
  });
  it('uses completion order and latest state for create during close and duplicate close', () => {
    const start = selectSession({ sessions: [session('a1', '/A'), session('a2', '/A')], activeId: null }, 'a2');
    const newer = addSession(start, session('new', '/A'));
    const closed = removeSession(newer, 'a2');
    expect(closed.activeId).toBe('new'); expect(closed.lastActive?.['/A']).toBe('new');
    expect(removeSession(closed, 'a2')).toBe(closed);
    const completed = addSession(addSession(closed, session('second-request', '/B')), session('first-request', '/A'));
    expect(completed.sessions.map(s => s.id)).toEqual(['a1', 'new', 'second-request', 'first-request']);
    expect(completed.activeId).toBe('first-request');
  });
});
