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
const mockSessions: SessionInfo[] = [
  {
    id: 'mock-working',
    cwd: '/test/workspace/PUA',
    title: '修复工作台交互',
    kind: 'chat',
    processStatus: 'running',
    activity: 'responding',
    pinned: true,
    lastActivityAt: 4,
  },
  {
    id: 'mock-review',
    cwd: '/test/workspace/PUA',
    title: '检查渲染结果',
    kind: 'chat',
    processStatus: 'running',
    activity: 'idle',
    lastActivityAt: 3,
  },
  {
    id: 'mock-done',
    cwd: '/test/other/PUA',
    title: '完成待检查的示例',
    kind: 'chat',
    processStatus: 'exited',
    activity: 'idle',
    exitCode: 0,
    lastActivityAt: 2,
  },
  {
    id: 'mock-error',
    cwd: '/test/other/PUA',
    title: '失败示例',
    kind: 'chat',
    processStatus: 'exited',
    activity: 'idle',
    exitCode: 1,
    lastActivityAt: 1,
  },
];
// Optional isolated scenario for the environment sidebar's background-process section.
if (new URLSearchParams(window.location.search).has('background')) {
  mockSessions.push({ id: 'mock-background-terminal', cwd: '/test/workspace/PUA', title: 'Mock 后台终端', kind: 'terminal', processStatus: 'running', activity: 'idle' });
}
mockSessions.forEach(session => sessions.set(session.id, session));
let preferences: Preferences = {
  piPath: 'TEST ONLY / no executable',
  nodePath: '',
  args: [],
  fontSize: 14,
  recentProjects: ['/test/workspace/PUA', '/test/other/PUA', '/test/empty'],
};
let sequence = 0;
let previewBranch = 'test-only';
let previewBranches = ['main', 'test-only'];
let previewGitClean = false;
let previewWorktrees = [{ path: '/test/workspace/PUA', head: 'test-head', branch: 'test-only', current: true }];
let clipboard = ''; // Fake Desktop never reaches the system clipboard.
const launchOptions: unknown[] = [];
const emit = (event: SessionEvent) => listeners.forEach(listener => listener(event));
const emitBrowser = (state: BrowserViewState) => browserListeners.forEach(listener => listener(state));
Object.assign(window as Window & { __workspacePreviewSetGitClean?: (value: boolean) => void }, {
  __workspacePreviewSetGitClean: (value: boolean) => {
    previewGitClean = value;
  },
});
const source =
  '# 测试文档\n\n这份内容来自测试 IPC，不是磁盘文件。\n\n## 阅读边界\n\n- 工具输出是执行快照。\n- Git patch 不是完整文件。\n- 引用只回填草稿。';
