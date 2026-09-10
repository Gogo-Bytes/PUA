import type { DesktopAPI, DesktopBridge } from '../src/shared/ipc/desktop-api';
import { invokeChannels, sendChannels, type InvokeMethod } from '../src/shared/ipc/channels';
import { desktopVoidMethods, safeErrorMessage } from '../src/shared/ipc/desktop-result';

/** TEST ONLY transport adapter. Keeps application Fakes/deferreds distinct from raw wire fixtures.
 * No success validation here: malformed Fake data must still reach the real client decoder.
 * Synchronous throws stay synchronous; only asynchronous application failures are enveloped.
 */
export function desktopBridgeFake(api: DesktopAPI): DesktopBridge {
  const invokes = Object.fromEntries((Object.keys(invokeChannels) as InvokeMethod[]).map(method => [method, (...args: unknown[]) => {
    const pending = (api[method] as (...args: unknown[]) => Promise<unknown>).apply(api, args);
    return pending.then(value => ({ ok: true, value: value === undefined && Object.prototype.hasOwnProperty.call(desktopVoidMethods, method) ? null : value }), error => {
      const message = safeErrorMessage(error);
      return { ok: false, error: message === undefined
        ? { kind: 'internal', code: 'INTERNAL_FAILURE', message: '桌面操作失败' }
        : { kind: 'application', code: 'FAKE_APPLICATION_FAILED', message } };
    });
  }]));
  const sends = Object.fromEntries(Object.keys(sendChannels).map(method => [method, (...args: unknown[]) => {
    (api[method as keyof typeof sendChannels] as (...args: unknown[]) => void).apply(api, args);
  }]));
  return { ...invokes, ...sends, onSessionEvent: callback => api.onSessionEvent(callback) } as DesktopBridge;
}
export function installDesktopFake(api: DesktopAPI): DesktopAPI {
  window.desktop = desktopBridgeFake(api);
  return api;
}
