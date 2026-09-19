import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SessionCoordinator, type SessionProcessPort } from '../../modules/sessions/index.js';
import { ConversationApplication, type AttachmentResourcesPort, type ConversationRuntimePort } from '../../modules/conversation/index.js';
import { SessionProcessAdapter, type SessionProcessContext } from '../../platform/electron/utility/session-process-adapter.js';
import type { Terminal } from '../../modules/terminal/index.js';
import { prepareProject } from '../../platform/filesystem/session-preparation.js';
import { sessionChangeEvent, unwrapSessionResult } from './session-mapper.js';
import type { CreateSessionOptions, RuntimeInfo } from '../../shared/ipc/desktop-api.js';
import type { SessionEvent } from '../../shared/ipc/conversation.js';
import { createSession, type SessionResourceRegistrationPort } from './create-session.js';
import type { PersistedChatSession } from './workspace-session-store.js';
import type { NativePiSessionIdentity } from '../../shared/ipc/pi-session.js';
import { registerChatAttachments, type ChatAttachmentStagingPort } from './chat-attachments.js';

// One physical owner implements the injected Ports; only this composition root knows its concrete class.
type ProcessAdapter = SessionProcessPort & ConversationRuntimePort & AttachmentResourcesPort & Terminal
  & SessionResourceRegistrationPort & ChatAttachmentStagingPort & { forget(id: string): void; chatIdentity?(id: string): NativePiSessionIdentity | undefined; waitForChatIdentity?(id: string, timeoutMs?: number, previous?: NativePiSessionIdentity): Promise<NativePiSessionIdentity> };
export interface CompositionDependencies {
  prepareProject?(cwd: string): Promise<{ cwd: string; title: string }>;
  createId?(): string;
  /** Construction must not invoke context callbacks; register is synchronous/non-reentrant. */
  createAdapter?(context: SessionProcessContext): ProcessAdapter;
  onSessionChanged?(session: import('../../modules/sessions/index.js').SessionSnapshot): void;
  onChatMessageAccepted?(id: string, identity: NativePiSessionIdentity): void | Promise<void>;
  onChatIdentityChanged?(id: string, identity: NativePiSessionIdentity): void | Promise<void>;
}

/** Constructs each authority once. Returned core capabilities are the actual instances, not proxies. */
export function composeMain(emit: (event: SessionEvent) => void, dependencies: CompositionDependencies = {}) {
  const notify = (event: SessionEvent) => { try { emit(event); } catch { /* Projection failure is not cleanup failure. */ } };
  const context: SessionProcessContext = {
    workerPaths: {
      chat: fileURLToPath(new URL('../workers/pi-rpc.worker.js', import.meta.url)),
      terminal: fileURLToPath(new URL('../workers/pty.worker.js', import.meta.url)),
    },
    snapshot: id => coordinator.get(id),
    close: async id => { unwrapSessionResult(await coordinator.close(id)); },
    emit: notify,
    invalidateConversation: id => conversation.invalidate(id),
    onChatMessageAccepted: dependencies.onChatMessageAccepted,
    onChatIdentityChanged: dependencies.onChatIdentityChanged,
  };
  const adapter = dependencies.createAdapter?.(context) ?? new SessionProcessAdapter(context);
  const conversation = new ConversationApplication(adapter, adapter);
  const coordinator = new SessionCoordinator(adapter, event => {
    if (event.type === 'removed') {
      conversation.invalidate(event.id);
      adapter.forget(event.id);
    } else {
      if (event.type === 'changed') dependencies.onSessionChanged?.(event.session);
      const notification = sessionChangeEvent(event);
      if (notification) notify(notification);
    }
  });
  const preparation = { session: coordinator, adapter, conversation, prepareProject: dependencies.prepareProject ?? prepareProject, createId: dependencies.createId ?? randomUUID };
  return {
    session: coordinator as Pick<SessionCoordinator, 'get' | 'list' | 'start' | 'close' | 'closeAll'>,
    conversation: conversation as Pick<ConversationApplication, 'send' | 'stop' | 'respond' | 'rename' | 'fork' | 'getAvailableModels' | 'getAvailableThinkingLevels' | 'getSessionStats' | 'getAutoSettings' | 'setModel' | 'setThinkingLevel' | 'setAutoCompaction' | 'setAutoRetry' | 'compact' | 'removeAttachment'> & Partial<Pick<ConversationApplication, 'clone'>>,
    terminal: adapter as Terminal,
    activity: (id: string) => adapter.activity(id),
    createSession: (runtime: RuntimeInfo, options: CreateSessionOptions) => createSession(preparation, runtime, options),
    restoreChatSession: (runtime: RuntimeInfo, persisted: PersistedChatSession) => createSession(preparation, runtime, {
      cwd: persisted.cwd, kind: 'chat', startMode: 'new', projectTrust: 'default', cols: 100, rows: 30,
    }, { id: persisted.id, title: persisted.title, dormant: true, chat: { piSessionId: persisted.piSessionId, sessionFile: persisted.sessionFile, mode: 'restore' } }),
    chatIdentity: (id: string) => adapter.chatIdentity?.(id),
    waitForChatIdentity: (id: string, timeoutMs?: number, previous?: NativePiSessionIdentity) => adapter.waitForChatIdentity ? adapter.waitForChatIdentity(id, timeoutMs, previous) : Promise.reject(new Error('Pi identity capability unavailable')),
    registerChatAttachments: (id: string, paths: string[]) => registerChatAttachments(conversation, adapter, id, paths),
  };
}
