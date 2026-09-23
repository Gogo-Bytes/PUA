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
const command = (v: unknown) => record(v) && text(v.name) && oneOf(v.source, ['extension', 'prompt', 'skill']) && optional(v.description, text);
const activity = (v: unknown) => oneOf(v, ['idle', 'responding', 'compacting', 'retrying', 'waiting-input']);
const processStatus = (v: unknown) => oneOf(v, ['starting', 'running', 'exited']);
const preferences = (v: unknown) => record(v) && optional(v.theme, x => oneOf(x, ['system', 'light', 'dark'])) && text(v.piPath) && text(v.nodePath) && strings(v.args) && finite(v.fontSize) && strings(v.recentProjects);
const runtime = (v: unknown) => record(v) && text(v.executable) && strings(v.args) && text(v.source);
const sessionInfo = (v: unknown) => record(v) && text(v.id) && text(v.cwd) && text(v.title) && oneOf(v.kind, ['chat', 'terminal']) && processStatus(v.processStatus) && activity(v.activity) && optional(v.exitCode, Number.isSafeInteger) && optional(v.archived, bool) && optional(v.pinned, bool) && optional(v.lastActivityAt, finite);
const bootstrap = (v: unknown) => record(v) && preferences(v.preferences) && (v.runtime === null || runtime(v.runtime)) && optional(v.runtimeError, text) && text(v.home) && text(v.platform) && optional(v.restoredSessions, value => arrayOf(value, sessionInfo)) && optional(v.archivedSessions, value => arrayOf(value, sessionInfo));
const attachment = (v: unknown) => record(v) && text(v.id) && text(v.name) && text(v.path) && oneOf(v.kind, ['file', 'image']) && finite(v.size) && optional(v.mimeType, text) && optional(v.previewUrl, text);
const sessionStats = (v: unknown) => {
  if (!record(v) || !finite(v.userMessages) || !finite(v.assistantMessages) || !finite(v.toolCalls) || !finite(v.toolResults) || !finite(v.totalMessages) || !finite(v.cost) || !record(v.tokens)) return false;
  const tokens = v.tokens as Record<string, unknown>;
  if (!['input', 'output', 'cacheRead', 'cacheWrite', 'total'].every(key => finite(tokens[key]))) return false;
  return optional(v.contextUsage, context => record(context) && finite(context.contextWindow) && (context.tokens === null || finite(context.tokens)) && (context.percent === null || finite(context.percent)));
};
const arrayOf = (v: unknown, guard: (v: unknown) => boolean) => Array.isArray(v) && Array.from(v).every(guard);
const empty = (v: unknown) => v === null;
const picker = (v: unknown) => v === null || text(v);
const chatTree = (v: unknown, depth = 0): boolean => depth < 64 && arrayOf(v, node => record(node) && text(node.entryId) && optional(node.label, text) && optional(node.forkable, bool) && optional(node.active, bool) && chatTree(node.children, depth + 1));

