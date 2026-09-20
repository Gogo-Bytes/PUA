import { access, appendFile, lstat, mkdtemp, readFile, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { permanentlyDeleteVerifiedPiSession, readVerifiedPiSessionFile, verifyPiSessionFile } from '../../../src/app/main/pi-session-file';

let directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });

async function fixture(overrides: Partial<{ id: string; cwd: string; piSessionId: string }> = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pua-pi-session-')); directories.push(directory);
  const record = { id: overrides.id ?? 'task-1', cwd: overrides.cwd ?? '/workspace/app', title: '会话', piSessionId: overrides.piSessionId ?? 'pi-1', sessionFile: path.join(directory, 'session.jsonl'), archived: true };
  await writeFile(record.sessionFile, `${JSON.stringify({ type: 'session', id: 'pi-1', cwd: '/workspace/app' })}\n${JSON.stringify({ type: 'message', id: 'm1' })}\n`);
  return { directory, record };
}

describe('trusted Pi session file boundary', () => {
  it('reads only a regular file whose header matches the indexed Pi identity and cwd', async () => {
    const { directory, record } = await fixture();
    await expect(verifyPiSessionFile(record)).resolves.toMatchObject({ size: expect.any(Number) });
    await expect(readVerifiedPiSessionFile(record, 1024)).resolves.toMatchObject({ content: expect.stringContaining('"type":"message"'), size: expect.any(Number) });
    await expect(verifyPiSessionFile({ ...record, piSessionId: 'other' })).rejects.toThrow('任务索引不匹配');
    const link = path.join(directory, 'linked.jsonl'); await symlink(record.sessionFile, link);
    await expect(verifyPiSessionFile({ ...record, sessionFile: link })).rejects.toThrow('不是普通文件');
  });

  it('reads the verified descriptor only up to the size captured during validation', async () => {
    const { record } = await fixture();
    const before = await readFile(record.sessionFile);
    const snapshot = await readVerifiedPiSessionFile(record, 1024, () => appendFile(record.sessionFile, '{"type":"message","id":"late"}\n'));
    expect(snapshot.size).toBe(before.byteLength);
    expect(snapshot.content).not.toContain('"id":"late"');
  });

  it('restores the original pathname when durable index removal fails', async () => {
    const { record } = await fixture();
    const rollback = vi.fn().mockResolvedValue(undefined);
    await expect(permanentlyDeleteVerifiedPiSession(record, vi.fn().mockRejectedValue(new Error('index denied')), rollback)).rejects.toThrow('index denied');
    await expect(access(record.sessionFile)).resolves.toBeUndefined();
    expect(await readFile(record.sessionFile, 'utf8')).toContain('"id":"pi-1"');
    expect(rollback).not.toHaveBeenCalled();
  });

  it('removes the verified file only after the durable index commit succeeds', async () => {
    const { record } = await fixture(); const order: string[] = [];
    await permanentlyDeleteVerifiedPiSession(record, async () => { order.push('commit'); }, async () => { order.push('rollback'); });
    await expect(access(record.sessionFile)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(order).toEqual(['commit']);
  });

  it('restores the pathname even when index rollback fails after final unlink failure', async () => {
    const { record } = await fixture();
    const operations = { lstat, rename, unlink: vi.fn().mockRejectedValue(new Error('unlink denied')) };
    await expect(permanentlyDeleteVerifiedPiSession(
      record,
      vi.fn().mockResolvedValue(undefined),
      vi.fn().mockRejectedValue(new Error('index rollback denied')),
      operations,
    )).rejects.toThrow('index rollback denied');
    await expect(access(record.sessionFile)).resolves.toBeUndefined();
  });

  it('attempts index rollback even when restoring the pathname fails', async () => {
    const { record } = await fixture();
    let renameCalls = 0;
    const operations = {
      lstat,
      rename: vi.fn(async (from: Parameters<typeof rename>[0], to: Parameters<typeof rename>[1]) => {
        renameCalls += 1;
        if (renameCalls === 2) throw new Error('path rollback denied');
        await rename(from, to);
      }),
      unlink: vi.fn().mockRejectedValue(new Error('unlink denied')),
    };
    const rollback = vi.fn().mockResolvedValue(undefined);
    await expect(permanentlyDeleteVerifiedPiSession(record, vi.fn().mockResolvedValue(undefined), rollback, operations)).rejects.toThrow('path rollback denied');
    expect(rollback).toHaveBeenCalledOnce();
  });
});
