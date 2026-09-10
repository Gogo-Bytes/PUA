import {
  RuntimeFailure, type ConversationDialog, type ConversationQueue, type RuntimeChange,
  type RuntimeSeed, type RuntimeView,
} from '../modules/conversation/index.js';
import type { ChatQueue, ChatRuntimeState, ExtensionUIRequest } from '../shared/chat.js';
import { isRecord } from './chat-normalize.js';

export function runtimeError(error: unknown): unknown {
  if (!(error instanceof RuntimeFailure)) return error;
  const messages = {
    INVALIDATED: 'Pi session closing; acceptance unknown',
    DUPLICATE_DIALOG: 'Duplicate extension dialog id',
    TOO_MANY_DIALOGS: 'Too many pending extension dialogs',
    DIALOG_ENDED: '扩展对话已结束', ANSWER_TYPE: '扩展响应类型不匹配', INVALID_OPTION: '无效选项',
  } satisfies Record<RuntimeFailure['code'], string>;
  return new Error(messages[error.code]);
}
export function normalizeQueue(raw: unknown): ConversationQueue {
  const value = isRecord(raw) ? raw : {};
  return {
    steering: Array.isArray(value.steering) ? value.steering.filter((x): x is string => typeof x === 'string') : [],
    followUp: Array.isArray(value.followUp) ? value.followUp.filter((x): x is string => typeof x === 'string') : [],
  };
}
export function queueDTO(queue: ConversationQueue): ChatQueue {
  return { steering: [...queue.steering], followUp: [...queue.followUp] };
}
export function runtimeChangeDTO(change: RuntimeChange): Partial<ChatRuntimeState> {
  const state: Partial<ChatRuntimeState> = { activity: change.activity };
  if ('queue' in change) state.queue = queueDTO(change.queue);
  if ('statuses' in change) state.statuses = { ...change.statuses };
  if ('widgets' in change) state.widgets = change.widgets.map(widget => ({ ...widget, lines: [...widget.lines] }));
  return state;
}
export function runtimeViewDTO(view: RuntimeView): ChatRuntimeState {
  return {
    activity: view.activity, queue: queueDTO(view.queue), statuses: { ...view.statuses },
    widgets: view.widgets.map(widget => ({ ...widget, lines: [...widget.lines] })),
    model: view.model ? { ...view.model } : undefined, thinkingLevel: view.thinkingLevel,
  };
}
export function normalizeRuntimeSeed(state: Record<string, unknown>): RuntimeSeed {
  return {
    activity: state.isCompacting ? 'compacting' : state.isStreaming ? 'responding' : 'idle',
    model: isRecord(state.model) && typeof state.model.provider === 'string' && typeof state.model.id === 'string'
      ? { provider: state.model.provider, id: state.model.id } : undefined,
    thinkingLevel: typeof state.thinkingLevel === 'string' ? state.thinkingLevel : undefined,
  };
}
export function dialogDTO(dialog: ConversationDialog): ExtensionUIRequest {
  const common = { id: dialog.id, title: dialog.title, expiresAt: dialog.expiresAt };
  switch (dialog.kind) {
    case 'select': return { ...common, method: 'select', options: [...dialog.options] };
    case 'confirm': return { ...common, method: 'confirm', message: dialog.message };
    case 'input': return { ...common, method: 'input', placeholder: dialog.placeholder };
    case 'editor': return { ...common, method: 'editor', prefill: dialog.prefill };
  }
}

/** Only raw Pi fields are inspected here; membership and waiting belong to the runtime. */
export function normalizeDialog(value: Record<string, unknown>, now: number): ConversationDialog | undefined {
  if (typeof value.id !== 'string' || typeof value.title !== 'string') return undefined;
  const expiresAt = typeof value.timeout === 'number' && Number.isFinite(value.timeout) && value.timeout > 0
    ? now + Math.min(value.timeout, 2147483647) : undefined;
  const common = { id: value.id, title: value.title, expiresAt };
  switch (value.method) {
    case 'select': return Array.isArray(value.options)
      ? { ...common, kind: 'select', options: value.options.filter((x): x is string => typeof x === 'string') } : undefined;
    case 'confirm': return typeof value.message === 'string' ? { ...common, kind: 'confirm', message: value.message } : undefined;
    case 'input': return { ...common, kind: 'input', placeholder: typeof value.placeholder === 'string' ? value.placeholder : undefined };
    case 'editor': return { ...common, kind: 'editor', prefill: typeof value.prefill === 'string' ? value.prefill : undefined };
    default: return undefined;
  }
}
