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
  restoreArchivedSession: 'desktop:archive-restore',
  deleteArchivedSession: 'desktop:archive-delete',
  setSessionPinned: 'desktop:session-pin',
  searchHistory: 'desktop:history-search',
  sendChatMessage: 'desktop:chat-send',
  stopChat: 'desktop:chat-stop',
  respondToExtensionUI: 'desktop:extension-response',
  renameChatSession: 'desktop:chat-rename',
  forkChatSession: 'desktop:chat-fork',
  cloneChatSession: 'desktop:chat-clone',
  getChatAvailableModels: 'desktop:chat-models',
  getChatModelCatalog: 'desktop:chat-model-catalog',
  getChatThinkingLevels: 'desktop:chat-thinking-levels',
  setChatModel: 'desktop:chat-model-set',
  setChatThinkingLevel: 'desktop:chat-thinking-set',
  getChatSessionStats: 'desktop:chat-session-stats',
  getChatAutoSettings: 'desktop:chat-auto-settings',
  setChatSteeringMode: 'desktop:chat-steering-mode-set',
  setChatFollowUpMode: 'desktop:chat-follow-up-mode-set',
  compactChatSession: 'desktop:chat-compact',
  setChatAutoCompaction: 'desktop:chat-auto-compaction-set',
  setChatAutoRetry: 'desktop:chat-auto-retry-set',
  openExternal: 'desktop:external',
  openProject: 'desktop:project',
  gitStatus: 'desktop:git-status',
  gitBranches: 'desktop:git-branches',
  switchGitBranch: 'desktop:git-branch-switch',
  createGitBranch: 'desktop:git-branch-create',
  deleteGitBranch: 'desktop:git-branch-delete',
  gitWorktrees: 'desktop:git-worktrees',
  createGitWorktree: 'desktop:git-worktree-create',
  deleteGitWorktree: 'desktop:git-worktree-delete',
  commitGitChanges: 'desktop:git-commit',
  pushGitChanges: 'desktop:git-push',
  fileDiff: 'desktop:file-diff',
  fileDiffContents: 'desktop:file-diff-contents',
  listSessionFiles: 'desktop:session-files',
  readSessionFile: 'desktop:session-file-read',
  createBrowserView: 'desktop:browser-create',
  setBrowserViewBounds: 'desktop:browser-bounds',
  navigateBrowser: 'desktop:browser-navigate',
  goBackBrowser: 'desktop:browser-back',
  goForwardBrowser: 'desktop:browser-forward',
  reloadBrowser: 'desktop:browser-reload',
  disposeBrowserView: 'desktop:browser-dispose',
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
  onBrowserViewState: 'desktop:browser-state',
} as const satisfies Record<Exclude<keyof DesktopAPI, RequestMethod>, string>;
