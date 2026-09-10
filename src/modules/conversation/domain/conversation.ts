export type Delivery = 'prompt' | 'steer' | 'followUp';
export type AttachmentToken = string;
/** A resource locator minted at the edge; never a filesystem path. */
export type AttachmentSourceId = string & { readonly attachmentSource: unique symbol };
export interface AttachmentMetadata {
  readonly name: string;
  readonly kind: 'file' | 'image';
  readonly size: number;
  readonly mimeType?: string;
}
export interface Attachment extends AttachmentMetadata { readonly id: AttachmentToken }
export interface SendIntent {
  readonly text: string;
  readonly attachmentIds: readonly AttachmentToken[];
  readonly delivery: Delivery;
}
export interface RuntimeSend {
  readonly text: string;
  readonly attachmentIds: readonly AttachmentToken[];
  readonly queuePreference: 'steer' | 'followUp';
}
export type ExtensionResponse =
  | { readonly id: string; readonly value: string }
  | { readonly id: string; readonly confirmed: boolean }
  | { readonly id: string; readonly cancelled: true };

export type ConversationFailureCode =
  | 'CLOSED' | 'INVALID_DELIVERY' | 'EMPTY_MESSAGE' | 'INVALID_ATTACHMENTS'
  | 'ATTACHMENT_EXPIRED' | 'SEND_PENDING' | 'TOO_MANY_ATTACHMENTS'
  | 'TOO_MANY_IMAGES' | 'IMAGE_TOO_LARGE' | 'IMAGES_TOO_LARGE';
export class ConversationFailure extends Error {
  constructor(readonly code: ConversationFailureCode, readonly attachmentName?: string) {
    super(code);
    this.name = 'ConversationFailure';
  }
}
export const MAX_ATTACHMENTS = 20;
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_TOTAL_BYTES = 10 * 1024 * 1024;

export function admitImage(existing: readonly Pick<AttachmentMetadata, 'size'>[], candidate: AttachmentMetadata): void {
  if (candidate.kind !== 'image') return;
  if (existing.length + 1 > MAX_IMAGES) throw new ConversationFailure('TOO_MANY_IMAGES');
  if (candidate.size > MAX_IMAGE_BYTES) throw new ConversationFailure('IMAGE_TOO_LARGE', candidate.name);
  if (existing.reduce((sum, item) => sum + item.size, 0) + candidate.size > MAX_IMAGE_TOTAL_BYTES) {
    throw new ConversationFailure('IMAGES_TOO_LARGE');
  }
}

export function selectAttachments(intent: SendIntent, registered: ReadonlyMap<AttachmentToken, Attachment>): Attachment[] {
  if (!['prompt', 'steer', 'followUp'].includes(intent.delivery)) throw new ConversationFailure('INVALID_DELIVERY');
  if (!intent.text.trim() && intent.attachmentIds.length === 0) throw new ConversationFailure('EMPTY_MESSAGE');
  if (intent.attachmentIds.length > MAX_ATTACHMENTS || new Set(intent.attachmentIds).size !== intent.attachmentIds.length) {
    throw new ConversationFailure('INVALID_ATTACHMENTS');
  }
  const images: Attachment[] = [];
  return intent.attachmentIds.map(id => {
    const item = registered.get(id);
    if (!item) throw new ConversationFailure('ATTACHMENT_EXPIRED');
    if (item.kind === 'image') { admitImage(images, item); images.push(item); }
    return item;
  });
}
