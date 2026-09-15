import type { InvokeMethod, RequestResult } from './channels.js';

export type DesktopErrorKind = 'authorization' | 'validation' | 'application' | 'internal';
export interface DesktopError { kind: DesktopErrorKind; code: string; message: string }
export type WireValue<T> = T extends void ? null : T;
export type DesktopResult<T> = { ok: true; value: T } | { ok: false; error: DesktopError };

/** Never stringify unknown host/transport failures or expose stack, cause or payload. */
export function safeErrorMessage(error: unknown, fallback: string): string;
export function safeErrorMessage(error: unknown): string | undefined;
export function safeErrorMessage(error: unknown, fallback?: string): string | undefined {
  try { if (error instanceof Error) { const message: unknown = error.message; if (typeof message === 'string') return message; } }
  catch { /* A throwing message getter is not a readable Error. */ }
  return fallback;
}

const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string';
const bool = (v: unknown) => typeof v === 'boolean';
const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const strings = (v: unknown) => Array.isArray(v) && Array.from(v).every(text);
const oneOf = (v: unknown, values: readonly string[]) => text(v) && values.includes(v);
const optional = (v: unknown, guard: (v: unknown) => boolean) => v === undefined || guard(v);
const activity = (v: unknown) => oneOf(v, ['idle', 'responding', 'compacting', 'retrying', 'waiting-input']);
const processStatus = (v: unknown) => oneOf(v, ['starting', 'running', 'exited']);
const preferences = (v: unknown) => record(v) && optional(v.theme, x => oneOf(x, ['system', 'light', 'dark'])) && text(v.piPath) && text(v.nodePath) && strings(v.args) && finite(v.fontSize) && strings(v.recentProjects);
const runtime = (v: unknown) => record(v) && text(v.executable) && strings(v.args) && text(v.source);
const bootstrap = (v: unknown) => record(v) && preferences(v.preferences) && (v.runtime === null || runtime(v.runtime)) && optional(v.runtimeError, text) && text(v.home) && text(v.platform);
const attachment = (v: unknown) => record(v) && text(v.id) && text(v.name) && text(v.path) && oneOf(v.kind, ['file', 'image']) && finite(v.size) && optional(v.mimeType, text) && optional(v.previewUrl, text);
const arrayOf = (v: unknown, guard: (v: unknown) => boolean) => Array.isArray(v) && Array.from(v).every(guard);
const empty = (v: unknown) => v === null;
const picker = (v: unknown) => v === null || text(v);

/** Exhaustive method-specific outer DTO checks; no cloning or recursive transcript schema. */
export const desktopValueGuards = {
  bootstrap, savePreferences: bootstrap,
  chooseDirectory: picker, chooseFile: picker, chooseAttachments: strings,
  chooseChatAttachments: (v: unknown) => arrayOf(v, attachment),
  inspectProjectResources: (v: unknown) => record(v) && bool(v.hasResources) && strings(v.paths),
  createSession: (v: unknown) => record(v) && text(v.id) && text(v.cwd) && text(v.title) && oneOf(v.kind, ['chat', 'terminal']) && processStatus(v.processStatus) && activity(v.activity) && optional(v.exitCode, Number.isSafeInteger),
  closeSession: bool,
  startSession: empty, removeChatAttachment: empty, sendChatMessage: empty, stopChat: empty,
  respondToExtensionUI: empty, renameChatSession: empty, forkChatSession: v => record(v) && text(v.text) && bool(v.cancelled), getChatAvailableModels: v => arrayOf(v, x => record(x) && text(x.provider) && text(x.id)), openExternal: empty, openProject: empty, writeClipboard: empty,
  setChatModel: empty, setChatThinkingLevel: empty,
  gitStatus: (v: unknown) => record(v) && text(v.root) && text(v.branch) && text(v.capturedAt) && arrayOf(v.files, f => record(f) && text(f.path) && text(f.index) && text(f.worktree) && optional(f.originalPath, text)),
  fileDiff: (v: unknown) => record(v) && text(v.text) && oneOf(v.kind, ['diff', 'untracked', 'binary', 'symlink']) && bool(v.truncated),
  readClipboard: (v: unknown) => record(v) && text(v.text) && bool(v.image),
} satisfies Record<InvokeMethod, (value: unknown) => boolean>;

