import { describe, expect, it } from 'vitest';
import { ReviewFailure, reviewFilesForScope, type RepositorySnapshot } from '../../../../src/modules/change-review/index';
import { repositorySnapshotDTO, reviewPreviewDTO, reviewScopeInput, reviewError } from '../../../../src/platform/electron/ipc/change-review-mapper';
import { filesForScope } from '../../../../src/shared/git';

describe('Change Review IPC projection', () => {
  it('matches the frozen renderer projection for all status character combinations without sharing core policy', () => {
    const chars = [' ', '?', '!', 'M', 'A', 'D', 'R', 'C', 'U', 'T', 'X', '\n'];
    const files = chars.flatMap(index => chars.map(worktree => ({ path: `${index}:${worktree}`, index, worktree })));
    const snapshot: RepositorySnapshot = { root: '/repo', branch: 'main', capturedAt: 'now', files };
    for (const scope of ['index', 'worktree'] as const) {
      expect(reviewScopeInput(scope)).toBe(scope);
      expect(reviewFilesForScope(files, scope)).toEqual(filesForScope(repositorySnapshotDTO(snapshot).files, scope));
    }
  });
  it('maps every field and creates detached mutable wire containers', () => {
    const snapshot: RepositorySnapshot = { root: '/repo\n', branch: 'branch', capturedAt: 'time', files: [{ path: '-new\n图片', originalPath: 'old\nfile', index: 'R', worktree: 'M' }, { path: 'empty-original', originalPath: '', index: 'C', worktree: ' ' }, { path: 'new', index: '?', worktree: '?' }] };
    const dto = repositorySnapshotDTO(snapshot); expect(dto).toEqual(snapshot); expect(dto).not.toBe(snapshot); expect(dto.files).not.toBe(snapshot.files); expect(dto.files[0]).not.toBe(snapshot.files[0]); expect(dto.files[2]).not.toHaveProperty('originalPath');
    dto.files[0].path = 'caller mutation'; expect(snapshot.files[0].path).toBe('-new\n图片');
    for (const kind of ['diff', 'untracked', 'binary', 'symlink'] as const) expect(reviewPreviewDTO({ text: 'text', kind, truncated: true })).toEqual({ text: 'text', kind, truncated: true });
  });
  it('maps stable business codes to exact old Chinese errors and leaves platform failures untouched', () => {
    expect(() => reviewError(new ReviewFailure('INVALID_SCOPE'))).toThrow('未知 diff 范围');
    expect(() => reviewError(new ReviewFailure('STATUS_CHANGED'))).toThrow('文件状态已变化，请刷新变更列表。');
    const error = new Error('Git/fs failure'); let caught: unknown;
    try { reviewError(error); } catch (actual) { caught = actual; }
    expect(caught).toBe(error);
  });
});
