import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { checkProtectedFiles } from '../scripts/check-protected';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'pua-protected-test-')); roots.push(root);
  for (const directory of ['src/renderer/ui', 'tests/component-preview']) mkdirSync(path.join(root, directory), { recursive: true });
  const files = ['src/renderer/ui/example.tsx', 'tests/component-preview/style.css', 'tests/component-example.test.tsx'];
  for (const file of files) writeFileSync(path.join(root, file), 'original');
  const manifest = Object.fromEntries(files.map(file => [file, createHash('sha256').update('original').digest('hex')]));
  return { root, files, manifest };
}
it('keeps the real frozen file set and content identical to the supplied manifest', () => {
  const manifest = JSON.parse(readFileSync(new URL('../scripts/refactor-protected-hashes.json', import.meta.url), 'utf8'));
  expect(Object.keys(manifest)).toHaveLength(35);
  expect(checkProtectedFiles(process.cwd(), manifest)).toEqual([]);
});
it.each(['change', 'add', 'delete', 'rename', 'symlink'])('detects protected file %s in every frozen area', operation => {
  for (let index = 0; index < 3; index++) {
    const { root, files, manifest } = fixture(); const file = files[index]; const absolute = path.join(root, file);
    expect(checkProtectedFiles(root, manifest)).toEqual([]);
    if (operation === 'change') writeFileSync(absolute, 'changed');
    if (operation === 'add') writeFileSync(index === 2 ? path.join(root, 'tests/component-added.test.tsx') : absolute + '.new', 'new');
    if (operation === 'delete') rmSync(absolute);
    if (operation === 'rename') renameSync(absolute, absolute + '.moved');
    if (operation === 'symlink') { rmSync(absolute); symlinkSync(path.join(root, files[(index + 1) % files.length]), absolute); }
    expect(checkProtectedFiles(root, manifest).length).toBeGreaterThan(0);
  }
});
