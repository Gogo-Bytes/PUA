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
export type DiffScope = 'worktree' | 'index';
export function filesForScope(files: ChangedFile[], scope: DiffScope): ChangedFile[] {
  return files.filter(file => scope === 'index' ? ![' ', '?', '!'].includes(file.index) : file.index === '?' || file.worktree !== ' ');
}

export interface FileDiff {
  text: string;
  kind: 'diff' | 'untracked' | 'binary' | 'symlink';
  truncated: boolean;
}
