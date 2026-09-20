import type { Bootstrap, CreateSessionOptions, HistorySearchOptions, HistorySearchResult, Preferences, SessionInfo } from '../../shared/ipc/desktop-api.js';
import type { PreferencesApplication } from '../../modules/preferences/index.js';
import type { resolveRuntime as ResolveRuntime } from '../../platform/pi/runtime/discovery.js';
import { unwrapSessionResult } from './session-mapper.js';
import type { composeMain } from './composition.js';
import type { PersistedChatSession, WorkspaceSessionStore } from './workspace-session-store.js';
import type { NativePiSessionIdentity } from '../../shared/ipc/pi-session.js';

type SessionCreation = Pick<ReturnType<typeof composeMain>, 'createSession'> & {
  session: Pick<ReturnType<typeof composeMain>['session'], 'get' | 'start' | 'close'>;
  restoreChatSession?: ReturnType<typeof composeMain>['restoreChatSession'];
  chatIdentity?(id: string): NativePiSessionIdentity | undefined;
  waitForChatIdentity?(id: string, timeoutMs?: number, previous?: NativePiSessionIdentity): Promise<NativePiSessionIdentity>;
  conversation: { send?: unknown; clone?: (id: string) => Promise<{ cancelled: boolean }> };
};
type SessionRestoration = {
  restoreChatSession(runtime: import('../../shared/ipc/desktop-api.js').RuntimeInfo, persisted: PersistedChatSession): Promise<SessionInfo>;
  session: Pick<ReturnType<typeof composeMain>['session'], 'close'>;
};

// Keep this policy module evaluable by the runtime-discovery VM used in tests; the
// main process still gets cryptographically strong IDs from Node's global Web Crypto.
const newSessionId = (): string => globalThis.crypto?.randomUUID?.() ?? `clone-${Date.now()}-${Math.random().toString(36).slice(2)}`;

interface DesktopPreferencesDependencies {
  application: Pick<PreferencesApplication, 'read' | 'save' | 'recordRecent'>;
  resolveRuntime: typeof ResolveRuntime;
  validateChatArguments: typeof validateChatArguments;
  home: string;
  platform: string;
  sessionStore?: WorkspaceSessionStore;
}

