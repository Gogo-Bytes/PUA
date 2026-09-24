import { PreferencesApplication } from '../src/modules/preferences/index';
import { expect, vi } from 'vitest';
import type { ChangeReview } from '../src/modules/change-review/index';
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import { registerDesktopIPC, type DesktopIPCDependencies } from '../src/platform/electron/ipc/register-desktop-ipc';
import { createWindowHolder } from '../src/app/main/create-window';
import { createDesktopPreferences } from '../src/app/main/desktop-preferences';
import { invokeChannels, sendChannels } from '../src/shared/ipc/channels';
import { fakeCapabilities, fakeWindow, sessionInfo } from './app/main/main-fakes';

import { preloadFake } from './preload-fake';
import { createDesktopClient } from '../src/renderer/app/desktop-client';
const initial = { piPath: '', nodePath: '', args: [], fontSize: 14, recentProjects: ['/old'] };
export function desktopIPCFake() {
  const { fake, window } = fakeWindow(); const capabilities = fakeCapabilities(); const holder = createWindowHolder(); holder.set({ window, capabilities });
  const invokes = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>();
  const sends = new Map<string, (event: IpcMainEvent, ...args: unknown[]) => void>();
  const ipcMain: DesktopIPCDependencies['ipcMain'] = {
    handle: (channel, handler) => { expect(invokes.has(channel)).toBe(false); invokes.set(channel, handler); },
    on: vi.fn((channel, handler) => { expect(sends.has(channel)).toBe(false); sends.set(channel, handler); }) as unknown as DesktopIPCDependencies['ipcMain']['on'],
  };
  const store = { write: vi.fn().mockResolvedValue(undefined) }; const runtime = { executable: '/fake/pi', args: [], source: '/fake/pi' };
  const resolveRuntime = vi.fn(() => runtime); const validateChatArguments = vi.fn();
  const preferences = createDesktopPreferences({ application: new PreferencesApplication({ ...initial, recentProjects: [...initial.recentProjects] }, store), resolveRuntime, validateChatArguments, home: '/fake/home', platform: 'fake', listModels: async () => [] });
  preferences.restoreArchivedSession = vi.fn().mockResolvedValue({ ...sessionInfo, archived: true, pinned: false, lastActivityAt: 0 });
  const dialog = { showOpenDialog: vi.fn().mockResolvedValue({ canceled: false, filePaths: ['/fake/file'] }), showMessageBox: vi.fn().mockResolvedValue({ response: 1 }) };
  const shell = { openExternal: vi.fn().mockResolvedValue(undefined), openPath: vi.fn().mockResolvedValue('') };
  const clipboard = { readText: vi.fn(async () => 'clip'), has: vi.fn(async (type: string) => type === 'image/png'), writeText: vi.fn().mockResolvedValue(undefined) };
  const getGitStatus = vi.fn<ChangeReview['snapshot']>().mockResolvedValue({ root: '/repo', branch: 'main', capturedAt: 'now', files: [{ path: 'new\nname', originalPath: 'old', index: 'R', worktree: ' ' }] }); const getGitBranches = vi.fn<ChangeReview['branches']>().mockResolvedValue(['main']); const switchGitBranch = vi.fn<ChangeReview['switchBranch']>(); const createGitBranch = vi.fn<ChangeReview['createBranch']>(); const deleteGitBranch = vi.fn<ChangeReview['deleteBranch']>(); const getGitWorktrees = vi.fn<ChangeReview['worktrees']>().mockResolvedValue({ current: '/repo', worktrees: [{ path: '/repo', head: 'abc', branch: 'main', current: true }] }); const createGitWorktree = vi.fn<ChangeReview['createWorktree']>().mockResolvedValue({ current: '/repo', worktrees: [{ path: '/repo', head: 'abc', branch: 'main', current: true }] }); const deleteGitWorktree = vi.fn<ChangeReview['deleteWorktree']>().mockResolvedValue({ current: '/repo', worktrees: [{ path: '/repo', head: 'abc', branch: 'main', current: true }] }); const commitGitChanges = vi.fn<ChangeReview['commitChanges']>().mockResolvedValue({ root: '/repo', branch: 'main', capturedAt: 'now', files: [] }); const pushGitChanges = vi.fn<ChangeReview['pushChanges']>().mockResolvedValue({ root: '/repo', branch: 'main', capturedAt: 'now', files: [] }); const getFileDiff = vi.fn<ChangeReview['preview']>().mockResolvedValue({ text: 'patch', kind: 'diff', truncated: false }); const getFileDiffContents = vi.fn<ChangeReview['contents']>().mockResolvedValue({ oldFile: null, newFile: { name: 'file', contents: 'contents' } }); const inspectProjectResources = vi.fn().mockResolvedValue({ hasResources: false, paths: [] });
  const listSessionFiles = vi.fn().mockResolvedValue({ path: '', entries: [], truncated: false }); const readSessionFile = vi.fn().mockResolvedValue({ path: 'README.md', text: 'hello', truncated: false });
  const browserViews = { create: vi.fn(() => 'browser-id'), setBounds: vi.fn(), navigate: vi.fn().mockResolvedValue(undefined), back: vi.fn(), forward: vi.fn(), reload: vi.fn(), dispose: vi.fn().mockResolvedValue(undefined) };
  registerDesktopIPC({ ipcMain, dialog, shell, clipboard, requireCurrent: holder.requireCurrent, rendererURL: fake.webContents.mainFrame.url, preferences, changeReview: { snapshot: getGitStatus, preview: getFileDiff, contents: getFileDiffContents, branches: getGitBranches, switchBranch: switchGitBranch, createBranch: createGitBranch, deleteBranch: deleteGitBranch, worktrees: getGitWorktrees, createWorktree: createGitWorktree, deleteWorktree: deleteGitWorktree, commitChanges: commitGitChanges, pushChanges: pushGitChanges }, inspectProjectResources, listSessionFiles, readSessionFile, browserViews: browserViews as never });
  const event = { sender: fake.webContents, senderFrame: fake.webContents.mainFrame } as unknown as IpcMainInvokeEvent & IpcMainEvent;
  const rawCall = (method: keyof typeof invokeChannels, ...args: unknown[]) => invokes.get(invokeChannels[method])!(event, ...args);
  const listeners = new Set<(event: unknown, value: unknown) => void>();
  const bridge = preloadFake({
    invoke: (channel, ...args) => Promise.resolve(invokes.get(channel)!(event, ...args)),
    send: (channel, ...args) => sends.get(channel)!(event, ...args),
    on: (_channel, listener) => { listeners.add(listener); },
    removeListener: (_channel, listener) => { listeners.delete(listener); },
  });
  const client = createDesktopClient(() => bridge);
  const call = (method: keyof typeof invokeChannels, ...args: unknown[]) => (client[method] as (...args: unknown[]) => Promise<unknown>)(...args);
  const emit = (value: unknown) => { for (const listener of listeners) listener({ secretElectronEvent: true }, value); };
  return { fake, window, holder, capabilities, invokes, sends, store, runtime, preferences, resolveRuntime, validateChatArguments, dialog, shell, clipboard, getGitStatus, getGitBranches, switchGitBranch, createGitBranch, deleteGitBranch, getGitWorktrees, createGitWorktree, deleteGitWorktree, commitGitChanges, pushGitChanges, getFileDiff, getFileDiffContents, inspectProjectResources, listSessionFiles, readSessionFile, browserViews, event, call, rawCall, bridge, client, listeners, emit };
}
