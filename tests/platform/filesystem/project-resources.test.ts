import { beforeEach, describe, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({ access: vi.fn<(value: string) => Promise<void>>(), readdir: vi.fn() }));
vi.mock('node:fs/promises', () => ({ access: fake.access, readdir: fake.readdir }));
vi.mock('node:os', () => ({ default: { homedir: () => '/fake/home' } }));
import { inspectProjectResources } from '../../../src/platform/filesystem/project-resources';

// Exercise the same filesystem adapter Interface as bootstrap and IPC.
const candidates = ['.pi/settings.json', '.pi/extensions', '.pi/skills', '.pi/prompts', '.pi/packages', '.agents/skills'];
const layer = (dir: string) => [...candidates, '.git'].map(name => `${dir === '/' ? '' : dir}/${name}`);
beforeEach(() => { fake.access.mockReset(); fake.readdir.mockReset(); });
describe('resource inspection with entirely Fake access', () => {
  it('scans each candidate sequentially, then .git; stops only after scanning its layer', async () => {
    const allowed = new Set(['/fake/project/.pi/skills', '/fake/.agents/skills', '/fake/.git']);
    const calls: string[] = []; let pending = false;
    fake.access.mockImplementation(async value => {
      expect(pending).toBe(false); pending = true; calls.push(value); await Promise.resolve(); pending = false;
      if (!allowed.has(value)) throw new Error('fake absent');
    });
    expect(await inspectProjectResources('/fake/project')).toEqual({ hasResources: true, paths: ['/fake/project/.pi/skills', '/fake/.agents/skills'] });
    expect(calls).toEqual([...layer('/fake/project'), ...layer('/fake')]);
  });
  it('returns all six accessible candidates in declared order before stopping at an accessible .git', async () => {
    // access alone decides existence (including symlink targets); no stat/type or contents read.
    fake.access.mockResolvedValue(undefined);
    expect(await inspectProjectResources('/lexical/link/../project')).toEqual({
      hasResources: true, paths: layer('/lexical/project').slice(0, 6),
    });
    expect(fake.access.mock.calls.flat()).toEqual(layer('/lexical/project'));
  });
  it('continues after arbitrary .git access errors and includes root resources last', async () => {
    fake.access.mockImplementation(async value => {
      if (value === '/.pi/packages') return;
      throw value.endsWith('/.git') ? new Error('EACCES') : undefined;
    });
    expect(await inspectProjectResources('/project')).toEqual({ hasResources: true, paths: ['/.pi/packages'] });
    expect(fake.access.mock.calls.flat()).toEqual([...layer('/project'), ...layer('/')]);
  });
  it('treats arbitrary access failures as absent and still checks .git at root', async () => {
    fake.access.mockRejectedValue(new Error('EACCES, not only ENOENT'));
    expect(await inspectProjectResources('/')).toEqual({ hasResources: false, paths: [] });
    expect(fake.access.mock.calls.flat()).toEqual(layer('/'));
  });
  it('returns safe project prompt names without reading prompt contents', async () => {
    fake.access.mockImplementation(async value => {
      if (value === '/fake/project/.pi/prompts' || value === '/fake/project/.git') return;
      throw new Error('fake absent');
    });
    fake.readdir.mockResolvedValue([
      { name: 'review.md', isFile: () => true, isDirectory: () => false },
      { name: 'deploy.md', isFile: () => true, isDirectory: () => false },
      { name: 'notes.txt', isFile: () => true, isDirectory: () => false },
      { name: 'unsafe name.md', isFile: () => true, isDirectory: () => false },
    ]);
    expect(await inspectProjectResources('/fake/project')).toEqual({
      hasResources: true,
      paths: ['/fake/project/.pi/prompts'],
      prompts: [{ name: 'deploy', source: 'prompt' }, { name: 'review', source: 'prompt' }],
    });
    expect(fake.readdir).toHaveBeenCalledWith('/fake/project/.pi/prompts', { withFileTypes: true });
  });
  it.each(['~', '~/', '~\\'])('expands %s and ascends to root without realpath or resource contents', async cwd => {
    fake.access.mockRejectedValue(new Error('fake absent'));
    expect(await inspectProjectResources(cwd)).toEqual({ hasResources: false, paths: [] });
    expect(fake.access.mock.calls.flat()).toEqual([...layer('/fake/home'), ...layer('/fake'), ...layer('/')]);
  });
});
