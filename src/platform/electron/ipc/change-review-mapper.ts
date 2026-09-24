import { DesktopApplicationError } from '../../../app/main/application-error.js';
import { ReviewFailure, type RepositorySnapshot, type RepositoryWorktrees, type ReviewContents, type ReviewPreview, type ReviewScope } from '../../../modules/change-review/index.js';
import type { DiffScope, FileDiff, FileDiffContents, GitStatus, GitWorktrees } from '../../../shared/ipc/change-review.js';

export function reviewScopeInput(scope: DiffScope): ReviewScope { return scope; }
export function repositorySnapshotDTO(snapshot: RepositorySnapshot): GitStatus {
  return { root: snapshot.root, branch: snapshot.branch, capturedAt: snapshot.capturedAt, files: snapshot.files.map(file => ({
    path: file.path, index: file.index, worktree: file.worktree,
    ...(file.originalPath !== undefined ? { originalPath: file.originalPath } : {}),
  })) };
}
export function reviewPreviewDTO(preview: ReviewPreview): FileDiff {
  return { text: preview.text, kind: preview.kind, truncated: preview.truncated };
}
export function reviewContentsDTO(contents: ReviewContents): FileDiffContents { return contents; }
export function worktreesDTO(value: RepositoryWorktrees): GitWorktrees {
  return { current: value.current, worktrees: value.worktrees.map(item => ({ path: item.path, head: item.head, current: item.current, ...(item.branch !== undefined ? { branch: item.branch } : {}) })) };
}
export function reviewError(error: unknown): never {
  if (error instanceof ReviewFailure) throw new DesktopApplicationError(error.code, error.code === 'INVALID_SCOPE' ? '未知 diff 范围' : '文件状态已变化，请刷新变更列表。');
  throw error;
}
