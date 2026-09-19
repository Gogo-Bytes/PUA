import type { clipboard as ElectronClipboard, dialog as ElectronDialog, ipcMain as ElectronIPC, shell as ElectronShell } from 'electron';
import { checkSender, createIPCRegistrar } from './registrar.js';
import type { WindowContext } from '../../../app/main/create-window.js';
import type { createDesktopPreferences } from '../../../app/main/desktop-preferences.js';
import { applySessionStartResult, isSessionBusy, requireSessionSnapshot, unwrapSessionResult } from '../../../app/main/session-mapper.js';
import { conversationError, extensionResponse, sendIntent } from '../../../app/main/conversation-mapper.js';
import type { ChangeReview } from '../../../modules/change-review/index.js';
import { repositorySnapshotDTO, reviewPreviewDTO, reviewScopeInput, reviewError } from './change-review-mapper.js';
import type { inspectProjectResources as InspectResources } from '../../filesystem/project-resources.js';

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
}

/** Closed Desktop methods only; sender → tuple parser → captured window/core workflow. */
export function registerDesktopIPC({ ipcMain, dialog, shell, clipboard, requireCurrent, rendererURL, preferences, changeReview, inspectProjectResources }: DesktopIPCDependencies): void {
  const { handle, listen } = createIPCRegistrar(ipcMain, event => checkSender(event, requireCurrent().window.webContents, rendererURL));
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
  handle('chooseChatAttachments', async (sessionId) => {
    const { window, capabilities } = requireCurrent();
    if (requireSessionSnapshot(capabilities.session.get(sessionId)).kind !== 'chat') throw new Error('附件只支持原生对话');
    const result = await dialog.showOpenDialog(window, { properties: ['openFile', 'multiSelections'] });
    return result.canceled ? [] : capabilities.registerChatAttachments(sessionId, result.filePaths);
  });
  handle('savePreferences', next => preferences.savePreferences(next));
  handle('inspectProjectResources', cwd => inspectProjectResources(cwd));
  handle('createSession', options => preferences.createSession(options, requireCurrent().capabilities));
  handle('startSession', (id) => applySessionStartResult(requireCurrent().capabilities.session.start(id)));
  handle('closeSession', async (id) => {
    const { window, capabilities } = requireCurrent();
    const session = requireSessionSnapshot(capabilities.session.get(id));
    if (isSessionBusy(session, capabilities.activity(id))) {
      const { response } = await dialog.showMessageBox(window, {
        type: 'question', buttons: ['保留会话', '关闭进程'], defaultId: 0, cancelId: 0,
        message: '关闭这个 Pi 会话？', detail: '正在进行的任务会被中断。已保存的历史仍由 Pi 管理，可继续最近会话或在兼容终端中恢复。',
      });
      if (response !== 1) return false;
    }
    unwrapSessionResult(await capabilities.session.close(id));
    try { await preferences.archiveSession(id); } catch (error) { console.warn(`无法归档已关闭会话 ${id}: ${String(error)}`); }
    return true;
  });
  handle('archiveSession', async id => { await preferences.archiveSession(id); });
  handle('restoreArchivedSession', id => preferences.restoreArchivedSession(id));
  handle('deleteArchivedSession', id => preferences.deleteArchivedSession(id));
  handle('setSessionPinned', (id, pinned) => preferences.setSessionPinned(id, pinned));
  handle('searchHistory', options => preferences.searchHistory(options));
  handle('sendChatMessage', (id, input) => requireCurrent().capabilities.conversation.send(id, sendIntent(input.text, input.attachmentIds, input.delivery)).catch(conversationError));
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
  handle('fileDiff', (id, filename, scope) => changeReview.preview({ cwd: requireSessionSnapshot(requireCurrent().capabilities.session.get(id)).cwd, path: filename, scope: reviewScopeInput(scope) }).then(reviewPreviewDTO).catch(reviewError));
  handle('readClipboard', async () => ({
    text: await clipboard.readText(),
    image: (await Promise.all(['image/png', 'image/jpeg', 'image/tiff', 'image/webp'].map(type => clipboard.has(type)))).some(Boolean),
  }));
  handle('writeClipboard', value => clipboard.writeText(value));
}
