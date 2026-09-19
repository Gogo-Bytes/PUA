import type { ExtensionUIResponse, SessionEvent } from './conversation.js';

/** Internal utility wire only: no Pi commands, resource handles or attachment tokens. */
export interface WorkerLaunch {
  executable: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}
export interface WorkerImage { data: string; mimeType: string }
/** Pi 0.85.1 operations reserved for the explicit capability adapters. */
export type RpcCapabilityOperation =
  | { type: 'get-available-models' }
  | { type: 'get-available-thinking-levels' }
  | { type: 'get-tree' }
  | { type: 'get-fork-messages' }
  | { type: 'get-entries'; since?: string }
  | { type: 'fork'; entryId: string }
  | { type: 'clone' }
  | { type: 'switch-session'; sessionPath: string }
  | { type: 'get-state' }
  | { type: 'get-session-stats' }
  | { type: 'get-auto-settings' }
  | { type: 'set-model'; provider: string; modelId: string }
  | { type: 'set-thinking-level'; level: string }
  | { type: 'set-auto-compaction'; enabled: boolean }
  | { type: 'set-auto-retry'; enabled: boolean }
  | { type: 'abort-retry' }
  | { type: 'abort-bash' }
  | { type: 'set-steering-mode'; mode: 'all' | 'one-at-a-time' }
  | { type: 'set-follow-up-mode'; mode: 'all' | 'one-at-a-time' }
  | { type: 'compact'; customInstructions?: string }
  | { type: 'export-html'; outputPath: string };
export type RpcOperation =
  | { type: 'send'; text: string; filePaths: string[]; images: WorkerImage[]; queuePreference: 'steer' | 'followUp' }
  | { type: 'stop' }
  | { type: 'extension-response'; response: ExtensionUIResponse }
  | { type: 'rename'; name: string }
  | RpcCapabilityOperation;
export type RpcRequest = RpcOperation & { requestId: string };
export type RpcWorkerInput =
  | ({ type: 'start'; id: string } & WorkerLaunch)
  | RpcRequest
  | { type: 'close' };
export type PtyWorkerInput =
  | ({ type: 'start'; cols: number; rows: number } & WorkerLaunch)
  | { type: 'write'; data: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'ack'; size: number }
  | { type: 'close' };
export type RpcWorkerEvent = Exclude<SessionEvent, { type: 'terminal-data' }>;
export type RpcWorkerOutput =
  | { type: 'event'; event: RpcWorkerEvent }
  | { type: 'session-identity'; sessionId: string; sessionFile: string }
  | { type: 'child-pid'; pid: number }
  | { type: 'response'; requestId: string; success: true; data?: unknown }
  | { type: 'response'; requestId: string; success: false; error: string };
export type PtyWorkerOutput =
  | { type: 'data'; data: string }
  | { type: 'child-pid'; pid: number }
  | { type: 'error'; message: string }
  | { type: 'exit'; exitCode: number };

/** Implemented by Electron's transport at the edge; callers cannot send arbitrary commands. */
export interface WorkerInputPort<Message extends RpcWorkerInput | PtyWorkerInput> {
  postMessage(message: Message): void;
}
