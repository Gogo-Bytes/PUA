import { extensionResponse, validBlockIndex } from './conversation-validation.js';
import type { ExtensionUIRequest } from './conversation.js';
import { validSize } from './schemas.js';
import type { RpcWorkerEvent, RpcWorkerInput, RpcWorkerOutput, PtyWorkerInput, PtyWorkerOutput, WorkerLaunch } from './worker-protocol.js';

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string';
const id = (value: unknown): value is string => text(value) && value.length > 0;
const strings = (value: unknown): value is string[] => Array.isArray(value) && Array.from(value).every(text);
const dictionary = (value: unknown): value is Record<string, string> => record(value) && Object.values(value).every(text);
const positiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const integer = (value: unknown): value is number => Number.isSafeInteger(value);
const oneOf = (value: unknown, choices: readonly string[]) => text(value) && choices.includes(value);
const activity = (value: unknown) => oneOf(value, ['idle', 'responding', 'compacting', 'retrying', 'waiting-input']);
const optional = (value: unknown, check: (value: unknown) => boolean) => value === undefined || check(value);
const queue = (value: unknown) => record(value) && strings(value.steering) && strings(value.followUp);
const tree = (value: unknown, depth = 0): boolean => depth < 64 && Array.isArray(value) && value.every(item => record(item) && text(item.entryId) && optional(item.label, text) && optional(item.forkable, value => typeof value === 'boolean') && tree(item.children, depth + 1));

export type WorkerParse<T> = { ok: true; message: T } | { ok: false; requestId?: string; error: string };
/** Correlation is usable even when a request/response body is malformed. Never creates pending work. */
export function workerRequestId(value: unknown): string | undefined {
  return record(value) && id(value.requestId) ? value.requestId : undefined;
}
function launch(value: Record<string, unknown>): WorkerLaunch | undefined {
  if (!text(value.executable) || !strings(value.args) || !text(value.cwd) || !dictionary(value.env)) return;
  return { executable: value.executable, args: [...value.args], cwd: value.cwd, env: { ...value.env } };
}

/** Rebuild inbound capabilities. No length limits are added to authorized text, paths or images. */
export function parseRpcWorkerInput(value: unknown): WorkerParse<RpcWorkerInput> {
  const invalid = (error = 'Error: Invalid RPC worker message'): WorkerParse<RpcWorkerInput> => ({ ok: false, requestId: workerRequestId(value), error });
  if (!record(value)) return invalid();
  if (value.type === 'close') return { ok: true, message: { type: 'close' } };
  if (value.type === 'start') {
    const config = launch(value);
    return config && id(value.id) ? { ok: true, message: { type: 'start', id: value.id, ...config } } : invalid();
  }
  const requestId = workerRequestId(value);
  if (!requestId) return invalid();
  switch (value.type) {
    case 'send': {
      if (!text(value.text) || !strings(value.filePaths) || !Array.isArray(value.images) ||
          !Array.from(value.images).every(image => record(image) && text(image.data) && text(image.mimeType)) ||
          (value.queuePreference !== 'steer' && value.queuePreference !== 'followUp')) return invalid();
      return { ok: true, message: { type: 'send', requestId, text: value.text, filePaths: [...value.filePaths],
        images: value.images.map(image => ({ data: image.data, mimeType: image.mimeType })), queuePreference: value.queuePreference } };
    }
    case 'stop': return { ok: true, message: { type: 'stop', requestId } };
    case 'rename': return text(value.name) ? { ok: true, message: { type: 'rename', requestId, name: value.name } } : invalid();
    case 'extension-response':
      try { return { ok: true, message: { type: 'extension-response', requestId, response: extensionResponse(value.response) } }; }
      catch (error) { return invalid(String(error)); }
    case 'get-available-models': case 'get-available-thinking-levels': case 'get-tree': case 'get-fork-messages': case 'get-state': case 'get-session-stats': case 'get-auto-settings':
      return { ok: true, message: { type: value.type, requestId } };
    case 'fork': return text(value.entryId) ? { ok: true, message: { type: 'fork', requestId, entryId: value.entryId } } : invalid();
    case 'switch-session': return text(value.sessionPath) ? { ok: true, message: { type: 'switch-session', requestId, sessionPath: value.sessionPath } } : invalid();
    case 'set-model': return text(value.provider) && text(value.modelId) ? { ok: true, message: { type: 'set-model', requestId, provider: value.provider, modelId: value.modelId } } : invalid();
    case 'set-thinking-level': return text(value.level) ? { ok: true, message: { type: 'set-thinking-level', requestId, level: value.level } } : invalid();
    case 'set-auto-compaction': case 'set-auto-retry': return typeof value.enabled === 'boolean' ? { ok: true, message: { type: value.type, requestId, enabled: value.enabled } } : invalid();
    case 'compact': return (value.customInstructions === undefined || text(value.customInstructions)) ? { ok: true, message: { type: 'compact', requestId, ...(value.customInstructions === undefined ? {} : { customInstructions: value.customInstructions }) } } : invalid();
    case 'export-html': return text(value.outputPath) ? { ok: true, message: { type: 'export-html', requestId, outputPath: value.outputPath } } : invalid();
    default: return invalid();
  }
}
export function parsePtyWorkerInput(value: unknown): PtyWorkerInput | undefined {
  if (!record(value)) return;
  switch (value.type) {
    case 'start': {
      const config = launch(value);
      if (config && validSize(value.cols, value.rows)) return { type: 'start', ...config, cols: value.cols, rows: value.rows as number };
      return;
    }
    case 'close': return { type: 'close' };
    case 'write': return text(value.data) ? { type: 'write', data: value.data } : undefined;
    case 'resize': return validSize(value.cols, value.rows) ? { type: 'resize', cols: value.cols, rows: value.rows as number } : undefined;
    case 'ack': return positiveInteger(value.size) ? { type: 'ack', size: value.size } : undefined;
  }
}

