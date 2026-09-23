import type { RequestArgs, RequestMethod } from '../src/shared/ipc/channels';
export const preferences = { piPath: '', nodePath: '', args: [], fontSize: 14, recentProjects: [] };
export const create = { cwd: '~/project', kind: 'chat', startMode: 'new', projectTrust: 'default' } as const;
export const samples: { [K in RequestMethod]: RequestArgs<K> } = {
  bootstrap: [], chooseDirectory: [], chooseFile: [], chooseAttachments: [], readClipboard: [],
  chooseChatAttachments: ['id'], inspectProjectResources: ['../project'], startSession: ['id'], closeSession: ['id'], restoreArchivedSession: ['id'], deleteArchivedSession: ['id'], setSessionPinned: ['id', true], searchHistory: [{ query: 'message', limit: 10 }],
  stopChat: ['id'], openProject: ['id'], gitStatus: ['id'], writeClipboard: ['clipboard'], listSessionFiles: ['id', ''], readSessionFile: ['id', 'README.md'],
  createBrowserView: [], setBrowserViewBounds: ['browser-id', { x: 0, y: 0, width: 300, height: 400 }], navigateBrowser: ['browser-id', 'https://example.com/'], goBackBrowser: ['browser-id'], goForwardBrowser: ['browser-id'], reloadBrowser: ['browser-id'], disposeBrowserView: ['browser-id'],
  savePreferences: [preferences], createSession: [create], removeChatAttachment: ['id', 'token'],
  renameChatSession: ['id', 'title'], respondToExtensionUI: ['id', { id: 'request', confirmed: true }],
  forkChatSession: ['id', 'entry'],
  cloneChatSession: ['id'],
  getChatAvailableModels: ['id'], getChatModelCatalog: [], getChatThinkingLevels: ['id'],
  getChatSessionStats: ['id'], getChatAutoSettings: ['id'],
  setChatModel: ['id', 'provider', 'model'], setChatThinkingLevel: ['id', 'high'],
  compactChatSession: ['id', undefined], setChatAutoCompaction: ['id', true], setChatAutoRetry: ['id', false], setChatSteeringMode: ['id', 'one-at-a-time'], setChatFollowUpMode: ['id', 'all'],
  sendChatMessage: ['id', { text: 'message', attachmentIds: [], delivery: 'prompt' }],
  write: ['id', '\0\x1b[31m\r\n'], resize: ['id', 100, 30], acknowledge: ['id', 1],
  openExternal: ['https://example.com/'], fileDiff: ['id', 'relative/file', 'worktree'],
};

import type { InvokeMethod, RequestResult } from '../src/shared/ipc/channels';
export const successes: { [K in InvokeMethod]: RequestResult<K> } = {
  bootstrap: { preferences, runtime: null, home: '/fake', platform: 'darwin' },
  savePreferences: { preferences, runtime: { executable: '/fake/pi', args: [], source: 'fake' }, home: '/fake', platform: 'darwin' },
  chooseDirectory: null, chooseFile: '', chooseAttachments: [], chooseChatAttachments: [],
  inspectProjectResources: { hasResources: false, paths: [] },
  createSession: { id: 'id', cwd: '/fake/project', title: 'Fake', kind: 'chat', processStatus: 'starting', activity: 'idle' }, searchHistory: [],
  startSession: undefined, closeSession: false, restoreArchivedSession: { id: 'archived', cwd: '/fake/project', title: 'Archived', kind: 'chat', processStatus: 'exited', activity: 'idle', archived: true, pinned: false, lastActivityAt: 0 }, deleteArchivedSession: undefined, setSessionPinned: undefined, sendChatMessage: undefined, stopChat: undefined,
  removeChatAttachment: undefined, respondToExtensionUI: undefined, renameChatSession: undefined,
  forkChatSession: { text: 'forked', cancelled: false },
  cloneChatSession: { id: 'clone', cwd: '/fake/project', title: 'Clone', kind: 'chat', processStatus: 'starting', activity: 'idle' },
  getChatAvailableModels: [], getChatModelCatalog: [], getChatThinkingLevels: [], setChatModel: undefined, setChatThinkingLevel: undefined,
  getChatSessionStats: { userMessages: 0, assistantMessages: 0, toolCalls: 0, toolResults: 0, totalMessages: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 }, getChatAutoSettings: { autoCompaction: true, autoRetry: true },
  compactChatSession: undefined, setChatAutoCompaction: undefined, setChatAutoRetry: undefined, setChatSteeringMode: undefined, setChatFollowUpMode: undefined,
  openExternal: undefined, openProject: undefined, writeClipboard: undefined,
  gitStatus: { root: '/fake', branch: '', capturedAt: '', files: [] },
  fileDiff: { text: '', kind: 'diff', truncated: false }, readClipboard: { text: '', image: false },
  listSessionFiles: { path: '', entries: [], truncated: false }, readSessionFile: { path: 'README.md', text: 'hello', truncated: false },
  createBrowserView: 'browser-id', setBrowserViewBounds: undefined, navigateBrowser: undefined, goBackBrowser: undefined, goForwardBrowser: undefined, reloadBrowser: undefined, disposeBrowserView: undefined,
};
