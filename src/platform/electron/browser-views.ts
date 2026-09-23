import { randomUUID } from 'node:crypto';
import type { BrowserWindow, Session, WebContentsView } from 'electron';
import type { BrowserViewBounds, BrowserViewState } from '../../shared/ipc/desktop-api.js';
import { eventChannels } from '../../shared/ipc/channels.js';
import { normalizeBrowserURL } from '../../shared/ipc/browser.js';

interface BrowserEntry { id: string; window: BrowserWindow; session: Session; view: WebContentsView; bounds: BrowserViewBounds | null; requestedURL: string; error?: string }
interface BrowserViewFactory {
  createSession(id: string): Session;
  createView(session: Session): WebContentsView;
  createId?(): string;
}

/** Main-process owner for isolated remote pages; never shares the app renderer's preload/session. */
export class BrowserViews {
  private readonly entries = new Map<string, BrowserEntry>();
  private readonly windowListeners = new Map<BrowserWindow, () => void>();

  constructor(private readonly factory: BrowserViewFactory) {}

  create(window: BrowserWindow): string {
    const id = this.factory.createId?.() ?? randomUUID();
    const browserSession = this.factory.createSession(id);
    browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    browserSession.setPermissionCheckHandler(() => false);
    const view = this.factory.createView(browserSession);
    const entry: BrowserEntry = { id, window, session: browserSession, view, bounds: null, requestedURL: '' };
    this.entries.set(id, entry);
    window.contentView.addChildView(view);
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });

    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const allowNavigation = (event: Electron.Event, target: string) => {
      if (!normalizeBrowserURL(target)) event.preventDefault();
    };
    view.webContents.on('will-navigate', allowNavigation);
    view.webContents.on('will-redirect', allowNavigation);
    view.webContents.on('did-navigate', (_event, url) => { entry.requestedURL = url; entry.error = undefined; this.publish(entry); });
    view.webContents.on('did-navigate-in-page', (_event, url) => { entry.requestedURL = url; this.publish(entry); });
    view.webContents.on('did-start-loading', () => this.publish(entry));
    view.webContents.on('did-stop-loading', () => this.publish(entry));
    view.webContents.on('page-title-updated', () => this.publish(entry));
    view.webContents.on('did-fail-load', (_event, code) => { if (code !== -3) { entry.error = '网页加载失败'; this.publish(entry); } });
    const denyDownload = (_event: Electron.Event, item: Electron.DownloadItem) => item.cancel();
    browserSession.on('will-download', denyDownload);
    entry.view.webContents.once('destroyed', () => browserSession.removeListener('will-download', denyDownload));
    this.attachWindowCleanup(window);
    this.publish(entry);
    return id;
  }

  setBounds(window: BrowserWindow, id: string, bounds: BrowserViewBounds | null): void {
    const entry = this.get(window, id);
    entry.bounds = bounds;
    this.applyBounds(entry);
  }

  async navigate(window: BrowserWindow, id: string, address: string): Promise<void> {
    const entry = this.get(window, id);
    const url = normalizeBrowserURL(address);
    if (!url) throw new Error('仅支持 HTTPS 网页；本地开发地址可使用 localhost HTTP');
    entry.error = undefined;
    entry.requestedURL = url;
    this.applyBounds(entry);
    this.publish(entry);
    await entry.view.webContents.loadURL(url);
  }

  back(window: BrowserWindow, id: string): void { const entry = this.get(window, id); if (entry.view.webContents.canGoBack()) entry.view.webContents.goBack(); }
  forward(window: BrowserWindow, id: string): void { const entry = this.get(window, id); if (entry.view.webContents.canGoForward()) entry.view.webContents.goForward(); }
  reload(window: BrowserWindow, id: string): void { this.get(window, id).view.webContents.reload(); }

  async dispose(window: BrowserWindow, id: string): Promise<void> {
    const entry = this.get(window, id);
    this.entries.delete(id);
    try { window.contentView.removeChildView(entry.view); } catch { /* Parent may already be tearing down. */ }
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close({ waitForBeforeUnload: false });
    await entry.session.clearStorageData();
  }

  async disposeWindow(window: BrowserWindow): Promise<void> {
    for (const entry of [...this.entries.values()]) if (entry.window === window) {
      this.entries.delete(entry.id);
      if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close({ waitForBeforeUnload: false });
      await entry.session.clearStorageData().catch(() => {});
    }
    this.windowListeners.delete(window);
  }

  private get(window: BrowserWindow, id: string): BrowserEntry {
    const entry = this.entries.get(id);
    if (!entry || entry.window !== window) throw new Error('浏览器视图已关闭或不属于当前窗口');
    return entry;
  }

  private attachWindowCleanup(window: BrowserWindow): void {
    if (this.windowListeners.has(window)) return;
    const closed = () => { void this.disposeWindow(window); };
    this.windowListeners.set(window, closed);
    window.once('closed', closed);
  }

  private applyBounds(entry: BrowserEntry): void {
    const bounds = entry.bounds;
    if (!bounds || !entry.requestedURL || entry.window.isDestroyed()) {
      entry.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      return;
    }
    const [windowWidth, windowHeight] = entry.window.getContentSize();
    const x = Math.min(bounds.x, windowWidth);
    const y = Math.min(bounds.y, windowHeight);
    const width = Math.max(0, Math.min(bounds.width, windowWidth - x));
    const height = Math.max(0, Math.min(bounds.height, windowHeight - y));
    entry.view.setBounds({ x, y, width, height });
  }

  private publish(entry: BrowserEntry): void {
    if (entry.window.isDestroyed() || entry.view.webContents.isDestroyed()) return;
    const state: BrowserViewState = {
      id: entry.id,
      url: entry.requestedURL,
      title: entry.view.webContents.getTitle(),
      canGoBack: entry.view.webContents.canGoBack(),
      canGoForward: entry.view.webContents.canGoForward(),
      loading: entry.view.webContents.isLoading(),
      ...(entry.error ? { error: entry.error } : {}),
    };
    entry.window.webContents.send(eventChannels.onBrowserViewState, state);
  }
}
