import type { ChangedFile } from '../../../shared/git';

type ConflictStatus = Pick<ChangedFile, 'index' | 'worktree'>;
/** Multi-parent/unmerged output is raw, not a two-sided unified comparison. */
export function isConflictPatch(text: string, status?: ConflictStatus): boolean {
  return /^(?:diff --(?:cc|combined) |@@@|\* Unmerged path )/m.test(text)
    || !!status && ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(status.index + status.worktree);
}

export interface DiffLine { kind: 'meta' | 'hunk' | 'context' | 'addition' | 'deletion'; text: string; old?: number; next?: number; }
/** Only hunk bodies carry file line numbers. Headers and binary metadata are not changes. */
export function parseDiffLines(text: string, status?: ConflictStatus): DiffLine[] {
  if (isConflictPatch(text, status)) return text.split('\n').map(line => ({ kind: 'meta', text: line }));
  let old = 0, next = 0, oldRemaining = 0, nextRemaining = 0;
  return text.split('\n').map(line => {
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      old = Number(hunk[1]); next = Number(hunk[3]);
      oldRemaining = Number(hunk[2] ?? 1); nextRemaining = Number(hunk[4] ?? 1);
      return { kind: 'hunk', text: line };
    }
    if (line.startsWith('-') && oldRemaining > 0) { oldRemaining--; return { kind: 'deletion', text: line.slice(1), old: old++ }; }
    if (line.startsWith('+') && nextRemaining > 0) { nextRemaining--; return { kind: 'addition', text: line.slice(1), next: next++ }; }
    if (line.startsWith(' ') && oldRemaining > 0 && nextRemaining > 0) { oldRemaining--; nextRemaining--; return { kind: 'context', text: line.slice(1), old: old++, next: next++ }; }
    return { kind: 'meta', text: line };
  });
}
