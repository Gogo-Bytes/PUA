import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({ rmSync: vi.fn() }));
vi.mock('node:fs', () => ({ rmSync: fake.rmSync }));
vi.mock('vite', () => ({ defineConfig: <T>(config: T) => config }));
import config, { removeRetiredMainOutputs } from '../vite.preload.config';

// No build or disk mutation: call the real build hook with a fake rmSync.
describe('retired main build outputs', () => {
  it('cleans exactly the eighteen absolute retired outputs at buildStart, with missing-file tolerance and no recursive removal', () => {
    expect(config).toMatchObject({ plugins: [{ name: 'retire-main-outputs', buildStart: removeRetiredMainOutputs }] });
    expect(fake.rmSync).not.toHaveBeenCalled();
    removeRetiredMainOutputs();
    const expected = ['sessions.js', 'sessions.js.map', 'extension-dialogs.js', 'extension-dialogs.js.map', 'main.js', 'main.js.map', 'ipc.js', 'ipc.js.map', 'git.js', 'git.js.map', 'preferences.js', 'preferences.js.map', 'runtime.js', 'runtime.js.map', 'project-resources.js', 'project-resources.js.map', 'session-preparation.js', 'session-preparation.js.map'].map(filename => [fileURLToPath(new URL(`../dist/main/${filename}`, import.meta.url)), { force: true }]);
    expect(fake.rmSync.mock.calls).toEqual(expected);
    fake.rmSync.mockClear();
    expect(() => removeRetiredMainOutputs()).not.toThrow();
    expect(fake.rmSync.mock.calls).toEqual(expected);
  });
});
