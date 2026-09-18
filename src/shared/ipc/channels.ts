import type { DesktopAPI } from './desktop-api.js';

export type InvokeMethod = { [K in keyof DesktopAPI]: ReturnType<DesktopAPI[K]> extends Promise<unknown> ? K : never }[keyof DesktopAPI];
export type SendMethod = { [K in keyof DesktopAPI]: ReturnType<DesktopAPI[K]> extends void ? K : never }[keyof DesktopAPI];
export type RequestMethod = InvokeMethod | SendMethod;
export type RequestArgs<K extends RequestMethod> = Parameters<DesktopAPI[K]>;
export type RequestResult<K extends RequestMethod> = Awaited<ReturnType<DesktopAPI[K]>>;

export const invokeChannels = {
  bootstrap: 'desktop:bootstrap',
  chooseDirectory: 'desktop:directory',
  chooseFile: 'desktop:file',
  chooseAttachments: 'desktop:attachments',
  removeChatAttachment: 'desktop:chat-attachment-remove',
  chooseChatAttachments: 'desktop:chat-attachments',
  savePreferences: 'desktop:preferences',
  inspectProjectResources: 'desktop:project-resources',
  createSession: 'desktop:create',
  startSession: 'desktop:start',
  closeSession: 'desktop:close',
  archiveSession: 'desktop:archive',
  restoreArchivedSession: 'desktop:archive-restore',
  deleteArchivedSession: 'desktop:archive-delete',
  setSessionPinned: 'desktop:session-pin',
  sendChatMessage: 'desktop:chat-send',
  stopChat: 'desktop:chat-stop',
  respondToExtensionUI: 'desktop:extension-response',
  renameChatSession: 'desktop:chat-rename',
  forkChatSession: 'desktop:chat-fork',
  getChatAvailableModels: 'desktop:chat-models',
  getChatThinkingLevels: 'desktop:chat-thinking-levels',
  setChatModel: 'desktop:chat-model-set',
  setChatThinkingLevel: 'desktop:chat-thinking-set',
  getChatSessionStats: 'desktop:chat-session-stats',
  compactChatSession: 'desktop:chat-compact',
  openExternal: 'desktop:external',
  openProject: 'desktop:project',
  gitStatus: 'desktop:git-status',
  fileDiff: 'desktop:file-diff',
  readClipboard: 'desktop:clipboard-read',
  writeClipboard: 'desktop:clipboard-write',
} as const satisfies Record<InvokeMethod, string>;

export const sendChannels = {
  write: 'desktop:write',
  resize: 'desktop:resize',
  acknowledge: 'desktop:ack',
} as const satisfies Record<SendMethod, string>;

export const eventChannels = {
  onSessionEvent: 'desktop:event',
} as const satisfies Record<Exclude<keyof DesktopAPI, RequestMethod>, string>;
