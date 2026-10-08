import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
const fake = vi.hoisted(() => ({ access: vi.fn<(value: string) => Promise<void>>(), readdir: vi.fn() }));
vi.mock('node:fs/promises', () => ({ access: fake.access, readdir: fake.readdir }));
vi.mock('node:os', () => ({ default: { homedir: () => '/fake/home' } }));
import { inspectProjectResources } from '../../../src/platform/filesystem/project-resources';

// Exercise the same filesystem adapter Interface as bootstrap and IPC.
const candidates = ['.pi/settings.json', '.pi/extensions', '.pi/skills', '.pi/prompts', '.pi/packages', '.agents/skills'];
const project = path.resolve('/fake/project');
const lexical = path.resolve('/lexical/project');
const home = path.resolve('/fake/home');
const root = path.parse(project).root;
const layer = (dir: string) => [...candidates, '.git'].map(name => path.join(dir, name));
beforeEach(() => {
  fake.access.mockReset();
  fake.readdir.mockReset();
});
describe('resource inspection with entirely Fake access', () => {
  it('scans each candidate sequentially, then .git; stops only after scanning its layer', async () => {
    const allowed = new Set([
      path.join(project, '.pi/skills'),
      path.join(path.dirname(project), '.agents/skills'),
      path.join(path.dirname(project), '.git'),
    ]);
    const calls: string[] = [];
    let pending = false;
    fake.access.mockImplementation(async value => {
      expect(pending).toBe(false);
      pending = true;
      calls.push(value);
      await Promise.resolve();
      pending = false;
      if (!allowed.has(value)) throw new Error('fake absent');
    });
    expect(await inspectProjectResources(project)).toEqual({
      hasResources: true,
      paths: [path.join(project, '.pi/skills'), path.join(path.dirname(project), '.agents/skills')],
    });
    expect(calls).toEqual([...layer(project), ...layer(path.dirname(project))]);
  });
  it('returns all six accessible candidates in declared order before stopping at an accessible .git', async () => {
    // access alone decides existence (including symlink targets); no stat/type or contents read.
    fake.access.mockResolvedValue(undefined);
    expect(await inspectProjectResources('/lexical/link/../project')).toEqual({
      hasResources: true,
      paths: layer(lexical).slice(0, 6),
    });
    expect(fake.access.mock.calls.flat()).toEqual(layer(lexical));
  });
  it('continues after arbitrary .git access errors and includes root resources last', async () => {
    fake.access.mockImplementation(async value => {
      if (value === path.join(root, '.pi/packages')) return;
      throw value.endsWith(path.join('.git')) ? new Error('EACCES') : undefined;
    });
    expect(await inspectProjectResources('/project')).toEqual({ hasResources: true, paths: [path.join(root, '.pi/packages')] });
    expect(fake.access.mock.calls.flat()).toEqual([...layer(path.resolve('/project')), ...layer(root)]);
  });
  it('treats arbitrary access failures as absent and still checks .git at root', async () => {
    fake.access.mockRejectedValue(new Error('EACCES, not only ENOENT'));
    expect(await inspectProjectResources('/')).toEqual({ hasResources: false, paths: [] });
    expect(fake.access.mock.calls.flat()).toEqual(layer(root));
  });
  it('returns safe project prompt names without reading prompt contents', async () => {
    fake.access.mockImplementation(async value => {
      if (value === path.join(project, '.pi/prompts') || value === path.join(project, '.git')) return;
      throw new Error('fake absent');
    });
    fake.readdir.mockResolvedValue([
      { name: 'review.md', isFile: () => true, isDirectory: () => false },
      { name: 'deploy.md', isFile: () => true, isDirectory: () => false },
      { name: 'notes.txt', isFile: () => true, isDirectory: () => false },
      { name: 'unsafe name.md', isFile: () => true, isDirectory: () => false },
    ]);
    expect(await inspectProjectResources(project)).toEqual({
      hasResources: true,
      paths: [path.join(project, '.pi/prompts')],
      prompts: [
        { name: 'deploy', source: 'prompt' },
        { name: 'review', source: 'prompt' },
      ],
    });
    expect(fake.readdir).toHaveBeenCalledWith(path.join(project, '.pi/prompts'), { withFileTypes: true });
  });
  it.each(['~', '~/', '~\\'])('expands %s and ascends to root without realpath or resource contents', async cwd => {
    fake.access.mockRejectedValue(new Error('fake absent'));
    expect(await inspectProjectResources(cwd)).toEqual({ hasResources: false, paths: [] });
    expect(fake.access.mock.calls.flat()).toEqual([...layer(home), ...layer(path.dirname(home)), ...layer(root)]);
  });
});
