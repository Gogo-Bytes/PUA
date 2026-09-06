import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopAPI } from '../shared/contracts.js';
import type { SessionEvent } from '../shared/chat.js';

const api: DesktopAPI = {
  bootstrap: () => ipcRenderer.invoke('desktop:bootstrap'),
  chooseDirectory: () => ipcRenderer.invoke('desktop:directory'),
  chooseFile: () => ipcRenderer.invoke('desktop:file'),
  chooseAttachments: () => ipcRenderer.invoke('desktop:attachments'),
  removeChatAttachment: (id, attachmentId) => ipcRenderer.invoke('desktop:chat-attachment-remove', id, attachmentId),
  chooseChatAttachments: id => ipcRenderer.invoke('desktop:chat-attachments', id),
  savePreferences: value => ipcRenderer.invoke('desktop:preferences', value),
  inspectProjectResources: cwd => ipcRenderer.invoke('desktop:project-resources', cwd),
  createSession: options => ipcRenderer.invoke('desktop:create', options),
  startSession: id => ipcRenderer.invoke('desktop:start', id),
  closeSession: id => ipcRenderer.invoke('desktop:close', id),
  sendChatMessage: (id, input) => ipcRenderer.invoke('desktop:chat-send', id, input),
  stopChat: id => ipcRenderer.invoke('desktop:chat-stop', id),
  respondToExtensionUI: (id, response) => ipcRenderer.invoke('desktop:extension-response', id, response),
  renameChatSession: (id, name) => ipcRenderer.invoke('desktop:chat-rename', id, name),
  write: (id, data) => ipcRenderer.send('desktop:write', id, data),
  resize: (id, cols, rows) => ipcRenderer.send('desktop:resize', id, cols, rows),
  acknowledge: (id, size) => ipcRenderer.send('desktop:ack', id, size),
  onSessionEvent: callback => {
    const listener = (_event: unknown, value: SessionEvent) => callback(value);
    ipcRenderer.on('desktop:event', listener);
    return () => { ipcRenderer.removeListener('desktop:event', listener); };
  },
  openExternal: url => ipcRenderer.invoke('desktop:external', url),
  openProject: id => ipcRenderer.invoke('desktop:project', id),
  gitStatus: id => ipcRenderer.invoke('desktop:git-status', id),
  fileDiff: (id, path, scope) => ipcRenderer.invoke('desktop:file-diff', id, path, scope),
  readClipboard: () => ipcRenderer.invoke('desktop:clipboard-read'),
  writeClipboard: text => ipcRenderer.invoke('desktop:clipboard-write', text),
};
contextBridge.exposeInMainWorld('desktop', api);
