import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { JsonWorkspaceSessionStore } from '../../../src/app/main/workspace-session-store';

const session = (id = 'pua-1') => ({ id, cwd: '/workspace/app', title: '会话', piSessionId: 'pi-1', sessionFile: `/home/user/.pi/${id}.jsonl` });
let directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });

describe('main-owned Pi workspace session index', () => {
  it('serializes upsert/rename/remove atomically and deduplicates IDs', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'pua-session-store-')); directories.push(directory);
    const store = new JsonWorkspaceSessionStore(path.join(directory, 'sessions.json'));
    await store.upsert(session()); await store.upsert({ ...session(), title: '最新' });
    expect(await store.read()).toEqual([{ ...session(), title: '最新' }]);
    await store.rename('pua-1', '重命名'); expect((await store.read())[0].title).toBe('重命名');
    await store.remove('pua-1'); expect(await store.read()).toEqual([]);
    expect(JSON.parse(await readFile(path.join(directory, 'sessions.json'), 'utf8'))).toEqual([]);
  });

  it('ignores malformed and unsafe persisted records without exposing them to restore', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'pua-session-store-')); directories.push(directory);
    const file = path.join(directory, 'sessions.json');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(file, JSON.stringify([session(), { ...session('bad/id'), sessionFile: 'relative.jsonl' }, { id: 'missing' }]));
    expect(await new JsonWorkspaceSessionStore(file).read()).toEqual([session()]);
  });
});
