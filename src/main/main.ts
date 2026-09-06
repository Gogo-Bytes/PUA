import { extensionResponse } from '../shared/chat-validation.js';
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PreferencesStore, validatePreferences } from './preferences.js';
import { resolveRuntime, validateChatArguments } from './runtime.js';
import { Sessions } from './sessions.js';
import { getFileDiff, getGitStatus } from './git.js';
import type { DiffScope } from '../shared/git.js';
import { inspectProjectResources } from './project-resources.js';
import type { Bootstrap, CreateSessionOptions, Preferences } from '../shared/contracts.js';
import type { ChatDelivery, ExtensionUIResponse } from '../shared/chat.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const rendererURL = pathToFileURL(path.join(here, '../renderer/index.html')).href;
let window: BrowserWindow | undefined;
let sessions: Sessions;
let store: PreferencesStore;
let preferences: Preferences;
let quitting = false;

function requireWindow(): BrowserWindow {
  if (!window || window.isDestroyed()) throw new Error('窗口已关闭');
  return window;
}
function checkSender(event: IpcMainInvokeEvent | IpcMainEvent): void {
  if (event.sender !== requireWindow().webContents || event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== rendererURL) {
    throw new Error('Untrusted IPC sender');
  }
}
function bootstrap(): Bootstrap {
  const base = { preferences, home: os.homedir(), platform: process.platform };
  try { return { ...base, runtime: resolveRuntime(preferences) }; }
  catch (error) { return { ...base, runtime: null, runtimeError: (error as Error).message }; }
}
function text(value: unknown): string {
  if (typeof value !== 'string' || value.includes('\0')) throw new Error('无效字符串');
  return value;
}
function boundedText(value: unknown, max: number, label: string): string {
  const result = text(value); if (result.length > max) throw new Error(`${label}过长`); return result;
}
function handle(channel: string, callback: (...args: any[]) => unknown): void {
  ipcMain.handle(channel, (event, ...args) => { checkSender(event); return callback(...args); });
}
function listen(channel: string, callback: (...args: any[]) => void): void {
  ipcMain.on(channel, (event, ...args) => {
    try { checkSender(event); callback(...args); }
    catch (error) { console.error(`IPC ${channel}:`, (error as Error).message); }
  });
}

