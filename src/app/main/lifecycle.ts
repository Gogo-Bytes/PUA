import type { app as ElectronApp, dialog as ElectronDialog } from 'electron';
import { isSessionBusy, unwrapSessionResult } from './session-mapper.js';
import type { WindowContext } from './create-window.js';

type Dependencies = WindowContext & {
  app: Pick<typeof ElectronApp, 'quit'> & { on?: unknown };
  dialog: Pick<typeof ElectronDialog, 'showMessageBoxSync' | 'showErrorBox'>;
  /** Keep the single window resident when it is closed; explicit quit still owns cleanup. */
  background?: boolean;
};

/** Per-window close intent and shared cleanup; Session core retains shutdown/failed ownership. */
export function bindWindowLifecycle({ window, capabilities, app, dialog, background = false }: Dependencies): { requestQuit: () => Promise<void> } {
  let closing = false;
  let cleanup: Promise<void> | undefined;
  let crashNoticePending = false;
  let quitRequested = false;
  let allowQuit = false;
  const showError = (title: string, message: string) => {
    try { dialog.showErrorBox(title, message); }
    catch (error) { console.error('Lifecycle diagnostic failed:', error); }
  };
  const reportCrash = (outcome: { ok: true } | { ok: false; error: unknown }) => {
    if (!crashNoticePending) return;
    crashNoticePending = false;
    if (outcome.ok) showError('PUA 界面意外退出', '为避免无人接管的交互进程，所有 Pi 对话与终端已关闭。重新打开应用后可继续最近会话。');
    else showError('进程清理失败', `仍保留会话占用，请退出后检查 Pi 进程：${String(outcome.error)}`);
  };
  function requestCleanup(): Promise<void> {
    if (cleanup) return cleanup;
    // Install before calling core: synchronous observers may reenter close/crash.
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    cleanup = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    try { void capabilities.session.closeAll().then(unwrapSessionResult).then(resolve, reject); }
    catch (error) { reject(error); }
    return cleanup;
  }
  const requestQuit = async (): Promise<void> => {
    if (allowQuit) return;
    if (quitRequested) return cleanup ?? Promise.resolve();
    quitRequested = true;
    try {
      await requestCleanup();
      reportCrash({ ok: true });
      allowQuit = true;
      try { if (!window.isDestroyed()) window.destroy(); app.quit(); }
      catch (error) { allowQuit = false; quitRequested = false; showError('关闭进程失败', String(error)); }
    } catch (error) {
      quitRequested = false;
      reportCrash({ ok: false, error });
      showError('关闭进程失败', String(error));
    }
  };
  if (background) {
    if (typeof app.on === 'function') {
      (app.on as (event: string, listener: (event?: { preventDefault?: () => void }) => void) => unknown)('before-quit', event => {
        if (allowQuit) return;
        event?.preventDefault?.();
        void requestQuit();
      });
    }
  }
  window.webContents.on('render-process-gone', () => {
    crashNoticePending = true;
    void requestCleanup().then(
      () => reportCrash({ ok: true }),
      error => reportCrash({ ok: false, error }),
    );
  });
  window.on('close', event => {
    event.preventDefault();
    if (background) {
      if (!allowQuit && !window.isDestroyed()) window.hide();
      return;
    }
    if (closing) return;
    // Also guards modal confirmation reentry, without sealing Session admission on cancel.
    closing = true;
    try {
      if (capabilities.session.list().some(session => isSessionBusy(session, capabilities.activity(session.id)))) {
        const result = dialog.showMessageBoxSync(window, {
          type: 'question', buttons: ['继续使用', '退出'], defaultId: 0, cancelId: 0,
          message: '退出 PUA？', detail: '所有打开的 Pi 对话与终端进程将被关闭，正在进行的任务会中断。Pi 保存的会话历史不会删除。',
        });
        if (result !== 1) { closing = false; return; }
      }
      void requestCleanup().then(() => {
        reportCrash({ ok: true });
        try { if (!window.isDestroyed()) window.destroy(); app.quit(); }
        catch (error) { closing = false; showError('关闭进程失败', String(error)); }
      }, error => {
        closing = false;
        reportCrash({ ok: false, error });
        showError('关闭进程失败', String(error));
      });
    } catch (error) {
      closing = false;
      showError('关闭进程失败', String(error));
    }
  });
  return { requestQuit };
}