/** Exhaustive method-specific outer DTO checks; no cloning or recursive transcript schema. */
export const desktopValueGuards = {
  bootstrap, savePreferences: bootstrap,
  chooseDirectory: picker, chooseFile: picker, chooseAttachments: strings,
  chooseChatAttachments: (v: unknown) => arrayOf(v, attachment),
  inspectProjectResources: (v: unknown) => record(v) && bool(v.hasResources) && strings(v.paths) && optional(v.skills, value => arrayOf(value, command)) && optional(v.prompts, value => arrayOf(value, command)),
  createSession: sessionInfo,
  searchHistory: v => arrayOf(v, x => record(x) && text(x.taskId) && text(x.title) && text(x.cwd) && text(x.entryId) && oneOf(x.role, ['user', 'assistant', 'custom', 'summary', 'bashExecution']) && text(x.snippet) && finite(x.timestamp) && bool(x.archived) && text(x.query)),
  closeSession: bool, restoreArchivedSession: sessionInfo, deleteArchivedSession: empty, setSessionPinned: empty,
  startSession: empty, removeChatAttachment: empty, sendChatMessage: empty, stopChat: empty,
  respondToExtensionUI: empty, renameChatSession: empty, forkChatSession: v => record(v) && text(v.text) && bool(v.cancelled), cloneChatSession: sessionInfo, getChatAvailableModels: v => arrayOf(v, x => record(x) && text(x.provider) && text(x.id)), getChatModelCatalog: v => arrayOf(v, x => record(x) && text(x.provider) && text(x.id) && optional(x.name, text) && optional(x.reasoning, bool)), openExternal: empty, openProject: empty, writeClipboard: empty,
  setChatModel: empty, setChatThinkingLevel: empty, getChatSessionStats: sessionStats, getChatAutoSettings: v => record(v) && bool(v.autoCompaction) && bool(v.autoRetry) && (v.steeringMode === undefined || v.steeringMode === 'all' || v.steeringMode === 'one-at-a-time') && (v.followUpMode === undefined || v.followUpMode === 'all' || v.followUpMode === 'one-at-a-time'), compactChatSession: empty,
  setChatAutoCompaction: empty, setChatAutoRetry: empty, setChatSteeringMode: empty, setChatFollowUpMode: empty,
  getChatThinkingLevels: v => arrayOf(v, text),
  gitStatus: (v: unknown) => record(v) && text(v.root) && text(v.branch) && text(v.capturedAt) && arrayOf(v.files, f => record(f) && text(f.path) && text(f.index) && text(f.worktree) && optional(f.originalPath, text)),
  fileDiff: (v: unknown) => record(v) && text(v.text) && oneOf(v.kind, ['diff', 'untracked', 'binary', 'symlink']) && bool(v.truncated),
  listSessionFiles: (v: unknown) => record(v) && text(v.path) && bool(v.truncated) && arrayOf(v.entries, entry => record(entry) && text(entry.name) && text(entry.path) && oneOf(entry.kind, ['file', 'directory'])),
  readSessionFile: (v: unknown) => record(v) && text(v.path) && text(v.text) && bool(v.truncated),
  createBrowserView: text,
  setBrowserViewBounds: empty, navigateBrowser: empty, goBackBrowser: empty, goForwardBrowser: empty, reloadBrowser: empty, disposeBrowserView: empty,
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
  removeChatAttachment: true, startSession: true, sendChatMessage: true, stopChat: true, deleteArchivedSession: true, setSessionPinned: true,
  respondToExtensionUI: true, renameChatSession: true, setChatModel: true, setChatThinkingLevel: true, setChatAutoCompaction: true, setChatAutoRetry: true, setChatSteeringMode: true, setChatFollowUpMode: true, compactChatSession: true, openExternal: true, openProject: true, writeClipboard: true,
  setBrowserViewBounds: true, navigateBrowser: true, goBackBrowser: true, goForwardBrowser: true, reloadBrowser: true, disposeBrowserView: true,
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
      case 'chat-fork-metadata': return chatTree(v.sessionTree) && Array.isArray(v.entries) && v.entries.every(entry => record(entry) && text(entry.entryId) && text(entry.text));
      case 'terminal-data': return text(v.data);
      case 'session-info': return optional(v.title, text) && optional(v.processStatus, processStatus) && optional(v.activity, activity) && optional(v.lastActivityAt, finite);
      case 'chat-state': return state(v.state);
      case 'chat-snapshot': return record(v.snapshot) && state(v.snapshot) && activity(v.snapshot.activity) && queue(v.snapshot.queue) && dictionary(v.snapshot.statuses) && Array.isArray(v.snapshot.widgets) && Array.isArray(v.snapshot.messages) && Array.isArray(v.snapshot.commands) && optional(v.snapshot.sessionTree, chatTree);
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

export function isDesktopBrowserViewState(v: unknown): v is import('./desktop-api.js').BrowserViewState {
  return record(v) && text(v.id) && text(v.url) && text(v.title) && bool(v.canGoBack) && bool(v.canGoForward) && bool(v.loading) && optional(v.error, text);
}
