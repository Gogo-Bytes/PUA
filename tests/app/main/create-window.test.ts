import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindowConstructorOptions } from 'electron';
import { createWindow, createWindowHolder, windowEventEmitter } from '../../../src/app/main/create-window';
import { eventChannels } from '../../../src/shared/ipc/channels';
import { fakeCapabilities, fakeWindow } from './main-fakes';

describe('createWindow security and identity (Fake only)', () => {
  it('keeps exact settings, deny-new-window/navigation/permissions and does not load before composition', () => {
    const { fake, window } = fakeWindow(); const construct = vi.fn((_options: BrowserWindowConstructorOptions) => window);
    expect(createWindow(construct, '/fake/dist/main/preload.cjs')).toBe(window);
    expect(construct).toHaveBeenCalledExactlyOnceWith({ width: 1320, height: 880, minWidth: 900, minHeight: 600, backgroundColor: '#101114', title: 'PUA — Pi Universal App', webPreferences: { preload: '/fake/dist/main/preload.cjs', contextIsolation: true, nodeIntegration: false, sandbox: true } });
    expect(fake.webContents.setWindowOpenHandler.mock.calls[0][0]()).toEqual({ action: 'deny' });
    const event = { preventDefault: vi.fn() }; fake.webContents.emit('will-navigate', event); expect(event.preventDefault).toHaveBeenCalledOnce();
    const callback = vi.fn(); fake.webContents.session.setPermissionRequestHandler.mock.calls[0][0]({}, 'media', callback); expect(callback).toHaveBeenCalledExactlyOnceWith(false);
    expect(fake.loadURL).not.toHaveBeenCalled();
  });
  it('holder stores paired identities and refuses absent/destroyed contexts; emitter never switches window', () => {
    const old = fakeWindow(); const next = fakeWindow(); const holder = createWindowHolder(); const capabilities = fakeCapabilities();
    expect(() => holder.requireCurrent()).toThrow('窗口已关闭'); holder.set({ window: old.window, capabilities });
    const emit = windowEventEmitter(old.window); const event = { type: 'exit', id: 'id', exitCode: 0 } as const;
    holder.set({ window: next.window, capabilities }); emit(event);
    expect(old.fake.webContents.send).toHaveBeenCalledExactlyOnceWith(eventChannels.onSessionEvent, event); expect(next.fake.webContents.send).not.toHaveBeenCalled();
    old.fake.destroy(); holder.clearIfCurrent(old.window); emit(event); expect(old.fake.webContents.send).toHaveBeenCalledOnce(); expect(holder.requireCurrent().window).toBe(next.window);
    next.fake.destroy(); expect(() => holder.requireCurrent()).toThrow('窗口已关闭'); holder.clearIfCurrent(next.window); expect(() => holder.requireCurrent()).toThrow('窗口已关闭');
  });
});
