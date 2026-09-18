import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface PersistedChatSession {
  id: string;
  cwd: string;
  title: string;
  piSessionId: string;
  sessionFile: string;
}

export interface WorkspaceSessionStore {
  read(): Promise<PersistedChatSession[]>;
  upsert(session: PersistedChatSession): Promise<void>;
  remove(id: string): Promise<void>;
  rename(id: string, title: string): Promise<void>;
}

const valid = (value: unknown): value is PersistedChatSession => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const strings = [item.id, item.cwd, item.title, item.piSessionId, item.sessionFile];
  return strings.every(field => typeof field === 'string' && field.length > 0 && field.length <= 4096)
    && typeof item.id === 'string' && /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(item.id)
    && typeof item.piSessionId === 'string' && /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(item.piSessionId)
    && typeof item.cwd === 'string' && path.isAbsolute(item.cwd)
    && typeof item.sessionFile === 'string' && path.isAbsolute(item.sessionFile);
};

/** Main-owned durable index; Pi remains the authority for transcript contents. */
export class JsonWorkspaceSessionStore implements WorkspaceSessionStore {
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly file: string) {}
  async read(): Promise<PersistedChatSession[]> {
    try {
      const value: unknown = JSON.parse(await readFile(this.file, 'utf8'));
      return Array.isArray(value) ? value.filter(valid).slice(0, 256).map(item => ({ ...item })) : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new Error(`无法读取任务索引 ${this.file}: ${String(error)}`);
    }
  }
  upsert(session: PersistedChatSession): Promise<void> {
    if (!valid(session)) return Promise.reject(new Error('无效任务索引条目'));
    return this.mutate(current => [...current.filter(item => item.id !== session.id), { ...session }]);
  }
  remove(id: string): Promise<void> { return this.mutate(current => current.filter(item => item.id !== id)); }
  rename(id: string, title: string): Promise<void> {
    if (typeof title !== 'string' || title.length === 0 || title.length > 4096) return Promise.reject(new Error('无效任务标题'));
    return this.mutate(current => current.map(item => item.id === id ? { ...item, title } : item));
  }
  private mutate(update: (current: PersistedChatSession[]) => PersistedChatSession[]): Promise<void> {
    const next = this.queue.catch(() => {}).then(async () => {
      const current = await this.read();
      const seen = new Set<string>();
      const value = update(current).reverse().filter(item => !seen.has(item.id) && seen.add(item.id)).reverse().slice(-256);
      await mkdir(path.dirname(this.file), { recursive: true });
      await writeFile(`${this.file}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 });
      await rename(`${this.file}.tmp`, this.file);
    });
    this.queue = next;
    return next;
  }
}
