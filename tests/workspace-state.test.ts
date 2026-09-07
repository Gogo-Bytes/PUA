import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { SessionInfo } from '../src/shared/contracts';
import { addSession, groupProjects, removeSession, selectProject, selectSession, type SessionWorkspace } from '../src/renderer/session-state';
import { isConflictPatch, parseDiffLines } from '../src/renderer/diff-lines';
import combinedConflict from './fixtures/combined-conflict.patch?raw';
import { defaults, PreferencesStore, validatePreferences } from '../src/main/preferences';
import { resolveTheme } from '../src/renderer/theme';

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
    let state: SessionWorkspace = { sessions, activeId: 'a' };
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

describe('desktop theme compatibility', () => {
  it('defaults old preferences to system and rejects invalid theme at host boundary', () => {
    const { theme: _, ...legacy } = defaults;
    expect(validatePreferences(legacy).theme).toBe('system');
    for (const theme of ['system', 'light', 'dark']) expect(validatePreferences({ ...legacy, theme }).theme).toBe(theme);
    for (const theme of ['auto', null, 1, {}]) expect(() => validatePreferences({ ...legacy, theme })).toThrow('主题');
    expect(resolveTheme(undefined, true)).toBe('dark'); expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light'); expect(resolveTheme('dark', false)).toBe('dark');
  });
  it('reads old disk settings and atomically persists a theme without losing existing preferences', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'pua-theme-'));
    try {
      const file = path.join(directory, 'settings.json'); const { theme: _, ...legacy } = defaults;
      await writeFile(file, JSON.stringify({ ...legacy, args: ['--extension', '/custom.ts'], recentProjects: ['/one/app'] }));
      const store = new PreferencesStore(file); const old = await store.read(); expect(old.theme).toBe('system');
      await store.write({ ...old, theme: 'dark' }); expect(await store.read()).toEqual({ ...old, theme: 'dark' });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});

describe('Git patch line numbers', () => {
  // Captured from git diff after an actual two-branch content conflict (UU).
  it.each([
    combinedConflict,
    combinedConflict.replace('diff --cc', 'diff --combined'),
    combinedConflict.slice(combinedConflict.indexOf('@@@')),
    '* Unmerged path conflict.txt\n',
  ])('keeps combined/unmerged patch raw without two-sided parsing', text => {
    expect(isConflictPatch(text)).toBe(true);
    const rows = parseDiffLines(text);
    expect(rows.every(row => row.kind === 'meta' && row.old === undefined && row.next === undefined)).toBe(true);
    expect(rows.map(row => row.text).join('\n')).toBe(text);
  });
  it('uses unmerged status context even when output has no combined header', () => {
    const text = '@@ -1 +1 @@\n-old\n+new';
    expect(isConflictPatch(text)).toBe(false);
    for (const [index, worktree] of ['UU', 'AU', 'UD', 'UA', 'DU', 'AA', 'DD']) {
      const status = { index, worktree };
      expect(isConflictPatch(text, status)).toBe(true);
      expect(parseDiffLines(text, status).every(row => row.kind === 'meta')).toBe(true);
    }
    expect(isConflictPatch(text, { index: 'M', worktree: 'M' })).toBe(false);
  });
  it('numbers hunk bodies and never counts file headers or no-newline markers', () => {
    const rows = parseDiffLines('diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -10,2 +20,3 @@\n same\n-old\n+new\n+extra\n\\ No newline at end of file\n');
    expect(rows.filter(row => row.old || row.next)).toEqual([
      { kind: 'context', text: 'same', old: 10, next: 20 }, { kind: 'deletion', text: 'old', old: 11 },
      { kind: 'addition', text: 'new', next: 21 }, { kind: 'addition', text: 'extra', next: 22 },
    ]);
    expect(rows.filter(row => row.kind === 'addition')).toHaveLength(2);
  });
  it('supports added/deleted files, multiple hunks, truncated patches and plus-prefixed content', () => {
    expect(parseDiffLines('@@ -0,0 +1,2 @@\n+++content\n+second').slice(1)).toEqual([{ kind: 'addition', text: '++content', next: 1 }, { kind: 'addition', text: 'second', next: 2 }]);
    expect(parseDiffLines('@@ -1 +0,0 @@\n-gone\n@@ -9 +8 @@\n-old\n+new').filter(row => row.kind !== 'hunk')).toEqual([{ kind: 'deletion', old: 1, text: 'gone' }, { kind: 'deletion', old: 9, text: 'old' }, { kind: 'addition', next: 8, text: 'new' }]);
    expect(parseDiffLines('@@ -1,50 +1,50 @@\n one\n-partial').at(-1)?.old).toBe(2);
    expect(parseDiffLines('Binary files a/a and b/a differ').every(row => row.kind === 'meta')).toBe(true);
  });
});