function registerIPC(): void {
  handle('desktop:bootstrap', () => bootstrap());
  handle('desktop:directory', async () => {
    const result = await dialog.showOpenDialog(requireWindow(), { properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  handle('desktop:file', async () => {
    const result = await dialog.showOpenDialog(requireWindow(), { properties: ['openFile'] });
    return result.canceled ? null : result.filePaths[0];
  });
  handle('desktop:attachments', async () => {
    const result = await dialog.showOpenDialog(requireWindow(), { properties: ['openFile', 'multiSelections'] });
    return result.canceled ? [] : result.filePaths;
  });
  handle('desktop:chat-attachments', async (id: unknown) => {
    const sessionId = text(id);
    if (sessions.get(sessionId).info.kind !== 'chat') throw new Error('附件只支持原生对话');
    const result = await dialog.showOpenDialog(requireWindow(), { properties: ['openFile', 'multiSelections'] });
    return result.canceled ? [] : sessions.registerAttachments(sessionId, result.filePaths);
  });
  handle('desktop:preferences', async (value: unknown) => {
    const next = validatePreferences(value);
    // Recent projects are desktop-owned metadata, not editable client preferences.
    next.recentProjects = preferences.recentProjects;
    await store.write(next);
    preferences = next;
    return bootstrap();
  });
  handle('desktop:project-resources', (cwd: unknown) => inspectProjectResources(text(cwd)));
  handle('desktop:create', async (raw: CreateSessionOptions) => {
    if (!raw || typeof raw !== 'object') throw new Error('无效会话参数');
    const options: CreateSessionOptions = { ...raw, cwd: text(raw.cwd) };
    if (options.kind === 'chat') validateChatArguments(preferences.args);
    const runtime = resolveRuntime(preferences);
    const session = await sessions.create(runtime, options);
    const next = { ...preferences, recentProjects: [session.cwd, ...preferences.recentProjects.filter(p => p !== session.cwd)].slice(0, 20) };
    try { await store.write(next); preferences = next; }
    catch (error) { await sessions.close(session.id); throw error; }
    return session;
  });
  handle('desktop:start', (id: unknown) => sessions.start(text(id)));
  handle('desktop:close', async (id: unknown) => {
    const session = sessions.get(text(id));
    if (session.info.kind === 'terminal' ? session.info.processStatus === 'running' : session.info.activity !== 'idle' && session.info.processStatus !== 'exited') {
      const { response } = await dialog.showMessageBox(requireWindow(), {
        type: 'question', buttons: ['保留会话', '关闭进程'], defaultId: 0, cancelId: 0,
        message: '关闭这个 Pi 会话？', detail: '正在进行的任务会被中断。已保存的历史仍由 Pi 管理，可继续最近会话或在兼容终端中恢复。',
      });
      if (response !== 1) return false;
    }
    await sessions.close(text(id));
    return true;
  });
  handle('desktop:chat-send', async (id: unknown, input: { text?: unknown; attachmentIds?: unknown; delivery?: unknown }) => {
    const value = input && typeof input === 'object' ? input : {};
    const message = boundedText(value.text ?? '', 8 * 1024 * 1024, '消息');
    const attachmentIds = Array.isArray(value.attachmentIds) && value.attachmentIds.length <= 20 ? value.attachmentIds.map(item => boundedText(item, 128, '附件 id')) : (() => { throw new Error('无效附件'); })();
    const delivery = value.delivery;
    if (delivery !== 'prompt' && delivery !== 'steer' && delivery !== 'followUp') throw new Error('无效发送方式');
    await sessions.sendChatMessage(text(id), message, attachmentIds, delivery as ChatDelivery);
  });
  handle('desktop:chat-stop', (id: unknown) => sessions.stopChat(text(id)));
  handle('desktop:extension-response', (id: unknown, response: ExtensionUIResponse) => {
    return sessions.respondToExtensionUI(text(id), extensionResponse(response));
  });
  handle('desktop:chat-attachment-remove', (id: unknown, attachmentId: unknown) => sessions.removeAttachment(text(id), boundedText(attachmentId, 128, '附件 id')));
  handle('desktop:chat-rename', (id: unknown, name: unknown) => sessions.renameChatSession(text(id), boundedText(name, 200, '会话名称')));
  listen('desktop:write', (id: unknown, data: unknown) => {
    if (typeof data !== 'string') return;
    sessions.write(text(id), data);
  });
  listen('desktop:resize', (id: unknown, cols: number, rows: number) => sessions.resize(text(id), cols, rows));
  listen('desktop:ack', (id: unknown, size: number) => { if (Number.isSafeInteger(size) && size > 0) sessions.acknowledge(text(id), size); });
  handle('desktop:external', async (value: unknown) => {
    const url = new URL(text(value));
    // This protects the web renderer; it does NOT constrain the Pi process or its tools.
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('仅支持打开 HTTP(S) 链接');
    await shell.openExternal(url.href);
  });
  handle('desktop:project', async (id: unknown) => {
    const result = await shell.openPath(sessions.get(text(id)).info.cwd);
    if (result) throw new Error(result);
  });
  handle('desktop:git-status', (id: unknown) => getGitStatus(sessions.get(text(id)).info.cwd));
  handle('desktop:file-diff', (id: unknown, filename: unknown, scope: DiffScope) => getFileDiff(sessions.get(text(id)).info.cwd, text(filename), scope));
  handle('desktop:clipboard-read', async () => ({
    text: await clipboard.readText(),
    image: (await Promise.all(['image/png', 'image/jpeg', 'image/tiff', 'image/webp'].map(type => clipboard.has(type)))).some(Boolean),
  }));
  handle('desktop:clipboard-write', (value: unknown) => clipboard.writeText(text(value)));
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 1320, height: 880, minWidth: 900, minHeight: 600,
    backgroundColor: '#101114', title: 'PUA — Pi Universal App',
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  sessions = new Sessions(event => {
    if (window && !window.isDestroyed()) window.webContents.send('desktop:event', event);
  });
  window.webContents.on('render-process-gone', () => {
    void sessions.closeAll().then(() => {
      dialog.showErrorBox('PUA 界面意外退出', '为避免无人接管的交互进程，所有 Pi 对话与终端已关闭。重新打开应用后可继续最近会话。');
    }).catch(error => dialog.showErrorBox('进程清理失败', `仍保留会话占用，请退出后检查 Pi 进程：${String(error)}`));
  });
  window.on('close', event => {
    if (!quitting && sessions.hasBusy()) {
      const result = dialog.showMessageBoxSync(requireWindow(), {
        type: 'question', buttons: ['继续使用', '退出'], defaultId: 0, cancelId: 0,
        message: '退出 PUA？', detail: '所有打开的 Pi 对话与终端进程将被关闭，正在进行的任务会中断。Pi 保存的会话历史不会删除。',
      });
      if (result !== 1) { event.preventDefault(); return; }
    }
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    void sessions.closeAll().then(() => { window?.destroy(); app.quit(); }).catch(error => { quitting = false; dialog.showErrorBox('关闭进程失败', String(error)); });
  });
  void window.loadURL(rendererURL);
}

// Electron delays ready until ESM evaluation completes; top-level await here deadlocks startup.
void app.whenReady().then(async () => {
store = new PreferencesStore(path.join(app.getPath('userData'), 'desktop-settings.json'));
try { preferences = await store.read(); }
catch (error) { dialog.showErrorBox('无法读取设置', (error as Error).message); app.exit(1); throw error; }
registerIPC();
Menu.setApplicationMenu(Menu.buildFromTemplate([
  ...(process.platform === 'darwin' ? [{ label: 'PUA', submenu: [{ role: 'about' as const }, { type: 'separator' as const }, { role: 'quit' as const }] }] : []),
  { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'togglefullscreen' }, { role: 'close' }] },
  { label: '帮助', submenu: [{ label: 'Pi 官方文档', click: () => { void shell.openExternal('https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent'); } }] },
]));
createWindow();
app.on('window-all-closed', () => app.quit());
}).catch(error => {
  dialog.showErrorBox('PUA 启动失败', String(error));
  app.exit(1);
});
