import type { ExtensionResponse } from '../domain/conversation.js';
import {
  copyDialog, copyQueue, copyWidget, RuntimeFailure, validateAnswer,
  type AgentActivity, type ConversationDialog, type ConversationQueue, type ConversationWidget,
  type RuntimeChange, type RuntimeInput, type RuntimeNotification, type RuntimeSeed, type RuntimeView,
} from '../domain/runtime.js';
import type { DialogClockPort, RuntimeOperationsPort } from '../ports.js';

interface PendingDialog { readonly dialog: ConversationDialog; cancel?: () => void }

/** One instance per worker conversation. No Session lifecycle or attachment authority. */
export class ConversationRuntimeApplication {
  private active = true;
  private underlyingActivity: AgentActivity = 'idle';
  private observedActivity = false;
  private queue: ConversationQueue = { steering: [], followUp: [] };
  private statuses: Record<string, string> = {};
  private widgets: ConversationWidget[] = [];
  private model?: RuntimeSeed['model'];
  private thinkingLevel?: string;
  private readonly dialogs = new Map<string, PendingDialog>();

  constructor(
    private readonly operations: RuntimeOperationsPort,
    private readonly clock: DialogClockPort,
    private readonly output: (notification: RuntimeNotification) => void,
  ) {}

  get waiting(): boolean { return this.dialogs.size > 0; }
  private get activity(): RuntimeView['activity'] { return this.waiting ? 'waiting-input' : this.underlyingActivity; }
  private assertActive(): void { if (!this.active) throw new RuntimeFailure('INVALIDATED'); }
  private notify(notification: RuntimeNotification): void {
    // Observers cannot strand dialogs or prevent transport/cleanup continuations.
    try { this.output(notification); } catch { /* delivery is owned by the adapter */ }
  }
  private changed(change: RuntimeChange = { activity: this.activity }): void {
    this.notify({ type: 'state-changed', change });
  }

  accept(input: RuntimeInput): void {
    if (!this.active) return;
    switch (input.type) {
      case 'activity':
        this.underlyingActivity = input.activity;
        this.observedActivity = true;
        this.changed();
        break;
      case 'queue':
        this.queue = copyQueue(input.queue);
        this.changed({ activity: this.activity, queue: copyQueue(this.queue) });
        break;
      case 'status':
        this.statuses = { ...this.statuses };
        if (input.text === undefined) delete this.statuses[input.key];
        else this.statuses[input.key] = input.text;
        this.changed({ activity: this.activity, statuses: { ...this.statuses } });
        break;
      case 'widget':
        this.widgets = this.widgets.filter(widget => widget.key !== input.key);
        if (input.content) this.widgets.push(copyWidget({ key: input.key, ...input.content }));
        this.changed({ activity: this.activity, widgets: this.widgets.map(copyWidget) });
        break;
      case 'dialog': {
        // Preserve the legacy pre-show projection, including before duplicate/limit failure.
        this.changed();
        if (!this.active) return;
        const dialog = copyDialog(input.dialog);
        if (this.dialogs.has(dialog.id)) throw new RuntimeFailure('DUPLICATE_DIALOG');
        if (this.dialogs.size >= 32) throw new RuntimeFailure('TOO_MANY_DIALOGS');
        const item: PendingDialog = { dialog };
        this.dialogs.set(dialog.id, item);
        if (dialog.expiresAt !== undefined) item.cancel = this.clock.at(dialog.expiresAt, () => {
          if (this.active) this.retire(item);
        });
        // Opening a dialog observed the underlying activity in the original handshake path.
        this.observedActivity = true;
        this.changed();
        if (this.active && this.dialogs.get(dialog.id) === item) this.notify({ type: 'dialog-opened', dialog: copyDialog(dialog) });
        break;
      }
    }
  }

  initialize(seed: RuntimeSeed): RuntimeView {
    this.assertActive();
    if (!this.waiting && !this.observedActivity) this.underlyingActivity = seed.activity;
    this.model = seed.model ? { ...seed.model } : undefined;
    this.thinkingLevel = seed.thinkingLevel;
    return this.snapshot();
  }

  snapshot(): RuntimeView {
    return {
      activity: this.activity, queue: copyQueue(this.queue), statuses: { ...this.statuses },
      widgets: this.widgets.map(copyWidget), model: this.model ? { ...this.model } : undefined,
      thinkingLevel: this.thinkingLevel,
    };
  }

  /** Each invocation owns its synchronous recovery outlet; stops are not serialized or coalesced. */
  async stop(publishRecovered: (queue: ConversationQueue) => void): Promise<void> {
    this.assertActive();
    const queue = await this.operations.clearQueue();
    this.assertActive();
    publishRecovered(copyQueue(queue));
    this.assertActive();
    if (this.underlyingActivity === 'responding') {
      try { await this.operations.abortBash?.(); }
      catch { /* Bash cancellation is best effort; ordinary abort remains authoritative. */ }
    }
    if (this.underlyingActivity === 'retrying') {
      try { await this.operations.abortRetry?.(); }
      catch { /* Retry cancellation is best effort; ordinary abort remains authoritative. */ }
    }
    this.assertActive();
    await this.operations.abort();
    this.assertActive();
  }

  async answer(response: ExtensionResponse): Promise<void> {
    this.assertActive();
    const item = this.dialogs.get(response.id);
    if (!item || (item.dialog.expiresAt !== undefined && item.dialog.expiresAt <= this.clock.now())) throw new RuntimeFailure('DIALOG_ENDED');
    validateAnswer(item.dialog, response);
    await this.operations.writeAnswer({ ...response });
    this.assertActive();
    // A timed-out answer may finish after another dialog reused its ID.
    this.retire(item);
  }

  private retire(item: PendingDialog): void {
    if (this.dialogs.get(item.dialog.id) !== item) return;
    item.cancel?.();
    this.dialogs.delete(item.dialog.id);
    this.notify({ type: 'dialog-closed', dialogId: item.dialog.id });
    this.observedActivity = true;
    this.changed();
  }

  /** Synchronous retirement is observable; all later input/await/timer callbacks are inert. */
  invalidate(): void {
    if (!this.active) return;
    this.active = false;
    for (const item of this.dialogs.values()) this.retire(item);
  }
}
