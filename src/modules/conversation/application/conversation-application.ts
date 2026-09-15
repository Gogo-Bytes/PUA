import { admitImage, ConversationFailure, MAX_ATTACHMENTS, selectAttachments } from '../domain/conversation.js';
import type { Attachment, AttachmentSourceId, AttachmentToken, ExtensionResponse, SendIntent } from '../domain/conversation.js';
import type { AttachmentResourcesPort, ConversationRuntimePort } from '../ports.js';
import type { ChatModel } from '../../../shared/ipc/conversation.js';

interface OperationContext {
  readonly attachments: Map<AttachmentToken, Attachment>;
  registration: Promise<unknown>;
  sending: boolean;
}

/** Owns send/attachment business state only. SessionCoordinator still owns lifecycle.
 * Invalidation is synchronous and does not acknowledge host exit or release Session ownership. */
export class ConversationApplication {
  getAvailableModels(id: string): Promise<ChatModel[]> { this.current(id); return this.runtime.getAvailableModels(id); }
  private readonly contexts = new Map<string, OperationContext>();
  constructor(private readonly runtime: ConversationRuntimePort, private readonly resources: AttachmentResourcesPort) {}

  /** Composition installs an operation identity after Session reservation; this never starts a process. */
  open(id: string): void {
    if (this.contexts.has(id)) throw new Error('Duplicate conversation context');
    this.contexts.set(id, { attachments: new Map(), registration: Promise.resolve(), sending: false });
  }

  invalidate(id: string): void {
    const context = this.contexts.get(id);
    if (!context) return;
    this.contexts.delete(id);
    this.resources.release(id, [...context.attachments.keys()]);
    context.attachments.clear();
  }

  private current(id: string, operation: 'attachments' | 'send' = 'attachments'): OperationContext {
    // Preserve edge-specific not-found/not-chat/closed errors before checking our operation identity.
    this.resources.assertAvailable(id, operation);
    const context = this.contexts.get(id);
    if (!context) throw new ConversationFailure('CLOSED');
    return context;
  }

  private assertCurrent(id: string, context: OperationContext): void {
    if (this.contexts.get(id) !== context) throw new ConversationFailure('CLOSED');
    this.resources.assertAvailable(id, 'attachments');
  }

  /** Takes ownership of staged sources on every outcome; batches are serial and all-or-nothing per ID. */
  async registerAttachments(id: string, sources: readonly AttachmentSourceId[]): Promise<Attachment[]> {
    const selected = [...sources];
    try {
      const context = this.current(id);
      const work = context.registration.then(() => this.registerBatch(id, context, selected));
      context.registration = work.catch(() => {});
      return await work;
    } finally { this.resources.discardSources(id, selected); }
  }

  private async registerBatch(id: string, context: OperationContext, sources: readonly AttachmentSourceId[]): Promise<Attachment[]> {
    this.assertCurrent(id, context);
    if (context.attachments.size + sources.length > MAX_ATTACHMENTS) throw new ConversationFailure('TOO_MANY_ATTACHMENTS');
    const images = [...context.attachments.values()].filter(item => item.kind === 'image');
    const batch: Attachment[] = [];
    try {
      for (const source of sources) {
        const item = await this.resources.read(id, source, metadata => {
          this.assertCurrent(id, context);
          admitImage(images, metadata);
        });
        // Include the returned payload in rollback even if invalidation happened during the read.
        batch.push({ ...item });
        this.assertCurrent(id, context);
        if (item.kind === 'image') images.push(item);
      }
      this.assertCurrent(id, context);
      for (const item of batch) context.attachments.set(item.id, item);
      return batch.map(item => ({ ...item }));
    } catch (error) {
      this.resources.release(id, batch.map(item => item.id));
      throw error;
    }
  }

  removeAttachment(id: string, token: AttachmentToken): void {
    const context = this.current(id);
    context.attachments.delete(token);
    this.resources.release(id, [token]);
  }

  async send(id: string, input: SendIntent): Promise<void> {
    const intent = { ...input, attachmentIds: [...input.attachmentIds] };
    const context = this.current(id, 'send');
    const selected = selectAttachments(intent, context.attachments);
    if (context.sending) throw new ConversationFailure('SEND_PENDING');
    context.sending = true;
    try {
      // No await before runtime.send: chip revocation cannot change the captured wire request.
      await this.runtime.send(id, {
        text: intent.text,
        attachmentIds: selected.map(item => item.id),
        queuePreference: intent.delivery === 'followUp' ? 'followUp' : 'steer',
      });
      if (this.contexts.get(id) !== context) return;
      for (const item of selected) context.attachments.delete(item.id);
      this.resources.release(id, selected.map(item => item.id));
    } finally { context.sending = false; }
  }

  stop(id: string): Promise<void> { return this.runtime.stop(id); }
  respond(id: string, response: ExtensionResponse): Promise<void> { return this.runtime.respond(id, response); }
  rename(id: string, name: string): Promise<void> { return this.runtime.rename(id, name); }
  fork(id: string, entryId: string): Promise<{ text: string; cancelled: boolean }> { return this.runtime.fork(id, entryId); }
}
