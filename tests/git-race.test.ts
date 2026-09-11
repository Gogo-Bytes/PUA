import { afterEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { ChangeReviewApplication } from '../src/modules/change-review/index';
import { GitReviewAdapter } from '../src/platform/git/review-adapter';
import { reviewPreviewDTO, reviewError } from '../src/platform/electron/ipc/change-review-mapper';
import type { DiffScope } from '../src/shared/ipc/change-review';

const review = new ChangeReviewApplication(new GitReviewAdapter());
const getFileDiff = (cwd: string, path: string, scope: DiffScope) => review.preview({ cwd, path, scope }).then(reviewPreviewDTO).catch(reviewError);

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: vi.fn(actual.open) };
});
const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
const temporary: string[] = [];
afterEach(async () => {
  vi.mocked(fs.open).mockImplementation(actual.open);
  await Promise.all(temporary.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

it.skipIf(process.platform === 'win32')('rejects replacing the final file with a symlink between lstat and open', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-file-race-')); temporary.push(root);
  await promisify(execFile)('git', ['init'], { cwd: root });
  const file = path.join(root, 'new.txt');
  await fs.writeFile(file, 'safe');
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-outside-')); temporary.push(outside);
  const secret = path.join(outside, 'secret'); await fs.writeFile(secret, 'must-not-preview');
  vi.mocked(fs.open).mockImplementationOnce(async (filename, flags, mode) => {
    await fs.unlink(file); await fs.symlink(secret, file);
    return actual.open(filename, flags, mode);
  });
  await expect(getFileDiff(root, 'new.txt', 'worktree')).rejects.toThrow();
});

it.skipIf(process.platform === 'win32')('rejects replacing an ancestor with an out-of-repository symlink before open', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-directory-race-')); temporary.push(root);
  await promisify(execFile)('git', ['init'], { cwd: root });
  const directory = path.join(root, 'nested'); await fs.mkdir(directory);
  await fs.writeFile(path.join(directory, 'new.txt'), 'safe');
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-outside-')); temporary.push(outside);
  await fs.writeFile(path.join(outside, 'new.txt'), 'must-not-preview');
  vi.mocked(fs.open).mockImplementationOnce(async (filename, flags, mode) => {
    await fs.rename(directory, directory + '-original'); await fs.symlink(outside, directory);
    return actual.open(filename, flags, mode);
  });
  await expect(getFileDiff(root, 'nested/new.txt', 'worktree')).rejects.toThrow('发生变化');
});
