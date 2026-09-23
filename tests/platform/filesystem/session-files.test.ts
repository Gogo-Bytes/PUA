import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { listSessionFiles, readSessionFile } from '../../../src/platform/filesystem/session-files';

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pua-session-files-'));
  roots.push(root);
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'README.md'), 'hello\n');
  await writeFile(path.join(root, 'src', 'index.ts'), 'export const ok = true;\n');
  return root;
}

afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe('session file access', () => {
  it('lists sorted immediate regular files and directories, then previews bounded text', async () => {
    const root = await fixture();
    expect(await listSessionFiles(root, '')).toEqual({ path: '', truncated: false, entries: [
      { name: 'src', path: 'src', kind: 'directory' }, { name: 'README.md', path: 'README.md', kind: 'file' },
    ] });
    expect(await listSessionFiles(root, 'src')).toEqual({ path: 'src', truncated: false, entries: [{ name: 'index.ts', path: 'src/index.ts', kind: 'file' }] });
    expect(await readSessionFile(root, 'src/index.ts')).toEqual({ path: 'src/index.ts', text: 'export const ok = true;\n', truncated: false });
  });

  it('rejects traversal and does not list or read symlinks', async () => {
    const root = await fixture();
    const outside = await mkdtemp(path.join(os.tmpdir(), 'pua-session-outside-'));
    roots.push(outside);
    await writeFile(path.join(outside, 'secret.txt'), 'secret');
    await symlink(outside, path.join(root, 'escape'), 'dir');
    expect((await listSessionFiles(root, '')).entries.map(entry => entry.name)).not.toContain('escape');
    await expect(listSessionFiles(root, '../')).rejects.toThrow('无效目录路径');
    await expect(listSessionFiles(root, 'escape')).rejects.toThrow();
    await expect(readSessionFile(root, 'escape/secret.txt')).rejects.toThrow();
    await expect(readSessionFile(root, '../secret.txt')).rejects.toThrow('无效文件路径');
  });

  it('refuses binary content and caps preview reads', async () => {
    const root = await fixture();
    await writeFile(path.join(root, 'binary.bin'), Buffer.from([0, 1, 2]));
    await writeFile(path.join(root, 'large.txt'), 'a'.repeat(300 * 1024));
    await expect(readSessionFile(root, 'binary.bin')).rejects.toThrow('不支持预览二进制文件');
    const preview = await readSessionFile(root, 'large.txt');
    expect(preview.text).toHaveLength(256 * 1024);
    expect(preview.truncated).toBe(true);
  });
});
