import { authorizePreview, reviewScope, type RepositorySnapshot, type ReviewPreview, type ReviewScope } from '../domain/review.js';
import type { ReviewRepositoryPort } from '../ports.js';

export interface ChangeReview {
  snapshot(cwd: string): Promise<RepositorySnapshot>;
  preview(input: { cwd: string; path: string; scope: ReviewScope }): Promise<ReviewPreview>;
}

export class ChangeReviewApplication implements ChangeReview {
  constructor(private readonly repository: ReviewRepositoryPort) {}
  snapshot(cwd: string): Promise<RepositorySnapshot> { return this.repository.captureSnapshot(cwd); }
  async preview(input: { cwd: string; path: string; scope: ReviewScope }): Promise<ReviewPreview> {
    const { cwd, path, scope: requestedScope } = input;
    const scope = reviewScope(requestedScope);
    const snapshot = await this.repository.captureSnapshot(cwd);
    return this.repository.readAuthorizedPreview(authorizePreview(snapshot, path, scope));
  }
}
