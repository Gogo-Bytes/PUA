import { describe, expect, it, vi } from 'vitest';
import { ChangeReviewApplication, ReviewFailure, type ReviewRepositoryPort, type RepositorySnapshot, type ReviewScope } from '../../../src/modules/change-review/index';

function harness() {
  const snapshot: RepositorySnapshot = { root: '/repo', branch: 'main', capturedAt: 'observed', files: [{ path: 'new\nname', originalPath: 'old\nname', index: 'R', worktree: ' ' }, { path: '-new', index: '?', worktree: '?' }] };
  const port = { captureSnapshot: vi.fn<ReviewRepositoryPort['captureSnapshot']>().mockResolvedValue(snapshot), readAuthorizedPreview: vi.fn<ReviewRepositoryPort['readAuthorizedPreview']>().mockResolvedValue({ text: 'preview', kind: 'diff', truncated: false }), listBranches: vi.fn<ReviewRepositoryPort['listBranches']>().mockResolvedValue(['main']), switchBranch: vi.fn<ReviewRepositoryPort['switchBranch']>(), createBranch: vi.fn<ReviewRepositoryPort['createBranch']>(), deleteBranch: vi.fn<ReviewRepositoryPort['deleteBranch']>(), listWorktrees: vi.fn<ReviewRepositoryPort['listWorktrees']>().mockResolvedValue({ current: '/repo', worktrees: [{ path: '/repo', head: 'abc', branch: 'main', current: true }] }), createWorktree: vi.fn<ReviewRepositoryPort['createWorktree']>().mockResolvedValue({ current: '/repo', worktrees: [{ path: '/repo', head: 'abc', branch: 'main', current: true }] }), deleteWorktree: vi.fn<ReviewRepositoryPort['deleteWorktree']>().mockResolvedValue({ current: '/repo', worktrees: [{ path: '/repo', head: 'abc', branch: 'main', current: true }] }) };
  return { snapshot, port, review: new ChangeReviewApplication(port) };
}
describe('ChangeReviewApplication fresh membership authorization', () => {
  it('rejects invalid scope before any port effect with a stable domain failure', async () => {
    const h = harness(); await expect(h.review.preview({ cwd: '/cwd', path: '-new', scope: 'bad' as ReviewScope })).rejects.toEqual(new ReviewFailure('INVALID_SCOPE'));
    expect(h.port.captureSnapshot).not.toHaveBeenCalled(); expect(h.port.readAuthorizedPreview).not.toHaveBeenCalled();
  });
  it('passes observations through, without adding a cache or a clock', async () => {
    const h = harness(); expect(await h.review.snapshot('/cwd')).toBe(h.snapshot); expect(h.port.captureSnapshot).toHaveBeenCalledExactlyOnceWith('/cwd');
  });
  it('uses destination membership and passes rename source only for the authorized tracked diff', async () => {
    const h = harness(); await h.review.preview({ cwd: '/cwd', path: 'new\nname', scope: 'index' });
    expect(h.port.readAuthorizedPreview).toHaveBeenCalledExactlyOnceWith({ kind: 'tracked', root: '/repo', path: 'new\nname', originalPath: 'old\nname', scope: 'index' });
  });
  it.each(['old\nname', '../outside', 'missing'])('rejects absent destination %s before reading', async path => {
    const h = harness(); await expect(h.review.preview({ cwd: '/cwd', path, scope: 'index' })).rejects.toMatchObject({ code: 'STATUS_CHANGED' }); expect(h.port.readAuthorizedPreview).not.toHaveBeenCalled();
  });
  it('scope changes and lost membership are checked against each latest snapshot', async () => {
    const h = harness(); await h.review.preview({ cwd: '/cwd', path: '-new', scope: 'worktree' });
    expect(h.port.readAuthorizedPreview).toHaveBeenCalledExactlyOnceWith({ kind: 'untracked', root: '/repo', path: '-new' });
    await expect(h.review.preview({ cwd: '/cwd', path: '-new', scope: 'index' })).rejects.toMatchObject({ code: 'STATUS_CHANGED' });
    h.port.captureSnapshot.mockResolvedValue({ ...h.snapshot, files: [] });
    await expect(h.review.preview({ cwd: '/cwd', path: '-new', scope: 'worktree' })).rejects.toMatchObject({ code: 'STATUS_CHANGED' });
    expect(h.port.captureSnapshot).toHaveBeenCalledTimes(3); expect(h.port.readAuthorizedPreview).toHaveBeenCalledOnce();
  });
  it('awaits snapshot before read, propagates port failures without retry', async () => {
    const h = harness(); let resolve!: (value: RepositorySnapshot) => void;
    h.port.captureSnapshot.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const input = { cwd: '/cwd', path: '-new', scope: 'worktree' as const };
    const pending = h.review.preview(input); expect(h.port.readAuthorizedPreview).not.toHaveBeenCalled();
    input.path = 'caller-changed'; resolve(h.snapshot); await pending;
    expect(h.port.readAuthorizedPreview).toHaveBeenCalledExactlyOnceWith({ kind: 'untracked', root: '/repo', path: '-new' });
    const error = new Error('IO failed'); h.port.captureSnapshot.mockRejectedValueOnce(error);
    await expect(h.review.preview({ cwd: '/cwd', path: '-new', scope: 'worktree' })).rejects.toBe(error);
    h.port.readAuthorizedPreview.mockRejectedValueOnce(error);
    await expect(h.review.preview({ cwd: '/cwd', path: '-new', scope: 'worktree' })).rejects.toBe(error);
    expect(h.port.captureSnapshot).toHaveBeenCalledTimes(3); expect(h.port.readAuthorizedPreview).toHaveBeenCalledTimes(2);
  });
});
