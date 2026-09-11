import type { Bootstrap, CreateSessionOptions, Preferences, SessionInfo } from '../../shared/contracts.js';
import type { PreferencesApplication } from '../../modules/preferences/index.js';
import type { resolveRuntime as ResolveRuntime } from '../../platform/pi/runtime/discovery.js';
import { unwrapSessionResult } from './session-mapper.js';
import type { composeMain } from './composition.js';

type SessionCreation = Pick<ReturnType<typeof composeMain>, 'createSession'> & {
  session: Pick<ReturnType<typeof composeMain>['session'], 'close'>;
};

interface DesktopPreferencesDependencies {
  application: Pick<PreferencesApplication, 'read' | 'save' | 'recordRecent'>;
  resolveRuntime: typeof ResolveRuntime;
  validateChatArguments: typeof validateChatArguments;
  home: string;
  platform: string;
}

/** Runtime/bootstrap mapping and cross-Session compensation; preferences state lives in the module. */
export function createDesktopPreferences({ application, resolveRuntime, validateChatArguments, home, platform }: DesktopPreferencesDependencies) {
  function getBootstrap(): Bootstrap {
    const preferences = application.read();
    const base = { preferences, home, platform };
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
      await application.recordRecent(session.cwd, async error => {
        unwrapSessionResult(await capabilities.session.close(session.id));
        throw error;
      });
      return session;
    },
  };
}

const chatOwnedFlags = new Set(['--', '--mode', '--print', '-p', '--session', '--fork', '--continue', '-c', '--resume', '-r', '--approve', '-a', '--no-approve', '-na']);

/** Chat transport owns protocol, session selection, and per-run trust flags. */
export function validateChatArguments(args: string[]): void {
  const conflict = args.find(arg => chatOwnedFlags.has(arg) || arg.startsWith('--mode=') || arg.startsWith('--session=') || arg.startsWith('--fork='));
  if (conflict) throw new Error(`聊天模式不能使用附加参数 ${conflict}。请通过桌面会话与信任选项控制；兼容终端仍可使用原生参数。`);
}
