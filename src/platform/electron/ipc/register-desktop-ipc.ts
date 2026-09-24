import type { clipboard as ElectronClipboard, dialog as ElectronDialog, ipcMain as ElectronIPC, shell as ElectronShell } from 'electron';
import path from 'node:path';
import { checkSender, createIPCRegistrar } from './registrar.js';
import type { WindowContext } from '../../../app/main/create-window.js';
import type { createDesktopPreferences } from '../../../app/main/desktop-preferences.js';
import { applySessionStartResult, isSessionBusy, requireSessionSnapshot, unwrapSessionResult } from '../../../app/main/session-mapper.js';
import { conversationError, extensionResponse, sendIntent } from '../../../app/main/conversation-mapper.js';
import type { ChangeReview } from '../../../modules/change-review/index.js';
import { repositorySnapshotDTO, reviewPreviewDTO, reviewScopeInput, reviewError, worktreesDTO } from './change-review-mapper.js';
import type { inspectProjectResources as InspectResources } from '../../filesystem/project-resources.js';
import type { listSessionFiles as BrowseSessionFiles, readSessionFile as PreviewSessionFile } from '../../filesystem/session-files.js';
import type { BrowserViews } from '../browser-views.js';

export interface DesktopIPCDependencies {
  ipcMain: Pick<typeof ElectronIPC, 'handle' | 'on'>;
  dialog: Pick<typeof ElectronDialog, 'showOpenDialog' | 'showMessageBox'>;
  shell: Pick<typeof ElectronShell, 'openExternal' | 'openPath'>;
  clipboard: Pick<typeof ElectronClipboard, 'readText' | 'has' | 'writeText'>;
  requireCurrent(): WindowContext;
  rendererURL: string;
  preferences: ReturnType<typeof createDesktopPreferences>;
  changeReview: ChangeReview;
  inspectProjectResources: typeof InspectResources;
  listSessionFiles: typeof BrowseSessionFiles;
  readSessionFile: typeof PreviewSessionFile;
  browserViews: BrowserViews;
}