/** Runtime/bootstrap mapping and cross-Session compensation; preferences state lives in the module. */
export function createDesktopPreferences({ application, resolveRuntime, validateChatArguments, home, platform, sessionStore }: DesktopPreferencesDependencies) {
  let restoredSessions: SessionInfo[] = [];
  let archivedSessions: SessionInfo[] = [];
  let restorer: SessionRestoration | undefined;
  const persisted = new Map<string, PersistedChatSession>();
  type PendingSession = { session: SessionInfo; durable: boolean; pinned: boolean; lastActivityAt: number; identity?: NativePiSessionIdentity };
  const pending = new Map<string, PendingSession>();
  const mutations = new Map<string, Promise<void>>();
  const persistenceRetries = new Map<string, ReturnType<typeof setTimeout>>();
  const persistenceRetryAttempts = new Map<string, number>();
  type PersistenceRetry = { record: PersistedChatSession; kind: 'activity' | 'title' };
  const retryRecords = new Map<string, PersistenceRetry>();
  let restoreReady: Promise<void> = Promise.resolve();
  const bootstrapSessions = () => ({
    ...(restoredSessions.length ? { restoredSessions: restoredSessions.map(session => ({ ...session })) } : {}),
    ...(archivedSessions.length ? { archivedSessions: archivedSessions.map(session => ({ ...session })) } : {}),
  });
  function getBootstrap(): Bootstrap {
    const preferences = application.read();
    const base = { preferences, home, platform, ...bootstrapSessions() };
    try { return { ...base, runtime: resolveRuntime(preferences) }; }
    catch (error) { return { ...base, runtime: null, runtimeError: (error as Error).message }; }
  }
  async function persistPending(id: string, entry: PendingSession): Promise<void> {
    if (!entry.identity || !entry.durable || !sessionStore) return;
    const record: PersistedChatSession = {
      id, cwd: entry.session.cwd, title: entry.session.title, piSessionId: entry.identity.sessionId, sessionFile: entry.identity.sessionFile,
      archived: false, pinned: entry.pinned, lastActivityAt: Date.now(),
    };
    await sessionStore.upsert(record);
    // A newer accepted message owns the pending record. Its queued write will
    // replace this value; a stale completion must never delete the new owner.
    if (pending.get(id) !== entry) return;
    persisted.set(id, record);
    pending.delete(id);
    clearPersistenceRetry(id);
  }
  async function retryPersistedRecord(id: string, retry: PersistenceRetry): Promise<void> {
    if (!sessionStore) return;
    const { record, kind } = retry;
    const current = persisted.get(id);
    // The indexed record can still contain the previous Pi identity when the
    // failed activity write is retried; the retry record is the newer owner.
    // A newer activity timestamp is the only stale-write guard needed here.
    if (!current || (current.lastActivityAt ?? 0) > (record.lastActivityAt ?? 0)) return;
    if (kind === 'title') {
      await sessionStore.rename(id, record.title);
      const merged = { ...current, title: record.title };
      if (persisted.get(id) === current) {
        persisted.set(id, merged);
        restoredSessions = restoredSessions.map(item => item.id === id ? { ...item, title: record.title } : item);
        archivedSessions = archivedSessions.map(item => item.id === id ? { ...item, title: record.title } : item);
      }
    } else {
      // Retry only the failed identity/activity fields; title, pin, and archive
      // metadata may have committed while the activity write was waiting.
      const merged = { ...current, piSessionId: record.piSessionId, sessionFile: record.sessionFile, lastActivityAt: record.lastActivityAt };
      await sessionStore.upsert(merged);
      if (persisted.get(id) === current) persisted.set(id, merged);
    }
    clearPersistenceRetry(id);
  }
  function enqueueMutation(id: string, work: () => Promise<void>): Promise<void> {
    const previous = mutations.get(id);
    const operation = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(work);
    mutations.set(id, operation);
    void operation.then(
      () => { if (mutations.get(id) === operation) mutations.delete(id); },
      () => { if (mutations.get(id) === operation) mutations.delete(id); },
    );
    return operation;
  }
  const enqueuePendingPersistence = (id: string, entry: PendingSession) => enqueueMutation(id, () => persistPending(id, entry));
  function clearPersistenceRetry(id: string): void {
    const timer = persistenceRetries.get(id);
    if (timer) clearTimeout(timer);
    persistenceRetries.delete(id);
    persistenceRetryAttempts.delete(id);
    retryRecords.delete(id);
  }
  function schedulePersistenceRetry(id: string, record?: PersistedChatSession, kind: PersistenceRetry['kind'] = 'activity'): void {
    if (record) retryRecords.set(id, { record, kind });
    if (persistenceRetries.has(id)) return;
    const attempt = persistenceRetryAttempts.get(id) ?? 0;
    if (attempt >= 8) {
      console.error(`Pi 会话 ${id} 连续 8 次无法写入任务索引；保留当前任务，后续消息或关闭任务时会再次尝试。`);
      return;
    }
    persistenceRetryAttempts.set(id, attempt + 1);
    const timer = setTimeout(() => {
      persistenceRetries.delete(id);
      const entry = pending.get(id);
      const retryRecord = retryRecords.get(id);
      if ((!entry?.identity || !entry.durable) && !retryRecord) return;
      const operation = retryRecord
        ? enqueueMutation(id, () => retryPersistedRecord(id, retryRecord))
        : enqueuePendingPersistence(id, entry!);
      void operation.catch(error => {
        console.warn(`重试保存 Pi 会话 ${id} 失败: ${String(error)}`);
        schedulePersistenceRetry(id);
      });
    }, Math.min(30_000, 1_000 * (2 ** attempt)));
    timer.unref?.();
    persistenceRetries.set(id, timer);
  }
  return {
    getBootstrap,
    savePreferences(next: Preferences): Promise<Bootstrap> {
      return application.save(next, getBootstrap);
    },
    async createSession(options: CreateSessionOptions, capabilities: SessionCreation): Promise<SessionInfo> {
      const preferences = application.read();
      if (options.kind === 'chat') validateChatArguments(preferences.args);
      const runtime = resolveRuntime(preferences);
      const session = await capabilities.createSession(runtime, options);
      const createdAt = Date.now();
      pending.set(session.id, { session, durable: sessionStore !== undefined && options.kind === 'chat' && !runtime.args.some(arg => arg === '--no-session' || arg.startsWith('--no-session=')), pinned: false, lastActivityAt: createdAt });
      await application.recordRecent(session.cwd, async error => {
        pending.delete(session.id);
        unwrapSessionResult(await capabilities.session.close(session.id));
        throw error;
      });
      return { ...session, lastActivityAt: createdAt };
    },
    async cloneSession(id: string, capabilities: SessionCreation): Promise<SessionInfo> {
      await restoreReady;
      const source = capabilities.session.get(id);
      if (!source || source.kind !== 'chat') throw new Error('只有 Pi 对话可以创建原生副本');
      if (!capabilities.chatIdentity || !capabilities.waitForChatIdentity) throw new Error('Pi 克隆能力尚未就绪');
      const sourceIdentity = capabilities.chatIdentity(id);
      if (!sourceIdentity) throw new Error('当前会话尚未保存 Pi 历史，无法创建副本');
      const preferences = application.read();
      validateChatArguments(preferences.args);
      const runtime = resolveRuntime(preferences);
      if (runtime.args.some(arg => arg === '--no-session' || arg.startsWith('--no-session='))) throw new Error('当前 Pi 配置为 --no-session，无法创建副本');
      const probeId = newSessionId();
      if (!capabilities.restoreChatSession) throw new Error('Pi 克隆能力尚未就绪');
      const probe = await capabilities.restoreChatSession(runtime, {
        id: probeId, cwd: source.cwd, title: source.title, piSessionId: sourceIdentity.sessionId, sessionFile: sourceIdentity.sessionFile,
        archived: false, pinned: false, lastActivityAt: Date.now(),
      });
      try {
        unwrapSessionResult(capabilities.session.start(probe.id));
        await capabilities.waitForChatIdentity(probe.id, 15_000);
        const clone = capabilities.conversation.clone;
        if (!clone) throw new Error('Pi 克隆能力尚未就绪');
        const result = await clone(probe.id);
        if (result.cancelled) throw new Error('Pi 扩展取消了副本创建');
        const clonedIdentity = await capabilities.waitForChatIdentity(probe.id, 15_000, sourceIdentity);
        const cloned: PersistedChatSession = {
          id: newSessionId(), cwd: source.cwd, title: `${source.title} · 副本`, piSessionId: clonedIdentity.sessionId, sessionFile: clonedIdentity.sessionFile,
          archived: false, pinned: false, lastActivityAt: Date.now(),
        };
        const session = await capabilities.restoreChatSession(runtime, cloned);
        try {
          if (sessionStore) {
            await sessionStore.upsert(cloned);
            persisted.set(cloned.id, cloned);
            restoredSessions = [...restoredSessions.filter(item => item.id !== cloned.id), { ...session, archived: false, pinned: false, lastActivityAt: cloned.lastActivityAt }];
          }
          return { ...session, archived: false, pinned: false, lastActivityAt: cloned.lastActivityAt };
        } catch (error) {
          unwrapSessionResult(await capabilities.session.close(session.id));
          throw error;
        }
      } finally {
        unwrapSessionResult(await capabilities.session.close(probe.id));
      }
    },
    async recordChatMessage(id: string, identity: NativePiSessionIdentity): Promise<void> {
      if (!sessionStore) return;
      let failedRecord: PersistedChatSession | undefined;
      const operation = enqueueMutation(id, async () => {
        if (persisted.has(id)) {
          const current = persisted.get(id);
          if (!current) return;
          const next = { ...current, piSessionId: identity.sessionId, sessionFile: identity.sessionFile, lastActivityAt: Date.now() };
          failedRecord = next;
          try { await sessionStore.upsert(next); } catch (error) { schedulePersistenceRetry(id, next); throw error; }
          persisted.set(id, next);
          clearPersistenceRetry(id);
          restoredSessions = restoredSessions.map(item => item.id === id ? { ...item, lastActivityAt: next.lastActivityAt } : item);
          return;
        }
        const current = pending.get(id);
        if (!current || !current.durable) return;
        const entry = { ...current, identity };
        pending.set(id, entry);
        await persistPending(id, entry);
      });
      try {
        await operation;
      } catch (error) {
        console.warn(`无法保存 Pi 会话 ${id}: ${String(error)}`);
        schedulePersistenceRetry(id, failedRecord);
        throw error;
      }
    },
    async updateChatIdentity(id: string, identity: NativePiSessionIdentity): Promise<void> {
      if (!sessionStore) return;
      await enqueueMutation(id, async () => {
        const record = persisted.get(id);
        if (!record) return;
        const next = { ...record, piSessionId: identity.sessionId, sessionFile: identity.sessionFile, lastActivityAt: Date.now() };
        try { await sessionStore.upsert(next); } catch (error) { schedulePersistenceRetry(id, next); throw error; }
        persisted.set(id, next);
        clearPersistenceRetry(id);
      });
    },
    restoreSessions(capabilities: SessionRestoration): Promise<SessionInfo[]> {
      restorer = capabilities;
      const run = (async () => {
        if (!sessionStore) return [];
        let records: PersistedChatSession[];
        try { records = await sessionStore.read(); }
        catch (error) { console.warn(`无法读取工作区会话索引: ${String(error)}`); return []; }
        if (!records.length) return [];
        const preferences = application.read();
        let runtime;
        try { validateChatArguments(preferences.args); runtime = resolveRuntime(preferences); }
        catch { return []; }
        if (runtime.args.some(arg => arg === '--no-session' || arg.startsWith('--no-session='))) return [];
        const restored: SessionInfo[] = [];
        const archived: SessionInfo[] = [];
        for (const record of records) {
          persisted.set(record.id, record);
          if (record.archived) {
            archived.push({ id: record.id, cwd: record.cwd, title: record.title, kind: 'chat', processStatus: 'exited', activity: 'idle', archived: true, pinned: record.pinned, lastActivityAt: record.lastActivityAt });
            continue;
          }
          try {
            await (await import('./pi-session-file.js')).verifyPiSessionFile(record);
            const session = await capabilities.restoreChatSession(runtime, record);
            restored.push({ ...session, archived: false, pinned: record.pinned, lastActivityAt: record.lastActivityAt });
          } catch (error) {
            // Keep the durable record for a later retry; Pi remains the authority for whether it exists.
            console.warn(`跳过无法恢复的 Pi 会话 ${record.id}: ${String(error)}`);
          }
        }
        restoredSessions = restored;
        archivedSessions = archived;
        return restored;
      })();
      restoreReady = run.then(() => undefined);
      return run;
    },
    whenReady: async (): Promise<void> => { await restoreReady; },
    async verifySessionForStart(id: string): Promise<void> {
      const record = persisted.get(id);
      if (!record) return;
      await (await import('./pi-session-file.js')).verifyPiSessionFile(record);
    },
    async archiveSession(id: string): Promise<void> {
      clearPersistenceRetry(id);
      await enqueueMutation(id, async () => {
        const entry = pending.get(id);
        if (entry?.identity && entry.durable && sessionStore) await persistPending(id, entry);
        if (!sessionStore || !persisted.has(id)) { pending.delete(id); return; }
        await sessionStore.archive(id, true);
        const record = persisted.get(id)!;
        const archived = { ...record, archived: true };
        persisted.set(id, archived);
        restoredSessions = restoredSessions.filter(session => session.id !== id);
        archivedSessions = [...archivedSessions.filter(session => session.id !== id), { id, cwd: archived.cwd, title: archived.title, kind: 'chat', processStatus: 'exited', activity: 'idle', archived: true, pinned: archived.pinned, lastActivityAt: archived.lastActivityAt }];
      });
    },
    async restoreArchivedSession(id: string): Promise<SessionInfo> {
      if (!sessionStore || !restorer) throw new Error('会话恢复尚未就绪');
      let restored: SessionInfo | undefined;
      await enqueueMutation(id, async () => {
        const record = persisted.get(id);
        if (!record || !record.archived) throw new Error('归档会话不存在');
        const preferences = application.read();
        validateChatArguments(preferences.args);
        const runtime = resolveRuntime(preferences);
        if (runtime.args.some(arg => arg === '--no-session' || arg.startsWith('--no-session='))) throw new Error('当前 Pi 配置为 --no-session，无法恢复归档历史');
        await (await import('./pi-session-file.js')).verifyPiSessionFile(record);
        const session = await restorer!.restoreChatSession(runtime, { ...record, archived: false });
        const next = { ...record, archived: false };
        try { await sessionStore!.archive(id, false); }
        catch (error) {
          unwrapSessionResult(await restorer!.session.close(session.id));
          throw error;
        }
        persisted.set(id, next);
        archivedSessions = archivedSessions.filter(item => item.id !== id);
        restored = { ...session, archived: false, pinned: next.pinned, lastActivityAt: next.lastActivityAt };
        restoredSessions = [...restoredSessions.filter(item => item.id !== id), restored];
      });
      if (!restored) throw new Error('归档会话恢复未返回任务');
      return restored;
    },
    async deleteArchivedSession(id: string): Promise<void> {
      if (!sessionStore) return;
      await enqueueMutation(id, async () => {
        const record = persisted.get(id);
        if (!record || !record.archived) throw new Error('只有归档会话可以永久删除');
        await (await import('./pi-session-file.js')).permanentlyDeleteVerifiedPiSession(record, () => sessionStore!.remove(id), () => sessionStore!.upsert(record));
        persisted.delete(id);
        archivedSessions = archivedSessions.filter(item => item.id !== id);
      });
    },
    async setSessionPinned(id: string, pinned: boolean): Promise<void> {
      await enqueueMutation(id, async () => {
        const entry = pending.get(id);
        if (entry) pending.set(id, { ...entry, pinned });
        const record = persisted.get(id);
        if (!record || !sessionStore) return;
        await sessionStore.setPinned(id, pinned);
        const next = { ...record, pinned };
        persisted.set(id, next);
        restoredSessions = restoredSessions.map(item => item.id === id ? { ...item, pinned } : item);
        archivedSessions = archivedSessions.map(item => item.id === id ? { ...item, pinned } : item);
      });
    },
    async searchHistory(options: HistorySearchOptions): Promise<HistorySearchResult[]> {
      await restoreReady;
      const query = options.query.trim();
      const limit = Math.min(50, Math.max(1, options.limit ?? 30));
      const results: HistorySearchResult[] = [];
      // Search is deliberately main-owned and bounded. Raw Pi JSONL never crosses IPC.
      const { parseSessionHistory } = await import('./session-history-search.js');
      const { readVerifiedPiSessionFile } = await import('./pi-session-file.js');
      let scannedBytes = 0;
      for (const record of persisted.values()) {
        const remainingBytes = 64 * 1024 * 1024 - scannedBytes;
        if (remainingBytes <= 0) break;
        try {
          const snapshot = await readVerifiedPiSessionFile(record, Math.min(12 * 1024 * 1024, remainingBytes));
          scannedBytes += snapshot.size;
          results.push(...parseSessionHistory(snapshot.content, {
            taskId: record.id, title: record.title, cwd: record.cwd, archived: !!record.archived,
          }, query, limit));
        } catch {
          // Missing or concurrently removed history is not an IPC error; the index remains recoverable.
        }
      }
      return results.sort((a, b) => b.timestamp - a.timestamp || a.taskId.localeCompare(b.taskId)).slice(0, limit);
    },
    async renameSession(id: string, title: string): Promise<void> {
      await enqueueMutation(id, async () => {
        if (!sessionStore || !persisted.has(id)) { const entry = pending.get(id); if (entry) pending.set(id, { ...entry, session: { ...entry.session, title } }); return; }
        const record = persisted.get(id);
        if (!record) return;
        try { await sessionStore.rename(id, title); }
        catch (error) {
          schedulePersistenceRetry(id, { ...record, title }, 'title');
          throw error;
        }
        if (record) persisted.set(id, { ...record, title });
        restoredSessions = restoredSessions.map(session => session.id === id ? { ...session, title } : session);
        archivedSessions = archivedSessions.map(session => session.id === id ? { ...session, title } : session);
      });
    },
    syncSession(session: import('../../modules/sessions/index.js').SessionSnapshot): void {
      if (session.kind !== 'chat' || !sessionStore) return;
      const title = session.title.slice(0, 4096);
      void enqueueMutation(session.id, async () => {
        const current = persisted.get(session.id);
        if (!current) {
          const entry = pending.get(session.id);
          if (!entry || entry.session.title === title) return;
          const next = { ...entry, session: { ...entry.session, title } };
          pending.set(session.id, next);
          if (next.identity && next.durable) await persistPending(session.id, next);
          return;
        }
        if (current.title === title) return;
        try { await sessionStore.rename(session.id, title); }
        catch (error) {
          schedulePersistenceRetry(session.id, { ...current, title }, 'title');
          throw error;
        }
        persisted.set(session.id, { ...current, title });
        restoredSessions = restoredSessions.map(item => item.id === session.id ? { ...item, title } : item);
        archivedSessions = archivedSessions.map(item => item.id === session.id ? { ...item, title } : item);
      }).catch(error => console.warn(`无法保存 Pi 会话标题 ${session.id}: ${String(error)}`));
    },
  };
}

const chatOwnedFlags = new Set(['--', '--mode', '--print', '-p', '--session', '--session-id', '--fork', '--continue', '-c', '--resume', '-r', '--approve', '-a', '--no-approve', '-na']);

/** Chat transport owns protocol, session selection, and per-run trust flags. */
export function validateChatArguments(args: string[]): void {
  const conflict = args.find(arg => chatOwnedFlags.has(arg) || arg.startsWith('--mode=') || arg.startsWith('--session=') || arg.startsWith('--session-id=') || arg.startsWith('--fork='));
  if (conflict) throw new Error(`聊天模式不能使用附加参数 ${conflict}。请通过桌面会话与信任选项控制；兼容终端仍可使用原生参数。`);
}
