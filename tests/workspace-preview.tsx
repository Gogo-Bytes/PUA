// TEST ONLY: browser visual review of real production React components with a mock IPC device.
// No Pi process, filesystem access, model request, simulated streaming or timers.
import { createRoot } from 'react-dom/client';
import { App } from '../src/renderer/App';
import type { DesktopAPI, Preferences, SessionInfo } from '../src/shared/contracts';
import type { SessionEvent } from '../src/shared/chat';
import '../src/renderer/styles.css';
import '../src/renderer/review.css';

const listeners = new Set<(event: SessionEvent) => void>();
const sessions = new Map<string, SessionInfo>();
let preferences: Preferences = { piPath: 'TEST ONLY / no executable', nodePath: '', args: [], fontSize: 14, recentProjects: ['/test/workspace/PUA', '/test/other/PUA', '/test/empty'] };
let sequence = 0;
const emit = (event: SessionEvent) => listeners.forEach(listener => listener(event));
const source = '# 测试文档\n\n这份内容来自测试 IPC，不是磁盘文件。\n\n## 阅读边界\n\n- 工具输出是执行快照。\n- Git patch 不是完整文件。\n- 引用只回填草稿。';
const unsupported = async (): Promise<never> => { throw new Error('TEST ONLY：浏览器预览不提供此 Electron 能力'); };
const bootstrap: DesktopAPI['bootstrap'] = async () => ({ preferences, runtime: { executable: 'TEST ONLY', args: [], source: 'MOCK / NOT ELECTRON' }, home: '/test', platform: 'darwin' });
window.desktop = {
  bootstrap,
  savePreferences: async value => { preferences = value; return bootstrap(); },
  onSessionEvent: callback => { listeners.add(callback); return () => listeners.delete(callback); },
  inspectProjectResources: async () => ({ hasResources: false, paths: [] }),
  createSession: async options => {
    if (options.kind === 'terminal') return unsupported();
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
  renameChatSession: async (id, title) => { const session = sessions.get(id); if (session) session.title = title; },
  sendChatMessage: async (id, input) => emit({ id, type: 'chat-message-end', message: { id: `input-${++sequence}`, timestamp: Date.now(), role: 'user', blocks: [{ type: 'text', text: `[TEST ONLY · 未调用模型]\n${input.text}` }] } }),
  stopChat: async () => {},
  chooseChatAttachments: async id => [{ id: `${id}-attachment`, kind: 'file', name: 'test-context.txt', path: '/test/test-context.txt', size: 12 }],
  removeChatAttachment: async () => {},
  gitStatus: async id => ({ root: sessions.get(id)?.cwd || '/test', branch: 'test-only', capturedAt: new Date().toISOString(), files: [{ path: 'src/source.ts', index: 'M', worktree: 'M' }, { path: 'docs/context.md', index: '?', worktree: '?' }] }),
  fileDiff: async (_id, filename, scope) => filename.endsWith('.md') ? { kind: 'untracked', text: source, truncated: false } : { kind: 'diff', truncated: false, text: `diff --git a/src/source.ts b/src/source.ts\n--- a/src/source.ts\n+++ b/src/source.ts\n@@ -1,2 +1,3 @@\n-const source = "file";\n+const source = "${scope === 'index' ? 'staged snapshot' : 'tool snapshot'}";\n+const currentFile = false;\n export { source };` },
  writeClipboard: async text => navigator.clipboard.writeText(text),
  readClipboard: unsupported, openExternal: unsupported, openProject: unsupported, chooseDirectory: unsupported, chooseFile: unsupported, chooseAttachments: unsupported,
  respondToExtensionUI: unsupported, write: () => {}, resize: () => {}, acknowledge: () => {},
};
createRoot(document.getElementById('root')!).render(<App />);
