import type { AuthorizedPreview, RepositorySnapshot, ReviewPreview } from './domain/review.js';

export interface ReviewRepositoryPort {
  captureSnapshot(cwd: string): Promise<RepositorySnapshot>;
  readAuthorizedPreview(selection: AuthorizedPreview): Promise<ReviewPreview>;
}
