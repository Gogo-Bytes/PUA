import type { ExtensionResponse } from './conversation.js';

/** Waiting is a projection over this activity, never a saved activity to restore. */
export type AgentActivity = 'idle' | 'responding' | 'compacting' | 'retrying';
export type RuntimeActivity = AgentActivity | 'waiting-input';
export interface ConversationQueue {
  readonly steering: readonly string[];
  readonly followUp: readonly string[];
}
export interface ConversationWidget {
  readonly key: string;
  readonly lines: readonly string[];
  readonly placement: 'aboveEditor' | 'belowEditor';
}
export type ConversationDialog = { readonly id: string; readonly title: string; readonly expiresAt?: number } & (
  | { readonly kind: 'select'; readonly options: readonly string[] }
  | { readonly kind: 'confirm'; readonly message: string }
  | { readonly kind: 'input'; readonly placeholder?: string }
  | { readonly kind: 'editor'; readonly prefill?: string }
);
export interface RuntimeSeed {
  readonly activity: AgentActivity;
  readonly model?: { readonly provider: string; readonly id: string };
  readonly thinkingLevel?: string;
}
export interface RuntimeView {
  readonly activity: RuntimeActivity;
  readonly queue: ConversationQueue;
  readonly statuses: Readonly<Record<string, string>>;
  readonly widgets: readonly ConversationWidget[];
  readonly model?: RuntimeSeed['model'];
  readonly thinkingLevel?: string;
}
export type RuntimeInput =
  | { readonly type: 'activity'; readonly activity: AgentActivity }
  | { readonly type: 'queue'; readonly queue: ConversationQueue }
  | { readonly type: 'dialog'; readonly dialog: ConversationDialog }
  | { readonly type: 'status'; readonly key: string; readonly text?: string }
  | { readonly type: 'widget'; readonly key: string; readonly content?: { readonly lines: readonly string[]; readonly placement: ConversationWidget['placement'] } };
export type RuntimeChange =
  | { readonly activity: RuntimeActivity }
  | { readonly activity: RuntimeActivity; readonly queue: ConversationQueue }
  | { readonly activity: RuntimeActivity; readonly statuses: Readonly<Record<string, string>> }
  | { readonly activity: RuntimeActivity; readonly widgets: readonly ConversationWidget[] };
export type RuntimeNotification =
  | { readonly type: 'state-changed'; readonly change: RuntimeChange }
  | { readonly type: 'dialog-opened'; readonly dialog: ConversationDialog }
  | { readonly type: 'dialog-closed'; readonly dialogId: string };
export type RuntimeFailureCode = 'INVALIDATED' | 'DUPLICATE_DIALOG' | 'TOO_MANY_DIALOGS' | 'DIALOG_ENDED' | 'ANSWER_TYPE' | 'INVALID_OPTION';
export class RuntimeFailure extends Error {
  constructor(readonly code: RuntimeFailureCode) { super(code); this.name = 'RuntimeFailure'; }
}

export function copyQueue(queue: ConversationQueue): ConversationQueue {
  return { steering: [...queue.steering], followUp: [...queue.followUp] };
}
export function copyDialog(dialog: ConversationDialog): ConversationDialog {
  return dialog.kind === 'select' ? { ...dialog, options: [...dialog.options] } : { ...dialog };
}
export function copyWidget(widget: ConversationWidget): ConversationWidget {
  return { ...widget, lines: [...widget.lines] };
}
export function validateAnswer(dialog: ConversationDialog, response: ExtensionResponse): void {
  if ('cancelled' in response) return;
  if (dialog.kind === 'confirm' ? !('confirmed' in response) : !('value' in response)) throw new RuntimeFailure('ANSWER_TYPE');
  if (dialog.kind === 'select' && 'value' in response && !dialog.options.includes(response.value)) throw new RuntimeFailure('INVALID_OPTION');
}
