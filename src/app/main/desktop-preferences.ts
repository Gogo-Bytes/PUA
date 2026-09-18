import type { Bootstrap, CreateSessionOptions, Preferences, SessionInfo } from '../../shared/ipc/desktop-api.js';
import type { PreferencesApplication } from '../../modules/preferences/index.js';
import type { resolveRuntime as ResolveRuntime } from '../../platform/pi/runtime/discovery.js';
import { unwrapSessionResult } from './session-mapper.js';
import type { composeMain } from './composition.js';
import type { PersistedChatSession, WorkspaceSessionStore } from './workspace-session-store.js';
import type { NativePiSessionIdentity } from '../../shared/ipc/pi-session.js';

type SessionCreation = Pick<ReturnType<typeof composeMain>, 'createSession'> & {
  session: Pick<ReturnType<typeof composeMain>['session'], 'close'>;
};
type SessionRestoration = {
  restoreChatSession(runtime: import('../../shared/ipc/desktop-api.js').RuntimeInfo, persisted: PersistedChatSession): Promise<SessionInfo>;
};

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
  const persisted = new Map<string, PersistedChatSession>();
  const pending = new Map<string, { session: SessionInfo; durable: boolean }>();
  let restoreReady: Promise<void> = Promise.resolve();
  const bootstrapSessions = () => restoredSessions.length ? { restoredSessions: restoredSessions.map(session => ({ ...session })) } : {};
  function getBootstrap(): Bootstrap {
    const preferences = application.read();
    const base = { preferences, home, platform, ...bootstrapSessions() };
    try { return { ...base, runtime: resolveRuntime(preferences) }; }
    catch (error) { return { ...base, runtime: null, runtimeError: (error as Error).message }; }
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
      pending.set(session.id, { session, durable: sessionStore !== undefined && options.kind === 'chat' && !runtime.args.some(arg => arg === '--no-session' || arg.startsWith('--no-session=')) });
      await application.recordRecent(session.cwd, async error => {
        pending.delete(session.id);
        unwrapSessionResult(await capabilities.session.close(session.id));
        throw error;
      });
      return session;
    },
    async recordChatMessage(id: string, identity: NativePiSessionIdentity): Promise<void> {
      const entry = pending.get(id);
      if (!entry || !entry.durable || !sessionStore) return;
      const record: PersistedChatSession = { id, cwd: entry.session.cwd, title: entry.session.title, piSessionId: identity.sessionId, sessionFile: identity.sessionFile };
      try {
        await sessionStore.upsert(record);
        persisted.set(id, record);
        pending.delete(id);
      } catch (error) {
        console.warn(`无法保存 Pi 会话 ${id}: ${String(error)}`);
        throw error;
      }
    },
    async updateChatIdentity(id: string, identity: NativePiSessionIdentity): Promise<void> {
      const record = persisted.get(id);
      if (!record || !sessionStore) return;
      const next = { ...record, piSessionId: identity.sessionId, sessionFile: identity.sessionFile };
      await sessionStore.upsert(next);
      persisted.set(id, next);
    },
    restoreSessions(capabilities: SessionRestoration): Promise<SessionInfo[]> {
      const run = (async () => {
        if (!sessionStore) return [];
        const records = await sessionStore.read();
        if (!records.length) return [];
        const preferences = application.read();
        let runtime;
        try { validateChatArguments(preferences.args); runtime = resolveRuntime(preferences); }
        catch { return []; }
        const restored: SessionInfo[] = [];
        for (const record of records) {
          try {
            const file = await (await import('node:fs/promises')).stat(record.sessionFile);
            if (!file.isFile()) continue;
            const session = await capabilities.restoreChatSession(runtime, record);
            persisted.set(record.id, record);
            restored.push(session);
          } catch (error) {
            // Keep the durable record for a later retry; Pi remains the authority for whether it exists.
            console.warn(`跳过无法恢复的 Pi 会话 ${record.id}: ${String(error)}`);
          }
        }
        restoredSessions = restored;
        return restored;
      })();
      restoreReady = run.then(() => undefined);
      return run;
    },
    whenReady: async (): Promise<void> => { await restoreReady; },
    async forgetSession(id: string): Promise<void> {
      pending.delete(id);
      if (!sessionStore || !persisted.has(id)) return;
      await sessionStore.remove(id);
      persisted.delete(id);
      restoredSessions = restoredSessions.filter(session => session.id !== id);
    },
    async renameSession(id: string, title: string): Promise<void> {
      if (!sessionStore || !persisted.has(id)) { const entry = pending.get(id); if (entry) pending.set(id, { ...entry, session: { ...entry.session, title } }); return; }
      await sessionStore.rename(id, title);
      const record = persisted.get(id);
      if (record) persisted.set(id, { ...record, title });
      restoredSessions = restoredSessions.map(session => session.id === id ? { ...session, title } : session);
    },
    syncSession(session: import('../../modules/sessions/index.js').SessionSnapshot): void {
      if (session.kind !== 'chat' || !sessionStore || !persisted.has(session.id)) return;
      const current = persisted.get(session.id);
      if (!current || current.title === session.title) return;
      const next = { ...current, title: session.title };
      persisted.set(session.id, next);
      restoredSessions = restoredSessions.map(item => item.id === session.id ? { ...item, title: session.title } : item);
      void sessionStore.rename(session.id, session.title).catch(error => console.warn(`无法保存 Pi 会话标题 ${session.id}: ${String(error)}`));
    },
  };
}

const chatOwnedFlags = new Set(['--', '--mode', '--print', '-p', '--session', '--fork', '--continue', '-c', '--resume', '-r', '--approve', '-a', '--no-approve', '-na']);

/** Chat transport owns protocol, session selection, and per-run trust flags. */
export function validateChatArguments(args: string[]): void {
  const conflict = args.find(arg => chatOwnedFlags.has(arg) || arg.startsWith('--mode=') || arg.startsWith('--session=') || arg.startsWith('--fork='));
  if (conflict) throw new Error(`聊天模式不能使用附加参数 ${conflict}。请通过桌面会话与信任选项控制；兼容终端仍可使用原生参数。`);
}
