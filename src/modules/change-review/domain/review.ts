export type ReviewScope = 'index' | 'worktree';
export interface ReviewFile {
  readonly path: string;
  readonly originalPath?: string;
  readonly index: string;
  readonly worktree: string;
}
/** An observation, not a transaction with a subsequent preview. */
export interface RepositorySnapshot {
  readonly root: string;
  readonly branch: string;
  readonly files: readonly ReviewFile[];
  readonly capturedAt: string;
}
export interface ReviewPreview {
  readonly text: string;
  readonly kind: 'diff' | 'untracked' | 'binary' | 'symlink';
  readonly truncated: boolean;
}
/** In-process membership decision, not an OS credential or unforgeable token. */
export type AuthorizedPreview =
  | { readonly kind: 'untracked'; readonly root: string; readonly path: string }
  | { readonly kind: 'tracked'; readonly root: string; readonly path: string; readonly originalPath?: string; readonly scope: ReviewScope };

export class ReviewFailure extends Error {
  constructor(readonly code: 'INVALID_SCOPE' | 'STATUS_CHANGED') { super(code); }
}
export function reviewScope(scope: unknown): ReviewScope {
  if (scope !== 'worktree' && scope !== 'index') throw new ReviewFailure('INVALID_SCOPE');
  return scope;
}
export function reviewFilesForScope(files: readonly ReviewFile[], scope: ReviewScope): ReviewFile[] {
  return files.filter(file => scope === 'index' ? ![' ', '?', '!'].includes(file.index) : file.index === '?' || file.worktree !== ' ');
}
export function authorizePreview(snapshot: RepositorySnapshot, path: string, scope: ReviewScope): AuthorizedPreview {
  const file = reviewFilesForScope(snapshot.files, scope).find(file => file.path === path);
  if (!file) throw new ReviewFailure('STATUS_CHANGED');
  return file.index === '?' && scope === 'worktree'
    ? { kind: 'untracked', root: snapshot.root, path: file.path }
    : { kind: 'tracked', root: snapshot.root, path: file.path, scope, ...(file.originalPath !== undefined ? { originalPath: file.originalPath } : {}) };
}
