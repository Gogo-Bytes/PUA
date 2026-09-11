import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SessionCoordinator } from '../../modules/sessions/index.js';
import { ConversationApplication } from '../../modules/conversation/index.js';
import { SessionProcessAdapter, type SessionProcessContext } from '../../platform/electron/utility/session-process-adapter.js';
import type { Terminal } from '../../modules/terminal/index.js';
import { prepareProject } from '../../platform/filesystem/session-preparation.js';
import { sessionChangeEvent, unwrapSessionResult } from './session-mapper.js';
import type { CreateSessionOptions, RuntimeInfo } from '../../shared/ipc/desktop-api.js';
import type { SessionEvent } from '../../shared/ipc/conversation.js';
import { createSession } from './create-session.js';
import { registerChatAttachments } from './chat-attachments.js';

// Structural material/Port surface allows in-memory Fakes without exposing the resource owner to main.
type ProcessAdapter = Pick<SessionProcessAdapter, keyof SessionProcessAdapter>;
export interface CompositionDependencies {
  prepareProject?(cwd: string): Promise<{ cwd: string; title: string }>;
  createId?(): string;
  /** Construction must not invoke context callbacks; register is synchronous/non-reentrant. */
  createAdapter?(context: SessionProcessContext): ProcessAdapter;
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
  };
  const adapter = dependencies.createAdapter?.(context) ?? new SessionProcessAdapter(context);
  const conversation = new ConversationApplication(adapter, adapter);
  const coordinator = new SessionCoordinator(adapter, event => {
    if (event.type === 'removed') {
      conversation.invalidate(event.id);
      adapter.forget(event.id);
    } else {
      const notification = sessionChangeEvent(event);
      if (notification) notify(notification);
    }
  });
  const preparation = { session: coordinator, adapter, conversation, prepareProject: dependencies.prepareProject ?? prepareProject, createId: dependencies.createId ?? randomUUID };
  return {
    session: coordinator as Pick<SessionCoordinator, 'get' | 'list' | 'start' | 'close' | 'closeAll'>,
    conversation: conversation as Pick<ConversationApplication, 'send' | 'stop' | 'respond' | 'rename' | 'removeAttachment'>,
    terminal: adapter as Terminal,
    activity: (id: string) => adapter.activity(id),
    createSession: (runtime: RuntimeInfo, options: CreateSessionOptions) => createSession(preparation, runtime, options),
    registerChatAttachments: (id: string, paths: string[]) => registerChatAttachments(conversation, adapter, id, paths),
  };
}
