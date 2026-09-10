import type { RequestArgs, RequestMethod } from '../src/shared/ipc/channels';
export const preferences = { piPath: '', nodePath: '', args: [], fontSize: 14, recentProjects: [] };
export const create = { cwd: '~/project', kind: 'chat', startMode: 'new', projectTrust: 'default' } as const;
export const samples: { [K in RequestMethod]: RequestArgs<K> } = {
  bootstrap: [], chooseDirectory: [], chooseFile: [], chooseAttachments: [], readClipboard: [],
  chooseChatAttachments: ['id'], inspectProjectResources: ['../project'], startSession: ['id'], closeSession: ['id'],
  stopChat: ['id'], openProject: ['id'], gitStatus: ['id'], writeClipboard: ['clipboard'],
  savePreferences: [preferences], createSession: [create], removeChatAttachment: ['id', 'token'],
  renameChatSession: ['id', 'title'], respondToExtensionUI: ['id', { id: 'request', confirmed: true }],
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
  createSession: { id: 'id', cwd: '/fake/project', title: 'Fake', kind: 'chat', processStatus: 'starting', activity: 'idle' },
  startSession: undefined, closeSession: false, sendChatMessage: undefined, stopChat: undefined,
  removeChatAttachment: undefined, respondToExtensionUI: undefined, renameChatSession: undefined,
  openExternal: undefined, openProject: undefined, writeClipboard: undefined,
  gitStatus: { root: '/fake', branch: '', capturedAt: '', files: [] },
  fileDiff: { text: '', kind: 'diff', truncated: false }, readClipboard: { text: '', image: false },
};
