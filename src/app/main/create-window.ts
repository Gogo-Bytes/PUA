import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';
import { eventChannels } from '../../shared/ipc/channels.js';
import type { SessionEvent } from '../../shared/ipc/conversation.js';
import type { composeMain } from './composition.js';

export interface WindowContext {
  window: BrowserWindow;
  /** Renderer/lifecycle capabilities; restoreChatSession is bootstrap-only and never crosses this holder. */
  capabilities: Omit<ReturnType<typeof composeMain>, 'restoreChatSession' | 'chatIdentity' | 'waitForChatIdentity'> & Partial<Pick<ReturnType<typeof composeMain>, 'chatIdentity' | 'waitForChatIdentity'>>;
}

/** IPC reads one paired identity; bound lifecycle/events never read this holder. */
export function createWindowHolder() {
  let current: WindowContext | undefined;
  return {
    requireCurrent(): WindowContext {
      if (!current || current.window.isDestroyed()) throw new Error('窗口已关闭');
      return current;
    },
    set(context: WindowContext): void { current = context; },
    clearIfCurrent(window: BrowserWindow): void { if (current?.window === window) current = undefined; },
  };
}

export function createWindow(construct: (options: BrowserWindowConstructorOptions) => BrowserWindow, preloadPath: string): BrowserWindow {
  const window = construct({
    width: 1320, height: 880, minWidth: 900, minHeight: 600,
    backgroundColor: '#101114', title: 'PUA — Pi Universal App',
    webPreferences: { preload: preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  return window;
}

export function windowEventEmitter(window: BrowserWindow): (event: SessionEvent) => void {
  return event => {
    if (!window.isDestroyed()) window.webContents.send(eventChannels.onSessionEvent, event);
  };
}
