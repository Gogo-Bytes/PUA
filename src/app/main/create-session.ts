import type { SessionCoordinator } from '../../modules/sessions/index.js';
import type { ConversationApplication } from '../../modules/conversation/index.js';
import type { SessionProcessAdapter } from '../../platform/electron/utility/session-process-adapter.js';
import { sessionInfo, unwrapSessionResult } from './session-mapper.js';
import { validateCreateSessionOptions } from '../../shared/ipc/schemas.js';
import type { CreateSessionOptions, RuntimeInfo, SessionInfo } from '../../shared/ipc/desktop-api.js';

export interface CreateSessionDependencies {
  session: SessionCoordinator;
  adapter: Pick<SessionProcessAdapter, 'register' | 'activity'>;
  conversation: Pick<ConversationApplication, 'open'>;
  prepareProject(cwd: string): Promise<{ cwd: string; title: string }>;
  createId(): string;
}

/** Node preparation precedes the core's synchronous prepared create. register/open must be
 * synchronous, non-reentrant material installation: no await, observer, or process launch. */
export async function createSession(dependencies: CreateSessionDependencies, runtime: RuntimeInfo, options: CreateSessionOptions): Promise<SessionInfo> {
  const { session, adapter, conversation, prepareProject, createId } = dependencies;
  unwrapSessionResult(session.checkAdmission());
  options = validateCreateSessionOptions(options);
  unwrapSessionResult(session.checkIntent(options));
  const project = await prepareProject(options.cwd);
  const id = createId();
  // Final shutdown check + reservation + both material owners form one uninterrupted segment.
  const snapshot = unwrapSessionResult(session.create({ id, ...project, kind: options.kind, startMode: options.startMode }));
  try {
    adapter.register(id, runtime, options);
    if (options.kind === 'chat') conversation.open(id);
  } catch (error) {
    // close locks synchronously; only confirmed cleanup may release/forget the reservation.
    unwrapSessionResult(await session.close(id));
    throw error;
  }
  return sessionInfo(snapshot, adapter.activity(id));
}
