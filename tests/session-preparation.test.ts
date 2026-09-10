import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({ stat: vi.fn() }));
vi.mock('node:fs/promises', () => ({ stat: fake.stat }));
vi.mock('node:os', () => ({ default: { homedir: () => '/fake/home' } }));
import { prepareProject } from '../src/platform/filesystem/session-preparation';

// Real expandHome/resolve/basename; only stat is an asynchronous filesystem operation, and is fake.
beforeEach(() => fake.stat.mockReset().mockResolvedValue({ isDirectory: () => true }));
describe('Node session preparation', () => {
  it.each(['relative/project', '../parent', '~', '~/project', '~\\project', '/absolute/project', '/'])('preserves path spelling rules for %s without realpath', async input => {
    const expanded = input === '~' ? '/fake/home' : input.startsWith('~/') || input.startsWith('~\\') ? path.join('/fake/home', input.slice(2)) : input;
    const cwd = path.resolve(expanded);
    expect(await prepareProject(input)).toEqual({ cwd, title: path.basename(cwd) || cwd });
    expect(fake.stat).toHaveBeenCalledExactlyOnceWith(cwd);
  });
  it('waits for stat before checking directory type or publishing preparation', async () => {
    let complete!: (value: { isDirectory(): boolean }) => void;
    fake.stat.mockReturnValue(new Promise(resolve => { complete = resolve; }));
    const isDirectory = vi.fn(() => true); const prepared = vi.fn();
    const pending = prepareProject('/lexical/link/../project').then(prepared);
    expect(fake.stat).toHaveBeenCalledExactlyOnceWith('/lexical/project');
    await Promise.resolve();
    expect(isDirectory).not.toHaveBeenCalled(); expect(prepared).not.toHaveBeenCalled();
    complete({ isDirectory }); await pending;
    expect(isDirectory).toHaveBeenCalledOnce();
    expect(prepared).toHaveBeenCalledExactlyOnceWith({ cwd: '/lexical/project', title: 'project' });
  });
  it('preserves not-directory Chinese error and original stat failure', async () => {
    fake.stat.mockResolvedValueOnce({ isDirectory: () => false });
    await expect(prepareProject('/not-directory')).rejects.toThrow('项目路径不是目录');
    const error = new Error('EACCES'); fake.stat.mockRejectedValueOnce(error);
    await expect(prepareProject('/denied')).rejects.toBe(error);
  });
});
