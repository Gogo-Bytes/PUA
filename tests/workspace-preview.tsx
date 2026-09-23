// TEST ONLY: browser visual review of real production React components with a mock IPC device.
// No Pi process, filesystem access, model request, simulated streaming or timers.
import { installDesktopFake } from './desktop-bridge-fake';
import { createRoot } from 'react-dom/client';
import { App } from '../src/renderer/app/App';
import type { DesktopAPI, Preferences, SessionInfo } from '../src/shared/ipc/desktop-api';
import type { SessionEvent } from '../src/shared/ipc/conversation';
import type { BrowserViewState } from '../src/shared/ipc/desktop-api';
import '../src/renderer/app/production.css';

const listeners = new Set<(event: SessionEvent) => void>();
const browserListeners = new Set<(state: BrowserViewState) => void>();
const sessions = new Map<string, SessionInfo>();
let preferences: Preferences = { piPath: 'TEST ONLY / no executable', nodePath: '', args: [], fontSize: 14, recentProjects: ['/test/workspace/PUA', '/test/other/PUA', '/test/empty'] };
let sequence = 0;
let previewBranch = 'test-only'; let previewGitClean = false;
let clipboard = ''; // Fake Desktop never reaches the system clipboard.
const launchOptions: unknown[] = [];
const emit = (event: SessionEvent) => listeners.forEach(listener => listener(event));
const emitBrowser = (state: BrowserViewState) => browserListeners.forEach(listener => listener(state));
Object.assign(window as Window & { __workspacePreviewSetGitClean?: (value: boolean) => void }, { __workspacePreviewSetGitClean: (value: boolean) => { previewGitClean = value; } });
const source = '# 测试文档\n\n这份内容来自测试 IPC，不是磁盘文件。\n\n## 阅读边界\n\n- 工具输出是执行快照。\n- Git patch 不是完整文件。\n- 引用只回填草稿。';
const unsupported = async (): Promise<never> => { throw new Error('TEST ONLY：浏览器预览不提供此 Electron 能力'); };
const bootstrap: DesktopAPI['bootstrap'] = async () => ({ preferences, runtime: { executable: 'TEST ONLY', args: [], source: 'MOCK / NOT ELECTRON' }, home: '/test', platform: 'darwin' });
installDesktopFake({
  bootstrap,
  savePreferences: async value => { preferences = value; return bootstrap(); },
  onSessionEvent: callback => { listeners.add(callback); return () => listeners.delete(callback); },
  onBrowserViewState: callback => { browserListeners.add(callback); return () => browserListeners.delete(callback); },
  createBrowserView: async () => 'preview-browser', setBrowserViewBounds: async () => {}, navigateBrowser: async (_id, url) => emitBrowser({ id: 'preview-browser', url, title: 'Fake isolated preview', canGoBack: false, canGoForward: false, loading: false }), goBackBrowser: async () => {}, goForwardBrowser: async () => {}, reloadBrowser: async () => {}, disposeBrowserView: async () => {},
  inspectProjectResources: async () => ({ hasResources: false, paths: [] }),
  createSession: async options => {
    if (options.kind === 'terminal') return unsupported();
    launchOptions.push({ ...options });
    Object.assign(window as Window & { __workspacePreviewLaunchOptions?: unknown[] }, { __workspacePreviewLaunchOptions: launchOptions });
    const session: SessionInfo = { id: `test-${++sequence}`, cwd: options.cwd, title: `检查上下文 ${sequence}`, kind: 'chat', processStatus: 'running', activity: 'idle' };
    sessions.set(session.id, session); return session;
  },
  startSession: async id => emit({ id, type: 'chat-snapshot', snapshot: {
    activity: 'idle', queue: { steering: [], followUp: [] }, statuses: {}, widgets: [], model: { provider: 'TEST ONLY', id: 'no-model' }, commands: [{ name: 'test-command', source: 'extension', description: '测试命令，仅插入草稿' }],
    messages: [
      { id: `${id}-user`, role: 'user', timestamp: 1, blocks: [{ type: 'text', text: '梳理文件预览的来源，让工具结果与检查区的关系更清楚。' }] },
      { id: `${id}-assistant`, role: 'assistant', timestamp: 2, blocks: [
        { type: 'text', text: '建议把来源紧随文件名，对话保留执行摘要。**同一路径可能对应不同时间的内容**，不要把工具快照当作当前文件。' },
        { type: 'tool', tool: { id: `${id}-read`, name: 'read', arguments: { path: 'docs/context.md' }, status: 'success', output: source } },
        { type: 'text', text: '### 保持阅读连续\n\n- 工具结果展开查看参数与返回。\n- 检查区区分工作区与暂存范围。\n- 引用只加入当前会话草稿。\n\n```ts\nconst source = "tool snapshot";\nconst currentFile = false;\n```\n\n这是浏览器测试数据，不是 Pi 的真实回复。' },
      ] },
    ],
  } }),
  closeSession: async id => { sessions.delete(id); return true; },
  searchHistory: async () => [],
  restoreArchivedSession: async id => sessions.get(id)!, deleteArchivedSession: async id => { sessions.delete(id); }, setSessionPinned: async (id, pinned) => { const session = sessions.get(id); if (session) session.pinned = pinned; },
  getChatAvailableModels: async () => [], getChatModelCatalog: async () => [{ provider: 'openai-codex', id: 'gpt-5.5', name: 'gpt-5.5', reasoning: true }], getChatThinkingLevels: async () => [], setChatModel: async () => {}, setChatThinkingLevel: async () => {}, getChatSessionStats: async () => ({ userMessages: 0, assistantMessages: 0, toolCalls: 0, toolResults: 0, totalMessages: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 }), getChatAutoSettings: async () => ({ autoCompaction: true, autoRetry: true, steeringMode: 'one-at-a-time' as const, followUpMode: 'one-at-a-time' as const }), compactChatSession: async () => {}, setChatAutoCompaction: async () => {}, setChatAutoRetry: async () => {}, setChatSteeringMode: async () => {}, setChatFollowUpMode: async () => {},
  renameChatSession: async (id, title) => { const session = sessions.get(id); if (session) session.title = title; },
  forkChatSession: async () => ({ text: 'TEST ONLY', cancelled: false }), cloneChatSession: async id => ({ id: `${id}-clone`, cwd: sessions.get(id)?.cwd || '/test', title: `${sessions.get(id)?.title || '任务'} · 副本`, kind: 'chat', processStatus: 'running', activity: 'idle' }),
  sendChatMessage: async (id, input) => emit({ id, type: 'chat-message-end', message: { id: `input-${++sequence}`, timestamp: Date.now(), role: 'user', blocks: [{ type: 'text', text: `[TEST ONLY · 未调用模型]\n${input.text}` }] } }),
  stopChat: async () => {},
  chooseChatAttachments: async id => [{ id: `${id}-attachment`, kind: 'file', name: 'test-context.txt', path: '/test/test-context.txt', size: 12 }],
  removeChatAttachment: async () => {},
  gitStatus: async id => ({ root: sessions.get(id)?.cwd || '/test', branch: previewBranch, capturedAt: new Date().toISOString(), files: previewGitClean ? [] : [{ path: 'src/source.ts', index: 'M', worktree: 'M' }, { path: 'docs/context.md', index: '?', worktree: '?' }] }),
  gitBranches: async () => ({ current: previewBranch, branches: ['main', 'test-only'] }), switchGitBranch: async id => { if (!previewGitClean) throw new Error('工作区存在未提交改动'); previewBranch = 'main'; return { root: sessions.get(id)?.cwd || '/test', branch: previewBranch, capturedAt: new Date().toISOString(), files: [] }; },
  fileDiff: async (_id, filename, scope) => filename.endsWith('.md') ? { kind: 'untracked', text: source, truncated: false } : { kind: 'diff', truncated: false, text: `diff --git a/src/source.ts b/src/source.ts\n--- a/src/source.ts\n+++ b/src/source.ts\n@@ -1,2 +1,3 @@\n-const source = "file";\n+const source = "${scope === 'index' ? 'staged snapshot' : 'tool snapshot'}";\n+const currentFile = false;\n export { source };` },
  listSessionFiles: async (_id, path) => ({ path, entries: path === ''
    ? [{ name: 'src', path: 'src', kind: 'directory' as const }, { name: 'docs', path: 'docs', kind: 'directory' as const }, { name: 'README.md', path: 'README.md', kind: 'file' as const }]
    : path === 'docs' ? [{ name: 'context.md', path: 'docs/context.md', kind: 'file' as const }]
      : [{ name: 'source.ts', path: 'src/source.ts', kind: 'file' as const }], truncated: false }),
  readSessionFile: async (_id, path) => ({ path, text: path === 'docs/context.md' ? source : 'export const source = "TEST ONLY";', truncated: false }),
  writeClipboard: async text => { clipboard = text; },
  readClipboard: async () => ({ text: clipboard, image: false }), openExternal: unsupported, openProject: unsupported, chooseDirectory: unsupported, chooseFile: unsupported, chooseAttachments: unsupported,
  respondToExtensionUI: unsupported, write: () => {}, resize: () => {}, acknowledge: () => {},
});
createRoot(document.getElementById('root')!).render(<App />);
