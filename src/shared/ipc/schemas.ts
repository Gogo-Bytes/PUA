import { extensionResponse } from './conversation-validation.js';
import type { DiffScope } from './change-review.js';
import type { CreateSessionOptions, Preferences } from './desktop-api.js';
import type { RequestArgs, RequestMethod } from './channels.js';

function text(value: unknown): string {
  if (typeof value !== 'string' || value.includes('\0')) throw new Error('无效字符串');
  return value;
}
function boundedText(value: unknown, max: number, label: string): string {
  const result = text(value);
  if (result.length > max) throw new Error(`${label}过长`);
  return result;
}

export function validSize(cols: unknown, rows: unknown): cols is number {
  return Number.isInteger(cols) && Number.isInteger(rows) && Number(cols) >= 2 && Number(cols) <= 1000 && Number(rows) >= 2 && Number(rows) <= 1000;
}

export function validatePreferences(value: unknown): Preferences {
  if (!value || typeof value !== 'object') throw new Error('无效设置');
  const v = value as Record<string, unknown>;
  if (typeof v.piPath !== 'string' || typeof v.nodePath !== 'string' ||
      !Array.isArray(v.args) || !Array.from(v.args).every(arg => typeof arg === 'string' && !arg.includes('\0')) ||
      typeof v.fontSize !== 'number' || !Number.isFinite(v.fontSize) || v.fontSize < 10 || v.fontSize > 28 ||
      !Array.isArray(v.recentProjects) || !Array.from(v.recentProjects).every(p => typeof p === 'string') ||
      v.piPath.includes('\0') || v.nodePath.includes('\0')) throw new Error('设置格式错误：字体范围为 10–28，参数应为 JSON 字符串数组。');
  if (v.theme !== undefined && !['system', 'light', 'dark'].includes(v.theme as string)) throw new Error('无效外观主题');
  return { theme: (v.theme ?? 'system') as Preferences['theme'], piPath: v.piPath, nodePath: v.nodePath, args: [...v.args], fontSize: v.fontSize, recentProjects: [...new Set(v.recentProjects as string[])].slice(0, 20) };
}

export function validateCreateSessionOptions(value: unknown): CreateSessionOptions {
  if (!value || typeof value !== 'object') throw new Error('无效会话参数');
  const v = value as Record<string, unknown>;
  const cwd = text(v.cwd);
  const { kind, startMode, projectTrust, cols, rows } = v;
  if (kind !== 'chat' && kind !== 'terminal') throw new Error('无效会话类型');
  if (startMode !== 'new' && startMode !== 'continue' && startMode !== 'resume') throw new Error('无效会话模式');
  if (projectTrust !== 'default' && projectTrust !== 'approve' && projectTrust !== 'decline') throw new Error('无效信任选项');
  if (kind === 'terminal' ? !validSize(cols, rows) :
      (cols !== undefined && !validSize(cols, 2)) || (rows !== undefined && !validSize(2, rows))) throw new Error('无效终端尺寸');
  return { cwd, kind, startMode, projectTrust, cols: cols as number | undefined, rows: rows as number | undefined };
}

export function validateDiffScope(scope: unknown): DiffScope {
  if (scope !== 'worktree' && scope !== 'index') throw new Error('未知 diff 范围');
  return scope;
}

/** Exact argument tuples; filesystem, attachment ownership and session policy stay in main. */
function tuple<K extends RequestMethod>(count: number, parse: (...args: unknown[]) => RequestArgs<K>): (args: unknown[]) => RequestArgs<K> {
  return args => {
    if (args.length !== count) throw new Error('无效 IPC 参数数量');
    return parse(...args);
  };
}
const noArgs = tuple<'bootstrap'>(0, () => []);
const idArgs = tuple<'startSession'>(1, id => [text(id)]);

export const requestParsers: { [K in RequestMethod]: (args: unknown[]) => RequestArgs<K> } = {
  bootstrap: noArgs,
  chooseDirectory: noArgs,
  chooseFile: noArgs,
  chooseAttachments: noArgs,
  readClipboard: noArgs,
  chooseChatAttachments: idArgs,
  inspectProjectResources: idArgs,
  startSession: idArgs,
  closeSession: idArgs,
  stopChat: idArgs,
  openProject: idArgs,
  gitStatus: idArgs,
  writeClipboard: idArgs,
  savePreferences: tuple<'savePreferences'>(1, value => [validatePreferences(value)]),
  createSession: tuple<'createSession'>(1, value => [validateCreateSessionOptions(value)]),
  removeChatAttachment: tuple<'removeChatAttachment'>(2, (id, attachmentId) => [text(id), boundedText(attachmentId, 128, '附件 id')]),
  renameChatSession: tuple<'renameChatSession'>(2, (id, name) => [text(id), boundedText(name, 200, '会话名称')]),
  forkChatSession: tuple<'forkChatSession'>(2, (id, entryId) => [text(id), boundedText(entryId, 256, '分支消息 id')]),
  respondToExtensionUI: tuple<'respondToExtensionUI'>(2, (id, response) => [text(id), extensionResponse(response)]),
  sendChatMessage: tuple<'sendChatMessage'>(2, (id, input) => {
    const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};
    const message = boundedText(value.text ?? '', 8 * 1024 * 1024, '消息');
    if (!Array.isArray(value.attachmentIds) || value.attachmentIds.length > 20) throw new Error('无效附件');
    const attachmentIds = Array.from(value.attachmentIds).map(item => boundedText(item, 128, '附件 id'));
    const delivery = value.delivery;
    if (delivery !== 'prompt' && delivery !== 'steer' && delivery !== 'followUp') throw new Error('无效发送方式');
    return [text(id), { text: message, attachmentIds, delivery }];
  }),
  write: tuple<'write'>(2, (id, data) => {
    // Terminal control bytes (including NUL) are valid; never use text() for data.
    if (typeof data !== 'string') throw new Error('无效字符串');
    return [text(id), data];
  }),
  resize: tuple<'resize'>(3, (id, cols, rows) => {
    if (!validSize(cols, rows)) throw new Error('无效终端尺寸');
    return [text(id), cols, rows as number];
  }),
  acknowledge: tuple<'acknowledge'>(2, (id, size) => {
    if (!Number.isSafeInteger(size) || Number(size) <= 0) throw new Error('无效终端确认大小');
    return [text(id), size as number];
  }),
  openExternal: tuple<'openExternal'>(1, value => {
    const url = new URL(text(value));
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('仅支持打开 HTTP(S) 链接');
    return [url.href];
  }),
  fileDiff: tuple<'fileDiff'>(3, (id, filename, scope) => {
    const sessionId = text(id); const file = text(filename);
    return [sessionId, file, validateDiffScope(scope)];
  }),
};
