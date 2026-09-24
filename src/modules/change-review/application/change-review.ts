import { authorizePreview, reviewScope, type RepositorySnapshot, type RepositoryWorktrees, type ReviewPreview, type ReviewScope } from '../domain/review.js';
import type { ReviewRepositoryPort } from '../ports.js';

export interface ChangeReview {
  snapshot(cwd: string): Promise<RepositorySnapshot>;
  preview(input: { cwd: string; path: string; scope: ReviewScope }): Promise<ReviewPreview>;
  branches(cwd: string): Promise<string[]>;
  switchBranch(cwd: string, branch: string): Promise<void>;
  createBranch(cwd: string, branch: string): Promise<void>;
  deleteBranch(cwd: string, branch: string): Promise<void>;
  worktrees(cwd: string): Promise<RepositoryWorktrees>;
  createWorktree(cwd: string, branch: string): Promise<RepositoryWorktrees>;
  deleteWorktree(cwd: string, worktreePath: string): Promise<RepositoryWorktrees>;
}

export class ChangeReviewApplication implements ChangeReview {
  constructor(private readonly repository: ReviewRepositoryPort) {}
  snapshot(cwd: string): Promise<RepositorySnapshot> { return this.repository.captureSnapshot(cwd); }
  branches(cwd: string): Promise<string[]> { return this.repository.listBranches(cwd); }
  switchBranch(cwd: string, branch: string): Promise<void> { return this.repository.switchBranch(cwd, branch); }
  createBranch(cwd: string, branch: string): Promise<void> { return this.repository.createBranch(cwd, branch); }
  deleteBranch(cwd: string, branch: string): Promise<void> { return this.repository.deleteBranch(cwd, branch); }
  worktrees(cwd: string): Promise<RepositoryWorktrees> { return this.repository.listWorktrees(cwd); }
  createWorktree(cwd: string, branch: string): Promise<RepositoryWorktrees> { return this.repository.createWorktree(cwd, branch); }
  deleteWorktree(cwd: string, worktreePath: string): Promise<RepositoryWorktrees> { return this.repository.deleteWorktree(cwd, worktreePath); }
  async preview(input: { cwd: string; path: string; scope: ReviewScope }): Promise<ReviewPreview> {
    const { cwd, path, scope: requestedScope } = input;
    const scope = reviewScope(requestedScope);
    const snapshot = await this.repository.captureSnapshot(cwd);
    return this.repository.readAuthorizedPreview(authorizePreview(snapshot, path, scope));
  }
}
