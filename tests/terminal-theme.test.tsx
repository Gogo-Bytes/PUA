/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const transport = vi.hoisted(() => ({ instances: [] as { options: Record<string, unknown>; dispose: ReturnType<typeof vi.fn>; focus: ReturnType<typeof vi.fn> }[] }));
// Canvas/PTY are not available in jsdom. Only the xterm device is replaced; the production
// TerminalPane's subscription, start/dispose lifecycle and theme effects execute unchanged.
vi.mock('@xterm/xterm', () => ({ Terminal: class {
  options: Record<string, unknown>;
  dispose = vi.fn(); focus = vi.fn(); cols = 100; rows = 30;
  constructor(options: Record<string, unknown>) { this.options = options; transport.instances.push(this); }
  loadAddon() {} open() {} attachCustomKeyEventHandler() {}
  onData() { return { dispose() {} }; } onResize() { return { dispose() {} }; }
} }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }));
vi.mock('@xterm/addon-search', () => ({ SearchAddon: class {} }));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }));
vi.mock('@xterm/addon-image', () => ({ ImageAddon: class {} }));
import { TerminalPane } from '../src/renderer/TerminalPane';
import { terminalThemes } from '../src/renderer/theme';

beforeEach(() => {
  transport.instances.length = 0;
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  window.desktop = { onSessionEvent: vi.fn(() => vi.fn()), startSession: vi.fn().mockResolvedValue(undefined), resize: vi.fn() } as unknown as typeof window.desktop;
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('updates the existing xterm palette without spawning or disposing a terminal on theme/session visibility changes', () => {
  const props = { session: { id: 'terminal', cwd: '/repo', title: 'terminal', kind: 'terminal' as const, processStatus: 'running' as const, activity: 'idle' as const }, active: true, fontSize: 14, platform: 'darwin', onReady: vi.fn(), onExit: vi.fn(), onError: vi.fn() };
  const { rerender, unmount } = render(<TerminalPane {...props} theme="light" />);
  const terminal = transport.instances[0]; expect(terminal.options.theme).toEqual(terminalThemes.light);
  rerender(<TerminalPane {...props} theme="dark" />); expect(terminal.options.theme).toEqual(terminalThemes.dark);
  rerender(<TerminalPane {...props} active={false} theme="light" />); expect(terminal.options.theme).toEqual(terminalThemes.light);
  expect(transport.instances).toHaveLength(1); expect(window.desktop.startSession).toHaveBeenCalledTimes(1); expect(window.desktop.onSessionEvent).toHaveBeenCalledTimes(1); expect(terminal.dispose).not.toHaveBeenCalled();
  unmount(); expect(terminal.dispose).toHaveBeenCalledTimes(1);
});
