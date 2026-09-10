import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';

export interface FakeFile { text?: string; real?: string; executable?: boolean; directory?: boolean }
export interface Scenario {
  platform?: 'win32' | 'darwin' | 'linux';
  env?: Record<string, unknown>;
  home?: string;
  files?: Record<string, FakeFile>;
  versions?: string[];
  fail?: string[];
  preferences?: { piPath: string; nodePath: string; args: string[] };
  operation?: 'resolveRuntime' | 'searchDirectories' | 'runtimeEnvironment' | 'terminalEnvironment' | 'expandHome' | 'validateChatArguments';
  value?: string;
  args?: string[];
}
export type RuntimeSources = Record<'discovery' | 'environment' | 'home' | 'policy', string>;

/** Source-only VM: all product fs/os/env/platform are artificial; unknown imports fail closed. */
export function evaluateRuntime(sources: RuntimeSources | string, scenario: Scenario) {
  const platform = scenario.platform ?? 'linux';
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const home = scenario.home ?? (platform === 'win32' ? 'C:\\home' : '/home/fake');
  const env = { ...(scenario.env ?? { PATH: '/bin' }) };
  const files = scenario.files ?? {};
  const trace: unknown[][] = [];
  let opened = '';
  const call = (method: string, ...args: unknown[]) => {
    trace.push([method, ...args]);
    if (scenario.fail?.includes(method) || scenario.fail?.includes(`${method}:${args[0]}`)) throw new Error(`fake ${method} failure`);
  };
  const file = (name: string) => { if (!files[name]) throw new Error(`fake missing ${name}`); return files[name]; };
  const fs = {
    constants: { F_OK: 0, X_OK: 1 },
    readdirSync(name: string) { call('readdirSync', name); if (!scenario.versions) throw new Error('optional NVM absent'); return [...scenario.versions]; },
    existsSync(name: string) { call('existsSync', name); return !!files[name]; },
    statSync(name: string) { call('statSync', name); const entry = file(name); return { isFile: () => !entry.directory }; },
    accessSync(name: string, mode: number) { call('accessSync', name, mode); const entry = file(name); if (mode === 1 && entry.executable === false) throw new Error('fake denied'); },
    readFileSync(name: string, encoding: string) { call('readFileSync', name, encoding); return file(name).text ?? ''; },
    realpathSync(name: string) { call('realpathSync', name); return file(name).real ?? name; },
    openSync(name: string, flags: string) { call('openSync', name, flags); file(name); opened = name; return 7; },
    readSync(fd: number, bytes: Buffer, offset: number, length: number, position: number) {
      call('readSync', fd, bytes.length, offset, length, position);
      const content = Buffer.from(file(opened).text ?? ''); const size = Math.min(content.length, length);
      content.copy(bytes, offset, position, position + size); return size;
    },
    closeSync(fd: number) { call('closeSync', fd); },
  };
  const cache = new Map<string, Record<string, (...args: never[]) => unknown>>();
  const load = (key: string): Record<string, (...args: never[]) => unknown> => {
    if (cache.has(key)) return cache.get(key)!;
    const exports: Record<string, (...args: never[]) => unknown> = {};
    cache.set(key, exports);
    const source = typeof sources === 'string' ? sources : sources[key as keyof RuntimeSources];
    if (!source) throw new Error(`Unknown source ${key}`);
    const requireFake = (name: string): unknown => {
      if (name === 'node:fs') return fs;
      if (name === 'node:path') return paths;
      if (name === 'node:os') return { homedir: () => { call('homedir'); return home; } };
      if (name === '../../filesystem/expand-home.js') return load('home');
      if (name === '../runtime/discovery.js') return load('discovery');
      if (name === '../../main/session-mapper.js') return { unwrapSessionResult: () => { throw new Error('workflow not loaded in runtime VM'); } };
      throw new Error(`Forbidden VM import ${name}`);
    };
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    vm.runInNewContext(js, { exports, require: requireFake, process: Object.freeze({ platform, env }), Buffer }, { filename: `fake-source/${key}.ts`, timeout: 1000 });
    return exports;
  };
  const operation = scenario.operation ?? 'resolveRuntime';
  const key = operation === 'expandHome' ? 'home' : operation === 'validateChatArguments' ? 'policy' : operation.endsWith('Environment') ? 'environment' : 'discovery';
  let result: unknown;
  try {
    const fn = load(key)[operation] as (input?: unknown) => unknown;
    if (operation === 'resolveRuntime') {
      const preferences = scenario.preferences ?? { piPath: '', nodePath: '', args: ['--model', 'fake ; $(data)'] };
      const args = [...preferences.args]; result = fn({ ...preferences, args }); args.push('caller mutation');
    } else if (operation.endsWith('Environment')) result = fn({ executable: paths.join(home, 'node/node'), source: paths.join(home, 'pi/pi'), args: [] });
    else if (operation === 'expandHome') result = fn(scenario.value);
    else if (operation === 'validateChatArguments') result = fn(scenario.args ?? []);
    else result = fn();
    return { result: result === undefined ? null : JSON.parse(JSON.stringify(result)) as unknown, trace, env };
  } catch (error) { return { error: String((error as Error).message), trace, env }; }
}