export function parseDesktopResult<K extends InvokeMethod>(method: K, raw: unknown): DesktopResult<WireValue<RequestResult<K>>> | undefined {
  try {
    if (!record(raw)) return;
    const ok = raw.ok;
    if (ok === true && Object.prototype.hasOwnProperty.call(raw, 'value') && !('error' in raw)) {
      const value = raw.value;
      if (desktopValueGuards[method](value)) return { ok: true, value: value as WireValue<RequestResult<K>> };
    }
    if (ok === false && !('value' in raw)) {
      const error = raw.error;
      if (!record(error)) return;
      const { kind, code, message } = error;
      if (oneOf(kind, ['authorization', 'validation', 'application', 'internal']) && text(code) && code.length > 0 && text(message)) {
        return { ok: false, error: { kind: kind as DesktopErrorKind, code, message } };
      }
    }
  } catch { /* Unreadable wire is malformed, never success. */ }
}

type VoidMethod = { [K in InvokeMethod]: RequestResult<K> extends void ? K : never }[InvokeMethod];
export const desktopVoidMethods = {
  removeChatAttachment: true, startSession: true, sendChatMessage: true, stopChat: true,
  respondToExtensionUI: true, renameChatSession: true, setChatModel: true, setChatThinkingLevel: true, openExternal: true, openProject: true, writeClipboard: true,
} satisfies Record<VoidMethod, true>;

export function desktopSuccess<K extends InvokeMethod>(method: K, value: RequestResult<K>): DesktopResult<WireValue<RequestResult<K>>> {
  const wire = value === undefined && Object.prototype.hasOwnProperty.call(desktopVoidMethods, method) ? null : value;
  const result = parseDesktopResult(method, { ok: true, value: wire });
  return result ?? { ok: false, error: { kind: 'internal', code: 'INVALID_HOST_RESULT', message: '桌面返回了无效结果' } };
}

const dictionary = (v: unknown) => record(v) && Object.values(v).every(text);
const queue = (v: unknown) => record(v) && strings(v.steering) && strings(v.followUp);
const model = (v: unknown) => record(v) && text(v.provider) && text(v.id);
const state = (v: unknown) => record(v) && optional(v.activity, activity) && optional(v.model, model) && optional(v.thinkingLevel, text) && optional(v.queue, queue) && optional(v.statuses, dictionary) && optional(v.widgets, Array.isArray);
const message = (v: unknown) => record(v) && text(v.id) && oneOf(v.role, ['user', 'assistant', 'custom', 'summary']) && Array.isArray(v.blocks) && finite(v.timestamp) && optional(v.streaming, bool) && optional(v.error, text) && optional(v.label, text) && optional(v.forkEntryId, text);
const blockIndex = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= 4095;
function extension(v: unknown): boolean {
  if (!record(v) || !text(v.id) || !text(v.title) || !optional(v.expiresAt, finite)) return false;
  switch (v.method) {
    case 'select': return strings(v.options);
    case 'confirm': return text(v.message);
    case 'input': return optional(v.placeholder, text);
    case 'editor': return optional(v.prefill, text);
    default: return false;
  }
}

/** Control fields/outer containers only. Nested transcript blocks/tool JSON trust the same-version mapper. */
export function isDesktopSessionEvent(v: unknown): v is import('./conversation.js').SessionEvent {
  try {
    if (!record(v) || !text(v.id)) return false;
    switch (v.type) {
      case 'terminal-data': return text(v.data);
      case 'session-info': return optional(v.title, text) && optional(v.processStatus, processStatus) && optional(v.activity, activity);
      case 'chat-state': return state(v.state);
      case 'chat-snapshot': return record(v.snapshot) && state(v.snapshot) && activity(v.snapshot.activity) && queue(v.snapshot.queue) && dictionary(v.snapshot.statuses) && Array.isArray(v.snapshot.widgets) && Array.isArray(v.snapshot.messages) && Array.isArray(v.snapshot.commands);
      case 'chat-message-start': case 'chat-message-end': return message(v.message);
      case 'chat-message-delta': return text(v.messageId) && blockIndex(v.blockIndex) && oneOf(v.blockType, ['text', 'thinking']) && text(v.delta);
      case 'chat-tool': return record(v.tool) && text(v.tool.id) && text(v.tool.name) && record(v.tool.arguments) && oneOf(v.tool.status, ['pending', 'running', 'success', 'error']) && text(v.tool.output) && optional(v.tool.images, Array.isArray) && optional(v.messageId, text) && optional(v.blockIndex, blockIndex);
      case 'extension-ui': return extension(v.request);
      case 'extension-ui-closed': return text(v.requestId);
      case 'chat-notice': return oneOf(v.level, ['info', 'warning', 'error']) && text(v.message);
      case 'chat-queue-recovered': return text(v.requestId) && queue(v.queue);
      case 'chat-editor-text': return text(v.text);
      case 'exit': return Number.isSafeInteger(v.exitCode);
      default: return false;
    }
  } catch { return false; }
}
