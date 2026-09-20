import { constants } from 'node:fs';
import { lstat, open, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { PersistedChatSession } from './workspace-session-store.js';

const HEADER_LIMIT = 64 * 1024;

interface VerifiedSessionFile {
  size: number;
  dev: number | bigint;
  ino: number | bigint;
}

const sameIdentity = (left: { dev: number | bigint; ino: number | bigint }, right: { dev: number | bigint; ino: number | bigint }) =>
  left.dev === right.dev && left.ino === right.ino;

function validateHeader(text: string, record: PersistedChatSession): void {
  const line = text.split(/\r?\n/, 1)[0];
  let value: unknown;
  try { value = JSON.parse(line); }
  catch { throw new Error('Pi 会话文件头无效'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Pi 会话文件头无效');
  const header = value as Record<string, unknown>;
  if (header.type !== 'session' || header.id !== record.piSessionId || header.cwd !== record.cwd) {
    throw new Error('Pi 会话文件与任务索引不匹配');
  }
}

async function withVerifiedFile<T>(record: PersistedChatSession, read: (handle: Awaited<ReturnType<typeof open>>, verified: VerifiedSessionFile) => Promise<T>): Promise<T> {
  const linked = await lstat(record.sessionFile);
  if (!linked.isFile() || linked.isSymbolicLink()) throw new Error('Pi 会话路径不是普通文件');
  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
  const handle = await open(record.sessionFile, constants.O_RDONLY | noFollow);
  try {
    const actual = await handle.stat();
    if (!actual.isFile() || !sameIdentity(linked, actual)) throw new Error('Pi 会话文件在验证期间已变化');
    const header = Buffer.alloc(Math.min(HEADER_LIMIT, Math.max(1, actual.size)));
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    validateHeader(header.subarray(0, bytesRead).toString('utf8'), record);
    return await read(handle, { size: actual.size, dev: actual.dev, ino: actual.ino });
  } finally { await handle.close(); }
}

export function verifyPiSessionFile(record: PersistedChatSession): Promise<VerifiedSessionFile> {
  return withVerifiedFile(record, async (_handle, verified) => verified);
}

export function readVerifiedPiSessionFile(record: PersistedChatSession, maxBytes: number, afterVerify?: () => void | Promise<void>): Promise<{ content: string; size: number }> {
  return withVerifiedFile(record, async (handle, verified) => {
    if (verified.size > maxBytes) throw new Error('Pi 会话文件过大');
    await afterVerify?.();
    const bytes = Buffer.alloc(verified.size);
    let offset = 0;
    while (offset < verified.size) {
      const result = await handle.read(bytes, offset, verified.size - offset, offset);
      if (!result.bytesRead) break;
      offset += result.bytesRead;
    }
    return { content: bytes.subarray(0, offset).toString('utf8'), size: offset };
  });
}

/** Rename on the same filesystem, commit metadata, then unlink. Every failure before
 * final unlink restores both the original pathname and durable index when possible. */
export async function permanentlyDeleteVerifiedPiSession(
  record: PersistedChatSession,
  commit: () => Promise<void>,
  rollback: () => Promise<void>,
  operations: Pick<typeof import('node:fs/promises'), 'lstat' | 'rename' | 'unlink'> = { lstat, rename, unlink },
): Promise<void> {
  let verified: VerifiedSessionFile;
  try { verified = await verifyPiSessionFile(record); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') { await commit(); return; }
    throw error;
  }
  const tombstone = `${record.sessionFile}.pua-delete-${randomUUID()}`;
  await operations.rename(record.sessionFile, tombstone);
  try {
    const moved = await operations.lstat(tombstone);
    if (!moved.isFile() || moved.isSymbolicLink() || !sameIdentity(verified, moved)) throw new Error('Pi 会话文件在删除期间已变化');
    await commit();
  } catch (error) {
    try { await operations.rename(tombstone, record.sessionFile); }
    catch (restoreError) { throw new Error(`删除未提交，且 Pi 会话文件回滚失败：${String(restoreError)}`, { cause: error }); }
    throw error;
  }
  try { await operations.unlink(tombstone); }
  catch (error) {
    let pathError: unknown; let indexError: unknown;
    try { await operations.rename(tombstone, record.sessionFile); } catch (restoreError) { pathError = restoreError; }
    try { await rollback(); } catch (restoreError) { indexError = restoreError; }
    if (pathError || indexError) throw new Error(`Pi 会话清理回滚不完整：文件=${pathError ? String(pathError) : '已恢复'}；索引=${indexError ? String(indexError) : '已恢复'}`, { cause: error });
    throw error;
  }
}
