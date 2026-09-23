export interface ChangedFile {
  path: string;
  originalPath?: string;
  index: string;
  worktree: string;
}
export interface GitStatus {
  root: string;
  branch: string;
  files: ChangedFile[];
  capturedAt: string;
}
export interface GitBranches {
  current: string;
  branches: string[];
}
export type DiffScope = 'worktree' | 'index';

export interface FileDiff {
  text: string;
  kind: 'diff' | 'untracked' | 'binary' | 'symlink';
  truncated: boolean;
}
