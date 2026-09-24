import { describe, expect, it, vi } from 'vitest';
import { ReviewFailure } from '../../../src/modules/change-review/index';
import { invokeChannels, sendChannels, type RequestArgs, type RequestMethod } from '../../../src/shared/ipc/channels';
import { requestParsers } from '../../../src/shared/ipc/schemas';
import { deferred, failure, fakeCapabilities, fakeWindow, sessionInfo, snapshot } from './main-fakes';

const initial = { piPath: '', nodePath: '', args: [], fontSize: 14, recentProjects: ['/old'] };
const create = { cwd: '/fake/project', kind: 'chat', startMode: 'new', projectTrust: 'default' } as const;
const samples: { [K in RequestMethod]: RequestArgs<K> } = {
  bootstrap: [], chooseDirectory: [], chooseFile: [], chooseAttachments: [], readClipboard: [],
  chooseChatAttachments: ['id'], inspectProjectResources: ['../project'], startSession: ['id'], closeSession: ['id'], restoreArchivedSession: ['id'], deleteArchivedSession: ['id'], setSessionPinned: ['id', true], searchHistory: [{ query: 'message', limit: 10 }],
  stopChat: ['id'], openProject: ['id'], gitStatus: ['id'], gitBranches: ['id'], switchGitBranch: ['id', 'feature/test'], createGitBranch: ['id', 'feature/new'], deleteGitBranch: ['id', 'feature/old'], gitWorktrees: ['id'], createGitWorktree: ['id', 'feature/worktree'], deleteGitWorktree: ['id', '/repo-worktree'], writeClipboard: ['clipboard'], listSessionFiles: ['id', ''], readSessionFile: ['id', 'README.md'],
  createBrowserView: [], setBrowserViewBounds: ['browser-id', { x: 0, y: 0, width: 300, height: 400 }], navigateBrowser: ['browser-id', 'https://example.com/'], goBackBrowser: ['browser-id'], goForwardBrowser: ['browser-id'], reloadBrowser: ['browser-id'], disposeBrowserView: ['browser-id'],
  savePreferences: [initial], createSession: [create], removeChatAttachment: ['id', 'token'],
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
import { desktopIPCFake as harness } from '../../desktop-ipc-fake';
describe('real registerDesktopIPC with Fake Electron and closed business dependencies', () => {
  it('registers every declared invoke and send exactly once and calls every real handler', async () => {
    const h = harness(); expect([...h.invokes.keys()].sort()).toEqual(Object.values(invokeChannels).sort()); expect([...h.sends.keys()].sort()).toEqual(Object.values(sendChannels).sort());
    const results: Record<string, unknown> = {};
    for (const method of Object.keys(invokeChannels) as (keyof typeof invokeChannels)[]) results[method] = await h.call(method, ...samples[method]);
    for (const method of Object.keys(sendChannels) as (keyof typeof sendChannels)[]) h.sends.get(sendChannels[method])!(h.event, ...samples[method]);
    expect(results.bootstrap).toMatchObject({ home: '/fake/home', platform: 'fake', runtime: h.runtime });
    expect(results.chooseDirectory).toBe('/fake/file'); expect(results.chooseFile).toBe('/fake/file'); expect(results.chooseAttachments).toEqual(['/fake/file']);
    expect(h.dialog.showOpenDialog.mock.calls.map(call => call[1].properties)).toEqual([['openDirectory'], ['openFile'], ['openFile', 'multiSelections'], ['openFile', 'multiSelections']]);
    expect(h.dialog.showOpenDialog.mock.calls.every(call => call[0] === h.window)).toBe(true);
    expect(h.capabilities.registerChatAttachments).toHaveBeenCalledExactlyOnceWith('id', ['/fake/file']); expect(results.chooseChatAttachments).toEqual([]);
    expect(h.capabilities.createSession).toHaveBeenCalledExactlyOnceWith(h.runtime, create); expect(results.createSession).toEqual(expect.objectContaining({ ...sessionInfo, lastActivityAt: expect.any(Number) }));
    expect(h.capabilities.session.start).toHaveBeenCalledWith('id'); expect(h.capabilities.session.close).toHaveBeenCalledWith('id'); expect(results.closeSession).toBe(true);
    expect(h.capabilities.conversation.send).toHaveBeenCalledExactlyOnceWith('id', { text: 'message', attachmentIds: [], delivery: 'prompt' });
    expect(h.capabilities.conversation.stop).toHaveBeenCalledExactlyOnceWith('id'); expect(h.capabilities.conversation.respond).toHaveBeenCalledExactlyOnceWith('id', { id: 'request', confirmed: true });
    expect(h.capabilities.conversation.getAvailableModels).toHaveBeenCalledExactlyOnceWith('id');
    expect(h.capabilities.conversation.getAvailableThinkingLevels).toHaveBeenCalledExactlyOnceWith('id');
    expect(h.capabilities.conversation.getSessionStats).toHaveBeenCalledExactlyOnceWith('id');
    expect(h.capabilities.conversation.getAutoSettings).toHaveBeenCalledExactlyOnceWith('id');
    expect(h.capabilities.conversation.setModel).toHaveBeenCalledExactlyOnceWith('id', 'provider', 'model');
    expect(h.capabilities.conversation.setThinkingLevel).toHaveBeenCalledExactlyOnceWith('id', 'high');
    expect(h.capabilities.conversation.setAutoCompaction).toHaveBeenCalledExactlyOnceWith('id', true);
    expect(h.capabilities.conversation.setAutoRetry).toHaveBeenCalledExactlyOnceWith('id', false);
    expect(h.capabilities.conversation.setSteeringMode).toHaveBeenCalledExactlyOnceWith('id', 'one-at-a-time');
    expect(h.capabilities.conversation.setFollowUpMode).toHaveBeenCalledExactlyOnceWith('id', 'all');
    expect(h.capabilities.conversation.removeAttachment).toHaveBeenCalledExactlyOnceWith('id', 'token'); expect(h.capabilities.conversation.rename).toHaveBeenCalledExactlyOnceWith('id', 'title');
    expect(h.capabilities.terminal.write).toHaveBeenCalledExactlyOnceWith('id', '\0\x1b[31m\r\n'); expect(h.capabilities.terminal.resize).toHaveBeenCalledExactlyOnceWith('id', 100, 30); expect(h.capabilities.terminal.acknowledge).toHaveBeenCalledExactlyOnceWith('id', 1);
    expect(h.shell.openExternal).toHaveBeenCalledExactlyOnceWith('https://example.com/'); expect(h.shell.openPath).toHaveBeenCalledExactlyOnceWith('/fake/project');
    expect(h.getGitStatus).toHaveBeenCalledTimes(5); expect(h.getGitStatus).toHaveBeenCalledWith('/fake/project'); expect(results.gitStatus).toEqual({ root: '/repo', branch: 'main', capturedAt: 'now', files: [{ path: 'new\nname', originalPath: 'old', index: 'R', worktree: ' ' }] });
    expect(results.gitBranches).toEqual({ current: 'main', branches: ['main'] });
    expect(results.gitWorktrees).toEqual({ current: '/repo', worktrees: [{ path: '/repo', head: 'abc', branch: 'main', current: true }] });
    expect(results.createGitWorktree).toEqual({ current: '/repo', worktrees: [{ path: '/repo', head: 'abc', branch: 'main', current: true }] });
    expect(results.deleteGitWorktree).toEqual({ current: '/repo', worktrees: [{ path: '/repo', head: 'abc', branch: 'main', current: true }] });
    expect(results.switchGitBranch).toEqual({ root: '/repo', branch: 'main', capturedAt: 'now', files: [{ path: 'new\nname', originalPath: 'old', index: 'R', worktree: ' ' }] });
    expect(h.getGitBranches).toHaveBeenCalledTimes(2); expect(h.getGitBranches).toHaveBeenCalledWith('/fake/project'); expect(h.switchGitBranch).toHaveBeenCalledExactlyOnceWith('/fake/project', 'feature/test');
    expect(h.createGitBranch).toHaveBeenCalledExactlyOnceWith('/fake/project', 'feature/new'); expect(h.deleteGitBranch).toHaveBeenCalledExactlyOnceWith('/fake/project', 'feature/old');
    expect(h.getGitWorktrees).toHaveBeenCalledExactlyOnceWith('/fake/project'); expect(h.createGitWorktree).toHaveBeenCalledExactlyOnceWith('/fake/project', 'feature/worktree'); expect(h.deleteGitWorktree).toHaveBeenCalledExactlyOnceWith('/fake/project', '/repo-worktree');
    expect(h.getFileDiff).toHaveBeenCalledExactlyOnceWith({ cwd: '/fake/project', path: 'relative/file', scope: 'worktree' }); expect(results.fileDiff).toEqual({ text: 'patch', kind: 'diff', truncated: false });
    expect(h.listSessionFiles).toHaveBeenCalledExactlyOnceWith('/fake/project', ''); expect(results.listSessionFiles).toEqual({ path: '', entries: [], truncated: false });
    expect(h.readSessionFile).toHaveBeenCalledExactlyOnceWith('/fake/project', 'README.md'); expect(results.readSessionFile).toEqual({ path: 'README.md', text: 'hello', truncated: false });
    expect(results.createBrowserView).toBe('browser-id');
    expect(h.browserViews.create).toHaveBeenCalledExactlyOnceWith(h.window);
    expect(h.browserViews.setBounds).toHaveBeenCalledExactlyOnceWith(h.window, 'browser-id', { x: 0, y: 0, width: 300, height: 400 });
    expect(h.browserViews.navigate).toHaveBeenCalledExactlyOnceWith(h.window, 'browser-id', 'https://example.com/');
    expect(h.browserViews.back).toHaveBeenCalledExactlyOnceWith(h.window, 'browser-id'); expect(h.browserViews.forward).toHaveBeenCalledExactlyOnceWith(h.window, 'browser-id');
    expect(h.browserViews.reload).toHaveBeenCalledExactlyOnceWith(h.window, 'browser-id'); expect(h.browserViews.dispose).toHaveBeenCalledExactlyOnceWith(h.window, 'browser-id');
    expect(h.inspectProjectResources).toHaveBeenCalledExactlyOnceWith('../project'); expect(results.inspectProjectResources).toEqual({ hasResources: false, paths: [] });
    expect(results.readClipboard).toEqual({ text: 'clip', image: true }); expect(h.clipboard.has.mock.calls.flat()).toEqual(['image/png', 'image/jpeg', 'image/tiff', 'image/webp']); expect(h.clipboard.writeText).toHaveBeenCalledExactlyOnceWith('clipboard');
  });
  it('every untrusted invoke/send rejects before parser and all injected filesystem/runtime/dialog/Git/core effects', () => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = harness(); const parsers = Object.keys(requestParsers).map(method => vi.spyOn(requestParsers, method as RequestMethod));
    const foreign = { ...h.event, senderFrame: null };
    for (const method of Object.keys(invokeChannels) as (keyof typeof invokeChannels)[]) expect(h.invokes.get(invokeChannels[method])!(foreign, ...samples[method])).toMatchObject({ ok: false, error: { kind: 'authorization', code: 'UNTRUSTED_SENDER' } });
    for (const method of Object.keys(sendChannels) as (keyof typeof sendChannels)[]) h.sends.get(sendChannels[method])!(foreign, ...samples[method]);
    for (const parser of parsers) { expect(parser).not.toHaveBeenCalled(); parser.mockRestore(); }
    for (const spy of [h.store.write, h.resolveRuntime, h.validateChatArguments, h.dialog.showOpenDialog, h.dialog.showMessageBox, h.shell.openPath, h.shell.openExternal, ...Object.values(h.clipboard), h.getGitStatus, h.getGitBranches, h.switchGitBranch, h.createGitBranch, h.deleteGitBranch, h.getGitWorktrees, h.createGitWorktree, h.deleteGitWorktree, h.getFileDiff, h.inspectProjectResources, h.listSessionFiles, h.readSessionFile, ...Object.values(h.browserViews), ...Object.values(h.capabilities.session), ...Object.values(h.capabilities.conversation), ...Object.values(h.capabilities.terminal), h.capabilities.createSession, h.capabilities.registerChatAttachments]) expect(spy).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledTimes(3); report.mockRestore();
  });
  it('all trusted malformed tuples fail before effects; sends log/drop', () => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => {}); const h = harness();
    for (const [method, channel] of Object.entries(invokeChannels)) expect(h.invokes.get(channel)!(h.event, ...samples[method as keyof typeof invokeChannels], 'extra')).toMatchObject({ ok: false, error: { kind: 'validation' } });
    for (const [method, channel] of Object.entries(sendChannels)) h.sends.get(channel)!(h.event, ...samples[method as keyof typeof sendChannels], 'extra');
    expect(h.store.write).not.toHaveBeenCalled(); expect(h.capabilities.session.get).not.toHaveBeenCalled(); expect(h.resolveRuntime).not.toHaveBeenCalled(); expect(h.dialog.showOpenDialog).not.toHaveBeenCalled(); expect(h.clipboard.readText).not.toHaveBeenCalled(); expect(report).toHaveBeenCalledTimes(3); report.mockRestore();
  });
  it('keeps Git parsing/session lookup before use cases and maps only stable business failures', async () => {
    const h = harness();
    await expect(h.call('fileDiff', 'id', 'file', 'all')).rejects.toThrow('未知 diff 范围');
    expect(h.capabilities.session.get).not.toHaveBeenCalled(); expect(h.getFileDiff).not.toHaveBeenCalled();
    h.capabilities.session.get.mockReturnValueOnce(undefined);
    await expect(h.call('gitStatus', 'missing')).rejects.toThrow(); expect(h.getGitStatus).not.toHaveBeenCalled();
    h.getFileDiff.mockRejectedValueOnce(new ReviewFailure('STATUS_CHANGED'));
    await expect(h.call('fileDiff', 'id', 'file', 'worktree')).rejects.toThrow('文件状态已变化，请刷新变更列表。');
    const error = new Error('Git denied'); h.getGitStatus.mockRejectedValueOnce(error);
    await expect(h.call('gitStatus', 'id')).rejects.toThrow(error.message);
  });
  it('rejects branch switches while Pi is active before calling Git', async () => {
    const h = harness(); h.capabilities.activity.mockReturnValueOnce('responding');
    await expect(h.call('switchGitBranch', 'id', 'feature/test')).rejects.toThrow('Pi/Terminal 任务正在运行');
    expect(h.switchGitBranch).not.toHaveBeenCalled();
  });
  it('blocks Git mutations for a busy sibling session sharing the same project', async () => {
    const h = harness();
    h.capabilities.session.list.mockReturnValue([snapshot, { ...snapshot, id: 'sibling' }]);
    h.capabilities.activity.mockImplementation(id => id === 'sibling' ? 'responding' : 'idle');
    await expect(h.call('createGitBranch', 'id', 'feature/new')).rejects.toThrow('同一项目中有 Pi/Terminal 任务正在运行');
    expect(h.createGitBranch).not.toHaveBeenCalled();
  });
  it('prevents a new chat send while a branch mutation is in flight', async () => {
    const h = harness(); const mutation = deferred<void>(); h.createGitBranch.mockReturnValueOnce(mutation.promise);
    const creating = h.call('createGitBranch', 'id', 'feature/new'); await Promise.resolve();
    await expect(h.call('sendChatMessage', 'id', { text: 'message', attachmentIds: [], delivery: 'prompt' })).rejects.toThrow('正在操作 Git 分支');
    mutation.resolve(); await creating;
  });
  it('captures original context across attachment/close dialogs, with cancel and core false semantics', async () => {
    const h = harness(); const attachments = deferred<{ canceled: boolean; filePaths: string[] }>(); const confirmation = deferred<{ response: number }>();
    h.dialog.showOpenDialog.mockReturnValueOnce(attachments.promise); h.dialog.showMessageBox.mockReturnValueOnce(confirmation.promise); h.capabilities.activity.mockReturnValue('responding');
    const choose = h.call('chooseChatAttachments', 'id'); const close = h.call('closeSession', 'id'); const next = fakeWindow(); const nextCore = fakeCapabilities(); h.holder.set({ window: next.window, capabilities: nextCore });
    attachments.resolve({ canceled: false, filePaths: ['/old/file'] }); confirmation.resolve({ response: 1 }); await choose; expect(await close).toBe(true);
    expect(h.capabilities.registerChatAttachments).toHaveBeenCalledWith('id', ['/old/file']); expect(h.capabilities.session.close).toHaveBeenCalledOnce(); expect(nextCore.registerChatAttachments).not.toHaveBeenCalled(); expect(nextCore.session.close).not.toHaveBeenCalled();
    h.holder.set({ window: h.window, capabilities: h.capabilities }); h.dialog.showMessageBox.mockResolvedValueOnce({ response: 0 }); expect(await h.call('closeSession', 'id')).toBe(false); expect(h.capabilities.session.close).toHaveBeenCalledOnce();
    h.capabilities.session.close.mockResolvedValueOnce(failure); await expect(h.call('closeSession', 'id')).rejects.toThrow('仍保留会话占用');
  });
  it('registers staged project-draft attachments without reopening the native picker', async () => {
    const h = harness();
    await h.call('chooseChatAttachments', 'id', ['/draft/context.txt', '/draft/screenshot.png']);
    expect(h.dialog.showOpenDialog).not.toHaveBeenCalled();
    expect(h.capabilities.registerChatAttachments).toHaveBeenCalledExactlyOnceWith('id', ['/draft/context.txt', '/draft/screenshot.png']);
  });
  it('keeps a closed task visible when archive commit fails and retries metadata without closing twice', async () => {
    const h = harness();
    vi.spyOn(h.preferences, 'archiveSession').mockRejectedValueOnce(new Error('index denied')).mockResolvedValueOnce(undefined);
    h.capabilities.session.get.mockReturnValueOnce(snapshot).mockReturnValueOnce(undefined);
    await expect(h.call('closeSession', 'id')).rejects.toThrow('任务仍保留，可重试归档');
    expect(h.capabilities.session.close).toHaveBeenCalledTimes(1);
    await expect(h.call('closeSession', 'id')).resolves.toBe(true);
    expect(h.capabilities.session.close).toHaveBeenCalledTimes(1);
    expect(h.preferences.archiveSession).toHaveBeenCalledTimes(2);
  });
  it('revalidates durable Pi history before starting a dormant task', async () => {
    const h = harness();
    vi.spyOn(h.preferences, 'verifySessionForStart').mockRejectedValueOnce(new Error('history replaced'));
    await expect(h.call('startSession', 'id')).rejects.toThrow('history replaced');
    expect(h.capabilities.session.start).not.toHaveBeenCalled();
  });
  it('create and write-failure compensation retain the original core across holder replacement; client cannot edit recents', async () => {
    const h = harness();
    await h.call('savePreferences', { ...initial, recentProjects: ['/client-injected'], fontSize: 18 });
    expect(h.store.write).toHaveBeenLastCalledWith(expect.objectContaining({ recentProjects: ['/old'] }));
    const created = deferred<typeof sessionInfo>(); h.capabilities.createSession.mockReturnValueOnce(created.promise);
    h.store.write.mockRejectedValueOnce(new Error('write denied'));
    const pending = h.call('createSession', create); const rejected = expect(pending).rejects.toThrow('write denied');
    const next = fakeWindow(); const nextCore = fakeCapabilities(); h.holder.set({ window: next.window, capabilities: nextCore });
    created.resolve(sessionInfo); await rejected;
    expect(h.capabilities.session.close).toHaveBeenCalledExactlyOnceWith('id'); expect(nextCore.session.close).not.toHaveBeenCalled(); expect(nextCore.createSession).not.toHaveBeenCalled();
    expect(h.preferences.getBootstrap().preferences).toMatchObject({ fontSize: 18, recentProjects: ['/old'] });
  });
  it('retains dialog cancel results, terminal attachment rejection and shell/invoke failure propagation', async () => {
    const h = harness(); h.dialog.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    expect(await h.call('chooseDirectory')).toBeNull(); expect(await h.call('chooseFile')).toBeNull(); expect(await h.call('chooseAttachments')).toEqual([]); expect(await h.call('chooseChatAttachments', 'id')).toEqual([]); expect(h.capabilities.registerChatAttachments).not.toHaveBeenCalled();
    h.capabilities.session.get.mockReturnValue({ ...h.capabilities.session.get('id')!, kind: 'terminal' }); await expect(h.call('chooseChatAttachments', 'id')).rejects.toThrow('附件只支持原生对话');
    h.shell.openPath.mockResolvedValueOnce('OS failure'); await expect(h.call('openProject', 'id')).rejects.toThrow('OS failure');
    const error = new Error('core error'); h.capabilities.conversation.stop.mockRejectedValueOnce(error); await expect(h.call('stopChat', 'id')).rejects.toThrow(error.message);
  });
});
