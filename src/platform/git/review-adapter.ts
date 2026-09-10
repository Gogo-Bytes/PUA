import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, open, readlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { AuthorizedPreview, ReviewFile, ReviewPreview, RepositorySnapshot, ReviewRepositoryPort } from '../../modules/change-review/index.js';

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
export function parseStatus(output: string): ReviewFile[] {
  const parts = output.split('\0');
  const files: ReviewFile[] = [];
  for (let index = 0; index < parts.length; index++) {
    const record = parts[index];
    if (!record) continue;
    if (record.length < 4 || record[2] !== ' ') throw new Error('无法解析 Git 状态');
    const status = record.slice(0, 2);
    const file: { path: string; index: string; worktree: string; originalPath?: string } = { path: record.slice(3), index: status[0], worktree: status[1] };
    if (/[RC]/.test(status)) {
      const original = parts[++index];
      if (!original) throw new Error('Git 重命名状态缺少原路径');
      file.originalPath = original;
    }
    files.push(file);
  }
  return files;
}

export class GitReviewAdapter implements ReviewRepositoryPort {
  constructor(private readonly capturedAt: () => string = () => new Date().toISOString()) {}

  async captureSnapshot(cwd: string): Promise<RepositorySnapshot> {
    const root = (await git(cwd, ['rev-parse', '--show-toplevel'])).replace(/\r?\n$/, '');
    const [status, branch] = await Promise.all([
      git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
      git(root, ['symbolic-ref', '--short', '-q', 'HEAD']).catch(() => git(root, ['rev-parse', '--short', 'HEAD'])),
    ]);
    return { root, branch: branch.trimEnd() || 'detached HEAD', files: parseStatus(status), capturedAt: this.capturedAt() };
  }

  /** Read-only UI preview. Does not stage/revert files or run external diff/textconv helpers. */
  async readAuthorizedPreview(selection: AuthorizedPreview): Promise<ReviewPreview> {
    const { root: repositoryRoot, path: filename } = selection;
    if (selection.kind === 'untracked') {
      const fullPath = path.resolve(repositoryRoot, filename);
      const relative = path.relative(repositoryRoot, fullPath);
      if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) throw new Error('文件不在当前仓库内');
      const info = await lstat(fullPath);
      if (info.isSymbolicLink()) return truncate(`符号链接 → ${await readlink(fullPath)}`, 'symlink');
      if (!info.isFile()) throw new Error('此路径不是普通文件');
      const root = await realpath(repositoryRoot);
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
      const diff = await git(repositoryRoot, [
        'diff', '--no-ext-diff', '--no-textconv', '--no-color', '--ignore-submodules=all',
        ...(selection.scope === 'index' ? ['--cached'] : []), '--', filename, ...(selection.originalPath ? [selection.originalPath] : []),
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
}

function truncate(text: string, kind: ReviewPreview['kind']) {
  return { text: text.slice(0, previewLimit), kind, truncated: text.length > previewLimit };
}