const unsupported = async (): Promise<never> => {
  throw new Error('TEST ONLY：浏览器预览不提供此 Electron 能力');
};
const bootstrap: DesktopAPI['bootstrap'] = async () => ({
  preferences,
  runtime: { executable: 'TEST ONLY', args: [], source: 'MOCK / NOT ELECTRON' },
  home: '/test',
  platform: 'darwin',
  restoredSessions: mockSessions,
  archivedSessions: [
    {
      id: 'mock-archived',
      cwd: '/test/empty',
      title: '已归档示例',
      kind: 'chat',
      processStatus: 'exited',
      activity: 'idle',
      archived: true,
      lastActivityAt: 0,
    },
  ],
});
installDesktopFake({
  bootstrap,
  savePreferences: async value => {
    preferences = value;
    return bootstrap();
  },
  onSessionEvent: callback => {
    listeners.add(callback);
    return () => listeners.delete(callback);
  },
  onBrowserViewState: callback => {
    browserListeners.add(callback);
    return () => browserListeners.delete(callback);
  },
  createBrowserView: async () => 'preview-browser',
  setBrowserViewBounds: async () => {},
  navigateBrowser: async (_id, url) =>
    emitBrowser({ id: 'preview-browser', url, title: 'Fake isolated preview', canGoBack: false, canGoForward: false, loading: false }),
  goBackBrowser: async () => {},
  goForwardBrowser: async () => {},
  reloadBrowser: async () => {},
  disposeBrowserView: async () => {},
  inspectProjectResources: async () => ({ hasResources: false, paths: [] }),
  createSession: async options => {
    if (options.kind === 'terminal') return unsupported();
    launchOptions.push({ ...options });
    Object.assign(window as Window & { __workspacePreviewLaunchOptions?: unknown[] }, { __workspacePreviewLaunchOptions: launchOptions });
    const session: SessionInfo = {
      id: `test-${++sequence}`,
      cwd: options.cwd,
      title: `检查上下文 ${sequence}`,
      kind: 'chat',
      processStatus: 'running',
      activity: 'idle',
    };
    sessions.set(session.id, session);
    return session;
  },
  startSession: async id =>
    emit({
      id,
      type: 'chat-snapshot',
      snapshot: {
        activity: 'idle',
        queue: { steering: [], followUp: [] },
        statuses: {},
        widgets: [],
        model: { provider: 'TEST ONLY', id: 'no-model' },
        commands: [
          { name: 'test-command', source: 'extension', description: '测试命令，仅插入草稿' },
          { name: 'plan', source: 'extension', description: 'Mock plan 命令' },
          { name: 'goal', source: 'extension', description: 'Mock goal 命令' },
        ],
        messages: [
          {
            id: `${id}-user`,
            role: 'user',
            timestamp: 1,
            blocks: [{ type: 'text', text: '梳理文件预览的来源，让工具结果与检查区的关系更清楚。' }],
          },
          {
            id: `${id}-assistant`,
            role: 'assistant',
            timestamp: 2,
            blocks: [
              {
                type: 'text',
                text: '建议把来源紧随文件名，对话保留执行摘要。**同一路径可能对应不同时间的内容**，不要把工具快照当作当前文件。',
              },
              {
                type: 'thinking',
                text: '先确认数据来源，再区分工作区快照、暂存区和当前磁盘内容。这个过程默认折叠，用户展开后才查看细节。',
              },
              {
                type: 'tool',
                tool: { id: `${id}-read`, name: 'read', arguments: { path: 'docs/context.md' }, status: 'success', output: source },
              },
              {
                type: 'text',
                text: '### 保持阅读连续\n\n- [x] 工具结果展开查看参数与返回。\n- [ ] 检查区区分工作区与暂存范围。\n- [x] 引用只加入当前会话草稿。\n\n| 来源 | 是否实时 |\n| --- | --- |\n| 工具快照 | 否 |\n| 工作区 | 是 |\n\n> 这是一个隔离的 mock 结果。\n\n```ts\nconst source = "tool snapshot";\nconst currentFile = false;\n```\n\n这是浏览器测试数据，不是 Pi 的真实回复。',
              },
            ],
          },
        ],
      },
    }),
  closeSession: async id => {
    sessions.delete(id);
    return true;
  },
  searchHistory: async ({ query, limit = 30 }) => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return [];
    return [...sessions.values()]
      .filter(session => session.title.toLocaleLowerCase().includes(normalized))
      .slice(0, limit)
      .map(session => ({
        taskId: session.id,
        title: session.title,
        cwd: session.cwd,
        entryId: `${session.id}-entry`,
        role: 'user' as const,
        snippet: `Mock 命中：${session.title}`,
        timestamp: session.lastActivityAt ?? 0,
        archived: !!session.archived,
        query,
      }));
  },
  restoreArchivedSession: async id => {
    const restored = {
      id,
      cwd: '/test/empty',
      title: '已归档示例',
      kind: 'chat' as const,
      processStatus: 'running' as const,
      activity: 'idle' as const,
      lastActivityAt: Date.now(),
    };
    sessions.set(id, restored);
    return restored;
  },
  deleteArchivedSession: async id => {
    sessions.delete(id);
  },
  setSessionPinned: async (id, pinned) => {
    const session = sessions.get(id);
    if (session) session.pinned = pinned;
  },
  getChatAvailableModels: async () => [],
  getChatModelCatalog: async () => [{ provider: 'openai-codex', id: 'gpt-5.5', name: 'gpt-5.5', reasoning: true }],
  getChatThinkingLevels: async () => [],
  setChatModel: async () => {},
  setChatThinkingLevel: async () => {},
  getChatSessionStats: async () => ({
    userMessages: 0,
    assistantMessages: 0,
    toolCalls: 0,
    toolResults: 0,
    totalMessages: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
  }),
  getChatAutoSettings: async () => ({
    autoCompaction: true,
    autoRetry: true,
    steeringMode: 'one-at-a-time' as const,
    followUpMode: 'one-at-a-time' as const,
  }),
  compactChatSession: async () => {},
  setChatAutoCompaction: async () => {},
  setChatAutoRetry: async () => {},
  setChatSteeringMode: async () => {},
  setChatFollowUpMode: async () => {},
  renameChatSession: async (id, title) => {
    const session = sessions.get(id);
    if (session) session.title = title;
  },
  forkChatSession: async () => ({ text: 'TEST ONLY', cancelled: false }),
  cloneChatSession: async id => ({
    id: `${id}-clone`,
    cwd: sessions.get(id)?.cwd || '/test',
    title: `${sessions.get(id)?.title || '任务'} · 副本`,
    kind: 'chat',
    processStatus: 'running',
    activity: 'idle',
  }),
  sendChatMessage: async (id, input) =>
    emit({
      id,
      type: 'chat-message-end',
      message: {
        id: `input-${++sequence}`,
        timestamp: Date.now(),
        role: 'user',
        blocks: [{ type: 'text', text: `[TEST ONLY · 未调用模型]\n${input.text}` }],
      },
    }),
  stopChat: async () => {},
  chooseChatAttachments: async id => [
    { id: `${id}-attachment`, kind: 'file', name: 'test-context.txt', path: '/test/test-context.txt', size: 12 },
  ],
  removeChatAttachment: async () => {},
  gitStatus: async id => ({
    root: sessions.get(id)?.cwd || '/test',
    branch: previewBranch,
    capturedAt: new Date().toISOString(),
    files: previewGitClean
      ? []
      : [
          { path: 'src/source.ts', index: 'M', worktree: 'M' },
          { path: 'docs/context.md', index: '?', worktree: '?' },
        ],
  }),
  gitBranchComparison: async id => ({
    root: sessions.get(id)?.cwd || '/test',
    current: previewBranch,
    baseline: 'origin/main',
    capturedAt: new Date().toISOString(),
    files: previewBranch === 'main' ? [] : [{ path: 'src/source.ts', index: 'M', worktree: ' ' }],
  }),
  gitBranchFileDiff: async () => ({
    kind: 'diff',
    truncated: false,
    text: 'diff --git a/src/source.ts b/src/source.ts\n--- a/src/source.ts\n+++ b/src/source.ts\n@@ -1 +1 @@\n-const source = "base";\n+const source = "branch";',
  }),
  gitBranches: async () => ({ current: previewBranch, branches: [...previewBranches] }),
  switchGitBranch: async id => {
    if (!previewGitClean) throw new Error('工作区存在未提交改动');
    previewBranch = 'main';
    return { root: sessions.get(id)?.cwd || '/test', branch: previewBranch, capturedAt: new Date().toISOString(), files: [] };
  },
  createGitBranch: async (id, branch) => {
    if (!previewGitClean) throw new Error('工作区存在未提交改动');
    if (previewBranches.includes(branch)) throw new Error('分支已存在');
    previewBranches = [...previewBranches, branch];
    previewBranch = branch;
    return { root: sessions.get(id)?.cwd || '/test', branch: previewBranch, capturedAt: new Date().toISOString(), files: [] };
  },
  deleteGitBranch: async (_id, branch) => {
    previewBranches = previewBranches.filter(item => item !== branch);
    return { current: previewBranch, branches: [...previewBranches] };
  },
  gitWorktrees: async () => ({
    current: previewWorktrees.find(item => item.current)?.path || '/test/workspace/PUA',
    worktrees: [...previewWorktrees],
  }),
  createGitWorktree: async (_id, branch) => {
    if (!previewGitClean) throw new Error('工作区存在未提交改动');
    const item = { path: `/test/workspace/PUA-${branch.replace(/[^A-Za-z0-9._-]+/g, '-')}`, head: 'new-head', branch, current: false };
    previewWorktrees = [...previewWorktrees, item];
    return { current: previewWorktrees[0].path, worktrees: [...previewWorktrees] };
  },
  deleteGitWorktree: async (_id, worktreePath) => {
    previewWorktrees = previewWorktrees.filter(item => item.path !== worktreePath);
    return { current: previewWorktrees[0].path, worktrees: [...previewWorktrees] };
  },
  commitGitChanges: async id => ({
    root: sessions.get(id)?.cwd || '/test',
    branch: previewBranch,
    capturedAt: new Date().toISOString(),
    files: [],
  }),
  pushGitChanges: async id => ({
    root: sessions.get(id)?.cwd || '/test',
    branch: previewBranch,
    capturedAt: new Date().toISOString(),
    files: [],
  }),
  fileDiff: async (_id, filename, scope) =>
    filename.endsWith('.md')
      ? { kind: 'untracked', text: source, truncated: false }
      : {
          kind: 'diff',
          truncated: false,
          text: `diff --git a/src/source.ts b/src/source.ts\n--- a/src/source.ts\n+++ b/src/source.ts\n@@ -1,2 +1,3 @@\n-const source = "file";\n+const source = "${scope === 'index' ? 'staged snapshot' : 'tool snapshot'}";\n+const currentFile = false;\n export { source };`,
        },
  fileDiffContents: async (_id, filename, scope) => ({
    oldFile: { name: filename, contents: 'const source = "old snapshot";\nexport { source };' },
    newFile: {
      name: filename,
      contents: `const source = "${scope === 'index' ? 'staged snapshot' : 'tool snapshot'}";\nconst currentFile = false;\nexport { source };`,
    },
  }),
  listSessionFiles: async (_id, path) => ({
    path,
    entries:
      path === ''
        ? [
            { name: 'src', path: 'src', kind: 'directory' as const },
            { name: 'docs', path: 'docs', kind: 'directory' as const },
            { name: 'README.md', path: 'README.md', kind: 'file' as const },
          ]
        : path === 'docs'
          ? [{ name: 'context.md', path: 'docs/context.md', kind: 'file' as const }]
          : [{ name: 'source.ts', path: 'src/source.ts', kind: 'file' as const }],
    truncated: false,
  }),
  readSessionFile: async (_id, path) => ({
    path,
    text: path === 'docs/context.md' ? source : 'export const source = "TEST ONLY";',
    truncated: false,
  }),
  writeClipboard: async text => {
    clipboard = text;
  },
  readClipboard: async () => ({ text: clipboard, image: false }),
  openExternal: unsupported,
  openProject: unsupported,
  chooseDirectory: unsupported,
  chooseFile: unsupported,
  chooseAttachments: unsupported,
  respondToExtensionUI: unsupported,
  write: () => {},
  resize: () => {},
  acknowledge: () => {},
});
createRoot(document.getElementById('root')!).render(<App />);
