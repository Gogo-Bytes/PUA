import path from 'node:path';
import { searchDirectories, type ResolvedRuntime } from '../runtime/discovery.js';

export function runtimeEnvironment(runtime: ResolvedRuntime): Record<string, string> {
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  const key = Object.keys(env).find(key => key.toLowerCase() === 'path') ?? 'PATH';
  env[key] = [...new Set([path.dirname(runtime.executable), path.dirname(runtime.source), ...searchDirectories()])].join(path.delimiter);
  return env;
}

export function terminalEnvironment(runtime: ResolvedRuntime): Record<string, string> {
  const env = runtimeEnvironment(runtime);
  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  env.TERM_PROGRAM = 'pi-desktop';
  // The new PTY is not inside the invoking terminal/multiplexer. Advertise only
  // capabilities implemented by xterm + addon-image; preserve explicit Pi overrides.
  for (const key of ['KITTY_WINDOW_ID', 'ITERM_SESSION_ID', 'WEZTERM_PANE', 'GHOSTTY_RESOURCES_DIR', 'WARP_SESSION_ID', 'WARP_TERMINAL_SESSION_UUID', 'TMUX', 'TMUX_PANE', 'STY', 'WT_SESSION', 'TERMINAL_EMULATOR']) delete env[key];
  if (!env.PI_IMAGE_PROTOCOL || env.PI_IMAGE_PROTOCOL === 'auto') env.PI_IMAGE_PROTOCOL = 'iterm2';
  if (!env.PI_HYPERLINKS || env.PI_HYPERLINKS === 'auto') env.PI_HYPERLINKS = '1';
  return env;
}

