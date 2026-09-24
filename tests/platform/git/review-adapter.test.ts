import { beforeEach, describe, expect, it, vi } from 'vitest';
import { constants } from 'node:fs';
import { GitReviewAdapter, parseStatus } from '../../../src/platform/git/review-adapter';
import { ChangeReviewApplication, type AuthorizedPreview } from '../../../src/modules/change-review/index';

// Fail-closed replacements for EVERY environmental import used by the real adapter.
// No importActual, real handles, repository fixture, exec, or disk access.
const fake = vi.hoisted(() => ({ exec: vi.fn(), execFile: vi.fn(), lstat: vi.fn(), open: vi.fn(), readlink: vi.fn(), realpath: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: Object.assign(fake.execFile, { [Symbol.for('nodejs.util.promisify.custom')]: fake.exec }) }));
vi.mock('node:fs', () => ({ constants: { O_RDONLY: 0, O_NOFOLLOW: 256 } }));
vi.mock('node:fs/promises', () => ({ lstat: fake.lstat, open: fake.open, readlink: fake.readlink, realpath: fake.realpath }));
const prefix = ['--no-pager', '--literal-pathspecs', '-c', 'core.quotePath=false'];
const tracked: AuthorizedPreview = { kind: 'tracked', root: '/repo', path: '-new\n图片', originalPath: 'old\nname', scope: 'index' };
const untracked: AuthorizedPreview = { kind: 'untracked', root: '/repo', path: 'nested/file' };
const adapter = () => new GitReviewAdapter(() => 'clock-at-capture');
const info = (extra = {}) => ({ dev: 1, ino: 2, size: 4, isFile: () => true, isSymbolicLink: () => false, ...extra });
beforeEach(() => {
  for (const [name, fn] of Object.entries(fake)) fn.mockReset().mockImplementation(() => { throw new Error(`unconfigured environment: ${name}`); });
});
function memoryFile(bytes = Buffer.from('safe')) {
  const sequence: string[] = [];
  const fd = {
    stat: vi.fn(async () => { sequence.push('stat'); return info(); }),
    read: vi.fn(async (buffer: Buffer, offset: number, length: number, position: number) => {
      sequence.push('read'); expect([offset, length, position, buffer.length]).toEqual([0, 200001, 0, 200001]);
      const bytesRead = bytes.copy(buffer, 0, 0, length); return { bytesRead };
    }),
    close: vi.fn(async () => { sequence.push('close'); }),
  };
  fake.lstat.mockImplementation(async (path: string) => { sequence.push(`lstat:${path}`); return info({ size: bytes.length }); });
  fake.realpath.mockImplementation(async (path: string) => { sequence.push(`realpath:${path}`); return path; });
  fake.open.mockImplementation(async (path: string, flags: number) => { sequence.push(`open:${path}`); expect(flags).toBe(constants.O_RDONLY | constants.O_NOFOLLOW); return fd; });
  return { sequence, fd };
}

