import { invokeChannels, sendChannels, eventChannels } from '../../shared/ipc/channels.js';
import { contextBridge, ipcRenderer } from 'electron';
import type { BrowserViewState, DesktopBridge } from '../../shared/ipc/desktop-api.js';

const api: DesktopBridge = {
  bootstrap: () => ipcRenderer.invoke(invokeChannels.bootstrap),
  chooseDirectory: () => ipcRenderer.invoke(invokeChannels.chooseDirectory),
  chooseFile: () => ipcRenderer.invoke(invokeChannels.chooseFile),
  chooseAttachments: () => ipcRenderer.invoke(invokeChannels.chooseAttachments),
  removeChatAttachment: (id, attachmentId) => ipcRenderer.invoke(invokeChannels.removeChatAttachment, id, attachmentId),
  chooseChatAttachments: (id, paths) => paths ? ipcRenderer.invoke(invokeChannels.chooseChatAttachments, id, paths) : ipcRenderer.invoke(invokeChannels.chooseChatAttachments, id),
  savePreferences: value => ipcRenderer.invoke(invokeChannels.savePreferences, value),
  inspectProjectResources: cwd => ipcRenderer.invoke(invokeChannels.inspectProjectResources, cwd),
  createSession: options => ipcRenderer.invoke(invokeChannels.createSession, options),
  startSession: id => ipcRenderer.invoke(invokeChannels.startSession, id),
  closeSession: id => ipcRenderer.invoke(invokeChannels.closeSession, id),
  restoreArchivedSession: id => ipcRenderer.invoke(invokeChannels.restoreArchivedSession, id),
  deleteArchivedSession: id => ipcRenderer.invoke(invokeChannels.deleteArchivedSession, id),
  setSessionPinned: (id, pinned) => ipcRenderer.invoke(invokeChannels.setSessionPinned, id, pinned),
  searchHistory: options => ipcRenderer.invoke(invokeChannels.searchHistory, options),
  sendChatMessage: (id, input) => ipcRenderer.invoke(invokeChannels.sendChatMessage, id, input),
  stopChat: id => ipcRenderer.invoke(invokeChannels.stopChat, id),
  respondToExtensionUI: (id, response) => ipcRenderer.invoke(invokeChannels.respondToExtensionUI, id, response),
  renameChatSession: (id, name) => ipcRenderer.invoke(invokeChannels.renameChatSession, id, name),
  forkChatSession: (id, entryId) => ipcRenderer.invoke(invokeChannels.forkChatSession, id, entryId),
  cloneChatSession: id => ipcRenderer.invoke(invokeChannels.cloneChatSession, id),
  getChatAvailableModels: id => ipcRenderer.invoke(invokeChannels.getChatAvailableModels, id),
  getChatModelCatalog: () => ipcRenderer.invoke(invokeChannels.getChatModelCatalog),
  getChatThinkingLevels: id => ipcRenderer.invoke(invokeChannels.getChatThinkingLevels, id),
  setChatModel: (id, provider, modelId) => ipcRenderer.invoke(invokeChannels.setChatModel, id, provider, modelId),
  setChatThinkingLevel: (id, level) => ipcRenderer.invoke(invokeChannels.setChatThinkingLevel, id, level),
  getChatSessionStats: id => ipcRenderer.invoke(invokeChannels.getChatSessionStats, id),
  getChatAutoSettings: id => ipcRenderer.invoke(invokeChannels.getChatAutoSettings, id),
  setChatSteeringMode: (id, mode) => ipcRenderer.invoke(invokeChannels.setChatSteeringMode, id, mode),
  setChatFollowUpMode: (id, mode) => ipcRenderer.invoke(invokeChannels.setChatFollowUpMode, id, mode),
  compactChatSession: (id, customInstructions) => ipcRenderer.invoke(invokeChannels.compactChatSession, id, customInstructions),
  setChatAutoCompaction: (id, enabled) => ipcRenderer.invoke(invokeChannels.setChatAutoCompaction, id, enabled),
  setChatAutoRetry: (id, enabled) => ipcRenderer.invoke(invokeChannels.setChatAutoRetry, id, enabled),
  write: (id, data) => ipcRenderer.send(sendChannels.write, id, data),
  resize: (id, cols, rows) => ipcRenderer.send(sendChannels.resize, id, cols, rows),
  acknowledge: (id, size) => ipcRenderer.send(sendChannels.acknowledge, id, size),
  onSessionEvent: callback => {
    const listener = (_event: unknown, value: unknown) => callback(value);
    ipcRenderer.on(eventChannels.onSessionEvent, listener);
    return () => { ipcRenderer.removeListener(eventChannels.onSessionEvent, listener); };
  },
  onBrowserViewState: callback => {
    const listener = (_event: unknown, value: unknown) => callback(value as BrowserViewState);
    ipcRenderer.on(eventChannels.onBrowserViewState, listener);
    return () => { ipcRenderer.removeListener(eventChannels.onBrowserViewState, listener); };
  },
  openExternal: url => ipcRenderer.invoke(invokeChannels.openExternal, url),
  openProject: id => ipcRenderer.invoke(invokeChannels.openProject, id),
  gitStatus: id => ipcRenderer.invoke(invokeChannels.gitStatus, id),
  gitBranches: id => ipcRenderer.invoke(invokeChannels.gitBranches, id),
  switchGitBranch: (id, branch) => ipcRenderer.invoke(invokeChannels.switchGitBranch, id, branch),
  createGitBranch: (id, branch) => ipcRenderer.invoke(invokeChannels.createGitBranch, id, branch),
  deleteGitBranch: (id, branch) => ipcRenderer.invoke(invokeChannels.deleteGitBranch, id, branch),
  gitWorktrees: id => ipcRenderer.invoke(invokeChannels.gitWorktrees, id),
  createGitWorktree: (id, branch) => ipcRenderer.invoke(invokeChannels.createGitWorktree, id, branch),
  deleteGitWorktree: (id, path) => ipcRenderer.invoke(invokeChannels.deleteGitWorktree, id, path),
  commitGitChanges: (id, message) => ipcRenderer.invoke(invokeChannels.commitGitChanges, id, message),
  pushGitChanges: id => ipcRenderer.invoke(invokeChannels.pushGitChanges, id),
  fileDiff: (id, path, scope) => ipcRenderer.invoke(invokeChannels.fileDiff, id, path, scope),
  fileDiffContents: (id, path, scope) => ipcRenderer.invoke(invokeChannels.fileDiffContents, id, path, scope),
  listSessionFiles: (id, path) => ipcRenderer.invoke(invokeChannels.listSessionFiles, id, path),
  readSessionFile: (id, path) => ipcRenderer.invoke(invokeChannels.readSessionFile, id, path),
  createBrowserView: () => ipcRenderer.invoke(invokeChannels.createBrowserView),
  setBrowserViewBounds: (id, bounds) => ipcRenderer.invoke(invokeChannels.setBrowserViewBounds, id, bounds),
  navigateBrowser: (id, url) => ipcRenderer.invoke(invokeChannels.navigateBrowser, id, url),
  goBackBrowser: id => ipcRenderer.invoke(invokeChannels.goBackBrowser, id),
  goForwardBrowser: id => ipcRenderer.invoke(invokeChannels.goForwardBrowser, id),
  reloadBrowser: id => ipcRenderer.invoke(invokeChannels.reloadBrowser, id),
  disposeBrowserView: id => ipcRenderer.invoke(invokeChannels.disposeBrowserView, id),
  readClipboard: () => ipcRenderer.invoke(invokeChannels.readClipboard),
  writeClipboard: text => ipcRenderer.invoke(invokeChannels.writeClipboard, text),
};
contextBridge.exposeInMainWorld('desktop', api);
