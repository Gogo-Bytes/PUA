import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred, fakeCapabilities, fakeWindow, settle } from './main-fakes';

const fake = vi.hoisted(() => ({
  ready: vi.fn(), getPath: vi.fn(), exit: vi.fn(), quit: vi.fn(), on: vi.fn(),
  BrowserWindow: vi.fn(), read: vi.fn(), write: vi.fn(), Store: vi.fn(), compose: vi.fn(),
  handle: vi.fn(), ipcOn: vi.fn(), buildMenu: vi.fn(), setMenu: vi.fn(), error: vi.fn(),
  resolveRuntime: vi.fn(), GitAdapter: vi.fn(), captureSnapshot: vi.fn(), readAuthorizedPreview: vi.fn(),
}));
// Every environmental dependency is replaced before importing the production SOURCE entry.
vi.mock('electron', () => ({
  app: { whenReady: fake.ready, getPath: fake.getPath, exit: fake.exit, quit: fake.quit, on: fake.on },
  BrowserWindow: fake.BrowserWindow,
  dialog: { showErrorBox: fake.error, showMessageBoxSync: vi.fn(), showMessageBox: vi.fn(), showOpenDialog: vi.fn() },
  clipboard: { has: vi.fn(), readText: vi.fn(), writeText: vi.fn() },
  ipcMain: { handle: fake.handle, on: fake.ipcOn },
  Menu: { buildFromTemplate: fake.buildMenu, setApplicationMenu: fake.setMenu },
  shell: { openExternal: vi.fn(), openPath: vi.fn() },
}));
vi.mock('node:os', () => ({ default: { homedir: () => '/fake/home' } }));
vi.mock('../../../src/platform/filesystem/preferences-storage', () => ({ JsonPreferencesStorage: fake.Store }));
vi.mock('../../../src/platform/pi/runtime/discovery', () => ({ resolveRuntime: fake.resolveRuntime }));
vi.mock('../../../src/platform/git/review-adapter', () => ({ GitReviewAdapter: fake.GitAdapter }));
vi.mock('../../../src/platform/filesystem/project-resources', () => ({ inspectProjectResources: vi.fn() }));
vi.mock('../../../src/app/main/composition', () => ({ composeMain: fake.compose }));

beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });
function prepare() {
  fake.GitAdapter.mockImplementation(function () { return { captureSnapshot: fake.captureSnapshot, readAuthorizedPreview: fake.readAuthorizedPreview }; });
  const ready = deferred<void>(); const settings = deferred<{ piPath: string; nodePath: string; args: string[]; fontSize: number; recentProjects: string[] }>();
  const window = fakeWindow(); const capabilities = fakeCapabilities();
  fake.ready.mockReturnValue(ready.promise); fake.getPath.mockReturnValue('/fake/profile');
  fake.Store.mockImplementation(function () { return { read: fake.read, write: fake.write }; }); fake.read.mockReturnValue(settings.promise);
  fake.BrowserWindow.mockImplementation(function () { return window.window; }); fake.compose.mockReturnValue(capabilities);
  return { ready, settings, ...window, capabilities };
}
describe('production bootstrap source with fully Fake Electron/store/composition', () => {
  it('finishes ESM evaluation without awaiting ready, reads only after ready and loads only after complete wiring', async () => {
    const h = prepare(); await import('../../../src/app/main/bootstrap');
    expect(fake.ready).toHaveBeenCalledOnce(); expect(fake.Store).not.toHaveBeenCalled(); expect(fake.BrowserWindow).not.toHaveBeenCalled();
    h.ready.resolve(); await settle(); expect(fake.Store).toHaveBeenCalledExactlyOnceWith('/fake/profile/desktop-settings.json'); expect(fake.handle).not.toHaveBeenCalled();
    h.fake.loadURL.mockImplementation(async () => {
      expect(fake.handle).toHaveBeenCalledTimes(21); expect(fake.ipcOn).toHaveBeenCalledTimes(3); expect(fake.setMenu).toHaveBeenCalledOnce(); expect(fake.compose).toHaveBeenCalledOnce();
      expect(h.fake.listenerCount('close')).toBe(1); expect(h.fake.webContents.listenerCount('render-process-gone')).toBe(1);
      const bootstrap = fake.handle.mock.calls.find(call => call[0] === 'desktop:bootstrap')![1];
      const frame = h.fake.webContents.mainFrame; frame.url = new URL('../../../src/renderer/index.html', import.meta.url).href;
      expect(await bootstrap({ sender: h.fake.webContents, senderFrame: frame })).toMatchObject({ ok: true, value: { home: '/fake/home' } });
    });
    h.settings.resolve({ piPath: '', nodePath: '', args: [], fontSize: 14, recentProjects: [] }); await settle();
    expect(h.fake.loadURL).toHaveBeenCalledExactlyOnceWith(new URL('../../../src/renderer/index.html', import.meta.url).href);
    expect(fake.BrowserWindow.mock.calls[0][0].webPreferences.preload).toBe(fileURLToPath(new URL('../../../src/app/preload/preload.cjs', import.meta.url)));
    expect(fake.GitAdapter).toHaveBeenCalledOnce(); expect(fake.captureSnapshot).not.toHaveBeenCalled(); expect(fake.readAuthorizedPreview).not.toHaveBeenCalled();
    expect(fake.error).not.toHaveBeenCalled();
    expect(fake.on.mock.calls.map(call => call[0])).toEqual(['window-all-closed']); fake.on.mock.calls[0][1](); expect(fake.quit).toHaveBeenCalledOnce();
    // Late emitter retains its original window rather than targeting a mutable global.
    const emit = fake.compose.mock.calls[0][0]; h.fake.destroy(); emit({ type: 'exit', id: 'id', exitCode: 0 }); expect(h.fake.webContents.send).not.toHaveBeenCalled();
  });
  it('whenReady rejection preserves outer startup dialog/exit and does not create resources', async () => {
    const h = prepare(); await import('../../../src/app/main/bootstrap'); h.ready.reject(new Error('ready failed')); await settle();
    expect(fake.error).toHaveBeenCalledExactlyOnceWith('PUA 启动失败', 'Error: ready failed'); expect(fake.exit).toHaveBeenCalledExactlyOnceWith(1); expect(fake.Store).not.toHaveBeenCalled(); expect(fake.BrowserWindow).not.toHaveBeenCalled();
  });
  it('settings failure preserves both original diagnostics and exit calls, without registration/window', async () => {
    const h = prepare(); await import('../../../src/app/main/bootstrap'); h.ready.resolve(); await settle(); h.settings.reject(new Error('settings failed')); await settle();
    expect(fake.error.mock.calls).toEqual([['无法读取设置', 'settings failed'], ['PUA 启动失败', 'Error: settings failed']]); expect(fake.exit.mock.calls).toEqual([[1], [1]]); expect(fake.handle).not.toHaveBeenCalled(); expect(fake.BrowserWindow).not.toHaveBeenCalled();
  });
  it('AST entry has no top-level await or new platform quit/activation policy', () => {
    const text = readFileSync(new URL('../../../src/app/main/bootstrap.ts', import.meta.url), 'utf8'); const source = ts.createSourceFile('bootstrap.ts', text, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node, insideFunction = false) => {
      if (ts.isAwaitExpression(node)) expect(insideFunction).toBe(true);
      ts.forEachChild(node, child => visit(child, insideFunction || ts.isFunctionLike(node)));
    };
    visit(source); expect(text).toContain('void app.whenReady().then('); expect(text).not.toMatch(/before-quit|activate/);
  });
});
