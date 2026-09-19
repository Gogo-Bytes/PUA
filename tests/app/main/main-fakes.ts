import { EventEmitter } from 'node:events';
import { vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import type { WindowContext } from '../../../src/app/main/create-window';
import type { SessionInfo } from '../../../src/shared/ipc/desktop-api';
import type { SessionResult, SessionSnapshot } from '../../../src/modules/sessions';

export const success: SessionResult = { ok: true, value: undefined };
export const failure: SessionResult = { ok: false, code: 'CLEANUP_FAILED', detail: 'fake cleanup failure' };
export const snapshot: SessionSnapshot = { id: 'id', cwd: '/fake/project', title: 'project', kind: 'chat', startMode: 'new', lifecycle: { phase: 'running' } };
export const sessionInfo: SessionInfo = { id: 'id', cwd: '/fake/project', title: 'project', kind: 'chat', processStatus: 'starting', activity: 'idle' };
export function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }

// Electron casts are confined to this in-memory test seam; no Electron value import.
export function fakeWindow() {
  const contents = Object.assign(new EventEmitter(), {
    mainFrame: { url: 'file:///fake/renderer/index.html' },
    send: vi.fn(), setWindowOpenHandler: vi.fn(),
    session: { setPermissionRequestHandler: vi.fn() },
  });
  let destroyed = false;
  const fake = Object.assign(new EventEmitter(), {
    webContents: contents,
    isDestroyed: vi.fn(() => destroyed),
    destroy: vi.fn(() => { destroyed = true; fake.emit('closed'); }),
    loadURL: vi.fn().mockResolvedValue(undefined),
  });
  return { fake, window: fake as unknown as BrowserWindow };
}
export function fakeCapabilities() {
  const capabilities = {
    session: {
      get: vi.fn<WindowContext['capabilities']['session']['get']>(() => snapshot),
      list: vi.fn<WindowContext['capabilities']['session']['list']>(() => [snapshot]),
      start: vi.fn<WindowContext['capabilities']['session']['start']>(() => success),
      close: vi.fn<WindowContext['capabilities']['session']['close']>().mockResolvedValue(success),
      closeAll: vi.fn<WindowContext['capabilities']['session']['closeAll']>().mockResolvedValue(success),
    },
    conversation: {
      getAvailableModels: vi.fn<WindowContext['capabilities']['conversation']['getAvailableModels']>().mockResolvedValue([]),
      getAvailableThinkingLevels: vi.fn<WindowContext['capabilities']['conversation']['getAvailableThinkingLevels']>().mockResolvedValue([]),
      getSessionStats: vi.fn<WindowContext['capabilities']['conversation']['getSessionStats']>().mockResolvedValue({ userMessages: 0, assistantMessages: 0, toolCalls: 0, toolResults: 0, totalMessages: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 }),
      getAutoSettings: vi.fn<WindowContext['capabilities']['conversation']['getAutoSettings']>().mockResolvedValue({ autoCompaction: true, autoRetry: true, steeringMode: 'one-at-a-time', followUpMode: 'one-at-a-time' }),
      setModel: vi.fn<WindowContext['capabilities']['conversation']['setModel']>().mockResolvedValue(undefined),
      setThinkingLevel: vi.fn<WindowContext['capabilities']['conversation']['setThinkingLevel']>().mockResolvedValue(undefined),
      setAutoCompaction: vi.fn<WindowContext['capabilities']['conversation']['setAutoCompaction']>().mockResolvedValue(undefined),
      setAutoRetry: vi.fn<WindowContext['capabilities']['conversation']['setAutoRetry']>().mockResolvedValue(undefined),
      setSteeringMode: vi.fn<WindowContext['capabilities']['conversation']['setSteeringMode']>().mockResolvedValue(undefined),
      setFollowUpMode: vi.fn<WindowContext['capabilities']['conversation']['setFollowUpMode']>().mockResolvedValue(undefined),
      compact: vi.fn<WindowContext['capabilities']['conversation']['compact']>().mockResolvedValue(undefined),
      send: vi.fn<WindowContext['capabilities']['conversation']['send']>().mockResolvedValue(undefined),
      stop: vi.fn<WindowContext['capabilities']['conversation']['stop']>().mockResolvedValue(undefined),
      respond: vi.fn<WindowContext['capabilities']['conversation']['respond']>().mockResolvedValue(undefined),
      rename: vi.fn<WindowContext['capabilities']['conversation']['rename']>().mockResolvedValue(undefined),
      fork: vi.fn<WindowContext['capabilities']['conversation']['fork']>().mockResolvedValue({ text: 'forked', cancelled: false }),
      removeAttachment: vi.fn<WindowContext['capabilities']['conversation']['removeAttachment']>(),
    },
    terminal: { write: vi.fn(), resize: vi.fn(), acknowledge: vi.fn() },
    activity: vi.fn<WindowContext['capabilities']['activity']>(() => 'idle'),
    createSession: vi.fn<WindowContext['capabilities']['createSession']>().mockResolvedValue(sessionInfo),
    registerChatAttachments: vi.fn<WindowContext['capabilities']['registerChatAttachments']>().mockResolvedValue([]),
  } satisfies WindowContext['capabilities'];
  (capabilities.conversation as unknown as { clone: () => Promise<{ cancelled: boolean }> }).clone = vi.fn().mockResolvedValue({ cancelled: false });
  (capabilities as unknown as { restoreChatSession: unknown }).restoreChatSession = vi.fn(async (_runtime: unknown, persisted: { id: string; cwd: string; title: string }) => ({ id: persisted.id, cwd: persisted.cwd, title: persisted.title, kind: 'chat' as const, processStatus: 'starting' as const, activity: 'idle' as const }));
  (capabilities as unknown as { chatIdentity: unknown }).chatIdentity = vi.fn(() => ({ sessionId: 'pi-id', sessionFile: '/fake/pi.jsonl' }));
  (capabilities as unknown as { waitForChatIdentity: unknown }).waitForChatIdentity = vi.fn(async (_id: string, _timeout?: number, previous?: { sessionId: string; sessionFile: string }) => previous ? { sessionId: 'pi-clone', sessionFile: '/fake/pi-clone.jsonl' } : { sessionId: 'pi-id', sessionFile: '/fake/pi.jsonl' });
  return capabilities;
}