describe('GitReviewAdapter command/parser compatibility with Fake exec', () => {
  it('creates only a validated local branch after a fresh clean check and switches to it', async () => {
    fake.exec.mockImplementation(async (_command: string, args: string[]) => {
      const operation = args.slice(4).join(' ');
      if (operation === 'rev-parse --show-toplevel') return { stdout: '/repo\n' };
      if (operation === 'check-ref-format --branch feature/new') return { stdout: '' };
      if (operation === 'status --porcelain=v1 -z --untracked-files=all') return { stdout: '' };
      if (operation === 'for-each-ref --format=%(refname:short) refs/heads') return { stdout: 'main\n' };
      if (operation === 'switch --quiet --create feature/new') return { stdout: '' };
      throw new Error(`unexpected git command: ${operation}`);
    });
    await adapter().createBranch('/cwd', 'feature/new');
    expect(fake.exec.mock.calls.map(call => call[1].slice(4))).toContainEqual(['switch', '--quiet', '--create', 'feature/new']);
  });
  it('does not create on a dirty worktree', async () => {
    fake.exec.mockImplementation(async (_command: string, args: string[]) => {
      const operation = args.slice(4).join(' ');
      if (operation === 'rev-parse --show-toplevel') return { stdout: '/repo\n' };
      if (operation === 'check-ref-format --branch feature/new') return { stdout: '' };
      if (operation === 'status --porcelain=v1 -z --untracked-files=all') return { stdout: ' M file\0' };
      throw new Error(`unexpected git command: ${operation}`);
    });
    await expect(adapter().createBranch('/cwd', 'feature/new')).rejects.toThrow('工作区存在未提交改动');
    expect(fake.exec.mock.calls.some(call => call[1].includes('--create'))).toBe(false);
  });
  it('deletes only a non-current local branch with git safe-delete semantics', async () => {
    fake.exec.mockImplementation(async (_command: string, args: string[]) => {
      const operation = args.slice(4).join(' ');
      if (operation === 'rev-parse --show-toplevel') return { stdout: '/repo\n' };
      if (operation === 'check-ref-format --branch feature/old') return { stdout: '' };
      if (operation === 'symbolic-ref --short -q HEAD') return { stdout: 'main\n' };
      if (operation === 'status --porcelain=v1 -z --untracked-files=all') return { stdout: '' };
      if (operation === 'for-each-ref --format=%(refname:short) refs/heads') return { stdout: 'main\nfeature/old\n' };
      if (operation === 'branch --delete -- feature/old') return { stdout: '' };
      throw new Error(`unexpected git command: ${operation}`);
    });
    await adapter().deleteBranch('/cwd', 'feature/old');
    expect(fake.exec.mock.calls.map(call => call[1].slice(4))).toContainEqual(['branch', '--delete', '--', 'feature/old']);
  });
  it('lists porcelain worktrees and marks the repository worktree as current', async () => {
    fake.exec.mockResolvedValueOnce({ stdout: '/repo\n' }).mockResolvedValueOnce({ stdout: 'worktree /repo\nHEAD abc123\nbranch refs/heads/main\n\nworktree /repo-feature\nHEAD def456\nbranch refs/heads/feature/test\n' });
    await expect(adapter().listWorktrees('/cwd')).resolves.toEqual({ current: '/repo', worktrees: [
      { path: '/repo', head: 'abc123', branch: 'main', current: true },
      { path: '/repo-feature', head: 'def456', branch: 'feature/test', current: false },
    ] });
  });
  it('creates a clean sibling worktree with a new local branch', async () => {
    fake.lstat.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    fake.exec.mockImplementation(async (_command: string, args: string[]) => {
      const operation = args.slice(4).join(' ');
      if (operation === 'rev-parse --show-toplevel') return { stdout: '/repo\n' };
      if (operation === 'check-ref-format --branch feature/worktree') return { stdout: '' };
      if (operation === 'status --porcelain=v1 -z --untracked-files=all') return { stdout: '' };
      if (operation === 'for-each-ref --format=%(refname:short) refs/heads') return { stdout: 'main\n' };
      if (operation === 'worktree add --quiet --new-branch feature/worktree /repo-feature-worktree') return { stdout: '' };
      if (operation === 'worktree list --porcelain') return { stdout: 'worktree /repo\nHEAD abc123\nbranch refs/heads/main\n\nworktree /repo-feature-worktree\nHEAD def456\nbranch refs/heads/feature/worktree\n' };
      throw new Error(`unexpected git command: ${operation}`);
    });
    await adapter().createWorktree('/cwd', 'feature/worktree');
    expect(fake.exec.mock.calls.map(call => call[1].slice(4))).toContainEqual(['worktree', 'add', '--quiet', '--new-branch', 'feature/worktree', '/repo-feature-worktree']);
  });
  it('removes only a clean non-current worktree without force', async () => {
    fake.exec.mockImplementation(async (_command: string, args: string[]) => {
      const operation = args.slice(4).join(' ');
      if (operation === 'rev-parse --show-toplevel') return { stdout: '/repo\n' };
      if (operation === 'worktree list --porcelain') return { stdout: 'worktree /repo\nHEAD abc123\nbranch refs/heads/main\n\nworktree /repo-feature\nHEAD def456\nbranch refs/heads/feature/test\n' };
      if (operation === 'status --porcelain=v1 -z --untracked-files=all') return { stdout: '' };
      if (operation === 'worktree remove --quiet /repo-feature') return { stdout: '' };
      throw new Error(`unexpected git command: ${operation}`);
    });
    await adapter().deleteWorktree('/cwd', '/repo-feature');
    expect(fake.exec.mock.calls.map(call => call[1].slice(4))).toContainEqual(['worktree', 'remove', '--quiet', '/repo-feature']);
  });
  it('commits all current changes only after a non-detached branch and returns a fresh snapshot', async () => {
    let capture = 0;
    fake.exec.mockImplementation(async (_command: string, args: string[]) => {
      const operation = args.slice(4).join(' ');
      if (operation === 'rev-parse --show-toplevel') return { stdout: '/repo\n' };
      if (operation === 'status --porcelain=v1 -z --untracked-files=all') return { stdout: capture++ === 0 ? ' M file\0' : '' };
      if (operation === 'symbolic-ref --short -q HEAD') return { stdout: 'main\n' };
      if (operation === 'git add') return { stdout: '' };
      if (operation === 'add --all -- .') return { stdout: '' };
      if (operation === 'commit --quiet --message message') return { stdout: '' };
      throw new Error(`unexpected git command: ${operation}`);
    });
    await adapter().commitChanges('/cwd', ' message ');
    expect(fake.exec.mock.calls.map(call => call[1].slice(4))).toContainEqual(['add', '--all', '--', '.']);
    expect(fake.exec.mock.calls.map(call => call[1].slice(4))).toContainEqual(['commit', '--quiet', '--message', 'message']);
  });
  it('pushes the configured upstream only from a named branch', async () => {
    fake.exec.mockImplementation(async (_command: string, args: string[]) => {
      const operation = args.slice(4).join(' ');
      if (operation === 'rev-parse --show-toplevel') return { stdout: '/repo\n' };
      if (operation === 'status --porcelain=v1 -z --untracked-files=all') return { stdout: '' };
      if (operation === 'symbolic-ref --short -q HEAD') return { stdout: 'main\n' };
      if (operation === 'push --quiet') return { stdout: '' };
      throw new Error(`unexpected git command: ${operation}`);
    });
    await adapter().pushChanges('/cwd');
    expect(fake.exec.mock.calls.map(call => call[1].slice(4))).toContainEqual(['push', '--quiet']);
  });
  it('construction has zero repository IO; root strips only one newline, branch trims end, clock belongs to adapter', async () => {
    const subject = adapter(); expect(fake.exec).not.toHaveBeenCalled(); expect(fake.lstat).not.toHaveBeenCalled();
    fake.exec.mockResolvedValueOnce({ stdout: '/repo\n\r\n' }).mockResolvedValueOnce({ stdout: 'MM hello world\0R  new\nname\0old\nname\0?? 图片\0' }).mockResolvedValueOnce({ stdout: ' branch \n' });
    expect(await subject.captureSnapshot('/cwd')).toEqual({ root: '/repo\n', branch: ' branch', files: [{ path: 'hello world', index: 'M', worktree: 'M' }, { path: 'new\nname', originalPath: 'old\nname', index: 'R', worktree: ' ' }, { path: '图片', index: '?', worktree: '?' }], capturedAt: 'clock-at-capture' });
    const commands = [['rev-parse', '--show-toplevel'], ['status', '--porcelain=v1', '-z', '--untracked-files=all'], ['symbolic-ref', '--short', '-q', 'HEAD']];
    expect(fake.exec.mock.calls).toEqual(commands.map((args, i) => ['git', [...prefix, ...args], { cwd: i === 0 ? '/cwd' : '/repo\n', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' }, encoding: 'utf8', timeout: 10000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }]));
  });
  it('starts status and branch concurrently after root, falls back only on branch failure', async () => {
    let finish!: (value: { stdout: string }) => void;
    let fallbackStarted!: () => void; const fallback = new Promise<void>(done => { fallbackStarted = done; });
    fake.exec.mockResolvedValueOnce({ stdout: '/repo\n' }).mockImplementationOnce(() => new Promise(done => { finish = done; })).mockRejectedValueOnce(new Error('detached')).mockImplementationOnce(async () => { fallbackStarted(); return { stdout: 'abc123\n' }; });
    const pending = adapter().captureSnapshot('/cwd'); await fallback;
    expect(fake.exec.mock.calls.map(call => call[1].slice(4))).toContainEqual(['rev-parse', '--short', 'HEAD']);
    finish({ stdout: '' }); expect((await pending).branch).toBe('abc123');
  });
  it('retains empty branch fallback and propagates root/status/fallback failures', async () => {
    fake.exec.mockResolvedValueOnce({ stdout: '/repo\n' }).mockResolvedValueOnce({ stdout: '' }).mockResolvedValueOnce({ stdout: ' \n' });
    expect((await adapter().captureSnapshot('/cwd')).branch).toBe('detached HEAD');
    const error = new Error('not repo'); fake.exec.mockRejectedValueOnce(error); await expect(adapter().captureSnapshot('/cwd')).rejects.toBe(error);
    fake.exec.mockResolvedValueOnce({ stdout: '/repo' }).mockRejectedValueOnce(error).mockResolvedValueOnce({ stdout: 'main' }); await expect(adapter().captureSnapshot('/cwd')).rejects.toBe(error);
    fake.exec.mockResolvedValueOnce({ stdout: '/repo' }).mockResolvedValueOnce({ stdout: '' }).mockRejectedValueOnce(error).mockRejectedValueOnce(error); await expect(adapter().captureSnapshot('/cwd')).rejects.toBe(error);
  });
  it('parses raw NUL records, copy/rename on either column, whitespace and unknown states', () => {
    expect(parseStatus('\0 C dest \n\0 source \n\0X! -dash\0')).toEqual([{ path: 'dest \n', originalPath: ' source \n', index: ' ', worktree: 'C' }, { path: '-dash', index: 'X', worktree: '!' }]);
    expect(() => parseStatus('bad\0')).toThrow('无法解析 Git 状态'); expect(() => parseStatus('MMxname\0')).toThrow('无法解析 Git 状态'); expect(() => parseStatus('R  dest\0')).toThrow('Git 重命名状态缺少原路径');
  });
  it.each(['index', 'worktree'] as const)('keeps readonly flags, destination/source order, literal leading dash and %s scope', async scope => {
    fake.exec.mockResolvedValue({ stdout: 'patch' });
    expect(await adapter().readAuthorizedPreview({ ...tracked, scope })).toEqual({ text: 'patch', kind: 'diff', truncated: false });
    expect(fake.exec).toHaveBeenCalledExactlyOnceWith('git', [...prefix, 'diff', '--no-ext-diff', '--no-textconv', '--no-color', '--ignore-submodules=all', ...(scope === 'index' ? ['--cached'] : []), '--', '-new\n图片', 'old\nname'], { cwd: '/repo', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' }, encoding: 'utf8', timeout: 10000, maxBuffer: 200001, windowsHide: true });
    expect(fake.open).not.toHaveBeenCalled();
  });
  it('keeps binary/empty text classification and UTF-16 slice units', async () => {
    fake.exec.mockResolvedValueOnce({ stdout: 'header\nBinary files a and b differ\n' }).mockResolvedValueOnce({ stdout: '' }).mockResolvedValueOnce({ stdout: '😀'.repeat(100001) });
    expect((await adapter().readAuthorizedPreview(tracked)).kind).toBe('binary');
    expect((await adapter().readAuthorizedPreview(tracked)).text).toBe('没有可显示的文本差异（文件可能已变化，或为子模块）。');
    expect(await adapter().readAuthorizedPreview(tracked)).toEqual({ kind: 'diff', text: '😀'.repeat(100000), truncated: true });
  });
  it('overflow keeps the original bounded prefix, forces truncation, and remains diff even for binary text', async () => {
    for (const stdout of ['Binary files a and b differ', 'prefix' + 'x'.repeat(220000)]) {
      fake.exec.mockRejectedValueOnce({ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', message: 'stdout maxBuffer exceeded', stdout });
      expect(await adapter().readAuthorizedPreview(tracked)).toEqual({ text: stdout.slice(0, 200000), kind: 'diff', truncated: true });
    }
  });
  it.each([
    { code: 'OTHER', message: 'stdout', stdout: 'prefix' },
    { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', message: 'stderr', stdout: 'prefix' },
    { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', message: 'stdout', stdout: Buffer.from('prefix') },
    { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', stdout: 'prefix' },
  ])('propagates non-stdout-overflow rejection unchanged: %j', async error => {
    fake.exec.mockRejectedValueOnce(error); await expect(adapter().readAuthorizedPreview(tracked)).rejects.toBe(error);
  });
  it('real application rejects lost membership before adapter path checks and performs no retry', async () => {
    fake.exec.mockResolvedValueOnce({ stdout: '/repo' }).mockResolvedValueOnce({ stdout: '' }).mockResolvedValueOnce({ stdout: 'main' });
    await expect(new ChangeReviewApplication(adapter()).preview({ cwd: '/cwd', path: '../outside', scope: 'worktree' })).rejects.toMatchObject({ code: 'STATUS_CHANGED' });
    expect(fake.lstat).not.toHaveBeenCalled(); expect(fake.exec).toHaveBeenCalledTimes(3);
  });
});

describe('GitReviewAdapter untracked safety and resource sequence with memory descriptors', () => {
  it('preserves lstat/realpath/open/identity/read/close order and read limit units', async () => {
    const h = memoryFile(); expect(await adapter().readAuthorizedPreview(untracked)).toEqual({ text: 'safe', kind: 'untracked', truncated: false });
    expect(h.sequence).toEqual(['lstat:/repo/nested/file', 'realpath:/repo', 'realpath:/repo/nested/file', 'open:/repo/nested/file', 'stat', 'lstat:/repo/nested/file', 'realpath:/repo/nested/file', 'read', 'close']); expect(h.fd.close).toHaveBeenCalledOnce();
  });
  it.each(['../outside', '/outside', '..'])('lexically rejects %s before lstat', async path => {
    await expect(adapter().readAuthorizedPreview({ ...untracked, path })).rejects.toThrow('文件不在当前仓库内'); expect(fake.lstat).not.toHaveBeenCalled(); expect(fake.open).not.toHaveBeenCalled();
  });
  it('returns symlink target text without following even an outside target', async () => {
    fake.lstat.mockResolvedValue(info({ isSymbolicLink: () => true })); fake.readlink.mockResolvedValue('/private\nsecret');
    expect(await adapter().readAuthorizedPreview(untracked)).toEqual({ text: '符号链接 → /private\nsecret', kind: 'symlink', truncated: false }); expect(fake.realpath).not.toHaveBeenCalled(); expect(fake.open).not.toHaveBeenCalled();
  });
  it('rejects initial non-files, realpath escape and sibling prefix escape before open', async () => {
    memoryFile(); fake.lstat.mockResolvedValueOnce(info({ isFile: () => false })); await expect(adapter().readAuthorizedPreview(untracked)).rejects.toThrow('此路径不是普通文件');
    for (const outside of ['/outside/file', '/repo-other/file']) {
      fake.realpath.mockResolvedValueOnce('/repo').mockResolvedValueOnce(outside); await expect(adapter().readAuthorizedPreview(untracked)).rejects.toThrow('预览路径已移出仓库，请刷新。');
    }
    expect(fake.open).not.toHaveBeenCalled();
  });
  it.each(['symlink', 'ancestor escape', 'descriptor non-file', 'initial dev', 'initial ino', 'current dev', 'current ino'])('rejects %s before read and closes exactly once', async race => {
    const h = memoryFile();
    if (race === 'symlink') fake.lstat.mockResolvedValueOnce(info()).mockResolvedValueOnce(info({ isSymbolicLink: () => true }));
    if (race === 'ancestor escape') fake.realpath.mockResolvedValueOnce('/repo').mockResolvedValueOnce('/repo/nested/file').mockResolvedValueOnce('/private/file');
    if (race === 'descriptor non-file') h.fd.stat.mockResolvedValueOnce(info({ isFile: () => false }));
    if (race === 'initial dev') fake.lstat.mockResolvedValueOnce(info({ dev: 9 }));
    if (race === 'initial ino') fake.lstat.mockResolvedValueOnce(info({ ino: 9 }));
    if (race === 'current dev') fake.lstat.mockResolvedValueOnce(info()).mockResolvedValueOnce(info({ dev: 9 }));
    if (race === 'current ino') fake.lstat.mockResolvedValueOnce(info()).mockResolvedValueOnce(info({ ino: 9 }));
    await expect(adapter().readAuthorizedPreview(untracked)).rejects.toThrow('预览文件在读取前发生变化，请刷新。'); expect(h.fd.read).not.toHaveBeenCalled(); expect(h.fd.close).toHaveBeenCalledOnce();
  });
  it.each(['stat', 'lstat', 'realpath', 'read'])('closes on post-open %s rejection and propagates unchanged', async stage => {
    const h = memoryFile(); const error = new Error(stage);
    if (stage === 'stat') h.fd.stat.mockRejectedValueOnce(error);
    if (stage === 'lstat') fake.lstat.mockResolvedValueOnce(info()).mockRejectedValueOnce(error);
    if (stage === 'realpath') fake.realpath.mockResolvedValueOnce('/repo').mockResolvedValueOnce('/repo/nested/file').mockRejectedValueOnce(error);
    if (stage === 'read') h.fd.read.mockRejectedValueOnce(error);
    await expect(adapter().readAuthorizedPreview(untracked)).rejects.toBe(error); expect(h.fd.close).toHaveBeenCalledOnce(); if (stage !== 'read') expect(h.fd.read).not.toHaveBeenCalled();
  });
  it('open rejection (including O_NOFOLLOW final-link replacement) does not invent a descriptor to close', async () => {
    const h = memoryFile(); const error = Object.assign(new Error('ELOOP'), { code: 'ELOOP' }); fake.open.mockRejectedValueOnce(error);
    await expect(adapter().readAuthorizedPreview(untracked)).rejects.toBe(error); expect(h.fd.close).not.toHaveBeenCalled(); expect(h.fd.read).not.toHaveBeenCalled();
  });
  it('binary returns no text and false truncation even when initial size exceeds limit, still closes', async () => {
    const h = memoryFile(Buffer.from([65, 0, 66])); fake.lstat.mockResolvedValueOnce(info({ size: 999999 }));
    expect(await adapter().readAuthorizedPreview(untracked)).toEqual({ text: '二进制文件不提供文本预览。', kind: 'binary', truncated: false }); expect(h.fd.close).toHaveBeenCalledOnce();
  });
  it('decodes only the byte prefix, preserving UTF-8 replacement and initial-size truncation', async () => {
    const bytes = Buffer.concat([Buffer.from('a'), Buffer.from('你'.repeat(70000))]); const h = memoryFile(bytes);
    const result = await adapter().readAuthorizedPreview(untracked); expect(result.text).toBe(bytes.subarray(0, 200001).toString('utf8').slice(0, 200000)); expect(result.text.endsWith('�')).toBe(true); expect(result.truncated).toBe(true); expect(h.fd.close).toHaveBeenCalledOnce();
    memoryFile(Buffer.from('short')); fake.lstat.mockResolvedValueOnce(info({ size: 200001 })); expect((await adapter().readAuthorizedPreview(untracked)).truncated).toBe(true);
  });
  it('close rejection overrides both a successful preview and an earlier read failure (old finally semantics)', async () => {
    for (const failRead of [false, true]) {
      const h = memoryFile(); const error = new Error('close failed'); h.fd.close.mockRejectedValueOnce(error); if (failRead) h.fd.read.mockRejectedValueOnce(new Error('read failed'));
      await expect(adapter().readAuthorizedPreview(untracked)).rejects.toBe(error); expect(h.fd.close).toHaveBeenCalledOnce();
    }
  });
});
