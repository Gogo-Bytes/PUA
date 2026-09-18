import type { Attachment, AttachmentMetadata, AttachmentSourceId, AttachmentToken, ExtensionResponse, RuntimeSend } from './domain/conversation.js';
import type { ConversationQueue } from './domain/runtime.js';
import type { ConversationObject } from './domain/stream.js';
export interface ConversationModel { provider: string; id: string; name?: string; reasoning?: boolean }

/** Worker operations acknowledge once; unknown acceptance must never be replayed. */
export interface RuntimeOperationsPort {
  clearQueue(): Promise<ConversationQueue>;
  abort(): Promise<void>;
  writeAnswer(response: ExtensionResponse): Promise<void>;
}
export interface DialogClockPort {
  now(): number;
  /** Schedule asynchronously; cancellation is synchronous and non-throwing. */
  at(deadline: number, callback: () => void): () => void;
}

export interface ConversationRuntimePort {
  getAvailableModels(id: string): Promise<ConversationModel[]>;
  getAvailableThinkingLevels(id: string): Promise<string[]>;
  setModel(id: string, provider: string, modelId: string): Promise<void>;
  setThinkingLevel(id: string, level: string): Promise<void>;
  compact(id: string, customInstructions?: string): Promise<void>;
  /** Capture authorized payloads and issue the request before returning; resolve only on acknowledgement. */
  send(id: string, command: RuntimeSend): Promise<void>;
  /** Delegates to the worker-scoped runtime's clear -> recovery -> abort use case. */
  stop(id: string): Promise<void>;
  respond(id: string, response: ExtensionResponse): Promise<void>;
  rename(id: string, name: string): Promise<void>;
  /** Fork from a stable Pi user-entry identity; the worker rebinds the active runtime. */
  fork(id: string, entryId: string): Promise<{ text: string; cancelled: boolean }>;
}

/** Source IDs and tokens must be fresh across replacement contexts: late disposal cannot touch new resources. */
export interface AttachmentResourcesPort {
  /** Consult current Session permission, not a cached Conversation lifecycle. */
  assertAvailable(id: string, operation: 'attachments' | 'send'): void;
  /** Call admit after metadata lookup and before allocating/reading image bytes.
   * Recheck resource identity/permission after every await; close handles even on rejection.
   * A rejected read must not retain a payload. */
  read(id: string, source: AttachmentSourceId, admit: (metadata: AttachmentMetadata) => void): Promise<Attachment>;
  /** Synchronous, idempotent, non-throwing resource disposal; never grants token authority. */
  release(id: string, tokens: readonly AttachmentToken[]): void;
  discardSources(id: string, sources: readonly AttachmentSourceId[]): void;
}

/** Schedule once, asynchronously. Cancellation is synchronous and non-throwing. */
export interface StreamSchedulePort {
  after(delayMs: number, callback: () => void): () => void;
}
export interface ArgumentDecoderPort {
  /** Return only a complete JSON object; incomplete or non-object values leave arguments unchanged. */
  decode(text: string): ConversationObject | undefined;
}
