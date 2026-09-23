import { constants } from 'node:fs';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { SessionFileListing } from '../../shared/ipc/desktop-api.js';

const MAX_ENTRIES = 500;
const MAX_DIRECTORY_SCAN = 10_000;

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

/** Read-only directory listing constrained to a session root; links and special files are omitted. */
export async function listSessionFiles(cwd: string, relativePath: string): Promise<SessionFileListing> {
  if (relativePath.startsWith('/') || relativePath.includes('\\') || /^[a-zA-Z]:/.test(relativePath) || (relativePath !== '' && relativePath.split('/').some(part => !part || part === '..' || part === '.'))) {
    throw new Error('无效目录路径');
  }
  const root = await realpath(cwd);
  if (!(await lstat(root)).isDirectory()) throw new Error('会话工作目录不可用');

  let current = root;
  for (const segment of relativePath ? relativePath.split('/') : []) {
    current = path.join(current, segment);
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('目录不存在或不可访问');
  }
  const canonical = await realpath(current);
  if (!isWithin(root, canonical) || !(await lstat(canonical)).isDirectory()) throw new Error('目录超出会话工作区范围');

  const entries: SessionFileListing['entries'] = [];
  const directory = await opendir(canonical);
  let scanned = 0;
  let truncated = false;
  for await (const item of directory) {
    scanned += 1;
    if (scanned > MAX_DIRECTORY_SCAN) { truncated = true; break; }
    const name = item.name;
    if (name === '.' || name === '..') continue;
    const fullPath = path.join(canonical, name);
    const info = await lstat(fullPath);
    if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) continue;
    const itemPath = relativePath ? `${relativePath}/${name}` : name;
    if (itemPath.length > 4096) continue;
    entries.push({ name, path: itemPath, kind: info.isDirectory() ? 'directory' : 'file' });
    if (entries.length > MAX_ENTRIES) { truncated = true; break; }
  }
  entries.sort((left, right) => Number(right.kind === 'directory') - Number(left.kind === 'directory') || left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' }));
  return { path: relativePath, entries: entries.slice(0, MAX_ENTRIES), truncated };
}

/** Preview bounded UTF-8 text only; binary files and links are never opened. */
export async function readSessionFile(cwd: string, relativePath: string): Promise<{ path: string; text: string; truncated: boolean }> {
  if (!relativePath || relativePath.startsWith('/') || relativePath.includes('\\') || /^[a-zA-Z]:/.test(relativePath) || relativePath.split('/').some(part => !part || part === '..' || part === '.')) throw new Error('无效文件路径');
  const root = await realpath(cwd);
  let current = root;
  for (const segment of relativePath.split('/')) {
    current = path.join(current, segment);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new Error('不支持预览符号链接');
  }
  const canonical = await realpath(current);
  if (!isWithin(root, canonical)) throw new Error('文件超出会话工作区范围');
  const info = await lstat(canonical);
  if (!info.isFile()) throw new Error('只能预览普通文件');
  const limit = 256 * 1024;
  const handle = await open(canonical, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const buffer = Buffer.alloc(limit + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const slice = buffer.subarray(0, Math.min(bytesRead, limit));
    if (slice.includes(0)) throw new Error('不支持预览二进制文件');
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: !((bytesRead > limit || info.size > limit)) }).decode(slice); }
    catch { throw new Error('文件不是有效的 UTF-8 文本'); }
    return { path: relativePath, text, truncated: bytesRead > limit || info.size > limit };
  } finally { await handle.close(); }
}
