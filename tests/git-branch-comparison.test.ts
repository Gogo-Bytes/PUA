import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ChangeReviewApplication } from '../src/modules/change-review/index';
import { GitReviewAdapter } from '../src/platform/git/review-adapter';

describe('committed current branch comparison', () => {
  it('uses the common ancestor, excludes uncommitted work, and authorizes only listed files', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'pua-branch-review-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
    const filename = process.platform === 'win32' ? 'name with spaces.txt' : 'name\nwith-newline.txt';
    try {
      git('init', '--initial-branch=main');
      git('config', 'user.name', 'PUA Test');
      git('config', 'user.email', 'pua@example.invalid');
      writeFileSync(path.join(root, filename), 'base\n');
      git('add', '--all');
      git('commit', '-m', 'base');
      const review = new ChangeReviewApplication(new GitReviewAdapter());
      expect((await review.compareBranch(root)).files).toEqual([]);

      git('switch', '-c', 'feature');
      writeFileSync(path.join(root, filename), 'feature\n');
      git('add', '--all');
      git('commit', '-m', 'feature');
      writeFileSync(path.join(root, 'uncommitted.txt'), 'not in branch diff\n');
      const comparison = await review.compareBranch(root);
      expect(path.normalize(comparison.root).toLowerCase()).toBe(path.normalize(realpathSync(root)).toLowerCase());
      expect(comparison).toMatchObject({ current: 'feature', baseline: 'main' });
      expect(comparison.files).toEqual([{ path: filename, index: 'M', worktree: ' ' }]);
      expect((await review.branchPreview(root, filename)).text).toContain('+feature');
      await expect(review.branchPreview(root, 'uncommitted.txt')).rejects.toThrow('状态已变化');
      await expect(review.branchPreview(root, '../outside')).rejects.toThrow('状态已变化');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
