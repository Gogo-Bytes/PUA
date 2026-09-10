import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JsonPreferencesStorage, defaults } from '../../../src/platform/filesystem/preferences-storage';
import type { PreferenceValues } from '../../../src/modules/preferences/index';

// Complete IO replacement: the real storage implementation and shared parser run, never real fs.
const fs = vi.hoisted(() => ({ readFile: vi.fn(), mkdir: vi.fn(), writeFile: vi.fn(), rename: vi.fn() }));
vi.mock('node:fs/promises', () => fs);
const file = '/fake/profile/desktop-settings.json';
function values(): PreferenceValues { return { ...defaults, args: [], recentProjects: [] }; }
function deferred<T = void>() {
  let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.resetAllMocks();
  fs.mkdir.mockResolvedValue(undefined); fs.writeFile.mockResolvedValue(undefined); fs.rename.mockResolvedValue(undefined);
});
describe('JsonPreferencesStorage disk edge with entirely in-memory fs', () => {
  it('ENOENT returns fresh defaults/arrays without creating anything', async () => {
    fs.readFile.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    const storage = new JsonPreferencesStorage(file); const first = await storage.read(); const second = await storage.read();
    expect(first).toEqual(defaults); expect(second).toEqual(defaults); expect(first).not.toBe(second);
    expect(first.args).not.toBe(second.args); expect(first.args).not.toBe(defaults.args);
    expect(first.recentProjects).not.toBe(second.recentProjects); expect(first.recentProjects).not.toBe(defaults.recentProjects);
    first.args.push('local'); first.recentProjects.push('local'); expect(second).toEqual(defaults);
    expect(fs.readFile.mock.calls).toEqual([[file, 'utf8'], [file, 'utf8']]);
    expect(fs.mkdir).not.toHaveBeenCalled(); expect(fs.writeFile).not.toHaveBeenCalled(); expect(fs.rename).not.toHaveBeenCalled();
  });
  it.each(['null', '[]', '[1,2]', '"legacy"', '42', 'true', '{}'])('preserves default spread before validation for JSON %s', async text => {
    fs.readFile.mockResolvedValue(text); expect(await new JsonPreferencesStorage(file).read()).toEqual(defaults);
  });
  it.each(['system', 'light', 'dark'] as const)('preserves explicit %s theme through read and write', async theme => {
    const storage = new JsonPreferencesStorage(file); fs.readFile.mockResolvedValue(JSON.stringify({ theme }));
    const read = await storage.read(); expect(read.theme).toBe(theme); await storage.write(read);
    expect(JSON.parse(fs.writeFile.mock.calls[0][1]).theme).toBe(theme);
  });
  it('uses the shared parser for legacy optional theme, fractional fonts, args and recents normalization', async () => {
    fs.readFile.mockResolvedValue(JSON.stringify({ args: ['--extension', '/custom.ts', ''], fontSize: 10.5, recentProjects: ['relative\0name', ...Array.from({ length: 25 }, (_, i) => `/p${i}`), '/p0'] }));
    expect(await new JsonPreferencesStorage(file).read()).toEqual({ ...defaults, args: ['--extension', '/custom.ts', ''], fontSize: 10.5, recentProjects: ['relative\0name', ...Array.from({ length: 19 }, (_, i) => `/p${i}`)] });
  });
  it.each(['{broken', '{"theme":null}', '{"fontSize":9}', '{"args":null}', '{"recentProjects":[1]}'])('wraps parse/merged validation failures with the file: %s', async text => {
    fs.readFile.mockResolvedValue(text);
    await expect(new JsonPreferencesStorage(file).read()).rejects.toThrow(`无法读取桌面设置 ${file}: `);
    expect(fs.mkdir).not.toHaveBeenCalled();
  });
  it('wraps non-ENOENT read errors with original String(error)', async () => {
    const error = Object.assign(new Error('denied'), { code: 'EACCES' }); fs.readFile.mockRejectedValue(error);
    await expect(new JsonPreferencesStorage(file).read()).rejects.toThrow(`无法读取桌面设置 ${file}: ${String(error)}`);
  });
  it.each([
    { fontSize: Infinity }, { fontSize: NaN }, { fontSize: 9.9 }, { fontSize: 28.1 },
    { args: ['bad\0arg'] }, { args: new Array(1) }, { args: '--fake' },
    { recentProjects: new Array(1) }, { recentProjects: [1] }, { piPath: '\0' }, { nodePath: '\0' }, { theme: null }, { theme: 'other' },
  ])('invalid write throws synchronously before enqueue: %j', async invalid => {
    const storage = new JsonPreferencesStorage(file);
    expect(() => storage.write({ ...values(), ...invalid } as PreferenceValues)).toThrow();
    expect(fs.mkdir).not.toHaveBeenCalled(); expect(fs.writeFile).not.toHaveBeenCalled(); expect(fs.rename).not.toHaveBeenCalled();
    await storage.write(values()); expect(fs.mkdir).toHaveBeenCalledOnce(); expect(fs.rename).toHaveBeenCalledOnce();
  });
  it('validates both concurrent inputs at call time, then serializes mkdir → tmp0600 → rename', async () => {
    const storage = new JsonPreferencesStorage(file); const trace: string[] = [];
    const mkdir = deferred(); const write = deferred(); const rename = deferred();
    const enteredMkdir = deferred(); const enteredWrite = deferred(); const enteredRename = deferred();
    fs.mkdir.mockImplementationOnce(() => { trace.push('mkdir1'); enteredMkdir.resolve(); return mkdir.promise; }).mockImplementation(async () => { trace.push('mkdir2'); });
    fs.writeFile.mockImplementationOnce(() => { trace.push('write1'); enteredWrite.resolve(); return write.promise; }).mockImplementation(async () => { trace.push('write2'); });
    fs.rename.mockImplementationOnce(() => { trace.push('rename1'); enteredRename.resolve(); return rename.promise; }).mockImplementation(async () => { trace.push('rename2'); });
    const first = { ...values(), args: ['first'], recentProjects: ['/one', '/one'] }; const second = { ...values(), args: ['second'], fontSize: 28 };
    const p1 = storage.write(first); const p2 = storage.write(second);
    first.args.push('mutated'); first.recentProjects.push('/late'); first.fontSize = 20; second.args[0] = 'mutated'; second.theme = 'dark';
    await enteredMkdir.promise; expect(trace).toEqual(['mkdir1']);
    mkdir.resolve(); await enteredWrite.promise; expect(trace).toEqual(['mkdir1', 'write1']);
    expect(fs.mkdir).toHaveBeenCalledWith('/fake/profile', { recursive: true });
    expect(fs.writeFile.mock.calls[0]).toEqual([file + '.tmp', JSON.stringify({ theme: 'system', piPath: '', nodePath: '', args: ['first'], fontSize: 14, recentProjects: ['/one'] }, null, 2), { mode: 0o600 }]);
    write.resolve(); await enteredRename.promise; expect(trace).toEqual(['mkdir1', 'write1', 'rename1']);
    expect(fs.rename.mock.calls[0]).toEqual([file + '.tmp', file]);
    rename.resolve(); await Promise.all([p1, p2]);
    expect(trace).toEqual(['mkdir1', 'write1', 'rename1', 'mkdir2', 'write2', 'rename2']);
    expect(JSON.parse(fs.writeFile.mock.calls[1][1])).toEqual({ ...defaults, args: ['second'], fontSize: 28 });
  });
  it.each(['mkdir', 'writeFile', 'rename'] as const)('%s failure rejects unchanged, skips remaining steps, and does not poison the queue', async stage => {
    const storage = new JsonPreferencesStorage(file); const error = new Error(stage); fs[stage].mockRejectedValueOnce(error);
    const first = storage.write(values()); const rejected = expect(first).rejects.toBe(error);
    const second = storage.write({ ...values(), fontSize: 18 });
    await rejected; await second;
    expect(fs.mkdir).toHaveBeenCalledTimes(2);
    expect(fs.writeFile).toHaveBeenCalledTimes(stage === 'mkdir' ? 1 : 2);
    expect(fs.rename).toHaveBeenCalledTimes(stage === 'rename' ? 2 : 1);
    expect(JSON.parse(fs.writeFile.mock.calls.at(-1)![1]).fontSize).toBe(18);
  });
  it('read does not wait for the IO queue and writes do not depend on close', async () => {
    const storage = new JsonPreferencesStorage(file); const blocked = deferred(); const entered = deferred();
    fs.mkdir.mockImplementationOnce(() => { entered.resolve(); return blocked.promise; });
    const pending = storage.write({ ...values(), fontSize: 18 }); await entered.promise;
    fs.readFile.mockResolvedValue('{"fontSize":12}'); expect((await storage.read()).fontSize).toBe(12);
    expect(fs.writeFile).not.toHaveBeenCalled(); blocked.resolve(); await pending; expect(fs.rename).toHaveBeenCalledOnce();
  });
});
