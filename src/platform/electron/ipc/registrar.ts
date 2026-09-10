import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron';
import { invokeChannels, sendChannels, type InvokeMethod, type SendMethod, type RequestArgs, type RequestResult } from '../../../shared/ipc/channels.js';
import { requestParsers } from '../../../shared/ipc/schemas.js';

type SenderEvent = IpcMainInvokeEvent | IpcMainEvent;

export function checkSender(event: SenderEvent, contents: WebContents, rendererURL: string): void {
  if (event.sender !== contents || event.senderFrame !== event.sender.mainFrame || event.senderFrame?.url !== rendererURL) {
    throw new Error('Untrusted IPC sender');
  }
}

/** Sender checks precede parsing and effects. Invoke rejects; send logs and drops. */
export function createIPCRegistrar(ipc: Pick<IpcMain, 'handle' | 'on'>, trust: (event: SenderEvent) => void, report: (message: string, error: string) => void = console.error) {
  return {
    handle<K extends InvokeMethod>(method: K, callback: (...args: RequestArgs<K>) => RequestResult<K> | Promise<RequestResult<K>>): void {
      ipc.handle(invokeChannels[method], (event, ...args: unknown[]) => {
        trust(event);
        return callback(...requestParsers[method](args));
      });
    },
    listen<K extends SendMethod>(method: K, callback: (...args: RequestArgs<K>) => RequestResult<K>): void {
      const channel = sendChannels[method];
      ipc.on(channel, (event, ...args: unknown[]) => {
        try { trust(event); callback(...requestParsers[method](args)); }
        catch (error) { report(`IPC ${channel}:`, (error as Error).message); }
      });
    },
  };
}
