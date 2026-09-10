import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evaluateRuntime, runtimeScenarios, type RuntimeSources } from './runtime-fakes';

// Only static repository TS source is read. No product code sees the host fs/os/env.
const source = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const sources: RuntimeSources = {
  discovery: source('../../../../src/platform/pi/runtime/discovery.ts'),
  environment: source('../../../../src/platform/pi/process/environment.ts'),
  home: source('../../../../src/platform/filesystem/expand-home.ts'),
  policy: source('../../../../src/app/main/desktop-preferences.ts'),
};
describe('platform runtime source with fail-closed Fake Node adapters', () => {
  it.each(Object.entries(runtimeScenarios))('%s is deterministic without mutating artificial env', (_name, scenario) => {
    const result = evaluateRuntime(sources, scenario);
    expect(result).toEqual(evaluateRuntime(sources, scenario));
    expect(result.env).toEqual(scenario.env ?? { PATH: '/bin' });
    if ('error' in result) expect(result.error).not.toMatch(/Forbidden VM|Unknown source/);
  });
  it('preserves errors, source/real path, copied args and header descriptor order', () => {
    expect(evaluateRuntime(sources, runtimeScenarios.missing).error).toBe('未找到 Pi。请先安装 Pi，或在设置中选择 Pi 可执行文件 / CLI .js 文件。');
    expect(evaluateRuntime(sources, runtimeScenarios['node missing']).error).toBe('未找到 Node.js。请在设置中指定系统 Node.js 可执行文件。');
    expect(evaluateRuntime(sources, runtimeScenarios['native denied']).error).toBe('所选 Pi 文件不可执行。');
    expect(evaluateRuntime(sources, runtimeScenarios['close overrides read']).error).toBe('fake closeSync failure');
    expect(evaluateRuntime(sources, runtimeScenarios['source node first']).result).toEqual({ executable: '/links/node', source: '/links/pi', args: ['/package/cli.mjs'] });
    const script = evaluateRuntime(sources, runtimeScenarios.script);
    expect(script.result).toEqual({ executable: '/bin/node', source: '/bin/pi', args: ['/package/cli.js', '--model', 'fake ; $(data)'] });
    const index = script.trace.findIndex(call => call[0] === 'openSync');
    expect(script.trace.slice(index, index + 3)).toEqual([['openSync', '/package/cli.js', 'r'], ['readSync', 7, 150, 0, 150, 0], ['closeSync', 7]]);
    expect(evaluateRuntime(sources, runtimeScenarios['failure readSync']).trace.at(-1)).toEqual(['closeSync', 7]);
    expect(evaluateRuntime(sources, runtimeScenarios['failure openSync']).trace.some(call => call[0] === 'closeSync')).toBe(false);
  });
  it('keeps Windows extension order and F_OK, not automatic bat/ps1 search', () => {
    const result = evaluateRuntime(sources, { platform: 'win32', env: { PATH: 'C:\\bin' }, files: { 'C:\\bin\\pi.bat': {} } });
    expect(result.trace.filter(call => call[0] === 'accessSync').slice(0, 3)).toEqual([['accessSync', 'C:\\bin\\pi.exe', 0], ['accessSync', 'C:\\bin\\pi.cmd', 0], ['accessSync', 'C:\\bin\\pi', 0]]);
    expect(result.error).toContain('未找到 Pi');
  });
  it('tries package manifests in order, tolerates malformed/missing bins, preserves shim error', () => {
    const shim = { preferences: { piPath: '/pi.cmd', nodePath: '', args: [] }, files: { '/pi.cmd': {}, '/node_modules/@earendil-works/pi-coding-agent/package.json': { text: '{bad' }, '/node_modules/@mariozechner/pi-coding-agent/package.json': { text: '{}' } } };
    const result = evaluateRuntime(sources, shim);
    expect(result.error).toBe('无法解析这个 Windows 启动脚本。请选择 Pi 包内的 dist/cli.js，并指定 Node.js。');
    expect(result.trace.filter(call => call[0] === 'readFileSync').map(call => call[1])).toEqual(['/node_modules/@earendil-works/pi-coding-agent/package.json', '/node_modules/@mariozechner/pi-coding-agent/package.json']);
  });
  it('keeps PATH search priority, fallback/NVM numeric order and stable dedup', () => {
    expect(evaluateRuntime(sources, { operation: 'searchDirectories', env: { PATH: '/bin:/bin', Path: '/ignored', APPDATA: '/app', NVM_DIR: '/nvm' }, versions: ['v9', 'v20', 'v18.2', 'v18.10'] }).result).toEqual(['/bin', '/home/fake/.local/bin', '/home/fake/.npm-global/bin', '/opt/homebrew/bin', '/usr/local/bin', '/app/npm', '/nvm/versions/node/v20/bin', '/nvm/versions/node/v18.10/bin', '/nvm/versions/node/v18.2/bin', '/nvm/versions/node/v9/bin']);
    expect(evaluateRuntime(sources, { operation: 'searchDirectories', env: { PATH: '', Path: '/ignored' } }).result).not.toContain('/ignored');
  });
  it('uses first enumerated path key but searches PATH first; preserves explicit overrides and existing Electron env', () => {
    const result = evaluateRuntime(sources, runtimeScenarios['linux terminalEnvironment none']).result as Record<string, string>;
    expect(result.Path.split(':').slice(0, 3)).toEqual(['/home/fake/node', '/home/fake/pi', 'search-first']);
    expect(result).toMatchObject({ PATH: 'search-first', pAtH: 'preserved', ELECTRON_RUN_AS_NODE: 'existing', TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'pi-desktop', PI_IMAGE_PROTOCOL: 'none', PI_HYPERLINKS: 'none' });
    expect(result).not.toHaveProperty('NON_STRING');
    for (const key of ['KITTY_WINDOW_ID', 'ITERM_SESSION_ID', 'WEZTERM_PANE', 'GHOSTTY_RESOURCES_DIR', 'WARP_SESSION_ID', 'WARP_TERMINAL_SESSION_UUID', 'TMUX', 'TMUX_PANE', 'STY', 'WT_SESSION', 'TERMINAL_EMULATOR']) expect(result).not.toHaveProperty(key);
    const defaults = evaluateRuntime(sources, { operation: 'terminalEnvironment', env: {} }).result;
    expect(defaults).toMatchObject({ PI_IMAGE_PROTOCOL: 'iterm2', PI_HYPERLINKS: '1' });
    expect(defaults).not.toHaveProperty('ELECTRON_RUN_AS_NODE');
  });
});