/** Closed Desktop methods only; sender → tuple parser → captured window/core workflow. */
export function registerDesktopIPC({ ipcMain, dialog, shell, clipboard, requireCurrent, rendererURL, preferences, changeReview, inspectProjectResources, listSessionFiles, readSessionFile, browserViews }: DesktopIPCDependencies): void {
  const { handle, listen } = createIPCRegistrar(ipcMain, event => checkSender(event, requireCurrent().window.webContents, rendererURL));
  const gitMutationCwds = new Set<string>();
  const inFlightChatSends = new Map<string, number>();
  const mutationKeys = (cwd: string, affectedCwds: string[] = []) => [...new Set([cwd, ...affectedCwds].map(value => path.resolve(value)))];
  const assertGitMutationSafe = (capabilities: WindowContext['capabilities'], cwd: string, affectedCwds: string[] = []) => {
    const keys = mutationKeys(cwd, affectedCwds);
    if (keys.some(key => (inFlightChatSends.get(key) ?? 0) > 0)) throw new Error('当前项目正在提交对话消息，请稍后再操作 Git 工作树。');
    const busy = capabilities.session.list().find(session => keys.includes(path.resolve(session.cwd)) && (
      session.lifecycle.phase === 'starting' || isSessionBusy(session, capabilities.activity(session.id))
    ));
    if (busy) throw new Error('同一项目中有 Pi/Terminal 任务正在运行，已拒绝操作 Git 分支。');
    if (keys.some(key => gitMutationCwds.has(key))) throw new Error('当前项目正在操作 Git，请稍后重试。');
  };
  const mutateGit = async <T>(capabilities: WindowContext['capabilities'], cwd: string, action: () => Promise<T>, affectedCwds: string[] = []): Promise<T> => {
    const keys = mutationKeys(cwd, affectedCwds);
    assertGitMutationSafe(capabilities, cwd, affectedCwds);
    keys.forEach(key => gitMutationCwds.add(key));
    try { return await action(); }
    finally { keys.forEach(key => gitMutationCwds.delete(key)); }
  };
  handle('bootstrap', async () => { await preferences.whenReady(); return preferences.getBootstrap(); });
  handle('chooseDirectory', async () => {
    const result = await dialog.showOpenDialog(requireCurrent().window, { properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  handle('chooseFile', async () => {
    const result = await dialog.showOpenDialog(requireCurrent().window, { properties: ['openFile'] });
    return result.canceled ? null : result.filePaths[0];
  });
  handle('chooseAttachments', async () => {
    const result = await dialog.showOpenDialog(requireCurrent().window, { properties: ['openFile', 'multiSelections'] });
    return result.canceled ? [] : result.filePaths;
  });
  handle('chooseChatAttachments', async (sessionId, stagedPaths) => {
    const { window, capabilities } = requireCurrent();
    if (requireSessionSnapshot(capabilities.session.get(sessionId)).kind !== 'chat') throw new Error('附件只支持原生对话');
    const paths = stagedPaths ?? (await dialog.showOpenDialog(window, { properties: ['openFile', 'multiSelections'] })).filePaths;
    return paths.length ? capabilities.registerChatAttachments(sessionId, paths) : [];
  });
  handle('savePreferences', next => preferences.savePreferences(next));
  handle('inspectProjectResources', cwd => inspectProjectResources(cwd));
  handle('createSession', options => preferences.createSession(options, requireCurrent().capabilities));
  handle('startSession', async (id) => {
    const { capabilities } = requireCurrent();
    await preferences.verifySessionForStart(id);
    const session = requireSessionSnapshot(capabilities.session.get(id));
    if (gitMutationCwds.has(path.resolve(session.cwd))) throw new Error('当前项目正在操作 Git，请稍后启动会话。');
    return applySessionStartResult(capabilities.session.start(id));
  });
  handle('closeSession', async (id) => {
    const { window, capabilities } = requireCurrent();
    const session = capabilities.session.get(id);
    if (session && isSessionBusy(session, capabilities.activity(id))) {
      const { response } = await dialog.showMessageBox(window, {
        type: 'question', buttons: ['保留会话', '关闭进程'], defaultId: 0, cancelId: 0,
        message: '关闭这个 Pi 会话？', detail: '正在进行的任务会被中断。已保存的历史仍由 Pi 管理，可继续最近会话或在兼容终端中恢复。',
      });
      if (response !== 1) return false;
    }
    if (session) unwrapSessionResult(await capabilities.session.close(id));
    try { await preferences.archiveSession(id); }
    catch (error) { throw new Error(`Pi 进程已关闭，但归档失败；任务仍保留，可重试归档。${String(error)}`); }
    return true;
  });
  handle('restoreArchivedSession', id => preferences.restoreArchivedSession(id));
  handle('deleteArchivedSession', id => preferences.deleteArchivedSession(id));
  handle('setSessionPinned', (id, pinned) => preferences.setSessionPinned(id, pinned));
  handle('searchHistory', options => preferences.searchHistory(options));
  handle('sendChatMessage', async (id, input) => {
    const { capabilities } = requireCurrent();
    const cwd = path.resolve(requireSessionSnapshot(capabilities.session.get(id)).cwd);
    if (gitMutationCwds.has(cwd)) throw new Error('当前项目正在操作 Git 分支，请稍后发送消息。');
    inFlightChatSends.set(cwd, (inFlightChatSends.get(cwd) ?? 0) + 1);
    try { await capabilities.conversation.send(id, sendIntent(input.text, input.attachmentIds, input.delivery)); }
    catch (error) { throw conversationError(error); }
    finally {
      const pending = (inFlightChatSends.get(cwd) ?? 1) - 1;
      if (pending > 0) inFlightChatSends.set(cwd, pending); else inFlightChatSends.delete(cwd);
    }
  });
  handle('stopChat', id => requireCurrent().capabilities.conversation.stop(id));
  handle('respondToExtensionUI', (id, response) => requireCurrent().capabilities.conversation.respond(id, extensionResponse(response)));
  handle('removeChatAttachment', (id, attachmentId) => {
    try { requireCurrent().capabilities.conversation.removeAttachment(id, attachmentId); }
    catch (error) { conversationError(error); }
  });
  handle('renameChatSession', async (id, name) => {
    await requireCurrent().capabilities.conversation.rename(id, name);
    try { await preferences.renameSession(id, name); } catch (error) { console.warn(`无法保存会话标题 ${id}: ${String(error)}`); }
  });
  handle('forkChatSession', (id, entryId) => requireCurrent().capabilities.conversation.fork(id, entryId));
  handle('cloneChatSession', id => preferences.cloneSession(id, requireCurrent().capabilities as unknown as Parameters<typeof preferences.cloneSession>[1]));
  handle('getChatAvailableModels', id => requireCurrent().capabilities.conversation.getAvailableModels(id));
  handle('getChatModelCatalog', () => preferences.getChatModelCatalog());
  handle('getChatThinkingLevels', id => requireCurrent().capabilities.conversation.getAvailableThinkingLevels(id));
  handle('setChatModel', (id, provider, modelId) => requireCurrent().capabilities.conversation.setModel(id, provider, modelId));
  handle('setChatThinkingLevel', (id, level) => requireCurrent().capabilities.conversation.setThinkingLevel(id, level));
  handle('getChatSessionStats', id => requireCurrent().capabilities.conversation.getSessionStats(id));
  handle('getChatAutoSettings', id => requireCurrent().capabilities.conversation.getAutoSettings(id));
  handle('setChatSteeringMode', (id, mode) => requireCurrent().capabilities.conversation.setSteeringMode(id, mode));
  handle('setChatFollowUpMode', (id, mode) => requireCurrent().capabilities.conversation.setFollowUpMode(id, mode));
  handle('compactChatSession', (id, customInstructions) => requireCurrent().capabilities.conversation.compact(id, customInstructions));
  handle('setChatAutoCompaction', (id, enabled) => requireCurrent().capabilities.conversation.setAutoCompaction(id, enabled));
  handle('setChatAutoRetry', (id, enabled) => requireCurrent().capabilities.conversation.setAutoRetry(id, enabled));
  listen('write', (id, data) => requireCurrent().capabilities.terminal.write(id, data));
  listen('resize', (id, cols, rows) => requireCurrent().capabilities.terminal.resize(id, cols, rows));
  listen('acknowledge', (id, size) => requireCurrent().capabilities.terminal.acknowledge(id, size));
  handle('openExternal', url => shell.openExternal(url));
  handle('openProject', async (id) => {
    const result = await shell.openPath(requireSessionSnapshot(requireCurrent().capabilities.session.get(id)).cwd);
    if (result) throw new Error(result);
  });
  handle('gitStatus', (id) => changeReview.snapshot(requireSessionSnapshot(requireCurrent().capabilities.session.get(id)).cwd).then(repositorySnapshotDTO).catch(reviewError));
  handle('gitBranches', async id => {
    const cwd = requireSessionSnapshot(requireCurrent().capabilities.session.get(id)).cwd;
    const [current, branches] = await Promise.all([
      changeReview.snapshot(cwd), changeReview.branches(cwd),
    ]);
    return { current: current.branch, branches };
  });
  handle('switchGitBranch', async (id, branch) => {
    const { capabilities } = requireCurrent();
    const session = requireSessionSnapshot(capabilities.session.get(id));
    const cwd = session.cwd;
    return mutateGit(capabilities, cwd, async () => {
      await changeReview.switchBranch(cwd, branch);
      return changeReview.snapshot(cwd).then(repositorySnapshotDTO).catch(reviewError);
    });
  });
  handle('createGitBranch', async (id, branch) => {
    const { capabilities } = requireCurrent();
    const session = requireSessionSnapshot(capabilities.session.get(id));
    const cwd = session.cwd;
    return mutateGit(capabilities, cwd, async () => {
      await changeReview.createBranch(cwd, branch);
      return changeReview.snapshot(cwd).then(repositorySnapshotDTO).catch(reviewError);
    });
  });
  handle('deleteGitBranch', async (id, branch) => {
    const { capabilities } = requireCurrent();
    const session = requireSessionSnapshot(capabilities.session.get(id));
    const cwd = session.cwd;
    return mutateGit(capabilities, cwd, async () => {
      await changeReview.deleteBranch(cwd, branch);
      const [snapshot, branches] = await Promise.all([changeReview.snapshot(cwd), changeReview.branches(cwd)]);
      return { current: snapshot.branch, branches };
    });
  });
  handle('gitWorktrees', id => {
    const cwd = requireSessionSnapshot(requireCurrent().capabilities.session.get(id)).cwd;
    return changeReview.worktrees(cwd).then(worktreesDTO);
  });
  handle('createGitWorktree', async (id, branch) => {
    const { capabilities } = requireCurrent();
    const cwd = requireSessionSnapshot(capabilities.session.get(id)).cwd;
    return mutateGit(capabilities, cwd, () => changeReview.createWorktree(cwd, branch).then(worktreesDTO));
  });
  handle('deleteGitWorktree', async (id, worktreePath) => {
    const { capabilities } = requireCurrent();
    const cwd = requireSessionSnapshot(capabilities.session.get(id)).cwd;
    return mutateGit(capabilities, cwd, () => changeReview.deleteWorktree(cwd, worktreePath).then(worktreesDTO), [worktreePath]);
  });
  handle('fileDiff', (id, filename, scope) => changeReview.preview({ cwd: requireSessionSnapshot(requireCurrent().capabilities.session.get(id)).cwd, path: filename, scope: reviewScopeInput(scope) }).then(reviewPreviewDTO).catch(reviewError));
  handle('listSessionFiles', (id, relativePath) => listSessionFiles(requireSessionSnapshot(requireCurrent().capabilities.session.get(id)).cwd, relativePath));
  handle('readSessionFile', (id, relativePath) => readSessionFile(requireSessionSnapshot(requireCurrent().capabilities.session.get(id)).cwd, relativePath));
  handle('createBrowserView', () => browserViews.create(requireCurrent().window));
  handle('setBrowserViewBounds', (id, bounds) => browserViews.setBounds(requireCurrent().window, id, bounds));
  handle('navigateBrowser', (id, url) => browserViews.navigate(requireCurrent().window, id, url));
  handle('goBackBrowser', id => browserViews.back(requireCurrent().window, id));
  handle('goForwardBrowser', id => browserViews.forward(requireCurrent().window, id));
  handle('reloadBrowser', id => browserViews.reload(requireCurrent().window, id));
  handle('disposeBrowserView', id => browserViews.dispose(requireCurrent().window, id));
  handle('readClipboard', async () => ({
    text: await clipboard.readText(),
    image: (await Promise.all(['image/png', 'image/jpeg', 'image/tiff', 'image/webp'].map(type => clipboard.has(type)))).some(Boolean),
  }));
  handle('writeClipboard', value => clipboard.writeText(value));
}
