import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopAPI, TerminalEvent } from '../shared/contracts.js';

const api: DesktopAPI = {
  bootstrap: () => ipcRenderer.invoke('desktop:bootstrap'),
  chooseDirectory: () => ipcRenderer.invoke('desktop:directory'),
  chooseFile: () => ipcRenderer.invoke('desktop:file'),
  chooseAttachments: () => ipcRenderer.invoke('desktop:attachments'),
  savePreferences: value => ipcRenderer.invoke('desktop:preferences', value),
  createSession: options => ipcRenderer.invoke('desktop:create', options),
  startSession: id => ipcRenderer.invoke('desktop:start', id),
  closeSession: id => ipcRenderer.invoke('desktop:close', id),
  write: (id, data) => ipcRenderer.send('desktop:write', id, data),
  resize: (id, cols, rows) => ipcRenderer.send('desktop:resize', id, cols, rows),
  acknowledge: (id, size) => ipcRenderer.send('desktop:ack', id, size),
  onTerminalEvent: callback => {
    const listener = (_event: unknown, value: TerminalEvent) => callback(value);
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