/** Validate each dialog branch before exposing its required fields to observers. */
function mappedExtensionRequest(value: unknown): ExtensionUIRequest | undefined {
  if (!record(value) || !id(value.id) || !text(value.title)) return;
  if (value.expiresAt !== undefined && (typeof value.expiresAt !== 'number' || !Number.isFinite(value.expiresAt))) return;
  const common = { id: value.id, title: value.title, expiresAt: value.expiresAt };
  switch (value.method) {
    case 'select': return strings(value.options) ? { ...common, method: 'select', options: [...value.options] } : undefined;
    case 'confirm': return text(value.message) ? { ...common, method: 'confirm', message: value.message } : undefined;
    case 'input':
      if (value.placeholder !== undefined && !text(value.placeholder)) return;
      return { ...common, method: 'input', placeholder: value.placeholder };
    case 'editor':
      if (value.prefill !== undefined && !text(value.prefill)) return;
      return { ...common, method: 'editor', prefill: value.prefill };
  }
}

/** Same-version mapper trust seam, NOT a recursive transcript/tool JSON validator.
 * Validate tags, session identity, control scalars and outer payload containers here.
 * Nested message blocks/tool JSON remain produced by the worker mapper, not external IPC.
 */
function mappedEvent(value: unknown, sessionId: string): RpcWorkerEvent | undefined {
  if (!record(value) || value.id !== sessionId) return;
  let valid = false;
  switch (value.type) {
    case 'chat-fork-metadata': valid = tree(value.sessionTree) && Array.isArray(value.entries) && value.entries.every(entry => record(entry) && text(entry.entryId) && text(entry.text)); break;
    case 'session-info': valid = optional(value.title, text) && optional(value.activity, activity) && optional(value.processStatus, x => oneOf(x, ['starting', 'running', 'exited'])); break;
    case 'chat-state': valid = record(value.state) && optional(value.state.activity, activity) && optional(value.state.queue, queue) && optional(value.state.statuses, dictionary) && optional(value.state.widgets, Array.isArray); break;
    case 'chat-snapshot': valid = record(value.snapshot) && activity(value.snapshot.activity) && queue(value.snapshot.queue) && dictionary(value.snapshot.statuses) && Array.isArray(value.snapshot.widgets) && Array.isArray(value.snapshot.messages) && Array.isArray(value.snapshot.commands) && optional(value.snapshot.sessionTree, tree); break;
    case 'chat-message-start': case 'chat-message-end': valid = record(value.message) && text(value.message.id) && Array.isArray(value.message.blocks); break;
    case 'chat-tool': valid = record(value.tool) && text(value.tool.id) && optional(value.messageId, text) && optional(value.blockIndex, validBlockIndex); break;
    case 'chat-message-delta': valid = text(value.messageId) && validBlockIndex(value.blockIndex) && (value.blockType === 'text' || value.blockType === 'thinking') && text(value.delta); break;
    case 'extension-ui': {
      const request = mappedExtensionRequest(value.request);
      return request ? { type: 'extension-ui', id: sessionId, request } : undefined;
    }
    case 'extension-ui-closed': valid = id(value.requestId); break;
    case 'chat-queue-recovered': valid = id(value.requestId) && queue(value.queue); break;
    case 'chat-editor-text': valid = text(value.text); break;
    case 'chat-notice': valid = oneOf(value.level, ['info', 'warning', 'error']) && text(value.message); break;
    case 'exit': valid = integer(value.exitCode); break;
  }
  return valid ? value as unknown as RpcWorkerEvent : undefined;
}
export function parseRpcWorkerOutput(value: unknown, sessionId: string): RpcWorkerOutput | undefined {
  if (!record(value)) return;
  if (value.type === 'child-pid' && positiveInteger(value.pid)) return { type: 'child-pid', pid: value.pid };
  if (value.type === 'session-identity' && id(value.sessionId) && id(value.sessionFile) && value.sessionFile.length <= 4096) return { type: 'session-identity', sessionId: value.sessionId, sessionFile: value.sessionFile };
  if (value.type === 'event') {
    const event = mappedEvent(value.event, sessionId);
    return event ? { type: 'event', event } : undefined;
  }
  if (value.type === 'response' && id(value.requestId)) {
    if (value.success === true && !Object.hasOwn(value, 'error') && (!Object.hasOwn(value, 'data') || record(value.data))) return { type: 'response', requestId: value.requestId, success: true, ...(Object.hasOwn(value, 'data') ? { data: value.data } : {}) };
    if (value.success === false && text(value.error) && !Object.hasOwn(value, 'data')) return { type: 'response', requestId: value.requestId, success: false, error: value.error };
  }
}
export function parsePtyWorkerOutput(value: unknown): PtyWorkerOutput | undefined {
  if (!record(value)) return;
  switch (value.type) {
    case 'child-pid': return positiveInteger(value.pid) ? { type: 'child-pid', pid: value.pid } : undefined;
    case 'data': return text(value.data) ? { type: 'data', data: value.data } : undefined;
    case 'error': return text(value.message) ? { type: 'error', message: value.message } : undefined;
    case 'exit': return integer(value.exitCode) ? { type: 'exit', exitCode: value.exitCode } : undefined;
  }
}
