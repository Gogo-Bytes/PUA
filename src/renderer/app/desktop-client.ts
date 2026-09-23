import type { DesktopAPI, DesktopBridge } from '../../shared/ipc/desktop-api.js';
import { invokeChannels, sendChannels, type InvokeMethod } from '../../shared/ipc/channels.js';
import { desktopVoidMethods, isDesktopSessionEvent, isDesktopBrowserViewState, parseDesktopResult, safeErrorMessage, type DesktopErrorKind } from '../../shared/ipc/desktop-result.js';

export class DesktopClientError extends Error {
  constructor(readonly kind: DesktopErrorKind | 'transport' | 'protocol' | 'unavailable', readonly code: string, message: string) {
    super(message);
    // Existing callers display String(error), including their own localized prefixes.
    this.name = 'Error';
  }
}
const transportError = (error: unknown) => new DesktopClientError('transport', 'TRANSPORT_FAILED', safeErrorMessage(error, '桌面连接失败'));
const protocolError = () => new DesktopClientError('protocol', 'INVALID_DESKTOP_RESULT', '桌面返回了无效结果');
/** Dynamic per-request lookup, synchronous sends/throws, and one owner per subscription. */
export function createDesktopClient(getBridge: () => DesktopBridge | undefined): DesktopAPI {
  function bridge(): DesktopBridge {
    let value: DesktopBridge | undefined;
    try { value = getBridge(); } catch (error) { throw transportError(error); }
    if (!value) throw new DesktopClientError('unavailable', 'DESKTOP_UNAVAILABLE', '桌面连接不可用');
    return value;
  }
  const invoke = (method: InvokeMethod, args: unknown[]) => {
    const current = bridge();
    let pending: Promise<unknown>;
    try {
      const call = current[method] as (...args: unknown[]) => Promise<unknown>;
      pending = call.apply(current, args);
    } catch (error) {
      throw transportError(error);
    }
    let then: unknown;
    try { then = pending?.then; } catch (error) { throw transportError(error); }
    if (typeof then !== 'function') throw protocolError();
    // The two branches are deliberately siblings: decode failures are not transport rejections.
    return Promise.resolve(pending).then(raw => {
      const result = parseDesktopResult(method, raw);
      if (!result) throw protocolError();
      if (!result.ok) throw new DesktopClientError(result.error.kind, result.error.code, result.error.message);
      return Object.prototype.hasOwnProperty.call(desktopVoidMethods, method) ? undefined : result.value;
    }, error => { throw transportError(error); });
  };
  const invokes = Object.fromEntries((Object.keys(invokeChannels) as InvokeMethod[]).map(method => [method, (...args: unknown[]) => invoke(method, args)]));
  const sends = Object.fromEntries((Object.keys(sendChannels) as (keyof typeof sendChannels)[]).map(method => [method, (...args: unknown[]) => {
    const current = bridge();
    try { (current[method] as (...args: unknown[]) => void).apply(current, args); }
    catch (error) { throw transportError(error); }
  }]));
  return {
    ...invokes, ...sends,
    onSessionEvent(observer) {
      const current = bridge();
      let active = true;
      // No catch around callbacks: valid observer exceptions retain their identity and timing.
      const remove = current.onSessionEvent(value => {
        if (!active) return;
        if (!isDesktopSessionEvent(value)) throw new DesktopClientError('protocol', 'INVALID_DESKTOP_EVENT', '桌面返回了无效事件');
        observer(value);
      });
      if (typeof remove !== 'function') { active = false; throw protocolError(); }
      return () => {
        if (!active) return;
        active = false;
        remove();
      };
    },
    onBrowserViewState(observer) {
      const current = bridge();
      let active = true;
      const remove = current.onBrowserViewState(value => {
        if (!active) return;
        if (!isDesktopBrowserViewState(value)) throw new DesktopClientError('protocol', 'INVALID_BROWSER_EVENT', '桌面返回了无效浏览器状态');
        observer(value);
      });
      if (typeof remove !== 'function') { active = false; throw protocolError(); }
      return () => { if (!active) return; active = false; remove(); };
    },
  } as DesktopAPI;
}

// This is the only production global bridge seam. No raw bridge is captured during module initialization.
const getBridge = () => typeof window === 'undefined' ? undefined : window.desktop;
export const desktopClient = createDesktopClient(getBridge);
export const isDesktopAvailable = () => !!getBridge();
