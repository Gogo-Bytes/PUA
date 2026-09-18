import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } from 'electron';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { PreferencesApplication } from '../../modules/preferences/index.js';
import { JsonPreferencesStorage } from '../../platform/filesystem/preferences-storage.js';
import { resolveRuntime } from '../../platform/pi/runtime/discovery.js';
import { ChangeReviewApplication } from '../../modules/change-review/index.js';
import { GitReviewAdapter } from '../../platform/git/review-adapter.js';
import { inspectProjectResources } from '../../platform/filesystem/project-resources.js';
import { registerDesktopIPC } from '../../platform/electron/ipc/register-desktop-ipc.js';
import { composeMain } from './composition.js';
import { createDesktopPreferences, validateChatArguments } from './desktop-preferences.js';
import { createWindow, createWindowHolder, windowEventEmitter } from './create-window.js';
import { bindWindowLifecycle } from './lifecycle.js';
import { installMenu } from './menu.js';
import { JsonWorkspaceSessionStore } from './workspace-session-store.js';

const rendererURL = new URL('../../renderer/index.html', import.meta.url).href;
const preloadPath = fileURLToPath(new URL('../preload/preload.cjs', import.meta.url));

// Electron delays ready until ESM evaluation completes; top-level await here deadlocks startup.
void app.whenReady().then(async () => {
  const storage = new JsonPreferencesStorage(path.join(app.getPath('userData'), 'desktop-settings.json'));
  const sessionStore = new JsonWorkspaceSessionStore(path.join(app.getPath('userData'), 'workspace-sessions.json'));
  let initial;
  try { initial = await storage.read(); }
  catch (error) { dialog.showErrorBox('无法读取设置', (error as Error).message); app.exit(1); throw error; }
  let capabilities: ReturnType<typeof composeMain>;
  const preferences = createDesktopPreferences({ application: new PreferencesApplication(initial, storage), resolveRuntime, validateChatArguments, home: os.homedir(), platform: process.platform, sessionStore });
  const changeReview = new ChangeReviewApplication(new GitReviewAdapter());
  const holder = createWindowHolder();
  registerDesktopIPC({ ipcMain, dialog, shell, clipboard, requireCurrent: holder.requireCurrent, rendererURL, preferences, changeReview, inspectProjectResources });
  installMenu({ Menu, shell, platform: process.platform, diagnostics: process.env.PUA_MISSING_ASSISTANT_DIAGNOSTICS === 'next-chat' });
  const window = createWindow(options => new BrowserWindow(options), preloadPath);
  capabilities = composeMain(windowEventEmitter(window), {
    onSessionChanged: session => preferences.syncSession(session),
    onChatMessageAccepted: (id, identity) => preferences.recordChatMessage(id, identity),
    onChatIdentityChanged: (id, identity) => preferences.updateChatIdentity(id, identity),
  });
  void preferences.restoreSessions(capabilities).catch(error => console.warn(`无法读取工作区会话索引: ${String(error)}`));
  holder.set({ window, capabilities });
  window.on('closed', () => holder.clearIfCurrent(window));
  bindWindowLifecycle({ window, capabilities, dialog, app });
  void window.loadURL(rendererURL);
  app.on('window-all-closed', () => app.quit());
}).catch(error => {
  dialog.showErrorBox('PUA 启动失败', String(error));
  app.exit(1);
});
