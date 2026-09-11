import type { ChangedFile, DiffScope } from '../../../shared/ipc/change-review';

export function filesForScope(files: ChangedFile[], scope: DiffScope): ChangedFile[] {
  return files.filter(file => scope === 'index' ? ![' ', '?', '!'].includes(file.index) : file.index === '?' || file.worktree !== ' ');
}
