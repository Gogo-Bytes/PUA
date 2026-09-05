import { accessSync, closeSync, constants, existsSync, openSync, readSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Preferences, RuntimeInfo } from '../shared/contracts.js';

const packages = ['@earendil-works/pi-coding-agent', '@mariozechner/pi-coding-agent'];

export function expandHome(value: string, home = os.homedir()): string {
  return value === '~' ? home : value.startsWith('~/') || value.startsWith('~\\') ? path.join(home, value.slice(2)) : value;
}

export function searchDirectories(env = process.env, home = os.homedir()): string[] {
  const dirs = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean);
  dirs.push(path.join(home, '.local/bin'), path.join(home, '.npm-global/bin'), '/opt/homebrew/bin', '/usr/local/bin');
  if (env.APPDATA) dirs.push(path.join(env.APPDATA, 'npm'));
  const nvm = path.join(env.NVM_DIR || path.join(home, '.nvm'), 'versions/node');
  try {
    const versions = readdirSync(nvm).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    dirs.push(...versions.map(version => path.join(nvm, version, 'bin')));
  } catch { /* NVM is optional. Explicit paths cover other version managers. */ }
  return [...new Set(dirs)];
}

function isExecutable(file: string): boolean {
  try {
    accessSync(file, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
    return statSync(file).isFile();
  } catch { return false; }
}

function findExecutable(name: string, dirs: string[]): string | undefined {
  const expanded = expandHome(name);
  if (path.isAbsolute(expanded)) return isExecutable(expanded) ? expanded : undefined;
  const names = process.platform === 'win32' && !path.extname(name) ? [name + '.exe', name + '.cmd', name] : [name];
  for (const dir of dirs) for (const candidate of names) {
    const file = path.join(dir, candidate);
    if (isExecutable(file)) return file;
  }
}

function findWindowsCli(shim: string): string | undefined {
  for (const pkg of packages) {
    const root = path.join(path.dirname(shim), 'node_modules', pkg);
    try {
      const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
      const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin.pi;
      const file = path.resolve(root, bin);
      if (existsSync(file)) return file;
    } catch { /* Try the other supported package name. */ }
  }
}

/** Resolve the user's installation, never a bundled/forked Pi or Electron-as-Node. */
export function resolveRuntime(preferences: Pick<Preferences, 'piPath' | 'nodePath' | 'args'>): RuntimeInfo {
  const dirs = searchDirectories();
  let pi = preferences.piPath ? expandHome(preferences.piPath) : findExecutable('pi', dirs);
  if (!pi || !existsSync(pi) || !statSync(pi).isFile()) {
    throw new Error('未找到 Pi。请先安装 Pi，或在设置中选择 Pi 可执行文件 / CLI .js 文件。');
  }
  const source = pi;
  if (/\.(cmd|bat|ps1)$/i.test(pi)) {
    pi = findWindowsCli(pi);
    if (!pi) throw new Error('无法解析这个 Windows 启动脚本。请选择 Pi 包内的 dist/cli.js，并指定 Node.js。');
  }
  const real = realpathSync(pi);
  const fd = openSync(real, 'r');
  const bytes = Buffer.alloc(150);
  let header: string;
  try { header = bytes.subarray(0, readSync(fd, bytes, 0, bytes.length, 0)).toString(); }
  finally { closeSync(fd); }
  if (/\.[cm]?js$/i.test(real) || /^#![^\n]*\bnode\b/.test(header)) {
    const nodeDirs = [path.dirname(source), ...dirs];
    const node = findExecutable(preferences.nodePath || 'node', nodeDirs);
    if (!node) throw new Error('未找到 Node.js。请在设置中指定系统 Node.js 可执行文件。');
    return { executable: node, args: [real, ...preferences.args], source };
  }
  if (!isExecutable(real)) throw new Error('所选 Pi 文件不可执行。');
  return { executable: real, args: [...preferences.args], source };
}

export function terminalEnvironment(runtime: RuntimeInfo): Record<string, string> {
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  const key = Object.keys(env).find(key => key.toLowerCase() === 'path') ?? 'PATH';
  env[key] = [...new Set([path.dirname(runtime.executable), path.dirname(runtime.source), ...searchDirectories()])].join(path.delimiter);
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
