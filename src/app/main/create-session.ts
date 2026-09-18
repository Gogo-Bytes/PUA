import type { SessionCoordinator } from '../../modules/sessions/index.js';
import type { ConversationApplication } from '../../modules/conversation/index.js';
import { sessionInfo, unwrapSessionResult } from './session-mapper.js';
import { validateCreateSessionOptions } from '../../shared/ipc/schemas.js';
import type { CreateSessionOptions, RuntimeInfo, SessionInfo } from '../../shared/ipc/desktop-api.js';
import type { SessionActivity } from '../../shared/ipc/conversation.js';
import type { ChatSessionIdentity } from '../../shared/ipc/pi-session.js';

export interface SessionResourceRegistrationPort {
  register(id: string, runtime: RuntimeInfo, options: CreateSessionOptions, identity?: ChatSessionIdentity): void;
  activity(id: string): SessionActivity;
}

export interface InternalSessionIdentity {
  id?: string;
  title?: string;
  dormant?: boolean;
  chat?: ChatSessionIdentity;
}

export interface CreateSessionDependencies {
  session: SessionCoordinator;
  adapter: SessionResourceRegistrationPort;
  conversation: Pick<ConversationApplication, 'open'>;
  prepareProject(cwd: string): Promise<{ cwd: string; title: string }>;
  createId(): string;
}

/** Node preparation precedes the core's synchronous prepared create. register/open must be
 * synchronous, non-reentrant material installation: no await, observer, or process launch. */
export async function createSession(dependencies: CreateSessionDependencies, runtime: RuntimeInfo, options: CreateSessionOptions, identity: InternalSessionIdentity = {}): Promise<SessionInfo> {
  const { session, adapter, conversation, prepareProject, createId } = dependencies;
  unwrapSessionResult(session.checkAdmission());
  options = validateCreateSessionOptions(options);
  unwrapSessionResult(session.checkIntent(options));
  const prepared = await prepareProject(options.cwd);
  const project = identity.title ? { ...prepared, title: identity.title } : prepared;
  const id = identity.id ?? createId();
  const chatIdentity = identity.chat ?? (options.kind === 'chat' && options.startMode === 'new' ? { piSessionId: id, mode: 'create' as const } : undefined);
  // Final shutdown check + reservation + both material owners form one uninterrupted segment.
  const snapshot = unwrapSessionResult(session.create({ id, ...project, kind: options.kind, startMode: options.startMode, ...(identity.dormant ? { dormant: true } : {}) }));
  try {
    adapter.register(id, runtime, options, chatIdentity);
    if (options.kind === 'chat') conversation.open(id);
  } catch (error) {
    // close locks synchronously; only confirmed cleanup may release/forget the reservation.
    unwrapSessionResult(await session.close(id));
    throw error;
  }
  return sessionInfo(snapshot, adapter.activity(id));
}
