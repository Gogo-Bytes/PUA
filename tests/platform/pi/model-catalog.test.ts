import { describe, expect, it, vi } from 'vitest';

const child = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: child.execFile }));
import { listPiModelCatalog, parsePiModelCatalog } from '../../../src/platform/pi/model-catalog';

const table = `provider      model       context  max-out  thinking  images\nopenai-codex  gpt-5.5     272K     128K     yes       yes\nlocal         tiny-model  8K       1K       no        no\n`;

describe('Pi pre-session model catalog', () => {
  it('maps Pi model rows and reasoning support without losing provider identity', () => {
    expect(parsePiModelCatalog(table)).toEqual([
      { provider: 'openai-codex', id: 'gpt-5.5', name: 'gpt-5.5', reasoning: true },
      { provider: 'local', id: 'tiny-model', name: 'tiny-model', reasoning: false },
    ]);
  });
  it('fails closed on an unknown table format', () => {
    expect(() => parsePiModelCatalog('provider model\nopenai gpt-5')).toThrow('无法识别');
  });
  it('lists offline from the configured Pi runtime with sessions and extensions disabled', async () => {
    child.execFile.mockImplementation((_executable, _args, _options, callback) => callback(null, table, ''));
    await expect(listPiModelCatalog({ executable: '/pi-node', source: '/pi/cli.js', args: ['/pi/cli.js', '--config', '/pi/config.json'] }, '/home'))
      .resolves.toHaveLength(2);
    expect(child.execFile).toHaveBeenCalledWith('/pi-node', ['/pi/cli.js', '--offline', '--no-session', '--no-extensions', '--list-models'], expect.objectContaining({ cwd: '/home', timeout: 10_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true } ), expect.any(Function));
  });
  it('returns a sanitized actionable error when Pi cannot list models', async () => {
    child.execFile.mockImplementation((_executable, _args, _options, callback) => callback(new Error('private path or credential detail'), '', ''));
    await expect(listPiModelCatalog({ executable: '/pi', source: '/pi', args: [] }, '/home')).rejects.toThrow('可继续使用 Pi 默认模型');
  });
});