export const runtimeScenarios: Record<string, Scenario> = {
  missing: {},
  native: { files: { '/bin/pi': { text: 'native' } } },
  script: { files: { '/bin/pi': { real: '/package/cli.js' }, '/package/cli.js': { text: '#!/usr/bin/node' }, '/bin/node': {} } },
  'node missing': { files: { '/bin/pi': { text: '#!/usr/bin/env node' } } },
  'explicit home': { preferences: { piPath: '~/pi', nodePath: '', args: [] }, files: { '/home/fake/pi': {} } },
  'explicit relative': { preferences: { piPath: 'relative pi', nodePath: '', args: [] }, files: { 'relative pi': {} } },
  'native denied': { preferences: { piPath: '/pi', nodePath: '', args: [] }, files: { '/pi': { executable: false } } },
  directory: { preferences: { piPath: '/pi', nodePath: '', args: [] }, files: { '/pi': { directory: true } } },
  'explicit node': { preferences: { piPath: '/pi.js', nodePath: '~/node', args: ['one'] }, files: { '/pi.js': {}, '/home/fake/node': {} } },
  'source node first': { preferences: { piPath: '/links/pi', nodePath: '', args: [] }, files: { '/links/pi': { real: '/package/cli.mjs' }, '/package/cli.mjs': {}, '/links/node': {}, '/bin/node': {}, '/package/node': {} } },
  'header limit': { files: { '/bin/pi': { text: 'x'.repeat(150) + '\n#!/usr/bin/node' } } },
  'short header': { files: { '/bin/pi': { text: '#!/usr/bin/node\n' }, '/bin/node': {} } },
  'not node word': { files: { '/bin/pi': { text: '#!/usr/bin/nodejs\n' } } },
};
for (const method of ['existsSync:/pi', 'statSync:/pi', 'realpathSync', 'openSync', 'readSync', 'closeSync']) {
  runtimeScenarios[`failure ${method}`] = { preferences: { piPath: '/pi', nodePath: '', args: [] }, files: { '/pi': {} }, fail: [method] };
}
runtimeScenarios['close overrides read'] = { files: { '/bin/pi': {} }, fail: ['readSync', 'closeSync'] };
for (const platform of ['win32', 'darwin', 'linux'] as const) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const bin = platform === 'win32' ? 'C:\\bin' : '/bin';
  runtimeScenarios[`${platform} native search`] = { platform, env: { PATH: bin }, files: { [p.join(bin, platform === 'win32' ? 'pi.exe' : 'pi')]: {} } };
  runtimeScenarios[`${platform} directories`] = { platform, operation: 'searchDirectories', env: { PATH: [bin, bin, ''].join(p.delimiter), Path: 'ignored', APPDATA: p.join(bin, 'app'), NVM_DIR: p.join(bin, 'nvm') }, versions: ['v9.1', 'v20.1', 'v18.10', 'v18.2'] };
  runtimeScenarios[`${platform} empty PATH`] = { platform, operation: 'searchDirectories', env: { PATH: '', Path: 'ignored' } };
  runtimeScenarios[`${platform} Path only`] = { platform, operation: 'searchDirectories', env: { Path: bin } };
  for (const value of ['~', '~/project', '~\\project', '~other', 'relative', p.parse(bin).root]) runtimeScenarios[`${platform} home ${value}`] = { platform, operation: 'expandHome', value };
  for (const extension of ['cmd', 'bat', 'ps1']) for (const pkg of ['@earendil-works/pi-coding-agent', '@mariozechner/pi-coding-agent']) for (const shape of ['string', 'object']) {
    const shim = p.join(bin, `pi.${extension}`); const root = p.join(bin, 'node_modules', pkg); const cli = p.join(root, 'dist/cli.js');
    runtimeScenarios[`${platform} ${extension} ${pkg} ${shape}`] = { platform, env: { PATH: bin }, preferences: { piPath: shim, nodePath: '', args: ['space arg', ';'] }, files: { [shim]: {}, [p.join(root, 'package.json')]: { text: JSON.stringify({ bin: shape === 'string' ? 'dist/cli.js' : { pi: 'dist/cli.js' } }) }, [cli]: {}, [p.join(bin, platform === 'win32' ? 'node.exe' : 'node')]: {} } };
  }
  for (const operation of ['runtimeEnvironment', 'terminalEnvironment'] as const) for (const override of [undefined, '', 'auto', 'none', '0', 'AUTO']) {
    runtimeScenarios[`${platform} ${operation} ${override}`] = { platform, operation, env: { Path: bin, PATH: 'search-first', pAtH: 'preserved', NON_STRING: 7, ELECTRON_RUN_AS_NODE: 'existing', TERM: 'old', COLORTERM: 'old', TERM_PROGRAM: 'old', PI_IMAGE_PROTOCOL: override, PI_HYPERLINKS: override, ...Object.fromEntries(['KITTY_WINDOW_ID', 'ITERM_SESSION_ID', 'WEZTERM_PANE', 'GHOSTTY_RESOURCES_DIR', 'WARP_SESSION_ID', 'WARP_TERMINAL_SESSION_UUID', 'TMUX', 'TMUX_PANE', 'STY', 'WT_SESSION', 'TERMINAL_EMULATOR'].map(key => [key, 'remove'])) } };
  }
}
for (const args of [['--mode', '--session'], ...['--', '--mode', '--print', '-p', '--session', '--fork', '--continue', '-c', '--resume', '-r', '--approve', '-a', '--no-approve', '-na', '--mode=rpc', '--session=x', '--fork=x', '--continue=x', '--resume=x', '--no-session', '--model', '--Mode', '--approval'].map(flag => [flag])]) runtimeScenarios[`chat ${args.join(' ')}`] = { operation: 'validateChatArguments', args };
for (const extension of ['js', 'cjs', 'mjs', 'JS']) runtimeScenarios[`JS extension ${extension}`] = { preferences: { piPath: `/pi.${extension}`, nodePath: '', args: ['; $(not executed)'] }, files: { [`/pi.${extension}`]: {}, '/node': {} } };
for (const method of ['accessSync:/bin/pi', 'statSync:/bin/pi']) runtimeScenarios[`search optional ${method}`] = { fail: [method], files: { '/bin/pi': {}, '/home/fake/.local/bin/pi': {} } };
runtimeScenarios['node explicit relative search'] = { preferences: { piPath: '/cli.js', nodePath: 'custom-node', args: [] }, files: { '/cli.js': {}, '/bin/custom-node': {} } };
runtimeScenarios['node explicit invalid'] = { preferences: { piPath: '/cli.js', nodePath: '/denied-node', args: [] }, files: { '/cli.js': {}, '/denied-node': { executable: false } } };
runtimeScenarios['Windows bare executable'] = { platform: 'win32', env: { PATH: 'C:\\bin' }, files: { 'C:\\bin\\pi': {} } };
runtimeScenarios['Windows cmd search'] = { platform: 'win32', env: { PATH: 'C:\\bin' }, files: { 'C:\\bin\\pi.cmd': {}, 'C:\\bin\\node_modules\\@earendil-works\\pi-coding-agent\\package.json': { text: '{"bin":"dist/cli.js"}' }, 'C:\\bin\\node_modules\\@earendil-works\\pi-coding-agent\\dist\\cli.js': {}, 'C:\\bin\\node.cmd': {} } };
const firstRoot = '/bin/node_modules/@earendil-works/pi-coding-agent';
const secondRoot = '/bin/node_modules/@mariozechner/pi-coding-agent';
const manifests = { '/bin/pi.cmd': {}, '/bin/node': {}, [`${firstRoot}/package.json`]: { text: '{"bin":"first.js"}' }, [`${firstRoot}/first.js`]: {}, [`${secondRoot}/package.json`]: { text: '{"bin":{"pi":"second.js"}}' }, [`${secondRoot}/second.js`]: {} };
runtimeScenarios['package first wins'] = { preferences: { piPath: '/bin/pi.cmd', nodePath: '', args: [] }, files: manifests };
for (const text of ['{bad', '{}', '{"bin":{}}', '{"bin":3}', '{"bin":"missing.js"}']) runtimeScenarios[`package fallback ${text}`] = { preferences: { piPath: '/bin/pi.cmd', nodePath: '', args: [] }, files: { ...manifests, [`${firstRoot}/package.json`]: { text } } };
runtimeScenarios['env uppercase unusual path'] = { operation: 'runtimeEnvironment', env: { pAtH: '/enumerated-only', KEEP: 'yes', NULL: null } };
runtimeScenarios['env fallback dedup'] = { operation: 'runtimeEnvironment', env: { PATH: '/home/fake/node:/home/fake/pi:/usr/local/bin' } };
