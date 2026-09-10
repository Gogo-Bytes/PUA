import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import type { DesktopBridge } from '../src/shared/ipc/desktop-api';
import { invokeChannels, sendChannels, eventChannels } from '../src/shared/ipc/channels';

/** Execute source preload with only the in-memory Electron port; never loads Electron or built output. */
export function preloadFake(ipc: {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  send(channel: string, ...args: unknown[]): void;
  on(channel: string, listener: (event: unknown, value: unknown) => void): void;
  removeListener(channel: string, listener: (event: unknown, value: unknown) => void): void;
}): DesktopBridge {
  let bridge!: DesktopBridge;
  const code = ts.transpileModule(readFileSync(`${process.cwd()}/src/main/preload.cts`, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(code, {
    exports: {}, require(name: string) {
      if (name === 'electron') return { ipcRenderer: ipc, contextBridge: { exposeInMainWorld(key: string, value: DesktopBridge) { if (key !== 'desktop') throw new Error('Unexpected capability'); bridge = value; } } };
      if (name === '../shared/ipc/channels.js') return { invokeChannels, sendChannels, eventChannels };
      throw new Error(`Unexpected preload import: ${name}`);
    },
  });
  return bridge;
}
