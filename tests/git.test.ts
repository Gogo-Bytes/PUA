import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile, symlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { ChangeReviewApplication } from '../src/modules/change-review/index';
import { GitReviewAdapter, parseStatus } from '../src/platform/git/review-adapter';
import { repositorySnapshotDTO, reviewPreviewDTO, reviewError } from '../src/platform/electron/ipc/change-review-mapper';
import { filesForScope, type DiffScope } from '../src/shared/git';

const review = new ChangeReviewApplication(new GitReviewAdapter());
const getFileDiff = (cwd: string, path: string, scope: DiffScope) => review.preview({ cwd, path, scope }).then(reviewPreviewDTO).catch(reviewError);
const getGitStatus = (cwd: string) => review.snapshot(cwd).then(repositorySnapshotDTO);

const exec = promisify(execFile);
const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function repository() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pi-desktop-git-'));
  temporary.push(root);
  const hooks = path.join(root, 'empty-hooks');
  await mkdir(hooks);
  const git = (...args: string[]) => exec('git', ['-c', `core.hooksPath=${hooks}`, '-c', 'commit.gpgsign=false', '-c', 'user.name=Desktop Test', '-c', 'user.email=test@example.invalid', ...args], { cwd: root });
  await git('init', '--initial-branch=main');
  await writeFile(path.join(root, 'hello.txt'), 'base\n');
  await git('add', 'hello.txt');
  await git('commit', '-m', 'fixture');
  return { root, git };
}

describe('read-only Git review', () => {
  it('parses NUL-delimited paths, both index/worktree states and rename pairs', () => {
    const files = parseStatus('MM hello world.txt\0R  new\nname.txt\0old name.txt\0?? 图片.png\0');
    expect(files[1]).toEqual({ path: 'new\nname.txt', originalPath: 'old name.txt', index: 'R', worktree: ' ' });
    expect(filesForScope(files, 'index')).toHaveLength(2);
    expect(filesForScope(files, 'worktree')).toHaveLength(2);
    expect(() => parseStatus('R  missing.txt\0')).toThrow();
  });
  it('separates staged and unstaged changes without mutating the index', async () => {
    const { root, git } = await repository();
    await writeFile(path.join(root, 'hello.txt'), 'staged\n'); await git('add', 'hello.txt');
    await writeFile(path.join(root, 'hello.txt'), 'unstaged\n');
    const before = await readFile(path.join(root, '.git/index'));
    const state = await getGitStatus(root);
    expect(state.branch).toBe('main');
    expect(state.files.find(file => file.path === 'hello.txt')).toEqual({ path: 'hello.txt', index: 'M', worktree: 'M' });
    const index = await getFileDiff(root, 'hello.txt', 'index');
    const worktree = await getFileDiff(root, 'hello.txt', 'worktree');
    expect(index.text).toContain('+staged'); expect(index.text).not.toContain('+unstaged');
    expect(worktree.text).toContain('+unstaged'); expect(worktree.text).toContain('-staged');
    expect(await readFile(path.join(root, '.git/index'))).toEqual(before);
  });
  it('previews text, reports binary files, truncates large output and rejects arbitrary paths', async () => {
    const { root } = await repository();
    await writeFile(path.join(root, '中文 file.txt'), '你好\n');
    await writeFile(path.join(root, 'image.bin'), Buffer.from([0, 1, 2]));
    await writeFile(path.join(root, 'large.txt'), 'x'.repeat(210_000));
    expect((await getFileDiff(root, '中文 file.txt', 'worktree')).text).toBe('你好\n');
    expect((await getFileDiff(root, 'image.bin', 'worktree')).kind).toBe('binary');
    expect((await getFileDiff(root, 'large.txt', 'worktree')).truncated).toBe(true);
    await expect(getFileDiff(root, '../outside', 'worktree')).rejects.toThrow('状态已变化');
    await expect(getFileDiff(root, 'hello.txt', 'index')).rejects.toThrow('状态已变化');
  });
  it.skipIf(process.platform === 'win32')('does not follow untracked symlinks or expand Git pathspec magic', async () => {
    const { root, git } = await repository();
    await symlink('/definitely/private', path.join(root, 'link'));
    expect((await getFileDiff(root, 'link', 'worktree')).kind).toBe('symlink');
    const name = ':(glob)*.txt';
    await writeFile(path.join(root, name), 'one\n');
    await git('--literal-pathspecs', 'add', name); await git('commit', '-m', 'literal fixture');
    await writeFile(path.join(root, name), 'two\n');
    await writeFile(path.join(root, 'hello.txt'), 'UNRELATED\n');
    const diff = await getFileDiff(root, name, 'worktree');
    expect(diff.text).toContain('+two'); expect(diff.text).not.toContain('UNRELATED');
  });
  it('returns bounded previews for staged and unstaged patches exceeding 8MiB', async () => {
    const { root, git } = await repository();
    const large = 'generated line of tracked text\n'.repeat(350_000);
    await writeFile(path.join(root, 'hello.txt'), large);
    expect((await getFileDiff(root, 'hello.txt', 'worktree')).truncated).toBe(true);
    await git('add', 'hello.txt');
    const staged = await getFileDiff(root, 'hello.txt', 'index');
    expect(staged.truncated).toBe(true);
    expect(staged.text.length).toBeLessThanOrEqual(200_000);
    expect(staged.text).toContain('+generated line');
  });
  it('supports renames and clearly fails outside a repository', async () => {
    const { root, git } = await repository();
    await git('mv', 'hello.txt', 'new name.txt');
    const diff = await getFileDiff(root, 'new name.txt', 'index');
    expect(diff.text).toContain('rename from hello.txt');
    const outside = await mkdtemp(path.join(os.tmpdir(), 'pi-no-git-')); temporary.push(outside);
    await expect(getGitStatus(outside)).rejects.toThrow();
  });
});
