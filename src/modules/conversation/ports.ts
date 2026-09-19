import type { Attachment, AttachmentMetadata, AttachmentSourceId, AttachmentToken, ExtensionResponse, RuntimeSend } from './domain/conversation.js';
export interface ConversationSessionStats {
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  toolResults: number;
  totalMessages: number;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  cost: number;
  contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
}
import type { ConversationQueue } from './domain/runtime.js';
import type { ConversationObject } from './domain/stream.js';
export interface ConversationModel { provider: string; id: string; name?: string; reasoning?: boolean }
export type ConversationQueueMode = 'all' | 'one-at-a-time';
export interface ConversationAutoSettings { autoCompaction: boolean; autoRetry: boolean; steeringMode: ConversationQueueMode; followUpMode: ConversationQueueMode }

/** Worker operations acknowledge once; unknown acceptance must never be replayed. */
export interface RuntimeOperationsPort {
  clearQueue(): Promise<ConversationQueue>;
  abort(): Promise<void>;
  /** Best-effort cancellation of Pi's retry backoff; unsupported runtimes are ignored by the worker. */
  abortRetry?(): Promise<void>;
  /** Best-effort cancellation of an active Pi bash tool before ordinary abort. */
  abortBash?(): Promise<void>;
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
  getSessionStats(id: string): Promise<ConversationSessionStats>;
  getAutoSettings(id: string): Promise<ConversationAutoSettings>;
  setSteeringMode(id: string, mode: ConversationQueueMode): Promise<void>;
  setFollowUpMode(id: string, mode: ConversationQueueMode): Promise<void>;
  compact(id: string, customInstructions?: string): Promise<void>;
  setAutoCompaction(id: string, enabled: boolean): Promise<void>;
  setAutoRetry(id: string, enabled: boolean): Promise<void>;
  /** Capture authorized payloads and issue the request before returning; resolve only on acknowledgement. */
  send(id: string, command: RuntimeSend): Promise<void>;
  /** Delegates to the worker-scoped runtime's clear -> recovery -> abort use case. */
  stop(id: string): Promise<void>;
  respond(id: string, response: ExtensionResponse): Promise<void>;
  rename(id: string, name: string): Promise<void>;
  /** Fork from a stable Pi user-entry identity; the worker rebinds the active runtime. */
  fork(id: string, entryId: string): Promise<{ text: string; cancelled: boolean }>;
  /** Native Pi clone: duplicates the active branch into a new Pi session file. */
  clone?(id: string): Promise<{ cancelled: boolean }>;
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
