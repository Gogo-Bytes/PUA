import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({ rmSync: vi.fn() }));
vi.mock('node:fs', () => ({ rmSync: fake.rmSync }));
vi.mock('vite', () => ({ defineConfig: <T>(config: T) => config }));
import config, { removeRetiredMainOutputs } from '../vite.preload.config';

// No build or disk mutation: call the real build hook with a fake rmSync.
describe('retired main build outputs', () => {
  it('cleans the fully retired legacy main output tree at buildStart', () => {
    expect(config).toMatchObject({ plugins: [{ name: 'retire-main-outputs', buildStart: removeRetiredMainOutputs }] });
    expect(fake.rmSync).not.toHaveBeenCalled();
    removeRetiredMainOutputs();
    const expected = [[fileURLToPath(new URL('../dist/main/', import.meta.url)), { recursive: true, force: true }]];
    expect(fake.rmSync.mock.calls).toEqual(expected);
    fake.rmSync.mockClear();
    expect(() => removeRetiredMainOutputs()).not.toThrow();
    expect(fake.rmSync.mock.calls).toEqual(expected);
  });
});
