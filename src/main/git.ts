import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, open, readlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { filesForScope, type ChangedFile, type DiffScope, type FileDiff, type GitStatus } from '../shared/git.js';

const exec = promisify(execFile);
const previewLimit = 200_000;
const gitEnv = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', ['--no-pager', '--literal-pathspecs', '-c', 'core.quotePath=false', ...args], {
    cwd, env: gitEnv, encoding: 'utf8', timeout: 10_000, maxBuffer: args[0] === 'diff' ? previewLimit + 1 : 8 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout;
}

/** Porcelain -z uses raw paths, including newlines, and destination-before-source renames. */
export function parseStatus(output: string): ChangedFile[] {
  const parts = output.split('\0');
  const files: ChangedFile[] = [];
  for (let index = 0; index < parts.length; index++) {
    const record = parts[index];
    if (!record) continue;
    if (record.length < 4 || record[2] !== ' ') throw new Error('无法解析 Git 状态');
    const status = record.slice(0, 2);
    const file: ChangedFile = { path: record.slice(3), index: status[0], worktree: status[1] };
    if (/[RC]/.test(status)) {
      const original = parts[++index];
      if (!original) throw new Error('Git 重命名状态缺少原路径');
      file.originalPath = original;
    }
    files.push(file);
  }
  return files;
}

export async function getGitStatus(cwd: string): Promise<GitStatus> {
  const root = (await git(cwd, ['rev-parse', '--show-toplevel'])).replace(/\r?\n$/, '');
  const [status, branch] = await Promise.all([
    git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
    git(root, ['symbolic-ref', '--short', '-q', 'HEAD']).catch(() => git(root, ['rev-parse', '--short', 'HEAD'])),
  ]);
  return { root, branch: branch.trimEnd() || 'detached HEAD', files: parseStatus(status), capturedAt: new Date().toISOString() };
}

function truncate(text: string, kind: FileDiff['kind']): FileDiff {
  return { text: text.slice(0, previewLimit), kind, truncated: text.length > previewLimit };
}

/** Read-only UI preview. Does not stage/revert files or run external diff/textconv helpers. */
export async function getFileDiff(cwd: string, filename: string, scope: DiffScope): Promise<FileDiff> {
  if (scope !== 'worktree' && scope !== 'index') throw new Error('未知 diff 范围');
  const status = await getGitStatus(cwd);
  const file = filesForScope(status.files, scope).find(file => file.path === filename);
  if (!file) throw new Error('文件状态已变化，请刷新变更列表。');
  if (file.index === '?' && scope === 'worktree') {
    const fullPath = path.resolve(status.root, filename);
    const relative = path.relative(status.root, fullPath);
    if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) throw new Error('文件不在当前仓库内');
    const info = await lstat(fullPath);
    if (info.isSymbolicLink()) return truncate(`符号链接 → ${await readlink(fullPath)}`, 'symlink');
    if (!info.isFile()) throw new Error('此路径不是普通文件');
    const root = await realpath(status.root);
    const insideRoot = (resolved: string) => {
      const relative = path.relative(root, resolved);
      return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
    };
    if (!insideRoot(await realpath(fullPath))) throw new Error('预览路径已移出仓库，请刷新。');
    // Reject final-link replacement at open, then check descriptor identity and ancestry
    // again before reading. The latter also catches replacement of an ancestor directory.
    const fd = await open(fullPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const buffer = Buffer.alloc(previewLimit + 1);
    try {
      const opened = await fd.stat();
      const current = await lstat(fullPath);
      if (!opened.isFile() || current.isSymbolicLink() || !insideRoot(await realpath(fullPath)) ||
          opened.dev !== info.dev || opened.ino !== info.ino || opened.dev !== current.dev || opened.ino !== current.ino) {
        throw new Error('预览文件在读取前发生变化，请刷新。');
      }
      const { bytesRead } = await fd.read(buffer, 0, buffer.length, 0);
      const bytes = buffer.subarray(0, bytesRead);
      if (bytes.includes(0)) return { text: '二进制文件不提供文本预览。', kind: 'binary', truncated: false };
      const result = truncate(bytes.toString('utf8'), 'untracked');
      result.truncated ||= info.size > previewLimit;
      return result;
    } finally { await fd.close(); }
  }
  try {
    const diff = await git(status.root, [
      'diff', '--no-ext-diff', '--no-textconv', '--no-color', '--ignore-submodules=all',
      ...(scope === 'index' ? ['--cached'] : []), '--', filename, ...(file.originalPath ? [file.originalPath] : []),
    ]);
    return truncate(diff || '没有可显示的文本差异（文件可能已变化，或为子模块）。', /^Binary files /m.test(diff) ? 'binary' : 'diff');
  } catch (error) {
    const failure = error as { code?: string; message?: string; stdout?: unknown };
    // execFile kills the read-only Git child on overflow and returns the bounded prefix.
    // An oversized patch is a valid truncated preview, not a failed Git operation.
    if (failure.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' && failure.message?.includes('stdout') && typeof failure.stdout === 'string') {
      return { ...truncate(failure.stdout, 'diff'), truncated: true };
    }
    throw error;
  }
}
