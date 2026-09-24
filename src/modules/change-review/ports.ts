import type { AuthorizedPreview, RepositorySnapshot, RepositoryWorktrees, ReviewContents, ReviewPreview } from './domain/review.js';

export interface ReviewRepositoryPort {
  captureSnapshot(cwd: string): Promise<RepositorySnapshot>;
  readAuthorizedPreview(selection: AuthorizedPreview): Promise<ReviewPreview>;
  readAuthorizedContents(selection: AuthorizedPreview): Promise<ReviewContents>;
  listBranches(cwd: string): Promise<string[]>;
  switchBranch(cwd: string, branch: string): Promise<void>;
  createBranch(cwd: string, branch: string): Promise<void>;
  deleteBranch(cwd: string, branch: string): Promise<void>;
  listWorktrees(cwd: string): Promise<RepositoryWorktrees>;
  createWorktree(cwd: string, branch: string): Promise<RepositoryWorktrees>;
  deleteWorktree(cwd: string, worktreePath: string): Promise<RepositoryWorktrees>;
  commitChanges(cwd: string, message: string): Promise<RepositorySnapshot>;
  pushChanges(cwd: string): Promise<RepositorySnapshot>;
}
