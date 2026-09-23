import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import type { BrowserWindow, Session, WebContentsView } from 'electron';
import { BrowserViews } from '../../../src/platform/electron/browser-views';

function fixture() {
  const webContents = Object.assign(new EventEmitter(), {
    setWindowOpenHandler: vi.fn(), loadURL: vi.fn().mockResolvedValue(undefined), canGoBack: vi.fn(() => false), canGoForward: vi.fn(() => false),
    getTitle: vi.fn(() => ''), getURL: vi.fn(() => ''), isLoading: vi.fn(() => false), isDestroyed: vi.fn(() => false), close: vi.fn(),
    goBack: vi.fn(), goForward: vi.fn(), reload: vi.fn(),
  });
  let bounds: unknown;
  const view = { webContents, setBounds: vi.fn(value => { bounds = value; }) };
  const browserSession = Object.assign(new EventEmitter(), { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(), clearStorageData: vi.fn().mockResolvedValue(undefined) });
  const window = Object.assign(new EventEmitter(), {
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() }, isDestroyed: vi.fn(() => false), getContentSize: vi.fn(() => [500, 400]),
    webContents: { send: vi.fn() },
  });
  const manager = new BrowserViews({ createId: () => 'view-1', createSession: () => browserSession as unknown as Session, createView: () => view as unknown as WebContentsView });
  return { manager, window: window as unknown as BrowserWindow, browserSession, webContents, view, getBounds: () => bounds };
}

it('isolates ownership, rejects remote HTTP and unsafe navigation, and clips native child bounds', async () => {
  const f = fixture(); const id = f.manager.create(f.window);
  expect(id).toBe('view-1');
  const permission = f.browserSession.setPermissionRequestHandler.mock.calls[0][0];
  let granted: boolean | undefined; permission({}, 'clipboard-read', (value: boolean) => { granted = value; });
  expect(granted).toBe(false);
  expect(f.browserSession.setPermissionCheckHandler).toHaveBeenCalledWith(expect.any(Function));
  expect(f.webContents.setWindowOpenHandler).toHaveBeenCalledWith(expect.any(Function));
  const event = { preventDefault: vi.fn() };
  f.webContents.emit('will-navigate', event, 'file:///private'); expect(event.preventDefault).toHaveBeenCalledOnce();
  await expect(f.manager.navigate(f.window, id, 'http://example.com')).rejects.toThrow('仅支持 HTTPS');
  await f.manager.navigate(f.window, id, 'http://localhost:3000/');
  f.manager.setBounds(f.window, id, { x: 450, y: 350, width: 100, height: 100 });
  expect(f.getBounds()).toEqual({ x: 450, y: 350, width: 50, height: 50 });
  const foreign = fixture(); expect(() => f.manager.reload(foreign.window, id)).toThrow('不属于当前窗口');
  await f.manager.dispose(f.window, id);
  expect(f.window.contentView.removeChildView).toHaveBeenCalledWith(f.view);
  expect(f.webContents.close).toHaveBeenCalledWith({ waitForBeforeUnload: false });
  expect(f.browserSession.clearStorageData).toHaveBeenCalledOnce();
});
